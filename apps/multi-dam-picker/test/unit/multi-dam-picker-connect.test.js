import { expect } from '@esm-bundle/chai';
import {
  fakeWorker, flush, IMAGE, item, json, mount, provider,
} from './harness.js';

const WORKER_ORIGIN = 'https://281295-ewextensions-stage.adobeioruntime.net';
const BEGIN = `${WORKER_ORIGIN}/api/v1/web/multi-dam-picker/oauth/dropbox/begin?ticket=abc.def`;
const dbx = (connection = { state: 'not_connected' }, extra = {}) => provider({
  id: 'dropbox', label: 'Dropbox', credentialKind: 'user-oauth', connection, ...extra,
});
const page = (items = [item(1), item(2)]) => json(200, {
  items, page: 1, pageSize: 24, hasMore: false,
});

function fakePopup() {
  return {
    closed: false,
    closeCalls: 0,
    location: { href: '' },
    close() { this.closed = true; this.closeCalls += 1; },
  };
}

/**
 * A scripted worker: `sessions` is the list of connection states `session` answers in order (the last repeats).
 * `onSearch` can answer the browse call.
 */
function connectWorker({
  providers = [dbx()], sessions = [{ state: 'connected', account: 'Pat Example' }], connect, disconnect, onSearch,
} = {}) {
  let polled = 0;
  return fakeWorker((call) => {
    if (call.path === '/dam/providers') return json(200, { providers });
    if (call.path === '/dam/dropbox/connect') return connect ? connect() : json(200, { beginUrl: BEGIN });
    if (call.path === '/dam/dropbox/session') {
      const next = sessions[Math.min(polled, sessions.length - 1)];
      polled += 1;
      return json(200, { connection: next });
    }
    if (call.path === '/dam/dropbox/disconnect') return disconnect ? disconnect() : json(200, { connection: { state: 'not_connected' } });
    if (/^\/dam\/dropbox\/assets$/.test(call.path)) return onSearch ? onSearch(call) : page();
    if (/^\/dam\/dropbox\/assets\//.test(call.path)) return json(200, { asset: IMAGE() });
    return json(200, { items: [], page: 1, pageSize: 24, hasMore: false });
  });
}

const openWith = (popup) => {
  const calls = [];
  const fn = (...args) => { calls.push(args); return popup; };
  fn.calls = calls;
  return fn;
};
const button = (ui, text) => ui.$$('button').find((b) => b.textContent === text);
const paths = (w) => w.calls.map((c) => `${c.method} ${c.path}`);

afterEach(() => { document.body.replaceChildren(); });

describe('UO1: connection states of an OAuth provider', () => {
  it('not connected: "Connect to <label>" and no grid; connected: the grid, "Connected as <name>" and Disconnect', async () => {
    const w = connectWorker();
    const ui = await mount({ worker: w, openWindow: openWith(fakePopup()), token: 'ims-token-canary' });
    expect(ui.$('.connect-status').textContent).to.contain('Connect to Dropbox');
    expect(button(ui, 'Connect to Dropbox')).to.not.equal(undefined);
    expect(ui.$('.grid')).to.equal(null);
    expect(w.searches()).to.have.length(0);
    const on = await mount({ worker: connectWorker({ providers: [dbx({ state: 'connected', account: 'Pat Example' })] }), openWindow: openWith(fakePopup()), token: 'ims-token-canary' });
    expect(on.$('.connect-status').textContent).to.equal('Connected as Pat Example');
    expect(button(on, 'Disconnect')).to.not.equal(undefined);
    expect(on.$('.grid')).to.not.equal(null);
    expect(document.body.innerHTML).to.not.contain('ims-token-canary');
  });
});

describe('UO2/UO3: the click opens the pop-up synchronously and navigates it to the worker', () => {
  it('window.open runs inside the click before any await; the pop-up is sent to the begin URL; the page never calls the provider', async () => {
    const popup = fakePopup();
    const open = openWith(popup);
    const openedBeforeConnect = [];
    const w = connectWorker({ connect: () => { openedBeforeConnect.push(open.calls.length); return json(200, { beginUrl: BEGIN }); } });
    const ui = await mount({ worker: w, openWindow: open });
    button(ui, 'Connect to Dropbox').click();
    expect(open.calls).to.have.length(1);
    await flush();
    expect(openedBeforeConnect).to.deep.equal([1], 'the pop-up existed before the worker was asked for anything');
    expect(popup.location.href).to.equal(BEGIN);
    expect(w.calls.find((c) => c.path === '/dam/dropbox/connect').method).to.equal('POST');
    expect(paths(w).every((p) => p.includes('/dam/'))).to.equal(true);
  });

  it('a blocked pop-up (window.open -> null) shows an instruction and a real link to the begin URL', async () => {
    const ui = await mount({ worker: connectWorker(), openWindow: openWith(null) });
    button(ui, 'Connect to Dropbox').click();
    await flush();
    const link = ui.$('a.connect-link');
    expect(link.getAttribute('href')).to.equal(BEGIN);
    expect(link.getAttribute('rel')).to.contain('noopener');
    expect(ui.$('.connect-status').textContent).to.contain('blocked');
  });
});

describe('UO4/UO5/UO6: polling for the connection', () => {
  it('polls about every 1.5 s backing off to 3 s; on connected the pop-up is closed and the grid loads without a reload', async () => {
    const popup = fakePopup();
    const w = connectWorker({ sessions: [{ state: 'not_connected' }, { state: 'not_connected' }, { state: 'not_connected' }, { state: 'connected', account: 'Pat Example' }] });
    const ui = await mount({ worker: w, openWindow: openWith(popup) });
    button(ui, 'Connect to Dropbox').click();
    await flush();
    const sessionCalls = () => w.calls.filter((c) => c.path === '/dam/dropbox/session').length;
    await ui.timers.advance(1400);
    expect(sessionCalls()).to.equal(0);
    await ui.timers.advance(200);
    expect(sessionCalls()).to.equal(1);
    await ui.timers.advance(1750);
    expect(sessionCalls()).to.equal(2);
    await ui.timers.advance(2000);
    expect(sessionCalls()).to.equal(3);
    expect(ui.$('.grid')).to.equal(null, 'a stale "not connected" answer does not end the wait');
    await ui.timers.advance(2300);
    expect(sessionCalls()).to.equal(4);
    expect(popup.closeCalls).to.equal(1);
    expect(ui.$('.connect-status').textContent).to.equal('Connected as Pat Example');
    expect(w.searches()).to.have.length(1);
    expect(ui.$('.grid')).to.not.equal(null);
  });

  it('the author closing the pop-up without connecting gets a final check, then a message with a retry', async () => {
    const popup = fakePopup();
    const w = connectWorker({ sessions: [{ state: 'not_connected' }] });
    const ui = await mount({ worker: w, openWindow: openWith(popup) });
    button(ui, 'Connect to Dropbox').click();
    await flush();
    popup.closed = true;
    await ui.timers.advance(1600);
    expect(w.calls.filter((c) => c.path === '/dam/dropbox/session')).to.have.length(1);
    expect(ui.$('.connect-status').textContent).to.contain('closed');
    expect(button(ui, 'Connect to Dropbox')).to.not.equal(undefined);
    expect(w.searches()).to.have.length(0);
  });

  it('gives up at the deadline with a message and a way to retry', async () => {
    const w = connectWorker({ sessions: [{ state: 'not_connected' }] });
    const ui = await mount({ worker: w, openWindow: openWith(fakePopup()) });
    button(ui, 'Connect to Dropbox').click();
    await flush();
    await ui.timers.advance(6 * 60 * 1000);
    expect(ui.$('.connect-status').textContent).to.contain('took too long');
    expect(button(ui, 'Connect to Dropbox')).to.not.equal(undefined);
  });
});

describe('UO7/UO8: the connection ending in between and administrator errors', () => {
  it('an in-band 409 from a browse call flips the panel to Reconnect or Connect without a reload and clears the grid', async () => {
    for (const [code, expected] of [['provider_reauth_required', 'Reconnect'], ['provider_not_connected', 'Connect to Dropbox']]) {
      // eslint-disable-next-line no-await-in-loop
      const ui = await mount({
        worker: connectWorker({
          providers: [dbx({ state: 'connected', account: 'Pat Example' })],
          onSearch: () => json(409, { error: { code, message: 'x', requestId: 'r' } }),
        }),
        openWindow: openWith(fakePopup()),
      });
      expect(button(ui, expected), code).to.not.equal(undefined);
      expect(ui.$('.grid')).to.equal(null);
      expect(ui.$('input[type=search]')).to.equal(null, 'search is disabled');
      expect(document.activeElement).to.equal(ui.$('.connect-status'));
    }
  });

  it('500 misconfigured while connecting says "ask your administrator" and offers neither Connect nor Reconnect', async () => {
    const ui = await mount({
      worker: connectWorker({ connect: () => json(500, { error: { code: 'misconfigured', message: 'x', requestId: 'r' } }) }),
      openWindow: openWith(fakePopup()),
    });
    button(ui, 'Connect to Dropbox').click();
    await flush();
    expect(ui.$('.connect-status').textContent).to.contain('Ask your administrator');
    expect(ui.$$('button')).to.have.length(0);
  });
});

describe('UO9: disconnect', () => {
  it('POSTs disconnect and shows Connect; a failing disconnect keeps the state with an error', async () => {
    const w = connectWorker({ providers: [dbx({ state: 'connected', account: 'Pat Example' })] });
    const ui = await mount({ worker: w, openWindow: openWith(fakePopup()) });
    button(ui, 'Disconnect').click();
    await flush();
    expect(w.calls.find((c) => c.path === '/dam/dropbox/disconnect').method).to.equal('POST');
    expect(button(ui, 'Connect to Dropbox')).to.not.equal(undefined);
    expect(ui.$('.grid')).to.equal(null);
    const failing = await mount({
      worker: connectWorker({ providers: [dbx({ state: 'connected', account: 'Pat Example' })], disconnect: () => json(503, { error: { code: 'store_unavailable' } }) }),
      openWindow: openWith(fakePopup()),
    });
    button(failing, 'Disconnect').click();
    await flush();
    expect(failing.$('.connect-status').textContent).to.contain('unavailable');
    expect(button(failing, 'Disconnect')).to.not.equal(undefined);
    expect(failing.$('.grid')).to.not.equal(null);
  });
});

describe('UO10/UO11: several sources, accessibility', () => {
  it('a service provider never shows a connect panel; switching keeps each provider\'s state', async () => {
    const service = provider();
    const w = connectWorker({ providers: [service, dbx()] });
    const ui = await mount({ worker: w, openWindow: openWith(fakePopup()) });
    expect(ui.$('.connect')).to.equal(null);
    expect(ui.$('.grid')).to.not.equal(null);
    const switcher = ui.$('.source select');
    switcher.value = 'dropbox';
    switcher.dispatchEvent(new Event('change'));
    await flush();
    expect(ui.$('h1.title').textContent).to.equal('Dropbox Asset Picker');
    expect(button(ui, 'Connect to Dropbox')).to.not.equal(undefined);
    switcher.value = 'cloudinary';
    switcher.dispatchEvent(new Event('change'));
    await flush();
    expect(ui.$('.connect')).to.equal(null);
  });

  it('Connect, Disconnect and Reconnect are real buttons; the status is a polite live region that takes focus after a change', async () => {
    const ui = await mount({ worker: connectWorker({ providers: [dbx({ state: 'reauth_required', account: 'Pat Example' })] }), openWindow: openWith(fakePopup()) });
    const status = ui.$('.connect-status');
    expect(status.getAttribute('role')).to.equal('status');
    expect(status.getAttribute('aria-live')).to.equal('polite');
    expect(button(ui, 'Reconnect').tagName).to.equal('BUTTON');
    expect(button(ui, 'Reconnect').getAttribute('type')).to.equal('button');
  });
});

describe('UO13: only the worker\'s own https origin is ever opened; failures end plainly', () => {
  const evil = [
    'http://281295-ewextensions-stage.adobeioruntime.net/api/v1/web/multi-dam-picker/oauth/dropbox/begin?ticket=x',
    'https://281295-ewextensions-stage.adobeioruntime.net.evil.example/begin?ticket=x',
    'https://evil.example/begin?ticket=x',
    'https://user:pw@281295-ewextensions-stage.adobeioruntime.net/begin',
    'javascript:alert(1)',
    'not a url',
  ];
  it('a begin URL elsewhere is never navigated to: a short generic error and the pop-up is closed', async () => {
    for (const beginUrl of evil) {
      const popup = fakePopup();
      // eslint-disable-next-line no-await-in-loop
      const ui = await mount({ worker: connectWorker({ connect: () => json(200, { beginUrl }) }), openWindow: openWith(popup) });
      button(ui, 'Connect to Dropbox').click();
      // eslint-disable-next-line no-await-in-loop
      await flush();
      expect(popup.location.href, beginUrl).to.equal('');
      expect(popup.closeCalls).to.equal(1);
      expect(ui.$('a.connect-link')).to.equal(null);
      expect(ui.$('.connect-status').textContent).to.contain('Something went wrong');
    }
  });

  it('a rejected fetch, a 5xx and a slow session all end in "unavailable" with a retry', async () => {
    const rejected = fakeWorker((call) => {
      if (call.path === '/dam/providers') return json(200, { providers: [dbx()] });
      throw new TypeError('Failed to fetch');
    });
    const a = await mount({ worker: rejected, openWindow: openWith(fakePopup()) });
    button(a, 'Connect to Dropbox').click();
    await flush();
    expect(a.$('.connect-status').textContent).to.contain('unavailable');
    expect(button(a, 'Try again')).to.not.equal(undefined);
    expect(a.root.textContent).to.not.match(/TypeError/);
    const b = await mount({ worker: connectWorker({ connect: () => json(502, { error: { code: 'upstream_unavailable' } }) }), openWindow: openWith(fakePopup()) });
    button(b, 'Connect to Dropbox').click();
    await flush();
    expect(b.$('.connect-status').textContent).to.contain('unavailable');
    const polling = fakeWorker((call) => {
      if (call.path === '/dam/providers') return json(200, { providers: [dbx()] });
      if (call.path === '/dam/dropbox/connect') return json(200, { beginUrl: BEGIN });
      return json(503, { error: { code: 'store_unavailable' } });
    });
    const c = await mount({ worker: polling, openWindow: openWith(fakePopup()) });
    button(c, 'Connect to Dropbox').click();
    await flush();
    await c.timers.advance(1600);
    expect(c.$('.connect-status').textContent).to.contain('unavailable');
    expect(button(c, 'Try again')).to.not.equal(undefined);
  });
});

describe('DBX-UI1/UI2/UI4: Dropbox-shaped data', () => {
  const connected = { state: 'connected', account: 'Pat Example' };
  const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

  it('renders inline thumbnails, a placeholder without one, and makes no network request for images', async () => {
    const w = connectWorker({
      providers: [dbx(connected)],
      onSearch: () => page([item(1, { thumbnailUrl: JPEG, extension: 'jpg' }), item(2, { type: 'document', extension: 'pdf' })]),
    });
    const ui = await mount({ worker: w, openWindow: openWith(fakePopup()) });
    const imgs = ui.$$('.thumb img');
    expect(imgs).to.have.length(1);
    expect(imgs[0].getAttribute('src')).to.equal(JPEG);
    expect(ui.$$('.placeholder')[0].textContent).to.equal('PDF');
    expect(w.calls.every((c) => c.url.startsWith('https://281295-ewextensions-stage'))).to.equal(true);
  });

  it('a data: URL in a rendition or link is neither shown nor insertable; a single rendition shows without a chooser; a blocked asset disables Insert with its reason', async () => {
    const bad = IMAGE({ renditions: [{ id: 'original', label: 'Original (1 KB)', url: JPEG, kind: 'original' }], defaultRenditionId: 'original' });
    const make = (asset) => {
      const base = connectWorker({ providers: [dbx(connected)], onSearch: () => page([item(1)]) });
      const inner = base.fetchImpl;
      base.fetchImpl = async (url, init) => {
        if (new URL(url).pathname.endsWith(`/assets/${item(1).id}`)) return json(200, { asset });
        return inner(url, init);
      };
      return base;
    };
    const ui = await mount({ worker: make(bad), openWindow: openWith(fakePopup()) });
    ui.$('button.item').click();
    await flush();
    expect(ui.$('.preview img')).to.equal(null);
    expect(ui.$('button.insert').disabled).to.equal(true);
    const blocked = IMAGE({
      renditions: [], defaultRenditionId: undefined, insertable: { ok: false, reason: 'Dropbox does not allow a public link for this file.' },
    });
    const ui2 = await mount({ worker: make(blocked), openWindow: openWith(fakePopup()) });
    ui2.$('button.item').click();
    await flush();
    expect(ui2.$('button.insert').disabled).to.equal(true);
    expect(ui2.root.textContent).to.contain('does not allow a public link');
    const single = IMAGE({
      renditions: [{ id: 'original', label: 'Original (1 KB)', url: 'https://www.dropbox.com/scl/fi/a/b.jpg?rlkey=k&raw=1', kind: 'original' }],
      defaultRenditionId: 'original',
      alt: { value: 'Hero Banner', source: 'name' },
    });
    const ui3 = await mount({ worker: make(single), openWindow: openWith(fakePopup()) });
    ui3.$('button.item').click();
    await flush();
    expect(ui3.$$('.detail select')).to.have.length(1);
    expect(ui3.$('.preview img').getAttribute('src')).to.contain('raw=1');
    expect(ui3.root.textContent).to.contain('file name');
    ui3.$('button.insert').click();
    expect(ui3.sdk.calls.map((c) => c[0])).to.deep.equal(['sendHTML', 'closeLibrary']);
    expect(ui3.sdk.calls[0][1]).to.contain('raw=1');
  });
});
