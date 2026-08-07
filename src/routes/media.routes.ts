import { Router } from "express";
import multer from "multer";
import { asc, desc, eq, isNull, and, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  mediaAssets,
  mediaVersions,
  mediaComments,
  contents,
} from "../db/schema.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { roleMiddleware } from "../middleware/roleMiddleware.js";
import * as gdrive from "../services/gdrive.service.js";
import { notifyUser, notifyLeadAdmins } from "../services/notification.service.js";

export const mediaRouter = Router();

mediaRouter.use(authMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB, cukup untuk video pendek
});

// ============================================================
// MEDIA ASSET + VERSIONING
// ============================================================

// GET /media — daftar semua media asset (ringkas) lintas konten, untuk halaman overview
// GET /media/pending — semua versi media yang masih menunggu review, khusus Lead/Admin
mediaRouter.get("/pending", roleMiddleware("lead_admin"), async (_req, res) => {
  const rows = await db.query.mediaAssets.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: {
      content: { columns: { id: true, title: true } },
      versions: {
        where: and(eq(mediaVersions.status, "pending"), isNull(mediaVersions.deletedAt)),
        orderBy: [desc(mediaVersions.versionNumber)],
      },
    },
  });

  const result = rows
    .filter((r) => r.versions.length > 0)
    .map((r) => ({
      id: r.id,
      contentId: r.contentId,
      fileName: r.fileName,
      mimeType: r.mimeType,
      content: r.content,
      pendingVersion: r.versions[0],
    }));

  res.json(result);
});

mediaRouter.get("/", async (_req, res) => {
  const rows = await db.query.mediaAssets.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    with: {
      content: { columns: { id: true, title: true, status: true, platforms: true } },
      versions: {
        where: isNull(mediaVersions.deletedAt),
        orderBy: [desc(mediaVersions.versionNumber)],
      },
    },
  });

  const result = rows.map((r) => ({
    id: r.id,
    contentId: r.contentId,
    fileName: r.fileName,
    mimeType: r.mimeType,
    createdAt: r.createdAt,
    uploadedBy: r.uploadedBy,
    content: r.content,
    latestVersion: r.versions[0] ?? null,
    versionCount: r.versions.length,
  }));

  res.json(result);
});

// GET /media/standalone — media yang tidak terikat konten mana pun
mediaRouter.get("/standalone", async (_req, res) => {
  const assets = await db.query.mediaAssets.findMany({
    where: isNull(mediaAssets.contentId),
    orderBy: [desc(mediaAssets.createdAt)],
    with: {
      versions: {
        where: isNull(mediaVersions.deletedAt),
        orderBy: [asc(mediaVersions.versionNumber)],
      },
    },
  });

  res.json(assets);
});

// POST /media/standalone — upload media baru tanpa terikat konten (bikin asset + versi pertama)
mediaRouter.post("/standalone", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "File wajib diunggah" });
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

  const [asset] = await db
    .insert(mediaAssets)
    .values({
      contentId: null,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
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
    "media_submitted",
    `Media baru "${req.file.originalname}" (standalone) menunggu review.`,
    null,
    req.user!.userId
  );

  res.status(201).json({ ...asset, versions: [version] });
});

// GET /media/content/:contentId — semua media asset + versi aktif (belum di-soft-delete) milik satu konten
mediaRouter.get("/content/:contentId", async (req, res) => {
  const assets = await db.query.mediaAssets.findMany({
    where: eq(mediaAssets.contentId, req.params.contentId),
    orderBy: [desc(mediaAssets.createdAt)],
    with: {
      versions: {
        where: isNull(mediaVersions.deletedAt),
        orderBy: [asc(mediaVersions.versionNumber)],
      },
    },
  });

  res.json(assets);
});

// POST /media/content/:contentId — upload media baru (bikin asset + versi pertama)
mediaRouter.post("/content/:contentId", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "File wajib diunggah" });
  }

  const content = await db.query.contents.findFirst({
    where: eq(contents.id, req.params.contentId),
  });
  if (!content) {
    return res.status(404).json({ message: "Konten tidak ditemukan" });
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

  const [asset] = await db
    .insert(mediaAssets)
    .values({
      contentId: req.params.contentId,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
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
    "media_submitted",
    `Media baru "${req.file.originalname}" untuk konten "${content.title}" menunggu review.`,
    content.id,
    req.user!.userId
  );

  res.status(201).json({ ...asset, versions: [version] });
});

