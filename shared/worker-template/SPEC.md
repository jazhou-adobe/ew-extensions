# Spec: Shared backend worker template (secret-holding proxy)

Ticket: jazhou-adobe/ew-extensions#2 (this spec: #40). Blocked by #1 (repo scaffold; its spec is `apps/hello-world/SPEC.md`). #2 blocks 16 extension tickets (#3, #4, #7, #10, #11, #12, #13, #16, #18, #20, #22, #26, #27, #33, #37, #38).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 spec): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Cloudflare.

Vocabulary follows the #1 spec: *extension* = one folder `apps/<name>/` (app or library plugin, type decided by its EW config-sheet row); *worker* = the per-extension backend in `apps/<name>/worker/`; *template* = this ticket's deliverable in `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension.

---

## Problem Statement

13 of the 18 planned EW extensions need a small backend (ticket text; the "Backend needed" column lives in the source spreadsheet, which I could not open). The reasons are always the same: hold a vendor credential (DeepL, Mux, Bynder, Firefly, Slack, Marketo, GA4 ...), avoid browser CORS limits on the vendor API, and exchange tokens server-side. Extension code is static files served publicly from the EDS code bus and iframed into `da.live`; anything shipped in it, including any API key, is readable by every visitor. So credentials cannot live in the extension.

If each of the 13 tickets built its own backend, each would re-invent (and probably get subtly wrong) the same security-critical plumbing: who is allowed to call it, which origins may call it from a browser, how secrets are stored and kept out of responses and logs, and how to survive a vendor's 429s and 5xx. A worker that holds a vendor key and accepts unauthenticated or wrongly-CORSed requests is a free API-credit faucet for the internet.

The maintainer needs one reusable, tested template that makes the secure behaviour the default and is proven end to end from the hello extension.

## Solution

