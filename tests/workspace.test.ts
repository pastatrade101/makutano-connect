// Workspace resolver — the §9 rule (relevance is never authorization) and the
// acceptance matrix for all four business types.
import { describe, expect, it } from 'vitest';
import {
	catalogCopy,
	catalogRecommended,
	moduleRelevant,
	normalizeWorkspace,
	showModule,
	workspaceForIndustry
} from '../src/lib/workspace';

describe('workspace resolver', () => {
	it('normalizes legacy and unknown values safely', () => {
		expect(normalizeWorkspace('BOTH')).toBe('HYBRID'); // legacy tenants
		expect(normalizeWorkspace(undefined)).toBe('HYBRID');
		expect(normalizeWorkspace('garbage')).toBe('HYBRID');
		expect(normalizeWorkspace('BOOKINGS')).toBe('BOOKINGS');
		// Regression: a raw jsonb write once double-encoded the value; the quoted form
		// must still resolve to the right workspace, not fail open to HYBRID.
		expect(normalizeWorkspace('"BOOKINGS"')).toBe('BOOKINGS');
		expect(normalizeWorkspace('"ORDERS"')).toBe('ORDERS');
		expect(normalizeWorkspace('SERVICE')).toBe('SERVICE');
	});

	it('tour operator: orders are not part of the world; catalog is an optional tool', () => {
		expect(moduleRelevant('BOOKINGS', 'orders')).toBe(false);
		// Reachable (manual bookings/quotes may want reusable items) but never pushed:
		// the website stays the source of truth — see catalogRecommended below.
		expect(moduleRelevant('BOOKINGS', 'catalog')).toBe(true);
		expect(moduleRelevant('BOOKINGS', 'enquiries')).toBe(true);
		expect(moduleRelevant('BOOKINGS', 'bookings')).toBe(true);
		expect(moduleRelevant('BOOKINGS', 'quotations')).toBe(true);
	});

	it('catalog is only ever RECOMMENDED where it speeds up order entry', () => {
		expect(catalogRecommended('ORDERS')).toBe(true);
		expect(catalogRecommended('HYBRID')).toBe(true);
		// Tour operators and service businesses are never nagged to fill a catalog.
		expect(catalogRecommended('BOOKINGS')).toBe(false);
		expect(catalogRecommended('SERVICE')).toBe(false);
	});

	it('catalog presents itself honestly per business type', () => {
		expect(catalogCopy('BOOKINGS').label).toBe('Services & Packages');
		expect(catalogCopy('BOOKINGS').hint).toContain('source of truth');
		expect(catalogCopy('SERVICE').label).toBe('Services & Packages');
		expect(catalogCopy('ORDERS').label).toBe('Catalog');
		expect(catalogCopy('HYBRID').label).toBe('Catalog');
	});

	it('WhatsApp seller: booking flows are simply not part of the world', () => {
		expect(moduleRelevant('ORDERS', 'orders')).toBe(true);
		expect(moduleRelevant('ORDERS', 'catalog')).toBe(true);
		expect(moduleRelevant('ORDERS', 'bookings')).toBe(false);
		expect(moduleRelevant('ORDERS', 'enquiries')).toBe(false);
		expect(moduleRelevant('ORDERS', 'quotations')).toBe(false);
	});

	it('service business: enquiry → quote, neither orders nor bookings', () => {
		expect(moduleRelevant('SERVICE', 'enquiries')).toBe(true);
		expect(moduleRelevant('SERVICE', 'quotations')).toBe(true);
		expect(moduleRelevant('SERVICE', 'catalog')).toBe(true); // optional reusable services
		expect(moduleRelevant('SERVICE', 'orders')).toBe(false);
		expect(moduleRelevant('SERVICE', 'bookings')).toBe(false);
	});

	it('hybrid: both worlds', () => {
		expect(moduleRelevant('HYBRID', 'orders')).toBe(true);
		expect(moduleRelevant('HYBRID', 'bookings')).toBe(true);
	});

	it('§9: HYBRID workspace with orders.enabled=false still shows no Orders', () => {
		// Workspace says relevant, but the plan says no — the plan wins.
		expect(showModule('HYBRID', 'orders', false, true)).toBe(false);
		// And a permitted, entitled module hidden by workspace stays hidden.
		expect(showModule('BOOKINGS', 'orders', true, true)).toBe(false);
		// All three agree → shown.
		expect(showModule('HYBRID', 'orders', true, true)).toBe(true);
		// Entitled + relevant but the USER may not touch it → hidden.
		expect(showModule('HYBRID', 'orders', true, false)).toBe(false);
	});

	it('industry defaults are sensible and never grant anything', () => {
		expect(workspaceForIndustry('TRAVEL_TOURISM')).toBe('BOOKINGS');
		expect(workspaceForIndustry('RETAIL')).toBe('ORDERS');
		expect(workspaceForIndustry('RESTAURANT_FOOD')).toBe('ORDERS');
		expect(workspaceForIndustry('PROFESSIONAL_SERVICES')).toBe('SERVICE');
		expect(workspaceForIndustry('OTHER')).toBe('HYBRID');
		expect(workspaceForIndustry(null)).toBe('HYBRID');
	});
});
