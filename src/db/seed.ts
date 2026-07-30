import "dotenv/config";
import { db } from "./index.js";
import { users } from "./schema.js";
import { hashPassword } from "../services/auth.service.js";
import { eq } from "drizzle-orm";

// Ganti data ini sesuai kebutuhan sebelum menjalankan seed
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@icgi.id";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "admin123";
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || "Admin ICGI";

async function seed() {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL))
    .limit(1);

  if (existing.length > 0) {
    console.log(`User dengan email ${ADMIN_EMAIL} sudah ada, seed dilewati.`);
    process.exit(0);
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  await db.insert(users).values({
    email: ADMIN_EMAIL,
    passwordHash,
    name: ADMIN_NAME,
    role: "lead_admin",
  });

  console.log("Akun Lead/Admin berhasil dibuat:");
  console.log(`  Email    : ${ADMIN_EMAIL}`);
  console.log(`  Password : ${ADMIN_PASSWORD}`);
  console.log("Segera login dan ganti password lewat aplikasi setelah fitur update profil tersedia.");

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed gagal:", err);
  process.exit(1);
});