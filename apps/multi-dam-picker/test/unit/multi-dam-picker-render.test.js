import { expect } from '@esm-bundle/chai';
import { WORKERS, workerFor } from '../../config.js';
import {
  caps, fakeWorker, fakeTimers, flush, IMAGE, ID, item, json, mount, provider, STAGE,
} from './harness.js';

const providersResponse = (list = [provider()]) => json(200, { providers: list });
const page = (items, extra = {}) => json(200, {
  items, page: 1, pageSize: 24, hasMore: false, ...extra,
});

/** A worker that serves providers, a search function and a detail function. */
function worker({ providers = [provider()], search = () => page([item(1), item(2)]), detail = () => json(200, { asset: IMAGE() }) } = {}) {
  return fakeWorker((call) => {
    if (call.path === '/dam/providers') return providersResponse(providers);
    if (/^\/dam\/[^/]+\/assets$/.test(call.path)) return search(call);
    return detail(call);
  });
}

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState(null, '', window.location.pathname);
});

describe('UI0: picker is named after the selected source', () => {
  it('reads "<label> Asset Picker" in the heading and page title, and follows the source switcher', async () => {
    const ui = await mount({ worker: worker({ providers: [provider(), provider({ id: 'other', label: 'Other DAM' })] }) });
    expect(ui.$('h1.title').textContent).to.equal('Cloudinary Asset Picker');
    expect(document.title).to.equal('Cloudinary Asset Picker');
    const switcher = ui.$('select');
    switcher.value = 'other';
    switcher.dispatchEvent(new Event('change'));
    await flush();
    expect(ui.$('h1.title').textContent).to.equal('Other DAM Asset Picker');
    expect(ui.$$('h1.title')).to.have.length(1);
  });

  it('keeps the generic name while the source list is loading or empty', async () => {
    const ui = await mount({ worker: worker({ providers: [] }) });
    expect(ui.$('h1.title').textContent).to.equal('Asset Picker');
  });
});

describe('UI1: providers and first grid', () => {
  it('awaits the SDK, lists providers with the bearer token, shows the grid with no connect prompt, never exposes the token', async () => {
    const spy = [];
    const originals = ['log', 'info', 'warn', 'error'].map((k) => [k, console[k]]);
    originals.forEach(([k]) => { console[k] = (...a) => spy.push(a.join(' ')); });
    try {
      const w = worker();
      const ui = await mount({ worker: w });
      expect(w.calls[0].path).to.equal('/dam/providers');
      expect(w.calls[0].url.startsWith(STAGE)).to.equal(true);
      expect(w.calls.every((c) => c.authorization === 'Bearer sdk-token-xyz')).to.equal(true);
      expect(ui.$$('button.item')).to.have.length(2);
      expect(ui.root.textContent.toLowerCase()).to.not.contain('connect');
      expect(ui.root.innerHTML).to.not.contain('sdk-token-xyz');
      expect(spy.join('\n')).to.not.contain('sdk-token-xyz');
    } finally {
      originals.forEach(([k, fn]) => { console[k] = fn; });
    }
  });
});

describe('UI2: no provider configured', () => {
  it('says no DAM is configured and shows no grid', async () => {
    const ui = await mount({ worker: worker({ providers: [] }) });
    expect(ui.root.textContent).to.contain('No DAM is configured on this site');
    expect(ui.$('.grid')).to.equal(null);
  });
});

