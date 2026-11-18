import { expect } from '@esm-bundle/chai';
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { createSdkStub, SDK_URL } from '../support/sdk-stub.js';

describe('SDK stub contract', () => {
  it('is remapped from the real SDK URL by the import map', () => {
    expect(SDK_URL).to.equal('https://da.live/nx/utils/sdk.js');
    expect(DA_SDK).to.be.instanceOf(Promise);
  });

  it('resolves to the same top-level shape as the real SDK', async () => {
    const sdk = await DA_SDK;
    expect(sdk.ready).to.equal(true);
    expect(sdk.token).to.be.a('string');
    expect(sdk.context).to.be.an('object');
    expect(sdk.actions.sendText).to.be.a('function');
    expect(sdk.actions.closeLibrary).to.be.a('function');
  });

  it('records action calls in order', () => {
    const sdk = createSdkStub();
    sdk.actions.sendText('a');
    sdk.actions.closeLibrary();
    expect(sdk.calls).to.deep.equal([['sendText', 'a'], ['closeLibrary']]);
  });
});
