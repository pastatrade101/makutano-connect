/**
 * Lets plain Node run the app's server modules.
 *
 * Those modules are written for Vite: they import `$lib/...` and they omit file
 * extensions, both of which Node's ESM resolver refuses. The tracking worker is
 * the same code as the web app and must import the same files — so rather than
 * fork them into a Node dialect, this teaches Node the two conventions.
 *
 * Deliberately dependency-free. The production image carries no bundler, and
 * adding one to run a single background process would be a build system for a
 * problem that is thirty lines wide.
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const isFile = (p) => {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
};

/** The extensionless specifier this codebase writes, resolved to a real file. */
function resolveFile(base) {
	const candidates = [base, `${base}.ts`, `${base}.js`, path.join(base, 'index.ts'), path.join(base, 'index.js')];
	return candidates.find(isFile) ?? null;
}

/*
 * SvelteKit's $env/* are VIRTUAL modules — there is no file to resolve, so the
 * loader has to synthesise them. The split is the same one SvelteKit applies:
 * everything not prefixed PUBLIC_ is private, everything prefixed PUBLIC_ is
 * public. Verified against the installed filter_env rather than assumed.
 */
const VIRTUAL = 'makutano-virtual:';
const VIRTUAL_SOURCES = {
	'$env/dynamic/private':
		"export const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PUBLIC_')));",
	'$env/dynamic/public':
		"export const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('PUBLIC_')));"
};

export async function load(url, context, next) {
	if (url.startsWith(VIRTUAL)) {
		return { format: 'module', shortCircuit: true, source: VIRTUAL_SOURCES[url.slice(VIRTUAL.length)] };
	}
	return next(url, context);
}

export async function resolve(specifier, context, next) {
	if (VIRTUAL_SOURCES[specifier]) {
		return { url: VIRTUAL + specifier, shortCircuit: true };
	}

	// $lib is SvelteKit's alias for src/lib. Node has never heard of it.
	if (specifier === '$lib' || specifier.startsWith('$lib/')) {
		const rest = specifier === '$lib' ? '' : specifier.slice('$lib/'.length);
		const found = resolveFile(path.join(SRC, 'lib', rest));
		if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
	}

	// Relative imports inside those modules omit their extension too.
	if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
		const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
		const found = resolveFile(base);
		if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
	}

	return next(specifier, context);
}