describe('UI3/UI16: debounce and Enter', () => {
  it('searches once after the pause; Enter searches immediately; the first listing has no query and newest sort', async () => {
    const w = worker();
    const ui = await mount({ worker: w });
    expect(w.searches()).to.have.length(1);
    expect(w.searches()[0].query.q).to.equal(undefined);
    expect(w.searches()[0].query.sort).to.equal('newest');
    expect(w.searches()[0].query.page).to.equal('1');
    ui.type('beach');
    await ui.timers.advance(349);
    expect(w.searches()).to.have.length(1);
    await ui.timers.advance(1);
    expect(w.searches()).to.have.length(2);
    expect(w.searches()[1].query.q).to.equal('beach');
    ui.type('boat');
    ui.$('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(w.searches()).to.have.length(3);
    expect(w.searches()[2].query.q).to.equal('boat');
    await ui.timers.advance(1000);
    expect(w.searches()).to.have.length(3, 'the pending debounce was cancelled by Enter');
  });

  it('UI16: a scripted burst of ten keystrokes issues a single request', async () => {
    const w = worker();
    const ui = await mount({ worker: w });
    const before = w.searches().length;
    for (let i = 1; i <= 10; i += 1) {
      ui.type('beach boat'.slice(0, i));
      // eslint-disable-next-line no-await-in-loop
      await ui.timers.advance(50);
    }
    await ui.timers.advance(350);
    expect(w.searches().length - before).to.equal(1);
  });
});

describe('UI4: type and sort', () => {
  it('options come from capabilities; changing them resets to page 1 and sends type/sort', async () => {
    const small = provider({ capabilities: caps({ assetTypes: ['image', 'audio'] }) });
    const w = worker({ providers: [small], search: () => page([item(1)], { hasMore: true }) });
    const ui = await mount({ worker: w });
    const [type, sort] = ui.$$('select');
    expect([...type.options].map((o) => o.value)).to.deep.equal(['all', 'image', 'audio']);
    expect([...sort.options].map((o) => o.value)).to.deep.equal(['newest', 'oldest', 'relevance']);
    expect(sort.options[2].disabled).to.equal(true, 'relevance needs a query');
    ui.byText('button', 'Load more').click();
    await flush();
    expect(w.searches().at(-1).query.page).to.equal('2');
    type.value = 'audio';
    type.dispatchEvent(new Event('change'));
    await flush();
    expect(w.searches().at(-1).query).to.include({ type: 'audio', page: '1' });
    ui.type('x');
    expect(sort.options[2].disabled).to.equal(false);
    sort.value = 'relevance';
    sort.dispatchEvent(new Event('change'));
    await flush();
    expect(w.searches().at(-1).query).to.include({ sort: 'relevance', page: '1', q: 'x' });
    ui.type('');
    expect(sort.value).to.equal('newest', 'a sort that needs a query falls back when the query is cleared');
  });
});

describe('UI5: out-of-order responses', () => {
  it('the latest query wins and the superseded request is aborted', async () => {
    const pending = [];
    const w = worker({
      search: (call) => new Promise((resolve) => { pending.push({ call, resolve }); }),
    });
    const ui = await mount({ worker: w });
    await flush();
    ui.type('first');
    await ui.timers.advance(350);
    ui.type('second');
    await ui.timers.advance(350);
    expect(pending.length).to.equal(3);
    const byQ = (q) => pending.find((p) => p.call.query.q === q);
    byQ('second').resolve(page([item(2, { name: 'from-second' })]));
    await flush();
    byQ('first').resolve(page([item(1, { name: 'from-first' })]));
    pending[0].resolve(page([item(9, { name: 'from-initial' })]));
    await flush();
    const names = ui.$$('button.item').map((b) => b.textContent);
    expect(names.join()).to.contain('from-second');
    expect(names.join()).to.not.contain('from-first').and.not.contain('from-initial');
    expect(byQ('first').call.signal.aborted).to.equal(true);
  });
});

describe('UI6: load more', () => {
  it('appends without duplicates, disappears at the end, hints to narrow at the window end', async () => {
    const w = worker({
      search: (call) => {
        if (call.query.page === '1') return page([item(1), item(2)], { hasMore: true, total: 3 });
        return page([item(2), item(3)], { page: 2, hasMore: false, total: 3 });
      },
    });
    const ui = await mount({ worker: w });
    expect(ui.byText('button', 'Load more').hidden).to.equal(false);
    ui.byText('button', 'Load more').click();
    await flush();
    expect(ui.$$('button.item').map((b) => b.dataset.id)).to.deep.equal([ID(1), ID(2), ID(3)]);
    expect(ui.byText('button', 'Load more').hidden).to.equal(true);
    expect(ui.$('.hint').hidden).to.equal(true);
    const big = worker({ search: () => page([item(1)], { hasMore: false, total: 900 }) });
    const ui2 = await mount({ worker: big });
    expect(ui2.$('.hint').hidden).to.equal(false);
    expect(ui2.$('.hint').textContent).to.contain('Narrow your search');
  });
});

describe('UI7: states', () => {
  it('empty, generic error with retry, rate limit honouring Retry-After, misconfigured with no reconnect prompt', async () => {
    const empty = await mount({ worker: worker({ search: () => page([]) }) });
    expect(empty.$('[role=status]').textContent).to.contain('No assets found');

    let fail = true;
    const w = worker({ search: () => (fail ? json(400, { error: { code: 'bad_request' } }) : page([item(1)])) });
    const ui = await mount({ worker: w });
    expect(ui.$('[role=status]').textContent).to.contain('Something went wrong');
    fail = false;
    ui.byText('button', 'Try again').click();
    await flush();
    expect(ui.$$('button.item')).to.have.length(1);

    const limited = worker({ search: () => json(429, { error: { code: 'rate_limited' } }, { 'retry-after': '90' }) });
    const rl = await mount({ worker: limited });
    expect(rl.$('[role=status]').textContent).to.contain('90 seconds');
    expect(rl.$('input[type=search]').disabled).to.equal(true);
    await rl.timers.advance(89_000);
    expect(rl.$('input[type=search]').disabled).to.equal(true);
    await rl.timers.advance(1_500);
    expect(rl.$('input[type=search]').disabled).to.equal(false);

    const misconfigured = await mount({ worker: worker({ search: () => json(500, { error: { code: 'misconfigured' } }) }) });
    expect(misconfigured.$('[role=status]').textContent).to.contain('Ask your administrator');
    expect(misconfigured.root.textContent.toLowerCase()).to.not.contain('reconnect');
  });
});

describe('UI8/UI9/UI10: detail and insertion', () => {
  async function open(asset = IMAGE(), w = worker({ detail: () => json(200, { asset }) })) {
    const ui = await mount({ worker: w });
    ui.$('button.item').click();
    await flush();
    return { ui, w };
  }

  it('fetches the detail, defaults the rendition, previews its URL, prefills and edits alt, supports decorative, shows warnings', async () => {
    const { ui, w } = await open(IMAGE({ warnings: ['Check licence'] }));
    expect(w.calls.at(-1).path).to.equal(`/dam/cloudinary/assets/${ID(1)}`);
    const rendition = ui.$('.detail select');
    expect(rendition.value).to.equal('web');
    expect(ui.$('.preview img').getAttribute('src')).to.equal('https://cdn.example.com/web.jpg');
    rendition.value = 'small';
    rendition.dispatchEvent(new Event('change'));
    expect(ui.$('.preview img').getAttribute('src')).to.equal('https://cdn.example.com/small.jpg');
    const alt = ui.$('.detail input[type=text]');
    expect(alt.value).to.equal('A boat on a beach');
    expect(ui.$('.detail').textContent).to.contain('alt text in the asset metadata');
    expect(ui.$('.detail').textContent).to.contain('Check licence');
    alt.value = 'Edited';
    const decorative = ui.$('.detail input[type=checkbox]');
    decorative.checked = true;
    decorative.dispatchEvent(new Event('change'));
    expect(alt.disabled).to.equal(true);
    ui.$('.insert').click();
    const html = ui.sdk.calls.find((c) => c[0] === 'sendHTML')[1];
    const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img');
    expect(img.getAttribute('alt')).to.equal('');
    expect(img.getAttribute('src')).to.equal('https://cdn.example.com/small.jpg');
  });

  it('UI9: inserts one <img src alt> via sendHTML then closeLibrary once, in that order; hostile alt text stays attribute text', async () => {
    const { ui } = await open(IMAGE({ alt: { value: '"><script>alert(1)</script>', source: 'property' } }));
    ui.$('.insert').click();
    ui.$('.insert').click();
    expect(ui.sdk.calls.map((c) => c[0])).to.deep.equal(['sendHTML', 'closeLibrary']);
    const doc = new DOMParser().parseFromString(ui.sdk.calls[0][1], 'text/html');
    expect(doc.body.children).to.have.length(1);
    expect(doc.body.firstElementChild.tagName).to.equal('IMG');
    expect(doc.querySelector('script')).to.equal(null);
    expect(doc.body.firstElementChild.getAttribute('alt')).to.equal('"><script>alert(1)</script>');
    expect(doc.body.firstElementChild.getAttribute('src')).to.equal('https://cdn.example.com/web.jpg');
    expect([...doc.body.firstElementChild.attributes].map((a) => a.name).sort()).to.deep.equal(['alt', 'src']);
  });

  it('UI10: a non-image with a link inserts one <a href> with the name; a not-insertable asset disables Insert with its reason', async () => {
    const pdf = {
      ...item(5, { type: 'document', name: 'Report 2025' }), alt: { value: '', source: 'none' }, renditions: [], linkUrl: 'https://cdn.example.com/r.pdf', insertable: { ok: true },
    };
    const { ui } = await open(pdf);
    ui.$('.insert').click();
    const doc = new DOMParser().parseFromString(ui.sdk.calls[0][1], 'text/html');
    expect(doc.body.children).to.have.length(1);
    expect(doc.querySelector('a').getAttribute('href')).to.equal('https://cdn.example.com/r.pdf');
    expect(doc.querySelector('a').textContent).to.equal('Report 2025');
    const restricted = await open(IMAGE({ renditions: [], insertable: { ok: false, reason: 'Access-restricted in the DAM.' } }));
    expect(restricted.ui.$('.insert').disabled).to.equal(true);
    expect(restricted.ui.$('.detail').textContent).to.contain('Access-restricted in the DAM.');
    restricted.ui.$('.insert').click();
    expect(restricted.ui.sdk.calls).to.have.length(0);
  });

  it('an unsafe rendition URL is neither previewed nor insertable', async () => {
    const { ui } = await open(IMAGE({
      renditions: [{
        id: 'web', label: 'Web', url: 'javascript:alert(1)', kind: 'derivative',
      }],
    }));
    expect(ui.$('.preview img')).to.equal(null);
    ui.$('.insert').click();
    expect(ui.sdk.calls).to.have.length(0);
  });
});

describe('UI11: no SDK', () => {
  it('shows a standalone message and makes no worker call', async () => {
    const w = worker();
    const ui = await mount({ worker: w, standalone: true });
    expect(ui.root.textContent).to.contain('Not running inside Experience Workspace');
    expect(w.calls).to.have.length(0);
  });
});

describe('UI12: thumbnails', () => {
  it('renders https and inline thumbnails, never other schemes, and falls back to a file-type placeholder', async () => {
    const png = `data:image/png;base64,${'A'.repeat(40)}`;
    const w = worker({
      search: () => page([
        item(1, { thumbnailUrl: 'https://cdn.example.com/t.jpg' }),
        item(2, { thumbnailUrl: 'http://cdn.example.com/t.jpg' }),
        item(3, { thumbnailUrl: 'javascript:alert(1)' }),
        item(4, { thumbnailUrl: 'data:text/html;base64,AAAA' }),
        item(5, { type: 'document', extension: 'pdf' }),
        item(6, { thumbnailUrl: png }),
      ]),
    });
    const ui = await mount({ worker: w });
    const srcs = ui.$$('button.item').map((b) => b.querySelector('img')?.getAttribute('src'));
    expect(srcs).to.deep.equal(['https://cdn.example.com/t.jpg', undefined, undefined, undefined, undefined, png]);
    expect(ui.$$('button.item')[4].textContent).to.contain('PDF');
    expect(ui.$$('button.item')[1].querySelector('.placeholder')).to.not.equal(null);
  });
});

describe('UI13: accessibility', () => {
  it('has labelled controls, named grid buttons and moves focus to the detail and back', async () => {
    const ui = await mount({ worker: worker() });
    const labels = ui.$$('label').map((l) => l.textContent);
    ['Search', 'Type', 'Sort'].forEach((t) => expect(labels.some((l) => l.startsWith(t))).to.equal(true));
    expect(ui.$$('button.item').every((b) => b.getAttribute('aria-label'))).to.equal(true);
    const first = ui.$('button.item');
    first.focus();
    first.click();
    await flush();
    expect(document.activeElement).to.equal(ui.$('.detail h2'));
    ui.$('.close').click();
    expect(document.activeElement).to.equal(ui.$(`button.item[data-id="${first.dataset.id}"]`));
  });
});

describe('UI14/UI15: sources', () => {
  it('shows a switcher only for more than one provider; each provider drives its own filters', async () => {
    const other = provider({ id: 'other', label: 'Other DAM', capabilities: caps({ assetTypes: ['image'] }) });
    const w = worker({ providers: [provider(), other] });
    const ui = await mount({ worker: w });
    const switcher = ui.$('.source select');
    expect(switcher).to.not.equal(null);
    expect([...ui.$$('.toolbar select')[0].options]).to.have.length(5);
    switcher.value = 'other';
    switcher.dispatchEvent(new Event('change'));
    await flush();
    expect(w.searches().at(-1).path).to.equal('/dam/other/assets');
    expect([...ui.$$('.toolbar select')[0].options]).to.have.length(2);
    const single = await mount({ worker: worker() });
    expect(single.$('.source')).to.equal(null);
  });

  it('a service provider that reports another state is shown as unavailable: no grid, no connect panel, no asset call', async () => {
    const w = worker({ providers: [provider({ connection: { state: 'reauth_required' } })] });
    const ui = await mount({ worker: w });
    expect(ui.root.textContent).to.contain('is not available');
    expect(ui.$('.connect')).to.equal(null);
    expect(ui.$('.grid')).to.equal(null);
    expect(w.searches()).to.have.length(0);
  });
});

describe('UI17: failures never hang', () => {
  it('a rejected fetch, a response slower than the bounded wait and a 5xx each end in a plain message with retry', async () => {
    const rejected = fakeWorker((call) => {
      if (call.path === '/dam/providers') return providersResponse();
      throw new TypeError('Failed to fetch');
    });
    const a = await mount({ worker: rejected });
    expect(a.$('[role=status]').textContent).to.contain('unavailable');
    expect(a.byText('button', 'Try again')).to.not.equal(undefined);
    expect(a.root.textContent).to.not.match(/TypeError|stack/i);

    const hang = fakeWorker((call) => {
      if (call.path === '/dam/providers') return providersResponse();
      return new Promise((resolve, reject) => { call.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); });
    });
    const b = await mount({ worker: hang });
    expect(b.$('[role=status]').textContent).to.contain('Loading');
    await b.timers.advance(3000);
    expect(b.$('[role=status]').textContent).to.contain('Still working');
    await b.timers.advance(17_500);
    expect(b.$('[role=status]').textContent).to.contain('unavailable');
    expect(b.$('.retry').hidden).to.equal(false);

    const five = await mount({ worker: worker({ search: () => json(502, { error: { code: 'upstream_unavailable' } }) }) });
    expect(five.$('[role=status]').textContent).to.contain('unavailable');
    expect(five.byText('button', 'Try again')).to.not.equal(undefined);
  });

  it('a failing provider list ends in a message with retry', async () => {
    let up = false;
    const w = fakeWorker((call) => {
      if (call.path === '/dam/providers') return up ? providersResponse() : json(503, {});
      return page([item(1)]);
    });
    const ui = await mount({ worker: w });
    expect(ui.root.textContent).to.contain('unavailable');
    up = true;
    ui.byText('button', 'Try again').click();
    await flush();
    expect(ui.$$('button.item')).to.have.length(1);
  });
});

