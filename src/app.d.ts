import type { Permission } from '$lib/server/auth/permissions';
import type { SessionContext } from '$lib/server/auth/session';
import type { Role, Tenant, User } from '$lib/server/db/schema';

declare global {
	namespace App {
		interface Error {
			code?: string;
			requestId?: string;
		}

		/**
		 * Only SAFE values live here (§23) — never a decrypted token, never a raw API
		 * key. `apiKey` carries metadata alone.
		 */
		interface Locals {
			requestId: string;
			session: SessionContext | null;
			user: User | null;
			tenant: Tenant | null;
			role: Role | null;
			permissions: Permission[];
			apiKey: { id: string; prefix: string; scopes: string[]; environment: 'live' | 'test' } | null;
			ipHash: string | null;
		}

		interface PageData {
			user?: { id: string; email: string; fullName: string; isSuperAdmin: boolean } | null;
			tenant?: { id: string; name: string; slug: string } | null;
			permissions?: Permission[];
		}
	}
}

export {};
