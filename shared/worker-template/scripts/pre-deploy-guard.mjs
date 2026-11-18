// Pre-deploy guard (SPEC Decision 16): run by the `pre-app-deploy` hook from the worker folder.
// Refuses a deploy when a referenced $NAME is missing/empty in .env, when local-development settings would
// reach a non-Stage namespace, or when the config breaks the worker rules.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeConfig, parseEnv, SECRET_NAME } from './worker-config.mjs';

const STAGE_NAMESPACE = /-stage$/i;

/**
 * @param {string} dir worker folder (app root)
 * @param {object} [processEnv] extra environment (wins over .env, like aio's dotenv loading)
 * @returns {string[]} violations (empty = deploy may proceed)
 */
export function checkDeploy(dir, processEnv = {}) {
  const errors = [];
  const configPath = ['app.config.yaml', 'app.config.yml'].map((f) => join(dir, f)).find(existsSync);
  if (!configPath) return [`${dir}: no app.config.yaml`];
  const { errors: configErrors, inputs } = analyzeConfig(readFileSync(configPath, 'utf8'), {
    folderName: basename(resolve(dir, '..')),
  });
  errors.push(...configErrors);

  const envPath = join(dir, '.env');
  const fileEnv = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
  const env = { ...fileEnv };
  Object.entries(processEnv).forEach(([k, v]) => {
    if (v !== undefined) env[k] = v;
  });

  inputs.filter((i) => i.ref).forEach((i) => {
    const value = env[i.ref];
    if (value === undefined) {
      errors.push(`${i.action}: $${i.ref} is not set in .env`);
    } else if (value === '' && (i.secretLike || SECRET_NAME.test(i.ref))) {
      errors.push(`${i.action}: $${i.ref} is empty in .env`);
    }
  });

  const local = inputs.find((i) => i.name === 'ALLOWED_LOCAL_ORIGINS');
  if (local) {
    const value = (local.ref ? env[local.ref] : local.value) || '';
    if (value.trim()) {
      const namespace = env.AIO_runtime_namespace;
      if (!namespace) {
        errors.push('ALLOWED_LOCAL_ORIGINS is set but AIO_runtime_namespace is missing from .env: '
          + 'cannot confirm this is Stage (run `aio app use`)');
      } else if (!STAGE_NAMESPACE.test(namespace)) {
        errors.push(`ALLOWED_LOCAL_ORIGINS must be empty outside Stage (namespace ${namespace}); `
          + 'local origins are a Stage-only convenience');
      }
    }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] || process.cwd());
  const errors = checkDeploy(dir, process.env);
  if (errors.length) {
    console.error(`Pre-deploy guard failed for ${dir}:\n${errors.map((e) => `  ✖ ${e}`).join('\n')}`);
    process.exit(1);
  }
  console.log('Pre-deploy guard OK');
}
