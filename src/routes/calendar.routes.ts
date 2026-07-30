import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { calendarItems, contents } from "../db/schema.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

export const calendarRouter = Router();

calendarRouter.use(authMiddleware);

// GET /calendar — semua jadwal tayang (lintas konten), untuk tampilan kalender global
calendarRouter.get("/", async (_req, res) => {
  const rows = await db.query.calendarItems.findMany({
    orderBy: [asc(calendarItems.scheduledDate)],
    with: {
      content: {
        columns: { id: true, title: true, status: true },
      },
    },
  });

  res.json(rows);
});

// GET /calendar/content/:contentId — jadwal tayang untuk satu konten
calendarRouter.get("/content/:contentId", async (req, res) => {
  const rows = await db
    .select()
    .from(calendarItems)
    .where(eq(calendarItems.contentId, req.params.contentId))
    .orderBy(asc(calendarItems.scheduledDate));

  res.json(rows);
});

// POST /calendar — tambah jadwal tayang baru
calendarRouter.post("/", async (req, res) => {
  const { contentId, scheduledDate, platform } = req.body ?? {};

  if (!contentId || !scheduledDate) {
    return res.status(400).json({ message: "contentId dan scheduledDate wajib diisi" });
  }

  const content = await db.query.contents.findFirst({
    where: eq(contents.id, contentId),
  });
  if (!content) {
    return res.status(404).json({ message: "Konten tidak ditemukan" });
  }

  const [created] = await db
    .insert(calendarItems)
    .values({
      contentId,
      scheduledDate: new Date(scheduledDate),
      platform: platform || null,
    })
    .returning();

  res.status(201).json(created);
});

// PATCH /calendar/:id — ubah tanggal/platform
calendarRouter.patch("/:id", async (req, res) => {
  const { scheduledDate, platform } = req.body ?? {};

  const [updated] = await db
    .update(calendarItems)
    .set({
      ...(scheduledDate !== undefined ? { scheduledDate: new Date(scheduledDate) } : {}),
      ...(platform !== undefined ? { platform } : {}),
    })
    .where(eq(calendarItems.id, req.params.id))
    .returning();

  if (!updated) {
    return res.status(404).json({ message: "Jadwal tidak ditemukan" });
  }

  res.json(updated);
});

// DELETE /calendar/:id
calendarRouter.delete("/:id", async (req, res) => {
  const deleted = await db
    .delete(calendarItems)
    .where(eq(calendarItems.id, req.params.id))
    .returning();

  if (deleted.length === 0) {
    return res.status(404).json({ message: "Jadwal tidak ditemukan" });
  }

  res.json({ message: "Jadwal dihapus" });
});