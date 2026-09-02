// Two profiles, and the distinction is the point.
//
//   BUSINESS DETAILS live on `tenants`. They are operational — how Makutano
//   reaches this business — and are never published.
//
//   The PUBLIC PROFILE lives on `operator_profiles`. It is what a traveller sees
//   on the marketplace, and it exists as a separate row precisely so a tenant
//   field filled in for billing can never leak onto a public page.
//
// This is also where an operator finishes whatever they skipped at signup, which
// is what makes the short onboarding form honest.
import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { requirePermission } from '$lib/server/auth/permissions';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import { ensureOperatorProfile } from '$lib/server/tours';
import { mediaEnabled, publicMedia, uploadMedia } from '$lib/server/media';
import { audit } from '$lib/server/audit';
import type { Actions, PageServerLoad } from './$types';

const COUNTRIES = [
	{ code: 'TZ', name: 'Tanzania' },
	{ code: 'KE', name: 'Kenya' },
	{ code: 'UG', name: 'Uganda' },
	{ code: 'RW', name: 'Rwanda' },
	{ code: 'ZA', name: 'South Africa' },
	{ code: 'GB', name: 'United Kingdom' },
	{ code: 'US', name: 'United States' }
];

/** Comma or newline separated, trimmed, de-duplicated, bounded. */
const toList = (raw: string, max = 12): string[] => [
	...new Set(
		raw
			.split(/[\n,]/)
			.map((v) => v.trim())
			.filter(Boolean)
			.slice(0, max)
	)
];

export const load: PageServerLoad = async ({ locals }) => {
	const tenant = requireTenantPermission(locals, 'tenant:read');

	// Created on the first tour, but an operator should be able to write their
	// public page BEFORE they have a listing — otherwise the first thing a
	// traveller ever sees is a profile nobody had the chance to fill in.
	const profile = await ensureOperatorProfile(tenant.id);

	const [logo, cover] = await Promise.all([
		profile.logoMediaId
			? db().select().from(schema.media).where(eq(schema.media.id, profile.logoMediaId)).limit(1)
			: Promise.resolve([]),
		profile.coverMediaId
			? db().select().from(schema.media).where(eq(schema.media.id, profile.coverMediaId)).limit(1)
			: Promise.resolve([])
	]);

	return {
		countries: COUNTRIES,
		mediaEnabled: mediaEnabled(),
		canWrite: locals.permissions.includes('tenant:write'),
		business: {
			name: tenant.name,
			industry: tenant.industry,
			country: tenant.country,
			businessPhone: tenant.businessPhone,
			websiteUrl: tenant.websiteUrl,
			timezone: tenant.timezone,
			currency: tenant.currency
		},
		// Field by field: the tenant row carries credentials and plan state, and a
		// spread here would put them in the page payload.
		profile: {
			slug: profile.slug,
			displayName: profile.displayName,
			about: profile.about,
			location: profile.location,
			specialties: profile.specialties ?? [],
			languages: profile.languages ?? [],
			yearsInBusiness: profile.yearsInBusiness,
			websiteUrl: profile.websiteUrl,
			publicEmail: profile.publicEmail,
			publicPhone: profile.publicPhone,
			seoTitle: profile.seoTitle,
			seoDescription: profile.seoDescription,
			isVerified: profile.isVerified,
			verifiedAt: profile.verifiedAt,
			isActive: profile.isActive,
			logo: publicMedia(logo[0] ?? null),
			cover: publicMedia(cover[0] ?? null)
		}
	};
};

