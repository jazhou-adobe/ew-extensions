# Spec: Shared backend worker template (secret-holding proxy)

Ticket: jazhou-adobe/ew-extensions#2 (this spec: #40). Blocked by #1 (repo scaffold, implemented; its spec is `apps/hello-world/SPEC.md`). #2 blocks 16 extension tickets (#3, #4, #7, #10, #11, #12, #13, #16, #18, #20, #22, #26, #27, #33, #37, #38).
Status: spec and build analysis only, no implementation. Research date: 2026-11-18. This revision supersedes the 2026-11-16 draft: the backend platform, DA test site and test environments were decided by the owner on 2026-11-18 (see "Owner decisions applied").
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 spec): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-18; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision, an experiment, or an answer from Adobe. **[INFERENCE]** = a conclusion drawn from verified facts that no source states directly.

Vocabulary follows the #1 spec: *extension* = one folder `apps/<name>/` (app or library plugin; the type comes from its EW config-sheet row: `apps` sheet = app, `library` tab = library plugin); *worker* = the per-extension backend in `apps/<name>/worker/`, here an App Builder application whose only content is one Runtime web action; *template* = this ticket's deliverable in `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension; *Stage* / *Production* = the two Developer Console workspaces of project `ew extensions`; *demo site* = DA site `jazhou-adobe/ew-extensions-demo`; *code site* = the EDS code repo `jazhou-adobe/ew-extensions`.

## Owner decisions applied (2026-11-18, not re-litigated here)

1. **Backend = Adobe App Builder (Adobe I/O Runtime web actions).** Org `adobe-demo-apac-195`, Developer Console project `ew extensions`, workspaces Stage and Production. Observed read-only with `env -u CI aio where`: Org `adobe-demo-apac-195`, Project `ew extensions`, Workspace `Stage`; `env -u CI aio console workspace list`: `Production` (id 4566206088345850977) and `Stage` (id 4566206088345850978), both enabled; CLI `@adobe/aio-cli/11.1.2` on Node 22.18.0 [VERIFIED by command, 2026-11-18]. Nothing was deployed.
2. **DA test site = `https://da.live/#/jazhou-adobe/ew-extensions-demo`** (GitHub `jazhou-adobe/ew-extensions-demo`, live at `https://main--ew-extensions-demo--jazhou-adobe.aem.live/`). Extension code stays in the code site and is served at `https://{ref}--ew-extensions--jazhou-adobe.aem.live/...`; the demo site's `apps`/`library` config rows point at those URLs.
3. **Cloudinary test environment:** cloud name `yifoe45l`, root folder `samples/` (neither is secret). Key and secret are supplied by the owner into an untracked `.env` only and never appear in this repo or this spec.

---

## Problem Statement

13 of the 18 planned EW extensions need a small backend (ticket text; the "Backend needed" column lives in the source spreadsheet, which I could not open). The reasons are always the same: hold a vendor credential (DeepL, Mux, Bynder, Firefly, Slack, Marketo, GA4, Cloudinary ...), avoid browser CORS limits on the vendor API, and exchange tokens server-side. Extension code is static files served publicly from the EDS code bus and iframed into `da.live`; anything shipped in it, including any API key, is readable by every visitor. So credentials cannot live in the extension.

If each of the 13 tickets built its own backend, each would re-invent (and probably get subtly wrong) the same security-critical plumbing: who may call it, which origins may call it from a browser, how secrets are stored and kept out of responses and logs, and how to survive a vendor's 429s and 5xx. A web action that holds a vendor key and accepts unauthenticated or wrongly-CORSed requests is a free API-credit faucet for the internet. App Builder adds its own traps on top: web actions answer every origin with `Access-Control-Allow-Origin: *` unless the action opts out, the built-in Adobe auth annotation is organisation-scoped and may not accept an EW user's token at all, and Runtime limits (1 MB payload, 30-60 s timeouts, shared per-namespace rate limits) shape what a proxy can do.

The maintainer needs one reusable, tested template that makes the secure behaviour the default on this platform and is proven end to end from the hello extension.

## Solution

Ship a **worker template** under `shared/worker-template/` for App Builder: a tested core library plus a copy-able scaffold. An extension author creates `apps/<ext>/worker/` by copying the scaffold: a headless App Builder application (`app.config.yaml`, minimal `package.json`, one ~20-line action entry that lists routes, an example `.env`, a README, a test stub). The worker deploys as one Runtime **raw web action** (`web: raw`) in a package named after the extension, and behaves like this before any extension-specific code runs:

