# Spec: Insights & Experiment Sidebar: GA4 (sidebar shell + first source)

Ticket: jazhou-adobe/ew-extensions#33 (this spec: #71). Blocked by #1 (repo scaffold; spec: `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec: `shared/worker-template/SPEC.md`). #33 blocks #34 (Adobe Analytics source) and #35 (Adobe Target source), so the contract defined here is a public interface for those two tickets.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) or observed on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Google/Cloudflare.

Vocabulary follows #1 and #2: *extension* = one folder `apps/<name>/` (type from its EW config-sheet row); *worker* = the per-extension backend in `apps/<name>/worker/` built from `shared/worker-template/`; *provider* = one vendor under `apps/<extension>/providers/<vendor>/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the page. Terms specific to this ticket: *source* = one analytics/experimentation backend shown in the sidebar (GA4 now; Adobe Analytics #34; Adobe Target #35); a source is implemented by exactly one *provider*. *Insights result* = the normalised JSON a provider returns. *Section* = one renderable block of a result (`stats`, `trend`, `table`). *Content site* = the DA org/site of the page being edited (SDK `context.org`/`context.site`); it can differ from the code site that serves the extension.

---

## Problem Statement

A content author editing a page in Experience Workspace (EW) has no idea how that page performs. To find out they leave EW, open Google Analytics, find the right property, filter to the page's URL and pick a date range, then come back. Authors rarely do this, so edits are made blind to page views, engagement, bounce and where the traffic comes from.

For the maintainer there is a second problem. This is the first of three tickets (GA4, Adobe Analytics, Adobe Target) that all put "how does this page perform" into one sidebar. If the first ticket hard-wires GA4 into the UI, each later ticket has to rework the shell, and each vendor's credential handling gets invented again. Analytics vendors also need server-held credentials (a Google service-account key cannot ship in a public static file), so the extension cannot be built as static files alone.

## Solution

A **library plugin** called "Insights" that appears in the EW editor library. Opened on a page, it shows how that page performed in Google Analytics 4 over a date range the author selects (last 7, 28 or 90 days, or a custom range): page views, active users, sessions, average engagement time, bounce rate, a per-day page-view trend, and the top traffic sources. The panel works for the page currently open in the editor, without leaving EW.

