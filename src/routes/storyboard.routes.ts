import { Router } from "express";
import multer from "multer";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { storyboards, storyboardScenes, storyboardSketchTemplates, contents } from "../db/schema.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import * as gdrive from "../services/gdrive.service.js";

export const storyboardRouter = Router();

storyboardRouter.use(authMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB cukup buat gambar sketsa
});

// GET /storyboard — daftar semua storyboard (ringkas) lintas konten, untuk halaman overview
storyboardRouter.get("/", async (_req, res) => {
  const rows = await db.query.storyboards.findMany({
    orderBy: (t, { desc }) => [desc(t.updatedAt)],
    with: {
      content: { columns: { id: true, title: true, status: true, platform: true } },
      scenes: { columns: { id: true, durationSeconds: true } },
    },
  });

  const result = rows.map((r) => ({
    id: r.id,
    contentId: r.contentId,
    title: r.title,
    updatedAt: r.updatedAt,
    content: r.content,
    sceneCount: r.scenes.length,
    totalDurationSeconds: r.scenes.reduce((sum, s) => sum + (s.durationSeconds || 0), 0),
  }));

  res.json(result);
});

// GET /storyboard/content/:contentId — ambil storyboard + scenes (urut) milik satu konten
storyboardRouter.get("/content/:contentId", async (req, res) => {
  const storyboard = await db.query.storyboards.findFirst({
    where: eq(storyboards.contentId, req.params.contentId),
  });

  if (!storyboard) {
    return res.json(null);
  }

  const scenes = await db
    .select()
    .from(storyboardScenes)
    .where(eq(storyboardScenes.storyboardId, storyboard.id))
    .orderBy(asc(storyboardScenes.sceneOrder));

  res.json({ ...storyboard, scenes });
});

// GET /storyboard/:id — ambil satu storyboard + scenes langsung by ID (dipakai untuk storyboard standalone)
storyboardRouter.get("/:id", async (req, res) => {
  const storyboard = await db.query.storyboards.findFirst({
    where: eq(storyboards.id, req.params.id),
    with: {
      content: { columns: { id: true, title: true } },
    },
  });

  if (!storyboard) {
    return res.status(404).json({ message: "Storyboard tidak ditemukan" });
  }

  const scenes = await db
    .select()
    .from(storyboardScenes)
    .where(eq(storyboardScenes.storyboardId, storyboard.id))
    .orderBy(asc(storyboardScenes.sceneOrder));

  res.json({ ...storyboard, scenes });
});

// POST /storyboard — buat storyboard baru. contentId opsional:
// - kalau diisi: idempotent per konten (kalau sudah ada punya konten itu, dikembalikan yang ada)
// - kalau kosong: storyboard berdiri sendiri (standalone), tidak terikat draft
storyboardRouter.post("/", async (req, res) => {
  const { contentId, title } = req.body ?? {};
  let resolvedTitle = title || null;

  if (contentId) {
    const content = await db.query.contents.findFirst({
      where: eq(contents.id, contentId),
    });
    if (!content) {
      return res.status(404).json({ message: "Konten tidak ditemukan" });
    }

    const existing = await db.query.storyboards.findFirst({
      where: eq(storyboards.contentId, contentId),
    });
    if (existing) {
      return res.json(existing);
    }

    // storyboard terikat draft otomatis pakai judul draft-nya
    resolvedTitle = content.title;
  }

  const [created] = await db
    .insert(storyboards)
    .values({
      contentId: contentId || null,
      title: resolvedTitle,
      createdBy: req.user!.userId,
    })
    .returning();

  res.status(201).json(created);
});

