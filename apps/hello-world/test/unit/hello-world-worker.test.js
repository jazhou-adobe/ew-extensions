import { expect } from '@esm-bundle/chai';
import { mountHelloWorld } from '../../hello-world-render.js';
import { WORKERS, workerFor } from '../../hello-world-worker.js';
import { createSdkStub } from '../../../../test/support/sdk-stub.js';

const SIGNATURE = 'a'.repeat(64);

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function recorder(respond) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    return respond(url, init);
  };
  return { calls, fetchImpl };
}

async function mount({
  token = 'sdk-token-xyz', hostname = 'localhost', fetchImpl, workerTimeoutMs = 50, standalone = false,
} = {}) {
  const root = document.createElement('main');
  document.body.append(root);
  const sdk = standalone ? new Promise(() => {}) : Promise.resolve(createSdkStub({ token }));
  await mountHelloWorld(root, sdk, {
    timeoutMs: 20, fetchImpl, hostname, workerTimeoutMs,
  });
  const button = (label) => [...root.querySelectorAll('button')].find((b) => b.textContent.startsWith(label));
  const status = () => root.querySelector('p[aria-live]');
  const clicked = async (label) => {
    button(label).click();
    for (let i = 0; i < 50 && /Calling/.test(status().textContent); i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => {
        setTimeout(r, 5);
      });
    }
    return status().textContent;
  };
  return { root, button, clicked };
}

describe('hello-world worker call', () => {
  afterEach(() => {
    document.body.replaceChildren();
    window.history.replaceState(null, '', window.location.pathname);
  });

  it('HP1: "Call worker" sends the SDK token as a bearer header to the configured worker and shows the signature', async () => {
    const { calls, fetchImpl } = recorder(() => json(200, { message: 'hello world', algorithm: 'HMAC-SHA-256', signature: SIGNATURE }));
    const { clicked } = await mount({ fetchImpl });
    const text = await clicked('Call worker');
    expect(calls).to.have.length(1);
    expect(calls[0].url).to.equal(`${WORKERS.stage}/hello/sign?message=hello%20world`);
    expect(calls[0].headers.authorization).to.equal('Bearer sdk-token-xyz');
    expect(text).to.contain(SIGNATURE);
  });

  it('HP2: "Call without token" sends no Authorization header and shows the 401 status and code', async () => {
    const { calls, fetchImpl } = recorder(() => json(401, { error: { code: 'unauthorized', message: 'x', requestId: 'r' } }));
    const { clicked } = await mount({ fetchImpl });
    const text = await clicked('Call without token');
    expect(Object.keys(calls[0].headers)).to.not.include('authorization');
    expect(text).to.contain('401');
    expect(text).to.contain('unauthorized');
  });

  it('HP3: 5xx, a rejected fetch and a slow response show a short plain message', async () => {
    const cases = {
      '5xx': () => json(502, { error: { code: 'upstream_unavailable' } }),
      rejected: () => Promise.reject(new TypeError('Failed to fetch')),
      slow: (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    };
    for (const respond of Object.values(cases)) {
      // eslint-disable-next-line no-await-in-loop
      const { clicked } = await mount({ fetchImpl: recorder(respond).fetchImpl });
      // eslint-disable-next-line no-await-in-loop
      const text = await clicked('Call worker');
      expect(text).to.contain('unavailable');
      expect(text).to.not.match(/TypeError|Failed to fetch|at \w+/);
      document.body.replaceChildren();
    }
  });

  it('HP4: the token never appears in the DOM or console output', async () => {
    const logged = [];
    const originals = ['log', 'info', 'warn', 'error'].map((k) => [k, console[k]]);
    originals.forEach(([k]) => {
      console[k] = (...a) => logged.push(a.join(' '));
    });
    try {
      const { root, clicked } = await mount({ fetchImpl: recorder(() => json(200, { message: 'm', signature: SIGNATURE })).fetchImpl });
      await clicked('Call worker');
      expect(root.innerHTML).to.not.contain('sdk-token-xyz');
      expect(logged.join('\n')).to.not.contain('sdk-token-xyz');
    } finally {
      originals.forEach(([k, f]) => {
        console[k] = f;
      });
    }
  });

  it('HP5: a ?worker= parameter in the page URL is ignored', async () => {
    window.history.replaceState(null, '', `${window.location.pathname}?worker=https://evil.example`);
    const { calls, fetchImpl } = recorder(() => json(200, { message: 'm', signature: SIGNATURE }));
    const { clicked } = await mount({ fetchImpl });
    await clicked('Call worker');
    expect(calls[0].url.startsWith(WORKERS.stage)).to.equal(true);
    expect(calls[0].url).to.not.contain('evil.example');
  });

  it('HP6: both buttons are disabled in the standalone state', async () => {
    const { button } = await mount({ standalone: true, fetchImpl: recorder(() => json(200, {})).fetchImpl });
    expect(button('Call worker').disabled).to.equal(true);
    expect(button('Call without token').disabled).to.equal(true);
  });

  it('HP7: the worker is chosen from the page hostname', () => {
    ['main--ew-extensions--jazhou-adobe.aem.live', 'main--ew-extensions--jazhou-adobe.aem.page', 'main--ew-extensions--jazhou-adobe.preview.da.live']
      .forEach((h) => expect(workerFor(h)).to.deep.equal({ env: 'production', base: WORKERS.production }));
    ['my-branch--ew-extensions--jazhou-adobe.aem.live', 'localhost']
      .forEach((h) => expect(workerFor(h)).to.deep.equal({ env: 'stage', base: WORKERS.stage }));
    ['evil.example', 'main--ew-extensions-demo--jazhou-adobe.aem.live', 'main--ew-extensions--jazhou-adobe.aem.live.evil.com', 'da.live', '']
      .forEach((h) => expect(workerFor(h)).to.equal(null));
  });

  it('HP7: with no worker for the hostname the buttons are disabled with an explanation', async () => {
    const { root, button } = await mount({ hostname: 'evil.example', fetchImpl: recorder(() => json(200, {})).fetchImpl });
    expect(button('Call worker').disabled).to.equal(true);
    expect(root.textContent).to.contain('No worker is configured');
  });
});
