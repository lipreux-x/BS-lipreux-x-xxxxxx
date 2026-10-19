-- Protocol v2 (signed key handouts, admin approval, join key derived on the
-- phone): data from v1 cannot be carried over, every account starts again.
TRUNCATE "profiles", "invites", "groups", "group_members", "group_keys", "messages", "attachments", "group_purges", "join_attempts", "login_attempts" CASCADE;--> statement-breakpoint
CREATE TABLE "group_bans" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_bans_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "used_challenges" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_actions" (
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_message_id_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "group_keys" ADD COLUMN "signer_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "group_keys" ADD COLUMN "signature" text NOT NULL;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "meta_signer_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "meta_signature" text NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "join_lookup" text NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "failed_uses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "group_bans" ADD CONSTRAINT "group_bans_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_bans" ADD CONSTRAINT "group_bans_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_actions" ADD CONSTRAINT "user_actions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_actions_user_time_idx" ON "user_actions" USING btree ("user_id","action","at");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "join_attempts_group_time_idx" ON "join_attempts" USING btree ("group_id","attempted_at");--> statement-breakpoint
CREATE INDEX "login_attempts_time_idx" ON "login_attempts" USING btree ("attempted_at");--> statement-breakpoint
CREATE INDEX "messages_sender_time_idx" ON "messages" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_username_lower_idx" ON "profiles" USING btree (lower("username"));--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_join_lookup_unique" UNIQUE("join_lookup");