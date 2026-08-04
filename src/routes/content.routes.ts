import { Router } from "express";
import { and, desc, eq, ilike } from "drizzle-orm";
import { db } from "../db/index.js";
import { contents } from "../db/schema.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

export const contentRouter = Router();

// semua endpoint di bawah ini wajib login
contentRouter.use(authMiddleware);

/**
 * GET /content
 * Query params opsional:
 *  - status: draft | pending_review | revisi | approved | published
 *  - search: cari di title
 *  - platform: instagram | website | dll (exact match, case-insensitive)
 *  - pillar: edukasi | hiburan | promosi
 */
contentRouter.get("/", async (req, res) => {
  const { status, search, platform, pillar } = req.query as {
    status?: string;
    search?: string;
    platform?: string;
    pillar?: string;
  };

  const conditions = [];
  if (status) {
    conditions.push(eq(contents.status, status as any));
  }
  if (search) {
    conditions.push(ilike(contents.title, `%${search}%`));
  }
  if (platform) {
    conditions.push(ilike(contents.platform, platform));
  }
  if (pillar) {
    conditions.push(eq(contents.pillar, pillar as any));
  }

  const rows = await db.query.contents.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(contents.updatedAt)],
    with: {
      author: {
        columns: { id: true, name: true, role: true },
      },
    },
  });

  res.json(rows);
});

// GET /content/:id
contentRouter.get("/:id", async (req, res) => {
  const row = await db.query.contents.findFirst({
    where: eq(contents.id, req.params.id),
    with: {
      author: { columns: { id: true, name: true, role: true } },
    },
  });

  if (!row) {
    return res.status(404).json({ message: "Konten tidak ditemukan" });
  }

  res.json(row);
});

// POST /content — buat draft baru
contentRouter.post("/", async (req, res) => {
  const { title, bodyDraft, platform, pillar } = req.body ?? {};

  if (!title || !String(title).trim()) {
    return res.status(400).json({ message: "Judul wajib diisi" });
  }

  const requiresApproval = req.user!.role === "creator_staff";

  const [created] = await db
    .insert(contents)
    .values({
      title: String(title).trim(),
      bodyDraft: bodyDraft ?? null,
      platform: platform ?? null,
      pillar: pillar || null,
      status: "draft",
      requiresApproval,
      createdBy: req.user!.userId,
    })
    .returning();

  res.status(201).json(created);
});

// PATCH /content/:id — update draft/judul/platform/pillar/status
contentRouter.patch("/:id", async (req, res) => {
  const existing = await db.query.contents.findFirst({
    where: eq(contents.id, req.params.id),
  });

  if (!existing) {
    return res.status(404).json({ message: "Konten tidak ditemukan" });
  }

  const isOwner = existing.createdBy === req.user!.userId;
  const isLeadAdmin = req.user!.role === "lead_admin";

  if (!isOwner && !isLeadAdmin) {
    return res.status(403).json({ message: "Tidak punya akses mengubah konten ini" });
  }

  const { title, bodyDraft, platform, pillar, status } = req.body ?? {};

  // hanya lead_admin yang boleh set status secara bebas
  // (alur approve/revisi formal nanti lewat endpoint /approval)
  if (status && !isLeadAdmin) {
    return res.status(403).json({ message: "Hanya Lead/Admin yang bisa mengubah status" });
  }

  const [updated] = await db
    .update(contents)
    .set({
      ...(title !== undefined ? { title: String(title).trim() } : {}),
      ...(bodyDraft !== undefined ? { bodyDraft } : {}),
      ...(platform !== undefined ? { platform } : {}),
      ...(pillar !== undefined ? { pillar: pillar || null } : {}),
      ...(status !== undefined ? { status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(contents.id, req.params.id))
    .returning();

  res.json(updated);
});

// DELETE /content/:id — hanya pembuat atau lead_admin
contentRouter.delete("/:id", async (req, res) => {
  const existing = await db.query.contents.findFirst({
    where: eq(contents.id, req.params.id),
  });

  if (!existing) {
    return res.status(404).json({ message: "Konten tidak ditemukan" });
  }

  const isOwner = existing.createdBy === req.user!.userId;
  const isLeadAdmin = req.user!.role === "lead_admin";

  if (!isOwner && !isLeadAdmin) {
    return res.status(403).json({ message: "Tidak punya akses menghapus konten ini" });
  }

  await db.delete(contents).where(eq(contents.id, req.params.id));

  res.json({ message: "Konten dihapus" });
});