// POST /media/:assetId/versions — upload versi baru (revisi) untuk asset yang sudah ada
mediaRouter.post("/:assetId/versions", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "File wajib diunggah" });
  }

  const asset = await db.query.mediaAssets.findFirst({
    where: eq(mediaAssets.id, req.params.assetId),
  });
  if (!asset) {
    return res.status(404).json({ message: "Media asset tidak ditemukan" });
  }

  const existingVersions = await db
    .select()
    .from(mediaVersions)
    .where(eq(mediaVersions.mediaAssetId, asset.id));

  const nextVersionNumber =
    existingVersions.length > 0
      ? Math.max(...existingVersions.map((v) => v.versionNumber)) + 1
      : 1;

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

  const [version] = await db
    .insert(mediaVersions)
    .values({
      mediaAssetId: asset.id,
      versionNumber: nextVersionNumber,
      gdriveFileId,
      status: "pending",
      uploadedBy: req.user!.userId,
    })
    .returning();

  await notifyLeadAdmins(
    "media_submitted",
    `Versi baru media "${asset.fileName}" (v${nextVersionNumber}) menunggu review.`,
    asset.contentId,
    req.user!.userId
  );

  res.status(201).json(version);
});

// GET /media/versions/:versionId/file — proxy stream file dari Google Drive ke client
// Mendukung header Range (dipakai browser mobile untuk streaming/seek video bertahap) —
// tanpa ini, video sering gagal dimuat total di HP walau lancar di desktop.
// Juga mengirim Cache-Control + ETag: file per versi bersifat permanen (versi baru = id
// baru), jadi browser boleh simpan cache-nya lama dan tidak perlu unduh ulang tiap
// pindah halaman/refresh.
mediaRouter.get("/versions/:versionId/file", async (req, res) => {
  const version = await db.query.mediaVersions.findFirst({
    where: eq(mediaVersions.id, req.params.versionId),
  });
  if (!version || version.deletedAt) {
    return res.status(404).json({ message: "File tidak ditemukan" });
  }

  // File per versi tidak pernah berubah isinya — cukup pakai id versi sebagai ETag,
  // tanpa perlu tanya Google Drive dulu kalau browser sudah punya cache yang valid.
  const etag = `"media-${version.id}"`;
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader("ETag", etag);
  if (req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }

  try {
    const range = req.headers.range; // contoh: "bytes=0-1048575"
    const { stream, mimeType, fileName, totalSize, status, contentRange, contentLength } =
      await gdrive.getFileStream(version.gdriveFileId, range);

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    res.setHeader("Accept-Ranges", "bytes");

    if (range && status === 206) {
      // Google Drive berhasil memenuhi permintaan potongan file (dipakai browser mobile
      // untuk streaming/seek video secara bertahap)
      res.status(206);
      if (contentRange) res.setHeader("Content-Range", contentRange);
      if (contentLength) res.setHeader("Content-Length", contentLength);
    } else {
      // kirim file utuh — tetap sertakan Content-Length kalau tahu ukurannya,
      // supaya browser (terutama mobile) tahu progress loading-nya
      if (totalSize) res.setHeader("Content-Length", String(totalSize));
    }

    stream.pipe(res);
  } catch (err) {
    res.status(502).json({
      message: err instanceof Error ? err.message : "Gagal mengambil file dari Google Drive",
    });
  }
});

// DELETE /media/:assetId — hapus seluruh asset (semua versi) — pembuat atau Lead/Admin
mediaRouter.delete("/:assetId", async (req, res) => {
  const asset = await db.query.mediaAssets.findFirst({
    where: eq(mediaAssets.id, req.params.assetId),
  });
  if (!asset) {
    return res.status(404).json({ message: "Media asset tidak ditemukan" });
  }

  const isOwner = asset.uploadedBy === req.user!.userId;
  if (!isOwner && req.user!.role !== "lead_admin") {
    return res.status(403).json({ message: "Tidak punya akses menghapus media ini" });
  }

  const versions = await db
    .select()
    .from(mediaVersions)
    .where(and(eq(mediaVersions.mediaAssetId, asset.id), isNull(mediaVersions.deletedAt)));

  for (const v of versions) {
    await gdrive.deleteFile(v.gdriveFileId).catch(() => {});
  }

  await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));

  res.json({ message: "Media dihapus" });
});

// ============================================================
// APPROVE VERSI — auto-hapus versi lama + notifikasi ke creator
// ============================================================

