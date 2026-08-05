ALTER TABLE "contents" ADD COLUMN "pillars" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "contents" DROP COLUMN IF EXISTS "pillar";