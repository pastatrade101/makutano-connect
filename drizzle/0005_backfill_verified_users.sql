-- Every user that existed before self-signup was introduced was created by a Platform
-- Admin or a legacy import, and their address was already trusted. Marking them
-- verified keeps the existing tenants (Goldfinch, Emnel, Makutano Digital) working
-- exactly as before and stops the admin list showing them as "unverified".
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;
--> statement-breakpoint
-- Tenants that predate self-signup were provisioned by hand or by the import script.
UPDATE "tenants" SET "provisioning_source" = 'ADMIN' WHERE "provisioning_source" IS NULL;
