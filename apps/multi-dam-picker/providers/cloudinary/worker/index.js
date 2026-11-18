// The Cloudinary provider module (a `service` credential: one API key and secret held by the worker).
import { ProviderError } from '../../../worker/shell/provider.js';
import {
  deliveryHostsOf, REQUIRED_INPUTS, resolveConfig, SECRET_INPUTS,
} from './config.js';
import { buildSearch, hasMore, WINDOW } from './query.js';
import { adminRequest } from './client.js';
import {
  inRoot, readResource, toDetail, toSummary,
} from './mapping.js';

const ASSET_ID = /^[0-9a-f]{32}$/;
const SECRET = 'CLOUDINARY_API_SECRET';

const secretOf = (ctx) => () => ctx.secret(SECRET);

export default {
  id: 'cloudinary',
  label: 'Cloudinary',
  credentialKind: 'service',
  assetTypes: ['image', 'video', 'document', 'audio'],
  sorts: [
    { id: 'newest', label: 'Newest' },
    { id: 'oldest', label: 'Oldest' },
    { id: 'name', label: 'Name' },
    { id: 'relevance', label: 'Relevance', requiresQuery: true },
  ],
  defaultSort: 'newest',
  window: WINDOW,
  assetIdPattern: ASSET_ID,
  outboundHosts: (config) => [config.apiHost],
  deliveryHosts: deliveryHostsOf,
  cacheSeconds: (config) => config.cacheSeconds,
  accountLabel: (config) => config.cloudName,
  fingerprint: ({ cacheSeconds: _ignored, ...rest }) => rest,
  config: { required: REQUIRED_INPUTS, secrets: SECRET_INPUTS, resolve: resolveConfig },

  async search(ctx, query) {
    const { body, start, end } = buildSearch(ctx.config, query);
    const json = await adminRequest(ctx, { method: 'POST', path: 'resources/search', body });
    if (!Array.isArray(json.resources)) throw new ProviderError('upstream_unavailable');
    const secret = secretOf(ctx);
    const items = json.resources.slice(start, end)
      .map((row) => toSummary(row, ctx.config, secret))
      .filter(Boolean);
    const total = Number.isInteger(json.total_count) && json.total_count >= 0 ? json.total_count : undefined;
    return {
      items, ...(total !== undefined ? { total } : {}), hasMore: hasMore(end, total),
    };
  },

  async getAsset(ctx, id) {
    if (!ASSET_ID.test(id)) throw new ProviderError('bad_request');
    const json = await adminRequest(ctx, { method: 'GET', path: `resources/${id}` });
    const asset = readResource(json, ctx.config);
    // Outside the configured root or not a public upload: indistinguishable from a missing asset.
    if (!asset || asset.id !== id || !inRoot(asset, ctx.config)) throw new ProviderError('not_found');
    return toDetail(json, ctx.config, secretOf(ctx));
  },
};
