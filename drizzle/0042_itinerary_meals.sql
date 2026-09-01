-- Meals, as a closed set instead of a sentence.
--
-- The column was free text, and the live data already shows why that does not
-- hold: three spellings of the same fact — 'Dinner', 'All meals',
-- 'Breakfast, lunch' — none of which a filter, a summary or a translation can
-- read. Which meals are included is one of the few things on an itinerary that
-- is genuinely a fixed list.
--
-- The old text is KEPT rather than dropped. The backfill below is a guess made
-- by pattern-matching English, and a guess that destroys its own input is not
-- one you can check afterwards. The composer shows the original back to the
-- operator when nothing could be parsed from it.
alter table tour_itinerary_days rename column meals to meals_note;

alter table tour_itinerary_days
	add column if not exists meals jsonb not null default '[]'::jsonb;

-- Parse what is there. Deliberately generous about wording and deliberately
-- silent about anything it cannot read: an unmatched note stays in meals_note
-- and the day simply has no meals set, which is the honest outcome.
update tour_itinerary_days
set meals = (
	select coalesce(jsonb_agg(meal order by rank), '[]'::jsonb)
	from (
		select 'BREAKFAST' as meal, 1 as rank
		where meals_note ~* '(breakfast|all meals|full board|half board)'
		union all
		select 'LUNCH', 2
		where meals_note ~* '(lunch|all meals|full board)'
		union all
		select 'DINNER', 3
		where meals_note ~* '(dinner|supper|all meals|full board|half board)'
	) parsed
)
where meals_note is not null and btrim(meals_note) <> '';

-- Once a note has been fully understood there is nothing left to keep.
update tour_itinerary_days
set meals_note = null
where meals_note is not null
	and jsonb_array_length(meals) = 3
	and meals_note ~* '(all meals|full board)';
