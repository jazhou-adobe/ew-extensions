# Worker template (Adobe App Builder)

The shared backend template for EW extensions that need a secret-holding backend: hold a vendor credential, avoid browser
CORS limits, exchange tokens server-side. Spec and rationale: [SPEC.md](SPEC.md) (ticket #2).

Each extension gets **one Adobe I/O Runtime raw web action** (`<extension>/api`) in `apps/<ext>/worker/`, built on the tested
core in `shared/worker-template/src/`. Before any extension code runs, the core:

1. decodes the raw web-action request, then applies the **origin gate** (only `https://da.live` and this code site's own
   origins; preflights answered without a token; disallowed origins get `403`);
2. verifies the caller's **Adobe IMS token inside the action** (missing/invalid -> `401`, key set unreachable -> `503`);
3. routes `METHOD /path` to your handler with a verified identity, a secrets accessor, a store and a `proxy` helper;
4. maps every failure to a fixed JSON error contract and redacts secrets from bodies, headers and logs.

## Platform choice

Backend = **Adobe App Builder (I/O Runtime web actions)**, org `adobe-demo-apac-195`, Developer Console project
`ew extensions`, workspaces **Stage** and **Production** (owner decision 2026-11-18). Node 22 (`nodejs:22`), JavaScript ESM,
no framework. One action per extension keeps auth, CORS and limits implemented once per extension.

### Auth mode: in-action verification (platform `require-adobe-auth` not adopted)

The default and only implemented mode verifies the token inside the action (RS256 against `{IMS_ORIGIN}/ims/keys`, IMS
`type = access_token`, `created_at + expires_in` in the future, optional client-id allowlist: the same checks Adobe's
`da-admin` makes). The platform annotation `require-adobe-auth` is **not** used: its validator authorises a token only for
the organisation that owns the action, so EW users from other orgs are expected to fail, and it was not probed against a real
EW token (SPEC step S0 needs a deploy). Record: `app.config.yaml` sets `require-adobe-auth: false`. Platform mode would be
added only if S0 proves it accepts EW tokens and keeps denials/preflights readable.

## Folder layout

```
shared/worker-template/
├─ SPEC.md  README.md  .env.example
├─ src/          core: createAction (pipeline), request decode, auth (jose), cors, proxy, secrets+redaction, store, errors, log
├─ scaffold/     copied into apps/<ext>/worker/ by scripts/new-worker.mjs
├─ scripts/      new-worker.mjs, pre-deploy-guard.mjs, worker-config.mjs (shared by CI check and guard)
├─ test/         template unit tests (node:test) + emulator tier
├─ test-kit/     fake IMS, token factory, makeParams/makeInputs, fake upstream, memory store, emulator, makeWorld
└─ test-live/    opt-in live tiers (deployed worker, Cloudinary); not run in CI
apps/<ext>/worker/                       App Builder application root: app.config.yaml, package.json, actions/api, routes, test, README
apps/<ext>/providers/<vendor>/worker/    vendor-specific route modules registered from the worker's routes
```

`apps/<ext>/worker/` is itself an App Builder app root because `aio` needs `app.config.yaml` + a package manifest + the
untracked `.env`/`.aio` at the root it runs from. Extensions **import** the shared core by relative path (one place for security
fixes); `aio app build` bundles it into the action. This is a deliberate exception to "no cross-folder imports" because
`shared/worker-template/` is not an extension. The package name in `app.config.yaml` **must equal the extension folder name**
(all workers share one workspace).

## Prerequisites

- Node >= 22, the `aio` CLI **11.x** installed globally (`npm i -g @adobe/aio-cli`; tested with 11.1.2). It is a dev/deploy tool,
  not a repo dependency, and is not used in CI.
- The owner's shell sets `CI=true`, which changes `aio` behaviour. **Run aio as `env -u CI aio ...`.**
- `env -u CI aio where` must show org `adobe-demo-apac-195`, project `ew extensions`. Select the workspace with
  `env -u CI aio app use` (Stage or Production). That command writes credentials into the worker folder's **`.env`** and
  **`.aio`**: both are gitignored and must never be committed (`npm run check` fails if they are tracked).

## Local dev loop

```sh
npm ci
npm run test:worker        # template unit tests + emulator tier + every apps/*/worker/test (no login, no network)
npm run lint && npm run check
```

Day to day, work against the test kit: `makeWorld` wires your routes to a fake IMS, a fake vendor, a memory store and captured
logs, so you need no Adobe login, no deployment and no vendor sandbox:

```js
const w = await makeWorld({ name: 'my-ext', routes, secrets: ['VENDOR_KEY'], inputs: { VENDOR_KEY: canary() },
  upstream: [{ status: 429 }, { status: 200, body: '{"ok":true}' }] });
const res = await w.call({ path: '/my-ext/thing', query: { q: 'x' } });   // valid token + da.live origin by default
// w.call({ token: null }) -> no Authorization; w.call({ origin: 'https://evil.example' }) -> disallowed origin
```

To try an extension and its worker together inside real EW: deploy the worker to **Stage** (below), run `npm start` for the page
and open `https://da.live/app/jazhou-adobe/ew-extensions/apps/<ext>/<ext>?ref=local`. A `ref=local` page (origin
`http://localhost:3000`) calls the Stage worker, which allows that origin only because Stage sets `ALLOWED_LOCAL_ORIGINS`.
`env -u CI aio app run` redeploys on change; `env -u CI aio app dev` runs the action locally (self-signed HTTPS on 9080) but has
no State and needs a real token: optional.

## Create a worker

```sh
node shared/worker-template/scripts/new-worker.mjs my-ext      # creates apps/my-ext/worker/ from the scaffold
```

Edit `routes/index.js` and `app.config.yaml` (rename `VENDOR_API_KEY`, set `ALLOWED_IMS_CLIENT_IDS`), list secrets in
`.env.example`, write tests first. Add the extension to the root README table as usual.

### Add a route

Routes are `'METHOD /path'` keys; `__ow_path` is the unmatched remainder after `.../<package>/api`:

```js
import { HttpError } from '../../../../shared/worker-template/src/index.js';
export const routes = {
  'GET /my-ext/thing': async ({ request, proxy }) => {
    const q = request.query.get('q');
    if (!q) throw new HttpError('bad_request');
    const res = await proxy('https://api.vendor.example/v1/search?q=' + encodeURIComponent(q), {}, {
      allowedHosts: ['api.vendor.example'],
      auth: { secret: 'VENDOR_KEY', scheme: 'bearer' },
    });
    return res.json();                       // a plain value becomes `200` JSON
  },
};
```

### Add a vendor

Server-side code for a vendor lives in `apps/<ext>/providers/<vendor>/worker/` (route modules exporting a `routes` object) and is
spread into the extension's `routes/index.js`. Declare the vendor's secrets as `$NAME` inputs in `app.config.yaml`, list them in
`.env.example`, and pass the names in `createAction({ secrets: [...] })`.

## Handler context

| Field | Meaning |
|---|---|
| `request` | `{ method, path, query (URLSearchParams), headers (lower-case), header(name), text(), json(), bytes() }`; body decoded lazily, malformed -> `400 bad_request` |
| `identity` | `{ userId, clientId, expiresAt }` from the verified token; never the raw token |
| `claims` | frozen copy of the verified token claims |
| `config` | non-secret inputs only (secret-looking and declared secret names are excluded) |
| `secret(name)` | the only way to read a secret; missing/empty -> `500 misconfigured` and a log line with the **name** only |
| `store` | `get / put(key, value, { ttlSeconds }) / delete`; JSON values; keys prefixed per worker; State when deployed |
| `proxy(url, init, options)` | outbound helper, see below |
| `fromUpstream(res, { headers })` | turns a proxy response into a web response (binary bodies base64, content type kept) |
| `requestId`, `log(event, fields)` | request id; structured log line (redacted) |

A handler returns a plain JSON-able value (-> `200`) or `{ statusCode, headers, body }` (body string, object, or bytes -> base64).
Throw `new HttpError(code)` for an expected error; any other throw becomes `500 internal` (no stack, no message). An optional
`authorize({ identity, claims, request })` hook on `createAction` returning false gives `403 forbidden` (after authentication).
`access-control-*`, `cache-control`, `x-request-id` and `vary` are always set by the template; responses are `Cache-Control: no-store`.

### Error contract

`{ "error": { "code", "message", "requestId" } }`, fixed messages, plus `x-request-id`:
`bad_request` 400 · `unauthorized` 401 (`WWW-Authenticate: Bearer`) · `forbidden_origin` 403 · `forbidden` 403 · `not_found` 404 ·
`method_not_allowed` 405 · `payload_too_large` 413 · `rate_limited` 429 (`Retry-After`) · `misconfigured` 500 · `internal` 500 ·
`upstream_unavailable` 502 · `upstream_too_large` 502 · `auth_unavailable` 503 · `store_unavailable` 503.

Pipeline order is fixed and tested: decode -> origin gate -> preflight -> authentication -> routing -> handler. Without a token an
unknown route gives `401`, with one `404`; the only unauthenticated request is an allowed-origin `OPTIONS` preflight. A bare
request returning `401` is the liveness check of a deployed worker.

## Outbound `proxy` helper

`proxy(url, init, { allowedHosts, auth, retry, mapErrors, maxRequestBytes, maxResponseBytes })`:

- **Safety:** absolute `https` URLs only (plain `http` only for loopback), no URL credentials, host must be in `allowedHosts`,
  redirects are never followed (`redirect: manual`), inbound `Authorization`, `Cookie`, `Host`, `x-forwarded-*` are stripped. The
  caller's IMS token is never forwarded.
- **Secrets:** `auth: { secret: 'NAME', scheme: 'bearer' | 'header' | 'query' | 'basic', name?, username? | usernameSecret? }`; the
  value is injected inside the helper.
- **Retries:** `429` and every `5xx` are retried with exponential backoff and full jitter: 3 retries (4 attempts), `base 250 ms`,
  `cap 2 s`, per-attempt timeout 8 s, overall deadline 15 s, further bounded by the invocation deadline (`__OW_DEADLINE`).
  `Retry-After` (seconds or HTTP-date) is a minimum delay bounded by the cap. **`POST`/`PATCH` are retried on `429` only**; set
  `retry.idempotent: true` when a POST is safe to retry (stricter than the ticket's literal "429 and 5xx" to avoid
  double-spending vendor credits; vendor tickets tune the defaults). Network errors and timeouts retry for idempotent methods.
- **Vendor quirks:** `retry.extraRetryStatuses`, `retry.rateLimitStatuses` (mapped to `429 rate_limited`, not retried; e.g.
  Cloudinary's `420`) and `retry.rateLimitResetHeader` (reset time used for `Retry-After`).
- **Mapping:** `ctx.proxy` throws `rate_limited` (429 + `Retry-After`) for exhausted/declared rate limits, `upstream_unavailable`
  for exhausted 5xx, network failure or a vendor `401/403` (our credential was rejected), `upstream_too_large` over the cap, and
  `payload_too_large` for an oversized request body, **never with upstream text**. Other 4xx are returned to the route.
  `mapErrors: false` returns every upstream response unmapped.
- Bodies are buffered (request cap 512 KiB, response cap 900 KiB, under the platform's 1 MB limits).

## Secrets lifecycle

Secrets are action **inputs**: the committed `app.config.yaml` references them as `$NAME`; the untracked `.env` supplies the
values at `aio app deploy` time; Runtime stores them encrypted and decrypts them just before the action runs
(`aio rt action get` shows names and value hashes only). Non-secret settings are reviewable literals.

- **Set:** put `NAME=value` in `apps/<ext>/worker/.env`, add `NAME: $NAME` to `app.config.yaml` and `NAME=` to `.env.example`.
- **Rotate:** edit the value in `.env`, then `env -u CI aio app deploy --action api`. No code change.
- **Delete:** remove the input and the `.env` line, redeploy.
- **Never** a literal secret in a committed file: `npm run check` fails on a secret-looking input (`*KEY*`, `*SECRET*`, `*TOKEN*`,
  `*PASSWORD*`) that is not a `$NAME` reference, and on a tracked `.env`, `.env.<name>` or `.aio`.
- The **pre-deploy guard** (`scripts/pre-deploy-guard.mjs`, wired as the `pre-app-deploy` hook in each worker's app config) refuses a
  deploy when a referenced `$NAME` is missing (or empty for a secret) in `.env`, when `ALLOWED_LOCAL_ORIGINS` is non-empty outside
  a `-stage` namespace, or when the config breaks the worker rules. Run it by hand: `node ../../../shared/worker-template/scripts/pre-deploy-guard.mjs`
  from the worker folder.
- Stage and Production are separate workspaces (namespaces `281295-ewextensions-stage` and `281295-ewextensions`), each with its
  own `.env`. Do not keep State entries holding long-lived credentials (Adobe discourages secrets in State); store only derived,
  short-lived tokens and caches.

## Deploy and promote

From the extension's `worker/` folder, with `env -u CI` and the owner's Developer Console login:

```sh
env -u CI aio app use            # choose the workspace; writes .env/.aio (untracked)
cp .env.example .env             # then merge: keep the AIO_* lines `aio app use` wrote, fill in the secrets
env -u CI aio app deploy         # Stage: branch refs and ref=local; pre-deploy guard runs first
env -u CI aio app get-url        # the web action URL
env -u CI aio app logs -a <package>/api -l 5
```

Promote = repeat with the **Production** workspace selected (`aio app use`, then `aio app deploy`); Production's `.env` must have
`ALLOWED_LOCAL_ORIGINS=` empty. Mapping rule: pages on `main` call the Production worker; every other ref and `localhost` call
Stage. Deployment is manual in this ticket; no Developer Console credential is in CI (a GitHub Actions deploy per Adobe's
CI/CD guide is a follow-up).

## CORS policy and why

Allowed browser origins: `https://da.live` and the code site's own origins `https://{ref}--{SITE}--{ORG}.{aem.live | aem.page |
preview.da.live}` (`preview.da.live` because EW prefers that authenticated proxy for iframes and falls back to `aem.live`, so the
extension page's real `Origin` can be any of the three). The demo site's hosts (`*--ew-extensions-demo--*`) are **not** allowed:
the demo site only holds content/config rows, the iframe loads from the code site. Exact local origins (`http://localhost:3000`)
only through `ALLOWED_LOCAL_ORIGINS` (Stage only). Matching is exact and anchored; `null` and `*` are never allowed. The action
deploys with `web: raw` and `web-custom-options: true`, otherwise the platform adds `Access-Control-Allow-Origin: *` to every
response; the template answers CORS itself, enforces the gate server-side (`403` before authentication) and never sends `*` or
credentials headers. Responses the platform itself produces (429 from rate limiting, request over 1 MB, a crash, a timeout) carry
no CORS headers, so the browser sees a network error: extensions must treat a rejected `fetch` as "worker unavailable". The real
`Origin` of an extension page in each EW context is verified by manual step W4 in the spec.

### Never put the worker origin in the URL

The page sends the user's IMS token to the worker origin, so the worker URL must be a constant **keyed by the page's own hostname**
(see `apps/hello-world/hello-world-worker.js`), never read from a query parameter, or a crafted link could send the token to an
attacker.

## Tests

| Command | What |
|---|---|
| `npm run test:worker` | template unit tests (auth, CORS, retry/proxy, secrets, store, scaffold, guard) + emulator tier + all worker tests |
| `npm run test:e2e` | Playwright: the hello page against the real hello action behind the emulator |
| `npm run test:worker:deployed` | opt-in live tiers: deployed worker (needs `WORKER_BASE_URL`, `IMS_TOKEN`) and Cloudinary proxy (needs key + secret); skipped with a message when unset; see `.env.example` |

The **emulator** (`test-kit/emulator.js`) runs the real action over real HTTP with the documented Runtime behaviour (raw params,
base64 JSON bodies, `OPTIONS` reaching the action, 1 MB limits answered without action headers). It is only as good as our reading of
the platform: the live tier re-asserts the key behaviours against the deployed worker.

## Runtime limits (shared workspace)

All workers of all extensions live in one workspace per environment and share its limits: 6,000 actions/minute and 100 concurrent
activations per namespace; payload, parameters and result 1 MB each; action timeout (this template sets 25 s; web actions through
the CDN are cut at 30 s); State 200 MB / 200K keys per workspace (non-production). A busy or runaway worker can starve the others.
Activation records keep results for 7 days, so routes returning sensitive user content should keep that in mind.

## Contract for downstream tickets

Stable across extensions (a change needs a note here): route declaration form, handler context, error codes, CORS and auth
behaviour, test-kit exports (`makeWorld`, `makeParams`, `makeInputs`, `canary`, `fakeIms`, `fakeUpstream`, `startEmulator`,
`memoryStore`), the app config shape (see `scaffold/app.config.yaml`), `providers/<vendor>/worker/` placement and the
Stage/Production mapping rule. Template version: **1** (initial).

Checklist for a vendor ticket: scaffold the worker -> declare secrets (`$NAME`, `.env.example`, `createAction({ secrets })`) ->
routes with `proxy` + `allowedHosts` -> decide `ALLOWED_IMS_CLIENT_IDS` / an `authorize` hook (any Adobe user's token passes
signature verification; pair a vendor credential with a client-id allowlist and rate-limit thinking) -> tests via `makeWorld` ->
`npm run lint && npm run check && npm run test:worker` -> manual deploy to Stage.

## Policy note

Hosting sits in an Adobe demo org (`adobe-demo-apac-195`) while the repo is under a personal account. Whether Adobe's
outside-activity/IP policy covers external vendor credentials and traffic there, and who owns the Production workspace and its
quota, is unresolved (carried over from #1): confirm before sharing anything.
