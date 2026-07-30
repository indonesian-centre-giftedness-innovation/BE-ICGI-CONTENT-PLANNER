import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { contents, approvals, notifications } from "../db/schema.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { roleMiddleware } from "../middleware/roleMiddleware.js";

export const approvalRouter = Router();

approvalRouter.use(authMiddleware);

// GET /approval/pending — antrian konten yang menunggu review (khusus Lead/Admin)
approvalRouter.get("/pending", roleMiddleware("lead_admin"), async (_req, res) => {
  const rows = await db.query.contents.findMany({
    where: eq(contents.status, "pending_review"),
    orderBy: [desc(contents.updatedAt)],
    with: {
      author: { columns: { id: true, name: true, role: true } },
    },
  });

  res.json(rows);
});

// GET /approval/content/:contentId — riwayat approval (audit trail) untuk satu konten
approvalRouter.get("/content/:contentId", async (req, res) => {
  const rows = await db.query.approvals.findMany({
    where: eq(approvals.contentId, req.params.contentId),
    orderBy: [desc(approvals.reviewedAt)],
    with: {
      reviewer: { columns: { id: true, name: true } },
    },
  });

  res.json(rows);
});

// POST /approval/:contentId/submit — creator submit draft untuk direview
approvalRouter.post("/:contentId/submit", async (req, res) => {
  const content = await db.query.contents.findFirst({
    where: eq(contents.id, req.params.contentId),
  });

  if (!content) {
    return res.status(404).json({ message: "Konten tidak ditemukan" });
  }

  const isOwner = content.createdBy === req.user!.userId;
  const isLeadAdmin = req.user!.role === "lead_admin";
  if (!isOwner && !isLeadAdmin) {
    return res.status(403).json({ message: "Tidak punya akses submit konten ini" });
  }

  if (!["draft", "revisi"].includes(content.status)) {
    return res
      .status(400)
      .json({ message: `Konten berstatus "${content.status}" tidak bisa disubmit ulang` });
  }

  // kalau requiresApproval = false (dibuat lead_admin), langsung approved tanpa antre review
  const nextStatus = content.requiresApproval ? "pending_review" : "approved";

  const [updated] = await db
    .update(contents)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(contents.id, req.params.contentId))
    .returning();

  res.json(updated);
});

// POST /approval/:contentId/approve — Lead/Admin approve konten
approvalRouter.post("/:contentId/approve", roleMiddleware("lead_admin"), async (req, res) => {
  const { notes } = req.body ?? {};

  const content = await db.query.contents.findFirst({
    where: eq(contents.id, req.params.contentId),
  });
  if (!content) {
    return res.status(404).json({ message: "Konten tidak ditemukan" });
  }

  if (content.status !== "pending_review") {
    return res
      .status(400)
      .json({ message: `Konten berstatus "${content.status}", bukan menunggu review` });
  }

  await db.insert(approvals).values({
    contentId: content.id,
    reviewerId: req.user!.userId,
    status: "approved",
    notes: notes || null,
  });

  const [updated] = await db
    .update(contents)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(contents.id, content.id))
    .returning();

  await db.insert(notifications).values({
    userId: content.createdBy,
    type: "approval",
    contentId: content.id,
    message: `Konten "${content.title}" telah disetujui.`,
  });

  res.json(updated);
});

// POST /approval/:contentId/revisi — Lead/Admin minta revisi (wajib isi catatan)
approvalRouter.post("/:contentId/revisi", roleMiddleware("lead_admin"), async (req, res) => {
  const { notes } = req.body ?? {};

  if (!notes || !String(notes).trim()) {
    return res.status(400).json({ message: "Catatan revisi wajib diisi" });
  }

  const content = await db.query.contents.findFirst({
    where: eq(contents.id, req.params.contentId),
  });
  if (!content) {
    return res.status(404).json({ message: "Konten tidak ditemukan" });
  }

  if (content.status !== "pending_review") {
    return res
      .status(400)
      .json({ message: `Konten berstatus "${content.status}", bukan menunggu review` });
  }

  await db.insert(approvals).values({
    contentId: content.id,
    reviewerId: req.user!.userId,
    status: "revisi",
    notes: String(notes).trim(),
  });

  const [updated] = await db
    .update(contents)
    .set({ status: "revisi", updatedAt: new Date() })
    .where(eq(contents.id, content.id))
    .returning();

  await db.insert(notifications).values({
    userId: content.createdBy,
    type: "revisi",
    contentId: content.id,
    message: `Konten "${content.title}" perlu direvisi: ${String(notes).trim()}`,
  });

  res.json(updated);
});

// POST /approval/:contentId/publish — Lead/Admin tandai tayang (hanya dari status approved)
approvalRouter.post("/:contentId/publish", roleMiddleware("lead_admin"), async (req, res) => {
  const content = await db.query.contents.findFirst({
    where: eq(contents.id, req.params.contentId),
  });
  if (!content) {
    return res.status(404).json({ message: "Konten tidak ditemukan" });
  }

  if (content.status !== "approved") {
    return res
      .status(400)
      .json({ message: `Konten harus berstatus "approved" dulu sebelum dipublish` });
  }

  const [updated] = await db
    .update(contents)
    .set({ status: "published", updatedAt: new Date() })
    .where(eq(contents.id, content.id))
    .returning();

  res.json(updated);
});