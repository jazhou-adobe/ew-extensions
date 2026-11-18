/** Error contract (SPEC Decision 12): stable codes, fixed messages, no input echo, no upstream text. */

export const ERRORS = {
  bad_request: { status: 400, message: 'The request is invalid.' },
  unauthorized: { status: 401, message: 'A valid Adobe IMS access token is required.' },
  forbidden_origin: { status: 403, message: 'This origin is not allowed.' },
  forbidden: { status: 403, message: 'This caller is not allowed to do that.' },
  not_found: { status: 404, message: 'Not found.' },
  method_not_allowed: { status: 405, message: 'Method not allowed.' },
  payload_too_large: { status: 413, message: 'The request is too large.' },
  provider_not_connected: { status: 409, message: 'The provider is not connected for this user.' },
  provider_reauth_required: { status: 409, message: 'The provider connection must be renewed.' },
  rate_limited: { status: 429, message: 'Too many requests. Try again later.' },
  misconfigured: { status: 500, message: 'The service is not configured correctly.' },
  internal: { status: 500, message: 'Internal error.' },
  upstream_unavailable: { status: 502, message: 'An upstream service is unavailable.' },
  upstream_too_large: { status: 502, message: 'An upstream response was too large.' },
  auth_unavailable: { status: 503, message: 'Authentication is temporarily unavailable.' },
  store_unavailable: { status: 503, message: 'Storage is temporarily unavailable.' },
};

/** Throw from a handler to produce the matching error response. */
export class HttpError extends Error {
  /**
   * @param {keyof typeof ERRORS} code
   * @param {{ retryAfterSeconds?: number, cause?: unknown }} [options]
   */
  constructor(code, { retryAfterSeconds, cause } = {}) {
    super(ERRORS[code] ? ERRORS[code].message : ERRORS.internal.message, { cause });
    this.name = 'HttpError';
    this.code = ERRORS[code] ? code : 'internal';
    this.status = ERRORS[this.code].status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