export const actions: Actions = {
	/** The private, operational half. */
	saveBusiness: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'tenant:write');
		const tenant = requireTenant(locals);
		const data = await request.formData();
		const str = (k: string) => String(data.get(k) ?? '').trim();

		const phone = str('businessPhone');
		const website = str('websiteUrl');
		// Blank is fine; malformed is not. A bad URL saved here becomes a broken
		// link the day somebody publishes it.
		if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) {
			return fail(400, { message: 'That phone number does not look right.' });
		}
		if (website && !/^https?:\/\/[^\s.]+\.[^\s]{2,}$/i.test(website)) {
			return fail(400, { message: 'Enter the website as a full URL, e.g. https://example.com' });
		}

		try {
			await db()
				.update(schema.tenants)
				.set({
					industry: str('industry') || null,
					country: str('country').toUpperCase().slice(0, 2) || null,
					businessPhone: phone || null,
					websiteUrl: website || null,
					updatedAt: new Date()
				})
				.where(eq(schema.tenants.id, tenant.id));
			return { success: true, saved: 'business' };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	/** The public half — what a traveller reads before choosing an operator. */
	saveProfile: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'tenant:write');
		const tenant = requireTenant(locals);
		const data = await request.formData();
		const str = (k: string) => String(data.get(k) ?? '').trim();

		const displayName = str('displayName');
		if (!displayName) return fail(400, { message: 'Travellers need a name to recognise you by.' });

		const slug = str('slug')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 80);
		if (!slug) return fail(400, { message: 'Your public address cannot be empty.' });

		const website = str('websiteUrl');
		const email = str('publicEmail');
		if (website && !/^https?:\/\/[^\s.]+\.[^\s]{2,}$/i.test(website)) {
			return fail(400, { message: 'Enter your website as a full URL, e.g. https://example.com' });
		}
		if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(email)) {
			return fail(400, { message: 'That public email address does not look right.' });
		}

		const years = Number(data.get('yearsInBusiness'));

		try {
			await db()
				.update(schema.operatorProfiles)
				.set({
					displayName,
					slug,
					about: str('about') || null,
					location: str('location') || null,
					specialties: toList(str('specialties')),
					languages: toList(str('languages')),
					yearsInBusiness: Number.isFinite(years) && years > 0 ? Math.min(200, Math.round(years)) : null,
					websiteUrl: website || null,
					publicEmail: email || null,
					publicPhone: str('publicPhone') || null,
					seoTitle: str('seoTitle') || null,
					seoDescription: str('seoDescription') || null,
					updatedAt: new Date()
					// isVerified / verifiedAt / verifiedBy are absent on purpose: a
					// verification a vendor could grant themselves would tell a traveller
					// nothing.
				})
				.where(eq(schema.operatorProfiles.tenantId, tenant.id));

			await audit(tenant.id, 'tenant.updated', { type: 'user', userId: locals.user?.id }, { type: 'operator_profile', id: tenant.id }, { slug });
			return { success: true, saved: 'profile' };
		} catch (err) {
			const message = String((err as Error)?.message ?? '');
			// The slug is unique across the whole marketplace, so a collision is a
			// real possibility and deserves a sentence rather than a constraint name.
			if (/operator_profiles_slug_idx|duplicate key/i.test(message)) {
				return fail(400, { message: `“${slug}” is already taken by another operator. Try another address.` });
			}
			return fail(400, { message: toAppError(err).message });
		}
	},

	/** Logo or cover. Bytes are proxied through the server; no bucket credential reaches the browser. */
	uploadImage: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'tenant:write');
		const tenant = requireTenant(locals);
		const data = await request.formData();
		const slot = String(data.get('slot') ?? '');
		if (slot !== 'logo' && slot !== 'cover') return fail(400, { message: 'Unknown image slot.' });

		const file = data.get('file');
		if (!(file instanceof File) || !file.size) return fail(400, { message: 'Choose an image first.' });

		try {
			const media = await uploadMedia(
				{ kind: 'operator', tenantId: tenant.id },
				new Uint8Array(await file.arrayBuffer()),
				file.type,
				{ altText: String(data.get('altText') ?? '').trim() || null, createdBy: locals.user?.id ?? null }
			);
			await db()
				.update(schema.operatorProfiles)
				.set({ [slot === 'logo' ? 'logoMediaId' : 'coverMediaId']: media.id, updatedAt: new Date() })
				.where(eq(schema.operatorProfiles.tenantId, tenant.id));

			// The logo has to reach the readers that never learned about media rows.
			//
			// Quotes, emails and order links render `tenants.logo_url`, a free-text
			// column an operator used to type a URL into; the marketplace renders
			// `operator_profiles.logo_media_id`. An operator who changed one saw
			// nothing change in the other, which is exactly the bug this mirrors away.
			// One upload, every surface. The column stays as the legacy readers'
			// interface rather than being chased through five call sites.
			if (slot === 'logo') {
				await db()
					.update(schema.tenants)
					.set({ logoUrl: publicMedia(media)?.url ?? null, updatedAt: new Date() })
					.where(eq(schema.tenants.id, tenant.id));
			}
			return { success: true, saved: slot };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	},

	removeImage: async ({ locals, request }) => {
		requirePermission(locals.permissions, 'tenant:write');
		const tenant = requireTenant(locals);
		const slot = String((await request.formData()).get('slot') ?? '');
		if (slot !== 'logo' && slot !== 'cover') return fail(400, { message: 'Unknown image slot.' });

		// Unlink only. The media row and its object are left alone: the same asset
		// may be referenced elsewhere, and an unreferenced object is litter rather
		// than a broken page.
		await db()
			.update(schema.operatorProfiles)
			.set({ [slot === 'logo' ? 'logoMediaId' : 'coverMediaId']: null, updatedAt: new Date() })
			.where(eq(schema.operatorProfiles.tenantId, tenant.id));

		// Clear the mirror as well: a logo that survives its own removal on quotes
		// and emails is worse than one that never uploaded.
		if (slot === 'logo') {
			await db()
				.update(schema.tenants)
				.set({ logoUrl: null, updatedAt: new Date() })
				.where(eq(schema.tenants.id, tenant.id));
		}
		return { success: true, saved: slot };
	}
};