Behind it: a small **worker** (built from the shared template of #2) holds the Google service-account credential, checks the caller's IMS token, asks GA4 for the page's numbers, normalises them into a vendor-neutral result and caches them briefly. The browser sees only the normalised result, never a vendor credential.

The sidebar is a **shell plus sources**. The shell knows nothing about GA4: it asks the worker which sources are enabled for this site, asks each for its result, and renders whatever sections come back using three generic renderers (key numbers, a trend line, a table). A new source (Adobe Analytics, Adobe Target) is a new provider folder plus one registration line; the shell, the routes and the cache do not change. A conformance test suite shipped with the shell proves that a provider honours the contract, and the same suite is reused by #34 and #35.

## User Stories

Content author (EW user):

1. As a content author, I want an "Insights" entry in the editor library, so that I can open page performance without leaving EW.
2. As a content author, I want the panel to show metrics for the page I am editing, so that I do not have to find it in Google Analytics myself.
3. As a content author, I want to see page views for the page, so that I know how much traffic it gets.
4. As a content author, I want to see the number of active users, so that I can tell repeat views from distinct visitors.
5. As a content author, I want to see sessions, so that I understand the base of the bounce rate.
6. As a content author, I want to see average engagement time, so that I know whether people actually read the page.
7. As a content author, I want to see the bounce rate, so that I can spot pages people leave immediately.
8. As a content author, I want a per-day page-view trend, so that I can see whether traffic is rising, falling or spiking.
9. As a content author, I want the top traffic sources (source / medium), so that I know where visitors come from.
10. As a content author, I want to pick last 7, 28 or 90 days, so that I can look at the period that matters to me.
11. As a content author, I want to pick a custom start and end date, so that I can inspect a campaign or release window.
12. As a content author, I want an obvious message when my custom dates are invalid, so that I can fix them without a confusing error.
13. As a content author, I want a loading state while numbers are fetched, so that I know the panel is working.
14. As a content author, I want a clear "no data for this page in this period" message, so that I can tell an unpublished or zero-traffic page from a broken panel.
15. As a content author, I want a clear "analytics is not set up for this site" message with who to ask, so that I do not think the panel is broken.
16. As a content author, I want a clear "your session expired, reopen the panel" message, so that an expired sign-in does not look like missing data.
17. As a content author, I want a "try again" action on temporary failures, so that I can recover without reloading EW.
18. As a content author, I want a "too many requests, try again in N seconds" message when the quota is exhausted, so that I know to wait.
19. As a content author, I want to see when the numbers were generated and whether they came from the short-lived cache, so that I can judge freshness.
20. As a content author, I want a note when recent days may be incomplete, so that I do not misread yesterday's partial numbers as a drop.
21. As a content author, I want a note when GA4 sampled or thresholded the report, so that I know the numbers are approximate.
22. As a content author, I want to see which host and path the numbers are for, so that I can verify the panel matched my page.
23. As a content author, I want the panel to be readable in the narrow library column, so that it fits next to my document.
24. As a content author, I want the panel to work with the keyboard and a screen reader (labelled controls, table headers, live status), so that it is usable by everyone.
25. As a content author, I want the panel to never change my document, so that opening Insights is safe.
26. As a content author with several sources enabled (later: Adobe Analytics, Target), I want a source switcher, so that I can look at each in turn.
27. As a content author, I want one failing source not to blank the others, so that a Target outage does not hide GA4.
28. As a content author, I want the panel to explain the first time that it reflects the live (published) page, so that I am not surprised that unpublished edits do not appear.

Extension author / maintainer:

29. As the maintainer, I want the GA4 service-account key to live only in the worker's secret store, so that the public repo, the browser and the EDS code bus never contain it.
30. As the maintainer, I want unauthenticated calls to the worker rejected with `401`, so that nobody can use the key to read my analytics.
31. As the maintainer, I want the browser to be unable to choose the GA4 property or hostname, so that a crafted request cannot read a property I did not map to a site.
32. As the maintainer, I want the site-to-property mapping in worker configuration, so that onboarding a site is a config change and not a code change.
33. As the maintainer, I want results cached briefly in the worker, so that opening the panel repeatedly does not exhaust the GA4 property quota.
34. As the maintainer, I want upstream failures cached briefly too, so that a Google outage does not burn the property's server-error quota (10 per hour) by retry storms.
35. As the maintainer, I want one in-flight upstream call shared by identical concurrent requests, so that several authors opening the same page cost one query.
36. As the maintainer, I want the worker to confine outbound calls to the Google hosts, so that a bug cannot turn it into an open proxy.
37. As the maintainer, I want derived credentials (the parsed private key, the signed assertion, the minted access token) redacted from every response and log, so that "never echoed" holds for more than the stored secret string.
38. As the maintainer, I want local development against a fake Google on loopback, so that I never need a real key to run the tests or the dev loop.
39. As the maintainer, I want a documented, tested provider contract, so that #34 and #35 only add a provider folder and one registration line.
40. As the author of a later provider, I want a conformance suite I can point at my provider, so that I find contract violations before review.
41. As the author of a later provider, I want three generic section kinds that cover metrics, trends and tables, so that I do not need to change the shell to show my vendor's data.
42. As the author of a later provider, I want the shell to ignore unknown section kinds safely, so that a newer provider never crashes an older shell.
43. As the author of a later provider, I want secrets, hosts and per-site config declared by the provider and checked by the repo checks, so that nothing is forgotten.
44. As the maintainer, I want the README to document setup (GA4 access, secret, mapping), the config-sheet row and the site config it reads (none), so that onboarding a site is copy-paste.
45. As the maintainer, I want the extension listed in the repo README extensions table, so that the repo stays discoverable and the convention check passes.
46. As a reviewer, I want a branch-ref URL and a manual verification checklist in the PR, so that I can verify the panel in real EW with a branch.
47. As the maintainer, I want unit tests on query building, normalisation, caching, auth and rendering that run in CI without credentials, so that regressions are caught on every push.

Security reviewer:

48. As a security reviewer, I want proof that the IMS token, the service-account key, the signed assertion and the Google access token never appear in a browser-visible response, in the DOM, or in logs, so that "the browser never receives credentials" is tested.
49. As a security reviewer, I want proof that a request without a token, with a token from another key, or from a disallowed origin never reaches Google, so that the worker is not a free GA4 reader.
50. As a security reviewer, I want proof that analytics-derived strings render as text, never as HTML, so that a hostile referrer string cannot script the editor.

## Implementation Decisions

(No file paths or code, except where noted. Paths and layout are in the Build Analysis.)

1. **Extension shape (type from the config sheet).** One extension, `insights-sidebar`, type **library plugin**: registered by a row in the `library` tab of the site config; it has no `apps` row and no fullscreen page. Folder `apps/insights-sidebar/`, entry page named after the folder. The ticket's scoring table says "Type: Plugin", which agrees. The library title is "Insights" (not one of the reserved names `blocks`, `templates`, `icons`, `placeholders`, `aem-assets*` listed in the #1 spec, 2.5).
2. **Architecture: thin generic shell, all vendor knowledge in the worker.** The browser has no vendor code, no vendor credentials and no vendor-specific UI. It calls two worker routes: list the sources enabled for this site, and fetch one source's result for a page and range. The worker owns the provider registry, the site mapping, auth to vendors, caching and normalisation. Rationale: the browser is public static code; it only needs rendering; and "later sources only add a module" (AC3) is cheapest when the browser has nothing to register. Alternative considered and rejected: a per-vendor browser module that talks to the worker with vendor-shaped payloads, which forces every vendor ticket to touch browser rendering.
3. **The source (provider) contract is the central interface.** A provider is one server-side module that declares: a stable id (lowercase letters, digits, hyphen), a label, the secret names it needs, the outbound hosts it may call, how it resolves a site's per-source config from the worker configuration, and one operation: given a resolved site config, a normalised page and a range, produce an insights result. The shell supplies the verified identity, secrets accessor, proxy helper, clock, cache and logger (the #2 handler context) and never the raw IMS token. Registration is one entry in one registry module plus the provider's secrets/vars in the worker config. That is all #34 and #35 may need to touch outside their own provider folder (their ACs say "no changes needed in the extension shell beyond registering the provider").
4. **The insights result is a closed, versioned, vendor-neutral schema.** Fields: source identity, status (`ok`, `empty`, `not_configured`), the page identity actually queried, the resolved range (id, start, end, time zone), `generatedAt`, a `cached` flag, a list of sections, and a list of note codes. Sections are a closed set of three kinds:
   - `stats`: labelled key numbers with a format;
   - `trend`: a dated series with a format;
   - `table`: columns (key, label, format) and rows keyed by column.
   Formats are a closed set: `integer`, `decimal`, `percent` (a fraction 0..1), `duration` (seconds), `text`. Numbers are numbers (or `null` for "no value"), never preformatted strings, so the shell formats with `Intl` and tests stay locale-independent. Notes are codes from a closed set (`sampled`, `thresholded`, `other_row`, `data_delay`, `truncated`); the shell owns the message text, so no vendor-supplied prose reaches the DOM. The three section kinds were chosen so that Adobe Analytics (numbers, trend, breakdown table) and Adobe Target (a table of activities with status, variants and lift, plus stats) both fit without a new renderer; a genuinely new kind needs a shell release and is a deliberate, documented extension point, not an expectation of #34/#35.
5. **Domain states are results, not errors.** "The site is not mapped to a property" (`not_configured`) and "no rows for this page and range" (`empty`) are `200` responses with a status, because they are expected conditions authors should see explained. Authentication, origin, validation, quota and upstream failures use the #2 error contract unchanged (`401`, `403 forbidden_origin`, `400 bad_request`, `429 rate_limited`, `500 misconfigured`, `502 upstream_unavailable`, `503 auth_unavailable`, ...). A provider cannot invent new error codes.
6. **The worker validates provider output before returning it.** The same schema check the conformance suite uses runs at runtime on every provider result; an invalid result becomes `500 internal` (no detail). A buggy or compromised provider therefore cannot push arbitrary shapes (or HTML-looking structure) into the browser, and the shell can trust the schema.
7. **Routes.** Two `GET` routes under the extension worker: one lists enabled sources for a content site (org, site); one returns a result for a source, content site, page path and range. Query parameters are an exact allowlist; **unknown parameters are rejected with `400`**. The browser can send org, site, path, source and range only. It can never send a property id, hostname, report definition or credential. Both routes sit behind the #2 pipeline (origin gate, IMS auth, routing), so an unauthenticated call gets `401` before any provider code runs.
8. **Site-to-source mapping lives in worker configuration (non-secret).** A single JSON-valued configuration variable maps `org/site` of the content site to its per-source settings; for GA4: the numeric property id and, optionally, the production hostname the GA4 data stream records. A site absent from the mapping, or a mapped site without an entry for a source, means that source is not enabled for it. Sources enabled for a site = the providers that have an entry for it. The browser selects among configured entries by sending org and site, which come from the SDK `context`; it cannot add entries. The extension reads **no DA site-config sheet** in v1; it reads only the SDK context. The README states this (AC4's "any site config it reads"). Alternative considered: a property id in the library row's URL (as upstream's Brand Visibility does with `site-id`, https://github.com/adobe-rnd/ew-extensions/blob/main/tools/brand-visibility/README.md); rejected because then the browser chooses the property and the worker would have to trust it. [OPEN: Question 2 on committing property ids to a public repo.]
9. **Page identity.** The browser sends the SDK's `context.path` as given. The worker normalises it: strips `.html`/`.plain.html`, query and hash, rejects traversal and malformed paths, and derives the set of candidate GA4 `pagePath` values: the path with and without a trailing slash, and for an `index` document the folder path. The GA4 query matches the page with an exact list filter on `pagePath` and, when the site entry has a hostname, an exact filter on `hostName`, combined with AND. Without a hostname entry, all hosts in the property that record this path are included, which the README warns about. The panel shows the host and path matched. [ASSUMPTION: EDS public URL path = DA document path without extension, `index` served at the folder path; the library `context.path` has no extension (it is built as `/` + the editor hash path in https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/iframe-protocol.js). Resolved by manual step X11.]
10. **Date range.** Presets `last7`, `last28` (default), `last90`, plus `custom` with a start and end date. Presets are resolved in the worker to GA4's relative dates (`NdaysAgo` to `yesterday`), which GA4 interprets in the property's reporting time zone, so a browser in another time zone cannot shift the window [VERIFIED: https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/DateRange]. Custom dates are absolute `YYYY-MM-DD`; start must not be after end; the span is capped at 366 days (query cost grows with range length [VERIFIED: https://developers.google.com/analytics/devguides/reporting/data/v1/quotas]). The result returns the resolved absolute start/end and the property time zone (from the report metadata `timeZone` [VERIFIED: ResponseMetaData reference]), so the UI can state the window and the trend can be zero-filled for days GA4 omitted (rows with all-zero metrics are not returned by default [VERIFIED: runReport reference `keepEmptyRows`]).
11. **GA4 provider reports.** One `batchRunReports` call carrying two reports for the property (the batch endpoint allows up to 5 reports per call and each counts individually toward quota [VERIFIED: https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/batchRunReports, quotas page]):
    - *Report A (overview and trend):* dimension `date`; metrics `screenPageViews`, `activeUsers`, `sessions`, `userEngagementDuration`, `bounceRate`; metric aggregation TOTAL for the headline numbers; ascending by date.
    - *Report B (sources):* dimension `sessionSourceMedium`; metrics `sessions`, `screenPageViews`; descending by sessions; at most 10 rows.
    Both carry the same filter. Only these dimensions and metrics are ever requested (provider-owned, not browser-controlled). All are standard API names [VERIFIED: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema]. None of the five potentially-thresholded dimensions (`userAgeBracket`, `userGender`, `brandingInterest`, `audienceId`, `audienceName`) is used [VERIFIED: quotas page], and no user-level or high-cardinality dimension (`pageReferrer`, `fullPageUrl`) is requested, which keeps token cost low and the data aggregate-only.
12. **Metric semantics, stated in the README and the UI labels.** *Page views* = `screenPageViews`. *Active users* = `activeUsers`. *Sessions* = `sessions` containing the page. *Average engagement time* = total `userEngagementDuration` divided by `activeUsers`, computed in the provider (`null` when there are no users; never `NaN`/`Infinity`) [ASSUMPTION: matches GA4's "average engagement time per active user"; to be cross-checked in X2]. *Bounce rate* = `bounceRate`, a fraction of sessions that were not engaged [VERIFIED: api-schema: "returned as a fraction"]. *Top referrers* = `sessionSourceMedium`: the source/medium that started the sessions that included this page, not the page's immediate referring URL [VERIFIED definition: api-schema `sessionSourceMedium`]; this is deliberate (low cardinality, aggregate) and is flagged for owner confirmation [OPEN: Question 6].
13. **Google authentication (service account).** The worker mints a short-lived access token by the documented JWT-bearer flow: sign a JWT (`RS256`; claims issuer, scope, audience, issued-at, expiry at most one hour) with the service-account private key and POST it to Google's token endpoint with the JWT-bearer grant type [VERIFIED: https://developers.google.com/identity/protocols/oauth2/service-account, "HTTP/REST"]. Scope: `https://www.googleapis.com/auth/analytics.readonly` [VERIFIED: runReport reference, authorization scopes]. The service account's email must be granted a read role on the GA4 property (Viewer) in the Analytics UI [VERIFIED procedure link: https://support.google.com/analytics/answer/9305788, referenced by https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart]. The whole service-account JSON key is stored as **one** Cloudflare secret (`wrangler secret put ... < key.json`; ~2.4 KB, under the 5 KB variable limit [VERIFIED: https://developers.cloudflare.com/workers/platform/limits/ "Environment variables"; key size ASSUMPTION]). The minted access token is cached in the worker isolate until about five minutes before expiry, with a single in-flight mint shared by concurrent requests. The private key is never used for anything but signing. Domain-wide delegation (`sub`) is not used.
14. **Two template-contract additions are required (dependencies on #2).** (E6 in the chat-approvals spec raises the first as well.)
    - *D1, dynamic outbound credential:* #2's proxy helper injects a secret *by name*. The GA4 bearer token is minted at runtime, so it is not an env secret. The proxy needs an option to pass an explicit one-call credential value that is still redacted from logs/responses and never forwarded elsewhere. Fallback if #2 declines: the provider sets the outbound `Authorization` header itself and registers the value for redaction (D2); the proxy must then not strip explicitly-set outbound headers.
    - *D2, redaction of derived values:* #2 redacts configured secret values and the caller's token. The service-account JSON's private key appears in derived forms (PEM with real newlines, base64 DER, the signed assertion, the access token) that do not contain the stored string, so string-matching the stored secret is not enough. The handler context needs a way for a provider to register extra values for redaction for the duration of a request.
    Both are tested here (G-A8, PC3) even if implemented in #2; the build plan sequences them.
15. **Cache: per-isolate, bounded, short TTL, in the worker.** Results are cached in worker memory keyed by source, property, the candidate page paths and the resolved range tokens; not by caller (the data is identical for every authorised caller). Default TTL 300 s, configurable; bounded entry count (default 200, oldest evicted); identical concurrent requests share one upstream call. Upstream failures (`429`, `5xx`, network) are cached for a short negative TTL (default 30 s) so a Google problem is not retried by every author: GA4 allows only 10 server errors per property per project per hour before it blocks the project for that property [VERIFIED: quotas page]. Responses carry `Cache-Control: private` with a short `max-age`. The Cloudflare Cache API is **not** used because its operations are functional on custom domains and Pages Functions, and the #2 default deployment is a `workers.dev` URL [VERIFIED statement about custom domains: https://developers.cloudflare.com/workers/runtime-apis/cache/; ASSUMPTION that `workers.dev` therefore does not cache]. A cache adapter seam keeps a later Cache API or KV implementation a drop-in. Isolate memory is best-effort (isolates are evicted; hit rate is not guaranteed) [ASSUMPTION; fine for "cached briefly"]. [OPEN: Question 5.]
16. **GA4 retry tuning.** The #2 proxy default retries `429`/`5xx` three times; against GA4 that could consume four of the ten hourly server errors for one failing request. The GA4 provider overrides: at most 1 retry on `5xx`, at most 2 on `429`, and an overall deadline shorter than the browser's wait. Quota errors map to `429 rate_limited` with a `Retry-After` taken from the negative-cache remainder.
17. **Who may call (beyond authentication).** Template defaults apply (IMS token valid; optional `ALLOWED_IMS_CLIENT_IDS`). Because the data is a site's traffic numbers, #2's R3 ("any Adobe user can call") matters more than for a public-key vendor. v1 mitigations: only mapped content sites are queryable, the property is never client-chosen, and the client-id allowlist is configured. **Recommended, pending owner approval:** an `authorize` hook that confirms the caller can read the content site by calling Adobe's DA admin list endpoint for that org/site with the caller's token (it returns `401` for anonymous and `403` without read permission [VERIFIED in source: https://github.com/adobe/da-admin/blob/main/src/routes/list.js, https://github.com/adobe/da-admin/blob/main/src/index.js]), caching the positive answer briefly per user and site and failing closed. This needs a #2 addition (D3: let the hook call one allowlisted Adobe host with the caller's token without exposing the token on the identity). Not built unless approved. [OPEN: Question 3.]
18. **Worker origin is a constant (the #2 rule).** The extension page decides the worker origin from its own hostname (loopback worker on `localhost`, fixed deployed origin otherwise), never from a query parameter; a test proves `?worker=` is ignored. Consequence for the dev loop: a local worker is reachable only with `ref=local`; branch-ref pages use the deployed worker.
19. **Shell behaviour.** Awaits the SDK (the #1 rule: import the module and the entry-page script tag); shows "waiting for Experience Workspace" then "not running inside Experience Workspace" when standalone. Then: read `context` (org, site, path); list sources; load every enabled source in parallel, independently, with aborts on range change and a bounded wait. A source switcher appears only when more than one source is enabled. All text uses `textContent`; no `innerHTML`; the IMS token is used only for the `Authorization` header to the worker and never rendered, logged or put in a URL. The plugin never calls `sendText`, `sendHTML` or any other document-changing action. The trend is an inline SVG with a text alternative; no charting library. The panel states that it reflects the published page and that the context path is read when the panel opens (reopen after navigating; the same constraint Brand Visibility documents, https://github.com/adobe-rnd/ew-extensions/blob/main/tools/brand-visibility/README.md [VERIFIED upstream README wording; whether the SDK can notify of navigation is [OPEN]]).
20. **Local and test overrides of Google hosts.** The Google API and token endpoints are fixed production hosts. For local dev and hermetic tests, non-secret overrides point them at loopback fakes; the overrides are honoured only in the local environment (`ALLOW_LOCALHOST`) and a non-loopback override is refused as `misconfigured`. No fake-data mode exists in worker production code.
21. **Tooling and CI: as decided.** Everything lives in `apps/insights-sidebar/` per the #1 convention; ESLint 8 + helix config, Stylelint 16, `@web/test-runner` for browser modules, Playwright (Chromium, stub tier), `node:test` for worker code (per #2), Node >= 22.12, husky. The worker's `worker/` folder is built from `shared/worker-template/`; the GA4 server code is `providers/ga4/worker/` (the #2 placement for vendor server code). The repo checks (S3) gain extension-specific rules (Testing Requirements 6).
22. **Observability.** One structured log line per request (the #2 fields) plus: source id, content-site key, cache hit/miss/negative-hit, upstream status class, and the GA4 `propertyQuota` remaining tokens when requested (`returnPropertyQuota` is set so quota use is visible [VERIFIED: quotas page]). No token, key, assertion, header values or response bodies.
23. **Data handling.** Only aggregate numbers and source/medium labels are returned. No user-level identifiers are requested, stored or logged. The cache holds the normalised result only, in memory, with a TTL.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given an SDK result, the DOM and the worker calls the sidebar makes; given a `Request` to the worker and a fake outside world (fake IMS, fake Google token endpoint, fake GA4 Data API), the `Response` and the *outbound requests Google would have received*. The fake Google verifies the signed assertion with the test public key and answers only when the bearer token it minted is presented, so "the worker authenticates to Google correctly" is proven without a Google account. Never assert on internal helper names or call counts of internal functions. The standing negative properties apply everywhere: no secret or derived credential ever appears in a browser-visible byte or a log line; no provider code runs before auth succeeds; hostile strings are inert.

**Proposed seams** (recorded instead of asked, per #71; reuse #1/#2 seams wherever possible; **no new seam is required**):

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 (primary) | Worker HTTP boundary `worker.fetch(request, env, ctx)` | reused from #2 | Node tests for routes, cache, GA4 provider, provider conformance | Constructed `Request`; env factory; the #2 test kit (fake IMS key server, token factory, canary secret); a **fake Google** (token endpoint that verifies the RS256 assertion with the test public key, plus a Data API that validates the bearer token and records every report request) built on the #2 fake-upstream; injected `fetch`/`sleep`/`random`/`now` |
| W1-C | Provider conformance suite: the same W1 boundary, parametrised by provider | reused W1, new helper | every provider (GA4 now; #34, #35 later) and a test-only second provider | a provider-supplied scripted fake vendor; the suite checks schema, secrecy, host confinement |
| W2 | Worker in workerd over real HTTP (`wrangler dev`, local) | reused from #2 | smoke tier | fake IMS and fake Google on loopback servers; secrets from a temp env file |
| S1 | Entry HTML page + SDK module boundary | reused from #1/#2 | Playwright e2e | #1 SDK stub with a library-shaped context and a token signed by the test key; the real local worker on 8787; fake Google on loopback |
| S2 | Render/logic modules + SDK result | reused from #1 | WTR unit tests | injected `fetch`; hand-built SDK result; a browser-side fixture of worker results |
| S3 | Repo convention check | reused, extended | CI lint job | temp-dir fixtures |

The real EW boundary (real IMS login, real `context.path` values, real Google data) is covered by manual verification only (Testing Requirements 5). **Modules tested:** result schema and runtime validator, provider registry/routes, site resolution and path normalisation, range resolution, GA4 query builder, GA4 response normaliser, Google token minting, cache (TTL, bound, coalescing, negative cache), GA4 error mapping, browser client, renderers, formatters, range control, repo checks.

**Prior art.** #1 spec: SDK stub, WTR import-map seam, Playwright route-stub tier, convention check. #2 spec: test kit (fake IMS, fake upstream, canary), W1/W2 seams, hello worker route tests (HW*) and hello page tests (HP*), E2E1-E2E4 browser-to-real-local-worker pattern. Upstream `adobe-rnd/ew-extensions` has no worker or analytics code (checked via the GitHub tree API 2026-11-16); its Brand Visibility plugin is the prior art for a library plugin that talks to an authenticated backend with the SDK token and for the `library` row format.

## Out of Scope

- Adobe Analytics (#34) and Adobe Target (#35): this ticket defines and tests the contract they will implement; it builds no code for them. The contract's ability to represent them is checked by *design review against their ticket text*, not by building them.
- Period-over-period comparison, segments/audiences, realtime, funnels, demographics, per-event reports, custom dimensions, e-commerce.
- Any other analytics source (Helix operational telemetry/RUM, Universal Analytics, Matomo, ...); see Further Notes on overlap.
- Reading a DA site-config sheet for per-site settings (v1 reads only the SDK context; the mapping is worker config).
- KV/D1/R2/Durable Objects, the Cloudflare Cache API, queues, cron pre-warming of results.
- CI-driven deployment, custom domains, Cloudflare credentials in CI (as #2).
- A charting library, export/download, deep links into the GA4 UI, editing content from the panel.
- Updating the panel when the author navigates inside the editor (no SDK event identified); the panel reads the page when it opens.
- Authorisation against DA permissions unless the owner approves Open Question 3.
- Multi-property aggregation (one site to several properties) and multi-region/EU data-stream differences beyond what the Data API hides.
- The Adobe outside-activity/IP policy question (carried by #1 R1).

## Further Notes

- **Overlap risk is real (scoring: 4/5).** EDS already offers first-party operational telemetry (https://www.aem.live/developer/rum) and experimentation tooling (https://www.aem.live/docs/experimentation), and EW may ship page-level insights itself. GA4 is chosen first because the ticket says so and because it is a clean, documented API; the shell/provider split keeps the cost of a RUM or other first-party source low. [OPEN: Question 12, ask the EW team whether page-performance insights are planned before investing further.]
- **Data latency shapes expectations and testing.** GA4 standard-property intraday data is typically available after 2-6 hours and daily data after about 12 hours; processing can take 24-48 hours and late events can arrive up to 7 days later [VERIFIED: https://support.google.com/analytics/answer/11198161]. The panel therefore flags recent days as possibly incomplete, and the manual verification seeds data a day ahead (X1).
- **GA4 numbers are approximate by design.** Unique counts use HyperLogLog++, reports can be sampled or thresholded, and rows can roll into `(other)` [VERIFIED: https://developers.google.com/analytics/devguides/reporting/data/v1/reporting-data-expectations]. The result carries notes derived from `samplingMetadatas`, `subjectToThresholding`, `dataLossFromOtherRow` and `dataTruncationReasons` [VERIFIED fields: ResponseMetaData reference].
- **API surface.** The Data API core reporting endpoints are served under `v1beta` [VERIFIED: runReport and batchRunReports references]; Google's own docs mark it as the recommended method. Pin the base URL in one place so a future `v1` move is one change.
- **`ref=local` and branch refs concern where the extension code is served, not what data is shown.** The numbers are always the production property's; a branch ref changes which code and which worker (deployed) are used.
- **Cross-spec consistency.** Placement (`providers/<vendor>/worker/`), `worker/`, S3 rules, the SDK stub and the manual steps (M*, W*) follow the #1 and #2 specs. The `type` for the README extensions table is `library plugin`.

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)
 └─ editor library -> iframe: Insights (this repo; origin https://{ref}--{site}--{org}.aem.live | .preview.da.live | http://localhost:3000)
       │  SDK handshake: { token (IMS), context {org, site, path, ref, ...}, actions }   (actions unused: read-only plugin)
       │  GET {worker}/insights/sources?org&site                       Authorization: Bearer <IMS token>   (cross-origin; preflight first)
       │  GET {worker}/insights/ga4?org&site&path&range[&start&end]    Authorization: Bearer <IMS token>
       ▼
 Cloudflare Worker "insights-sidebar worker"   (apps/insights-sidebar/worker; core from shared/worker-template)
       1 origin gate + preflight -> 2 IMS token check -> 3 route: validate params -> resolve site mapping -> registry lookup
       4 cache (hit | coalesced | miss) -> 5 provider (GA4): build reports -> Google auth (mint/cached token) -> proxy
       6 normalise -> validate result schema -> respond
       │
       ├─ POST https://oauth2.googleapis.com/token                        (JWT-bearer; key from secret GA4_SERVICE_ACCOUNT_JSON)
       └─ POST https://analyticsdata.googleapis.com/v1beta/properties/{id}:batchRunReports
```

| Concern | Browser extension (static, public) | Worker (private runtime, holds secrets) |
|---|---|---|
| Google service-account key, access token | never | only place (secret store + isolate memory) |
| Which property/host to query | never chosen | resolved from configuration by org/site |
| Report definition (dimensions, metrics, filters) | none | provider-owned constants |
| Identity | obtains IMS token from the SDK, sends it | verifies it (#2) |
| Page identity | sends `context.path` as given | normalises, builds candidate paths |
| Range | sends preset id or custom dates | resolves to GA4 dates, validates span |
| Caching | none (browser `Cache-Control: private` short) | per-isolate TTL cache, coalescing, negative cache |
| Normalisation to the result schema | renders only | produces and validates |
| UI, formatting, accessibility, states | all | none |
| Vendor quotas and retries | shows the message | tuned retries, negative cache, `Retry-After` |

## 2. EW integration points

- **Library plugin, not an app.** One row in the `library` tab of the site config (`https://da.live/config#/{org}/{site}/`), columns `title`, `path`, `format`, `ref`, `icon`, `experience` [VERIFIED columns: https://www.aem.live/docs/ew/administering/set-up-library; behaviour from https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/helpers.js as read in the #1 spec 2.5]:

  | title | path | format | ref | icon | experience |
  |---|---|---|---|---|---|
  | `Insights` | `/apps/insights-sidebar/insights-sidebar.html` | | (blank) | | (blank = `inline`) |

  A path starting with `/` resolves to `http://localhost:3000{path}` when the editor URL has `?ref=local`, else to `https://{branch}--{site}--{org}.aem.live{path}`; a blank `ref` column means the row always shows. An absolute URL is used as-is, so another site can register the same plugin by pointing at this repo's origin. Whether a panel taller/narrower variant exists via `experience` is undocumented beyond `inline`, `window`, `fullsize-dialog` seen in source [OPEN, low stakes; default is used].
- **SDK data used:** `token` (IMS access token) and `context` with `org`, `site` (alias `repo`), `path` (a string beginning with `/`), `ref`, `branch`, `view`, `hash` [VERIFIED in source: iframe-protocol.js]. SDK actions used: none. `capabilities` are not needed (live document subscription would allow tracking the open doc, but not navigation; see Risks R9).
- **`ref=local` loop:** page at `http://localhost:3000` (the #1 dev server) calls the local worker at `http://localhost:8787` (#2). Locally the worker's secret is a real key in an untracked `.dev.vars`, or, for hermetic work, the fake-Google overrides (Decision 20) with a throwaway key.
- **Branch ref:** `?ref=<branch>` on the editor URL loads the page from `{branch}--{site}--{org}.aem.live` (or `.preview.da.live`); it calls the *deployed* worker.
- **Config-sheet rows:** exactly the one `library` row above; no `apps` row. The extensions table row in the repo README: name "Insights & Experiment Sidebar", folder `apps/insights-sidebar/`, entry `apps/insights-sidebar/insights-sidebar.html`, type `library plugin`, description "Page performance (Google Analytics 4 first) in the editor library".
- **Site config read:** none. The extension reads the SDK `context` only. Per-site analytics settings are in the worker's `GA4_SITES` configuration (Section 4).

## 3. External APIs and auth flows

| API | Use | Auth | Primary source |
|---|---|---|---|
| GA4 Data API `POST https://analyticsdata.googleapis.com/v1beta/properties/{id}:batchRunReports` | two reports per request (overview+trend, sources) | OAuth bearer, scope `analytics.readonly` | https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/batchRunReports (max 5 requests per batch; same property for all) |
| Report request/response shape: `dateRanges` (`YYYY-MM-DD`, `NdaysAgo`, `yesterday`, `today`; up to 4 ranges), `dimensionFilter` (`andGroup`, `filter` with `stringFilter` or `inListFilter`, each with `caseSensitive`), `metricAggregations`, `orderBys`, `limit`, `keepEmptyRows`, `returnPropertyQuota`; response `rows`, `totals`, `rowCount`, `metadata` (`timeZone`, `subjectToThresholding`, `dataLossFromOtherRow`, `samplingMetadatas`, `dataTruncationReasons`, `emptyReason`), `propertyQuota` | | | runReport: https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport ; DateRange: .../v1beta/DateRange ; Filters: .../v1beta/FilterExpression ; RunReportResponse: .../v1beta/RunReportResponse ; ResponseMetaData: .../v1beta/ResponseMetaData |
| Dimension/metric names used: `date`, `sessionSourceMedium`, `pagePath`, `hostName`; `screenPageViews`, `activeUsers`, `sessions`, `userEngagementDuration`, `bounceRate` | | | https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema (definitions read 2026-11-16: `pagePath` = path between hostname and query string; `hostName` = subdomain+domain; `bounceRate` = (sessions - engaged sessions)/sessions as a fraction; `userEngagementDuration` in seconds; `sessionSourceMedium` = source and medium that initiated the session) |
| Google OAuth token endpoint `POST https://oauth2.googleapis.com/token` | exchange a signed service-account JWT for an access token | JWT assertion; `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`; `expires_in` 3600 in Google's example | https://developers.google.com/identity/protocols/oauth2/service-account ("HTTP/REST": header `RS256`/`JWT`; claims `iss`, `scope`, `aud` = `https://oauth2.googleapis.com/token`, `exp` (max 1 h after `iat`), `iat`) |
| GA4 quotas and errors | server-error and token budgets drive caching and retry tuning | n/a | quotas: https://developers.google.com/analytics/devguides/reporting/data/v1/quotas (standard property: 200,000 core tokens/day, 40,000/hour, 14,000/hour per project per property, 10 concurrent requests, **10 server errors/hour per project per property**, most requests cost <= 10 tokens); errors: https://developers.google.com/analytics/devguides/reporting/data/v1/errors (400 `INVALID_ARGUMENT`, 401 `UNAUTHENTICATED`, 403 `PERMISSION_DENIED`, 429 `RESOURCE_EXHAUSTED`, 500, 503) |
| GA4 property access for the service account | Viewer role on the property | granted by a GA admin in the Analytics UI | https://support.google.com/analytics/answer/9305788 ; property id lookup: https://developers.google.com/analytics/devguides/reporting/data/v1/property-id |
| Cloudflare Workers: secrets, limits, Cache API | secret storage (5 KB per variable); Free plan 10 ms CPU, 50 subrequests; Cache API functional on custom domains | n/a | https://developers.cloudflare.com/workers/platform/limits/ , https://developers.cloudflare.com/workers/runtime-apis/cache/ , https://developers.cloudflare.com/workers/configuration/secrets/ |
| Adobe IMS key set, DA App SDK, DA admin list route | as #2 / #1; DA admin only for the optional authorize hook | IMS bearer | #2 spec section 3; https://github.com/adobe/da-admin/blob/main/src/routes/list.js |
| GA4 Measurement Protocol (test data only) | seed deterministic `page_view` events for manual verification | `api_secret` + `measurement_id`; never in repo | https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events (events can be backdated up to 72 h; a new `session_id` creates a new session [VERIFIED for the Firebase tab; web-stream equivalence ASSUMPTION]) |

**Auth flow (caller to worker):** unchanged from #2: IMS token from the SDK as `Authorization: Bearer`, verified offline against Adobe's key set, origin allowlist, optional client-id allowlist.

**Auth flow (worker to Google):** read secret -> parse service-account JSON (`client_email`, `private_key`, optional `private_key_id`) -> if no valid cached access token: sign assertion with WebCrypto (RSASSA-PKCS1-v1_5, SHA-256; the PEM is PKCS#8) -> POST to the token endpoint -> cache token + expiry -> call the Data API with `Authorization: Bearer <access token>`. On a Data API `401` the cached token is dropped and minted once more; a second `401` is `misconfigured`. All derived values are registered for redaction (D2).

**Unverified Google facts** [OPEN]: whether the Data API accepts a self-signed JWT without the OAuth exchange (the service-account doc mentions "authorization without OAuth" for some APIs; not confirmed for `analyticsdata.googleapis.com`); the exact size and shape of a real service-account key (assumed ~2.4 KB); whether `bounceRate`/`sessions` behave as expected when sliced by `pagePath` (session-scoped metrics filtered by an event-scoped dimension; the filter keeps sessions that include the page, which is the intended meaning but not read from a primary source); exact `engagementDuration` per-user semantics for "average engagement time". The first three are checked in X2/X3.

## 4. Data contracts

All contracts are behaviour contracts. Short JSON examples show shape only (they are not implementation code).

**Worker route 1: sources.** `GET /insights/sources?org={org}&site={site}` with a valid IMS token and an allowed origin. `200 {"sources":[{"id":"ga4","label":"Google Analytics 4"}]}`. A site with no mapping gives `200 {"sources":[]}` (the UI then shows the not-configured state). `org`/`site`: 1-64 chars of `[a-z0-9-]`, lowercased server-side; anything else `400 bad_request`.

**Worker route 2: result.** `GET /insights/{source}?org=&site=&path=&range=last7|last28|last90` or `range=custom&start=YYYY-MM-DD&end=YYYY-MM-DD`. `path`: begins with `/`, at most 512 chars, characters `[A-Za-z0-9._~%/-]` only, no `..`, no `//`. Unknown source id: `404 not_found`. Known source but no entry for the site: `200` with `status: "not_configured"`. Unknown query parameter, repeated parameter, bad dates, start after end, span over 366 days: `400 bad_request`. Method other than `GET`: `405`. Responses carry the #2 CORS headers; success responses add `Cache-Control: private, max-age=60` and `Vary: Origin`.

**Result envelope (`200`):**

```json
{
  "source": { "id": "ga4", "label": "Google Analytics 4" },
  "status": "ok",
  "page": { "path": "/en/pricing", "host": "www.example.com" },
  "range": { "id": "last28", "start": "2026-10-19", "end": "2026-11-15", "timeZone": "America/New_York" },
  "generatedAt": "2026-11-16T12:00:00.000Z",
  "cached": false,
  "sections": [
    { "kind": "stats", "key": "overview", "label": "Overview", "items": [
      { "key": "pageViews", "label": "Page views", "value": 1234, "format": "integer" },
      { "key": "activeUsers", "label": "Active users", "value": 980, "format": "integer" },
      { "key": "sessions", "label": "Sessions", "value": 1010, "format": "integer" },
      { "key": "avgEngagement", "label": "Avg. engagement time", "value": 83.4, "format": "duration" },
      { "key": "bounceRate", "label": "Bounce rate", "value": 0.412, "format": "percent" } ] },
    { "kind": "trend", "key": "pageViewsByDay", "label": "Page views per day", "format": "integer",
      "points": [ { "date": "2026-10-19", "value": 41 } ] },
    { "kind": "table", "key": "referrers", "label": "Top sources", "columns": [
        { "key": "source", "label": "Source / medium", "format": "text" },
        { "key": "sessions", "label": "Sessions", "format": "integer" },
        { "key": "share", "label": "Share", "format": "percent" } ],
      "rows": [ { "source": "google / organic", "sessions": 410, "share": 0.52 } ] }
  ],
  "notes": [ "data_delay" ]
}
```

Rules enforced by the runtime validator and the conformance suite: only the listed top-level keys; `status` in `ok|empty|not_configured`; `empty` and `not_configured` carry no sections; section kinds only `stats|trend|table`; formats only `integer|decimal|percent|duration|text`; numbers finite or `null`; table row keys subset of the column keys; `trend` dates `YYYY-MM-DD` ascending; notes only from the closed set; whole result at most 64 KB; strings are plain text. Error responses are the #2 error JSON.

**Worker configuration (wrangler `vars`, non-secret; additive to the #2 table):**

| Name | Meaning | Production | Local env |
|---|---|---|---|
| `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS` | as #2 (`ORG`/`SITE` identify the *code* site for CORS) | as #2 | as #2 |
| `GA4_SITES` | JSON object: key `org/site` of the *content* site, value `{ "propertyId": "<numeric>", "hostName": "<optional production host>" }` | owner-provided [OPEN Q2/Q9] | a fake property id |
| `INSIGHTS_CACHE_TTL_SECONDS` | result TTL | `300` | `300` (tests inject the clock) |
| `INSIGHTS_CACHE_MAX_ENTRIES` | cache bound | `200` | small in tests |
| `INSIGHTS_NEGATIVE_TTL_SECONDS` | upstream-failure cache | `30` | `30` |
| `GA4_API_ORIGIN`, `GOOGLE_OAUTH_ORIGIN` | override Google hosts | unset (defaults) | loopback fakes; ignored/refused unless loopback and `ALLOW_LOCALHOST` |

JSON-object `vars` support in wrangler is [ASSUMPTION: https://developers.cloudflare.com/workers/wrangler/configuration/ lists JSON `vars`; fallback is a JSON string parsed by the worker].

**Secrets (`secrets.required`):** `GA4_SERVICE_ACCOUNT_JSON` (the entire downloaded key file). Listed in `.dev.vars.example` (UR5).

**Provider contract (behaviour):**

| Member | Contract |
|---|---|
| `id` | `^[a-z][a-z0-9-]{1,30}$`; unique; the route segment and the key under which a site's entry is looked up |
| `label` | short display string |
| `secrets` | names; must be a subset of the worker's `secrets.required` (repo check) |
| `hosts` | outbound hosts the provider may call (https; loopback http only in the local env); passed to the proxy `allowedHosts` |
| `siteConfig(entry)` | validates and returns this provider's per-site settings from the mapping entry; returns `null` when the site has none (source not enabled) |
| `fetch(ctx, { site, page, range })` | returns an insights result (above) or throws a template `HttpError`; `ctx` = the #2 handler context (identity without raw token, `secret()`, `proxy()`, `redact()` (D2), `now`, `log`) plus the cache adapter; the provider must not touch `Request` or headers |

`page` = `{ path, candidates[] }`; `range` = `{ id, start?, end?, startToken, endToken }` already validated.

**Browser module boundaries:** (a) range control (presets and custom validation, pure); (b) worker client (injected `fetch`, constant origin, `AbortController`, bounded wait, error-code mapping to UI states, never reads the token except to set the header); (c) formatters (pure, `Intl`); (d) renderer (state to DOM, `textContent` only); (e) bootstrap (awaits the SDK, wires the above).

## 5. Folder layout (fits the #1/#2 convention)

```
apps/insights-sidebar/
├─ SPEC.md                           this file
├─ README.md                         what it does; setup (GA4 access, secret, mapping); the library row; site config read (none); local dev; branch ref; troubleshooting
├─ insights-sidebar.html             entry page (SDK script tag + extension script)
├─ insights-sidebar.js               bootstrap
├─ insights-sidebar-render.js        side-effect-free render
├─ insights-sidebar.css
├─ insights-client.js · insights-range.js · insights-format.js · worker-config.js
├─ test/unit/*.test.js               WTR (S2)
├─ test/e2e/*.spec.js                Playwright (S1)
├─ worker/                           built from shared/worker-template/scaffold
│   ├─ wrangler config · .dev.vars.example · README.md
│   ├─ src/index.js                  route list + pipeline wiring
│   ├─ src/insights.js               validation, site resolution, page normalisation, range resolution
│   ├─ src/registry.js               THE registration point: the list of providers
│   ├─ src/cache.js                  TTL + bound + coalescing + negative cache (adapter seam)
│   ├─ src/contract.js               result schema + runtime validator (also used by the conformance suite)
│   ├─ test/                         node:test (W1) incl. a test-only second provider
│   └─ test-support/                 provider-conformance suite (reused by #34/#35)
└─ providers/ga4/
    ├─ README.md                     GA4 setup: project, API enablement, service account, property access, mapping, metric definitions
    └─ worker/                       ga4.js (provider) · query.js · normalize.js · google-auth.js
        └─ test/                     fake Google, fixtures (recorded-shape JSON), tests
```

Vendor follow-ups add `providers/<vendor>/` with the same internal layout and one line in `src/registry.js`; their README documents vendor credentials and site-config keys (#34/#35 ACs). The `.hlxignore` hides `**/worker/`, `**/test/`, and `providers/*/worker/` from the code bus (#1/#2 rules); the browser files and READMEs remain public.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Any authenticated Adobe user can call the worker** (#2 R3) and the data is a site's traffic. A caller can choose any mapped org/site. | High if the mapped site is sensitive | Mapping-only sites; client-id allowlist; property never client-chosen; recommended DA read-access `authorize` hook (Decision 17, needs #2 D3); owner decision Question 3. |
| R2 | **GA4 quota:** 10 server errors/hour per project per property blocks the project; 14,000 tokens/hour per project per property. | Medium | Short TTL cache, negative cache, coalescing, retries reduced (Decision 15/16), log `propertyQuota`. |
| R3 | **#2 contract gaps (D1 dynamic credential, D2 derived-value redaction, optional D3).** Without D2 the private key could leak in a form the stored-string redaction misses. | High (security) | Sequence these in #2 first or ship the documented fallback; test G-A8/PC3 regardless. |
| R4 | **Cache API unavailable on `workers.dev`**; isolate memory is best-effort and per-isolate. | Low-Med | Adapter seam; document hit rate is not guaranteed; custom domain/KV is an owner choice (Question 5). |
| R5 | **Free-plan CPU budget (10 ms)** vs IMS RS256 verify plus Google RS256 sign plus JSON work. | Medium | Token cached ~55 min so signing is rare; SM-I4 measures; Paid plan is an owner decision (#2 Q1). [ASSUMPTION: not measured] |
| R6 | **Page-to-`pagePath` matching** (index pages, trailing slash, rewrites, locale prefixes, query strings, custom domain) is inferred. | Medium | Candidate set, optional hostname, panel shows what was matched, manual X11 observes real `context.path`, README documents limits. |
| R7 | **Metric semantics:** session metrics sliced by page; "average engagement time" definition; session-scoped source/medium. | Medium | Labels and README definitions; X2 cross-check against the GA4 UI and Query Explorer (https://ga-dev-tools.google/ga4/query-explorer/); owner Question 6/7. |
| R8 | **Data latency and approximation** (24-48 h processing; sampling; thresholding; `(other)`). | Medium | `data_delay`, `sampled`, `thresholded`, `other_row` notes; manual verification seeds data a day ahead. |
| R9 | **Library `context.path` is a snapshot** taken at open; no navigation event identified. | Low-Med | Documented; panel shows the matched path; [OPEN: ask EW team whether a navigation signal exists]. |
| R10 | **`ref=local` plus a real service-account key on a developer machine.** | Medium | Untracked `.dev.vars`; hermetic fake-Google overrides for all tests; README warns; UR2 check. |
| R11 | **Property ids in a committed wrangler config** of a public-capable repo. | Low | Not credentials; owner decides (Question 2); alternative: set `GA4_SITES` as a dashboard variable, not committed. |
| R12 | **`pagePath`-filtered reports can be high-cardinality token cost** on large properties. | Low-Med | Only one low-cardinality second dimension, `limit`, short ranges by default, 366-day cap, quota logging. |
| R13 | **Overlap with first-party insights/RUM/experimentation (scoring 4/5).** | Strategic | Contract keeps a first-party source cheap; Question 12. |
| R14 | **Docs vs behaviour drift** for the SDK context shape (undocumented; differs by surface). | Medium | Render generically, read only `org`, `site`, `path`; stub contract test (inherited from #1 R4). |
| R15 | **Unverified Google behaviours** (see section 3). | Low-Med | Marked [OPEN]; resolved by manual checks before the first release. |

## 7. Ordered build plan (sized to #33's acceptance criteria)

0. **Prerequisites (owner):** #1 and #2 landed (tooling, SDK stub, CI, worker template and test kit); Cloudflare account and `wrangler login`; Google Cloud project with the Analytics Data API enabled; a service account and key; a GA4 property with the service-account email as Viewer; decisions on Questions 2, 3, 5 (they change the build); the #2 additions D1/D2 agreed (or the fallback). A test content site and page with GA4 tagging (X1).
1. **Contract first (AC3):** result schema and runtime validator; provider contract; registry; the **conformance suite** (PC*) with a test-only second provider. Red/green: conformance passes for the test-only provider and fails for deliberately broken ones.
2. **Route layer (AC2, AC7):** parameter validation, site resolution, page normalisation, range resolution, sources route, unknown-source handling, strict unknown-parameter rejection (IR*). Uses a stub provider.
3. **Cache (AC2):** TTL, bound, coalescing, negative cache, adapter seam (GC*).
4. **GA4 provider (AC1, AC2, AC7):** fake Google first (the verifying token endpoint); then Google auth (GA*), query builder (GQ*), normaliser (GN*), error mapping; derived-value redaction (needs D2).
5. **Worker scaffold and config (AC4, AC7):** copy the #2 scaffold, wrangler config, `.dev.vars.example`, `secrets.required`, vars, README (setup, dev, deploy, rotation).
6. **Browser, test-first (AC1, AC3):** range, formatters, client, renderer, bootstrap, CSS (BU*); then Playwright against the real local worker and fake Google (PW*).
7. **Runtime smoke (AC2, AC7):** SM-I* in workerd.
8. **Repo checks and CI (AC4, AC5, AC8):** extend S3 (UI*), add the extension's tests to the existing `unit`, `worker-unit`, `worker-smoke`, `e2e`, `lint` jobs; README extensions-table row (AC5); no credentials in CI.
9. **Optional, only if Question 3 is approved:** DA read-access `authorize` hook (IR10) with its #2 dependency.
10. **Deploy and manual verification (AC1, AC2, AC5, AC6, AC7):** X0-X12 with real Google, real IMS, real EW; record observed `context.path` and `Origin` values in the PR and README.
11. **Hand-off for #34/#35:** README section "Adding a source" (checklist, conformance suite command, registry line, what not to touch).

---

# Testing Requirements

## 1. Worker unit and contract tests (seam W1; Node built-in runner; no network, no Cloudflare login)

Fixtures/mocks: the #2 test kit (`makeEnv`, fake IMS key server and `signToken`, canary secret, injected `fetch`/`sleep`/`random`/`now`), plus a **fake Google** in the GA4 provider's tests. The fake Google has (a) a token endpoint that parses the posted form, checks the grant type, verifies the assertion signature with the test RSA public key and checks `iss`, `scope`, `aud`, `iat`/`exp` (at most 3600 s apart), returning a token with `expires_in`; and (b) a Data API endpoint that accepts only a bearer token it issued, validates the batch body (at most 5 reports, known dimension/metric names), records every request, and replies from scripted fixtures shaped like `RunReportResponse` (`rows`, `totals`, `rowCount`, `metadata.timeZone`, `propertyQuota`). Fixtures are authored from the documented response schema and extended by a recorded real sample after X2 (until then they are [ASSUMPTION]-grade). `GA4_SITES` fixture: one fully configured site (property + hostname), one with property only, one unmapped.

### 1.1 Provider contract and registry (AC3)

| ID | Behaviour asserted |
|---|---|
| PC1 | Conformance suite, descriptor: id matches the pattern and is unique in the registry; label non-empty; `secrets` is a subset of the worker's `secrets.required`; `hosts` non-empty, https only; fails for a provider declaring an undeclared secret or an `http://` non-loopback host |
| PC2 | Conformance suite, schema: results for `ok`, `empty`, `not_configured` validate; invalid results are rejected (unknown top-level key, unknown section kind, unknown format, non-finite number, row key outside columns, unsorted trend dates, unknown note code, over 64 KB, non-string text) |
| PC3 | Conformance suite, secrecy: for success and each error path, the canary secret and every value the provider registered for redaction are absent from the response body, headers and captured logs |
| PC4 | Conformance suite, host confinement: a provider that calls a host not in its `hosts` fails (the proxy refuses; no request reaches the fake) |
| PC5 | Conformance suite: neither the provider's `ctx` nor its outbound requests contain the caller's IMS token or inbound `Authorization` |
| PC6 | Conformance suite: a provider returning `empty` and `not_configured` is accepted; returning sections with those statuses is rejected |
| PC7 | Runtime guard: a provider that returns an invalid result yields `500 internal` with a fixed message and no detail; the invalid payload is not in the response or logs |
| PC8 | Registry: a test-only second provider registered with no change to routing code appears in the sources route for a site that has an entry for it, is routable, and its sections validate (AC3 server-side proof); a site without an entry does not list it; duplicate ids make startup fail |

### 1.2 Routes, validation, authorisation (AC2, AC7)

| ID | Behaviour asserted |
|---|---|
| IR1 | Sources route with valid token and allowed origin: lists exactly the providers with an entry for the site; an unmapped site gives `{"sources":[]}`; `org`/`site` are lowercased; invalid characters or length give `400` |
| IR2 | No token gives `401` with `Access-Control-Allow-Origin` for an allowed origin; disallowed origin with a valid token gives `403`; neither reaches a provider nor Google (fake Google receives zero requests); token from another key, expired token, wrong type: `401` (extends #2 UA*/UC*) |
| IR3 | Validation matrix on the result route: missing org/site/path/range, unknown `range` id, `custom` without or with malformed dates, start after end, span over 366 days, `path` not beginning with `/`, containing `..`, `//`, backslash, query or hash characters, over 512 chars: all `400 bad_request`, no upstream call |
| IR4 | Unknown source id with a valid token: `404 not_found`; known source but no entry for the site: `200` `status: not_configured` and no Google call |
| IR5 | Methods other than `GET`: `405`; unknown route with token `404`; unknown route without token `401` (pipeline order, #2 UA12) |
| IR6 | **Client cannot steer the query:** `propertyId`, `property`, `hostName`, `host`, `metrics`, `dimensions`, `report` or any other unknown parameter gives `400`; repeating a known parameter gives `400`; no outbound request is made; a mapped site always queries its configured property |
| IR7 | Path normalisation via the outbound filter: `/a/b`, `/a/b.html`, `/a/b.plain.html`, `/a/b/` all produce the same candidate set `{/a/b, /a/b/}`; `/a/index` gives candidates including the folder path `/a/`; `/` and `/index` give `/`; percent-encoded paths are matched as sent |
| IR8 | Range resolution: `last7`/`last28`/`last90` give `7daysAgo`/`28daysAgo`/`90daysAgo` to `yesterday` in the outbound request; custom dates pass through as absolute; the result's `range` has absolute start/end consistent with the response `metadata.timeZone` and an injected `now` |
| IR9 | Response headers: success has `Cache-Control: private` with a short `max-age`, `Vary: Origin`, `x-request-id`; error responses are the #2 contract with `no-store` |
| IR10 | *(only if Open Question 3 is approved)* `authorize` hook: caller without read access to the content site gets `403 forbidden`; with access `200`; positive result cached per user+site for the configured window; DA admin `5xx`/network gives `503` and no Google call (fail closed); hook not called for unauthenticated requests |

### 1.3 Cache (AC2)

| ID | Behaviour asserted |
|---|---|
| GC1 | Second identical request within the TTL: no second Data API call; response `cached: true` with the original `generatedAt` |
| GC2 | After the TTL (injected clock) the next request calls Google again |
| GC3 | Different site, path, range or source produce different cache entries (no cross-contamination) |
| GC4 | N concurrent identical cold requests produce exactly one batch call and N identical results |
| GC5 | The cache never exceeds `INSIGHTS_CACHE_MAX_ENTRIES`; the oldest entry is evicted |
| GC6 | Upstream `429`/`5xx`/network failure is negative-cached: a second request inside the negative TTL gets the same error without a Google call; a `429` carries `Retry-After` equal to the remaining negative TTL; after the TTL Google is called again |
| GC7 | A cached result is never served to an unauthenticated, wrong-origin or invalid-parameter request (checked after warming the cache) |
| GC8 | Cached values contain no caller identity and no token (inspect the cache adapter's stored values) |
| GC9 | The access-token cache is separate from the result cache: results expire, the token stays until its refresh window |

### 1.4 Google authentication (AC2, AC7)

| ID | Behaviour asserted |
|---|---|
| GA1 | The assertion posted to the token endpoint is `RS256`/`JWT`, signed with the secret's private key (the fake verifies with the public key), with `iss` = the key's `client_email`, `scope` = `https://www.googleapis.com/auth/analytics.readonly`, `aud` = `https://oauth2.googleapis.com/token`, `exp - iat <= 3600` |
| GA2 | Token request is a form POST with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`; the Data API call carries `Authorization: Bearer <minted token>` and **no** inbound caller credential |
| GA3 | One token mint serves many requests; a new mint happens once the injected clock is within the refresh window before expiry; concurrent cold requests share one mint |
| GA4 | Token endpoint `4xx` (`invalid_grant`, `invalid_client`) gives `500 misconfigured` (generic) with a log line naming the reason class only; token endpoint `5xx`/network gives `502 upstream_unavailable` (and is negative-cached) |
| GA5 | Data API `401` once: cached token dropped, one re-mint, one retry succeeds; `401` twice gives `500 misconfigured`; no retry loop |
| GA6 | Data API `403 PERMISSION_DENIED` (service account lacks property access) gives `500 misconfigured` with a log line `ga4_permission_denied` and no upstream text in the response; `400 INVALID_ARGUMENT` gives `500 internal` |
| GA7 | `429 RESOURCE_EXHAUSTED` gives `429 rate_limited` with `Retry-After`; `500`/`503` gives `502 upstream_unavailable`; retries are capped as configured (at most 1 on `5xx`, 2 on `429`), asserted on the fake's request count |
| GA8 | **Derived-credential canary** (extends #2 US1): the parsed private key (PEM and DER forms), the signed assertion and the access token never appear in any response body or header or log line, across success and every error above, including a fake Google that echoes the assertion or token in an error body (requires D2) |
| GA9 | Malformed secret (not JSON, missing `client_email`/`private_key`, unparsable key) gives `500 misconfigured`; log names the secret, never a value; a missing secret behaves as #2 US2 |
| GA10 | Google host overrides: loopback overrides are honoured only in the local env; a non-loopback override is refused as `misconfigured` and no request is sent |

### 1.5 GA4 query building and normalisation (AC1)

| ID | Behaviour asserted |
|---|---|
| GQ1 | Exactly one `batchRunReports` POST to `https://analyticsdata.googleapis.com/v1beta/properties/{configured id}:batchRunReports` containing two reports (at most 5), with the specified date ranges, both carrying the same filter |
| GQ2 | Filter: `hostName` exact **and** `pagePath` in the candidate list when the site has a hostname; only the `pagePath` list when it does not; paths never interpolated into a regex or `contains` filter |
| GQ3 | The requested dimensions and metrics are exactly the documented sets (`date`, `sessionSourceMedium`; `screenPageViews`, `activeUsers`, `sessions`, `userEngagementDuration`, `bounceRate`); no `pageReferrer`, `fullPageUrl`, audience, demographic or user-level dimension; `returnPropertyQuota` is true; report B `limit` 10; report A has TOTAL aggregation |
| GN1 | Stats equal the report totals; average engagement time = `userEngagementDuration` / `activeUsers`; zero users gives `null`, never `NaN`/`Infinity`; `bounceRate` stays a fraction; metric strings become numbers |
| GN2 | Trend: GA4 `YYYYMMDD` becomes `YYYY-MM-DD`, ascending, **zero-filled** for omitted days across the resolved range (time zone from `metadata.timeZone`) |
| GN3 | Sources table sorted by sessions descending, at most 10 rows, `(direct) / (none)` and `(not set)` preserved, `share` = row sessions / total sessions (safe when total is 0) |
| GN4 | No rows and no totals gives `status: empty` with no sections; `metadata.emptyReason` does not leak into the response |
| GN5 | Notes: sampling metadata gives `sampled`; `subjectToThresholding` gives `thresholded`; `dataLossFromOtherRow` gives `other_row`; truncation reasons give `truncated`; a range including yesterday or today gives `data_delay`; the notes carry codes only |
| GN6 | Malformed upstream body (missing `rows`/`metricHeaders`, wrong column order, unexpected types) gives `502 upstream_unavailable` with no detail; header-driven column mapping survives reordered metric columns |
| GN7 | Output passes the conformance schema for every fixture (ok, empty, thresholded, sampled, single-day, 366-day) |

## 2. Browser unit tests (seam S2; WTR + Mocha + chai; injected `fetch`; SDK stub from #1)

| ID | Behaviour asserted |
|---|---|
| BU1 | Standalone: SDK never resolves, "waiting for Experience Workspace" then "not running inside Experience Workspace"; no network call is made (fetch spy) |
| BU2 | With the SDK stub: calls the sources route then the result route for each enabled source, with `Authorization: Bearer <stub token>` and exactly the parameters org, site, path, range; no property, host or report parameters; default range `last28` |
| BU3 | Renders stats, trend and table from a worker-result fixture: labels, formatted numbers (integer, percent to one decimal, duration as `Ns`/`Mm Ss`/`Hh Mm`, `null` as an em dash), trend SVG with an accessible name and a text alternative, table with a caption and column headers |
| BU4 | Range control: choosing last 7/90 refetches with the matching `range`; custom valid dates refetch with `custom&start&end`; start after end, span over 366 days, malformed dates show an inline error and make **no** request |
| BU5 | States: loading is announced (live region / `aria-busy`); `empty` shows the no-data message; `not_configured` shows the setup message; error codes map to messages: `401` reopen/sign-in, `403` configuration, `429` retry countdown from `Retry-After`, `502`/network/timeout retry action; none shows a stack trace, raw error text or a secret |
| BU6 | Bounded wait: a request exceeding the timeout (injected) shows a timeout message; changing the range aborts the in-flight request and a late response for the old range is ignored (race test) |
| BU7 | Hostile strings in labels, rows and notes (`<img src=x onerror=...>`, `<script>`) render as literal text and create no elements |
| BU8 | The IMS token never appears in the DOM, in any URL, in `console.*` output, or in rendered errors |
| BU9 | `?worker=https://evil.example` in the page URL is ignored; on `localhost` the worker origin is the loopback worker, elsewhere the fixed deployed origin (inherits #2 HP5) |
| BU10 | Two enabled sources: a switcher appears; each loads independently; one failing leaves the other rendered (AC3 client-side proof with fixture sources); with one source no switcher is shown |
| BU11 | Forward compatibility: an unknown section `kind` is skipped with a neutral "not supported by this version" line and does not throw; an unknown `format` renders as `text`; an unknown note code renders a generic note |
| BU12 | Missing or non-string `context.path` shows "open a page to see insights" and makes no result request; path is sent exactly as given (normalisation is the worker's job) |
| BU13 | The plugin never calls `sendText`, `sendHTML`, `closeLibrary` or any document-changing action (the stub's call log stays empty) |
| BU14 | Formatters and range helper (pure): fixed-locale outputs, rounding, boundary cases (59 s, 60 s, 3599 s, 3600 s; 0; `null`; 0.4125 as `41.3%`), preset to parameter mapping, custom validation boundaries |
| BU15 | Notes: `data_delay`, `sampled`, `thresholded` render their shell-owned messages; matched host/path and `generatedAt`/`cached` indicator render |

## 3. Runtime smoke tier (seam W2; Node test file driving `wrangler dev` locally; no Cloudflare login)

Starts the real insights worker in workerd with `IMS_ORIGIN`, `GA4_API_ORIGIN` and `GOOGLE_OAUTH_ORIGIN` pointing at loopback fake servers, and the secret from a temp env file holding a throwaway test key.

| ID | Behaviour asserted |
|---|---|
| SM-I1 | The worker bundles (the `shared/` import resolves `jose`; the provider modules resolve) and starts; a bare request gets `401` |
| SM-I2 | Valid token + fake Google: `200` result matches the fixture; the fake token endpoint verified the assertion signature produced by **workerd's WebCrypto** (proves PKCS#8 RSA signing works in the real runtime) |
| SM-I3 | Preflight from `http://localhost:3000` (local env) `204`; from `https://evil.example` `403`; same over real HTTP as #2 SM2 |
| SM-I4 | Canary and derived credentials absent from all responses (GA8 over HTTP) |
| SM-I5 | Second identical request is served from cache (fake Google saw one batch call) |
| SM-I6 | Records CPU/wall time and subrequest count for a cold request (token mint + report) and a warm request, informational against R5 (no hard threshold until a baseline exists) |

## 4. End-to-end tests (seam S1; Playwright, Chromium, hermetic: real local worker, fake IMS, fake Google)

Setup: global setup starts static server on 3000, the worker via wrangler on 8787 (local env), fake IMS and fake Google on loopback; the SDK stub supplies a library-shaped context (`org`, `site`, `repo`, `ref: local`, `path: /en/pricing`, `view: edit`, `branch: main`) and a token signed by the test key. Viewport 360x800 (library column).

| ID | Behaviour asserted |
|---|---|
| PW1 | Panel loads and shows the fake property's numbers for `/en/pricing`; the fake Google received exactly one batch request with the mapped property, the path filter and the last-28-days range (AC1, AC2) |
| PW2 | Switching to last 7 days and then a custom range shows new numbers; the fake saw the matching `dateRanges` (AC1) |
| PW3 | Reloading within the TTL shows the same numbers with the cached indicator and the fake saw no second data call (AC2) |
| PW4 | SDK stub with no token, and with a token signed by a different key: UI shows the sign-in message; worker answered `401` readable through CORS; fake Google received zero requests (AC7) |
| PW5 | Scan of the page HTML, DOM text, storage and every network response for the IMS token (allowed only in the request `Authorization` header to the worker), the private key (PEM fragments), the assertion and the Google access token: none present (AC7) |
| PW6 | Fake Google returns hostile source strings: rendered inert; accessibility tree has labelled range controls, a named trend image, a captioned table and a live status region |
| PW7 | A test-only second provider enabled by the test worker environment adds a second source tab and renders its sections with **no change to any shell file** (AC3 end to end) |
| PW8 | Only expected hosts were contacted by the browser: the static page, the worker, the SDK stub (never a Google host) (AC7) |
| PW9 | Unmapped site: `not_configured` message; no result request; worker log shows no Google call |

## 5. End-to-end checks inside real Experience Workspace (manual; needs interactive Adobe login, a Cloudflare account, a Google account)

**Accounts and credentials needed (none of them in the repo):** GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, #1 M0); Adobe IMS identity with access to the DA org/site and config rights; Chrome; Cloudflare account with Wrangler login (#2 W0); a Google Cloud project with the Analytics Data API enabled and a **service account + JSON key** (never committed; delivered to the worker with `wrangler secret put`); a **free GA4 property** with the service-account email added as Viewer and its numeric property id; a **test content site and published page** tagged with the GA4 Google tag (or a stream's Measurement Protocol `measurement_id` + `api_secret` for seeding); Google Analytics UI access to cross-check numbers. Never paste a real IMS token, key or secret into chat, issue comments or logs. **Why not Google's demo account:** [ASSUMPTION] it is read-only for users and cannot grant a service account access; verify before relying on it.

- **X0 (prereq):** #1 M0 and #2 W0 pass (site reachable, worker deployable). `curl -i <worker>/insights/sources?org=x&site=y` returns `401` (liveness + AC7 negative).
- **X1 (seed data, day D):** drive deterministic traffic to a path on the test host: real visits with the Google tag from several browsers/profiles, and/or Measurement Protocol `page_view` events with `page_location` on the test host, distinct `client_id`/`session_id` values, fixed `engagement_time_msec`, backdating at most 72 h via `timestamp_micros` (https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events). Write down the expected page views, users, sessions and sources. [ASSUMPTION: MP `page_view` with `page_location` populates `pagePath`/`screenPageViews` and creates sessions; fall back to real visits if not.] Wait for processing (typically hours; up to 24-48 h) before X2.
- **X2 (ground truth, day D+1):** run the identical report in the GA4 UI (Pages and screens, same date range and host filter) and in Query Explorer (https://ga-dev-tools.google/ga4/query-explorer/) with the same dimensions/metrics/filter; record the numbers. This is the reference for the panel and settles the metric-semantics assumptions (R7) and the `bounceRate`-by-page behaviour (section 3 unverified list).
- **X3 (deploy):** `wrangler secret put GA4_SERVICE_ACCOUNT_JSON < key.json`; set `GA4_SITES` for the test site (property id, host); `wrangler deploy` from `apps/insights-sidebar/worker/`; `curl` with a valid IMS token (inspect the token as in #2 W2) returns the result; the same without a token returns `401`; with `Origin: https://evil.example` returns `403`; with `?propertyId=1` returns `400`.
- **X4 (`ref=local`):** terminal A `npm start` (port 3000); terminal B the worker dev script (port 8787) using a local `.dev.vars` with the real key (or the fake-Google override for a UI-only pass); add the `library` row (section 2) to the site config; open a document for the tagged page in the EW editor with `?ref=local`, open the library, pick **Insights**: numbers equal X2 for the same range; change to last 7 and a custom range: they change and match X2 for those ranges; DevTools Network shows the preflight `204`, `Authorization` only on the worker call, and no key/assertion/access token in any response (AC1, AC2, AC6, AC7).
- **X5 (branch ref):** push a branch with a simple name (e.g. `insights-ga4`), wait for code sync; open the editor with `?ref=insights-ga4`; the panel loads from the branch and calls the **deployed** worker; same checks as X4; record the page's real `Origin` (aem.live or preview.da.live) (AC6; resolves #2 R2 for this extension).
- **X6 (caching and quota):** reopen the panel within five minutes; worker logs (Workers Logs) show a cache hit and no new Data API call; the log's `propertyQuota` remaining tokens decrease only on misses; reopen after the TTL: a new call (AC2).
- **X7 (secret hygiene):** search responses, page source and Application storage for `private_key` fragments and the client email; `wrangler secret list` shows names only; rotate by `wrangler secret put` with a new key and confirm the panel keeps working after the cached token expires or the worker restarts (AC7).
- **X8 (negative: access revoked):** remove the service account from the GA4 property: the panel shows the "analytics is not set up correctly" message, the log shows `ga4_permission_denied`, no upstream text reached the browser; restore access (AC7, GA6 in reality).
- **X9 (states):** an unpublished or brand-new document path shows the empty state; a site not in `GA4_SITES` shows the not-configured state; with the worker URL wrong or down, the retry message appears and the editor stays usable.
- **X10 (library registration):** after saving the `library` row, **Insights** appears in the editor library for a site user; clicking it opens the panel (AC5, "reachable from the editor library"); a user without the row's site sees nothing.
- **X11 (observe real context):** open the #1 hello plugin (it renders `context` generically) on nested documents, an `index` document, a document with a hash, and note `context.path` exactly; confirm the candidate-path rules (Decision 9) produce a match for each in GA4; update the README and rules if not (resolves R6 and the Decision 9 assumption).
- **X12 (README walk-through):** a reviewer follows the extension README from a clean clone to a working panel on a scratch site, using only what it says (AC4).

## 6. Repo checks (seam S3, extended; temp-dir fixtures)

| ID | Behaviour asserted |
|---|---|
| UI1 | The root README extensions table has a row for `insights-sidebar` (type `library plugin`, entry `apps/insights-sidebar/insights-sidebar.html`) and the row resolves to a real folder and entry page (AC5; #1 S3) |
| UI2 | The extension README exists and contains the registration `library` row, the secrets list, the vars list and a "site config read" statement; the GA4 provider README exists (AC4) |
| UI3 | Shell isolation: files outside `providers/` import from `providers/` only through the registry module; a fixture that imports `providers/ga4/...` from a route file fails the check (AC3, keeps "only registration is needed") |
| UI4 | Provider layout: every `providers/<vendor>/` has a README and `worker/` with tests; every registry entry resolves to a provider folder and vice versa |
| UI5 | #2 rules apply: wrangler config only in `apps/insights-sidebar/worker/`; `GA4_SERVICE_ACCOUNT_JSON` in `secrets.required` and in `.dev.vars.example`; no secret-named key in `vars` (`GA4_SITES` is allowed); no tracked `.dev.vars*`/`.env*`; `.hlxignore` hides the worker, provider server code and tests |
| UI6 | The browser code (outside `worker/` and `providers/*/worker/`) contains no Google hostname and no property id (grep-style check; protects AC7) |

## 7. CI additions (no credentials, no Cloudflare login, no Google account)

No new jobs: the extension's tests plug into the #1/#2 jobs on every push and PR.

| Job | Gains |
|---|---|
| `lint` | ESLint/Stylelint over the extension (worker code with the #2 Node/worker override); S3 UI1-UI6 |
| `unit` | BU1-BU15 (WTR, `apps/insights-sidebar/test/unit`) |
| `worker-unit` | PC*, IR*, GC*, GA*, GQ*, GN* (`node:test` over `apps/insights-sidebar/worker/test` and `providers/ga4/worker/test`) |
| `worker-smoke` | SM-I1-SM-I6 (workerd via wrangler; advisory if flaky, per #2 Open Question 11) |
| `e2e` | PW1-PW9 (Chromium); the global setup starts the worker and the fakes |

## 8. Acceptance-criteria traceability (ticket #33)

| # | Acceptance criterion (#33) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Opening the plugin on a page shows GA4 metrics for that page's URL over a selectable date range | GQ1-GQ3 (page filter, ranges, report definition), GN1-GN7 (metrics, trend, sources), IR7-IR8 (path and range resolution), BU2-BU4, BU14 (range control and request), BU3 (rendering), PW1, PW2 | **X2** (ground truth), **X4**, **X5**, **X11** (real page-path matching) |
| AC2 | Metrics are fetched by the worker with server-held credentials and cached briefly | GA1-GA3 (service-account auth in the worker), GQ1, GC1-GC9 (TTL, bound, coalescing, negative cache), SM-I2, SM-I5, PW1, PW3 | **X3** (secret in the store), **X6** (cache hit/miss, quota log), **X7** |
| AC3 | Source interface is defined so later sources only add a module | PC1-PC8 (descriptor, schema, secrecy, host confinement, registry, runtime guard, a second provider with no shell change), BU10-BU11 (multiple sources, unknown kinds), PW7, UI3, UI4 | Review: README "Adding a source" checklist; `#34`/`#35` ticket text checked against the contract (their ACs: provider folder + registration only) |
| AC4 | All code in the self-contained `insights-sidebar` folder; README covers setup, the config-sheet row, any site config read | UI2, UI4, UI5 (layout, README content checks, worker location) | **X12** (README walk-through from a clean clone); review: README states "reads no DA site config; per-site mapping in worker `GA4_SITES`" |
| AC5 | Listed in the repo README extensions table and reachable from the editor library | UI1 (table row resolves) | **X10** (library row, appears and opens), review of the table row |
| AC6 | Works in EW with `ref=local` and with a branch ref | BU9 and PW1-PW9 run against `localhost:3000` + local worker (the `ref=local` topology); SM-I3 (local CORS) | **X4** (`ref=local`), **X5** (branch ref, deployed worker, observed `Origin`) |
| AC7 | Vendor credentials only in the worker (built from the shared template); browser never receives them; unauthenticated calls rejected | IR2, IR6, GC7 (auth/origin/steering), GA8, PC3, PC5, SM-I4 (no secret or derived credential anywhere), BU8, PW4, PW5, PW8, UI5, UI6; the #2 template tests (UA*, UC*, US*) | **X3** (curl: no token `401`, evil origin `403`, steering `400`), **X7** (hygiene, rotation), **X8** (revocation), **X0** |
| AC8 | Core logic covered by unit tests; lint and CI green | the whole of sections 1-4 run in CI jobs of section 7; BU*, PC*, GQ*, GN*, GA*, GC*, IR* are the core-logic tests | Review: CI green on the PR (all five jobs); a deliberately broken rule on a scratch branch (e.g. add `pageReferrer` to the query) turns GQ3 red |

Every acceptance criterion on #33 maps to at least one automated test or a numbered manual verification step above.

## 9. Open questions for the owner

1. **Test property, site and policy.** Which Google Cloud project, GA4 property and test content site/host may be used for X1-X9 (free resources are enough), and under which Google account (R1 of #1: infrastructure under a personal account)? Is a throwaway site with the Google tag acceptable, or should it be an existing site?
2. **Property ids in the repo.** `GA4_SITES` holds the numeric property id and host (not credentials). Commit it in the worker config (simple, visible), or set it only as a Cloudflare dashboard variable (repo stays clean; `wrangler deploy` must preserve it)? Recommended: committed for the throwaway test site, dashboard-only for any real site.
3. **Authorisation depth (R1).** Accept v1 = "authenticated Adobe user + client-id allowlist + only mapped sites", or approve the DA read-access `authorize` hook (Decision 17; needs #2 addition D3, adds a subrequest and fail-closed behaviour)? Recommended: approve the hook before mapping any real site; the owner's own test site is fine without it.
4. **#2 contract additions.** Approve D1 (dynamic outbound credential; also needed by the chat-approvals spec, its E6) and D2 (register derived values for redaction) in the #2 template, or accept the documented fallback? Without D2 the GA4 private key could leak in a derived form; recommended: D1 and D2 are required.
5. **Cache.** Is per-isolate memory with a 300 s TTL and 30 s negative TTL acceptable for "cached briefly", given `workers.dev` has no functional Cache API and hit rates are best-effort? Or do you want a custom domain (Cache API) or KV (outside #2's scope)? Is 300 s the right freshness for authors?
6. **Top referrers definition.** `sessionSourceMedium` (where the session started, low cardinality) vs the page's immediate referring URL (`pageReferrer`, high cardinality, higher token cost). Recommended: `sessionSourceMedium`, labelled "Top sources".
7. **Metric definitions.** Confirm: average engagement time = `userEngagementDuration` / `activeUsers`; bounce rate = GA4's `bounceRate` over sessions containing the page; show active users and sessions alongside.
8. **Range UX.** Presets 7/28/90 days (default 28) plus a custom range capped at 366 days: confirm. Should "yesterday-excluded" rolling windows (`NdaysAgo` to `yesterday`) be the preset meaning (recommended) rather than including today?
9. **Hostname filter.** Should the production hostname be required in each site's mapping entry (recommended, avoids mixing preview/staging traffic recorded in the same property), or optional as specified?
10. **Page matching.** Confirm the candidate-path rule (with/without trailing slash, `index` to folder) after X11 shows real `context.path` values; confirm GA records the production path for your sites (no rewrite layer).
11. **Navigation.** The panel reads the page when it opens. Is "reopen after navigating" acceptable, or should we ask the EW team for a context-change signal?
12. **Overlap and sequencing (R13).** Before investing in #34/#35: has the EW team said whether first-party page insights are planned? Do you want a Helix operational-telemetry source considered ahead of Adobe Analytics?
13. **Worker plan.** Free plan (10 ms CPU) is probably enough because the token is cached ~55 minutes, but RS256 signing + verification is unmeasured (SM-I6). Accept Free until SM-I6 says otherwise?
14. **Google specifics to confirm in X2/X3.** Behaviour of `bounceRate`/`sessions` sliced by `pagePath`; whether a self-signed JWT can replace the OAuth exchange (would save one hop; not planned); GA4 data retention limits for long custom ranges (the response reports `DATA_TRUNCATION_TYPE_PROPERTY` truncation; surfaced as the `truncated` note).
