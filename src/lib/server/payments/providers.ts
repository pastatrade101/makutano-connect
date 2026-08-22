// Payment provider adapters (§19).
//
// One interface, many providers. MANUAL and BANK_TRANSFER are fully implemented
// because they need no third party; the hosted providers are declared with the same
// contract and report NOT_CONFIGURED until credentials are added, rather than
// pretending to charge a card.
import { AppError } from '../errors';

export const PROVIDERS = ['MANUAL', 'BANK_TRANSFER', 'STRIPE', 'FLUTTERWAVE', 'PESAPAL', 'AZAMPAY'] as const;
export type ProviderCode = (typeof PROVIDERS)[number];

export type ChargeRequest = {
	tenantId: string;
	paymentId: string;
	amount: string;
	currency: string;
	description?: string | null;
	customer?: { email?: string | null; phone?: string | null; name?: string | null };
	returnUrl?: string | null;
	metadata?: Record<string, unknown>;
};

export type ChargeResult = {
	/** SUCCEEDED for offline captures; PROCESSING when the traveller must act. */
	status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED';
	providerPaymentId?: string | null;
	/** Where to send the traveller, when the provider hosts the payment page. */
	redirectUrl?: string | null;
	raw?: Record<string, unknown>;
};

export interface PaymentProvider {
	readonly code: ProviderCode;
	readonly isConfigured: boolean;
	createCharge(request: ChargeRequest): Promise<ChargeResult>;
	/** Re-read authoritative status from the provider (used by reconciliation). */
	verify(
		providerPaymentId: string
	): Promise<{ status: ChargeResult['status'] | 'FAILED'; raw?: Record<string, unknown> }>;
}

/** Recorded outside the system (cash, mobile money confirmed by hand, offline card). */
const manual: PaymentProvider = {
	code: 'MANUAL',
	isConfigured: true,
	async createCharge() {
		return { status: 'SUCCEEDED' };
	},
	async verify() {
		return { status: 'SUCCEEDED' };
	}
};

/** Awaits confirmation of an inbound transfer; an operator settles it. */
const bankTransfer: PaymentProvider = {
	code: 'BANK_TRANSFER',
	isConfigured: true,
	async createCharge() {
		return { status: 'PENDING' };
	},
	async verify() {
		return { status: 'PENDING' };
	}
};

function unconfigured(code: ProviderCode): PaymentProvider {
	return {
		code,
		isConfigured: false,
		async createCharge() {
			throw new AppError('NOT_CONFIGURED', `The ${code} payment provider is not configured for this deployment.`);
		},
		async verify() {
			throw new AppError('NOT_CONFIGURED', `The ${code} payment provider is not configured for this deployment.`);
		}
	};
}

const registry: Record<ProviderCode, PaymentProvider> = {
	MANUAL: manual,
	BANK_TRANSFER: bankTransfer,
	STRIPE: unconfigured('STRIPE'),
	FLUTTERWAVE: unconfigured('FLUTTERWAVE'),
	PESAPAL: unconfigured('PESAPAL'),
	AZAMPAY: unconfigured('AZAMPAY')
};

export function providerFor(code: string): PaymentProvider {
	const provider = registry[code as ProviderCode];
	if (!provider) throw new AppError('VALIDATION_ERROR', `Unknown payment provider: ${code}`);
	return provider;
}

export function availableProviders(): Array<{ code: ProviderCode; configured: boolean }> {
	return PROVIDERS.map((code) => ({ code, configured: registry[code].isConfigured }));
}
