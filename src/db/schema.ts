import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  pgEnum,
  real,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ============================================================
// ENUMS
// ============================================================

export const userRoleEnum = pgEnum("user_role", [
  "lead_admin",
  "creator_staff",
]);

export const contentStatusEnum = pgEnum("content_status", [
  "draft",
  "pending_review",
  "revisi",
  "approved",
  "published",
]);

export const contentPillarEnum = pgEnum("content_pillar", [
  "edukasi",
  "hiburan",
  "promosi",
]);


export const aiModelEnum = pgEnum("ai_model", ["gpt", "gemini"]);

export const mediaVersionStatusEnum = pgEnum("media_version_status", [
  "pending",
  "approved",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "approved",
  "revisi",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "approval",
  "revisi",
  "comment",
  "reply",
  "media_approved",
  "submitted",
  "published",
]);

// ============================================================
// USERS
// ============================================================

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: userRoleEnum("role").notNull().default("creator_staff"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// PROMPT TEMPLATES (brand voice)
// ============================================================

export const promptTemplates = pgTable("prompt_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  templateText: text("template_text").notNull(),
  brandVoiceNotes: text("brand_voice_notes"),
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// CONTENTS (inti)
// ============================================================

export const contents = pgTable("contents", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  bodyDraft: text("body_draft"),
  bodyAiGenerated: text("body_ai_generated"),
  status: contentStatusEnum("status").default("draft").notNull(),
  requiresApproval: boolean("requires_approval").default(true).notNull(),
  platforms: text("platforms").array().$type<string[]>().default(sql`'{}'::text[]`).notNull(), // instagram, website, newsletter, dll — bisa lebih dari satu
  pillar: contentPillarEnum("pillar"), // edukasi / hiburan / promosi — cuma satu
  createdBy: uuid("created_by")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============================================================
// AI GENERATION LOGS
// ============================================================

export const contentAiLogs = pgTable("content_ai_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  contentId: uuid("content_id")
    .references(() => contents.id, { onDelete: "cascade" })
    .notNull(),
  promptTemplateId: uuid("prompt_template_id").references(
    () => promptTemplates.id
  ),
  promptUsed: text("prompt_used").notNull(),
  aiResponse: text("ai_response").notNull(),
  model: aiModelEnum("model").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// STORYBOARD
// ============================================================

export const storyboards = pgTable("storyboards", {
  id: uuid("id").defaultRandom().primaryKey(),
  contentId: uuid("content_id").references(() => contents.id, {
    onDelete: "cascade",
  }),
  title: varchar("title", { length: 255 }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const storyboardScenes = pgTable("storyboard_scenes", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyboardId: uuid("storyboard_id")
    .references(() => storyboards.id, { onDelete: "cascade" })
    .notNull(),
  sceneOrder: integer("scene_order").notNull(),
  sketchImageGdriveId: varchar("sketch_image_gdrive_id", { length: 255 }),
  sketchLabel: varchar("sketch_label", { length: 255 }), // nama/angle shoot dari template yang dipakai
  description: text("description"),
  dialogue: text("dialogue"), // dialog/sound notes, sesuai kolom di export PDF
  durationSeconds: real("duration_seconds").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Library sketsa siap pakai (angle shot dsb) — diupload sekali, dipakai berulang
// lewat drag & drop ke scene manapun, tidak terikat ke satu storyboard.
export const storyboardSketchTemplates = pgTable("storyboard_sketch_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(), // misal: "Close-up", "Wide Shot"
  gdriveFileId: varchar("gdrive_file_id", { length: 255 }).notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// CALENDAR
// ============================================================

export const calendarItems = pgTable("calendar_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  contentId: uuid("content_id")
    .references(() => contents.id, { onDelete: "cascade" })
    .notNull(),
  scheduledDate: timestamp("scheduled_date").notNull(),
  platform: varchar("platform", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// TODOS
// ============================================================

export const todos = pgTable("todos", {
  id: uuid("id").defaultRandom().primaryKey(),
  contentId: uuid("content_id").references(() => contents.id, {
    onDelete: "cascade",
  }),
  taskText: varchar("task_text", { length: 500 }).notNull(),
  isDone: boolean("is_done").default(false).notNull(),
  assignedTo: uuid("assigned_to").references(() => users.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// MEDIA — versi aktif per konten (auto-replace saat approve)
// ============================================================

export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  contentId: uuid("content_id").references(() => contents.id, {
    onDelete: "cascade",
  }),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// setiap upload ulang bikin versi baru; versi lama dihapus otomatis
// begitu versi baru ini di-approve (lihat approval service)
export const mediaVersions = pgTable("media_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  mediaAssetId: uuid("media_asset_id")
    .references(() => mediaAssets.id, { onDelete: "cascade" })
    .notNull(),
  versionNumber: integer("version_number").notNull(),
  gdriveFileId: varchar("gdrive_file_id", { length: 255 }).notNull(),
  status: mediaVersionStatusEnum("status").default("pending").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"), // soft delete jejak versi lama
});

// komentar berbasis pin (gambar) atau timestamp (video)
export const mediaComments = pgTable("media_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  mediaVersionId: uuid("media_version_id")
    .references(() => mediaVersions.id, { onDelete: "cascade" })
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  commentText: text("comment_text").notNull(),
  timestampSeconds: real("timestamp_seconds"), // untuk video, nullable
  positionX: real("position_x"), // 0-100%, untuk pin di gambar
  positionY: real("position_y"), // 0-100%, untuk pin di gambar
  isResolved: boolean("is_resolved").default(false).notNull(),
  parentCommentId: uuid("parent_comment_id"), // untuk thread reply
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// APPROVAL (untuk konten teks/keseluruhan)
// ============================================================

export const approvals = pgTable("approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  contentId: uuid("content_id")
    .references(() => contents.id, { onDelete: "cascade" })
    .notNull(),
  reviewerId: uuid("reviewer_id")
    .references(() => users.id)
    .notNull(),
  status: approvalStatusEnum("status").notNull(),
  notes: text("notes"),
  reviewedAt: timestamp("reviewed_at").defaultNow().notNull(),
});

// ============================================================
// NOTIFICATIONS
// ============================================================

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  type: notificationTypeEnum("type").notNull(),
  contentId: uuid("content_id").references(() => contents.id, {
    onDelete: "cascade",
  }),
  message: varchar("message", { length: 500 }).notNull(),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================
// RELATIONS
// ============================================================

export const usersRelations = relations(users, ({ many }) => ({
  contents: many(contents),
  approvals: many(approvals),
  notifications: many(notifications),
}));

export const contentsRelations = relations(contents, ({ one, many }) => ({
  author: one(users, {
    fields: [contents.createdBy],
    references: [users.id],
  }),
  aiLogs: many(contentAiLogs),
  storyboard: one(storyboards),
  calendarItems: many(calendarItems),
  todos: many(todos),
  mediaAssets: many(mediaAssets),
  approvals: many(approvals),
}));

export const storyboardsRelations = relations(
  storyboards,
  ({ one, many }) => ({
    content: one(contents, {
      fields: [storyboards.contentId],
      references: [contents.id],
    }),
    scenes: many(storyboardScenes),
  })
);

export const storyboardScenesRelations = relations(
  storyboardScenes,
  ({ one }) => ({
    storyboard: one(storyboards, {
      fields: [storyboardScenes.storyboardId],
      references: [storyboards.id],
    }),
  })
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  content: one(contents, {
    fields: [notifications.contentId],
    references: [contents.id],
  }),
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const calendarItemsRelations = relations(calendarItems, ({ one }) => ({
  content: one(contents, {
    fields: [calendarItems.contentId],
    references: [contents.id],
  }),
}));

export const todosRelations = relations(todos, ({ one }) => ({
  content: one(contents, {
    fields: [todos.contentId],
    references: [contents.id],
  }),
  assignee: one(users, {
    fields: [todos.assignedTo],
    references: [users.id],
    relationName: "todo_assignee",
  }),
  creator: one(users, {
    fields: [todos.createdBy],
    references: [users.id],
    relationName: "todo_creator",
  }),
}));

export const mediaAssetsRelations = relations(
  mediaAssets,
  ({ one, many }) => ({
    content: one(contents, {
      fields: [mediaAssets.contentId],
      references: [contents.id],
    }),
    versions: many(mediaVersions),
  })
);

export const mediaVersionsRelations = relations(
  mediaVersions,
  ({ one, many }) => ({
    mediaAsset: one(mediaAssets, {
      fields: [mediaVersions.mediaAssetId],
      references: [mediaAssets.id],
    }),
    comments: many(mediaComments),
  })
);

export const mediaCommentsRelations = relations(mediaComments, ({ one }) => ({
  mediaVersion: one(mediaVersions, {
    fields: [mediaComments.mediaVersionId],
    references: [mediaVersions.id],
  }),
  user: one(users, {
    fields: [mediaComments.userId],
    references: [users.id],
  }),
}));

export const approvalsRelations = relations(approvals, ({ one }) => ({
  content: one(contents, {
    fields: [approvals.contentId],
    references: [contents.id],
  }),
  reviewer: one(users, {
    fields: [approvals.reviewerId],
    references: [users.id],
  }),
}));