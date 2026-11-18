import { HttpError } from './errors.js';

export const REDACTED = '[redacted]';
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD/i;

/** Names of inputs that must be treated as secrets: declared ones plus anything that looks like one. */
export function secretNamesFor(inputNames, declared) {
  const names = new Set(declared);
  inputNames.forEach((n) => {
    if (!n.startsWith('__ow_') && SECRET_NAME.test(n)) names.add(n);
  });
  return names;
}

/**
 * Per-request secret handling: accessor, config view, and a redactor that replaces every known secret
 * value (and the caller's token) in strings with a fixed marker.
 */
export function createSecrets(params, declared, { onMissing } = {}) {
  const inputNames = Object.keys(params).filter((k) => !k.startsWith('__ow_'));
  const names = secretNamesFor(inputNames, declared);
  const values = new Set();
  names.forEach((n) => {
    if (typeof params[n] === 'string' && params[n]) values.add(params[n]);
  });
  const config = {};
  inputNames.forEach((n) => {
    if (names.has(n)) return;
    // Numbers and booleans (YAML literals in the app config) reach the action as native values: expose them as text.
    if (typeof params[n] === 'string') config[n] = params[n];
    else if (typeof params[n] === 'number' || typeof params[n] === 'boolean') config[n] = String(params[n]);
  });
  Object.freeze(config);

  const secret = (name) => {
    const value = params[name];
    if (typeof value !== 'string' || !value) {
      if (onMissing) onMissing(name);
      throw new HttpError('misconfigured');
    }
    values.add(value);
    return value;
  };

  const optionalSecret = (name) => {
    const value = params[name];
    if (typeof value !== 'string' || !value) return undefined;
    values.add(value);
    return value;
  };

  const forms = () => [...values].flatMap((v) => {
    const json = JSON.stringify(v).slice(1, -1);
    return json === v ? [v] : [v, json];
  });
  const redact = (text) => forms().reduce((acc, v) => acc.split(v).join(REDACTED), text);
  const redactValue = (v) => (typeof v === 'string' ? redact(v) : v);

  return {
    config,
    secret,
    optionalSecret,
    redact,
    redactValue,
    addSensitive: (value) => { if (value) values.add(value); },
  };
}
