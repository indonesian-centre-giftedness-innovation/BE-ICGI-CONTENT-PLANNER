import { google } from "googleapis";
import { Readable } from "stream";

/**
 * Auth pakai OAuth2 (akun Google biasa), BUKAN Service Account.
 * Alasan: Service Account tidak punya kuota penyimpanan sendiri di Drive
 * (Google mencabut ini sejak 2021), dan Shared Drive cuma tersedia di
 * Google Workspace berbayar. Jadi file numpang di kuota akun Google biasa
 * yang login lewat `npm run google:auth` sekali di awal.
 */
function getAuth() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Kredensial Google OAuth belum lengkap. Isi GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN di .env (jalankan `npm run google:auth` kalau belum punya refresh token)."
    );
  }

  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function getDriveClient() {
  return google.drive({ version: "v3", auth: getAuth() });
}

const ROOT_FOLDER_ID = () => {
  const id = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!id) {
    throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID belum diset di .env");
  }
  return id;
};

// cache folder id per nama biar tidak query Drive berulang-ulang tiap upload
const folderCache = new Map<string, string>();

/**
 * Cari subfolder dengan nama tertentu di dalam root folder — kalau belum ada, buat baru.
 * Dipakai buat mengategorikan file (misal semua "Sketch Templates" masuk satu folder),
 * biar rapi di Drive-nya, bukan numpuk flat semua di root.
 */
export async function getOrCreateFolder(name: string): Promise<string> {
  if (folderCache.has(name)) {
    return folderCache.get(name)!;
  }

  const drive = getDriveClient();
  const parentId = ROOT_FOLDER_ID();

  const existing = await drive.files.list({
    q: `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`,
    fields: "files(id, name)",
    spaces: "drive",
  });

  const found = existing.data.files?.[0]?.id;
  if (found) {
    folderCache.set(name, found);
    return found;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });

  if (!created.data.id) {
    throw new Error(`Gagal membuat folder "${name}" di Google Drive`);
  }

  folderCache.set(name, created.data.id);
  return created.data.id;
}

/**
 * Upload buffer file ke folder root Drive (atau folderId tertentu kalau dikasih —
 * pakai getOrCreateFolder() dulu buat dapat id folder kategorinya).
 */
export async function uploadFile(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  folderId?: string
): Promise<string> {
  const drive = getDriveClient();

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId || ROOT_FOLDER_ID()],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: "id",
  });

  if (!res.data.id) {
    throw new Error("Upload ke Google Drive gagal, tidak dapat file id");
  }

  return res.data.id;
}

/** Hapus file permanen dari Google Drive. */
export async function deleteFile(fileId: string): Promise<void> {
  const drive = getDriveClient();
  try {
    await drive.files.delete({ fileId });
  } catch (err: any) {
    // kalau filenya sudah tidak ada (404), anggap sukses — tidak perlu gagal total
    if (err?.code !== 404) {
      throw err;
    }
  }
}

/**
 * Ambil file dari Drive sebagai stream, untuk di-proxy ke client lewat backend
 * (supaya file tidak perlu di-set public permission).
 */
export async function getFileStream(fileId: string) {
  const drive = getDriveClient();

  const metaRes = await drive.files.get({
    fileId,
    fields: "name, mimeType, size",
  });

  const streamRes = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  return {
    stream: streamRes.data as unknown as NodeJS.ReadableStream,
    mimeType: metaRes.data.mimeType || "application/octet-stream",
    fileName: metaRes.data.name || "file",
  };
}
/** Ambil isi file dari Drive langsung sebagai Buffer (dipakai buat embed gambar ke PDF). */
export async function getFileBuffer(fileId: string): Promise<Buffer> {
  const { stream } = await getFileStream(fileId);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}