// DELETE /storyboard/:id — hapus storyboard permanen beserta semua scene-nya
// (file sketsa milik template TIDAK ikut terhapus dari Drive, hanya file sketsa manual)
storyboardRouter.delete("/:id", async (req, res) => {
  const scenes = await db
    .select()
    .from(storyboardScenes)
    .where(eq(storyboardScenes.storyboardId, req.params.id));

  for (const scene of scenes) {
    if (scene.sketchImageGdriveId) {
      const isTemplateFile = await db.query.storyboardSketchTemplates.findFirst({
        where: eq(storyboardSketchTemplates.gdriveFileId, scene.sketchImageGdriveId),
      });
      if (!isTemplateFile) {
        await gdrive.deleteFile(scene.sketchImageGdriveId).catch(() => {});
      }
    }
  }

  const deleted = await db.delete(storyboards).where(eq(storyboards.id, req.params.id)).returning();

  if (deleted.length === 0) {
    return res.status(404).json({ message: "Storyboard tidak ditemukan" });
  }

  res.json({ message: "Storyboard dihapus permanen" });
});

// PATCH /storyboard/:id — ubah judul storyboard
storyboardRouter.patch("/:id", async (req, res) => {
  const { title } = req.body ?? {};

  const [updated] = await db
    .update(storyboards)
    .set({ title, updatedAt: new Date() })
    .where(eq(storyboards.id, req.params.id))
    .returning();

  if (!updated) {
    return res.status(404).json({ message: "Storyboard tidak ditemukan" });
  }

  res.json(updated);
});

// POST /storyboard/:id/scenes — tambah scene baru (urutan otomatis di akhir)
storyboardRouter.post("/:id/scenes", async (req, res) => {
  const { description, dialogue, durationSeconds, sketchImageGdriveId } = req.body ?? {};

  const storyboard = await db.query.storyboards.findFirst({
    where: eq(storyboards.id, req.params.id),
  });
  if (!storyboard) {
    return res.status(404).json({ message: "Storyboard tidak ditemukan" });
  }

  const existingScenes = await db
    .select()
    .from(storyboardScenes)
    .where(eq(storyboardScenes.storyboardId, req.params.id));

  const nextOrder =
    existingScenes.length > 0
      ? Math.max(...existingScenes.map((s) => s.sceneOrder)) + 1
      : 1;

  const [created] = await db
    .insert(storyboardScenes)
    .values({
      storyboardId: req.params.id,
      sceneOrder: nextOrder,
      description: description || null,
      dialogue: dialogue || null,
      durationSeconds: durationSeconds ?? 0,
      sketchImageGdriveId: sketchImageGdriveId || null,
    })
    .returning();

  res.status(201).json(created);
});

// PATCH /storyboard/scenes/:sceneId — ubah deskripsi/durasi/sketsa scene
storyboardRouter.patch("/scenes/:sceneId", async (req, res) => {
  const { description, dialogue, durationSeconds, sketchImageGdriveId } = req.body ?? {};

  const [updated] = await db
    .update(storyboardScenes)
    .set({
      ...(description !== undefined ? { description } : {}),
      ...(dialogue !== undefined ? { dialogue } : {}),
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      ...(sketchImageGdriveId !== undefined ? { sketchImageGdriveId } : {}),
    })
    .where(eq(storyboardScenes.id, req.params.sceneId))
    .returning();

  if (!updated) {
    return res.status(404).json({ message: "Scene tidak ditemukan" });
  }

  res.json(updated);
});

// PATCH /storyboard/scenes/:sceneId/move — tukar urutan dengan tetangga (up/down)
storyboardRouter.patch("/scenes/:sceneId/move", async (req, res) => {
  const { direction } = req.body ?? {}; // "up" | "down"

  const current = await db.query.storyboardScenes.findFirst({
    where: eq(storyboardScenes.id, req.params.sceneId),
  });
  if (!current) {
    return res.status(404).json({ message: "Scene tidak ditemukan" });
  }

  const siblings = await db
    .select()
    .from(storyboardScenes)
    .where(eq(storyboardScenes.storyboardId, current.storyboardId))
    .orderBy(asc(storyboardScenes.sceneOrder));

  const idx = siblings.findIndex((s) => s.id === current.id);
  const targetIdx = direction === "up" ? idx - 1 : idx + 1;

  if (targetIdx < 0 || targetIdx >= siblings.length) {
    return res.json(current); // sudah di ujung, tidak ada perubahan
  }

  const target = siblings[targetIdx];

  await db
    .update(storyboardScenes)
    .set({ sceneOrder: target.sceneOrder })
    .where(eq(storyboardScenes.id, current.id));

  await db
    .update(storyboardScenes)
    .set({ sceneOrder: current.sceneOrder })
    .where(eq(storyboardScenes.id, target.id));

  res.json({ message: "Urutan diperbarui" });
});

