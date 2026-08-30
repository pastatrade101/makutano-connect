// Fetching a URL somebody else typed.
//
// The guard is the point of this file. A tenant configures where their
// catalogue lives and this server goes and gets it, so the interesting targets
// are not on the internet but next to us: 169.254.169.254 hands out cloud
// credentials, 127.0.0.1 is our own admin surface.
import { describe, expect, it } from 'vitest';
import { blockedAddressReason } from '../src/lib/server/net';
import { catalogSyncSettings } from '../src/lib/server/catalog-sync';

describe('what this server refuses to fetch', () => {
	it('blocks the addresses that actually leak something', () => {
		expect(blockedAddressReason('169.254.169.254')).toMatch(/metadata/i); // AWS/GCP/Azure creds
		expect(blockedAddressReason('127.0.0.1')).toBe('loopback');
		expect(blockedAddressReason('10.1.2.3')).toBe('private');
		expect(blockedAddressReason('172.16.0.1')).toBe('private');
		expect(blockedAddressReason('172.31.255.255')).toBe('private');
		expect(blockedAddressReason('192.168.1.1')).toBe('private');
		expect(blockedAddressReason('0.0.0.0')).toBe('this-network');
		expect(blockedAddressReason('100.64.0.1')).toBe('shared address space');
		expect(blockedAddressReason('239.1.1.1')).toBe('multicast');
	});

	it('is not fooled by IPv6 spellings of the same address', () => {
		expect(blockedAddressReason('::1')).toBe('loopback');
		// A v4-mapped address is the same machine wearing a hat.
		expect(blockedAddressReason('::ffff:127.0.0.1')).toBe('loopback');
		expect(blockedAddressReason('::ffff:169.254.169.254')).toMatch(/metadata/i);
		expect(blockedAddressReason('fd00::1')).toBe('unique local');
		expect(blockedAddressReason('fe80::1')).toBe('link-local');
	});

	it('lets ordinary public addresses through', () => {
		for (const ok of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '193.15.20.1', '2606:4700::1111']) {
			expect(blockedAddressReason(ok)).toBeNull();
		}
	});

	it('rejects what is not an address at all', () => {
		expect(blockedAddressReason('not-an-ip')).toBe('not an IP address');
		expect(blockedAddressReason('')).toBe('not an IP address');
	});
});

describe('reading a tenant’s sync settings', () => {
	it('survives anything shaped wrongly', () => {
		// These come out of a JSON column that nothing validates on the way in.
		expect(catalogSyncSettings(null).sources).toEqual([]);
		expect(catalogSyncSettings({}).sources).toEqual([]);
		expect(catalogSyncSettings({ catalogSync: 'nonsense' }).sources).toEqual([]);
		expect(catalogSyncSettings({ catalogSync: { sources: 'nope' } }).sources).toEqual([]);
		expect(catalogSyncSettings({ catalogSync: { sources: [{ source: 'x' }] } }).sources).toEqual([]);
	});

	it('defaults an unknown type rather than writing an invalid enum', () => {
		const { sources } = catalogSyncSettings({
			catalogSync: { sources: [{ source: 'lodges', url: 'https://x.example/a', type: 'NONSENSE' }] }
		});
		expect(sources[0].type).toBe('ACCOMMODATION');
	});

	it('treats a source as enabled unless it says otherwise', () => {
		const on = catalogSyncSettings({ catalogSync: { sources: [{ source: 'a', url: 'https://x.example/a' }] } });
		const off = catalogSyncSettings({
			catalogSync: { sources: [{ source: 'a', url: 'https://x.example/a', enabled: false }] }
		});
		expect(on.sources[0].enabled).toBe(true);
		expect(off.sources[0].enabled).toBe(false);
	});
});
