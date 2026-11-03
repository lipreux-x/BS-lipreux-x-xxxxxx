CREATE TABLE "group_links" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"created_by" uuid,
	"used_by" uuid,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_links" ADD CONSTRAINT "group_links_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_links" ADD CONSTRAINT "group_links_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_links" ADD CONSTRAINT "group_links_used_by_profiles_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_links_group_idx" ON "group_links" USING btree ("group_id");