// DELETE /storyboard/scenes/:sceneId
storyboardRouter.delete("/scenes/:sceneId", async (req, res) => {
  const deleted = await db
    .delete(storyboardScenes)
    .where(eq(storyboardScenes.id, req.params.sceneId))
    .returning();

  if (deleted.length === 0) {
    return res.status(404).json({ message: "Scene tidak ditemukan" });
  }

  res.json({ message: "Scene dihapus" });
});

// POST /storyboard/scenes/:sceneId/sketch — upload/ganti gambar sketsa scene
storyboardRouter.post(
  "/scenes/:sceneId/sketch",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "File wajib diunggah" });
    }

    const scene = await db.query.storyboardScenes.findFirst({
      where: eq(storyboardScenes.id, req.params.sceneId),
    });
    if (!scene) {
      return res.status(404).json({ message: "Scene tidak ditemukan" });
    }

    let gdriveFileId: string;
    try {
      gdriveFileId = await gdrive.uploadFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
    } catch (err) {
      return res.status(502).json({
        message: err instanceof Error ? err.message : "Gagal upload ke Google Drive",
      });
    }

    // hapus sketsa lama dari Drive kalau ada — TAPI jangan hapus kalau file itu
    // ternyata milik template (dipakai bersama scene lain juga), cukup lepas referensinya saja
    if (scene.sketchImageGdriveId) {
      const isTemplateFile = await db.query.storyboardSketchTemplates.findFirst({
        where: eq(storyboardSketchTemplates.gdriveFileId, scene.sketchImageGdriveId),
      });
      if (!isTemplateFile) {
        await gdrive.deleteFile(scene.sketchImageGdriveId).catch(() => {});
      }
    }

    const [updated] = await db
      .update(storyboardScenes)
      .set({ sketchImageGdriveId: gdriveFileId, sketchLabel: null })
      .where(eq(storyboardScenes.id, scene.id))
      .returning();

    res.json(updated);
  }
);

// GET /storyboard/scenes/:sceneId/sketch — proxy stream gambar sketsa dari Google Drive
storyboardRouter.get("/scenes/:sceneId/sketch", async (req, res) => {
  const scene = await db.query.storyboardScenes.findFirst({
    where: eq(storyboardScenes.id, req.params.sceneId),
  });

  if (!scene || !scene.sketchImageGdriveId) {
    return res.status(404).json({ message: "Sketsa belum ada" });
  }

  try {
    const { stream, mimeType, fileName } = await gdrive.getFileStream(scene.sketchImageGdriveId);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    stream.pipe(res);
  } catch (err) {
    res.status(502).json({
      message: err instanceof Error ? err.message : "Gagal mengambil gambar dari Google Drive",
    });
  }
});

// ============================================================
// LIBRARY SKETSA TEMPLATE — diupload sekali, dipakai berulang lewat
// drag & drop ke scene manapun (tidak terikat satu storyboard)
// ============================================================

// GET /storyboard/templates — daftar semua template sketsa
storyboardRouter.get("/templates/all", async (_req, res) => {
  const rows = await db.query.storyboardSketchTemplates.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
  res.json(rows);
});

