CREATE TYPE "public"."order_batch_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
ALTER TYPE "public"."order_source" ADD VALUE 'PHONE' BEFORE 'OTHER';--> statement-breakpoint
ALTER TYPE "public"."order_source" ADD VALUE 'WALK_IN' BEFORE 'OTHER';--> statement-breakpoint
CREATE TABLE "order_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "order_batch_status" DEFAULT 'OPEN' NOT NULL,
	"fulfilment_date" timestamp with time zone,
	"default_item_title" text NOT NULL,
	"default_unit" text,
	"default_unit_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"default_delivery_method" "delivery_method",
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "order_batches" ADD CONSTRAINT "order_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_batches" ADD CONSTRAINT "order_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_batches_tenant_idx" ON "order_batches" USING btree ("tenant_id","status","fulfilment_date");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_batch_id_order_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."order_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_batch_idx" ON "orders" USING btree ("batch_id");