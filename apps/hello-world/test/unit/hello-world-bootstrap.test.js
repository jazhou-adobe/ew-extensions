import { expect } from '@esm-bundle/chai';

describe('hello-world bootstrap', () => {
  it('awaits the (stubbed) SDK and renders the context into #app', async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const { ready } = await import('../../hello-world.js');
    await ready;
    expect(document.getElementById('app').textContent).to.contain('jazhou-adobe');
  });
});
