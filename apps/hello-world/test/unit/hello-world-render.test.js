import { expect } from '@esm-bundle/chai';
import { mountHelloWorld } from '../../hello-world-render.js';
import { createSdkStub } from '../../../../test/support/sdk-stub.js';

function mount(sdkPromise, timeoutMs = 20) {
  const root = document.createElement('main');
  document.body.append(root);
  const done = mountHelloWorld(root, sdkPromise, { timeoutMs });
  return { root, done };
}

describe('hello-world render', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('shows every context key and value as text', async () => {
    const sdk = createSdkStub({ context: { alpha: 'one', beta: 2, nested: { a: 1 } } });
    const { root, done } = mount(Promise.resolve(sdk));
    await done;
    const text = root.textContent;
    ['alpha', 'one', 'beta', '2', 'nested'].forEach((s) => expect(text).to.contain(s));
    expect(text).to.contain('"a":1');
  });

  it('renders HTML-looking values as literal text and creates no elements', async () => {
    const evil = '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>';
    const { root, done } = mount(Promise.resolve(createSdkStub({ context: { evil } })));
    await done;
    expect(root.textContent).to.contain(evil);
    expect(root.querySelector('img, script')).to.equal(null);
    expect(window.pwned).to.equal(undefined);
  });

  it('never shows the token but indicates it is present', async () => {
    const { root, done } = mount(Promise.resolve(createSdkStub({ token: 'super-secret-token' })));
    await done;
    expect(root.innerHTML).to.not.contain('super-secret-token');
    expect(root.textContent.toLowerCase()).to.contain('token present');
  });

  it('indicates when the token is absent', async () => {
    const { root, done } = mount(Promise.resolve(createSdkStub({ token: '' })));
    await done;
    expect(root.textContent.toLowerCase()).to.contain('token absent');
  });

  it('renders without throwing for empty or missing context', async () => {
    const a = mount(Promise.resolve({ ready: true, token: 'x' }));
    await a.done;
    const b = mount(Promise.resolve({ ready: true, context: {} }));
    await b.done;
    expect(a.root.textContent).to.contain('Hello');
    expect(b.root.textContent).to.contain('Hello');
  });

  it('waits, then reports it is not running inside Experience Workspace', async () => {
    const { root, done } = mount(new Promise(() => {}), 30);
    expect(root.textContent.toLowerCase()).to.contain('waiting for experience workspace');
    await done;
    expect(root.textContent.toLowerCase()).to.contain('not running inside experience workspace');
  });
});
