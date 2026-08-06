/**
 * Pakai Gemini (gratis untuk model Flash/Flash-Lite, cukup untuk kebutuhan internal).
 * Panggil langsung via REST fetch (Node 18+ punya fetch bawaan) — tidak perlu SDK tambahan.
 *
 * Catatan penting: Google sering pensiunkan/ganti model generasi lama ke user baru.
 * gemini-2.0-flash (mati per 1 Jun 2026) dan gemini-2.5-flash (sudah tidak terima user baru)
 * sama-sama sudah tidak bisa dipakai per Juli 2026. Model stabil terbaru: gemini-3.6-flash
 * (rilis 21 Jul 2026, masih free tier). Kalau nanti berubah lagi, cukup override lewat
 * env var GEMINI_MODEL tanpa perlu ubah kode — cek https://ai.google.dev/gemini-api/docs/models
 * untuk model aktif terbaru.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

export type ReferenceFile = {
  base64: string;
  mimeType: string;
};

/**
 * Generate teks. Bisa dikasih file referensi (gambar) opsional supaya AI "lihat"
 * konteksnya — misal generate caption berdasarkan foto produk.
 * Referensi video diterima tapi cuma disebut namanya di prompt (belum dianalisis
 * penuh isi videonya — itu butuh Gemini File API yang lebih kompleks).
 */
export async function generateWithGemini(
  prompt: string,
  referenceFile?: ReferenceFile | null
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY belum diset di .env");
  }

  const parts: any[] = [{ text: prompt }];
  if (referenceFile && referenceFile.mimeType.startsWith("image/")) {
    parts.push({
      inline_data: { mime_type: referenceFile.mimeType, data: referenceFile.base64 },
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data: any = await res.json();

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p: any) => p.text || "")
    .join("")
    .trim();

  if (!text) {
    const blockReason = data?.promptFeedback?.blockReason;
    throw new Error(
      blockReason
        ? `Gemini menolak generate (alasan: ${blockReason}). Coba ubah instruksi.`
        : "Gemini tidak mengembalikan teks. Coba lagi."
    );
  }

  return text;
}