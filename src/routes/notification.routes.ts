import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { notifications } from "../db/schema.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

export const notificationRouter = Router();

notificationRouter.use(authMiddleware);

// GET /notifications — daftar notifikasi milik user yang login (terbaru dulu)
notificationRouter.get("/", async (req, res) => {
  const rows = await db.query.notifications.findMany({
    where: eq(notifications.userId, req.user!.userId),
    orderBy: [desc(notifications.createdAt)],
    with: {
      content: { columns: { id: true, title: true } },
    },
  });

  res.json(rows);
});

// PATCH /notifications/:id/read — tandai satu notifikasi sudah dibaca
notificationRouter.patch("/:id/read", async (req, res) => {
  const [updated] = await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(eq(notifications.id, req.params.id), eq(notifications.userId, req.user!.userId))
    )
    .returning();

  if (!updated) {
    return res.status(404).json({ message: "Notifikasi tidak ditemukan" });
  }

  res.json(updated);
});

// PATCH /notifications/read-all — tandai semua notifikasi milik user sudah dibaca
notificationRouter.patch("/read-all", async (req, res) => {
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.userId, req.user!.userId));

  res.json({ message: "Semua notifikasi ditandai sudah dibaca" });
});

// DELETE /notifications/:id — hapus satu notifikasi milik user yang login
notificationRouter.delete("/:id", async (req, res) => {
  const [deleted] = await db
    .delete(notifications)
    .where(and(eq(notifications.id, req.params.id), eq(notifications.userId, req.user!.userId)))
    .returning();

  if (!deleted) {
    return res.status(404).json({ message: "Notifikasi tidak ditemukan" });
  }

  res.json({ message: "Notifikasi dihapus" });
});

// DELETE /notifications — hapus semua notifikasi milik user yang login
notificationRouter.delete("/", async (req, res) => {
  await db.delete(notifications).where(eq(notifications.userId, req.user!.userId));
  res.json({ message: "Semua notifikasi dihapus" });
});