// POST /storyboard/templates — upload template sketsa baru (nama/angle shoot + gambar)
storyboardRouter.post("/templates/all", upload.single("file"), async (req, res) => {
  const { name } = req.body ?? {};

  if (!req.file) {
    return res.status(400).json({ message: "File wajib diunggah" });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: "Nama/angle shoot wajib diisi" });
  }

  let gdriveFileId: string;
  try {
    const folderId = await gdrive.getOrCreateFolder("Sketch Templates");
    gdriveFileId = await gdrive.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, folderId);
  } catch (err) {
    return res.status(502).json({
      message: err instanceof Error ? err.message : "Gagal upload ke Google Drive",
    });
  }

  const [created] = await db
    .insert(storyboardSketchTemplates)
    .values({
      name: String(name).trim(),
      gdriveFileId,
      uploadedBy: req.user!.userId,
    })
    .returning();

  res.status(201).json(created);
});

// GET /storyboard/templates/:id/image — proxy stream gambar template
storyboardRouter.get("/templates/:id/image", async (req, res) => {
  const template = await db.query.storyboardSketchTemplates.findFirst({
    where: eq(storyboardSketchTemplates.id, req.params.id),
  });

  if (!template) {
    return res.status(404).json({ message: "Template tidak ditemukan" });
  }

  try {
    const { stream, mimeType, fileName } = await gdrive.getFileStream(template.gdriveFileId);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    stream.pipe(res);
  } catch (err) {
    res.status(502).json({
      message: err instanceof Error ? err.message : "Gagal mengambil gambar dari Google Drive",
    });
  }
});

// DELETE /storyboard/templates/:id — cuma bisa dihapus kalau tidak sedang dipakai scene manapun
storyboardRouter.delete("/templates/:id", async (req, res) => {
  const template = await db.query.storyboardSketchTemplates.findFirst({
    where: eq(storyboardSketchTemplates.id, req.params.id),
  });
  if (!template) {
    return res.status(404).json({ message: "Template tidak ditemukan" });
  }

  const inUse = await db.query.storyboardScenes.findFirst({
    where: eq(storyboardScenes.sketchImageGdriveId, template.gdriveFileId),
  });
  if (inUse) {
    return res.status(409).json({
      message: "Template ini sedang dipakai di salah satu scene, tidak bisa dihapus.",
    });
  }

  await gdrive.deleteFile(template.gdriveFileId).catch(() => {});
  await db.delete(storyboardSketchTemplates).where(eq(storyboardSketchTemplates.id, template.id));

  res.json({ message: "Template dihapus" });
});

// POST /storyboard/scenes/:sceneId/apply-template — pakai gambar dari library template ke scene
// (drag & drop di frontend memanggil ini) — tidak upload ulang, cuma reuse referensi file yang sama
storyboardRouter.post("/scenes/:sceneId/apply-template", async (req, res) => {
  const { templateId } = req.body ?? {};
  if (!templateId) {
    return res.status(400).json({ message: "templateId wajib diisi" });
  }

  const scene = await db.query.storyboardScenes.findFirst({
    where: eq(storyboardScenes.id, req.params.sceneId),
  });
  if (!scene) {
    return res.status(404).json({ message: "Scene tidak ditemukan" });
  }

  const template = await db.query.storyboardSketchTemplates.findFirst({
    where: eq(storyboardSketchTemplates.id, templateId),
  });
  if (!template) {
    return res.status(404).json({ message: "Template tidak ditemukan" });
  }

  // kalau sketsa lama scene ini bukan file template lain, hapus fisiknya biar tidak numpuk
  if (scene.sketchImageGdriveId && scene.sketchImageGdriveId !== template.gdriveFileId) {
    const oldIsTemplate = await db.query.storyboardSketchTemplates.findFirst({
      where: eq(storyboardSketchTemplates.gdriveFileId, scene.sketchImageGdriveId),
    });
    if (!oldIsTemplate) {
      await gdrive.deleteFile(scene.sketchImageGdriveId).catch(() => {});
    }
  }

  const [updated] = await db
    .update(storyboardScenes)
    .set({ sketchImageGdriveId: template.gdriveFileId, sketchLabel: template.name })
    .where(eq(storyboardScenes.id, scene.id))
    .returning();

  res.json(updated);
});