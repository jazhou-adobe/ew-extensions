# multi-dam-picker worker

Backend for the Multi-DAM Picker: one App Builder raw web action `multi-dam-picker/api` built on the
[worker template](../../../shared/worker-template/README.md). It is the **shell**: provider registry and interface, routes,
validation, result cache, error mapping, output URL policy. Vendor code lives in `../providers/<vendor>/worker/` and is registered
in `providers.js`. Extension docs, settings and deploy steps: [../README.md](../README.md).

| Route | Result |
| --- | --- |
| `GET /dam/providers` | configured providers: `id`, `label`, `credentialKind`, `connection { state, account? }`, `capabilities` |
| `GET /dam/{provider}/assets?q&type&sort&page&pageSize` | `{ items, page, pageSize, total?, hasMore }` (page size default 24, max 50; `q` at most 200 characters) |
| `GET /dam/{provider}/assets/{id}` | `{ asset }` with renditions, alt text (with its source), `insertable`, `linkUrl` |

Every request needs `Authorization: Bearer <Adobe IMS token>` and an allowed `Origin`: no token is `401`, a disallowed origin `403`.
Errors use the template contract (`bad_request`, `not_found`, `rate_limited` with `Retry-After`, `misconfigured`,
`upstream_unavailable`, ...); messages are fixed and never carry upstream text.

## Files

`app.config.yaml`, `package.json`, `.env.example`, `actions/api/index.js` (entry), `providers.js` (registry), `shell/` (`provider.js`
interface and registry, `routes.js`, `policy.js` output URL policy), `test/` (shell, conformance, app config and emulator-tier tests;
`test/support/` has the stub providers and the world helper), `test-live/` (opt-in deployed checks).

## Template additions used here

Additive changes to `shared/worker-template` (with tests in `shared/worker-template/test/extensions.test.js`): prefix routes
(`GET /dam/*` with the remainder in `ctx.rest`), `ctx.now`, `ctx.annotate(fields)` (safe fields on the request log line), redaction
of a composed Basic credential, numeric and boolean literal inputs exposed as text, and a `vendor` option in `makeWorld`.

## `.env` keys

See the settings table in [../README.md](../README.md#worker-settings); `.env.example` lists the `$NAME` inputs
(`ALLOWED_LOCAL_ORIGINS`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_ROOT_FOLDER`, `CLOUDINARY_FOLDER_MODE`, `CLOUDINARY_SIGN_URLS`,
`CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`). `AIO_*` lines are written by `aio app use`; `.env` and `.aio` are gitignored.
