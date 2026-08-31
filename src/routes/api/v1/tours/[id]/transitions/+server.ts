// Moving a listing through its lifecycle.
//
// Status is not an editable column — there is no PATCH that sets it. Every move
// is a named action checked against an explicit transition table in the service.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { assertPublishable, getTour, transitionTour } from '$lib/server/tours';
import { AppError } from '$lib/server/errors';
import { handle, ok, parseBody, requireApiScope } from '$lib/server/http';

// Only the vendor half. start_review/approve/request_changes/publish are
// platform acts, and tours:publish is deliberately not an API scope at all —
// so they are refused here by name rather than reaching the service and being
// refused there. Saying WHY is friendlier than a bare 403.
const VENDOR_ACTIONS = ['submit', 'unpublish', 'archive', 'restore'] as const;
const PLATFORM_ACTIONS = ['start_review', 'approve', 'request_changes', 'publish'] as const;

const bodySchema = z.object({
	action: z.enum([...VENDOR_ACTIONS, ...PLATFORM_ACTIONS] as unknown as [string, ...string[]]),
	note: z.string().max(2000).optional().nullable()
});

export const GET: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'tours:read');
		const id = event.params.id!;
		const [tour, missing] = await Promise.all([
			getTour(ctx.tenantId, id),
			assertPublishable(ctx.tenantId, id)
		]);
		return ok({
			status: tour.status,
			reviewNote: tour.reviewNote,
			submittedAt: tour.submittedAt,
			publishedAt: tour.publishedAt,
			canSubmit: missing.length === 0,
			missing
		});
	});

export const POST: RequestHandler = async (event) =>
	handle(event, async () => {
		const ctx = requireApiScope(event, 'tours:write');
		const body = await parseBody(event, bodySchema);

		if ((PLATFORM_ACTIONS as readonly string[]).includes(body.action)) {
			throw new AppError(
				'FORBIDDEN',
				'Reviewing and publishing a marketplace listing is done by the Makutano team, not through the API.'
			);
		}

		const tour = await transitionTour(
			ctx.tenantId,
			event.params.id!,
			body.action as never,
			{ apiKeyId: ctx.apiKeyId },
			// An API key can never hold tours:publish, so this is always false here.
			// It is passed explicitly rather than defaulted so the refusal is visible.
			{ canPublish: false, note: body.note ?? null }
		);
		return ok(tour);
	});
