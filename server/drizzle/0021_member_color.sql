ALTER TABLE "group_members" ADD COLUMN "color" text;--> statement-breakpoint
-- The color chosen for every group until now (profiles.color) becomes each group's: nothing changes on screen.
UPDATE "group_members" SET "color" = "profiles"."color" FROM "profiles" WHERE "profiles"."id" = "group_members"."user_id" AND "profiles"."color" IS NOT NULL;
