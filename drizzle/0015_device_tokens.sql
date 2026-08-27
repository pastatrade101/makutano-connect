-- Push targets for the mobile app. One row per device per user; Firebase reports
-- dead tokens on send, which is when they are pruned.
CREATE TABLE IF NOT EXISTS "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"tenant_id" uuid REFERENCES "tenants"("id") ON DELETE cascade,
	"token" text NOT NULL UNIQUE,
	"platform" text DEFAULT 'android' NOT NULL,
	"device_name" text,
	"last_seen_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_tokens_user_idx" ON "device_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_tokens_tenant_idx" ON "device_tokens" USING btree ("tenant_id");
