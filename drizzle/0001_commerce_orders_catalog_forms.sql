CREATE TYPE "public"."catalog_item_type" AS ENUM('PRODUCT', 'SERVICE', 'TOUR', 'ACCOMMODATION', 'EXPERIENCE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."delivery_method" AS ENUM('DELIVERY', 'PICKUP');--> statement-breakpoint
CREATE TYPE "public"."form_type" AS ENUM('BOOKING', 'ORDER', 'QUOTE', 'LEAD');--> statement-breakpoint
CREATE TYPE "public"."order_payment_status" AS ENUM('UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('WHATSAPP_DIRECT', 'WHATSAPP_STATUS', 'WHATSAPP_GROUP', 'WEBSITE', 'INSTAGRAM', 'FACEBOOK', 'MANUAL', 'API', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'PROCESSING', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'REFUNDED');--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "catalog_item_type" DEFAULT 'PRODUCT' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sku" text,
	"external_reference" text,
	"external_source" text,
	"price" numeric(14, 2),
	"currency" text,
	"image_url" text,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"type" "form_type" NOT NULL,
	"name" text NOT NULL,
	"heading" text,
	"description" text,
	"cta_text" text,
	"success_message" text,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"catalog_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"catalog_item_id" uuid,
	"title" text NOT NULL,
	"variant" text,
	"sku" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"external_reference" text,
	"external_source" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"reason" text,
	"changed_by_user_id" uuid,
	"changed_by_api_key_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" uuid,
	"conversation_id" uuid,
	"lead_id" uuid,
	"status" "order_status" DEFAULT 'DRAFT' NOT NULL,
	"payment_status" "order_payment_status" DEFAULT 'UNPAID' NOT NULL,
	"source" "order_source" DEFAULT 'MANUAL' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"delivery_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(14, 2) DEFAULT '0' NOT NULL,
	"delivery_method" "delivery_method",
	"delivery_location" text,
	"notes" text,
	"external_reference" text,
	"external_source" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_changed_by_api_key_id_api_keys_id_fk" FOREIGN KEY ("changed_by_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_items_tenant_idx" ON "catalog_items" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_tenant_sku_key" ON "catalog_items" USING btree ("tenant_id","sku") WHERE "catalog_items"."sku" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "forms_public_id_key" ON "forms" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "forms_tenant_idx" ON "forms" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "order_status_history" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_number_key" ON "orders" USING btree ("tenant_id","order_number");--> statement-breakpoint
CREATE INDEX "orders_tenant_status_idx" ON "orders" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "orders_tenant_payment_idx" ON "orders" USING btree ("tenant_id","payment_status");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_conversation_idx" ON "orders" USING btree ("conversation_id");