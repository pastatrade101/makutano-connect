-- Meta's deauthorize callback identifies the person who removed the app, and
-- nothing else: the signed_request payload carries a Facebook user id, not a WABA
-- or a phone number. Without somewhere to put that id at connect time, the
-- callback arrives and there is no way to say which connection it killed.
ALTER TABLE "whatsapp_connections" ADD COLUMN IF NOT EXISTS "meta_user_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_connections_meta_user_idx"
	ON "whatsapp_connections" USING btree ("meta_user_id")
	WHERE "meta_user_id" IS NOT NULL;
