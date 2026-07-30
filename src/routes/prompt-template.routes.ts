import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { promptTemplates } from "../db/schema.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { roleMiddleware } from "../middleware/roleMiddleware.js";

export const promptTemplateRouter = Router();

promptTemplateRouter.use(authMiddleware);

// GET /prompt-templates — semua user boleh lihat (dipakai buat pilih template saat generate AI)
promptTemplateRouter.get("/", async (_req, res) => {
  const rows = await db.query.promptTemplates.findMany({
    orderBy: [desc(promptTemplates.createdAt)],
  });
  res.json(rows);
});

// POST /prompt-templates — hanya Lead/Admin
promptTemplateRouter.post("/", roleMiddleware("lead_admin"), async (req, res) => {
  const { name, templateText, brandVoiceNotes } = req.body ?? {};

  if (!name || !String(name).trim() || !templateText || !String(templateText).trim()) {
    return res.status(400).json({ message: "name dan templateText wajib diisi" });
  }

  const [created] = await db
    .insert(promptTemplates)
    .values({
      name: String(name).trim(),
      templateText: String(templateText).trim(),
      brandVoiceNotes: brandVoiceNotes || null,
      createdBy: req.user!.userId,
    })
    .returning();

  res.status(201).json(created);
});

// PATCH /prompt-templates/:id — edit isi atau toggle aktif/nonaktif, hanya Lead/Admin
promptTemplateRouter.patch("/:id", roleMiddleware("lead_admin"), async (req, res) => {
  const { name, templateText, brandVoiceNotes, isActive } = req.body ?? {};

  const [updated] = await db
    .update(promptTemplates)
    .set({
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(templateText !== undefined ? { templateText: String(templateText).trim() } : {}),
      ...(brandVoiceNotes !== undefined ? { brandVoiceNotes } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    })
    .where(eq(promptTemplates.id, req.params.id))
    .returning();

  if (!updated) {
    return res.status(404).json({ message: "Template tidak ditemukan" });
  }

  res.json(updated);
});

// DELETE /prompt-templates/:id — hanya Lead/Admin. Kalau pernah dipakai (ada log AI terkait),
// hapus akan gagal karena foreign key — sarankan nonaktifkan saja lewat PATCH isActive:false.
promptTemplateRouter.delete("/:id", roleMiddleware("lead_admin"), async (req, res) => {
  try {
    const deleted = await db
      .delete(promptTemplates)
      .where(eq(promptTemplates.id, req.params.id))
      .returning();

    if (deleted.length === 0) {
      return res.status(404).json({ message: "Template tidak ditemukan" });
    }

    res.json({ message: "Template dihapus" });
  } catch (err) {
    res.status(409).json({
      message:
        "Template ini pernah dipakai untuk generate AI sebelumnya, jadi tidak bisa dihapus. Nonaktifkan saja lewat tombol toggle.",
    });
  }
});