import { Router } from "express";
import multer from "multer";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { contents, promptTemplates, contentAiLogs, mediaAssets, mediaVersions } from "../db/schema.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { generateWithGemini, generateImageWithGemini } from "../services/ai.service.js";
import * as gdrive from "../services/gdrive.service.js";

export const aiRouter = Router();

aiRouter.use(authMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB, cukup buat foto/video referensi
});

async function assertContentAccess(contentId: string, userId: string, role: string) {
  const content = await db.query.contents.findFirst({ where: eq(contents.id, contentId) });
  if (!content) return { content: null, error: { status: 404, message: "Konten tidak ditemukan" } };
  const isOwner = content.createdBy === userId;
  if (!isOwner && role !== "lead_admin") {
    return { content: null, error: { status: 403, message: "Tidak punya akses untuk konten ini" } };
  }
  return { content, error: null };
}

// POST /ai/draft/generate — generate teks TANPA konten tersimpan dulu (dipakai di form
// "Draft Konten Baru" sebelum user klik Simpan Draft). Tidak butuh contentId, tidak
// dicatat ke content_ai_logs (belum ada konten untuk dilampiri lognya).
aiRouter.post("/draft/generate", async (req, res) => {
  const { title, platforms, pillar, promptTemplateId, bodyDraft, instructions } = req.body ?? {};

  let template: typeof promptTemplates.$inferSelect | undefined;
  if (promptTemplateId) {
    template = await db.query.promptTemplates.findFirst({
      where: eq(promptTemplates.id, promptTemplateId),
    });
    if (!template) {
      return res.status(404).json({ message: "Prompt template tidak ditemukan" });
    }
  }

  const parts: string[] = [];
  if (template) {
    parts.push(`Brand voice / gaya penulisan:\n${template.templateText}`);
    if (template.brandVoiceNotes) {
      parts.push(`Catatan brand voice tambahan:\n${template.brandVoiceNotes}`);
    }
  }
  if (title?.trim()) parts.push(`Judul konten: ${String(title).trim()}`);
  if (Array.isArray(platforms) && platforms.length) parts.push(`Platform tujuan: ${platforms.join(", ")}`);
  if (pillar?.trim()) parts.push(`Pillar/kategori konten: ${String(pillar).trim()}`);
  if (bodyDraft?.trim()) {
    parts.push(`Draft/arahan dari user (perbaiki/kembangkan ini):\n${String(bodyDraft).trim()}`);
  }
  if (instructions?.trim()) {
    parts.push(`Instruksi tambahan dari user: ${String(instructions).trim()}`);
  }
  parts.push(
    "Tulis hasil akhirnya saja dalam Bahasa Indonesia, siap pakai untuk publikasi. Jangan tambahkan penjelasan meta di luar konten itu sendiri."
  );

  const finalPrompt = parts.join("\n\n");

  let aiText: string;
  try {
    aiText = await generateWithGemini(finalPrompt, null);
  } catch (err) {
    return res.status(502).json({ message: err instanceof Error ? err.message : "Gagal generate lewat Gemini" });
  }

  res.json({ text: aiText });
});

// POST /ai/content/:contentId/generate — generate teks draft, bisa dilampiri file referensi (opsional)
aiRouter.post("/content/:contentId/generate", upload.single("referenceFile"), async (req, res) => {
  const { promptTemplateId, instructions } = req.body ?? {};

  const { content, error } = await assertContentAccess(
    req.params.contentId,
    req.user!.userId,
    req.user!.role
  );
  if (error) return res.status(error.status).json({ message: error.message });

  let template: typeof promptTemplates.$inferSelect | undefined;
  if (promptTemplateId) {
    template = await db.query.promptTemplates.findFirst({
      where: eq(promptTemplates.id, promptTemplateId),
    });
    if (!template) {
      return res.status(404).json({ message: "Prompt template tidak ditemukan" });
    }
  }

  const parts: string[] = [];
  if (template) {
    parts.push(`Brand voice / gaya penulisan:\n${template.templateText}`);
    if (template.brandVoiceNotes) {
      parts.push(`Catatan brand voice tambahan:\n${template.brandVoiceNotes}`);
    }
  }
  parts.push(`Judul konten: ${content!.title}`);
  if (content!.platforms && content!.platforms.length) parts.push(`Platform tujuan: ${content!.platforms.join(", ")}`);
  if (content!.bodyDraft?.trim()) {
    parts.push(`Draft yang sudah ada (perbaiki/kembangkan ini):\n${content!.bodyDraft}`);
  }
  if (req.file) {
    if (req.file.mimetype.startsWith("image/")) {
      parts.push("User melampirkan gambar referensi — perhatikan isinya sebagai konteks/inspirasi.");
    } else if (req.file.mimetype.startsWith("video/")) {
      parts.push(
        `User melampirkan file video referensi bernama "${req.file.originalname}" (isi video belum bisa dianalisis otomatis, jadikan konteks nama filenya saja).`
      );
    }
  }
  if (instructions?.trim()) {
    parts.push(`Instruksi tambahan dari user:\n${String(instructions).trim()}`);
  }
  parts.push(
    "Tulis hasil akhirnya saja dalam Bahasa Indonesia, siap pakai untuk publikasi. Jangan tambahkan penjelasan meta di luar konten itu sendiri."
  );

  const finalPrompt = parts.join("\n\n");

  const referenceFile =
    req.file && req.file.mimetype.startsWith("image/")
      ? { base64: req.file.buffer.toString("base64"), mimeType: req.file.mimetype }
      : null;

  let aiText: string;
  try {
    aiText = await generateWithGemini(finalPrompt, referenceFile);
  } catch (err) {
    return res.status(502).json({ message: err instanceof Error ? err.message : "Gagal generate lewat Gemini" });
  }

  const [updatedContent] = await db
    .update(contents)
    .set({ bodyAiGenerated: aiText, updatedAt: new Date() })
    .where(eq(contents.id, content!.id))
    .returning();

  await db.insert(contentAiLogs).values({
    contentId: content!.id,
    promptTemplateId: template?.id || null,
    promptUsed: finalPrompt,
    aiResponse: aiText,
    model: "gemini",
  });

  res.json(updatedContent);
});

