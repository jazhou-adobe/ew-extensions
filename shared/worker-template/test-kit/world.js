import { createAction } from '../src/action.js';
import { memoryStore } from '../src/store.js';
import { fakeIms } from './fake-ims.js';
import { fakeUpstream } from './fake-upstream.js';
import { makeInputs, makeParams } from './make-params.js';

/**
 * Wires a worker under test to the fake outside world: fake IMS, fake vendor, memory store, captured logs,
 * a fixed clock and instant sleeps.
 * `call(request)` builds raw params and invokes `main`; a valid token is added unless `token: null`.
 *
 * `vendor` replaces the scripted `upstream` with any double that has a `fetch(url, init)`.
 *
 * @param {{ name?: string, routes: object, secrets?: string[], authorize?: Function,
 *           inputs?: object, upstream?: Array, vendor?: { fetch: Function }, deps?: object, now?: number }} options
 */
export async function makeWorld({
  name = 'test-worker', routes, secrets = [], authorize, inputs, upstream, vendor: vendorDouble, deps = {},
  now = Date.now(),
}) {
  const ims = await fakeIms();
  const vendor = vendorDouble ?? fakeUpstream(upstream);
  const logs = [];
  const sleeps = [];
  const clock = { now };
  const outbound = async (url, init) => (
    String(url).startsWith(ims.origin) ? ims.fetch(url, init) : vendor.fetch(url, init)
  );
  const store = memoryStore({ workerName: name, now: () => clock.now });
  const worldInputs = makeInputs(inputs);
  const main = createAction({
    name, routes, secrets, authorize,
  }, {
    fetch: outbound,
    now: () => clock.now,
    random: () => 1,
    sleep: async (ms) => { sleeps.push(ms); },
    log: (line) => logs.push(line),
    store,
    ...deps,
  });
  return {
    ims,
    vendor,
    logs,
    sleeps,
    clock,
    store,
    inputs: worldInputs,
    main,
    async call({
      token, origin = 'https://da.live', headers = {}, ...rest
    } = {}) {
      const bearer = token === undefined ? await ims.signToken({ now: clock.now }) : token;
      const params = makeParams({
        inputs: worldInputs,
        ...rest,
        headers: {
          ...(origin ? { origin } : {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...headers,
        },
      });
      const res = await main(params);
      return { ...res, json: () => JSON.parse(res.body) };
    },
  };
}
