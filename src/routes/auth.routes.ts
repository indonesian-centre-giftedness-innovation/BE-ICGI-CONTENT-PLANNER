import { Router } from "express";
import {
  findUserByEmail,
  verifyPassword,
  signToken,
} from "../services/auth.service.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

export const authRouter = Router();

const isProd = process.env.NODE_ENV === "production";

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

  res.cookie("token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
  });
  res.json({ message: "Berhasil logout" });
});

authRouter.get("/me", authMiddleware, (req, res) => {
  res.json({ userId: req.user!.userId, role: req.user!.role });
});