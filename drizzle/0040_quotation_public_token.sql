-- A quotation a traveller can open.
--
-- Until now a quotation existed only inside Connect, so the only "link" it had
-- was whatever the tenant's own website had written into its metadata. A
-- quotation raised on the marketplace has no such site behind it, and the
-- customer still has to be able to read it — so it gets its own unguessable
-- token, and the marketplace renders the page.
--
-- Nullable: every quotation written before this has no token, and one is minted
-- on first send rather than backfilled, so a token only ever exists for a
-- quotation somebody was actually shown.
alter table quotations add column if not exists public_token text;

-- Unique where present. A partial index rather than a unique constraint because
-- the column is null for the long tail of quotations that were never sent, and
-- many nulls are not a collision.
create unique index if not exists quotations_public_token_key
	on quotations (public_token)
	where public_token is not null;
