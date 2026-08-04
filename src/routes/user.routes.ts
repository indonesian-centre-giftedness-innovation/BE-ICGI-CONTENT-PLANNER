import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { db } from "../db/index.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { roleMiddleware } from "../middleware/roleMiddleware.js";
import { hashPassword } from "../services/auth.service.js";

export const userRouter = Router();

userRouter.use(authMiddleware);

// GET /users — daftar user ringkas (untuk dropdown assign to-do, dll) — semua role boleh
userRouter.get("/", async (_req, res) => {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(eq(users.isActive, true));

  res.json(rows);
});

// GET /users/admin — daftar lengkap (email, status aktif, dll), khusus Lead/Admin
userRouter.get("/admin", roleMiddleware("lead_admin"), async (_req, res) => {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  res.json(rows);
});

// POST /users — buat akun baru (Lead/Admin atau Creator/Staff), khusus Lead/Admin
userRouter.post("/", roleMiddleware("lead_admin"), async (req, res) => {
  const { name, email, password, role } = req.body ?? {};

  if (!name?.trim() || !email?.trim() || !password || !role) {
    return res.status(400).json({ message: "Nama, email, password, dan role wajib diisi" });
  }

  if (!["lead_admin", "creator_staff"].includes(role)) {
    return res.status(400).json({ message: "Role tidak valid" });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ message: "Password minimal 6 karakter" });
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, String(email).trim().toLowerCase()),
  });
  if (existing) {
    return res.status(409).json({ message: "Email ini sudah terdaftar" });
  }

  const passwordHash = await hashPassword(password);

  const [created] = await db
    .insert(users)
    .values({
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      passwordHash,
      role,
    })
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    });

  res.status(201).json(created);
});

// PATCH /users/:id — edit nama/role/status aktif/reset password, khusus Lead/Admin
userRouter.patch("/:id", roleMiddleware("lead_admin"), async (req, res) => {
  const { name, role, isActive, password } = req.body ?? {};

  // safety: Lead/Admin tidak boleh nonaktifkan atau demote akun sendiri (hindari lockout)
  if (req.params.id === req.user!.userId) {
    if (isActive === false) {
      return res.status(400).json({ message: "Tidak bisa menonaktifkan akun sendiri" });
    }
    if (role && role !== "lead_admin") {
      return res.status(400).json({ message: "Tidak bisa menurunkan role akun sendiri" });
    }
  }

  if (role && !["lead_admin", "creator_staff"].includes(role)) {
    return res.status(400).json({ message: "Role tidak valid" });
  }

  const updateValues: Record<string, unknown> = {};
  if (name !== undefined) updateValues.name = String(name).trim();
  if (role !== undefined) updateValues.role = role;
  if (isActive !== undefined) updateValues.isActive = isActive;
  if (password) {
    if (String(password).length < 6) {
      return res.status(400).json({ message: "Password minimal 6 karakter" });
    }
    updateValues.passwordHash = await hashPassword(password);
  }

  const [updated] = await db
    .update(users)
    .set(updateValues)
    .where(eq(users.id, req.params.id))
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    });

  if (!updated) {
    return res.status(404).json({ message: "User tidak ditemukan" });
  }

  res.json(updated);
});

// DELETE /users/:id — hapus akun permanen, khusus Lead/Admin
userRouter.delete("/:id", roleMiddleware("lead_admin"), async (req, res) => {
  if (req.params.id === req.user!.userId) {
    return res.status(400).json({ message: "Tidak bisa menghapus akun sendiri" });
  }

  try {
    const [deleted] = await db
      .delete(users)
      .where(eq(users.id, req.params.id))
      .returning({ id: users.id });

    if (!deleted) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    res.json({ message: "User berhasil dihapus permanen" });
  } catch (err: any) {
    // FK constraint — user ini masih tercatat sebagai pembuat/pengunggah sesuatu
    if (err?.code === "23503") {
      return res.status(409).json({
        message:
          "User ini masih memiliki draft, media, atau riwayat lain yang terhubung — tidak bisa dihapus permanen. Nonaktifkan saja akunnya.",
      });
    }
    throw err;
  }
});