import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from '../../../../shared/worker-template/scripts/worker-config.mjs';

const file = fileURLToPath(new URL('../.env', import.meta.url));
const fileEnv = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};

/** Environment variable, falling back to the worker's untracked .env. Empty counts as unset. Never printed. */
export const setting = (name) => process.env[name] || fileEnv[name] || undefined;

/** `node:test` skip option naming the missing variables. */
export const skipUnless = (...names) => {
  const missing = names.filter((n) => !setting(n));
  return missing.length ? `set ${missing.join(', ')} to run this live check` : false;
};
