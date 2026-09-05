// The public quote-accept endpoint: what it must do besides flip a status.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe("an accepted quotation reaches the operator's phone", () => {
	it('pushes to the same OWNER/ADMIN recipients as the email, without waiting on FCM', () => {
		const SRC = readFileSync('src/routes/api/public/quotations/[token]/accept/+server.ts', 'utf8');
		expect(SRC).toContain("const { pushToUsers } = await import('$lib/server/push')");
		expect(SRC).toContain('owners.map((owner) => owner.id)');
		// Fire-and-forget: the acceptance has already created a confirmed booking.
		expect(SRC).toMatch(/void \(async \(\) => \{[\s\S]*pushToUsers[\s\S]*\}\)\(\)\.catch/);
		// Routable by the app when a conversation exists; never a provider detail.
		expect(SRC).toContain("type: 'quotation'");
		expect(SRC).toContain('conversationId: row.conversationId');
	});
});