import { notifyLeadAdmins } from "../services/notification.service.js";

// POST /ai/image/generate — generate gambar TANPA simpan dulu (standalone, tidak terikat draft).
// Bisa dilampiri referenceFile: baik referensi awal dari user, atau hasil generate sebelumnya
// (dikirim ulang sebagai file) buat alur revisi "generate ulang dengan perbaikan".
aiRouter.post("/image/generate", upload.single("referenceFile"), async (req, res) => {
  const { prompt } = req.body ?? {};
  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ message: "Prompt gambar wajib diisi" });
  }

  const referenceImage =
    req.file && req.file.mimetype.startsWith("image/")
      ? { base64: req.file.buffer.toString("base64"), mimeType: req.file.mimetype }
      : null;

  let generated: { buffer: Buffer; mimeType: string };
  try {
    generated = await generateImageWithGemini(String(prompt).trim(), referenceImage);
  } catch (err) {
    return res.status(502).json({
      message: err instanceof Error ? err.message : "Gagal generate gambar lewat Gemini",
    });
  }

  res.json({
    imageBase64: generated.buffer.toString("base64"),
    mimeType: generated.mimeType,
  });
});

// POST /ai/image/save — simpan gambar yang sudah digenerate (dan disetujui user) sebagai
// media standalone (tidak terikat konten), masuk ke alur review media yang sudah ada.
aiRouter.post("/image/save", async (req, res) => {
  const { imageBase64, mimeType, fileName } = req.body ?? {};
  if (!imageBase64 || !mimeType) {
    return res.status(400).json({ message: "imageBase64 dan mimeType wajib diisi" });
  }

  const buffer = Buffer.from(String(imageBase64), "base64");
  const ext = String(mimeType).split("/")[1] || "png";
  const finalFileName = fileName ? String(fileName).trim() : `ai-generated-${Date.now()}.${ext}`;

  let gdriveFileId: string;
  try {
    gdriveFileId = await gdrive.uploadFile(buffer, finalFileName, String(mimeType));
  } catch (err) {
    return res.status(502).json({
      message: err instanceof Error ? err.message : "Gagal upload gambar ke Drive",
    });
  }

  const [asset] = await db
    .insert(mediaAssets)
    .values({
      contentId: null,
      fileName: finalFileName,
      mimeType: String(mimeType),
      uploadedBy: req.user!.userId,
    })
    .returning();

  const [version] = await db
    .insert(mediaVersions)
    .values({
      mediaAssetId: asset.id,
      versionNumber: 1,
      gdriveFileId,
      status: "pending",
      uploadedBy: req.user!.userId,
    })
    .returning();

  await notifyLeadAdmins(
    "submitted",
    `Media baru "${finalFileName}" (hasil AI, standalone) menunggu review.`,
    null,
    req.user!.userId
  );

  res.status(201).json({ ...asset, versions: [version] });
});

// POST /ai/content/:contentId/generate-image — generate gambar, bisa dilampiri gambar referensi (opsional)
// Hasilnya otomatis tersimpan sebagai media & masuk alur review yang sudah ada.
aiRouter.post("/content/:contentId/generate-image", upload.single("referenceFile"), async (req, res) => {
  const { prompt } = req.body ?? {};
  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ message: "Prompt gambar wajib diisi" });
  }

  const { content, error } = await assertContentAccess(
    req.params.contentId,
    req.user!.userId,
    req.user!.role
  );
  if (error) return res.status(error.status).json({ message: error.message });

  const referenceImage =
    req.file && req.file.mimetype.startsWith("image/")
      ? { base64: req.file.buffer.toString("base64"), mimeType: req.file.mimetype }
      : null;

  let generated: { buffer: Buffer; mimeType: string };
  try {
    generated = await generateImageWithGemini(String(prompt).trim(), referenceImage);
  } catch (err) {
    return res.status(502).json({
      message: err instanceof Error ? err.message : "Gagal generate gambar lewat Gemini",
    });
  }

  const ext = generated.mimeType.split("/")[1] || "png";
  const fileName = `ai-generated-${Date.now()}.${ext}`;

  let gdriveFileId: string;
  try {
    gdriveFileId = await gdrive.uploadFile(generated.buffer, fileName, generated.mimeType);
  } catch (err) {
    return res.status(502).json({
      message: err instanceof Error ? err.message : "Gambar berhasil digenerate tapi gagal diupload ke Drive",
    });
  }

  const [asset] = await db
    .insert(mediaAssets)
    .values({
      contentId: content!.id,
      fileName,
      mimeType: generated.mimeType,
      uploadedBy: req.user!.userId,
    })
    .returning();

  const [version] = await db
    .insert(mediaVersions)
    .values({
      mediaAssetId: asset.id,
      versionNumber: 1,
      gdriveFileId,
      status: "pending",
      uploadedBy: req.user!.userId,
    })
    .returning();

  res.status(201).json({ ...asset, versions: [version] });
});