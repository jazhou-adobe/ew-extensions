// Routes: 'METHOD /path' -> async (ctx) => value | { statusCode, headers, body }.
// ctx: request, identity, claims, config, secret(name), store, proxy(url, init, options), requestId, log.
// Throw `new HttpError('bad_request')` etc. for expected errors; anything else becomes `500 internal`.

export const routes = {
  'GET /__EXT__/whoami': async ({ identity }) => ({ userId: identity.userId }),
};
