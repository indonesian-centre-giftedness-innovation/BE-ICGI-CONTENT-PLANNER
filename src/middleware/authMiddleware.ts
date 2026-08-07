import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { verifyToken, type AuthTokenPayload } from "../services/auth.service.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  // Tag <video>/<img>/<a download> tidak bisa menyisipkan header custom saat
  // browser me-load src/href-nya langsung — jadi untuk endpoint yang disajikan
  // lewat src/href (misal file media), token boleh dikirim lewat query param
  // ?token=... sebagai alternatif dari header Authorization.
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;

  const token = headerToken || queryToken;

  if (!token) {
    return res.status(401).json({ message: "Belum login" });
  }

  let payload: AuthTokenPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ message: "Sesi tidak valid, silakan login ulang" });
  }

  // Cek ke DB tiap request (bukan cuma percaya isi token) — supaya kalau akun
  // dinonaktifkan atau role-nya diubah Lead/Admin, efeknya langsung berlaku
  // tanpa nunggu token lama expired.
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId),
      columns: { id: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Akun tidak aktif atau tidak ditemukan, hubungi Lead/Admin" });
    }

    req.user = { userId: user.id, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}