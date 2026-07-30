import type { Request, Response, NextFunction } from "express";

/**
 * Pakai setelah authMiddleware.
 * Contoh: router.patch("/:id", authMiddleware, roleMiddleware("lead_admin"), handler)
 */
export function roleMiddleware(...allowedRoles: Array<"lead_admin" | "creator_staff">) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Belum login" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Tidak memiliki akses untuk aksi ini" });
    }

    next();
  };
}
