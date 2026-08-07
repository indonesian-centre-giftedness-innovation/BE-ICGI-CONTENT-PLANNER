import { Router } from "express";
import {
  findUserByEmail,
  verifyPassword,
  signToken,
} from "../services/auth.service.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ message: "Email dan password wajib diisi" });
  }

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ message: "Email atau password salah" });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ message: "Email atau password salah" });
  }

  if (!user.isActive) {
    return res.status(403).json({ message: "Akun ini sudah dinonaktifkan. Hubungi Lead/Admin." });
  }

  const token = signToken({ userId: user.id, role: user.role });

  // Token dikirim langsung di body JSON (bukan Set-Cookie) — frontend simpan
  // di localStorage dan kirim balik lewat header Authorization: Bearer.
  // Ini menghindari masalah cookie lintas-domain yang sering diblokir Safari/iOS.
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    token,
  });
});

authRouter.post("/logout", (_req, res) => {
  // Tidak ada cookie yang perlu dihapus di server — logout sepenuhnya
  // ditangani di sisi client dengan menghapus token dari localStorage.
  res.json({ message: "Berhasil logout" });
});

authRouter.get("/me", authMiddleware, (req, res) => {
  res.json({ userId: req.user!.userId, role: req.user!.role });
});