Ship a small, platform-native **worker template** under `shared/worker-template/`, built for Cloudflare Workers (the platform the ticket suggests; Adobe's own EW workers also run there). It is a tested core library plus a tiny scaffold. An extension author creates `apps/<ext>/worker/` by copying the scaffold (a wrangler config, a ~20-line entry file that lists routes, an example secrets file, a README, and a test stub). The worker then behaves like this, before any extension-specific code runs:

1. **Origin gate and CORS.** Only `https://da.live` and the site's own origins may call it from a browser; preflights are answered without a token; disallowed origins are refused server-side, not just left without CORS headers.
2. **Authentication.** Every non-preflight request must carry `Authorization: Bearer <IMS token>`. The token is verified (signature against Adobe IMS's published keys, token type, expiry, optional client-id allowlist). Missing or invalid token gives `401`, and nothing else (routing, secrets, outbound calls) happens first.
3. **Route handler.** The extension's own code runs with a verified identity, a secrets accessor, and an outbound proxy helper.
4. **Outbound proxy helper.** Calls a vendor with the secret injected inside the helper (so route code never needs to touch the raw value), retries `429`/`5xx` with exponential backoff and jitter, honours `Retry-After`, strips the caller's credentials, and refuses hosts that are not on the route's allowlist.
5. **Responses.** Secrets are never echoed: not in bodies, headers, errors or logs; a redaction pass backs this up.

The deliverable is proven end to end by the **hello extension**: `apps/hello-world/` gains a `worker/` and a "Call worker" button that calls a route that uses a secret (an HMAC signature; no vendor account needed) and shows the result, plus a second button that makes the same call without a token and visibly gets `401`. The template ships its own unit tests (auth, CORS, retry, secret hygiene), a small runtime smoke test in the real workers runtime, README docs for local dev and deploy, and a worker test kit that every later vendor ticket reuses.

## User Stories

Extension author (maintainer or an agent working one of the 13 vendor tickets):

1. As an extension author, I want to copy one scaffold into `apps/<ext>/worker/` and be running locally in a few commands, so that adding a backend to my extension is mechanical.
2. As an extension author, I want the worker to reject unauthenticated callers before my route code runs, so that I cannot forget auth on a new route.
3. As an extension author, I want to declare routes as "METHOD + path -> handler" and receive a verified identity (user id, expiry, client id), so that route code stays small and never parses tokens itself.
4. As an extension author, I want a `proxy` helper that injects my vendor secret by name, so that my route code never holds the raw value.
5. As an extension author, I want the helper to retry `429` and `5xx` with exponential backoff and jitter and to respect `Retry-After`, so that vendor hiccups do not become user-visible failures.
6. As an extension author, I want non-idempotent requests (e.g. a credit-spending POST) not to be blindly retried on `5xx`, so that a retry never double-charges; I want an explicit opt-in when a POST is safe to retry.
7. As an extension author, I want a single place to declare which hosts a route may call, so that a bug that builds an outbound URL from user input cannot turn my worker into an open proxy.
8. As an extension author, I want secrets declared by name in the wrangler config and a missing secret to fail the deploy and show up as a clear generic error at runtime, so that misconfiguration is caught early and never leaks.
9. As an extension author, I want a `.dev.vars.example` and clear steps for local secrets, so that I never commit a real key.
10. As an extension author, I want a worker test kit (fake IMS key server, signed-token factory, fake upstream, env factory), so that I can test my routes without any Adobe login, Cloudflare account or vendor sandbox.
11. As an extension author, I want one command to run my worker locally next to the `ref=local` dev server, so that I can try the extension and its backend together inside real EW.
12. As an extension author, I want one documented command to deploy my worker and one to set a secret, so that going from local to a branch-ref test is routine.
13. As an extension author, I want to know exactly where vendor-specific server code goes, so that 13 tickets do not each invent a location.
14. As an extension author, I want a documented error shape and stable error codes, so that my browser code can branch on them.
15. As an extension author, I want my extension page to find its worker origin from a constant, not from the URL, so that a crafted link cannot redirect my users' tokens elsewhere.

Maintainer / operator:

16. As the maintainer, I want the template's behaviour covered by unit tests that run in CI without credentials, so that a regression in auth or CORS cannot merge.
17. As the maintainer, I want a smoke test in the real workers runtime (workerd via wrangler), so that Node-only assumptions in the unit tests cannot hide a runtime difference.
18. As the maintainer, I want the choice of Cloudflare Workers and its rationale recorded in the README, so that nobody has to rediscover it.
19. As the maintainer, I want secrets in the platform secret store only, never in git, never in `vars`, so that the public repo cannot leak them.
20. As the maintainer, I want a check that fails CI when a worker secret file is tracked or a non-secret `vars` key looks like a secret, so that the most common mistake is machine-caught.
21. As the maintainer, I want worker sources and configs hidden from the public EDS code bus, so that internals are not published with the site.
22. As the maintainer, I want to rotate a secret with one command and no code change, so that a leaked key is a five-minute fix.
23. As the maintainer, I want request ids and structured logs that never contain tokens or secrets, so that I can debug production without creating a new leak.
24. As the maintainer, I want to restrict which IMS client ids (and optionally users) may call a worker, so that "any Adobe user" cannot spend my vendor quota.
25. As the maintainer, I want worker deployment to be a manual, documented step in this ticket, so that no Cloudflare credentials have to be put into CI yet.
26. As the maintainer, I want the template to run within the Workers Free plan limits for typical use, so that cost is zero until real usage appears.

EW end user (content author):

27. As a content author, I want the hello app's "Call worker" button to show a result, so that I can see the backend integration works.
28. As a content author, I want the "Call without token" button to visibly fail with `401`, so that I can see the backend refuses unauthenticated callers.
29. As a content author, I want failures to show a short, plain message (no stack traces, no secrets), so that I know whether to retry or contact the maintainer.
30. As a content author, I want extensions that use a worker to stay usable when the worker is slow (a visible "working" state and a bounded wait), so that the editor never hangs.

Security reviewer / attacker's-eye:

31. As a security reviewer, I want proof that a request from `https://evil.example` cannot get an `Access-Control-Allow-Origin` header and cannot reach a handler, so that browser-based abuse from other sites is blocked.
32. As a security reviewer, I want proof that look-alike origins (`da.live.evil.com`, other sites' `aem.live` hosts, `http://da.live`) are rejected, so that the allowlist is not a loose suffix match.
33. As a security reviewer, I want proof that tokens signed by another key, `alg: none`, HS256 "key confusion", expired, wrong-type and wrong-client tokens are rejected, so that authentication is real.
34. As a security reviewer, I want proof that a canary secret never appears in any response, header or log across success and every error path, so that "never echoed" is tested rather than promised.
35. As a security reviewer, I want the caller's IMS token never forwarded to a vendor and never logged, so that a vendor compromise cannot replay it.
36. As a security reviewer, I want the same request without a token to fail against the deployed worker too, so that production, not just tests, enforces auth.

## Implementation Decisions

(No file paths or code, except where noted. Paths and layout are in the Build Analysis.)

1. **Platform: Cloudflare Workers, JavaScript ESM, no TypeScript, no framework.** Matches the ticket's suggestion and Adobe's own EW workers; matches upstream's JS-only repo and the #1 tooling pins. The choice and rationale go in the README (AC4's platform note). Alternatives considered (Adobe App Builder / I-O Runtime web actions, AWS Lambda, Fastly Compute) are listed in the README as not chosen; the ticket suggests Cloudflare and no evidence was found that any other platform is needed [ASSUMPTION on alternatives' trade-offs; not researched]. Wrangler 4 (current `4.162.0`, engines `node >=22.12.0`, from the npm registry 2026-11-16) is pinned by major; this is the one tool that raises the Node floor from "22" to ">=22.12" [VERIFIED].
2. **Template = tested core + thin scaffold; extensions import the core, they do not fork it.** The core (auth, CORS, proxy, secrets, errors, logging, router) lives once in `shared/worker-template/` and each extension's worker imports it by relative path; wrangler's bundler follows the import, so the deployed worker is still one self-contained script. Only the scaffold (wrangler config, route list, secrets example, README, test stub) is copied. Rationale: a security fix lands once for all 13 workers; forks drift. Cost: `apps/<ext>/worker/` is not self-contained at the source level (it depends on `shared/`), which is a deliberate exception to "no cross-folder imports" because `shared/worker-template/` is not an extension (the #1 spec reserves exactly this) [OPEN: confirm import over copy/vendor; see Open Questions].
3. **One deployable worker per extension; vendor routes live with the vendor.** A worker serves one extension. Server-side code for a vendor follow-up lives in that vendor's folder, in a `worker/` subfolder (`apps/<ext>/providers/<vendor>/worker/`), and is registered by the extension's worker entry. This keeps the #1 convention (vendor code in `providers/<vendor>/`), keeps server code under a `worker/` path that the code-bus ignore file already hides, and keeps secrets for all vendors of one extension in one worker [OPEN: confirm this refinement of the #1 convention].
4. **Request pipeline order is fixed and tested: (1) CORS/origin gate, (2) preflight short-circuit, (3) authentication, (4) routing, (5) handler.** Auth comes before routing, so an unauthenticated probe cannot tell which routes exist: an unknown route without a token gives `401`, with a token gives `404`. There are no unauthenticated routes other than `OPTIONS` preflight. Liveness of a deployed worker is checked by getting `401` on a bare request.
5. **CORS policy.**
   - Allowed origins: exactly `https://da.live`, plus the site's own origins `https://{ref}--{site}--{org}.{aem.live | aem.page | preview.da.live}`, where `site` and `org` come from the worker's configuration and `ref` is any branch label. `{ref}--{site}--{org}.preview.da.live` is included because EW's shell and library prefer an authenticated `preview.da.live` proxy for the iframe and fall back to `aem.live`; so the extension page's real `Origin` can be any of the three [VERIFIED in source: https://github.com/adobe/da-live/blob/main/blocks/shared/constants.js (`getLivePreviewUrl`, prod domain `preview.da.live`), https://github.com/adobe/da-nx/blob/main/nx/blocks/shell/shell.js (`usePreview` fallback)]. A `stage-preview.da.live` origin is not allowed by default (opt-in config for a stage deployment).
   - Matching is exact and anchored (scheme, full host, no port, no suffix tricks); `Origin: null` and `*` are never allowed.
   - `http://localhost:3000` (the fixed `ref=local` origin) is allowed only when an `ALLOW_LOCALHOST` flag is set, which only the local wrangler environment and the test fixtures set; the production config leaves it off, so the deployed worker is exactly "da.live + the site's own origins" as AC2 requires.
   - Preflight (`OPTIONS`) is answered without a token (browsers never send credentials on preflight): `204` for an allowed origin with `Access-Control-Allow-Origin` echoing that origin (never `*`), allowed methods, allowed headers `Authorization, Content-Type`, `Access-Control-Max-Age`, and `Vary: Origin`. A disallowed origin gets `403` with no CORS headers.
   - Server-side enforcement: a non-preflight request carrying a disallowed `Origin` is refused with `403` before authentication. A request with no `Origin` (curl, server-to-server) is not blocked by CORS (CORS is a browser control, not authentication); auth still applies.
   - Every response to an allowed origin, including `401`, `403`, `404`, `5xx`, carries the CORS headers (otherwise the browser hides the status from the page and the AC5 "fails without a token" demo would look like an opaque network error). No `Access-Control-Allow-Credentials` (the token travels in `Authorization`, not cookies).
6. **Authentication = offline JWT verification against Adobe IMS's published keys, mirroring `da-admin`.** The worker verifies the bearer token with the `jose` library against `${IMS_ORIGIN}/ims/keys` (RS256 only), requires the IMS claim `type = access_token`, requires `created_at + expires_in` (milliseconds) to be in the future, and optionally requires the `client_id` claim to be in an allowlist. These are exactly the checks Adobe's own DA backend performs [VERIFIED: https://github.com/adobe/da-admin/blob/main/src/utils/auth.js (`jwtVerify` with `createRemoteJWKSet`, `type !== 'access_token'`, `created_at + expires_in`)]. The key set is cached per isolate with a cooldown; an unknown `kid` causes a bounded refetch (jose behaviour) so a key rotation does not lock everyone out [VERIFIED: https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md]. If the key set cannot be fetched the worker fails closed with `503 auth_unavailable` (not `200`, not a misleading `401`).
   - `IMS_ORIGIN` is configuration: `https://ims-na1.adobelogin.com` in production [VERIFIED: `GET /ims/keys` returned an 11-key RS256 JWKS on 2026-11-16], overridden to a local fake in tests.
   - Only the `Authorization` header is accepted as token transport (no query-string tokens, no cookies).
   - The handler receives a verified identity (`userId`, `clientId`, `expiresAt`) and a read-only copy of the claims. The raw token is not on that object, and the proxy helper never forwards the inbound `Authorization` header.
   - An optional per-worker `authorize(identity, request)` hook can refuse (403) an authenticated user. Default: allow every authenticated caller who passes the client-id allowlist. The hook exists so vendor tickets with expensive credentials can restrict users without touching the core.
   - Online validation (`/ims/profile/v1` or `/ims/validate_token/v1`) is not part of the default path: it adds a subrequest and latency per call, and offline verification is what da-admin does. Trade-off: a revoked-but-unexpired token stays valid until expiry [OPEN: see questions]. `validate_token/v1` is a real endpoint (`POST` returns `{"valid":false,"reason":"bad_signature"}` for a bad token, observed 2026-11-16) but I found no public documentation for it, so the spec does not depend on it [ASSUMPTION: its contract].
7. **Secrets.**
   - Secrets are Cloudflare Worker secrets, read from `env` only. Production secrets are set with `wrangler secret put`, which immediately creates and deploys a new version (that is also the rotation procedure); local secrets are in an untracked `.dev.vars`; non-secret settings go in `vars`; real secrets never go in `vars` [VERIFIED: https://developers.cloudflare.com/workers/configuration/secrets/].
   - Each worker declares its secret names in the wrangler `secrets.required` list, so `wrangler deploy` fails when one is missing [VERIFIED: https://developers.cloudflare.com/workers/wrangler/configuration/ (`secrets` configuration property)]. Side effect to design around: when `secrets` is declared, only the listed keys are read from `.dev.vars` or `.env`, so local non-secret overrides (like `ALLOW_LOCALHOST`) must come from a wrangler environment's `vars`, not from `.dev.vars` [VERIFIED in the same doc]. `vars` are non-inheritable and must be repeated per environment [VERIFIED: same doc, "Non-inheritable keys"].
   - The secrets accessor is the only way route code reads a secret; a missing one yields a generic `500 misconfigured` and a log line with the secret's *name* only.
   - The proxy helper takes a secret *name* and injects it into the outbound header/query itself.
   - Defence in depth: all response bodies, response headers and log lines pass through a redaction step that replaces any configured secret value (and the caller's token) with a fixed marker, so a vendor that echoes the key in an error body cannot leak it through us. Upstream error bodies are not passed to the browser by default; upstream failures map to template error codes.
8. **Outbound proxy helper.**
   - Retries: status `429` and every `5xx`; plus thrown network errors and per-attempt timeouts for idempotent requests. Default 3 retries (4 attempts), delay `min(cap, base * 2^n)` with full jitter [Source for the jitter choice: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/], base 250 ms, cap 2 s, overall deadline 8 s, per-attempt timeout 10 s. All overridable per call; defaults are a starting point [ASSUMPTION: numbers; no vendor guidance consulted].
   - `Retry-After` (delta-seconds or HTTP-date) is honoured as a minimum delay, bounded by the cap [Source: https://www.rfc-editor.org/rfc/rfc9110.html, Retry-After].
   - Idempotency: `GET`, `HEAD`, `PUT`, `DELETE`, `OPTIONS` are retried on `5xx`; `POST`/`PATCH` are retried on `429` only unless the caller passes an explicit "safe to retry" flag (RFC 9110 defines which methods are idempotent). This is stricter than the literal AC wording ("retries 429 and 5xx") to avoid double-spending vendor credits; flagged for owner confirmation.
   - Request bodies are buffered (size-capped, `413` over the limit) so every attempt replays the same bytes; a stream cannot be re-sent.
   - After exhausting retries the helper returns the last upstream response; the template's error mapper turns upstream `429` into `429` (with `Retry-After`) and upstream `5xx`/network failure into `502 upstream_unavailable`, without upstream body text.
   - Safety rails: absolute `https` URLs only (plain `http` only for loopback in local/test), host must be on the route's declared allowlist, redirects are not followed automatically (`redirect: manual`) so a vendor 3xx cannot bounce the secret to another host, inbound `Authorization`, `Cookie`, `Host` and `cf-*`/forwarded headers are stripped from the outbound request. The subrequest budget is bounded by the retry cap (Workers Free allows 50 subrequests per invocation; a JWKS fetch counts) [VERIFIED: https://developers.cloudflare.com/workers/platform/limits/].
   - Timers and `fetch`/`sleep`/`random`/`now` are injectable so retry timing is tested without real waiting.
9. **Error contract.** All template-generated errors are JSON `{ "error": { "code", "message", "requestId" } }` with `Cache-Control: no-store`. Codes: `bad_request` (400), `unauthorized` (401, adds `WWW-Authenticate: Bearer`), `forbidden_origin` (403), `forbidden` (403, from `authorize`), `not_found` (404), `method_not_allowed` (405), `payload_too_large` (413), `rate_limited` (429), `misconfigured` (500), `internal` (500), `upstream_unavailable` (502), `auth_unavailable` (503). Messages are fixed strings; no input echo, no stack, no upstream text. Every response has `x-request-id`, which is exposed through CORS.
10. **Logging.** One structured JSON line per request (request id, method, route pattern not raw URL query, status, duration, user id, outcome code, retry count). Never the token, never `Authorization`, never secret values, never request/response bodies. Workers Logs is enabled in the config [VERIFIED key exists: https://developers.cloudflare.com/workers/wrangler/configuration/ (`observability`)].
11. **Hello worker and route.** `apps/hello-world/worker/` is the first consumer. Its one route, `GET /hello/sign?message=...`, returns `{ message, algorithm: "HMAC-SHA-256", signature: <hex> }`, where the signature is computed with the secret `HELLO_SECRET`. That is a real, checkable use of a secret that proves "used server-side, never returned", needs no vendor account, and can be recomputed in tests with an independent implementation. Message length is capped.
12. **Hello page changes.** `apps/hello-world/` gets a "Call worker" button (sends `Authorization: Bearer <token from the SDK>`, shows the signature or a plain error) and a "Call without token (expect 401)" button (same request, no header, shows the status and error code). Both are disabled in the standalone (not-in-EW) state. The token is never rendered or logged (hello-world's existing rule). Only `apps/hello-world` is wired to a worker; `apps/hello-plugin` stays unchanged [OPEN: owner confirm "the hello extension" means the app].
13. **The worker origin is a constant in the extension, never taken from the URL.** The hello page sends the user's IMS token to the worker origin; if the origin came from a query parameter, a crafted link would send the token to an attacker. The extension config uses the loopback worker origin when it runs on `localhost` and a fixed deployed origin otherwise; a test proves a `?worker=` parameter is ignored. A local worker is therefore only reachable with `ref=local` (branch/main pages call the deployed worker) [ASSUMPTION: Chrome allows an `https://*.aem.live` page to reach `http://localhost` workers and may show a "local network access" prompt; the design avoids the question by never calling localhost from an HTTPS page; to be observed in manual step W3].
14. **Tooling (pinned per owner decision, additive to #1).** Root `package.json` gains `wrangler` (4.x) as a dev dependency and `jose` (6.x; `6.2.17` on npm 2026-11-16) as a dependency of the bundled worker, plus scripts for worker tests, smoke, and local dev. ESLint 8 + helix config applies to worker code with a Node/worker-globals override; no new linter. Worker unit tests use the Node 22 built-in test runner (`node:test`, no new dependency), because they need real `Request`/`Response`/`crypto.subtle` and must set the `Origin` header, which browsers forbid, so `@web/test-runner` (browser) is the wrong tool for them [VERIFIED: `Origin` is a forbidden request header name, https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header; [ASSUMPTION] therefore a `Request` built in WTR's Chromium cannot carry it; not tested]. `@web/test-runner` and Playwright stay in use for the hello page and e2e. Rejected: `@cloudflare/vitest-plugin` (Cloudflare's recommended path, https://developers.cloudflare.com/workers/testing/vitest-integration/) because it adds Vitest 4/5 as a second runner to a repo that pins WTR/Playwright; the wrangler-based smoke test gives the workers-runtime coverage instead [OPEN: owner may prefer the plugin].
15. **Deploy is manual in this ticket.** `wrangler deploy` and `wrangler secret put` run from the extension's `worker/` folder with the owner's Cloudflare login; there is no Cloudflare credential in CI. A deploy workflow (Cloudflare's GitHub Action, https://github.com/cloudflare/wrangler-action) is a documented follow-up, not built here.
16. **Repo hygiene is machine-checked.** The #1 convention check (S3) gains rules: no `wrangler.*` outside `apps/*/worker/` and the template; every `apps/*/worker/` has a wrangler config, a README and a test; no tracked `.dev.vars*`/`.env*` files; `.gitignore` covers them; no wrangler `vars` key whose name looks like a secret. The #1 `.hlxignore` must hide `**/worker/`, `shared/worker-template/`, and `.dev.vars*` from the code bus (already specified for `worker/` and the template in the #1 spec).
17. **Public contract to downstream tickets** (what the 16 blocked tickets can rely on): route declaration form, handler context (identity, secret accessor, proxy helper, request id, logger), error codes, CORS and auth behaviour, test kit exports, wrangler config shape, `providers/<vendor>/worker/` placement. Changing any of these later is a breaking change across all workers and needs a template version note in the README.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given a `Request` (with certain headers and body) and a fake outside world (fake IMS key server, fake vendor), assert the `Response` (status, headers, body), the outbound requests made (count, headers, body, timing schedule), and what was logged. Never assert on internal helper names, module structure, or how many times an internal function ran. The two most important properties are tested as *negative* properties across every code path: "the canary secret never appears anywhere" and "no handler or outbound call runs before auth succeeds".

**Proposed seams** (recorded here instead of asked, per #40). Existing seams from the #1 spec are reused wherever possible; two new ones are added at the highest possible point.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 (primary, new) | The worker's HTTP boundary: `worker.fetch(request, env, ctx)` (Request in, Response out), plus the exported `proxy` helper as a public sibling | new | Node unit tests (template and each extension worker) | Constructed `Request`; an `env` factory; injected outbound `fetch`, `sleep`, `random`, `now`; fake IMS via the test kit (locally generated RSA key, JWKS served through the injected fetch) |
| W2 (new) | The same worker running in the real workers runtime over real HTTP | new | Smoke tier | `wrangler dev` (local, no Cloudflare login) with `IMS_ORIGIN` and an upstream origin pointing at throwaway local Node servers |
| S1 (reused, extended) | Entry HTML page + SDK module boundary | from #1 | Playwright e2e for hello-world | #1's `page.route` SDK stub; the stub's token is a test-signed IMS-shaped JWT; the worker under test is the real hello worker (W2 style) so the browser performs a real cross-origin `localhost:3000 -> localhost:8787` request, preflight included |
| S2 (reused) | Render/logic module + SDK result | from #1 | WTR tests for the hello page's new worker-call code | injected `fetch`; hand-built SDK result |
| S3 (reused, extended) | Repo convention check | from #1 | CI lint job | filesystem fixtures in a temp dir |

Why not fewer: the retry/backoff matrix is large and would be slow and noisy if driven only through full requests, so the exported `proxy` helper is a public surface in W1, tested directly. Why W2 exists at all: unit tests run in Node, the product runs in workerd; W2 is the smallest check that the same code works in the real runtime and that CORS/preflight work on a real socket. The real EW boundary (real Adobe IMS login, real token claims) is covered only by manual verification.

**Modules tested:** CORS/origin gate, auth (token verification, error mapping, JWKS caching/rotation/outage), router/pipeline order, secrets accessor + redaction, proxy helper (retries, backoff schedule, `Retry-After`, idempotency, body replay, header hygiene, host allowlist), error/log contract, test kit self-check, hello worker route, hello page worker-call code, convention-check additions.

**Prior art:**
- Upstream `adobe-rnd/ew-extensions` has no worker code (no `wrangler`/worker files in its tree, checked via the GitHub tree API 2026-11-16), so test prior art is the pattern, not a worker: dependency-injection seams `fetchImpl`/`storage`/`now` in `tools/brand-visibility/session-auth.js` (https://github.com/adobe-rnd/ew-extensions/blob/main/tools/brand-visibility/session-auth.js) and the Tier 1 stub-only e2e idea from #1.
- Adobe's DA backend `adobe/da-admin` is the prior art for the *behaviour* (offline IMS verification, JWKS cache); I read its source, not its tests.

## Out of Scope

- Any vendor integration (DeepL, Mux, Bynder, Firefly, Slack, Marketo, GA4 ...) and any vendor sandbox account; only the contract and hello proof.
- CI-driven deployment and storing Cloudflare credentials in GitHub (documented as a follow-up).
- Online token validation/revocation checks, per-user quotas, and Cloudflare's rate-limiting binding (it is approximate and per-location, https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/; document as a recommended per-route option; not built).
- KV/D1/R2/Durable Object storage, queues, cron triggers, service bindings between workers.
- A custom domain / production DNS for workers (the `workers.dev` URL is enough for the hello proof; custom domain is a deployment choice).
- TypeScript, bundlers beyond what wrangler does internally, any web framework.
- Authorisation against DA permissions (who may edit which site). Authentication only, plus the optional `authorize` hook.
- Browser Extension (Chrome) work: "extension" in this repo always means an EW app/plugin.
- Migrating the hello-plugin to use a worker.
- The Adobe outside-activity/IP policy question for running infrastructure from a personal Cloudflare account (flagged below; owned by #1 R1).

## Further Notes

- **Docs say nothing about backends.** The official EW developer doc cited by the ticket (https://www.aem.live/docs/ew/developing/apps-plugins) mentions the SDK, `sendText`/`closeLibrary`, and the `apps` sheet, but nothing about workers, CORS or calling external services; grep of the fetched page for `worker`, `cors`, `backend`, `secret` found nothing [VERIFIED 2026-11-16]. So all guidance here is derived from SDK/shell/library source and Cloudflare docs, and the "which `Origin` will the extension page send" fact comes from source reading, not documentation. Settling it for real is manual step W3.
- **The EW context to know:** the SDK result carries `token` (IMS access token), `context`, and `actions` including `daFetch` [VERIFIED: https://da.live/nx/utils/sdk.js read 2026-11-16]. The extension is cross-origin to da.live (iframe on `*.aem.live`/`*.preview.da.live`/`localhost:3000`), which is why a fetch from the extension to the worker is a CORS request.
- **`aem-agentic-plugins.adobeaem.workers.dev`**, named in the ticket as Adobe's own EW worker, returned `404 Not found` (plain text) on its root path when probed on 2026-11-16 (no token, no route). That proves a `workers.dev` hostname exists and nothing about its design; I did not find or read its source.
- **Current repo state:** `apps/hello-world/` contains only `SPEC.md`; no `package.json`, tooling, or hello app exist yet. Everything in this spec that says "extends" #1's tooling presumes #1 has landed; #2 implementation is blocked by #1 as the ticket graph says.
- **Cloudflare plan limits relevant to design** [VERIFIED: https://developers.cloudflare.com/workers/platform/limits/ read 2026-11-16]: Free plan 100,000 requests/day, 10 ms CPU per HTTP request, 50 subrequests per invocation; Paid: 10,000 subrequests, CPU up to 5 min. Waiting on `fetch` does not count as CPU. RS256 verification plus JWKS parse fits 10 ms for da-admin (which runs the same pattern) [ASSUMPTION: not measured here; measured in smoke test SM5].
- The README the template ships must state: platform choice and rationale; folder layout; local dev; deploy; secrets lifecycle (set, rotate, delete); the CORS allowlist and why `preview.da.live` is in it; how to add a route; how to add a vendor; how to test; the "never put the worker origin in the URL" rule; the open policy note carried over from #1.

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)
  └─ iframe: extension page  (origin: https://{ref}--{site}--{org}.aem.live | .preview.da.live | http://localhost:3000)
        │  SDK handshake gives { token (IMS), context, actions }
        │  fetch(worker, { headers: { Authorization: 'Bearer <IMS token>' } })      <- cross-origin: CORS preflight first
        ▼
  Cloudflare Worker  (one per extension; code in apps/<ext>/worker, core imported from shared/worker-template)
        1 origin gate + preflight  ->  2 IMS token check (JWKS: https://ims-na1.adobelogin.com/ims/keys)
        3 route handler  ->  4 proxy(vendor, secret injected by name, retries)  ->  vendor API
```

Responsibility split:

| Concern | Browser extension (static files, public) | Worker (private runtime, holds secrets) |
|---|---|---|
| Vendor credentials | never | only place; Cloudflare secret store |
| Identity | obtains IMS token from the SDK, sends it | verifies it; produces identity for handlers |
| CORS | none to configure | decides who may call; answers preflights |
| Vendor calls | none | all of them, via `proxy` |
| Retries / vendor quirks | shows "working"/error state | backoff, mapping of upstream failures |
| UI, EW actions (`sendText` etc.) | all | none |

## 2. EW integration points

- **Library plugin vs app:** the worker is agnostic. Whether the calling extension is a fullscreen app (an `apps` sheet row) or a library plugin (a `library` row) only changes which origin and token the page uses; both get the IMS token from the same SDK result [VERIFIED: https://da.live/nx/utils/sdk.js; shell and library both pass `token`, per the #1 spec section 2.2]. So the template needs no per-type variants.
- **Config-sheet rows:** none are specific to the worker; the extension's own registration rows stay as in #1. The worker's address is not registered in EW at all; it is a constant in the extension's code (Decision 13).
- **SDK actions used:** none new. The hello page uses only the SDK's `token` and `context`. [A later ticket might proxy through `actions.daFetch`; out of scope.]
- **`ref=local` loop:** page at `http://localhost:3000` (the #1 dev server, port hard-coded by EW [VERIFIED per #1 spec 2.3]) calls the local worker at `http://localhost:8787` (wrangler dev default port [VERIFIED: https://developers.cloudflare.com/workers/wrangler/commands/workers/ says requests go to `localhost:8787`]). Two terminals, two processes.
- **Branch ref / main:** pages on `*.aem.live` (or `*.preview.da.live`) call the *deployed* worker's `workers.dev` URL.
- **Which `Origin`** the extension page sends in each of these cases is the main integration unknown (see R2) and the reason the allowlist covers three hosts.

## 3. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| Adobe IMS key set `GET {IMS_ORIGIN}/ims/keys` | fetch RS256 public keys to verify tokens offline | none (public) | Observed 2026-11-16: 200, 11 keys with `alg RS256`, `kid`, `use sig`. Same call as da-admin: https://github.com/adobe/da-admin/blob/main/src/utils/auth.js |
| Adobe IMS profile `GET {IMS_ORIGIN}/ims/profile/v1` | not used by default; da-admin uses it to fetch email; returns 401 for a bad token (observed) | Bearer | same da-admin file |
| Adobe IMS `POST /ims/validate_token/v1` | not used; behaviour observed only | `client_id` + token | undocumented, [ASSUMPTION] |
| Cloudflare Workers runtime | `fetch` handler `(request, env, ctx)`, `env` bindings incl. secrets, `Request`/`Response`/`crypto.subtle` | n/a | https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/ |
| Wrangler CLI | `dev` (local workerd, port 8787), `deploy`, `secret put/delete/bulk`, `--env-file`, `--config`, `--var` | Cloudflare login (deploy only) | https://developers.cloudflare.com/workers/wrangler/commands/workers/ , https://developers.cloudflare.com/workers/development-testing/ |
| `jose` | `createRemoteJWKSet` with `[customFetch]`, `cooldownDuration`, `jwtVerify` | n/a | https://github.com/panva/jose ; runtime support incl. Workers stated in its README [VERIFIED] |

**Auth flow (caller to worker):** SDK handshake gives the page the user's IMS access token -> page sends it as `Authorization: Bearer` -> worker verifies signature (RS256, `kid` selected from JWKS), `type`, `created_at + expires_in`, optional `client_id` allowlist -> identity -> handler. **Auth flow (worker to vendor):** vendor-specific, secret injected by the proxy helper from `env`; the caller's token is never forwarded.

**IMS token specifics I could not verify** [OPEN]: the exact claim names beyond the four da-admin reads (`type`, `user_id`, `created_at`, `expires_in`); that the EW (da.live) client id is `darkalley` (it is `imsClientId: 'darkalley'` in https://github.com/adobe/da-nx/blob/main/nx/scripts/nx.js [VERIFIED as config value], but whether the token's `client_id` claim carries it is untested: no real token was available to inspect); token lifetime; whether library-plugin tokens use a different client id. The client-id allowlist therefore ships as configuration with the default decided after inspecting a real token in manual step W2.

## 4. Data contracts

All contracts are behaviour contracts, not code.

**Inbound request.** Method + path chosen by the extension author. Header `Authorization: Bearer <IMS access token>`. JSON bodies use `Content-Type: application/json`. Browser calls are cross-origin so `Authorization` forces a preflight.

**Preflight response (allowed origin).** `204`; `Access-Control-Allow-Origin: <echoed origin>`; `Access-Control-Allow-Methods` = methods used by the worker's routes; `Access-Control-Allow-Headers: Authorization, Content-Type`; `Access-Control-Max-Age`; `Vary: Origin`. No credentials header. Disallowed origin: `403`, no CORS headers.

**Worker configuration (wrangler `vars`, non-secret):**

| Name | Meaning | Production | Local env |
|---|---|---|---|
| `ORG`, `SITE` | derive the site's own origins (`{ref}--{SITE}--{ORG}.*`) | `jazhou-adobe`, `ew-extensions` [ASSUMPTION per #1 R10] | same |
| `IMS_ORIGIN` | key set + (optional) profile base | `https://ims-na1.adobelogin.com` | same, overridden to a fake in tests |
| `ALLOW_LOCALHOST` | also allow exactly `http://localhost:3000` | `false` | `true` |
| `ALLOWED_IMS_CLIENT_IDS` | comma list; empty means no client check | decided after W2 | same |

**Secrets (`secrets.required`):** per worker; hello worker: `HELLO_SECRET`.

**Handler context** (what route code receives; documented as a table in the README): `request`, `url`, `identity {userId, clientId, expiresAt}`, `claims` (read-only), `env` (non-secret vars only; secrets only via accessor), `secret(name)`, `proxy(url, init, options)`, `requestId`, `log`, `ctx` (`waitUntil`). A handler returns a `Response` or a plain JSON-able value (wrapped into a `200` JSON response). A thrown `HttpError(code)` produces the matching error contract; any other throw produces `500 internal`.

**Proxy options contract:** target URL; method/headers/body; `auth: { secret: <name>, header | query, scheme }`; `allowedHosts`; `retry: { retries, baseMs, capMs, deadlineMs, attemptTimeoutMs, idempotent }`; returns the upstream `Response` (the error mapper handles exhausted retries).

**Error contract:** Decision 9. **Hello route contract:** `GET /hello/sign?message=<=256 chars>` -> `200 {message, algorithm, signature}`; missing/over-long `message` -> `400 bad_request`; no token -> `401`; disallowed origin -> `403`.

## 5. Folder layout (proposed; fits the #1 convention)

```
shared/worker-template/
├─ SPEC.md                    this file
├─ README.md                  platform choice, dev, deploy, secrets, add route/vendor, CORS rationale
├─ src/                       core: createWorker/router, auth, cors, proxy, secrets+redaction, errors, log
├─ scaffold/                  files copied into apps/<ext>/worker/ (wrangler config, entry, .dev.vars.example, README, test stub)
├─ test/                      template unit tests (W1) + SM* smoke (W2)
└─ test-kit/                  exported helpers: fake IMS (keypair, JWKS, token factory), fake upstream, env factory, canary
apps/<ext>/worker/            copied scaffold + this extension's routes; its own test/
apps/<ext>/providers/<vendor>/worker/   vendor-specific route modules registered by the extension's worker
```

The #1 spec's tree already reserves `worker/` and `shared/worker-template/`; this fills them in and adds `providers/<vendor>/worker/` as a refinement (Decision 3).

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Adobe outside-activity/IP policy** and which Cloudflare account hosts infrastructure that handles Adobe IMS tokens and vendor credentials under a personal name. Carries over from #1 R1. | High for publishing; blocks nothing technical | [OPEN] README note; owner decides account (personal vs an Adobe-provided one, e.g. the `adobeaem.workers.dev` account) before anything is shared. |
| R2 | **Actual `Origin` of the extension page** under shell vs library vs preview-proxy vs `ref=local` is read from source, not documented. A wrong allowlist breaks every extension in EW, or is too loose. | High | Allow the three known hosts; log denied origins (origin only, not token); manual W3 observes the real values; README records them. |
| R3 | **Any Adobe user's token passes** a pure signature check. Combined with a vendor credential, a stranger can spend quota. | High | Client-id allowlist (config), optional `authorize` hook, documentation recommending per-route rate limits; owner decides the policy per vendor ticket. Default is documented, not silent. |
| R4 | **IMS claims/`kid`/client id unverified** against a real token. | Medium | Template reads only the four claims da-admin reads; W2 inspects a real token; the test kit's token shape is asserted to match what W2 records. |
| R5 | **No revocation:** offline verification accepts a revoked token until expiry. | Medium | Accepted by default (same as da-admin); optional online check is a documented extension, not built. [OPEN] |
| R6 | **IMS key-set outage or rotation** locks everyone out. | Medium | Per-isolate cache, bounded refetch on unknown `kid`, fail closed with `503` and a distinct code; tested (UA9, UA10). |
| R7 | **Free-plan limits** (10 ms CPU, 50 subrequests). Retries + JWKS fetch could hit them. | Low-Med | Retry cap 3; JWKS cached; smoke test measures; paid plan is an owner decision. |
| R8 | **`secrets.required` hides `.dev.vars` non-secrets** (documented behaviour), surprising authors. | Low | Local overrides via an `env.local` block; README explains; smoke test proves it works. |
| R9 | **Wrangler 4 needs Node >=22.12**; #1 pins "Node 22" loosely. | Low | `engines`/CI pinned to a version that satisfies it; mention in README. |
| R10 | **Bundling `shared/` into each worker** (import-not-copy) assumes the bundler resolves `jose` from the repo-root `node_modules` for files outside `apps/<ext>/worker/`. | Low-Med | [ASSUMPTION] Verified by SM1 (smoke bundle of the hello worker); fallback is the scaffold vendoring the core. |
| R11 | **Chrome's handling of `https` page -> `http://localhost` (local network access)** for any case where a deployed page tries a local worker. | Low | Design avoids it (Decision 13); documented "local worker only with `ref=local`". [ASSUMPTION] |
| R12 | **Secret in a public repo** by accident (this repo is public-capable; the #1 code bus serves the repo). | High if it happens | Gitignore, S3 rule, `.hlxignore`, `secrets.required`, README; optionally a secret-scanning hook [OPEN: enable GitHub secret scanning]. |
| R13 | **`wrangler dev` offline/telemetry/login behaviour in CI** unverified. | Low | [ASSUMPTION] local mode needs no login (it uses a local workerd per https://developers.cloudflare.com/workers/development-testing/); the CI job disables telemetry; fall back to running the smoke tier locally only if CI proves flaky. |
| R14 | **`jose` on workerd in the Free CPU budget** unmeasured. | Low | SM5 reports CPU/time; da-admin runs the same library on Workers [VERIFIED import; no measurement]. |

## 7. Ordered build plan (sized to #2's acceptance criteria)

0. **Prerequisites (owner):** #1 merged (tooling, hello-world app, CI); Cloudflare account exists and `wrangler login` works; decide Open Questions 1-4 (account, import-vs-copy, test runner, hello scope) before starting step 1.
1. **Tooling additions.** Add `wrangler` and `jose`, scripts (`test:worker`, `test:worker:smoke`, local-dev script taking a worker path), ESLint override for worker globals/Node test files, `.gitignore` entries for `.dev.vars*`, `.env*`, `.wrangler/`, and the `.hlxignore` entries. Verify lint is still green.
2. **Test kit first** (it is the product's test seam): fake IMS (RSA keypair, JWKS server/handler, token factory with claim overrides), fake upstream with scripted responses, env factory, canary secret. Self-test: a kit-signed token verifies with real `jose` against the kit's JWKS and has the claim shape da-admin reads.
3. **CORS/origin gate**, test-first (UC1-UC9). AC2 (CORS half).
4. **Authentication**, test-first (UA1-UA14). AC1.
5. **Secrets accessor, redaction, error contract, logging**, test-first (US1-US6). AC2 (secrets half).
6. **Proxy helper**, test-first (UP1-UP12). AC3.
7. **Pipeline/router** tying 3-6 together with order tests (UA12, UA13), body cap, unknown route/method handling.
8. **Scaffold + README** (platform decision, dev, deploy, secrets, add-route/vendor). AC4. Walk the README once on a scratch copy.
9. **Hello worker** in `apps/hello-world/worker/` with route tests (HW1-HW6). AC5 (server half).
10. **Hello page changes**: worker-call module + buttons + WTR tests (HP1-HP6); then Playwright e2e against a real local worker (E2E1-E2E4). AC5 (browser half).
11. **Runtime smoke** (SM1-SM5) in workerd via wrangler.
12. **Repo checks and CI**: extend S3 (UR1-UR5); add a `worker` CI job (unit + smoke) to #1's workflow; extend the e2e job to start the worker; no secrets in CI.
13. **Deploy the hello worker and run manual verification W0-W6** with a real Adobe login; record results and observed `Origin` values in the PR and README.
14. **Hand-off note** in the README for the 16 downstream tickets (contract, placement, checklist).

---

# Testing Requirements

## 1. Template unit tests (seam W1; Node built-in runner)

Fixtures/mocks: all come from the test kit. `makeEnv({...overrides})` builds a production-like env (`ALLOW_LOCALHOST` false) with a canary `HELLO_SECRET`-style secret value like `canary-s3cr3t-<random>`; `fakeIms` generates an RSA key pair, serves its JWKS through the injected `fetch`, and `signToken(overrides)` mints IMS-shaped tokens (`type`, `user_id`, `client_id`, `created_at`, `expires_in`, `kid`); `fakeUpstream(script)` replays a scripted sequence of statuses/headers/bodies and records every received request; `sleep`, `random`, `now` are injected (zero real waiting; jitter pinned to 0 or 1 to assert bounds). Console output is captured for log assertions. Every test calls `worker.fetch(...)` (or `proxy(...)` for the helper) and nothing else.

### 1.1 Authentication (AC1)

| ID | Behaviour asserted |
|---|---|
| UA1 | No `Authorization` header -> `401`, `WWW-Authenticate: Bearer`, error JSON `unauthorized`; handler spy not called; fake upstream and fake IMS received zero requests except the permitted JWKS fetch (none needed to decide this) |
| UA2 | Malformed headers (`Basic x`, `Bearer ` empty, `Bearer a b`, lower-case scheme still accepted, two Authorization values) -> `401` |
| UA3 | Not a JWT (garbage, truncated, three empty segments) -> `401`; no exception escapes as `500` |
| UA4 | Signed by a different key; `alg: none`; HS256 token using the public key as the secret ("key confusion"); wrong `kid` -> all `401` |
| UA5 | Expired by `created_at + expires_in` (and by `exp` if present) -> `401`; valid just before expiry -> success (using injected `now`) |
| UA6 | `type` other than `access_token` -> `401` |
| UA7 | `client_id` not on the allowlist -> `401`; empty allowlist config -> not checked |
| UA8 | Valid token -> handler called once with identity (`userId`, `clientId`, `expiresAt`) and no raw token on the identity |
| UA9 | JWKS fetch fails or returns 5xx/garbage -> `503 auth_unavailable` and handler not called (fail closed), distinct from `401` |
| UA10 | Key rotation: token signed with a key whose `kid` is not in the cached set triggers a refetch after cooldown and then succeeds; within cooldown it does not hammer the key endpoint |
| UA11 | Two valid requests -> one JWKS fetch (cached) |
| UA12 | Pipeline order: unknown route without token -> `401`; unknown route with valid token -> `404 not_found`; known route wrong method with valid token -> `405` |
| UA13 | `OPTIONS` preflight from an allowed origin succeeds with no token and never reaches a handler |
| UA14 | Across UA1-UA11 the token string never appears in any response or captured log line |
| UA15 | `authorize` hook returning false -> `403 forbidden`; hook not called for unauthenticated requests |

### 1.2 CORS (AC2, first half)

| ID | Behaviour asserted |
|---|---|
| UC1 | Allowed: `https://da.live`; `https://main--ew-extensions--jazhou-adobe.aem.live`; same on `.aem.page`; same on `.preview.da.live`; a branch with hyphens (`my-branch--ew-extensions--jazhou-adobe.aem.live`). Each gets its own origin echoed in `Access-Control-Allow-Origin` |
| UC2 | Rejected (`403`, no ACAO): `https://evil.example`; `https://da.live.evil.com`; `https://notda.live`; `http://da.live`; `https://da.live:8443`; `https://main--other-site--jazhou-adobe.aem.live`; `https://main--ew-extensions--other-org.aem.live`; `https://main--ew-extensions--jazhou-adobe.aem.live.evil.com`; `null`; `*`; empty |
| UC3 | `http://localhost:3000` rejected with the production env; accepted only exactly (not `:3001`, not `127.0.0.1:3000`, not `https://localhost:3000`) when `ALLOW_LOCALHOST=true` |
| UC4 | Preflight from allowed origin: `204`; `ACAO` is the origin (never `*`); `Access-Control-Allow-Headers` contains `Authorization` and `Content-Type`; `Max-Age` present; `Vary: Origin`; no `Allow-Credentials` |
| UC5 | Preflight from disallowed origin: `403`, no CORS headers, no body detail |
| UC6 | Actual requests from an allowed origin carry ACAO on `200`, `401`, `403`, `404`, `405`, `413`, `500`, `502`, `503` responses (so the browser can read the status) |
| UC7 | Actual request from a disallowed origin with a **valid token** -> `403` and the handler is not called (server-side enforcement, not just header omission) |
| UC8 | Request with no `Origin` (non-browser) is not blocked by CORS; auth still decides; response has no ACAO |
| UC9 | `x-request-id` and `Retry-After` are listed in `Access-Control-Expose-Headers` |

### 1.3 Outbound proxy and retry (AC3)

| ID | Behaviour asserted |
|---|---|
| UP1 | `200` first try -> exactly one upstream call; response passed through |
| UP2 | `429, 429, 200` -> three calls; recorded `sleep` schedule equals the exponential schedule with jitter pinned to its upper bound (`base*2^n`), and respects the cap |
| UP3 | Each of `500, 502, 503, 504` is retried; `400, 401, 403, 404, 409, 422` are not retried (one call) |
| UP4 | Always `503` -> `retries + 1` attempts then the last response is returned; the template maps it to `502 upstream_unavailable` without upstream text; always `429` -> maps to `429` with `Retry-After` |
| UP5 | `Retry-After` in seconds and in HTTP-date form is honoured as the delay (bounded by the cap); an absurd value (86400) is capped |
| UP6 | Jitter bound: with `random` at 0 the delay is 0, at 1 it is the cap-limited exponential value; always within `[0, min(cap, base*2^n)]` |
| UP7 | POST with a JSON body: 429 retried, body bytes identical on every attempt; POST `503` is not retried by default and is retried when the explicit safe-to-retry flag is set; `PUT` `503` is retried by default |
| UP8 | Thrown network error and per-attempt timeout: retried for idempotent methods then `502`; not retried for POST by default |
| UP9 | Overall deadline: when the next delay would exceed the budget, retrying stops early |
| UP10 | Header hygiene: inbound `Authorization`, `Cookie`, `Host`, `cf-*`, `x-forwarded-*` are absent on the upstream request; the vendor secret is present exactly where `auth` says; the secret and the caller's token do not appear in the response body or headers |
| UP11 | Host safety: URL whose host is not in `allowedHosts`, a non-`https` URL (non-loopback), or a URL with credentials throws before any fetch; a `302` from upstream is not followed (the redirect response is returned/mapped, and no second request is made) |
| UP12 | Request body over the cap -> `413 payload_too_large` and no upstream call |

### 1.4 Secrets, errors, logging (AC2, second half)

| ID | Behaviour asserted |
|---|---|
| US1 | Canary property test: run a matrix of scenarios (success, each error code, upstream echoing the secret in its error body, handler throwing an `Error` whose message contains the secret, missing-secret path); the canary value never appears in any response body, any response header, or any captured log line |
| US2 | The accessor for a secret absent from `env` -> `500 misconfigured` with a fixed generic message; the log contains the secret's name but never a value |
| US3 | Handler that returns/throws an object containing `env` or the secret is redacted to the marker in the response |
| US4 | Every error response matches the documented JSON shape and has `Cache-Control: no-store` and `x-request-id`; unknown thrown errors -> `500 internal` with no stack trace or message |
| US5 | One structured log line per request with the documented fields and none of: token, `Authorization` value, secret values, bodies |
| US6 | Non-secret `vars` are readable by handlers; secrets are readable only through the accessor (a handler reading `env.HELLO_SECRET` directly is not part of the contract; the redaction test still covers it) |

### 1.5 Test-kit self-check

UK1: a kit-signed token verifies with real `jose` against the kit's JWKS, the header has `kid` and `alg: RS256`, claims contain the four da-admin fields. UK2: the fake upstream records requests and replays scripts in order. These guard against the kit drifting from reality (R4).

## 2. Hello-world tests (AC5)

**Hello worker (seam W1, in `apps/hello-world/worker/test/`):**

| ID | Behaviour asserted |
|---|---|
| HW1 | `GET /hello/sign?message=abc` with a valid token and an allowed origin -> `200` and `signature` equals an independently computed HMAC-SHA-256 (computed in the test with `node:crypto` from the known test secret) |
| HW2 | The response contains no secret (canary) anywhere; changing the secret changes the signature (proves it is used) |
| HW3 | Same request without a token -> `401` with ACAO for the allowed origin (so the browser can read it) |
| HW4 | Missing or over-long `message` -> `400 bad_request` |
| HW5 | Missing `HELLO_SECRET` in env -> `500 misconfigured`, generic |
| HW6 | Disallowed origin with a valid token -> `403` |

**Hello page (seam S2, WTR; injected `fetch`):**

| ID | Behaviour asserted |
|---|---|
| HP1 | "Call worker" sends `Authorization: Bearer <sdk token>` to the configured worker origin and shows the returned signature as text |
| HP2 | "Call without token" sends no `Authorization` header and shows the `401` status and error code |
| HP3 | Worker `5xx`/network failure/slow response -> a short plain message and a bounded wait, no stack trace |
| HP4 | The token never appears in the DOM or console output (extends hello-world's existing rule) |
| HP5 | `?worker=https://evil.example` in the page URL is ignored; calls still go to the configured origin; on `localhost` the origin is the loopback worker, on any other host the fixed deployed origin |
| HP6 | Both buttons are disabled in the standalone (no SDK) state |

**Browser to real worker (seam S1 extended, Playwright, Chromium, hermetic):** The Playwright config starts the #1 static server on `:3000` and the hello worker via wrangler on `:8787` (local env, `IMS_ORIGIN` pointing at a throwaway fake-IMS key server started in global setup, secret from a temp env file). The #1 SDK stub supplies a token signed by the test key.

| ID | Behaviour asserted |
|---|---|
| E2E1 | Click "Call worker" -> signature shown; it equals the independently computed HMAC (a real cross-origin request, preflight included: `localhost:3000 -> localhost:8787`) |
| E2E2 | Click "Call without token" -> UI shows `401`; the network log shows the same endpoint answered `401` and the CORS headers let the page read it |
| E2E3 | Page HTML, DOM text, and all network responses contain neither the token nor the secret |
| E2E4 | Only expected hosts were contacted (page, worker, SDK stub); a stub token signed by a *different* key gets `401` through the full browser path |

## 3. Runtime smoke tier (seam W2, Node test file driving `wrangler dev` locally)

Starts the real hello worker (and a conformance fixture worker that exercises `proxy` against a local fake upstream) in workerd with no Cloudflare login, `IMS_ORIGIN` and upstream pointed at local Node servers, and secrets passed via an env file.

| ID | Behaviour asserted |
|---|---|
| SM1 | The worker bundles (the `shared/` import resolves `jose`, R10) and starts; a bare request gets `401` (the deployed-liveness signal) |
| SM2 | Valid token -> `200` hello signature equals the independent HMAC; preflight from an allowed origin and from `Origin: https://evil.example` behave as in UC4/UC5 over real HTTP |
| SM3 | `proxy` against the fake upstream: `429` then `200` is retried in the real runtime (real timers, tiny delays) and the fake upstream observes the injected secret header and no inbound `Authorization` |
| SM4 | The canary secret is absent from all responses (US1 repeated over real HTTP) |
| SM5 | Records per-request CPU/wall time and subrequest count for a verified request (informational against R7/R14; no hard threshold until a baseline exists) |

## 4. Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| UR1 | Fixture tests: an `apps/<ext>/worker/` missing a wrangler config, README or test fails; a complete one passes |
| UR2 | A tracked `.dev.vars`/`.env*` file (git ls-files in a temp repo) fails; `.gitignore` lacking those patterns fails |
| UR3 | A wrangler `vars` key named like a secret (`*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`) fails; names listed under `secrets.required` must not also appear in `vars` |
| UR4 | A wrangler config anywhere other than `apps/*/worker/` and the template/scaffold fails |
| UR5 | Every `secrets.required` name appears in that worker's `.dev.vars.example` |

## 5. End-to-end checks inside real Experience Workspace (manual; needs interactive Adobe login and a Cloudflare account)

Accounts and credentials needed: GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, per #1); Adobe IMS identity with access to the DA org/site; Chrome; Cloudflare account with Wrangler login; a throwaway `HELLO_SECRET` value (no vendor sandbox, no vendor key needed; the proof deliberately uses no external vendor). Never paste a real IMS token into chat, issue comments or logs; it is a live credential until expiry.

- **W0 (prereq):** `wrangler login`; `wrangler secret put HELLO_SECRET` for the hello worker; `wrangler deploy` from `apps/hello-world/worker/`; note the `workers.dev` URL and set it as the extension's deployed worker constant (a normal PR). `curl -i <worker>/hello/sign?message=x` returns `401` (liveness + AC5 negative).
- **W1 (`ref=local`):** terminal A `npm start` (port 3000); terminal B the worker dev script (port 8787) using the local env. Open `https://da.live/app/jazhou-adobe/ew-extensions/apps/hello-world/hello-world?ref=local`, accept the trust prompt (as in #1 M1). Click "Call worker": signature appears after about a second; click "Call without token": `401` shown. DevTools Network: preflight `OPTIONS` `204`, `Access-Control-Allow-Origin: http://localhost:3000` on the response. Proves AC1, AC2 (local origin), AC5.
- **W2 (inspect a real token):** in DevTools on `da.live`, obtain the IMS access token (mechanism: the page's `window.adobeIMS` object per https://github.com/adobe/da-nx/blob/main/nx2/utils/ims.js; [ASSUMPTION] the console method name), decode only the **claims** locally (no pasting into online decoders), record the claim names and the `client_id` value, then decide `ALLOWED_IMS_CLIENT_IDS`. Verify `curl -H "Authorization: Bearer $TOKEN" -H "Origin: https://da.live" .../hello/sign?message=x` returns `200`; `Origin: https://evil.example` returns `403`; no token returns `401`.
- **W3 (branch ref, deployed worker):** push branch `worker-hello` (simple name), wait for code sync, open the same URL with `?ref=worker-hello`; click both buttons. In DevTools record the page's actual `Origin` (aem.live or preview.da.live) and whether Chrome prompts for local-network access (expect no, because no localhost call). Resolves R2 and R11; record the observed origins in the README. Repeat for a library plugin context if a plugin is later wired.
- **W4 (secret hygiene):** search the Network panel responses, page source and DevTools Application storage for the `HELLO_SECRET` value (none); `wrangler secret list` shows names only; deploy fails if `secrets.required` lists a secret that was not set (temporarily rename in a scratch worker).
- **W5 (CORS negatives against the deployed worker):** curl preflight with `Origin: https://evil.example` -> `403`, no `Access-Control-Allow-Origin`; with `Origin: https://da.live` -> `204` with that origin echoed; with `Origin: http://localhost:3000` against the production worker -> `403` (localhost is local-env-only).
- **W6 (rotation):** `wrangler secret put HELLO_SECRET` with a new value; the same message now yields a different signature; no code change or redeploy of code needed.

## 6. CI additions (no credentials, no Cloudflare login)

| Job | Steps | Notes |
|---|---|---|
| `worker-unit` | checkout, Node 22 (>=22.12), `npm ci`, `npm run test:worker` (UA, UC, UP, US, UK, HW) | runs on every push and PR, like #1's jobs |
| `worker-smoke` | same setup, `npx playwright install` not needed; `npm run test:worker:smoke` (SM1-SM5) | disable wrangler telemetry; if flaky in CI the owner may mark non-blocking [OPEN] |
| `lint` (existing) | adds worker code and UR1-UR5 to ESLint + S3 | |
| `e2e` (existing) | gains the worker `webServer` and the E2E1-E2E4 specs | Chromium only, as in #1 |

## 7. Acceptance-criteria traceability (ticket #2)

| # | Acceptance criterion (#2) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Template validates the caller's IMS token before doing anything; missing or invalid tokens get 401 | UA1-UA9 (token matrix, 401 vs 503 distinction), UA12 (auth before routing, no handler/upstream call), UA14; SM1, SM2; HW3; E2E2, E2E4 | **W0** (bare `curl` -> 401 on the deployed worker), **W2** (real token -> 200, none -> 401), W1 |
| AC2 | Secrets from the platform secret store, never echoed to the browser; CORS allows only `https://da.live` and the site's own origins | US1-US6 and HW2 (canary never leaks), UC1-UC9 (origin matrix, server-side enforcement, preflight, error responses readable), UR2, UR3, UR5 (no secret in git/vars); SM2, SM4; E2E3 | **W4** (secret hygiene, `secrets.required` deploy guard), **W5** (CORS negatives on the deployed worker), **W3** (real origins), **W6** (rotation via secret store); README review: states the allowlist and why |
| AC3 | Outbound proxy helper retries 429 and 5xx with exponential backoff | UP1-UP12 (schedule, jitter bounds, `Retry-After`, idempotency, body replay, caps, exhaustion mapping); SM3 (real runtime) | Review: defaults documented in the README with the caveat that vendor tickets tune them; owner confirms the POST-5xx policy (Open Question 6) |
| AC4 | Local dev and deploy steps documented; each extension's worker lives inside that extension's folder | UR1, UR4 (worker location and completeness enforced), UR2 (hygiene); CI jobs prove the documented test commands | **Walk-through**: a reviewer follows the README on a scratch copy (`apps/x/worker`) from clean clone to `wrangler dev` and to `wrangler deploy --dry-run` [ASSUMPTION: flag exists; verify]; **W0**, **W1** are the real deploy and local-dev runs; README review for platform-choice note |
| AC5 | Hello extension calls a worker route that uses a secret and returns a result; the same call without a token fails | HW1-HW6; HP1-HP6; E2E1-E2E4 (browser to real local worker, positive and negative); SM2 | **W1** (local), **W3** (branch ref against the deployed worker, real CORS), **W0** (curl without token), **W2** |
| AC6 | Template has its own unit tests (auth check, CORS, retry) | UA*, UC*, UP* (+US*, UK*) run by `npm run test:worker` and the `worker-unit` CI job on every push/PR | Review: CI shows the job green on a PR; deliberately break a rule on a scratch branch (e.g. loosen the origin matcher) and see UC2 fail |

Every acceptance criterion on #2 maps to at least one automated test or a numbered manual verification step above.

## 8. Open questions for the owner

1. **Cloudflare account and policy (R1).** Which Cloudflare account hosts the workers: your personal one (Adobe IP/outside-activity policy applies to infrastructure that handles Adobe IMS tokens), or an Adobe-provided account? Free or Paid plan (limits in Further Notes)?
2. **Import vs copy.** Confirm that extension workers *import* the shared core by relative path (one security-fix location, deviates from fully self-contained folders) rather than vendoring a copy per extension (self-contained, drifts).
3. **Vendor route placement.** Confirm `apps/<ext>/providers/<vendor>/worker/` for server-side vendor code, registered by `apps/<ext>/worker/`'s entry (refinement of the #1 convention).
4. **Hello scope.** "The hello extension" = `apps/hello-world` (app) only? Or should `apps/hello-plugin` also call a worker (it would need its own worker or a shared deployed one)?
5. **Worker test runner.** Node built-in `node:test` + wrangler smoke (this spec, no new runner), or Cloudflare's Vitest plugin (workerd-native, adds Vitest)?
6. **POST/PATCH `5xx` retry policy.** This spec retries POST/PATCH only on `429` unless the caller opts in. The ticket literally says "429 and 5xx". Accept the safer default?
7. **Who may call a worker.** Accept "any authenticated Adobe user passing a client-id allowlist" as the default policy (R3), or require an org/user allowlist from the start? Does offline-only verification (no revocation check, R5) satisfy you?
8. **Real token facts.** I could not inspect a real EW IMS token (no login in this environment): is the EW client id `darkalley` and does the token carry `client_id`/`kid`? W2 will confirm; tell me earlier if you know.
9. **Deploy automation.** Manual `wrangler deploy` for now. Do you want a follow-up ticket for a GitHub Actions deploy using a scoped Cloudflare API token (secret in GitHub)?
10. **`workers.dev` vs custom domain.** Is a `workers.dev` URL acceptable for the hello proof and early vendor tickets?
11. **Smoke tier blocking.** Should the `worker-smoke` CI job be required (it needs `wrangler dev` to behave in GitHub Actions, R13) or advisory?
12. **Secret scanning.** Do you want GitHub secret scanning/push protection enabled on the repo as a second net behind the S3 rules (R12)? (Repo setting; not automatable here.)
13. **Naming.** Worker names (`ew-<ext>-worker`) and the `ORG`/`SITE` values assume `jazhou-adobe`/`ew-extensions` (#1 R10); confirm or give the real DA org/site.