// POST /media/versions/:versionId/approve — Lead/Admin approve satu versi media
mediaRouter.post(
  "/versions/:versionId/approve",
  roleMiddleware("lead_admin"),
  async (req, res) => {
    const version = await db.query.mediaVersions.findFirst({
      where: eq(mediaVersions.id, req.params.versionId),
    });
    if (!version || version.deletedAt) {
      return res.status(404).json({ message: "Versi media tidak ditemukan" });
    }

    const asset = await db.query.mediaAssets.findFirst({
      where: eq(mediaAssets.id, version.mediaAssetId),
    });
    if (!asset) {
      return res.status(404).json({ message: "Media asset tidak ditemukan" });
    }

    // 1. update DB dulu — tandai versi ini approved
    const [updatedVersion] = await db
      .update(mediaVersions)
      .set({ status: "approved" })
      .where(eq(mediaVersions.id, version.id))
      .returning();

    // 2. cari versi lain (lama) yang masih aktif, soft-delete di DB dulu
    const oldVersions = await db
      .select()
      .from(mediaVersions)
      .where(
        and(
          eq(mediaVersions.mediaAssetId, asset.id),
          ne(mediaVersions.id, version.id),
          isNull(mediaVersions.deletedAt)
        )
      );

    for (const old of oldVersions) {
      await db
        .update(mediaVersions)
        .set({ deletedAt: new Date() })
        .where(eq(mediaVersions.id, old.id));
    }

    // 3. baru hapus file fisiknya di Google Drive (setelah DB konsisten)
    for (const old of oldVersions) {
      await gdrive.deleteFile(old.gdriveFileId).catch(() => {
        // gagal hapus fisik tidak menggagalkan approval — sudah soft-deleted di DB
      });
    }

    // 4. notifikasi ke creator (pengunggah asset)
    if (asset.uploadedBy) {
      await notifyUser(
        asset.uploadedBy,
        "media_approved",
        `Media "${asset.fileName}" (versi ${version.versionNumber}) telah disetujui.`,
        asset.contentId
      );
    }

    // 5. draft script tidak butuh approval sendiri — status konten sekarang mengikuti media:
    // begitu ada media yang disetujui, konten terkait otomatis ditandai "approved" (kalau masih draft)
    if (asset.contentId) {
      const content = await db.query.contents.findFirst({ where: eq(contents.id, asset.contentId) });
      if (content && content.status === "draft") {
        await db.update(contents).set({ status: "approved", updatedAt: new Date() }).where(eq(contents.id, asset.contentId));
      }
    }

    res.json(updatedVersion);
  }
);

// ============================================================
// KOMENTAR — pin (gambar) / timestamp (video) + thread reply
// ============================================================

// GET /media/versions/:versionId/comments
mediaRouter.get("/versions/:versionId/comments", async (req, res) => {
  const rows = await db.query.mediaComments.findMany({
    where: eq(mediaComments.mediaVersionId, req.params.versionId),
    orderBy: [asc(mediaComments.createdAt)],
    with: {
      user: { columns: { id: true, name: true } },
    },
  });

  res.json(rows);
});

// POST /media/versions/:versionId/comments — tambah komentar (pin/timestamp/reply)
mediaRouter.post("/versions/:versionId/comments", async (req, res) => {
  const { commentText, timestampSeconds, positionX, positionY, parentCommentId } =
    req.body ?? {};

  if (!commentText || !String(commentText).trim()) {
    return res.status(400).json({ message: "Teks komentar wajib diisi" });
  }

  const version = await db.query.mediaVersions.findFirst({
    where: eq(mediaVersions.id, req.params.versionId),
  });
  if (!version) {
    return res.status(404).json({ message: "Versi media tidak ditemukan" });
  }

  const [created] = await db
    .insert(mediaComments)
    .values({
      mediaVersionId: req.params.versionId,
      userId: req.user!.userId,
      commentText: String(commentText).trim(),
      timestampSeconds: timestampSeconds ?? null,
      positionX: positionX ?? null,
      positionY: positionY ?? null,
      parentCommentId: parentCommentId ?? null,
    })
    .returning();

  // notifikasi ke pengunggah media (kalau bukan dia sendiri yang komentar)
  const asset = await db.query.mediaAssets.findFirst({
    where: eq(mediaAssets.id, version.mediaAssetId),
  });
  if (asset?.uploadedBy && asset.uploadedBy !== req.user!.userId) {
    await notifyUser(
      asset.uploadedBy,
      "comment",
      `Ada komentar baru di media "${asset.fileName}": ${String(commentText).trim().slice(0, 100)}`,
      asset.contentId
    );
  }

  // kalau ini balasan, notifikasi juga ke penulis komentar yang dibalas (kalau beda orang)
  if (parentCommentId) {
    const parent = await db.query.mediaComments.findFirst({
      where: eq(mediaComments.id, parentCommentId),
    });
    if (parent && parent.userId !== req.user!.userId && parent.userId !== asset?.uploadedBy) {
      await notifyUser(
        parent.userId,
        "reply",
        `Komentar kamu di media "${asset?.fileName ?? ""}" dibalas: ${String(commentText).trim().slice(0, 100)}`,
        asset?.contentId ?? null
      );
    }
  }

  res.status(201).json(created);
});

// PATCH /media/comments/:commentId/resolve — tandai komentar selesai ditindaklanjuti
mediaRouter.patch("/comments/:commentId/resolve", async (req, res) => {
  const { isResolved } = req.body ?? {};

  const [updated] = await db
    .update(mediaComments)
    .set({ isResolved: isResolved ?? true })
    .where(eq(mediaComments.id, req.params.commentId))
    .returning();

  if (!updated) {
    return res.status(404).json({ message: "Komentar tidak ditemukan" });
  }

  res.json(updated);
});

// DELETE /media/comments/:commentId
mediaRouter.delete("/comments/:commentId", async (req, res) => {
  const deleted = await db
    .delete(mediaComments)
    .where(eq(mediaComments.id, req.params.commentId))
    .returning();

  if (deleted.length === 0) {
    return res.status(404).json({ message: "Komentar tidak ditemukan" });
  }

  res.json({ message: "Komentar dihapus" });
});