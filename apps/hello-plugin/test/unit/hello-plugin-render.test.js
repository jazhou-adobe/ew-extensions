import { expect } from '@esm-bundle/chai';
import { mountHelloPlugin, INSERT_TEXT } from '../../hello-plugin-render.js';
import { createSdkStub } from '../../../../test/support/sdk-stub.js';

function mount(sdkPromise, timeoutMs = 20) {
  const root = document.createElement('main');
  document.body.append(root);
  const done = mountHelloPlugin(root, sdkPromise, { timeoutMs });
  return { root, done };
}

const button = (root, name) => [...root.querySelectorAll('button')]
  .find((b) => b.textContent.trim().toLowerCase() === name);

describe('hello-plugin render', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('shows a context summary and both buttons', async () => {
    const { root, done } = mount(Promise.resolve(createSdkStub({ context: { org: 'acme', repo: 'site' } })));
    await done;
    expect(root.textContent).to.contain('acme');
    expect(button(root, 'insert text')).to.not.equal(undefined);
    expect(button(root, 'insert text and close')).to.not.equal(undefined);
  });

  it('insert: sendText once with the displayed text, no closeLibrary', async () => {
    const sdk = createSdkStub();
    const { root, done } = mount(Promise.resolve(sdk));
    await done;
    expect(root.textContent).to.contain(INSERT_TEXT);
    button(root, 'insert text').click();
    expect(sdk.calls).to.deep.equal([['sendText', INSERT_TEXT]]);
  });

  it('insert and close: sendText then closeLibrary, once each', async () => {
    const sdk = createSdkStub();
    const { root, done } = mount(Promise.resolve(sdk));
    await done;
    button(root, 'insert text and close').click();
    expect(sdk.calls).to.deep.equal([['sendText', INSERT_TEXT], ['closeLibrary']]);
  });

  it('does not throw when actions are missing', async () => {
    const { root, done } = mount(Promise.resolve({ ready: true, context: {}, actions: {} }));
    await done;
    expect(() => button(root, 'insert text and close').click()).to.not.throw();
  });

  it('waits, then reports it is not running inside Experience Workspace', async () => {
    const { root, done } = mount(new Promise(() => {}), 30);
    expect(root.textContent.toLowerCase()).to.contain('waiting for experience workspace');
    await done;
    expect(root.textContent.toLowerCase()).to.contain('not running inside experience workspace');
  });
});
