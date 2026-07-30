/**
 * Jalankan sekali di awal (atau kalau refresh token expired):
 *   npm run google:auth
 *
 * Script ini akan:
 * 1. Cetak URL login Google
 * 2. Kamu buka URL itu, login pakai akun Google yang mau dipakai nyimpen file
 * 3. Setelah approve, otomatis dapat refresh token
 * 4. Tinggal copy refresh token itu ke .env sebagai GOOGLE_OAUTH_REFRESH_TOKEN
 */
import "dotenv/config";
import { google } from "googleapis";
import http from "http";

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const PORT = 4321;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "\nIsi dulu GOOGLE_OAUTH_CLIENT_ID dan GOOGLE_OAUTH_CLIENT_SECRET di .env sebelum jalankan script ini.\n"
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/drive"],
});

console.log("\n=========================================================");
console.log("Buka URL ini di browser, login dengan akun Google yang");
console.log("mau dipakai untuk menyimpan media (poster/video):\n");
console.log(authUrl);
console.log("=========================================================\n");
console.log("Menunggu kamu login & klik Allow...\n");

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.end("Menunggu callback...");
    return;
  }

  const fullUrl = new URL(req.url, REDIRECT_URI);
  const code = fullUrl.searchParams.get("code");
  const errorParam = fullUrl.searchParams.get("error");

  if (errorParam) {
    res.end(`Login dibatalkan/gagal: ${errorParam}. Coba jalankan ulang scriptnya.`);
    console.error(`\nLogin gagal: ${errorParam}\n`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.end("Tidak ada code di callback. Coba jalankan ulang scriptnya.");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.end("Berhasil! Kamu boleh tutup tab ini dan kembali ke terminal.");

    if (!tokens.refresh_token) {
      console.log(
        "\n⚠️  Tidak dapat refresh_token. Ini biasanya karena akun ini sudah pernah authorize app ini sebelumnya."
      );
      console.log(
        "Solusi: buka https://myaccount.google.com/permissions, cabut akses app ini, lalu jalankan ulang npm run google:auth.\n"
      );
    } else {
      console.log("\n=== BERHASIL ===");
      console.log("Tambahkan/timpa baris ini di .env:\n");
      console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    }

    server.close();
    process.exit(0);
  } catch (err) {
    res.end("Gagal menukar code jadi token, cek terminal.");
    console.error(err);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT);