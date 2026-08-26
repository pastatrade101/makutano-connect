-- New threads now land with the account owner (see conversations.defaultAssignee).
-- Existing threads that nobody ever picked up are moved to the same place so the
-- inbox reads consistently; anything already assigned is left exactly as it is.
UPDATE "conversations" c
SET "assigned_to_user_id" = (
	SELECT m."user_id"
	FROM "tenant_memberships" m
	WHERE m."tenant_id" = c."tenant_id"
		AND m."role" = 'OWNER'
		AND m."accepted_at" IS NOT NULL
		AND m."disabled_at" IS NULL
	ORDER BY m."created_at"
	LIMIT 1
)
WHERE c."assigned_to_user_id" IS NULL;
