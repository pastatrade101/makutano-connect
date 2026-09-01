-- Close two vocabularies that were open text.
--
-- `currency` was validated only as three capital letters, so "ABC" was a
-- currency; the marketplace then formats money with that code. `group_type` was
-- validated against nothing at all, while the marketplace builds its group
-- filter from `distinct(group_type)` — so "Private", "private tour" and "Privé"
-- would each have become their own filter option matching a single listing.
--
-- Existing text is mapped rather than dropped: the wording operators actually
-- used is the evidence for which code they meant.

update tours set group_type = case
	when group_type is null or btrim(group_type) = '' then null
	when lower(group_type) like '%private%' then 'PRIVATE'
	when lower(group_type) like '%small%' then 'SMALL_GROUP'
	when lower(group_type) like '%family%' then 'FAMILY'
	when lower(group_type) like '%solo%' then 'SOLO_FRIENDLY'
	when lower(group_type) like '%group%' then 'GROUP'
	else null
end
where group_type is not null
  and group_type not in ('PRIVATE', 'SMALL_GROUP', 'GROUP', 'FAMILY', 'SOLO_FRIENDLY');
--> statement-breakpoint

-- Anything that survived as an unrecognised currency is cleared rather than
-- guessed at: a wrong currency on a price is worse than no currency, which the
-- composer already reports as a gap the operator must fill.
update tours set currency = upper(btrim(currency))
where currency is not null and currency <> upper(btrim(currency));
--> statement-breakpoint

update tours set currency = null
where currency is not null and currency not in ('USD', 'TZS', 'EUR', 'GBP', 'KES');
--> statement-breakpoint

alter table tours drop constraint if exists tours_group_type_check;
--> statement-breakpoint

alter table tours add constraint tours_group_type_check
	check (group_type is null or group_type in ('PRIVATE', 'SMALL_GROUP', 'GROUP', 'FAMILY', 'SOLO_FRIENDLY'));
--> statement-breakpoint

alter table tours drop constraint if exists tours_currency_check;
--> statement-breakpoint

alter table tours add constraint tours_currency_check
	check (currency is null or currency in ('USD', 'TZS', 'EUR', 'GBP', 'KES'));
