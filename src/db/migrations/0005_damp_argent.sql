ALTER TABLE "storyboard_scenes" ADD COLUMN "sketch_label" varchar(255);--> statement-breakpoint
ALTER TABLE "storyboard_scenes" ADD COLUMN "dialogue" text;--> statement-breakpoint
ALTER TABLE "contents" DROP COLUMN IF EXISTS "funnel";