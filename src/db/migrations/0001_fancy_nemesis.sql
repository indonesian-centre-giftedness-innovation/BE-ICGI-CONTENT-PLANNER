ALTER TABLE "media_assets" ALTER COLUMN "content_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "storyboards" ALTER COLUMN "content_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "todos" ALTER COLUMN "content_id" DROP NOT NULL;