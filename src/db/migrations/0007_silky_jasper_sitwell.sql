ALTER TABLE "contents" ADD COLUMN "platforms" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "pillar" "content_pillar";--> statement-breakpoint
ALTER TABLE "contents" DROP COLUMN IF EXISTS "platform";--> statement-breakpoint
ALTER TABLE "contents" DROP COLUMN IF EXISTS "pillars";