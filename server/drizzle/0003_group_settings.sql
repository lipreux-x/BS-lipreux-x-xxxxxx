ALTER TABLE "groups" ADD COLUMN "rotation_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "code_version" integer DEFAULT 1 NOT NULL;