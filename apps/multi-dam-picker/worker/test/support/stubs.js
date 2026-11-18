// Stub providers for the conformance suite: a second `service` provider and `user-oauth` declarations.
// They never call a network; they return what the test gives them.
const ID = /^[0-9a-f]{32}$/;

const sample = (n) => ({
  id: n.toString(16).padStart(32, '0'), name: `Stub ${n}`, type: 'image', warnings: [],
});

/** A complete second `service` provider (id `stubdam`). `overrides` replace any member. */
export function stubService(overrides = {}) {
  return {
    id: 'stubdam',
    label: 'Stub DAM',
    credentialKind: 'service',
    assetTypes: ['image', 'document'],
    sorts: [{ id: 'newest', label: 'Newest' }, { id: 'rel', label: 'Relevance', requiresQuery: true }],
    defaultSort: 'newest',
    window: 100,
    assetIdPattern: ID,
    outboundHosts: () => ['api.stub.example'],
    deliveryHosts: () => ['cdn.stub.example'],
    cacheSeconds: () => 30,
    accountLabel: () => 'stub-account',
    fingerprint: (config) => ({ tenant: config.tenant }),
    config: {
      required: ['STUBDAM_TENANT'],
      secrets: ['STUBDAM_TOKEN'],
      resolve: (raw) => ({ tenant: raw.STUBDAM_TENANT }),
    },
    calls: [],
    async search(ctx, query) {
      this.calls.push({ ctx, query });
      return { items: [sample(1), sample(2)], total: 2, hasMore: false };
    },
    async getAsset(ctx, id) {
      this.calls.push({ ctx, id });
      return {
        ...sample(1),
        id,
        alt: { value: 'stub alt', source: 'name' },
        renditions: [{
          id: 'web', label: 'Web', url: 'https://cdn.stub.example/a.jpg', kind: 'derivative',
        }],
        defaultRenditionId: 'web',
        insertable: { ok: true },
      };
    },
    ...overrides,
  };
}

/** A complete `user-oauth` declaration (id `oauthdam`); its members never touch a network. */
export function stubOAuth(overrides = {}) {
  return {
    ...stubService({
      id: 'oauthdam', label: 'OAuth DAM', credentialKind: 'user-oauth',
    }),
    scopes: ['files.read'],
    authorizeHosts: () => ['auth.stub.example'],
    buildAuthorizeUrl: () => 'https://auth.stub.example/authorize',
    exchangeCode: async () => ({}),
    refresh: async () => ({}),
    accountName: () => 'someone',
    ...overrides,
  };
}
