// The single door to Claude. Everything AI in Connect goes through here so that
// model choice, structured-output enforcement, cost accounting and failure handling
// exist in exactly one place.
//
// Two deliberate constraints:
//   * the model NEVER returns free-form prose we then have to parse — every call is
//     schema-constrained, so a malformed answer is impossible rather than unlikely;
//   * nothing here reaches the database or knows about tenants. Callers assemble the
//     prompt from data they have already scoped, which keeps tenant isolation a
//     property of the call site instead of a hope about the model.
import Anthropic from '@anthropic-ai/sdk';
import { env, liveEnv } from '../env';
import { AppError } from '../errors';
import { log } from '../logger';

let client: Anthropic | null = null;

/**
 * Platform-level emergency switch (§46). AI_ENABLED=false stops every model call
 * across every tenant immediately, without a deploy and without editing any plan.
 */
export function aiPlatformEnabled(): boolean {
	// Read the live value rather than the once-parsed env cache: an emergency stop
	// that only takes effect after a process restart is not an emergency stop.
	const live = liveEnv().AI_ENABLED;
	if (live !== undefined) return String(live).toLowerCase() !== 'off';
	return env().AI_ENABLED !== 'off';
}

/** AI surfaces stay invisible until a key exists AND the platform switch is on. */
export function aiConfigured(): boolean {
	return !!env().ANTHROPIC_API_KEY && aiPlatformEnabled();
}

function anthropic(): Anthropic {
	if (!aiConfigured()) throw new AppError('FEATURE_NOT_AVAILABLE', 'AI assist is not configured on this deployment.');
	if (!client) client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
	return client;
}

export type TokenUsage = {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
};

/**
 * First-party list prices, USD per million tokens. Used for VISIBILITY — what a
 * tenant's assist actually cost — never for billing them. Unknown models price at
 * zero rather than guessing high and alarming an admin over a number we invented.
 */
const PRICES: Record<string, { input: number; output: number }> = {
	'claude-opus-5': { input: 5, output: 25 },
	'claude-opus-4-8': { input: 5, output: 25 },
	'claude-sonnet-5': { input: 3, output: 15 },
	'claude-haiku-4-5': { input: 1, output: 5 }
};

/** Cache reads bill at ~0.1x input, cache writes at ~1.25x. */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
	const price = PRICES[model];
	if (!price) return 0;
	const perToken = price.input / 1_000_000;
	return (
		usage.inputTokens * perToken +
		usage.cacheReadTokens * perToken * 0.1 +
		usage.cacheWriteTokens * perToken * 1.25 +
		usage.outputTokens * (price.output / 1_000_000)
	);
}

const emptyUsage = (): TokenUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

export type StructuredCall = {
	/** Stable across requests so the cached prefix survives — put nothing volatile here. */
	system: string;
	/** The volatile part: this tenant's message and context. */
	user: string;
	/** JSON Schema the answer is constrained to. */
	schema: Record<string, unknown>;
	maxTokens?: number;
	/** Simple extraction runs at low effort; raise it for genuinely hard reasoning. */
	effort?: 'low' | 'medium' | 'high';
};

export type StructuredResult<T> = { data: T; usage: TokenUsage; model: string };

/**
 * One schema-constrained call. Throws AppError on failure — callers decide whether a
 * failed suggestion is worth surfacing, and no caller may treat a failure as an empty
 * result, because "the model found no order" and "the call broke" are different facts.
 */
export async function callStructured<T>(call: StructuredCall): Promise<StructuredResult<T>> {
	const model = env().AI_MODEL || 'claude-opus-5';
	try {
		const response = await anthropic().messages.create({
			model,
			max_tokens: call.maxTokens ?? 2048,
			// Stable instructions first, marked cacheable: the prefix is identical on
			// every extraction, so repeat calls read it from cache once it is long
			// enough to qualify.
			system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
			output_config: {
				effort: call.effort ?? 'low',
				format: { type: 'json_schema', schema: call.schema }
			},
			messages: [{ role: 'user', content: call.user }]
		} as never);

		const raw = response as unknown as {
			content: Array<{ type: string; text?: string }>;
			stop_reason?: string;
			usage?: Record<string, number>;
		};

		// A safety decline is a real outcome, not a parse failure — say so plainly.
		if (raw.stop_reason === 'refusal') {
			throw new AppError('VALIDATION_ERROR', 'The assistant declined to process this message.');
		}

		const usage: TokenUsage = {
			inputTokens: Number(raw.usage?.input_tokens ?? 0),
			outputTokens: Number(raw.usage?.output_tokens ?? 0),
			cacheReadTokens: Number(raw.usage?.cache_read_input_tokens ?? 0),
			cacheWriteTokens: Number(raw.usage?.cache_creation_input_tokens ?? 0)
		};

		const text = raw.content
			.filter((b) => b.type === 'text')
			.map((b) => b.text ?? '')
			.join('')
			.trim();
		if (!text) throw new AppError('VALIDATION_ERROR', 'The assistant returned an empty response.');

		let data: T;
		try {
			data = JSON.parse(text) as T;
		} catch {
			// Structured outputs make this near-impossible; if it ever happens we want
			// the loud version, not a half-parsed order.
			log.error('ai_unparseable_response', { model, preview: text.slice(0, 200) });
			throw new AppError('VALIDATION_ERROR', 'The assistant returned an unreadable response.');
		}
		return { data, usage, model };
	} catch (err) {
		if (err instanceof AppError) throw err;
		if (err instanceof Anthropic.RateLimitError) {
			throw new AppError('RATE_LIMITED', 'The assistant is busy right now. Try again in a moment.');
		}
		if (err instanceof Anthropic.AuthenticationError) {
			log.error('ai_auth_failed', { model });
			throw new AppError('FEATURE_NOT_AVAILABLE', 'AI assist is not configured correctly.');
		}
		if (err instanceof Anthropic.APIError) {
			const apiError = err as { status?: number; message?: string };
			log.error('ai_api_error', { model, status: apiError.status, message: apiError.message });
			throw new AppError('META_API_ERROR', 'The assistant could not be reached. Please try again.');
		}
		log.error('ai_unexpected_error', { model, message: (err as Error)?.message, detail: String(err).slice(0, 400) });
		throw new AppError('META_API_ERROR', 'The assistant could not be reached. Please try again.');
	}
}

export { emptyUsage };
