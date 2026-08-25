// Which AI actions belong in a conversation, for THIS kind of business (§26).
//
// A pure tour operator must never be offered "Make order from this"; a fish seller
// must never be offered "Create enquiry". This resolves through the same workspace
// rules the rest of the product uses — relevance is not authorization, so permission
// and entitlement checks still happen at the call site.
import { moduleRelevant, type Workspace } from '$lib/workspace';

export type AiActionKey = 'enquiry' | 'order' | 'reply' | 'summary';

export type AiAction = { key: AiActionKey; label: string; hint: string; primary: boolean };

/**
 * `permitted` decides what this user may create; the workspace decides what the
 * business does at all. Reply and summary need no domain permission beyond being
 * able to read the conversation, which the caller has already proven.
 */
export function aiActionsFor(workspace: Workspace, permitted: { orders: boolean; enquiries: boolean }): AiAction[] {
	const actions: AiAction[] = [];
	if (moduleRelevant(workspace, 'enquiries') && permitted.enquiries) {
		actions.push({
			key: 'enquiry',
			label: 'Create enquiry from this',
			hint: 'Read the trip details out of the message',
			primary: true
		});
	}
	if (moduleRelevant(workspace, 'orders') && permitted.orders) {
		actions.push({
			key: 'order',
			label: 'Make order from this',
			hint: 'Turn the message into a prefilled order',
			primary: !actions.length
		});
	}
	actions.push({ key: 'reply', label: 'Suggest reply', hint: 'Draft a response you can edit', primary: false });
	actions.push({ key: 'summary', label: 'Summarize conversation', hint: 'Catch up in ten seconds', primary: false });
	return actions;
}
