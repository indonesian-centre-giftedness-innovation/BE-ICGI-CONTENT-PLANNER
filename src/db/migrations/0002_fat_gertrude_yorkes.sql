DO $$ BEGIN
 CREATE TYPE "public"."content_funnel" AS ENUM('tofu', 'mofu', 'bofu');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."content_pillar" AS ENUM('edukasi', 'hiburan', 'promosi');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "pillar" "content_pillar";--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "funnel" "content_funnel";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;