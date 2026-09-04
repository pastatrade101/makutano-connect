// Registers the alias loader for the current process.
//   node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/tracking-worker.ts
import { register } from 'node:module';
register('./ts-alias-loader.mjs', import.meta.url);
