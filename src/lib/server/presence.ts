// Lightweight "who is here" presence for conversations.
//
// Deliberately in-memory: production runs a single app process (the same one that
// runs the job worker), presence is ephemeral by nature, and a missed beat costs
// nothing but a stale chip for a few seconds. If Connect ever scales to multiple
// app instances this moves to a shared store — the call sites won't change.
const TTL_MS = 40_000;

type Entry = { userId: string; name: string; typing: boolean; at: number };

const rooms = new Map<string, Map<string, Entry>>();

const roomKey = (tenantId: string, conversationId: string) => `${tenantId}:${conversationId}`;

/** Heartbeat from an open conversation. `typing` = there is text in the composer. */
export function markPresence(
	tenantId: string,
	conversationId: string,
	user: { userId: string; name: string },
	typing: boolean
): void {
	const key = roomKey(tenantId, conversationId);
	let room = rooms.get(key);
	if (!room) {
		room = new Map();
		rooms.set(key, room);
	}
	room.set(user.userId, { userId: user.userId, name: user.name, typing, at: Date.now() });
}

/** Everyone else currently in the thread, freshest first. Self-cleaning. */
export function getPresence(
	tenantId: string,
	conversationId: string,
	excludeUserId: string
): Array<{ name: string; typing: boolean }> {
	const key = roomKey(tenantId, conversationId);
	const room = rooms.get(key);
	if (!room) return [];
	const cutoff = Date.now() - TTL_MS;
	const alive: Entry[] = [];
	for (const [userId, entry] of room) {
		if (entry.at < cutoff) room.delete(userId);
		else if (userId !== excludeUserId) alive.push(entry);
	}
	if (room.size === 0) rooms.delete(key);
	return alive.sort((a, b) => b.at - a.at).map((e) => ({ name: e.name, typing: e.typing }));
}
