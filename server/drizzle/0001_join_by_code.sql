ALTER TABLE "join_attempts" ALTER COLUMN "group_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "code_lookup" text;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_code_lookup_unique" UNIQUE("code_lookup");