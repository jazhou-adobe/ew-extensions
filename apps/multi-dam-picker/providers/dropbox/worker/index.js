// The Dropbox provider module (a `user-oauth` credential: each author signs in; the shell stores and refreshes their
// tokens, this module only maps Dropbox's endpoints). See README "Dropbox provider".
import { API_HOST, CONTENT_HOST } from './client.js';
import {
  AUTHORIZE_HOST, accountName, buildAuthorizeUrl, exchangeCode, refresh, revoke,
} from './auth.js';
import {
  REQUIRED_INPUTS, resolveConfig, SCOPES, SECRET_INPUTS,
} from './config.js';
import { ASSET_ID } from './mapping.js';
import { search, WINDOW } from './search.js';
import { getAsset } from './links.js';

export default {
  id: 'dropbox',
  label: 'Dropbox',
  credentialKind: 'user-oauth',
  assetTypes: ['image', 'video', 'document', 'audio'],
  sorts: [
    { id: 'modified', label: 'Newest' },
    { id: 'relevance', label: 'Relevance', requiresQuery: true },
  ],
  defaultSort: 'modified',
  window: WINDOW,
  assetIdPattern: ASSET_ID,
  outboundHosts: () => [API_HOST, CONTENT_HOST],
  authorizeHosts: () => [AUTHORIZE_HOST],
  // The inserted shared link; the `raw=1` redirect to the content host happens in the visitor's browser.
  deliveryHosts: () => ['www.dropbox.com'],
  cacheSeconds: (config) => config.cacheSeconds,
  fingerprint: ({ clientId, root }) => ({ clientId, root }),
  config: { required: REQUIRED_INPUTS, secrets: SECRET_INPUTS, resolve: resolveConfig },

  scopes: SCOPES,
  // Dropbox documents 2,000 bytes for `state`; refresh tokens never rotate and are required (offline access).
  maxStateBytes: 2000,
  requiresRefreshToken: true,
  rotatesRefreshToken: false,
  buildAuthorizeUrl,
  exchangeCode,
  refresh,
  accountName,
  revoke,

  search,
  getAsset,
};
