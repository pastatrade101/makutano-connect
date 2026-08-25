CREATE TYPE "public"."order_link_status" AS ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
ALTER TYPE "public"."order_source" ADD VALUE 'ORDER_LINK' BEFORE 'OTHER';--> statement-breakpoint
CREATE TABLE "order_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"status" "order_link_status" DEFAULT 'DRAFT' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"image_url" text,
	"unit" text DEFAULT 'Piece' NOT NULL,
	"unit_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'TZS' NOT NULL,
	"min_quantity" integer DEFAULT 1 NOT NULL,
	"max_quantity" integer,
	"capacity_total" integer,
	"deadline" timestamp with time zone,
	"delivery_date" timestamp with time zone,
	"pickup_enabled" boolean DEFAULT true NOT NULL,
	"delivery_enabled" boolean DEFAULT true NOT NULL,
	"delivery_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"field_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payment_timing" text DEFAULT 'AFTER_CONFIRMATION' NOT NULL,
	"share_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"batch_id" uuid,
	"catalog_item_id" uuid,
	"view_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "order_link_id" uuid;--> statement-breakpoint
ALTER TABLE "order_links" ADD CONSTRAINT "order_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_links" ADD CONSTRAINT "order_links_batch_id_order_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."order_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_links" ADD CONSTRAINT "order_links_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_links" ADD CONSTRAINT "order_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_links_public_id_key" ON "order_links" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "order_links_tenant_idx" ON "order_links" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_order_link_id_order_links_id_fk" FOREIGN KEY ("order_link_id") REFERENCES "public"."order_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_order_link_idx" ON "orders" USING btree ("order_link_id");
