CREATE TYPE "public"."provisioning_source" AS ENUM('ADMIN', 'SELF_SERVICE', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."verification_purpose" AS ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET');--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'EXPIRED';--> statement-breakpoint
ALTER TYPE "public"."tenant_status" ADD VALUE 'PENDING';--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "verification_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "business_phone" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "provisioning_source" "provisioning_source" DEFAULT 'ADMIN' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tokens_hash_key" ON "verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "verification_tokens_user_idx" ON "verification_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "verification_tokens_expiry_idx" ON "verification_tokens" USING btree ("expires_at");