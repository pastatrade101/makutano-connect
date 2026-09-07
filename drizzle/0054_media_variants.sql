-- Smaller copies of every image, and the size of the original.
--
-- WHY. The bucket holds camera originals — 7360x4912 at 1.4MB is a real row —
-- and every surface serves them at full resolution into boxes 240px wide. One
-- fifteen-day itinerary is 9.4MB of photographs for about 3,600px of screen.
-- Cloudflare's managed r2.dev domain cannot resize on the fly, so the copies are
-- made once, on upload, and recorded here.
--
-- ADDITIVE AND FAIL-SAFE. A row with no variants serves exactly what it serves
-- today: the API emits no srcset and the browser loads `url`. So this migration
-- changes nothing until the backfill runs, and a derivative that fails to
-- generate costs a page nothing but its own weight.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "variants" jsonb;

COMMENT ON COLUMN "media"."variants" IS
  'Ordered narrow-to-wide list of {w,key,bytes} derivatives of this image. NULL or [] means only the original exists.';

-- width/height have existed since the table did and were never populated: the
-- upload path took them from the caller and no caller knew them. The backfill
-- fills them from the file itself, which is what lets a page reserve the box
-- before the image lands.

-- The accommodation directory keeps its own image table.
--
-- 459 rows, all in the same bucket, but only 2 of them are media rows: the
-- import wrote URLs straight in. They are the worst offenders on the page — the
-- itinerary renders them as 42x30 thumbnails and downloads the full file for
-- each, three per day — so they need the same treatment and cannot get it
-- through media.variants.
ALTER TABLE "accommodation_images" ADD COLUMN IF NOT EXISTS "variants" jsonb;
ALTER TABLE "accommodation_images" ADD COLUMN IF NOT EXISTS "width" integer;
ALTER TABLE "accommodation_images" ADD COLUMN IF NOT EXISTS "height" integer;

COMMENT ON COLUMN "accommodation_images"."variants" IS
  'Ordered narrow-to-wide list of {w,key,bytes} derivatives. NULL or [] means only the original exists.';
