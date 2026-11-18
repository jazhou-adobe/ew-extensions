// Shared by the repo convention check (CI) and the pre-deploy guard: reads an App Builder app config and
// reports rule violations. Pure functions over text; no network, no credentials.
import { parse } from 'yaml';

export const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD/i;
export const ENV_REF = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;
export const MAX_TIMEOUT_MS = 30000;
export const RUNTIME = 'nodejs:22';

/** Minimal dotenv parser: KEY=VALUE lines, optional quotes, `#` comments. */
export function parseEnv(text) {
  const env = {};
  String(text).split(/\r?\n/).forEach((line) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) return;
    let value = m[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    env[m[1]] = value;
  });
  return env;
}

function findManifests(node, out = []) {
  if (node && typeof node === 'object') {
    Object.entries(node).forEach(([k, v]) => {
      if (k === 'runtimeManifest' && v && typeof v === 'object') out.push(v);
      else findManifests(v, out);
    });
  }
  return out;
}

/**
 * Analyses app config text. Returns the rule violations plus what the guard needs:
 * `refs` (every `$NAME` referenced), `inputs` ({ name, value, secretLike, action }).
 * `folderName`, when given, must equal the package name.
 */
export function analyzeConfig(text, { folderName } = {}) {
  const errors = [];
  const refs = new Set();
  const inputs = [];
  let config;
  try {
    config = parse(text);
  } catch (e) {
    return { errors: [`app config is not valid YAML: ${e.message}`], refs, inputs };
  }
  const manifests = findManifests(config);
  if (!manifests.length) errors.push('app config has no runtimeManifest');
  manifests.forEach((manifest) => {
    const packages = manifest.packages || {};
    const names = Object.keys(packages);
    if (!names.length) errors.push('app config declares no package');
    names.forEach((pkgName) => {
      if (folderName && pkgName !== folderName) {
        errors.push(`package name "${pkgName}" must equal the extension folder name "${folderName}"`);
      }
      const pkg = packages[pkgName] || {};
      const actions = pkg.actions || {};
      if (!Object.keys(actions).length) errors.push(`package ${pkgName}: no actions`);
      Object.entries(actions).forEach(([actionName, action]) => {
        const where = `${pkgName}/${actionName}`;
        const ann = action.annotations || {};
        const platformAuth = ann['require-adobe-auth'] === true;
        if (action.web !== 'raw') errors.push(`${where}: must set \`web: raw\``);
        if (!platformAuth && ann['web-custom-options'] !== true) {
          errors.push(`${where}: must set the \`web-custom-options: true\` annotation `
            + '(otherwise the platform answers CORS with *)');
        }
        if (action.runtime !== RUNTIME) errors.push(`${where}: runtime must be ${RUNTIME}`);
        const timeout = action.limits?.timeout;
        if (!Number.isInteger(timeout) || timeout > MAX_TIMEOUT_MS) {
          errors.push(`${where}: limits.timeout must be set explicitly and be at most ${MAX_TIMEOUT_MS}`);
        }
        const all = { ...(pkg.inputs || {}), ...(action.inputs || {}) };
        Object.entries(all).forEach(([name, raw]) => {
          const value = raw === null || raw === undefined ? '' : String(raw);
          const ref = ENV_REF.exec(value);
          if (ref) refs.add(ref[1]);
          const secretLike = SECRET_NAME.test(name);
          inputs.push({
            name, value, ref: ref ? ref[1] : undefined, secretLike, action: where,
          });
          if (secretLike && !ref) {
            errors.push(`${where}: input ${name} looks like a secret and must be a $NAME reference, not a literal`);
          }
        });
      });
    });
  });
  return { errors, refs, inputs };
}
