ALTER TABLE "messages" ADD COLUMN "quiet" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "awake_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN "platform" text;