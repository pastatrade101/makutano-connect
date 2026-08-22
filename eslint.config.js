import js from '@eslint/js';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	{
		languageOptions: { globals: { ...globals.node, ...globals.browser } },
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
		}
	},
	{ ignores: ['build/', '.svelte-kit/', 'drizzle/', 'node_modules/', '*.svelte', 'clients/'] }
);
