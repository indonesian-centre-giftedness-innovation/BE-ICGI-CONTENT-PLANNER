import { Router } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { todos, contents } from "../db/schema.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

export const todoRouter = Router();

todoRouter.use(authMiddleware);

// GET /todos — semua task lintas konten + task standalone, untuk halaman To-Do global
todoRouter.get("/", async (_req, res) => {
  const rows = await db.query.todos.findMany({
    orderBy: [desc(todos.createdAt)],
    with: {
      assignee: { columns: { id: true, name: true } },
      creator: { columns: { id: true, name: true } },
      content: { columns: { id: true, title: true, status: true } },
    },
  });

  res.json(rows);
});

// GET /todos/content/:contentId — checklist untuk satu konten
todoRouter.get("/content/:contentId", async (req, res) => {
  const rows = await db.query.todos.findMany({
    where: eq(todos.contentId, req.params.contentId),
    orderBy: [asc(todos.createdAt)],
    with: {
      assignee: { columns: { id: true, name: true } },
      creator: { columns: { id: true, name: true } },
    },
  });

  res.json(rows);
});

// POST /todos — tambah task baru. contentId opsional: kalau kosong, task berdiri sendiri (standalone)
todoRouter.post("/", async (req, res) => {
  const { contentId, taskText, assignedTo } = req.body ?? {};

  if (!taskText || !String(taskText).trim()) {
    return res.status(400).json({ message: "taskText wajib diisi" });
  }

  if (contentId) {
    const content = await db.query.contents.findFirst({
      where: eq(contents.id, contentId),
    });
    if (!content) {
      return res.status(404).json({ message: "Konten tidak ditemukan" });
    }
  }

  const [created] = await db
    .insert(todos)
    .values({
      contentId: contentId || null,
      taskText: String(taskText).trim(),
      assignedTo: assignedTo || null,
      createdBy: req.user!.userId,
    })
    .returning();

  const withRelations = await db.query.todos.findFirst({
    where: eq(todos.id, created.id),
    with: {
      assignee: { columns: { id: true, name: true } },
      creator: { columns: { id: true, name: true } },
    },
  });

  res.status(201).json(withRelations);
});

// PATCH /todos/:id — ubah teks task, status selesai, atau penanggung jawab
todoRouter.patch("/:id", async (req, res) => {
  const { taskText, isDone, assignedTo } = req.body ?? {};

  const [updated] = await db
    .update(todos)
    .set({
      ...(taskText !== undefined ? { taskText: String(taskText).trim() } : {}),
      ...(isDone !== undefined ? { isDone } : {}),
      ...(assignedTo !== undefined ? { assignedTo } : {}),
    })
    .where(eq(todos.id, req.params.id))
    .returning();

  if (!updated) {
    return res.status(404).json({ message: "Task tidak ditemukan" });
  }

  res.json(updated);
});

// DELETE /todos/:id
todoRouter.delete("/:id", async (req, res) => {
  const deleted = await db.delete(todos).where(eq(todos.id, req.params.id)).returning();

  if (deleted.length === 0) {
    return res.status(404).json({ message: "Task tidak ditemukan" });
  }

  res.json({ message: "Task dihapus" });
});