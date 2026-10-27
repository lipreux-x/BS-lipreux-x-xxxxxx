ALTER TABLE "groups" ALTER COLUMN "join_lookup" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "kind" text DEFAULT 'group' NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "direct_pair" text;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_direct_pair_unique" UNIQUE("direct_pair");