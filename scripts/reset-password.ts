/**
 * Reset password user manapun secara langsung.
 * Pakai kalau lupa/tidak yakin password akun Lead/Admin.
 *
 * Cara pakai:
 *   npm run reset-password -- admin@icgi.id passwordBaru123
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { users } from "../src/db/schema.js";
import { hashPassword } from "../src/services/auth.service.js";

const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error("\nPakai: npm run reset-password -- email@contoh.com passwordBaru\n");
  process.exit(1);
}

async function run() {
  const passwordHash = await hashPassword(newPassword);

  const [updated] = await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.email, email))
    .returning();

  if (!updated) {
    console.error(`\nUser dengan email "${email}" tidak ditemukan di database.\n`);
    process.exit(1);
  }

  console.log(`\nBerhasil! Password untuk ${email} sudah direset.`);
  console.log(`Login pakai:`);
  console.log(`  Email    : ${email}`);
  console.log(`  Password : ${newPassword}\n`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Gagal reset password:", err);
  process.exit(1);
});