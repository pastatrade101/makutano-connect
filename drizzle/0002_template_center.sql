ALTER TYPE "public"."template_status" ADD VALUE 'DRAFT';--> statement-breakpoint
ALTER TYPE "public"."template_status" ADD VALUE 'SUBMITTED';--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "header_text" text;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "body_text" text;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "footer_text" text;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "buttons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "variables" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;