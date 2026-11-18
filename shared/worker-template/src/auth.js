import {
  createRemoteJWKSet, customFetch, jwtVerify, errors,
} from 'jose';
import { HttpError } from './errors.js';
import { splitList } from './cors.js';

const DEFAULT_IMS_ORIGIN = 'https://ims-na1.adobelogin.com';

/** Extracts the bearer token from the Authorization header; null when absent or malformed. */
export function bearerToken(header) {
  if (typeof header !== 'string') return null;
  const m = /^bearer ([^\s,]+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

const TOKEN_ERRORS = [
  errors.JWTInvalid, errors.JWSInvalid, errors.JWTExpired, errors.JWSSignatureVerificationFailed,
  errors.JWKSNoMatchingKey, errors.JWKSMultipleMatchingKeys, errors.JOSEAlgNotAllowed,
  errors.JWTClaimValidationFailed, errors.JOSENotSupported,
];

function msClaim(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * In-action IMS token verification (SPEC Decision 5, same checks as da-admin): RS256 signature against
 * the IMS key set, `type = access_token`, `created_at + expires_in` (ms) in the future, optional client id
 * allowlist. The key set is cached for the life of the container.
 */
export function createAuthenticator({
  imsOrigin = DEFAULT_IMS_ORIGIN, fetchImpl, now, cooldownMs, allowedClientIds,
}) {
  const jwksUrl = new URL('/ims/keys', imsOrigin || DEFAULT_IMS_ORIGIN);
  const options = { [customFetch]: fetchImpl };
  if (cooldownMs !== undefined) options.cooldownDuration = cooldownMs;
  const jwks = createRemoteJWKSet(jwksUrl, options);
  const clientIds = splitList(allowedClientIds);

  /** @returns {Promise<{ identity: object, claims: object }>} throws HttpError unauthorized | auth_unavailable */
  return async function authenticate(token) {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, { algorithms: ['RS256'], currentDate: new Date(now()) }));
    } catch (e) {
      if (TOKEN_ERRORS.some((C) => e instanceof C)) throw new HttpError('unauthorized', { cause: e });
      throw new HttpError('auth_unavailable', { cause: e });
    }
    const createdAt = msClaim(payload.created_at);
    const expiresIn = msClaim(payload.expires_in);
    if (payload.type !== 'access_token' || Number.isNaN(createdAt) || Number.isNaN(expiresIn)) {
      throw new HttpError('unauthorized');
    }
    const expiresAt = createdAt + expiresIn;
    if (expiresAt <= now()) throw new HttpError('unauthorized');
    if (clientIds.length && !clientIds.includes(payload.client_id)) throw new HttpError('unauthorized');
    return {
      identity: {
        userId: typeof payload.user_id === 'string' ? payload.user_id : undefined,
        clientId: typeof payload.client_id === 'string' ? payload.client_id : undefined,
        expiresAt,
      },
      claims: Object.freeze({ ...payload }),
    };
  };
}
