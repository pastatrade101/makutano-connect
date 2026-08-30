-- Why Meta said no.
--
-- The sync asked for id, name, language, category, status and components, so a
-- rejection arrived as the single word REJECTED and the reason was discarded.
-- The Template Center could only show "Needs changes" and leave the tenant to
-- guess which of four things Meta objected to — with a 24-hour review cycle per
-- guess.
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "rejected_reason" text;
