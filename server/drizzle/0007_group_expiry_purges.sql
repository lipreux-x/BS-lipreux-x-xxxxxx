CREATE TABLE "group_purges" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_purges" ADD CONSTRAINT "group_purges_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_purges_group_idx" ON "group_purges" USING btree ("group_id","seq");--> statement-breakpoint
CREATE INDEX "groups_expires_idx" ON "groups" USING btree ("expires_at") WHERE "groups"."expires_at" is not null;