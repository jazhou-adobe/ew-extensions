// The two real actions (`api` and `oauth`) behind the template kit, sharing one store and clock, with a fake IMS, a fake
// Dropbox and a fake Cloudinary as the outside world. `signIn()` runs the whole pop-up flow as a browser would.
import { randomBytes } from 'node:crypto';
import { createAction, memoryStore } from '../../../../../shared/worker-template/src/index.js';
import { fakeIms, makeInputs, makeParams } from '../../../../../shared/worker-template/test-kit/index.js';
import cloudinary from '../../../providers/cloudinary/worker/index.js';
import dropbox from '../../../providers/dropbox/worker/index.js';
import { fakeDropbox } from '../../../providers/dropbox/worker/test/support/fake-dropbox.js';
import { fakeCloudinary } from '../../../providers/cloudinary/worker/test/support/fake-cloudinary.js';
import { createRoutes } from '../../shell/routes.js';
import { createOAuthRoutes } from '../../shell/oauth.js';
import { cloudInputs, KEY, SECRET } from './world.js';

export const OAUTH_BASE = 'https://281295-ewextensions-stage.adobeioruntime.net/api/v1/web/multi-dam-picker/oauth';
export const OAUTH_PREFIX = new URL(OAUTH_BASE).pathname;
export const CLIENT_ID = 'dbxappkey12345';
export const CLIENT_SECRET = `dbx-secret-${randomBytes(6).toString('hex')}`;
export const TOKEN_ENC_KEY = randomBytes(32).toString('base64');
export const OAUTH_STATE_KEY = randomBytes(32).toString('base64');

export const dropboxInputs = (overrides = {}) => ({
  DROPBOX_CLIENT_ID: CLIENT_ID,
  DROPBOX_CLIENT_SECRET: CLIENT_SECRET,
  DROPBOX_ROOT_PATH: '/Brand',
  DROPBOX_SCOPES: 'account_info.read files.metadata.read files.content.read sharing.read sharing.write',
  DROPBOX_CACHE_SECONDS: '0',
  OAUTH_PUBLIC_BASE_URL: OAUTH_BASE,
  TOKEN_ENC_KEY,
  OAUTH_STATE_KEY,
  ...overrides,
});

const parseSetCookie = (header) => (header ? header.split(';')[0] : undefined);

/**
 * @param {{ providers?: object[], inputs?: object, dropbox?: object, cloud?: object, now?: number, hostedKinds?: string[] }} options
 */
export async function oauthWorld({
  providers = [cloudinary, dropbox], inputs = {}, dropbox: dbxOptions = {}, cloud: cloudOptions = {}, now = Date.now(),
  extraVendors = [],
} = {}) {
  const ims = await fakeIms();
  const clock = { now };
  const latency = { ms: 0 };
  const logs = [];
  const sleeps = [];
  const merged = {
    ...makeInputs({ IMS_ORIGIN: ims.origin }), ...cloudInputs({ CLOUDINARY_CACHE_SECONDS: '0' }), ...dropboxInputs(), ...inputs,
  };
  const dbx = fakeDropbox({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, now: () => clock.now, ...dbxOptions,
  });
  const cloud = fakeCloudinary({ key: KEY, secret: SECRET, ...cloudOptions });
  const store = memoryStore({ workerName: 'multi-dam-picker', now: () => clock.now });
  const outbound = async (url, init) => {
    const u = String(url);
    if (u.startsWith(ims.origin)) return ims.fetch(u, init);
    const host = new URL(u).hostname;
    const extra = extraVendors.find((v) => v.hosts.includes(host));
    if (extra) return extra.fake.fetch(u, init);
    if (host.endsWith('dropbox.com') || host.endsWith('dropboxapi.com')) {
      try {
        return await dbx.fetch(u, init);
      } finally {
        clock.now += latency.ms;
      }
    }
    return cloud.fetch(u, init);
  };
  const deps = {
    fetch: outbound,
    now: () => clock.now,
    random: () => 1,
    sleep: async (ms) => { sleeps.push(ms); clock.now += ms; },
    log: (line) => logs.push(line),
    store,
  };
  const secrets = providers.flatMap((p) => p.config.secrets);
  const api = createAction({ name: 'multi-dam-picker', routes: createRoutes({ providers }), secrets }, deps);
  const oauth = createAction({
    name: 'multi-dam-picker', mode: 'public', routes: createOAuthRoutes({ providers }), secrets,
  }, deps);
  const wrap = async (res) => ({ ...res, json: () => JSON.parse(res.body) });
  const world = {
    /** Milliseconds every Dropbox call takes on the injected clock. */
    latency,
    ims, dbx, cloud, store, clock, logs, sleeps, inputs: merged,
    token: (userId = 'user-1@AdobeID') => ims.signToken({ now: clock.now, claims: { user_id: userId } }),
    /** An `api` call as `user` (default user-1); `token: null` for none. */
    async call({
      user = 'user-1@AdobeID', token, origin = 'https://da.live', headers = {}, ...rest
    } = {}) {
      const bearer = token === undefined ? await world.token(user) : token;
      return wrap(await api(makeParams({
        inputs: merged, ...rest, headers: { ...(origin ? { origin } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers },
      })));
    },
    /** An `oauth` call: path relative to the action (`/dropbox/begin`). */
    async oauthCall({ headers = {}, ...rest } = {}) {
      return wrap(await oauth(makeParams({ inputs: merged, ...rest, headers })));
    },
    /** The whole connect flow of one author in one browser; returns the pieces for assertions. */
    async signIn({
      user = 'user-1@AdobeID', provider = 'dropbox', deny = false, scope, until, authorize,
    } = {}) {
      const connect = await world.call({ user, method: 'POST', path: `/dam/${provider}/connect` });
      if (connect.statusCode !== 200) return { connect };
      const begin = new URL(connect.json().beginUrl);
      const beginRes = await world.oauthCall({
        path: begin.pathname.slice(OAUTH_PREFIX.length), query: begin.search.slice(1),
      });
      const cookie = parseSetCookie(beginRes.headers['set-cookie']);
      if (beginRes.statusCode !== 302) return { connect, beginRes };
      if (until === 'begin') return { connect, beginRes, cookie };
      const back = new URL(authorize ? authorize(beginRes.headers.location) : dbx.authorize(beginRes.headers.location, { deny, scope }));
      if (until === 'authorize') return { connect, beginRes, cookie, back };
      const callback = await world.oauthCall({
        path: back.pathname.slice(OAUTH_PREFIX.length), query: back.search.slice(1), headers: cookie ? { cookie } : {},
      });
      return {
        connect, beginRes, cookie, back, callback,
      };
    },
    all: () => [...logs],
  };
  return world;
}
