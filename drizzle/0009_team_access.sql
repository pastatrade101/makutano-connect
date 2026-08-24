CREATE TYPE "public"."conversation_visibility" AS ENUM('TEAM', 'ASSIGNED', 'PRIVATE');--> statement-breakpoint
ALTER TYPE "public"."verification_purpose" ADD VALUE 'TEAM_INVITE';--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "visibility" "conversation_visibility" DEFAULT 'TEAM' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "assigned_to_user_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "shared_with_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "permission_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;