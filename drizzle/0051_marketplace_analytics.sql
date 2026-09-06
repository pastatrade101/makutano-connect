CREATE TYPE "public"."marketplace_response_channel" AS ENUM('WHATSAPP', 'QUOTATION', 'STATUS');
CREATE TYPE "public"."marketplace_view_type" AS ENUM('TOUR', 'PROFILE');

ALTER TABLE "booking_requests"
	ADD COLUMN "first_responded_at" timestamp with time zone,
	ADD COLUMN "first_response_channel" "marketplace_response_channel";

CREATE TABLE "marketplace_page_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "marketplace_view_type" NOT NULL,
	"tour_id" uuid,
	"session_hash" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_page_views_shape_check" CHECK (
		("type" = 'TOUR' AND "tour_id" IS NOT NULL)
		OR ("type" = 'PROFILE' AND "tour_id" IS NULL)
	)
);

ALTER TABLE "marketplace_page_views"
	ADD CONSTRAINT "marketplace_page_views_tenant_id_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "marketplace_page_views"
	ADD CONSTRAINT "marketplace_page_views_tour_id_tours_id_fk"
	FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "marketplace_page_views_tenant_type_idx"
	ON "marketplace_page_views" USING btree ("tenant_id", "type", "created_at");
CREATE INDEX "marketplace_page_views_tour_idx"
	ON "marketplace_page_views" USING btree ("tour_id", "created_at");
CREATE UNIQUE INDEX "marketplace_page_views_tour_dedupe_idx"
	ON "marketplace_page_views" USING btree ("tour_id", "session_hash", "bucket_start")
	WHERE "type" = 'TOUR' AND "tour_id" IS NOT NULL;
CREATE UNIQUE INDEX "marketplace_page_views_profile_dedupe_idx"
	ON "marketplace_page_views" USING btree ("tenant_id", "session_hash", "bucket_start")
	WHERE "type" = 'PROFILE';

CREATE INDEX "booking_requests_marketplace_analytics_idx"
	ON "booking_requests" USING btree ("tenant_id", "created_at", "first_responded_at")
	WHERE "source" = 'MARKETPLACE' AND "deleted_at" IS NULL;
CREATE INDEX "bookings_booking_request_idx"
	ON "bookings" USING btree ("tenant_id", "booking_request_id")
	WHERE "booking_request_id" IS NOT NULL AND "deleted_at" IS NULL;
CREATE INDEX "quotations_booking_request_sent_idx"
	ON "quotations" USING btree ("tenant_id", "booking_request_id")
	WHERE "booking_request_id" IS NOT NULL AND "sent_at" IS NOT NULL AND "deleted_at" IS NULL;
