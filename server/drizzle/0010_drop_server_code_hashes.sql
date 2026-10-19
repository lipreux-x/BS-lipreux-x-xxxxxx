ALTER TABLE "groups" DROP CONSTRAINT "groups_code_lookup_unique";--> statement-breakpoint
ALTER TABLE "groups" DROP COLUMN "code_hash";--> statement-breakpoint
ALTER TABLE "groups" DROP COLUMN "code_lookup";--> statement-breakpoint
ALTER TABLE "groups" DROP COLUMN "keywords_hash";