1. **Origin gate and CORS.** The action takes over CORS completely (it opts out of the platform's default `*` CORS). Only `https://da.live` and the code site's own origins may call it from a browser; preflights are answered without a token; disallowed origins are refused server-side, not just left without CORS headers.
2. **Authentication.** Every non-preflight request must carry `Authorization: Bearer <IMS token>`. The token is verified inside the action (signature against Adobe IMS's published keys, token type, expiry, optional client-id allowlist). Missing or invalid token gives `401`, and nothing else (routing, secrets, outbound calls) happens first. The platform's own `require-adobe-auth` annotation is the preferred mechanism **if** an early experiment shows it accepts EW tokens and keeps CORS browser-readable; the in-action check is the specified fallback and the default (see Decision 5 and the S0 verification step).
3. **Route handler.** The extension's own code runs with a verified identity, a secrets accessor, a state store and an outbound proxy helper.
4. **Outbound proxy helper.** Calls a vendor with the secret injected inside the helper (route code never touches the raw value), retries `429`/`5xx` with exponential backoff and jitter, honours `Retry-After`, strips the caller's credentials, and refuses hosts that are not on the route's allowlist.
5. **Responses.** Secrets are never echoed: not in bodies, headers, errors or logs; a redaction pass backs this up.

Secrets live in an untracked `.env` per worker folder and are injected as action `inputs` by `aio app deploy`; Runtime stores them encrypted and decrypts them just before the action runs. Tokens and caches that must outlive one invocation use `@adobe/aio-lib-state` behind a small store interface.

The deliverable is proven end to end by the **hello extension**: `apps/hello-world/` gains a `worker/` and a "Call worker" button that calls a route that uses a secret (an HMAC signature; no vendor account needed) and shows the result, plus a second button that makes the same call without a token and visibly gets `401`. The template ships its own unit tests (auth, CORS, retry, secret hygiene), a web-action contract emulator tier that runs the real action over real HTTP in CI, an opt-in live tier against the deployed Stage worker and the Cloudinary test environment, README docs for local dev and deploy, and a worker test kit that every later vendor ticket reuses.

## User Stories

Extension author (maintainer or an agent working one of the 13 vendor tickets):

1. As an extension author, I want to copy one scaffold into `apps/<ext>/worker/` and be running in a few commands, so that adding a backend to my extension is mechanical.
2. As an extension author, I want the worker to reject unauthenticated callers before my route code runs, so that I cannot forget auth on a new route.
3. As an extension author, I want to declare routes as "METHOD + path -> handler" and receive a verified identity (user id, expiry, client id), so that route code stays small and never parses tokens itself.
4. As an extension author, I want a `proxy` helper that injects my vendor secret by name, so that my route code never holds the raw value.
5. As an extension author, I want the helper to retry `429` and `5xx` with exponential backoff and jitter and to respect `Retry-After`, so that vendor hiccups do not become user-visible failures.
6. As an extension author, I want non-idempotent requests (e.g. a credit-spending POST) not to be blindly retried on `5xx`, with an explicit opt-in when a POST is safe to retry, so that a retry never double-charges.
7. As an extension author, I want to declare per call which extra status codes are retryable or rate-limit signals (e.g. a vendor that answers `420`), so that vendor quirks do not need a fork of the helper.
8. As an extension author, I want a single place to declare which hosts a route may call, so that a bug that builds an outbound URL from user input cannot turn my worker into an open proxy.
9. As an extension author, I want secrets declared by name in the app config, listed in an example `.env`, and checked before deploy, so that a missing secret fails the deploy and shows up as a clear generic error at runtime, never a leak.
10. As an extension author, I want a `.env.example` and clear steps for local secrets, so that I never commit a real key.
11. As an extension author, I want a worker test kit (fake IMS key server, signed-token factory, web-action request builder, fake upstream, in-memory store, env/input factory), so that I can test my routes without any Adobe login, deployment or vendor sandbox.
12. As an extension author, I want one documented loop to run my worker against the real platform next to the `ref=local` dev server, so that I can try the extension and its backend together inside real EW.
13. As an extension author, I want one documented command to deploy my worker to Stage, one to promote to Production, and one to rotate a secret, so that going from local to a branch-ref test is routine.
14. As an extension author, I want to know exactly where vendor-specific server code goes, so that 13 tickets do not each invent a location.
15. As an extension author, I want a documented error shape and stable error codes, so that my browser code can branch on them.
16. As an extension author, I want my extension page to find its worker origin from a constant keyed by its own hostname, not from the URL, so that a crafted link cannot redirect my users' tokens elsewhere.
17. As an extension author, I want a state store with TTL (and an in-memory twin for tests and local runs), so that vendor OAuth tokens and caches survive between invocations without each ticket learning the State library's limits.
18. As an extension author, I want the template to make the platform's request/response contract (raw HTTP params, base64 JSON bodies, status/headers/body result) invisible, so that my routes look like ordinary request handlers.

Maintainer / operator:

19. As the maintainer, I want the template's behaviour covered by unit tests that run in CI without credentials, so that a regression in auth or CORS cannot merge.
20. As the maintainer, I want the real action run over real HTTP in CI through a web-action contract emulator, so that Node-only assumptions in unit tests cannot hide a transport difference.
21. As the maintainer, I want an opt-in live check that runs the same core assertions against the deployed Stage worker with a real token, so that the emulator's fidelity to the real platform is itself tested.
22. As the maintainer, I want the choice of App Builder and its rationale recorded in the README, so that nobody has to rediscover it.
23. As the maintainer, I want secrets only in the untracked `.env` and the platform's encrypted action inputs, never in git or in the committed config, so that the public repo cannot leak them.
24. As the maintainer, I want a check that fails CI when `.env` or `.aio` is tracked or a committed config input that looks like a secret holds a literal value, so that the most common mistake is machine-caught.
25. As the maintainer, I want worker sources and configs hidden from the public EDS code bus, so that internals are not published with the site.
26. As the maintainer, I want to rotate a secret by editing `.env` and redeploying the one action, with no code change, so that a leaked key is a five-minute fix.
27. As the maintainer, I want request ids and structured logs that never contain tokens or secrets, readable with `aio app logs`, so that I can debug production without creating a new leak.
28. As the maintainer, I want to restrict which IMS client ids (and optionally users) may call a worker, so that "any Adobe user" cannot spend my vendor quota.
29. As the maintainer, I want a pre-deploy guard that refuses a Production deploy carrying local-development settings or missing secrets, so that Stage-only conveniences never reach Production.
30. As the maintainer, I want worker deployment to be a manual, documented step in this ticket, so that no Developer Console credentials have to be put into CI yet.
31. As the maintainer, I want the per-namespace Runtime limits and the shared use of one workspace by all workers documented, so that I know when 13 extensions start competing for quota.

EW end user (content author):

32. As a content author, I want the hello app's "Call worker" button to show a result, so that I can see the backend integration works.
33. As a content author, I want the "Call without token" button to visibly fail with `401`, so that I can see the backend refuses unauthenticated callers.
34. As a content author, I want failures to show a short, plain message (no stack traces, no secrets), including when the platform itself rejects the call, so that I know whether to retry or contact the maintainer.
35. As a content author, I want extensions that use a worker to stay usable when the worker is slow or cold-starting (a visible "working" state and a bounded wait), so that the editor never hangs.

Security reviewer / attacker's-eye:

36. As a security reviewer, I want proof that a request from `https://evil.example` cannot get an `Access-Control-Allow-Origin` header (not even the platform default `*`) and cannot reach a handler, so that browser-based abuse from other sites is blocked.
37. As a security reviewer, I want proof that look-alike origins (`da.live.evil.com`, other sites' `aem.live` hosts including the sibling demo site, `http://da.live`) are rejected, so that the allowlist is not a loose suffix match.
38. As a security reviewer, I want proof that tokens signed by another key, `alg: none`, HS256 "key confusion", expired, wrong-type and wrong-client tokens are rejected, so that authentication is real.
39. As a security reviewer, I want proof that a canary secret never appears in any response, header or log across success and every error path, and that a caller cannot shadow a secret input through query string or body, so that "never echoed" and "never overridden" are tested rather than promised.
40. As a security reviewer, I want the caller's IMS token never forwarded to a vendor and never logged, so that a vendor compromise cannot replay it.
41. As a security reviewer, I want the same request without a token to fail against the deployed worker too, so that production, not just tests, enforces auth.

## Implementation Decisions

(No file paths or code, except where noted. Paths and layout are in the Build Analysis.)

1. **Platform: Adobe App Builder, one Runtime web action per extension, JavaScript ESM, no TypeScript, no framework, Node 22 (`nodejs:22`).** Adobe I/O Runtime supports the three latest Node versions and lists Node 22 among them [VERIFIED: https://developer.adobe.com/app-builder/docs/guides/runtime_guides/reference_docs/runtimes, read 2026-11-18], which matches the repo's Node 22 pin. Runtime keeps pre-warmed containers only for the *default* Node version with 256/512/1024 MB memory [VERIFIED: https://developer.adobe.com/app-builder/docs/guides/runtime_guides/throughput-tuning]; which version is the default is not stated [OPEN, low stakes: cold starts, not correctness]. The choice and rationale go in the README. Alternatives (a serverless platform outside Adobe, a long-running container) are not chosen because the owner decided on App Builder.
2. **Template = tested core + thin scaffold; extensions import the core, they do not fork it.** The core (request decoding, CORS, auth, proxy, secrets, redaction, store, errors, logging, router) lives once in `shared/worker-template/`; each extension's action entry imports it by relative path and `aio app build` bundles the result into the deployed action. Only the scaffold (app config, minimal package manifest, action entry, route list, example `.env`, README, test stub) is copied. Rationale: a security fix lands once for all 13 workers; forks drift. Cost: `apps/<ext>/worker/` is not self-contained at the source level, a deliberate exception to "no cross-folder imports" because `shared/worker-template/` is not an extension (the #1 spec reserves exactly this). [ASSUMPTION: the App Builder bundler follows relative imports outside the app root and resolves `jose`/`aio-lib-state` from the repo-root `node_modules`; verified by step S1 of the build plan. Fallback: workspace-level dependency installs, or the scaffold vendoring the core.]
3. **Folder structure forced by App Builder (stated as a decision, per the owner's instruction).** `aio` commands operate on an application root that holds the app config and a package manifest, plus the untracked `.env` and `.aio` files the CLI writes [VERIFIED: https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/configuration/configuration lists `app.config.yaml`, `.env`, `.aio` as the three root files]. Therefore `apps/<ext>/worker/` is itself an App Builder application root (the convention "worker lives in the extension's `worker/` subfolder" is kept), and the worker folder carries its own minimal package manifest and untracked `.env`/`.aio`. No other layout change is needed. A standalone application with `application:` (no `extensions:` and no UI) is valid, since only one of the two top-level fields is required [VERIFIED: same page].
4. **One action per extension, routed inside.** A worker serves one extension through a single web action named `api` in a package named after the extension; routes are dispatched from the unmatched URL path (`__ow_path`) [VERIFIED: path semantics at https://github.com/apache/openwhisk/blob/master/docs/webactions.md "HTTP Context"]. Rationale: auth, CORS and limits are implemented once per extension instead of once per route, containers stay warm for all routes, and the shared workspace namespace holds one entity per extension. Cost: all routes of an extension share secrets, memory and timeout. Vendor routes live with the vendor: server-side code for a vendor lives in `apps/<ext>/providers/<vendor>/worker/` and is registered by the extension's action entry [OPEN: confirm this refinement of the #1 convention].
5. **Authentication has two modes behind one switch; `in-action` verification is the default; `platform` mode is adopted only if experiment S0 passes.**
   - *Preferred in principle:* the platform annotation `require-adobe-auth: true`. On deploy it rewrites the action into a sequence whose first step is a shared validator that checks a bearer token against Adobe IMS and Adobe Exchange; the custom action runs only on success [VERIFIED: https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/security/ "Authentication and authorization handling"].
   - *Why it is probably not enough for EW [INFERENCE from verified facts]:* (a) the validator authorises a token only if "the invoked back-end action belongs to the organization for which the token was emitted" [VERIFIED: same page], i.e. EW users from other organisations are expected to fail; an Adobe employee's reply on a community thread says the user's product profiles must match those of the Developer Console project/workspace [VERIFIED: https://experienceleaguecommunities.adobe.com/built-by-developers-207/app-builder-spa-receiving-the-following-error-401-request-is-invalid-reason-failed-authorization-please-verify-your-token-and-organization-id-for-some-users-146457]; (b) `aio app dev` simulates the annotation and documents that callers must send both `Authorization` and `x-gw-ims-org-id` headers [VERIFIED: https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/development "Secure actions"], and the DA SDK hands the extension a token and a DA org *name*, not an IMS org id; (c) the annotation turns the action into a sequence, and Adobe documents that `final` and `web-custom-options` then have no effect [VERIFIED: security page "Known issue 1"], so the platform's default CORS (see Decision 6) would apply and the action could not narrow it. Whether the validator accepts a token issued to the DA client id (`darkalley`) at all is unknown [OPEN].
   - *Fallback (default): verify the token inside the action.* Offline JWT verification against Adobe IMS's published keys, mirroring Adobe's own DA backend: RS256 only, IMS claim `type = access_token`, `created_at + expires_in` (milliseconds) in the future, optional `client_id` allowlist [VERIFIED: https://github.com/adobe/da-admin/blob/main/src/utils/auth.js (`createRemoteJWKSet`, `jwtVerify`, `type !== 'access_token'`, `created_at + expires_in`)]. Any authenticated Adobe user passes the signature check; the client-id allowlist and the optional `authorize` hook narrow it (Decision 9).
   - *Early verification step S0* (first build step, needs a throwaway deploy to Stage): probes P1-P6 listed in the Build Analysis. Platform mode is adopted for a worker only if EW users who must be allowed (including a second account outside the Developer Console org) are accepted without values the extension cannot obtain **and** the denial and preflight responses are readable by the page. If any probe fails, `platform` mode is not implemented, the evidence is recorded in the README, and the default stays. If it passes, both modes are supported; in `platform` mode the action still enforces the origin gate and client-id allowlist on the claims it reads (the platform has already verified the signature) [ASSUMPTION: claims are readable from the forwarded `Authorization` header].
   - Only the `Authorization` header is accepted as token transport (no query-string tokens, no cookies). The handler receives a verified identity (`userId`, `clientId`, `expiresAt`) and a read-only copy of the claims. The raw token is never on that object and the proxy helper never forwards it.
   - Online validation (`/ims/profile/v1`, `/ims/validate_token/v1`) is not part of the default path: it costs a subrequest per call, and offline verification is what da-admin does. Trade-off: a revoked-but-unexpired token stays valid until expiry [OPEN: see questions]. `validate_token/v1` was observed to answer `{"valid":false,"reason":"bad_signature"}` for a bad token on 2026-11-16 but has no public documentation, so the spec does not depend on it [ASSUMPTION: its contract].
6. **Raw web action with the action in full control of CORS.**
   - The action is deployed with `web: raw` (the HTTP query and body reach the action only as `__ow_query`/`__ow_body`, never as top-level parameters) and with the `web-custom-options: true` annotation. Without that annotation the controller adds `Access-Control-Allow-Origin: *` to **every** response of the action, answers `OPTIONS` itself without invoking the action, and echoes `Access-Control-Request-Headers` [VERIFIED in source: https://github.com/apache/openwhisk/blob/master/core/controller/src/main/scala/org/apache/openwhisk/core/controller/WebActions.scala (`actionDelegatesCors`, `defaultCorsResponse`) and https://github.com/apache/openwhisk/blob/master/common/scala/src/main/scala/org/apache/openwhisk/http/CorsSettings.scala (`allowOrigin = *`); documented behaviour at https://github.com/apache/openwhisk/blob/master/docs/webactions.md "Options Requests"]. With `web-custom-options: true` the controller adds no CORS headers at all, and invokes the action for `OPTIONS` even when the caller is not authorised, so the action must emit the headers on every response including errors [VERIFIED: same source]. Adobe I/O Runtime is described as OpenWhisk-based (https://developer.adobe.com/app-builder/docs/get_started/runtime_getting_started/how-runtime-works); that the deployed Adobe gateway behaves identically to the open-source controller is [ASSUMPTION], verified by S0/S1 and the live tier.
   - Raw mode also means a caller cannot shadow an action input (a secret) through query string or JSON body, because non-raw web actions merge query and body parameters over package/action parameters whereas raw ones do not [VERIFIED: webactions.md "HTTP Context" and "Raw HTTP handling"]. A request that tries to set a reserved `__ow_` parameter is rejected by the platform with `400` [VERIFIED: same page].
   - Raw mode means JSON request bodies arrive base64-encoded in `__ow_body` (plain text bodies arrive as plain strings) [VERIFIED: the `eyJuYW1lIjoiSmFuZSJ9` example and the `__ow_body` definition in webactions.md]; the template decodes this once.
   - Content extension: callers use no extension (default `.http`), so the action's `statusCode`/`headers`/`body` become the HTTP response [VERIFIED: webactions.md "Content extensions"].
7. **Request pipeline order is fixed and tested: (1) decode raw params, (2) origin gate, (3) preflight short-circuit, (4) authentication, (5) routing, (6) handler.** Auth comes before routing, so an unauthenticated probe cannot tell which routes exist: an unknown route without a token gives `401`, with a token gives `404`. There are no unauthenticated routes other than `OPTIONS` preflight. Liveness of a deployed worker is checked by getting `401` on a bare request. A top-level guard turns every thrown error into a `500 internal` response, because an unhandled asynchronous error terminates the action and destroys its container, failing all in-flight activations [VERIFIED: https://developer.adobe.com/app-builder/docs/guides/runtime_guides/creating-actions "General error handling"]; all timers are owned by the request and cancelled with it.
8. **CORS policy.**
   - Allowed origins: exactly `https://da.live`, plus the code site's own origins `https://{ref}--ew-extensions--jazhou-adobe.{aem.live | aem.page}`, where site and org come from the worker's configuration and `ref` is any branch label. Owner decision 2 requires both the `aem.live` and `aem.page` hosts of `ew-extensions`. `{ref}--ew-extensions--jazhou-adobe.preview.da.live` is also included because EW's shell and library prefer an authenticated `preview.da.live` proxy for the iframe and fall back to `aem.live`, so the extension page's real `Origin` can be any of the three [VERIFIED in source: https://github.com/adobe/da-live/blob/main/blocks/shared/constants.js (`getLivePreviewUrl`, prod domain `preview.da.live`), https://github.com/adobe/da-nx/blob/main/nx/blocks/shell/shell.js (`usePreview` fallback), as read for the 2026-11-16 draft; not re-read today]. [OPEN: owner may drop `preview.da.live` if manual step W4 shows EW never uses it for this repo.]
   - The **demo site's** hosts (`*--ew-extensions-demo--jazhou-adobe.*`) are *not* allowed: the demo site hosts content and config rows, the iframe loads from the code site. A sibling-site look-alike is a tested negative (UC2).
   - Matching is exact and anchored (scheme, full host, no port, no suffix tricks); `Origin: null` and `*` are never allowed.
   - Exact local origins (for example `http://localhost:3000`, the fixed `ref=local` origin) are allowed only through an explicit `ALLOWED_LOCAL_ORIGINS` list. Stage sets it to `http://localhost:3000` so a `ref=local` page can call the Stage worker; **Production leaves it empty** (enforced by the pre-deploy guard, Decision 15), so the Production worker is exactly "da.live + the code site's own origins" as AC2 requires. Tests set the Playwright origin (`http://localhost:3100`) through the same list.
   - Preflight (`OPTIONS`) is answered without a token: `204` for an allowed origin with `Access-Control-Allow-Origin` echoing that origin (never `*`), allowed methods, allowed headers `Authorization, Content-Type`, `Access-Control-Max-Age`, and `Vary: Origin`. A disallowed origin gets `403` with no CORS headers. [ASSUMPTION: the platform passes a `204` status through unchanged; verified in S1.]
   - Server-side enforcement: a non-preflight request carrying a disallowed `Origin` is refused with `403` before authentication. A request with no `Origin` (curl, server-to-server) is not blocked by CORS (CORS is a browser control, not authentication); auth still applies.
   - Every response the action produces for an allowed origin, including `401`, `403`, `404`, `5xx`, carries the CORS headers and `Cache-Control: no-store`, and `Vary: Origin`. No `Access-Control-Allow-Credentials` (the token travels in `Authorization`, not cookies). Responses the **platform** produces itself (rate limit `429`, request over 1 MB, a crashed or timed-out action) carry no action-supplied headers, so the page sees an opaque network error, not a status [INFERENCE from the source above: with custom options the controller adds no CORS headers]; the extension must treat a rejected `fetch` as "worker unavailable".
   - Response caching: Runtime can cache action responses at the gateway when the response sets `Cache-Control: max-age` and honours `Vary` [VERIFIED: https://developer.adobe.com/app-builder/docs/guides/runtime_guides/throughput-tuning "Caching responses"]. The template therefore always sets `Cache-Control: no-store` on its own responses; a route that wants caching must opt in explicitly and must not cache anything user- or token-specific (the cache key is URL + `Vary` headers, not `Authorization`, unless `Vary: Authorization` is set) [INFERENCE].
9. **Secrets.**
   - Secrets are action `inputs`: the committed app config references them as `$NAME` and the untracked `.env` supplies the values at `aio app deploy` time [VERIFIED: https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/configuration/configuration "Using environment variables in Runtime actions"; https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/storage/application-state "Default parameters"]. Default parameters are encrypted at rest and decrypted just before the action code runs; `aio rt action get` lists names and value hashes only [VERIFIED: https://developer.adobe.com/app-builder/docs/guides/runtime_guides/creating-actions "Default params and encryption"]. Real secrets are never literals in the committed config and never `.env` contents in git.
   - Non-secret settings (site, org, IMS origin, allowed local origins, auth mode, client-id allowlist, state region) are also inputs but are literal values in the committed config, so they are reviewable.
   - Each worker declares its secret names as `$NAME` inputs and lists them in `.env.example`; a pre-deploy hook fails the deploy when any referenced `$NAME` is missing or empty in `.env` (the equivalent of a declared-required-secrets guard). [ASSUMPTION: the `pre-app-deploy` lifecycle hook runs before `aio app deploy` uploads; hooks `pre-app-deploy`/`post-app-deploy` exist per https://github.com/AdobeDocs/app-builder/blob/main/src/pages/guides/app_builder_guides/architecture_overview/app-hooks.md. Behaviour of an unset `$VAR` without the hook is unknown [OPEN]; the hook makes it moot.]
   - The secrets accessor is the only way route code reads a secret; a missing one yields a generic `500 misconfigured` and a log line with the secret's *name* only. The proxy helper takes a secret *name* and injects it into the outbound header/query itself.
   - Defence in depth: all response bodies, response headers and log lines pass through a redaction step that replaces any configured secret value (and the caller's token) with a fixed marker, so a vendor that echoes the key in an error body cannot leak it through us. Upstream error bodies are not passed to the browser by default; upstream failures map to template error codes. The action never logs its raw parameter object (it holds all secrets).
   - Rotation: edit the value in `.env`, then redeploy only the action (`aio app deploy --action <name>`, flag [VERIFIED: `aio app deploy --help` on CLI 11.1.2, 2026-11-18]); no code change.
   - Stage and Production are separate workspaces with separate Runtime namespaces, so each keeps its own `.env` values (Stage can use sandbox vendor keys). All workers of all extensions deploy into the same workspace; their package names (the extension folder names) must not collide, and the Runtime rate limits are per namespace, i.e. shared by every worker in that workspace (6,000 actions/minute and 100 concurrent activations by default; payload and result 1 MB; parameters 1 MB; web-action timeout 60 s, 30 s when served via the CDN) [VERIFIED: https://developer.adobe.com/app-builder/docs/guides/runtime_guides/system-settings; https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/configuration/configuration "limits"].
10. **State store.**
    - A small store interface (`get`, `put` with TTL, `delete`, JSON values) has two implementations: `@adobe/aio-lib-state` in deployed actions and an in-memory one for tests and for local runs, because the State library only works inside Runtime and fails under `aio app dev` [VERIFIED: https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/development "Storage libraries"].
    - State facts the helper enforces or documents [VERIFIED: https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/storage/application-state "Constraints"; https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/storage/ "State storage limits"]: values are strings only (the helper JSON-serialises); max value 1 MB; max key 1024 bytes, characters alphanumeric plus `-`, `_`, `.` (the helper validates and namespaces keys); TTL default 1 day, maximum 365 days, set in seconds; isolated per workspace; region chosen from `amer` (default), `emea`, `apac`, `aus`; per-workspace storage 200 MB (1 GB Production), 200K keys, 2 MB/min bandwidth (10 MB/min Production), 1K list operations/minute; `list` is not strongly consistent. A `429` (rate limit) or `403` (storage limit) from State is mapped to `503 store_unavailable`.
    - `@adobe/aio-lib-files` is **not** added by the template (no ticket needs blobs yet); vendor tickets that do (assets, large payloads over about 100 KB, pre-signed URLs) add it themselves. Its documented limits are no TTL, no bulk delete, US-region storage only [VERIFIED: storage page above].
    - Adobe "strongly discourage[s]" using State to store secrets for reuse and recommends a secret vault [VERIFIED: security page "Known issue 1"]. The template therefore stores only **derived, short-lived access tokens** (TTL at or below the token's own lifetime) and cache entries; long-lived credentials, client secrets and refresh tokens stay out of State until the owner decides on a vault or an encrypt-before-store scheme [OPEN].
    - The State client is created once per container and reused; the store helper never caches user-specific data in module memory (containers handle up to 200 concurrent invocations) [VERIFIED limit: https://developer.adobe.com/app-builder/docs/guides/runtime_guides/throughput-tuning].
11. **Outbound proxy helper.**
    - Uses the runtime's global `fetch` with `AbortController` timeouts. Retries: status `429` and every `5xx`; plus thrown network errors and per-attempt timeouts for idempotent requests. Default 3 retries (4 attempts), delay `min(cap, base * 2^n)` with full jitter [Source for the jitter choice: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/], base 250 ms, cap 2 s, per-attempt timeout 8 s, overall deadline 15 s, further bounded by the invocation's own deadline (the `__OW_DEADLINE` environment value, epoch milliseconds, minus a safety margin) [VERIFIED env var: https://github.com/apache/openwhisk/blob/master/docs/actions.md "Accessing action metadata"]. The action's own timeout limit is set explicitly to 25 s, under the documented 30 s CDN hard limit [VERIFIED: configuration page, "hard timeout limit of 30 seconds" for web actions served from the CDN; whether the `adobeioruntime.net` URL passes through the CDN is [OPEN], `aio app get-url --cdn` exists per `aio app get-url --help`]. All numbers are overridable per call and are a starting point [ASSUMPTION: no vendor guidance consulted].
    - `Retry-After` (delta-seconds or HTTP-date) is honoured as a minimum delay, bounded by the cap and the deadline [Source: https://www.rfc-editor.org/rfc/rfc9110.html, Retry-After].
    - Idempotency: `GET`, `HEAD`, `PUT`, `DELETE`, `OPTIONS` are retried on `5xx`; `POST`/`PATCH` are retried on `429` only unless the caller passes an explicit "safe to retry" flag (RFC 9110 defines which methods are idempotent). This is stricter than the literal AC wording ("retries 429 and 5xx") to avoid double-spending vendor credits; flagged for owner confirmation.
    - A call may declare extra *retryable* statuses and extra *rate-limit* statuses. Example from the Cloudinary test environment: its Admin API signals rate limiting with HTTP **`420`**, not `429`, and the free plan allows 500 Admin API requests per hour (`X-FeatureRateLimit-*` headers report limit, remaining and reset) [VERIFIED: https://cloudinary.com/documentation/admin_api_overview.md]; an hourly limit makes second-scale backoff useless, so the Cloudinary route should map `420` to `429 rate_limited` using the reset header, not retry it.
    - Request bodies are buffered (size-capped well under the platform's 1 MB payload limit, `413` over the cap) so every attempt replays the same bytes. Upstream response bodies are size-capped below the platform's 1 MB result limit (`502 upstream_too_large` over the cap); binary results are base64 in the body [VERIFIED limits: system-settings page above].
    - After exhausting retries the helper returns the last upstream response; the template's error mapper turns upstream `429` into `429` (with `Retry-After`) and upstream `5xx`/network failure into `502 upstream_unavailable`, without upstream body text.
    - Safety rails: absolute `https` URLs only (plain `http` only for loopback in tests), host must be on the route's declared allowlist, redirects are not followed automatically (`redirect: manual`) so a vendor 3xx cannot bounce the secret to another host, inbound `Authorization`, `Cookie`, `Host` and forwarding headers are stripped from the outbound request; auth schemes supported by the helper: bearer, a named header, a query parameter, HTTP Basic (the last is what Cloudinary's Admin API uses [VERIFIED: admin_api_overview.md]).
    - `fetch`, `sleep`, `random`, `now` are injectable so retry timing is tested without real waiting.
12. **Error contract.** All template-generated errors are JSON `{ "error": { "code", "message", "requestId" } }` with `Cache-Control: no-store`. Codes: `bad_request` (400), `unauthorized` (401, adds `WWW-Authenticate: Bearer`), `forbidden_origin` (403), `forbidden` (403, from `authorize`), `not_found` (404), `method_not_allowed` (405), `payload_too_large` (413), `rate_limited` (429), `misconfigured` (500), `internal` (500), `upstream_unavailable` (502), `upstream_too_large` (502), `auth_unavailable` (503, identity key set unreachable), `store_unavailable` (503). Messages are fixed strings; no input echo, no stack, no upstream text. Every response has `x-request-id` (generated per request; the platform activation id from `__OW_ACTIVATION_ID` is logged next to it [VERIFIED env var: actions.md above]), exposed through CORS.
13. **Logging.** One structured JSON line per request (request id, activation id, method, route pattern not raw URL query, status, duration, user id, outcome code, retry count) written to stdout. Never the token, never `Authorization`, never secret values, never request/response bodies. Logs are read with `aio app logs` [VERIFIED flags: `aio app logs --help` on CLI 11.1.2]; the per-action stdout limit is 10 MB [VERIFIED: system-settings]. Activation records, which keep the action's result for seven days [VERIFIED: system-settings "Activation TTL"], include response bodies; routes that return user content must keep that retention in mind [ASSUMPTION: web-action results are stored in the activation record].
14. **Hello worker and route.** `apps/hello-world/worker/` is the first consumer. Its main route, `GET /hello/sign?message=...`, returns `{ message, algorithm: "HMAC-SHA-256", signature: <hex> }`, where the signature is computed with the secret `HELLO_SECRET`. That is a real, checkable use of a secret that proves "used server-side, never returned", needs no vendor account, and can be recomputed in tests with an independent implementation. Message length is capped. A second diagnostic route, `GET /hello/state`, writes and reads back a random value with a short TTL through the store and returns `{ ok: true }`, proving State works in the deployed action with real credentials; it carries no user data and is not wired to the UI.
15. **Hello page changes and the worker-origin rule.** `apps/hello-world/` gets a "Call worker" button (sends `Authorization: Bearer <token from the SDK>`, shows the signature or a plain error) and a "Call without token (expect 401)" button (same request, no header, shows the status and error code). Both are disabled in the standalone (not-in-EW) state. The token is never rendered or logged (hello-world's existing rule). Only `apps/hello-world` is wired to a worker; `apps/hello-plugin` stays unchanged [OPEN: confirm "the hello extension" means the app]. **The worker origin is a constant keyed by the page's own hostname, never taken from the URL**: the page sends the user's IMS token to the worker origin, so a crafted `?worker=` link must not be able to redirect it. Mapping: host `main--ew-extensions--jazhou-adobe.{aem.live,aem.page,preview.da.live}` -> Production worker; any other `*--ew-extensions--jazhou-adobe.*` host and `localhost` -> Stage worker; any other host -> no worker calls (UI shows "not available here"). Consequently a `ref=local` page exercises the real Stage worker (the local loop deploys worker changes to Stage with `aio app run`, which redeploys actions on change [VERIFIED: https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/development "aio app dev vs aio app run"]) and no localhost-to-localhost call or self-signed certificate is involved. The worker base URLs are `https://<namespace>.adobeioruntime.net/api/v1/web/<package>/api` [VERIFIED URL form: https://developer.adobe.com/app-builder/docs/guides/runtime_guides/creating-actions "Invoking web actions"; namespace format `orgId-project(-workspace)` from https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/storage/application-state "Constraints"]; the concrete namespaces are known only after the first deploy [OPEN: `env -u CI aio runtime namespace list` failed here with "An AUTH key must be specified" because the repo has no `.env`/`.aio`; the Production namespace may omit the `-workspace` suffix, ASSUMPTION from the optional group in the format].
16. **Pre-deploy guard.** A script run through the `pre-app-deploy` hook (and by the same checks in CI against fixtures) fails the deploy when: a referenced `$NAME` is missing or empty in `.env`; the target namespace looks like Production and `ALLOWED_LOCAL_ORIGINS` is non-empty; the config does not set the raw/custom-options annotations; or an input whose name looks like a secret is a literal. This is what keeps Stage conveniences out of Production.
17. **Tooling (pinned per owner decision, additive to #1).** Root `package.json` gains runtime dependencies `jose` (6.x; `6.2.17` on npm 2026-11-18) and `@adobe/aio-lib-state` (5.x; `5.4.0` on npm 2026-11-18) bundled into the deployed actions, plus scripts for worker tests, the emulator tier, and the opt-in live tier. The `aio` CLI (`@adobe/aio-cli` 11.x; `11.2.0` on npm, `11.1.2` installed here) is a documented **global** developer tool, not a repo dependency: it is deploy/dev-only, is not used in CI, and is large [OPEN: confirm vs a pinned devDependency]. ESLint 8 + helix config applies to worker code with a Node-globals override; no new linter. Worker unit tests use the Node 22 built-in test runner (`node:test`, no new dependency): they need real `Request`/`Response`/`crypto.subtle`/`node:http`, must set the `Origin` header (browsers forbid it, so the browser-based `@web/test-runner` is the wrong tool) [VERIFIED: `Origin` is a forbidden request header name, https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header], and the repo already runs `node --test` for its script tests. No new minimum Node version (Node >= 22, as in #1).
18. **Deploy is manual in this ticket.** `aio app deploy` runs from the extension's `worker/` folder with the owner's Developer Console login, once per workspace (Stage for branch/local testing, Production for `main`). No Developer Console credential is in CI. A GitHub Actions deploy follows Adobe's documented CI/CD approach (https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/deployment/cicd-for-app-builder-apps) and is a documented follow-up, not built here. The owner's shell sets `CI=true`, which changes `aio` behaviour; run `aio` with `env -u CI`.
19. **Repo hygiene is machine-checked.** The #1 convention check (S3) gains rules: every `apps/*/worker/` is an App Builder app root with app config, package manifest, README, `.env.example` and tests; app configs live only in `apps/*/worker/` and the scaffold; no tracked `.env`, `.env.*` (except `.env.example`) or `.aio`; `.gitignore` covers them (and the `aio` build output); secret-looking inputs are `$NAME` references present in `.env.example`; the package name equals the extension folder name; the action sets the raw/custom-options annotations and an explicit timeout at or below 30 s. The #1 `.hlxignore` already hides `**/worker/`, `shared/worker-template/` and `**/SPEC.md` from the code bus.
20. **Public contract to downstream tickets** (what the 16 blocked tickets can rely on): route declaration form, handler context (identity, secret accessor, store, proxy helper, request id, logger), error codes, CORS and auth behaviour, test kit exports, app config shape, `providers/<vendor>/worker/` placement, the Stage/Production mapping rule. Changing any of these later is a breaking change across all workers and needs a template version note in the README.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given a web-action invocation (raw `params` with headers, path, query and body) and a fake outside world (fake IMS key server, fake vendor, in-memory store), assert the returned `{ statusCode, headers, body }`, the outbound requests made (count, headers, body, timing schedule), the store writes, and what was logged. Never assert on internal helper names, module structure, or how many times an internal function ran. The two most important properties are tested as *negative* properties across every code path: "the canary secret never appears anywhere" and "no handler or outbound call runs before auth succeeds".

**Proposed seams** (recorded here instead of asked, per #40). Existing seams from the #1 spec are reused wherever possible; two new ones are added at the highest possible points, plus one manual boundary.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| A1 (primary, new) | The web-action boundary: `main(params)` of a worker (raw web-action params in, `{statusCode, headers, body}` out), built by the template's `createAction` factory; plus the exported `proxy` helper as a public sibling | new | Node unit tests (template and each extension worker) | Constructed params via the kit's `makeParams` (handles the base64-JSON rule); input factory; injected outbound `fetch`, `sleep`, `random`, `now`, `store`; fake IMS via the test kit (locally generated RSA key, key set served through the injected fetch) |
| A2 (new) | The same `main` behind a **web-action contract emulator** over real HTTP | new | CI emulator tier; Playwright e2e | A small `node:http` adapter in the test kit translating HTTP to raw params and the result back, mimicking the *documented* platform behaviour (custom-options `OPTIONS`, 1 MB caps, no action headers on platform-generated errors); IMS and upstream are throwaway local Node servers |
| A3 (new, manual/opt-in) | The deployed Stage (and Production) web action over HTTPS | new | `test:worker:deployed` and manual steps | Real platform, real IMS token supplied by the owner in an environment variable; assertions are the A2 subset that proves emulator fidelity |
| S1 (reused, extended) | Entry HTML page + SDK module boundary | from #1 | Playwright e2e for hello-world | #1's `page.route` SDK stub (token is a test-signed IMS-shaped JWT); the worker under test is the real hello action behind the A2 emulator on localhost, so the browser performs a real cross-origin request, preflight included |
| S2 (reused) | Render/logic module + SDK result | from #1 | WTR tests for the hello page's worker-call code | injected `fetch`; hand-built SDK result |
| S3 (reused, extended) | Repo convention check + pre-deploy guard | from #1 | CI lint job | filesystem fixtures in a temp dir |

Why not fewer: the retry/backoff matrix is large and would be slow and noisy if driven only through full requests, so the exported `proxy` helper is a public surface in A1, tested directly. Why A2 exists at all: unit tests call `main` directly; the product runs behind a platform that converts HTTP to raw params and back. A2 is the smallest CI check that the same code works over a real socket, that a browser's preflight works, and that the base64/headers/status plumbing is right. Why A3 exists: A2 is only as good as our reading of the platform's behaviour, so the same core assertions are runnable against the real platform. The real EW boundary (real Adobe IMS login, real token claims) is covered only by manual verification.

**Modules tested:** request decoding, CORS/origin gate, auth (in-action verification, error mapping, key-set caching/rotation/outage), router/pipeline order, secrets accessor + redaction, store (State adapter contract with a fake State client, TTL/key validation, in-memory twin), proxy helper (retries, backoff schedule, `Retry-After`, idempotency, body replay, header hygiene, host allowlist, extra statuses, Basic auth), error/log contract, test kit self-check, hello worker routes, hello page worker-call code, convention-check and pre-deploy-guard additions.

**Prior art:**
- Upstream `adobe-rnd/ew-extensions` has no backend code (no worker/action files in its tree, checked via the GitHub tree API 2026-11-16), so test prior art is the pattern, not a worker: dependency-injection seams `fetchImpl`/`storage`/`now` in `tools/brand-visibility/session-auth.js` (https://github.com/adobe-rnd/ew-extensions/blob/main/tools/brand-visibility/session-auth.js) and the Tier 1 stub-only e2e idea from #1.
- This repo (implemented #1): `test/support/sdk-stub.js` + `test/support/e2e.js` (`stubSdk`, which aborts every non-localhost request, so an emulator on localhost is reachable but any real vendor is not), `scripts/check-conventions.mjs` and its `node --test` fixture tests, `web-test-runner.config.mjs` (fetch guard that rejects non-same-origin `fetch`, so hello-page tests inject `fetch`), `playwright.config.cjs` (`webServer`, port from `E2E_PORT`).
- Adobe's DA backend `adobe/da-admin` is the prior art for the *behaviour* (offline IMS verification, key-set caching); I read its source, not its tests.

## Out of Scope

- Any vendor integration (DeepL, Mux, Bynder, Firefly, Slack, Marketo, GA4, Cloudinary pickers ...) and any vendor sandbox work beyond the opt-in Cloudinary live check of the proxy helper; only the contract and hello proof.
- CI-driven deployment and storing Developer Console credentials in GitHub (documented as a follow-up).
- Online token validation/revocation checks, per-user quotas, API-gateway rate limiting or Runtime API-gateway path routing (`apis:` entries take 5-10 minutes to provision [VERIFIED: configuration page]; the single-action design does not need them).
- `@adobe/aio-lib-files`, `@adobe/aio-lib-db`, queues, triggers, alarms, action sequences other than the platform-generated one, App Builder UI/extension points (`dx/excshell/1` etc.), Adobe Product API integrations.
- A custom domain / production DNS for workers (the `adobeioruntime.net` URL is enough for the hello proof).
- TypeScript, bundler customisation beyond what `aio app build` does, any web framework.
- Authorisation against DA permissions (who may edit which site). Authentication only, plus the optional `authorize` hook.
- Browser Extension (Chrome) work: "extension" in this repo always means an EW app/plugin.
- Migrating the hello-plugin to use a worker.
- Storing long-lived vendor credentials or refresh tokens in State (needs a vault decision).
- The Adobe outside-activity/IP policy question (owned by #1 R1; restated in the open questions because hosting now sits in an Adobe demo org).

## Further Notes

- **Docs say nothing about EW backends.** The official EW developer doc cited by the ticket (https://www.aem.live/docs/ew/developing/apps-plugins) mentions the SDK, `sendText`/`closeLibrary`, and the `apps` sheet, but nothing about backends, CORS or calling external services (grep of the fetched page for `worker`, `cors`, `backend`, `secret` found nothing on 2026-11-16 [VERIFIED then; not re-fetched]). All guidance here is derived from SDK/shell/library source and the App Builder/Runtime docs, and the "which `Origin` will the extension page send" fact comes from source reading, not documentation. Settling it for real is manual step W4.
- **The EW context to know:** the SDK result carries `token` (IMS access token), `context`, and `actions` including `daFetch` [VERIFIED: https://da.live/nx/utils/sdk.js, read 2026-11-16 and fetched with HTTP 200 on 2026-11-18]. The extension is cross-origin to da.live (iframe on `*.aem.live`/`*.preview.da.live`/`localhost:3000`), which is why a fetch from the extension to the worker is a CORS request.
- **DA test site and config rows.** The EW config for the hello app lives in the demo site: `https://da.live/config#/jazhou-adobe/ew-extensions-demo/`, `apps` sheet, with a `path` that is the full URL of the code-site app, e.g. `https://da.live/app/jazhou-adobe/ew-extensions/apps/hello-world/hello-world`; the card shows at `https://da.live/apps#/jazhou-adobe/ew-extensions-demo`. [ASSUMPTION: the shell derives the iframe URL purely from the URL path segments (#1 spec 2.3), so an app URL naming the code site works even though that site is not the one whose config lists it; checked by manual step W2.] **Impact on #1's hello-world README and hello-plugin README, which still name the code site's own config:** their registration rows and the plugin's relative `library` path (`/apps/hello-plugin/hello-plugin.html`) resolve against the *editor's* site, i.e. the demo site, so a library row in the demo site must use an absolute code-site URL (absolute `path` values are used as-is, per the library helpers read for #1) and then `ref=local` no longer rewrites to `localhost:3000` for plugins. This ticket does not change #1's files except `apps/hello-world/`; the README update is flagged for the owner.
- **Current repo state (observed 2026-11-18):** #1 is implemented: root `package.json` (Node >= 22, scripts `lint`, `check`, `test`, `test:e2e`, ...), `scripts/check-conventions.mjs`, `test/support/{sdk-stub,e2e}.js`, `web-test-runner.config.mjs`, `playwright.config.cjs` (static server on `E2E_PORT`, default 3100), `.github/workflows/main.yaml` (jobs `lint`, `unit`, `e2e`), `apps/hello-world/` with entry page, bootstrap, render module, CSS, README, tests. `.hlxignore` already hides `**/worker/`, `shared/worker-template/`, `**/test/`, `scripts/`. `.gitignore` has only `node_modules/`, `playwright-report/`, `test-results/`, `.DS_Store`, `.omp/config.yml`; it must gain the `.env`/`.aio` rules (Decision 19). `shared/worker-template/` contains only this spec.
- **Runtime facts relevant to design** [VERIFIED: https://developer.adobe.com/app-builder/docs/guides/runtime_guides/system-settings, read 2026-11-18]: default action timeout 60 s (blocking web actions cap at 60 s), memory 256 MB (128-4096), action/container concurrency 200, code size 22 MB, parameters, payload and result 1 MB each, 6,000 actions/minute per namespace (18,000 on request), 100 concurrent activations per namespace, logs 10 MB, activation TTL 7 days. Web actions served through the CDN have a hard 30 s timeout [VERIFIED: configuration page].
- **`aio app dev` fidelity.** It runs the action in a local Node process behind `https://localhost:PORT/api/v1/web/<package>/<action>` with a self-signed certificate, has no activation records, and cannot use State [VERIFIED: development page]. It simulates `require-adobe-auth`; with in-action verification it exercises the real verification path, so it needs a real token. Chrome 142+ may block local-network access to such a server unless a flag is changed [VERIFIED: same page]. For these reasons the documented day-to-day loop is the kit-based tests plus `aio app run` against Stage; `aio app dev` is an optional manual step (W9).
- **Cloudinary test environment (owner decision 3).** Cloud name `yifoe45l`, root folder `samples/`, API base `https://api.cloudinary.com/v1_1/<cloud_name>/<action>`, Basic Authentication with API key and secret, `GET /ping` returns `{"status":"ok"}` [VERIFIED: https://cloudinary.com/documentation/admin_api_overview.md and https://cloudinary.com/documentation/admin_api_ping.md, read 2026-11-18]. Non-secret values go in a committed `.env.example`; key and secret go only in an untracked `.env`. Whether the account uses dynamic or fixed folder mode (which changes how `samples/` is addressed: public-id prefix vs asset folder) and its plan's rate limit are unknown [OPEN].
- The README the template ships must state: platform choice and rationale; folder layout and why `worker/` is an app root; local dev loop; deploy and promote; secrets lifecycle (set, rotate, delete); the CORS allowlist and why `preview.da.live` is in it; how to add a route; how to add a vendor; how to test; the "never put the worker origin in the URL" rule; Runtime limits and the shared-namespace caveat; the `env -u CI` tip; the open policy note carried over from #1.

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)
  └─ iframe: extension page (origin: https://{ref}--ew-extensions--jazhou-adobe.aem.live | .aem.page | .preview.da.live | http://localhost:3000)
        │  SDK handshake gives { token (IMS), context, actions }
        │  fetch(worker, { headers: { Authorization: 'Bearer <IMS token>' } })      <- cross-origin: CORS preflight first
        ▼
  Adobe I/O Runtime web action  (one per extension; project "ew extensions", workspace Stage or Production;
                                 code in apps/<ext>/worker, core imported from shared/worker-template)
        1 decode raw params   2 origin gate + preflight   3 IMS token check (keys: https://ims-na1.adobelogin.com/ims/keys)
        4 route -> handler    5 proxy(vendor, secret injected by name, retries)  ->  vendor API
        state store (aio-lib-state) for derived tokens / caches
```

Responsibility split:

| Concern | Browser extension (static files, public) | Worker (private runtime, holds secrets) |
|---|---|---|
| Vendor credentials | never | only place; encrypted action inputs fed from `.env` at deploy |
| Identity | obtains IMS token from the SDK, sends it | verifies it; produces identity for handlers |
| CORS | none to configure | decides who may call; answers preflights; platform default `*` disabled |
| Vendor calls | none | all of them, via `proxy` |
| Retries / vendor quirks | shows "working"/error state; treats a rejected fetch as "unavailable" | backoff, mapping of upstream failures |
| Which worker | constant keyed by own hostname (Decision 15) | n/a |
| UI, EW actions (`sendText` etc.) | all | none |

## 2. EW integration points

- **Library plugin vs app:** the worker is agnostic. Whether the calling extension is a fullscreen app (an `apps` sheet row) or a library plugin (a `library` row) only changes which origin and token the page uses; both get the IMS token from the same SDK result [VERIFIED: https://da.live/nx/utils/sdk.js; shell and library both pass `token`, per the #1 spec section 2.2]. So the template needs no per-type variants.
- **Config-sheet rows:** none are specific to the worker; the extension's own registration rows stay as in #1 but live in the demo site's config (`https://da.live/config#/jazhou-adobe/ew-extensions-demo/`, see Further Notes). The worker's address is not registered in EW at all; it is a constant in the extension's code (Decision 15).
- **SDK actions used:** none new. The hello page uses only the SDK's `token` and `context`. [A later ticket might proxy through `actions.daFetch`; out of scope.]
- **`ref=local` loop:** page at `http://localhost:3000` (the #1 dev server, port hard-coded by EW [VERIFIED per #1 spec 2.3]) calls the **Stage** worker. Worker changes are deployed to Stage with `aio app run` (redeploys on change) or `aio app deploy`. Two processes at most: `npm start` for the page, and the worker deploy/watch command.
- **Branch ref:** pages on `*.aem.live` / `*.aem.page` / `*.preview.da.live` for a non-`main` ref call the Stage worker. **`main`:** calls the Production worker.
- **Which `Origin`** the extension page sends in each of these cases is the main integration unknown (R2) and the reason the allowlist covers three hosts for the code site.
- **DA test site URLs:** editor/app entry `https://da.live/#/jazhou-adobe/ew-extensions-demo`; code served at `https://{ref}--ew-extensions--jazhou-adobe.aem.live/...`; demo content at `https://main--ew-extensions-demo--jazhou-adobe.aem.live/`.

## 3. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| Adobe IMS key set `GET {IMS_ORIGIN}/ims/keys` | fetch RS256 public keys to verify tokens offline | none (public) | Observed 2026-11-18: 200, 11 keys, all `alg RS256`, first `kid` `ims`. Same call as da-admin: https://github.com/adobe/da-admin/blob/main/src/utils/auth.js |
| Adobe IMS profile `GET {IMS_ORIGIN}/ims/profile/v1` | not used by default; da-admin uses it to fetch email | Bearer | same da-admin file |
| Adobe IMS `POST /ims/validate_token/v1` | not used | `client_id` + token | undocumented, [ASSUMPTION] |
| Runtime web actions | raw HTTP params (`__ow_method`, `__ow_headers`, `__ow_path`, `__ow_query`, `__ow_body`), result `statusCode`/`headers`/`body`, annotations `web-custom-options`, `raw-http`/`web: raw`, `final`, `require-adobe-auth` | n/a (in-action) | https://github.com/apache/openwhisk/blob/master/docs/webactions.md ; https://github.com/apache/openwhisk/blob/master/docs/annotations.md ; https://developer.adobe.com/app-builder/docs/guides/runtime_guides/creating-actions ; https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/configuration/configuration |
| `aio` CLI | `aio app deploy [--action]`, `app run`, `app dev`, `app get-url [--cdn]`, `app logs`, `app test`, `app use`, `app state` | Developer Console login | `--help` output on CLI 11.1.2, 2026-11-18 [VERIFIED]; https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/development |
| `@adobe/aio-lib-state` | `init({ region })`, `get`, `put(key, value, { ttl })`, `delete`; implicit Runtime credentials | automatic in Runtime | https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/storage/application-state ; limits https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/storage/ ; implicit credentials rely on the action receiving its API key [ASSUMPTION: `aio app deploy` sets what `aio-lib-state` needs; if not, add the OpenWhisk `provide-api-key` annotation, https://github.com/apache/openwhisk/blob/master/docs/annotations.md; proven by W8] |
| `jose` | `createRemoteJWKSet` with a custom `fetch`, `cooldownDuration`, `jwtVerify` | n/a | https://github.com/panva/jose ; version from `npm view jose` 2026-11-18; behaviour as used in da-admin [VERIFIED import and options] |
| Cloudinary Admin API | optional live check of `proxy` with Basic auth | API key + secret | https://cloudinary.com/documentation/admin_api_overview.md ; https://cloudinary.com/documentation/admin_api_ping.md |

**Auth flow (caller to worker), `in-action` mode:** SDK handshake gives the page the user's IMS access token -> page sends it as `Authorization: Bearer` -> action verifies signature (RS256, `kid` selected from the key set), `type`, `created_at + expires_in`, optional `client_id` allowlist -> identity -> handler. **`platform` mode (only if S0 passes):** the platform validator verifies the bearer token with IMS and Exchange before the action runs; the action then reads identity claims and applies the origin gate and allowlist. **Auth flow (worker to vendor):** vendor-specific, secret injected by the proxy helper from the action input; the caller's token is never forwarded.

**IMS token specifics I could not verify** [OPEN]: the exact claim names beyond the four da-admin reads (`type`, `user_id`, `created_at`, `expires_in`); that the EW (da.live) client id is `darkalley` (it is `imsClientId: 'darkalley'` in https://github.com/adobe/da-live/blob/main/scripts/scripts.js [VERIFIED as config value, 2026-11-18], but whether the token's `client_id` claim carries it is untested: no real token was available to inspect); token lifetime; whether library-plugin tokens use a different client id. The client-id allowlist therefore ships as configuration with the default decided after inspecting a real token in manual step W3.

## 4. Data contracts

All contracts are behaviour contracts, not code.

**Inbound request (what the browser sends).** `METHOD https://<namespace>.adobeioruntime.net/api/v1/web/<package>/api/<route path>?<query>`, no content extension. Header `Authorization: Bearer <IMS access token>`. JSON bodies use `Content-Type: application/json`. Browser calls are cross-origin so `Authorization` forces a preflight.

**Raw web-action params (what the action receives).** `__ow_method` (lower-case), `__ow_headers` (lower-case names), `__ow_path` (unmatched remainder, e.g. `/hello/sign`), `__ow_query` (unparsed string), `__ow_body` (base64 for JSON and binary, plain string otherwise), plus the action's `inputs` (secrets and configuration) as top-level properties; the caller cannot add or override top-level properties [VERIFIED for raw mode: webactions.md]. Header-name case and the exact `__ow_path` form are [ASSUMPTION] confirmed in S1.

**Action result (what the action returns).** `{ statusCode, headers, body }`; `body` is a string, JSON value or base64 string; the default content type is JSON; errors that should reach the browser are returned as normal results, not as the platform's `{ error: ... }` application-error form, so the template controls status and headers [VERIFIED semantics: webactions.md "Handling HTTP requests with actions" and "Error Handling"].

**Preflight response (allowed origin).** `204`; `Access-Control-Allow-Origin: <echoed origin>`; `Access-Control-Allow-Methods` = methods used by the worker's routes; `Access-Control-Allow-Headers: Authorization, Content-Type`; `Access-Control-Max-Age`; `Vary: Origin`. No credentials header. Disallowed origin: `403`, no CORS headers.

**App config shape (illustrative; committed; secrets only as `$NAME`).** One standalone application, one package named after the extension, one web action `api` with: raw web mode; annotations `web-custom-options: true` and, only if S0 passes, `require-adobe-auth: true`; runtime `nodejs:22`; limits `timeout` 25000 and an explicit `memory` of 256; and inputs:

| Input | Meaning | Stage | Production | Kind |
|---|---|---|---|---|
| `ORG`, `SITE` | derive the code site's own origins (`{ref}--{SITE}--{ORG}.*`) | `jazhou-adobe`, `ew-extensions` | same | literal |
| `IMS_ORIGIN` | key set base | `https://ims-na1.adobelogin.com` | same | literal |
| `ALLOWED_LOCAL_ORIGINS` | comma list of exact origins also allowed | `http://localhost:3000` | empty (guard-enforced) | literal per workspace via `$` from `.env`, checked by guard |
| `AUTH_MODE` | `in-action` or `platform` | `in-action` | `in-action` | literal |
| `ALLOWED_IMS_CLIENT_IDS` | comma list; empty means no client check | decided after W3 | same | literal |
| `STATE_REGION` | `aio-lib-state` region | [OPEN] | [OPEN] | literal |
| `HELLO_SECRET` (hello worker) | HMAC key | `$HELLO_SECRET` | `$HELLO_SECRET` | secret |

**Handler context** (what route code receives; documented as a table in the README): `request` (method, path, query, headers, body accessors), `identity {userId, clientId, expiresAt}`, `claims` (read-only), `config` (non-secret inputs only; secrets only via the accessor), `secret(name)`, `store`, `proxy(url, init, options)`, `requestId`, `log`. A handler returns a response object or a plain JSON-able value (wrapped into a `200` JSON response). A thrown `HttpError(code)` produces the matching error contract; any other throw produces `500 internal`.

**Proxy options contract:** target URL; method/headers/body; `auth: { secret: <name>, scheme: bearer | header | query | basic }`; `allowedHosts`; `retry: { retries, baseMs, capMs, deadlineMs, attemptTimeoutMs, idempotent, extraRetryStatuses, rateLimitStatuses }`; returns the upstream response (the error mapper handles exhausted retries).

**Store contract:** `get(key)`, `put(key, value, { ttlSeconds })`, `delete(key)`; keys validated against State's character set and length and prefixed per worker; JSON values; failure maps to `store_unavailable`.

**Error contract:** Decision 12. **Hello route contract:** `GET /hello/sign?message=<=256 chars>` -> `200 {message, algorithm, signature}`; missing/over-long `message` -> `400 bad_request`; no token -> `401`; disallowed origin -> `403`. `GET /hello/state` -> `200 {ok: true}` with a valid token.

## 5. Folder layout (proposed; fits the #1 convention)

```
shared/worker-template/
├─ SPEC.md                    this file
├─ README.md                  platform choice, folder layout, dev loop, deploy/promote, secrets, add route/vendor, CORS rationale
├─ .env.example               non-secret Cloudinary test values (cloud name, root folder) + blank key/secret for the live tier
├─ src/                       core: createAction/router, request decode, auth (jose), cors, proxy, secrets+redaction, store, errors, log
├─ scaffold/                  copied into apps/<ext>/worker/: app.config.yaml, package.json, actions/api/ entry, routes/, .env.example, README.md, test stub
├─ scripts/                   pre-deploy guard
├─ test/                      template unit tests (A1) + emulator tier (A2) + opt-in live tier (A3, Cloudinary)
└─ test-kit/                  exported helpers: makeParams, fake IMS (keypair, key set, token factory), fake upstream, memory store, input factory, canary, web-action emulator
apps/<ext>/worker/            App Builder app root: copied scaffold + this extension's routes; untracked .env and .aio; its own test/
apps/<ext>/providers/<vendor>/worker/   vendor-specific route modules registered by the extension's worker entry
```

The #1 spec's tree already reserves `worker/` and `shared/worker-template/`; this fills them in and adds `providers/<vendor>/worker/` as a refinement (Decision 4). Package name = extension folder name (kebab-case), which also guarantees uniqueness inside the shared workspace.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Adobe outside-activity/IP policy.** Carries over from #1 R1. Hosting now sits in an Adobe demo org (`adobe-demo-apac-195`) while the repo is under a personal account; the demo org's terms for external vendor credentials and traffic, and who owns the Production workspace, are unknown. | High for publishing; blocks nothing technical | [OPEN] README note; owner confirms before anything is shared. |
| R2 | **Actual `Origin` of the extension page** under shell vs library vs preview-proxy vs `ref=local` is read from source, not documented. A wrong allowlist breaks every extension in EW, or is too loose. | High | Allow the three known code-site hosts; log denied origins (origin only, not token); manual W4 observes the real values; README records them. |
| R3 | **Any Adobe user's token passes** a pure signature check. Combined with a vendor credential, a stranger can spend quota. | High | Client-id allowlist (config), optional `authorize` hook, per-route rate-limit guidance; owner decides the policy per vendor ticket. Default is documented, not silent. |
| R4 | **Platform auth annotation may reject EW users** (org/product-profile binding, `x-gw-ims-org-id`, unknown acceptance of the DA client id) or break preflight readability. | High for the "prefer platform auth" preference; none for the fallback | S0 probes P1-P6 first; in-action mode is the default and fully specified, so a failed S0 costs a README paragraph, not a redesign. |
| R5 | **Platform default CORS `*` on every response** if `web-custom-options` is lost (e.g. platform-mode sequence rewrite, or an author drops the annotation). | High | Convention check requires the annotation unless platform mode is enabled; server-side origin gate (403) stays regardless; contract tests UC6/UC7; A3 live check W6 curls a deployed worker for `Access-Control-Allow-Origin: *`. |
| R6 | **Emulator infidelity:** A2 mimics the documented OpenWhisk behaviour; the Adobe deployment may differ (header case, `__ow_path`, `204` pass-through, base64 rules). | Medium | S1 spike records the real shapes with a throwaway action; A3 reruns the A2 subset against Stage; emulator tests pin the recorded shapes. |
| R7 | **IMS claims/`kid`/client id unverified** against a real token. | Medium | Template reads only the four claims da-admin reads; W3 inspects a real token; the test kit's token shape is asserted to match what W3 records. |
| R8 | **No revocation:** offline verification accepts a revoked token until expiry. | Medium | Accepted by default (same as da-admin); optional online check is a documented extension, not built. [OPEN] |
| R9 | **IMS key-set outage or rotation** locks everyone out. | Medium | Per-container cache, bounded refetch on unknown `kid`, fail closed with `503 auth_unavailable`; tested (UA9, UA10). |
| R10 | **Shared workspace quota:** every extension's worker shares one namespace's rate limits (6,000/min, 100 concurrent) and State quota (200 MB / 200K keys / 2 MB/min bandwidth in non-production). A busy or runaway worker starves the others. | Medium | Documented; backoff in the helper; README lists limits; owner may split workspaces later. |
| R11 | **Platform-generated errors are opaque to the browser** (no CORS headers on rate-limit, oversize, crash, timeout responses). | Medium | Extension treats a rejected fetch as "unavailable" (HP3); template caps body sizes below the 1 MB limits and the action timeout below the 30 s CDN cap so these are rare. |
| R12 | **Cold starts** add latency to the first call and the key-set fetch; the 750 ms SDK handshake delay already makes "waiting" normal. | Low-Med | Visible "working" state with a bounded wait (HP3); `nodejs:22` + 256 MB; default-version pre-warm question [OPEN]. |
| R13 | **Bundling `shared/` into each worker** (import-not-copy) assumes the App Builder bundler resolves `jose`/`aio-lib-state` from the repo-root `node_modules` for files outside `apps/<ext>/worker/`, and accepts ESM action entries. | Low-Med | [ASSUMPTION] Verified by S1 (build + deploy of the hello worker); fallbacks: thin CommonJS entry wrapper; per-worker dependency install; scaffold vendoring the core. |
| R14 | **State in deployed actions** (credentials implicit, region, quotas) and in `aio app dev` (fails). | Low-Med | Store interface with in-memory twin; `/hello/state` + W8 prove it for real; region decided before first deploy [OPEN]. |
| R15 | **Secret in a public-capable repo** by accident (`.env` holds `AIO_runtime_auth`-style CLI credentials as well as vendor secrets [VERIFIED structure: configuration page "The .env file"]). | High if it happens | `.gitignore`, S3 rule, `.hlxignore`, pre-deploy guard, README; optionally GitHub secret scanning [OPEN]. |
| R16 | **Stage conveniences reaching Production** (`ALLOWED_LOCAL_ORIGINS`, sandbox vendor keys). | Medium | Pre-deploy guard keyed on the namespace shape (Production suffix assumption, [OPEN]); W6 curl negative against Production. |
| R17 | **Unset `$VAR` in the app config** deploys as empty/undefined silently [OPEN]. | Medium | Pre-deploy guard (Decision 16); runtime `misconfigured` error (US2). |
| R18 | **Web-action timeouts:** 60 s blocking, 30 s through the CDN; unclear which applies to the `adobeioruntime.net` URL. | Low | Action timeout 25 s, proxy deadline 15 s; `aio app get-url --cdn` checked in S1 [OPEN]. |
| R19 | **Activation records retain results for 7 days** (user content from vendors persists in Runtime). | Low-Med | Documented; routes returning sensitive content are a vendor-ticket concern. [ASSUMPTION on what the record stores] |
| R20 | **Tooling:** `aio` CLI is global (version drift), and the owner's shell sets `CI=true`. | Low | README pins the tested CLI major (11) and the `env -u CI` tip. |
| R21 | **Cloudinary test limits:** Admin API rate limit (500/hour on the free plan) and `420` as the rate-limit status; folder mode unknown. | Low | Live tier is opt-in, uses `ping` and one small listing, and never loops; helper supports extra statuses (Decision 11). |

## 7. Ordered build plan (sized to #2's acceptance criteria)

0. **Prerequisites (owner):** #1 merged (tooling, hello-world app, CI) [done]; `env -u CI aio where` shows the right org/project; `aio app use` run in a scratch worker folder for Stage and Production so `.env`/`.aio` exist; owner decides Open Questions 1-6 (auth default, import-vs-copy, vendor placement, hello scope, State region, root-vs-workspace dependencies) before step 1; owner supplies Cloudinary key/secret into the untracked `.env` only if the live tier is wanted.
1. **S0 + S1 spike (throwaway deploy to Stage; the only step that needs the platform before tests).** Deploy a throwaway raw web action with `web-custom-options` in a scratch package; record real request/response shapes (header case, `__ow_path` for sub-paths, `204` pass-through, base64 rules, `Authorization` pass-through, an `OPTIONS` call reaching the action, platform-generated error shapes, namespace and URL via `aio app get-url [--cdn]`); prove the bundler resolves a relative import outside the app root, `jose` and `aio-lib-state` from the root `node_modules`, and an ESM entry; prove a State round trip. Then run the **auth-mode probes** with one throwaway action annotated `require-adobe-auth: true`: P1 call with a real EW token and no extra header; P2 add `x-gw-ims-org-id` with the Developer Console org id; P3 call with a token of an Adobe account outside that org/product profile; P4 browser-style preflight (`Origin: https://da.live`, `Access-Control-Request-Headers: authorization`) with no token; P5 whether `web-custom-options` has any effect on that action; P6 the denial status/body and whether it carries CORS headers. Record results in the README and the PR, delete the throwaway packages, and fix the auth default (Decision 5). Pin the recorded shapes into the emulator.
2. **Tooling additions.** Add `jose`, `@adobe/aio-lib-state`, scripts (`test:worker`, `test:worker:deployed`), ESLint override for Node globals/test files in worker code, `.gitignore` entries (`.env`, `.env.*` except `.env.example`, `.aio`, the `aio` build output), keep `.hlxignore`. Verify lint is still green.
3. **Test kit first** (it is the product's test seam): `makeParams`, fake IMS (RSA keypair, key-set handler, token factory with claim overrides), fake upstream with scripted responses, memory store, input factory, canary secret, emulator. Self-test: a kit-signed token verifies with real `jose` against the kit's key set and has the claim shape da-admin reads; the emulator round-trips documented shapes.
4. **Request decode + CORS/origin gate**, test-first (UW1-UW6, UC1-UC9). AC2 (CORS half).
5. **Authentication**, test-first (UA1-UA16). AC1.
6. **Secrets accessor, redaction, error contract, logging**, test-first (US1-US7). AC2 (secrets half).
7. **Store**, test-first (UT1-UT5).
8. **Proxy helper**, test-first (UP1-UP14). AC3.
9. **Pipeline/router** tying 4-8 together with order tests (UA12, UA13), body caps, unknown route/method handling.
10. **Scaffold + pre-deploy guard + README** (platform decision, dev loop, deploy/promote, secrets, add-route/vendor, limits). AC4. Walk the README once on a scratch copy.
11. **Hello worker** in `apps/hello-world/worker/` with route tests (HW1-HW8). AC5 (server half).
12. **Hello page changes**: worker-call module + buttons + WTR tests (HP1-HP7); then Playwright e2e against the emulator (E2E1-E2E4). AC5 (browser half).
13. **Emulator tier** (EM1-EM5) in CI.
14. **Repo checks and CI**: extend S3 (UR1-UR8); add a `worker` CI job (unit + emulator) to #1's workflow; extend the e2e job to start the emulator; no secrets in CI.
15. **Deploy the hello worker to Stage, then Production, and run manual verification W1-W9** with a real Adobe login; run the A3 live tier; record results, the real namespaces and observed `Origin` values in the PR and README; set the worker-origin constants in the hello page.
16. **Opt-in Cloudinary live check** (CL1-CL3) if the owner supplied the key and secret.
17. **Hand-off note** in the README for the 16 downstream tickets (contract, placement, checklist).

---

# Testing Requirements

## 1. Template unit tests (seam A1; Node built-in runner)

Fixtures/mocks: all come from the test kit. `makeParams({method, path, query, headers, body, inputs})` builds raw web-action params (JSON bodies base64-encoded, lower-case header names, `__ow_*` keys only, as the platform does in raw mode). `makeInputs({...overrides})` builds production-like inputs (`ALLOWED_LOCAL_ORIGINS` empty) with a canary `HELLO_SECRET`-style value like `canary-s3cr3t-<random>`. `fakeIms` generates an RSA key pair, serves its key set through the injected `fetch`, and `signToken(overrides)` mints IMS-shaped tokens (`type`, `user_id`, `client_id`, `created_at`, `expires_in`, `kid`). `fakeUpstream(script)` replays a scripted sequence of statuses/headers/bodies and records every received request. `memoryStore()` records puts with TTL. `sleep`, `random`, `now` are injected (zero real waiting; jitter pinned to 0 or 1 to assert bounds). Console output is captured for log assertions. Every test calls the action's `main` (or `proxy(...)` for the helper) and nothing else.

### 1.1 Authentication (AC1)

| ID | Behaviour asserted |
|---|---|
| UA1 | No `Authorization` header -> `401`, `WWW-Authenticate: Bearer`, error JSON `unauthorized`; handler spy not called; fake upstream and fake IMS received zero requests |
| UA2 | Malformed headers (`Basic x`, `Bearer ` empty, `Bearer a b`, lower-case scheme still accepted, two comma-joined values) -> `401` |
| UA3 | Not a JWT (garbage, truncated, three empty segments) -> `401`; no exception escapes as `500` |
| UA4 | Signed by a different key; `alg: none`; HS256 token using the public key as the secret ("key confusion"); wrong `kid` -> all `401` |
| UA5 | Expired by `created_at + expires_in` (and by `exp` if present) -> `401`; valid just before expiry -> success (using injected `now`) |
| UA6 | `type` other than `access_token` -> `401` |
| UA7 | `client_id` not on the allowlist -> `401`; empty allowlist config -> not checked |
| UA8 | Valid token -> handler called once with identity (`userId`, `clientId`, `expiresAt`) and no raw token on the identity |
| UA9 | Key-set fetch fails or returns 5xx/garbage -> `503 auth_unavailable` and handler not called (fail closed), distinct from `401` |
| UA10 | Key rotation: token signed with a key whose `kid` is not in the cached set triggers a refetch after the cooldown and then succeeds; within the cooldown it does not hammer the key endpoint |
| UA11 | Two valid requests in one container -> one key-set fetch (cached) |
| UA12 | Pipeline order: unknown route without token -> `401`; unknown route with valid token -> `404 not_found`; known route wrong method with valid token -> `405` |
| UA13 | `OPTIONS` preflight from an allowed origin succeeds with no token and never reaches a handler |
| UA14 | Across UA1-UA11 the token string never appears in any response or captured log line |
| UA15 | `authorize` hook returning false -> `403 forbidden`; hook not called for unauthenticated requests |
| UA16 | `platform` mode (only built if S0 passes): a request with a forwarded `Authorization` header is not signature-checked again but still gets the origin gate and the client-id allowlist; a request with no header -> `401`; the mode switch defaults to `in-action` when unset |

### 1.2 Request decoding and web-action contract (A1)

| ID | Behaviour asserted |
|---|---|
| UW1 | JSON body arrives base64 in `__ow_body` and is decoded once; a plain-text body arrives as a string and is not base64-decoded; malformed base64/JSON -> `400 bad_request` |
| UW2 | Header lookup is case-insensitive over the lower-case `__ow_headers` map; duplicate-meaning headers (`origin`, `authorization`) are read once |
| UW3 | Route is selected from `__ow_path` (with and without trailing slash and empty path); query is parsed from `__ow_query` (repeated keys, percent-decoding, no query) |
| UW4 | Caller shadowing: query `?HELLO_SECRET=x` and body `{"HELLO_SECRET":"x"}` never replace the input value (raw params carry them only under `__ow_*`); the signature is computed with the configured secret |
| UW5 | Result shape: every response has numeric `statusCode`, string headers, string/JSON `body`; the template never returns the platform's `{ error: ... }` application-error shape for expected errors; binary bodies are base64 |
| UW6 | A handler that rejects after an `await` (asynchronous throw) -> `500 internal`, container survives (a second call works); no stack in the body |

### 1.3 CORS (AC2, first half)

| ID | Behaviour asserted |
|---|---|
| UC1 | Allowed: `https://da.live`; `https://main--ew-extensions--jazhou-adobe.aem.live`; same on `.aem.page`; same on `.preview.da.live`; a branch with hyphens (`my-branch--ew-extensions--jazhou-adobe.aem.live`). Each gets its own origin echoed in `Access-Control-Allow-Origin` |
| UC2 | Rejected (`403`, no ACAO): `https://evil.example`; `https://da.live.evil.com`; `https://notda.live`; `http://da.live`; `https://da.live:8443`; `https://main--ew-extensions-demo--jazhou-adobe.aem.live` (the demo site, a sibling); `https://main--other-site--jazhou-adobe.aem.live`; `https://main--ew-extensions--other-org.aem.live`; `https://main--ew-extensions--jazhou-adobe.aem.live.evil.com`; `null`; `*`; empty |
| UC3 | `http://localhost:3000` rejected with production inputs; accepted only exactly (not `:3001`, not `127.0.0.1:3000`, not `https://localhost:3000`) when it is in `ALLOWED_LOCAL_ORIGINS`; list entries are exact, not prefixes |
| UC4 | Preflight from allowed origin: `204`; `ACAO` is the origin (never `*`); `Access-Control-Allow-Headers` contains `Authorization` and `Content-Type`; `Max-Age` present; `Vary: Origin`; no `Allow-Credentials` |
| UC5 | Preflight from disallowed origin: `403`, no CORS headers (in particular no `*`), no body detail |
| UC6 | Actual requests from an allowed origin carry ACAO on `200`, `401`, `403`, `404`, `405`, `413`, `500`, `502`, `503` responses (so the browser can read the status); no response from the action ever has `ACAO: *` |
| UC7 | Actual request from a disallowed origin with a **valid token** -> `403` and the handler is not called (server-side enforcement, not just header omission) |
| UC8 | Request with no `Origin` (non-browser) is not blocked by CORS; auth still decides; response has no ACAO |
| UC9 | `x-request-id` and `Retry-After` are listed in `Access-Control-Expose-Headers`; `Cache-Control: no-store` on every template response |

### 1.4 Outbound proxy and retry (AC3)

| ID | Behaviour asserted |
|---|---|
| UP1 | `200` first try -> exactly one upstream call; response passed through |
| UP2 | `429, 429, 200` -> three calls; recorded `sleep` schedule equals the exponential schedule with jitter pinned to its upper bound (`base*2^n`), and respects the cap |
| UP3 | Each of `500, 502, 503, 504` is retried; `400, 401, 403, 404, 409, 422` are not retried (one call) |
| UP4 | Always `503` -> `retries + 1` attempts then the last response is returned; the template maps it to `502 upstream_unavailable` without upstream text; always `429` -> maps to `429` with `Retry-After` |
| UP5 | `Retry-After` in seconds and in HTTP-date form is honoured as the delay (bounded by the cap); an absurd value (86400) is capped |
| UP6 | Jitter bound: with `random` at 0 the delay is 0, at 1 it is the cap-limited exponential value; always within `[0, min(cap, base*2^n)]` |
| UP7 | POST with a JSON body: 429 retried, body bytes identical on every attempt; POST `503` is not retried by default and is retried when the explicit safe-to-retry flag is set; `PUT` `503` is retried by default |
| UP8 | Thrown network error and per-attempt timeout (via `AbortController`): retried for idempotent methods then `502`; not retried for POST by default; no timer or request outlives the invocation |
| UP9 | Overall deadline: when the next delay would exceed the budget, or the invocation deadline (`__OW_DEADLINE` minus margin), retrying stops early |
| UP10 | Header hygiene: inbound `Authorization`, `Cookie`, `Host`, `x-forwarded-*` are absent on the upstream request; the vendor secret is present exactly where `auth` says (bearer, header, query, and HTTP Basic encoding); the secret and the caller's token do not appear in the response body or headers |
| UP11 | Host safety: URL whose host is not in `allowedHosts`, a non-`https` URL (non-loopback), or a URL with credentials throws before any fetch; a `302` from upstream is not followed (the redirect response is returned/mapped, and no second request is made) |
| UP12 | Request body over the cap -> `413 payload_too_large` and no upstream call |
| UP13 | Extra statuses: a call declaring `420` as a rate-limit status maps it to `429 rate_limited` using the vendor reset header and does not retry; a call declaring `420` retryable retries it |
| UP14 | Upstream response over the cap -> `502 upstream_too_large`; binary upstream bodies are returned base64 with the right content type |

### 1.5 Secrets, errors, logging (AC2, second half)

| ID | Behaviour asserted |
|---|---|
| US1 | Canary property test: run a matrix of scenarios (success, each error code, upstream echoing the secret in its error body, handler throwing an `Error` whose message contains the secret, missing-secret path); the canary value never appears in any response body, any response header, or any captured log line |
| US2 | The accessor for a secret absent from the inputs (or empty) -> `500 misconfigured` with a fixed generic message; the log contains the secret's name but never a value |
| US3 | Handler that returns/throws an object containing the raw params or the secret is redacted to the marker in the response |
| US4 | Every error response matches the documented JSON shape and has `Cache-Control: no-store` and `x-request-id`; unknown thrown errors -> `500 internal` with no stack trace or message |
| US5 | One structured log line per request with the documented fields (request id, activation id, route pattern, status, duration, outcome) and none of: token, `Authorization` value, secret values, bodies, the raw params object |
| US6 | Non-secret configuration is readable by handlers; secrets are readable only through the accessor |
| US7 | Configuration/secret name collision: an input declared as a secret never appears in the handler's `config` view |

### 1.6 Store (State adapter)

| ID | Behaviour asserted |
|---|---|
| UT1 | `put` then `get` round-trips JSON through a fake State client that accepts only strings; TTL is passed in seconds; default and maximum TTL are enforced |
| UT2 | Invalid keys (length over 1024 bytes, characters outside alphanumeric plus `-_.`) are rejected before any State call; keys are prefixed per worker so two workers cannot collide |
| UT3 | Value over 1 MB rejected with a clear internal error, not a platform failure |
| UT4 | Fake State client failing with a rate-limit (`429`) or storage-limit (`403`) error -> `503 store_unavailable`; the handler can still choose to continue without the cache |
| UT5 | Memory twin behaves like the adapter (TTL expiry with injected `now`); a worker started without Runtime credentials selects the memory twin explicitly, never silently in a deployed action |

### 1.7 Test-kit self-check

UK1: a kit-signed token verifies with real `jose` against the kit's key set, the header has `kid` and `alg: RS256`, claims contain the four da-admin fields. UK2: the fake upstream records requests and replays scripts in order. UK3: `makeParams` output matches the shapes recorded in spike S1 (header case, base64 JSON, `__ow_path`). These guard against the kit drifting from reality (R6, R7).

## 2. Hello-world tests (AC5)

**Hello worker (seam A1, in `apps/hello-world/worker/test/`):**

| ID | Behaviour asserted |
|---|---|
| HW1 | `GET /hello/sign?message=abc` with a valid token and an allowed origin -> `200` and `signature` equals an independently computed HMAC-SHA-256 (computed in the test with `node:crypto` from the known test secret) |
| HW2 | The response contains no secret (canary) anywhere; changing the secret changes the signature (proves it is used) |
| HW3 | Same request without a token -> `401` with ACAO for the allowed origin (so the browser can read it) |
| HW4 | Missing or over-long `message` -> `400 bad_request` |
| HW5 | Missing `HELLO_SECRET` in the inputs -> `500 misconfigured`, generic |
| HW6 | Disallowed origin with a valid token -> `403` |
| HW7 | `GET /hello/state` with a valid token writes and reads back a value through the store (memory twin) and returns `{ok: true}`; no token -> `401` |
| HW8 | The committed app config for the hello worker passes the S3/guard rules (raw mode, custom options, `$HELLO_SECRET` reference, package name `hello-world`) |

**Hello page (seam S2, WTR; injected `fetch`):**

| ID | Behaviour asserted |
|---|---|
| HP1 | "Call worker" sends `Authorization: Bearer <sdk token>` to the configured worker origin and shows the returned signature as text |
| HP2 | "Call without token" sends no `Authorization` header and shows the `401` status and error code |
| HP3 | Worker `5xx`, rejected fetch (the opaque platform-generated error case), or slow response -> a short plain message and a bounded wait, no stack trace |
| HP4 | The token never appears in the DOM or console output (extends hello-world's existing rule) |
| HP5 | `?worker=https://evil.example` in the page URL is ignored; calls still go to the configured origin |
| HP6 | Both buttons are disabled in the standalone (no SDK) state |
| HP7 | Origin selection by page hostname: `main--ew-extensions--jazhou-adobe.aem.live`/`.aem.page`/`.preview.da.live` -> Production worker; `my-branch--ew-extensions--jazhou-adobe.aem.live` and `localhost` -> Stage worker; `evil.example` and `main--ew-extensions-demo--jazhou-adobe.aem.live` -> no worker, buttons disabled with an explanation |

**Browser to real action behind the emulator (seam S1 extended, Playwright, Chromium, hermetic):** The Playwright config starts the #1 static server (port from `E2E_PORT`, default 3100) and the emulator hosting the hello action on a second localhost port (secret from a temp env, key set from a throwaway fake-IMS server started in global setup, `ALLOWED_LOCAL_ORIGINS` set to the e2e page origin). The hello page's worker-origin mapping needs a test-only way to reach the local emulator: the page's `localhost` mapping points at the Stage worker, so the e2e test intercepts requests to the Stage worker URL with `page.route` and forwards them to the emulator (a test seam, not a URL parameter) [ASSUMPTION: `page.route` can fulfil the cross-origin request including the preflight; fallback is a build-time-free override module remapped by the same import-map approach #1 uses for the SDK]. The #1 SDK stub supplies a token signed by the test key.

| ID | Behaviour asserted |
|---|---|
| E2E1 | Click "Call worker" -> signature shown; it equals the independently computed HMAC (a real cross-origin request, preflight included) |
| E2E2 | Click "Call without token" -> UI shows `401`; the network log shows the endpoint answered `401` and the CORS headers let the page read it |
| E2E3 | Page HTML, DOM text, and all network responses contain neither the token nor the secret |
| E2E4 | Only expected hosts were contacted (page, worker/emulator, SDK stub); a stub token signed by a *different* key gets `401` through the full browser path |

## 3. Web-action contract emulator tier (seam A2; Node test files, runs in CI)

Starts the real hello action (and a conformance fixture action that exercises `proxy` against a local fake upstream) behind the emulator on a real port, with the key set and upstream pointed at local Node servers and secrets passed as inputs. Emulator rules are the documented platform behaviours: raw params, base64 JSON bodies, custom-options `OPTIONS` reaching the action, no action-supplied headers on platform-generated errors, 1 MB request and result caps.

| ID | Behaviour asserted |
|---|---|
| EM1 | The action starts through the emulator; a bare request gets `401` (the deployed-liveness signal) |
| EM2 | Valid token -> `200` hello signature equals the independent HMAC; preflight from an allowed origin and from `Origin: https://evil.example` behave as in UC4/UC5 over real HTTP |
| EM3 | `proxy` against the fake upstream: `429` then `200` is retried with real timers and tiny delays, and the fake upstream observes the injected secret header and no inbound `Authorization` |
| EM4 | The canary secret is absent from all responses (US1 repeated over real HTTP) |
| EM5 | A request body over 1 MB and a handler result over 1 MB produce the emulator's platform-style failure with no CORS headers, and the template's own caps (413 / `upstream_too_large`) trigger first for realistic sizes |

## 4. Opt-in live tiers (seam A3, not in CI)

Run by hand with `npm run test:worker:deployed`; skipped with a clear message when the required environment variables are unset. Inputs: `WORKER_BASE_URL` (Stage or Production) and `IMS_TOKEN` (a real EW token copied from DevTools by the owner, never committed, never pasted into chat or issues, expires), read from the environment or an untracked `.env`.

| ID | Behaviour asserted against the deployed worker |
|---|---|
| LV1 | Bare `GET /hello/sign?message=x` -> `401` with the documented error JSON |
| LV2 | With the real token and `Origin: https://da.live` -> `200`, signature equals a locally computed HMAC only if the owner supplies the same test secret via `HELLO_SECRET_CHECK`; otherwise shape-only |
| LV3 | `Origin: https://evil.example` with the real token -> `403`, response has no `Access-Control-Allow-Origin` at all (in particular not `*`) |
| LV4 | Preflight `OPTIONS` with `Origin: https://da.live` and `Access-Control-Request-Headers: authorization` -> `204` with the origin echoed |
| LV5 | Production only: preflight with `Origin: http://localhost:3000` -> `403`; Stage: `204` |
| LV6 | `GET /hello/state` with the token -> `200 {ok: true}` (State works with real credentials) |

**Cloudinary live check (owner decision 3; needs key and secret in `shared/worker-template/.env`, untracked):** a Node test drives the `proxy` helper with Basic auth against `https://api.cloudinary.com/v1_1/yifoe45l/...`.

| ID | Behaviour asserted |
|---|---|
| CL1 | `GET /ping` through `proxy` -> `200 {"status":"ok"}`; the Authorization header sent upstream is the Basic encoding of key:secret and the secret appears nowhere in the test's captured output |
| CL2 | One small listing under the `samples/` root (`max_results` 1) -> `200` with a JSON body; the rate-limit headers are surfaced to the mapper |
| CL3 | A deliberately wrong secret -> `401` from Cloudinary is mapped without echoing upstream text (no retry, one call). The test never loops, to stay inside the plan's hourly Admin API limit |

## 5. Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| UR1 | Fixture tests: an `apps/<ext>/worker/` missing the app config, package manifest, README, `.env.example` or a test fails; a complete one passes |
| UR2 | A tracked `.env`, `.env.<name>` (other than `.env.example`) or `.aio` (git ls-files in a temp repo) fails; `.gitignore` lacking those patterns fails |
| UR3 | A committed input whose name looks like a secret (`*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`) with a literal value fails; it must be a `$NAME` reference |
| UR4 | An app config anywhere other than `apps/*/worker/` and the scaffold fails |
| UR5 | Every `$NAME` referenced in a worker's app config appears in that worker's `.env.example` |
| UR6 | The worker action must set raw web mode and the `web-custom-options` annotation (unless S0 enabled platform mode for it), `nodejs:22`, and a `timeout` at or below 30000; the package name equals the extension folder name |
| UR7 | Pre-deploy guard: missing/empty referenced `$NAME` in `.env` fails; a Production-shaped namespace with non-empty `ALLOWED_LOCAL_ORIGINS` fails; Stage passes |
| UR8 | `.hlxignore` still hides `**/worker/` and `shared/worker-template/` |

## 6. End-to-end checks inside real Experience Workspace (manual; needs interactive Adobe login and Developer Console access)

Accounts and credentials needed: GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, per #1); config permission on the DA site `jazhou-adobe/ew-extensions-demo` (`https://da.live/config#/jazhou-adobe/ew-extensions-demo/`); an Adobe IMS identity with access to that DA site; a second Adobe account outside the Developer Console org (for P3); Chrome; the `aio` CLI logged in to org `adobe-demo-apac-195`, project `ew extensions` (Stage and Production); a throwaway `HELLO_SECRET` value per workspace (no vendor sandbox, no vendor key needed; the proof deliberately uses no external vendor). Never paste a real IMS token into chat, issue comments or logs; it is a live credential until expiry. Run `aio` with `env -u CI`.

- **W0 (prereq):** `env -u CI aio where` shows org/project/workspace; in the hello worker folder `env -u CI aio app use` for Stage; `.env` created from `.env.example` with `HELLO_SECRET`; confirm `git status` shows neither `.env` nor `.aio`. The demo site has the `apps` row for hello-world (path = the code-site app URL) and `https://main--ew-extensions--jazhou-adobe.aem.live/apps/hello-world/hello-world.html` returns `200` (per #1 M0).
- **W1 (S0/S1 spike results):** execute the build-plan step 1 probes P1-P6 and record: raw-param shapes, bundler/State findings, the auth-mode verdict. Proves the platform assumptions behind AC1, AC2, AC5 and fixes Decision 5.
- **W2 (deploy Stage and `ref=local`):** `env -u CI aio app deploy` from `apps/hello-world/worker/` on Stage; `env -u CI aio app get-url` gives the worker URL; record the Stage namespace and set the hello page's Stage constant (a normal PR). `curl -i <worker>/hello/sign?message=x` returns `401` (liveness + AC5 negative). Terminal: `npm start` (port 3000). Open `https://da.live/app/jazhou-adobe/ew-extensions/apps/hello-world/hello-world?ref=local` (and the card from `https://da.live/apps#/jazhou-adobe/ew-extensions-demo`), accept the trust prompt (as in #1 M1). Click "Call worker": signature appears (allow a cold start of a few seconds); click "Call without token": `401` shown. DevTools Network: preflight `OPTIONS` `204`, `Access-Control-Allow-Origin: http://localhost:3000` on the response. Proves AC1, AC2 (Stage local origin), AC5.
- **W3 (inspect a real token):** in DevTools on `da.live`, obtain the IMS access token (mechanism: the page's `window.adobeIMS` object per https://github.com/adobe/da-nx/blob/main/nx2/utils/ims.js; [ASSUMPTION] the console method name), decode only the **claims** locally (no pasting into online decoders), record the claim names and the `client_id` value, then decide `ALLOWED_IMS_CLIENT_IDS`. Verify `curl -H "Authorization: Bearer $TOKEN" -H "Origin: https://da.live" <worker>/hello/sign?message=x` returns `200`; `Origin: https://evil.example` returns `403`; no token returns `401`. (This is also the P1-P3 input for W1.)
- **W4 (branch ref, Stage; then Production on main):** push branch `worker-hello` (simple name), wait for code sync, open the same URL with `?ref=worker-hello`; click both buttons. In DevTools record the page's actual `Origin` (aem.live or preview.da.live) and confirm it is the Stage worker that answered. Merge and repeat on `ref=main` against the Production worker (deployed with `env -u CI aio app use` to Production, then `aio app deploy`). Resolves R2; record the observed origins in the README. Repeat for a library plugin context if a plugin is later wired.
- **W5 (secret hygiene):** search the Network panel responses, page source and DevTools Application storage for the `HELLO_SECRET` value (none); `env -u CI aio rt action get <package>/api` shows input names with value hashes only; with a name removed from `.env`, `aio app deploy` is stopped by the pre-deploy guard.
- **W6 (CORS negatives against the deployed workers):** the A3 tier LV1-LV5, in particular: no response ever carries `Access-Control-Allow-Origin: *` (R5); curl preflight with `Origin: https://evil.example` -> `403`, no ACAO; `Origin: https://da.live` -> `204` with that origin echoed; `Origin: http://localhost:3000` against Production -> `403` (localhost is Stage-only).
- **W7 (rotation):** change `HELLO_SECRET` in `.env`, `env -u CI aio app deploy --action api`; the same message now yields a different signature; no code change.
- **W8 (State and logs):** `GET /hello/state` returns `{ok: true}` on Stage; `env -u CI aio app state list` (from the worker folder) shows no leftover key after the TTL; `env -u CI aio app logs -a hello-world/api -l 5` shows the structured lines with request ids and no token or secret.
- **W9 (optional, `aio app dev`):** run `env -u CI aio app dev` in the worker folder, call the local `https://localhost:9080/api/v1/web/hello-world/api/hello/sign?message=x` with a real token (accept the self-signed certificate); confirm the verification path works locally and that `/hello/state` fails as documented (no State under `aio app dev`).

## 7. CI additions (no credentials, no Developer Console login)

| Job | Steps | Notes |
|---|---|---|
| `worker` | checkout, Node 22, `npm ci`, `npm run test:worker` (UA, UW, UC, UP, US, UT, UK, HW, EM, UR7) | runs on every push and PR, like #1's jobs; required check |
| `lint` (existing) | adds worker code and UR1-UR6, UR8 to ESLint + S3 | |
| `unit` (existing) | gains HP1-HP7 through the existing WTR glob | |
| `e2e` (existing) | gains the emulator `webServer` and the E2E1-E2E4 specs | Chromium only, as in #1 |

The opt-in A3/Cloudinary tiers are not in CI. A GitHub Actions deploy job is a follow-up (Open Question 9).

## 8. Acceptance-criteria traceability (ticket #2)

| # | Acceptance criterion (#2) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Template validates the caller's IMS token before doing anything; missing or invalid tokens get 401 | UA1-UA9 (token matrix, 401 vs 503 distinction), UA12 (auth before routing, no handler/upstream call), UA14, UA16; EM1, EM2; HW3; E2E2, E2E4 | **W1** (auth-mode probes, fixes in-action vs platform), **W2** (bare `curl` -> 401 on Stage), **W3** (real token -> 200, none -> 401), LV1, LV2 |
| AC2 | Secrets come from the platform secret store and are never echoed to the browser; CORS allows only `https://da.live` and the site's own origins | US1-US7 and HW2 (canary never leaks), UW4 (callers cannot shadow secrets), UC1-UC9 (origin matrix, server-side enforcement, preflight, error responses readable, no `*`), UR2, UR3, UR5, UR6, UR7 (no secret in git, secrets as `$NAME`, annotations, Production guard); EM2, EM4; E2E3 | **W5** (secret hygiene, `aio rt action get` hashes only, pre-deploy guard), **W6** (CORS negatives and no `*` on deployed workers), **W4** (real origins), **W7** (rotation through `.env` + redeploy); README review: states the allowlist and why |
| AC3 | Outbound proxy helper retries 429 and 5xx with exponential backoff | UP1-UP14 (schedule, jitter bounds, `Retry-After`, idempotency, body replay, caps, exhaustion mapping, extra statuses, deadline); EM3 (real HTTP) | CL1-CL3 (real vendor, Basic auth, no looping); review: defaults documented in the README with the caveat that vendor tickets tune them; owner confirms the POST-5xx policy (Open Question 6) |
| AC4 | Local dev and deploy steps documented; each extension's worker lives inside that extension's folder | UR1, UR4 (worker location and completeness enforced), UR2, UR7 (hygiene and guard); CI `worker` job proves the documented test commands | **Walk-through**: a reviewer follows the README on a scratch copy (`apps/x/worker`) from clean clone to a Stage deploy; **W0**, **W2**, **W7**, **W9** are the real deploy/promote/local-dev runs; README review for the platform-choice note |
| AC5 | Hello extension calls a worker route that uses a secret and returns a result; the same call without a token fails | HW1-HW8; HP1-HP7; E2E1-E2E4 (browser to the real action behind the emulator, positive and negative); EM2 | **W2** (`ref=local` against Stage), **W4** (branch ref and Production, real CORS), **W2** curl without token, **W3**, LV1-LV2, LV6 |
| AC6 | Template has its own unit tests (auth check, CORS, retry) | UA*, UW*, UC*, UP* (+US*, UT*, UK*) run by `npm run test:worker` and the `worker` CI job on every push/PR | Review: CI shows the job green on a PR; deliberately break a rule on a scratch branch (e.g. loosen the origin matcher) and see UC2 fail |

Every acceptance criterion on #2 maps to at least one automated test or a numbered manual verification step above.

## 9. Open questions for the owner

Resolved by the 2026-11-18 owner decisions and therefore removed: platform choice, DA test site, hosting account (now the Adobe demo org), Cloudinary sandbox availability.

1. **Auth default.** In-action IMS verification is the default and `require-adobe-auth` is adopted only if S0 shows it accepts EW tokens (including users outside the Developer Console org) and keeps preflight and denials readable. The documented org/product-profile binding makes a pass unlikely. Agree to proceed on that basis, with S0 as the first build step (it needs a throwaway deploy to Stage)?
2. **Import vs copy.** Confirm that extension workers *import* the shared core by relative path (one security-fix location, deviates from fully self-contained folders) rather than vendoring a copy per extension (self-contained, drifts).
3. **Vendor route placement.** Confirm `apps/<ext>/providers/<vendor>/worker/` for server-side vendor code, registered by `apps/<ext>/worker/`'s entry (refinement of the #1 convention).
4. **Hello scope.** "The hello extension" = `apps/hello-world` (app) only? Or should `apps/hello-plugin` also call a worker (it would need its own worker package)?
5. **Worker test runner.** Node built-in `node:test` + the emulator tier (this spec, no new runner), or the App Builder default (Jest, adds a dependency; `aio app test` expects it)?
6. **POST/PATCH `5xx` retry policy.** This spec retries POST/PATCH only on `429` unless the caller opts in. The ticket literally says "429 and 5xx". Accept the safer default?
7. **Who may call a worker.** Accept "any authenticated Adobe user passing a client-id allowlist" as the default policy (R3), or require an org/user allowlist from the start? Does offline-only verification (no revocation check, R8) satisfy you?
8. **Real token facts.** I could not inspect a real EW IMS token: is the EW client id `darkalley` and does the token carry `client_id`/`kid`? W3 will confirm; tell me earlier if you know.
9. **Deploy automation.** Manual `aio app deploy` for now. Do you want a follow-up ticket for a GitHub Actions deploy using Developer Console credentials stored as GitHub secrets (per Adobe's CI/CD guide)?
10. **Workspace mapping and namespaces.** Confirm: `main` pages -> Production workspace, every other ref and `localhost` -> Stage workspace. The concrete namespaces and the Production namespace shape (suffix or none) are known only after the first deploy and `aio app use`; may the implementer run those commands against Stage and Production?
11. **State.** Which region (`apac` fits the org name; default is `amer`)? Accept "derived short-lived tokens only, no long-lived credentials in State until a vault or encrypt-before-store decision" (Adobe discourages secrets in State)?
12. **Tooling placement.** `aio` CLI as a documented global tool (this spec) or a pinned devDependency? Runtime dependencies (`jose`, `aio-lib-state`) at the repo root (this spec) or npm workspaces per worker?
13. **`preview.da.live` origins.** Keep `{ref}--ew-extensions--jazhou-adobe.preview.da.live` in the allowlist (EW prefers that proxy for iframes per source) or restrict to the `aem.live`/`aem.page` hosts you named until W4 proves it is needed?
14. **Demo-site registration of #1's hello extensions.** The hello READMEs still name the code site's config and a relative plugin path; the demo site's rows need absolute code-site URLs (Further Notes). Update #1's README/rows in this ticket or in a separate chore?
15. **Secret scanning.** Do you want GitHub secret scanning/push protection enabled on the repo as a second net behind the S3 rules (R15)? (Repo setting; not automatable here.)
16. **Policy and ownership (R1, carries #1).** Does Adobe's outside-activity/IP policy cover this repo using the `adobe-demo-apac-195` org, and who owns the Production workspace and its quota (R10)?
17. **Cloudinary.** Is the `yifoe45l` account in dynamic or fixed folder mode, and which plan (the free plan allows 500 Admin API requests per hour)? Where do you want the key/secret `.env` for the live tier (`shared/worker-template/.env`, this spec's choice)?
18. **Default Node version for pre-warmed containers.** Is `nodejs:22` the Runtime default (affects cold-start only)? Check with `aio` or the Runtime team; not blocking.
