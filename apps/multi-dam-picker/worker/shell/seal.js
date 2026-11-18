// Authenticated encryption for the OAuth host (SPEC D7, D8): AES-256-GCM with a fresh random IV per value, a key id in
// the envelope (so a previous key can still open old values after a rotation) and caller-supplied authenticated data
// (the State key for a stored record, the purpose for tickets and states). Node's built-in `crypto` only.
import {
  createCipheriv, createDecipheriv, createHash, randomBytes,
} from 'node:crypto';
import { ConfigError } from './provider.js';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

const keyId = (key) => createHash('sha256').update(key).digest('hex').slice(0, 8);

/** Decodes a base64 or base64url 32-byte key. Throws ConfigError naming the setting, never the value. */
export function parseKey(value, setting) {
  if (typeof value !== 'string' || !BASE64.test(value.trim())) throw new ConfigError(setting);
  const key = Buffer.from(value.trim().replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (key.length !== KEY_BYTES) throw new ConfigError(setting);
  return key;
}

/**
 * A sealer over a current key and an optional previous one.
 * `seal(object, aad)` -> `<keyId>.<base64url(iv|tag|ciphertext)>`; `open(text, aad)` -> object or undefined (wrong key,
 * wrong authenticated data, tampering and malformed input are indistinguishable by design).
 */
export function createSealer({ current, previous }) {
  const keys = new Map([[keyId(current), current]]);
  if (previous) keys.set(keyId(previous), previous);
  return {
    seal(value, aad = '') {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', current, iv);
      cipher.setAAD(Buffer.from(aad));
      const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return `${keyId(current)}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`;
    },
    open(text, aad = '') {
      if (typeof text !== 'string' || text.length > 16384) return undefined;
      const [id, data, ...extra] = text.split('.');
      const key = keys.get(id);
      if (!key || !data || extra.length) return undefined;
      try {
        const raw = Buffer.from(data, 'base64url');
        if (raw.length < IV_BYTES + TAG_BYTES) return undefined;
        const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
        decipher.setAAD(Buffer.from(aad));
        decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        const plain = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
        return JSON.parse(plain.toString('utf8'));
      } catch {
        return undefined;
      }
    },
  };
}

export const sha256Base64Url = (...parts) => createHash('sha256').update(parts.join('\u0000')).digest('base64url');
