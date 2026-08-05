import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { notifications, users } from "../db/schema.js";

type NotificationType = "approval" | "revisi" | "comment" | "reply" | "media_approved" | "submitted" | "published";

export async function notifyUser(userId: string, type: NotificationType, message: string, contentId?: string | null) {
  await db.insert(notifications).values({
    userId,
    type,
    contentId: contentId ?? null,
    message,
  });
}

/** Kirim notifikasi ke semua user dengan role lead_admin — dipakai untuk hal-hal yang perlu diketahui reviewer (submit baru, media baru, dsb). */
export async function notifyLeadAdmins(
  type: NotificationType,
  message: string,
  contentId?: string | null,
  excludeUserId?: string
) {
  const leads = await db.query.users.findMany({
    where: eq(users.role, "lead_admin"),
    columns: { id: true },
  });
  const targets = leads.filter((l) => l.id !== excludeUserId);
  if (targets.length === 0) return;
  await db.insert(notifications).values(
    targets.map((l) => ({
      userId: l.id,
      type,
      contentId: contentId ?? null,
      message,
    }))
  );
}