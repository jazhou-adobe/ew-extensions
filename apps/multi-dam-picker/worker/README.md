# multi-dam-picker worker

Backend for the Multi-DAM Asset Picker (extension `multi-dam-picker`): two App Builder raw web actions, `multi-dam-picker/api` and
`multi-dam-picker/oauth`, built on the [worker template](../../../shared/worker-template/README.md). It is the **shell**: provider
registry and interface, routes, validation, result cache, error mapping, output URL policy, and the per-author OAuth host (tickets and
states, encrypted token store, refresh, connect and disconnect). Vendor code lives in `../providers/<vendor>/worker/` and is registered
in `providers.js`. Extension docs, settings and deploy steps: [../README.md](../README.md).

| Route | Result |
| --- | --- |
| `GET /dam/providers` | configured providers: `id`, `label`, `credentialKind`, `connection { state, account? }`, `capabilities` |
| `GET /dam/{provider}/assets?q&type&sort&page&pageSize` | `{ items, page, pageSize, total?, hasMore }` (page size default 24, max 50; `q` at most 200 characters) |
| `GET /dam/{provider}/assets/{id}` | `{ asset }` with renditions, alt text (with its source), `insertable`, `linkUrl` (the id may be percent-encoded) |
| `POST /dam/{provider}/connect` | `user-oauth` only: `{ beginUrl }` for the sign-in window (404 for other providers) |
| `GET /dam/{provider}/session` | `user-oauth` only: `{ connection { state, account? } }` |
| `POST /dam/{provider}/disconnect` | `user-oauth` only: revoke upstream (best effort), delete the record; `{ connection }` |

The `oauth` action has exactly two routes, `GET /{provider}/begin?ticket=` and `GET /{provider}/callback`, because a browser redirect
cannot carry an IMS token. Each checks sealed values (and, for the callback, the binding cookie); everything else is the same generic
failure page; CORS is never enabled. See "OAuth plumbing" in [../README.md](../README.md#oauth-plumbing).

Every request needs `Authorization: Bearer <Adobe IMS token>` and an allowed `Origin`: no token is `401`, a disallowed origin `403`.
Errors use the template contract (`bad_request`, `not_found`, `rate_limited` with `Retry-After`, `misconfigured`,
`upstream_unavailable`, ...); messages are fixed and never carry upstream text.

## Files

`app.config.yaml`, `package.json` (`optionalEnv`: references the pre-deploy guard lets stay blank), `.env.example`, `actions/api/index.js`
and `actions/oauth/index.js` (entries), `providers.js` (registry), `scripts/connection-key.mjs` (purge helper), `shell/` (`provider.js`
interface and registry, `registry.js` shared host, `routes.js`, `oauth.js`, `connections.js` token record and refresh, `seal.js`
encryption, `policy.js` output URL policy), `test/` (shell, conformance, app config and emulator-tier tests;
`test/support/` has the stub providers and the world helper), `test-live/` (opt-in deployed checks).

## Template additions used here

Additive changes to `shared/worker-template` (with tests in `shared/worker-template/test/extensions.test.js`): prefix routes
(`GET /dam/*` with the remainder in `ctx.rest`), `ctx.now`, `ctx.annotate(fields)` (safe fields on the request log line), redaction
of a composed Basic credential, numeric and boolean literal inputs exposed as text, and a `vendor` option in `makeWorld`.
For ticket #25: `mode: 'public'` in `createAction` (no IMS token, no CORS; the only unauthenticated action), a root wildcard route
(`GET /*`), `store.putIf` (`absent`/`present`: locks and no resurrection of a deleted record), `ctx.addSensitive` and `ctx.optionalSecret`,
`ctx.sleep`/`startedAt`/`deadline`, a per-call `auth: { scheme: 'bearer', token }` for the proxy (a user's token, redacted), the
`provider_not_connected` and `provider_reauth_required` error codes (409), the pre-deploy guard's `optionalEnv`, and a `mode` option in
`makeWorld`.

## `.env` keys

See the settings table in [../README.md](../README.md#worker-settings); `.env.example` lists the `$NAME` inputs
(`ALLOWED_LOCAL_ORIGINS`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_ROOT_FOLDER`, `CLOUDINARY_FOLDER_MODE`, `CLOUDINARY_SIGN_URLS`,
`CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and the optional `OAUTH_PUBLIC_BASE_URL`, `TOKEN_ENC_KEY`, `TOKEN_ENC_KEY_PREVIOUS`,
`OAUTH_STATE_KEY`, `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`, `DROPBOX_ROOT_PATH`). `AIO_*` lines are written by `aio app use`; `.env` and `.aio` are gitignored.