describe('UI18: worker origin by page hostname', () => {
  it('maps hostnames to the Production or Stage worker or to none', () => {
    ['main--ew-extensions--jazhou-adobe.aem.live', 'main--ew-extensions--jazhou-adobe.aem.page', 'main--ew-extensions--jazhou-adobe.preview.da.live']
      .forEach((h) => expect(workerFor(h).base).to.equal(WORKERS.production));
    ['my-branch--ew-extensions--jazhou-adobe.aem.live', 'localhost', 'main--ew-extensions-demo--jazhou-adobe.aem.live', 'main--ew-extensions-demo--jazhou-adobe.aem.page']
      .forEach((h) => expect(workerFor(h).base).to.equal(WORKERS.stage));
    ['evil.example', 'main--ew-extensions-demo2--jazhou-adobe.aem.live', 'main--ew-extensions-demo--jazhou-adobe.aem.live.evil.example', 'main--ew-extensions--jazhou-adobe.aem.live.evil.example', 'localhost.evil.example', '']
      .forEach((h) => expect(workerFor(h)).to.equal(null));
    expect(WORKERS.production).to.match(/^https:\/\/281295-ewextensions\.adobeioruntime\.net\/api\/v1\/web\/multi-dam-picker\/api$/);
    expect(WORKERS.stage).to.match(/^https:\/\/281295-ewextensions-stage\.adobeioruntime\.net\/api\/v1\/web\/multi-dam-picker\/api$/);
  });

  it('makes no worker call on a foreign host and ignores ?worker= everywhere', async () => {
    window.history.replaceState(null, '', `${window.location.pathname}?worker=https://evil.example`);
    for (const hostname of ['evil.example', 'main--ew-extensions-demo2--jazhou-adobe.aem.live']) {
      const w = worker();
      // eslint-disable-next-line no-await-in-loop
      const ui = await mount({ worker: w, hostname });
      expect(w.calls).to.have.length(0);
      expect(ui.root.textContent).to.contain('not available here');
    }
    const w = worker();
    await mount({ worker: w, hostname: 'localhost' });
    expect(w.calls.every((c) => c.url.startsWith(WORKERS.stage))).to.equal(true);
    const prod = worker();
    await mount({ worker: prod, hostname: 'main--ew-extensions--jazhou-adobe.aem.live' });
    expect(prod.calls.every((c) => c.url.startsWith(WORKERS.production))).to.equal(true);
  });
});

describe('bootstrap', () => {
  it('awaits the stubbed SDK and renders into #app', async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const { ready } = await import('../../multi-dam-picker.js');
    await ready;
    expect(document.getElementById('app').textContent).to.contain('Asset Picker');
    fakeTimers();
  });
});
