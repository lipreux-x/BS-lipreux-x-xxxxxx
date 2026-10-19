CREATE TABLE "login_attempts" (
	"username" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "backup_params" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "backup_auth" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "backup_box" text;--> statement-breakpoint
CREATE INDEX "login_attempts_user_time_idx" ON "login_attempts" USING btree ("username","attempted_at");