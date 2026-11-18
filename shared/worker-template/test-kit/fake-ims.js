import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const DAY_MS = 86400000;

/**
 * Fake Adobe IMS: a locally generated RS256 key pair, its key set served through an injectable `fetch`
 * (and optionally a real HTTP server), and a token factory that mints IMS-shaped access tokens
 * (`type`, `user_id`, `client_id`, `created_at`, `expires_in` in ms as strings, header `kid`).
 */
export async function fakeIms({ kid = 'test-key-1', origin = 'https://ims.test' } = {}) {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = {
    ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig',
  };
  const ims = {
    origin,
    kid,
    publicKey,
    privateKey,
    keyRequests: 0,
    keySet: { keys: [jwk] },
    /** Make the key endpoint fail: a status code, 'garbage' (200 with invalid JSON) or 'network'. */
    failWith: undefined,
  };

  ims.fetch = async (url) => {
    const { pathname } = new URL(url);
    if (pathname !== '/ims/keys') return new Response('not found', { status: 404 });
    ims.keyRequests += 1;
    if (ims.failWith === 'network') throw new TypeError('fetch failed');
    if (ims.failWith === 'garbage') return new Response('<html>nope</html>', { status: 200 });
    if (typeof ims.failWith === 'number') return new Response('boom', { status: ims.failWith });
    return Response.json(ims.keySet);
  };

  /**
   * @param {{ claims?: object, header?: object, now?: number, key?: CryptoKey }} [overrides]
   *   claims: merged over the defaults; a key set to `undefined` removes the claim.
   */
  ims.signToken = async ({
    claims = {}, header = {}, now = Date.now(), key = privateKey,
  } = {}) => {
    const payload = {
      type: 'access_token',
      user_id: 'user-1@AdobeID',
      client_id: 'test-client',
      as: 'ims-na1',
      created_at: String(now),
      expires_in: String(DAY_MS),
      ...claims,
    };
    Object.keys(payload).forEach((k) => {
      if (payload[k] === undefined) delete payload[k];
    });
    return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid, ...header }).sign(key);
  };

  /** Serves the key set over real HTTP (for the emulator tier and e2e). Returns { origin, close }. */
  ims.listen = async () => {
    const server = createServer((req, res) => {
      if (req.url === '/ims/keys') {
        ims.keyRequests += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(ims.keySet));
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    return {
      origin: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
    };
  };
  return ims;
}
