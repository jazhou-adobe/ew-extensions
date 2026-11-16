# Spec: Automation Connectors: EW event relay + Zapier app

Ticket: jazhou-adobe/ew-extensions#7 (this spec: #45). Blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). Blocks #8 (Make app) and #9 (n8n community node), which reuse the relay this ticket builds.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Zapier/Cloudflare.

Vocabulary follows #1 and #2: *extension* = one folder `apps/<name>/`; *worker* = the per-extension backend in `apps/<name>/worker/` built from `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension. New terms used here:

- **Relay** = the worker in `apps/automation-connectors/worker/`. It watches EW sites for content events and fans them out to subscribers.
- **Site connection** = a relay record for one `{org}/{site}` holding that site's AEM Admin API key (encrypted) and polling state.
- **Relay credential** = the per-site secret the relay issues for a connector (Zapier) to call the relay. Not an Adobe credential.
- **Connector** = a third-party automation product (Zapier here; Make in #8, n8n in #9).
- **Event** = one of `page.previewed`, `page.published`, `page.unpublished`, `page.updated`.
- **Hook / subscription** = a connector's registration "send me events of type X for this site to this URL" (Zapier REST Hook).

Primary sources read (all 2026-11-16): AEM Admin API reference (legacy `admin.hlx.page`) https://www.aem.live/docs/admin.html (OpenAPI v12.150.1, embedded in the page); new AEM Admin API Service (`api.aem.live`, "hlx6") https://www.aem.live/docs/api.html (v1.90.6); Admin API keys https://www.aem.live/docs/admin-apikeys; Admin roles and permissions https://www.aem.live/docs/authentication-setup-authoring; limits https://www.aem.live/docs/limits; DA List API https://docs.da.live/developers/api/list; DA backend `adobe/da-admin` `src/utils/auth.js` and `src/index.js`; DA client `adobe/da-live` `blocks/shared/utils.js` and `adobe/da-nx` `nx2/utils/api.md`; Zapier platform docs https://docs.zapier.com/llms.txt (index) and the pages cited inline; Cloudflare Workers docs cited inline; upstream https://github.com/adobe-rnd/ew-extensions (no automation, webhook or Zapier code; checked with `gh search code`).

---

## Problem Statement

A team running its site in Experience Workspace (EW) wants the rest of its stack to react to content changes: post to Slack when a page is published, open a ticket when a page is previewed for review, kick off translation or an SEO audit when a page changes, or create and publish pages from a form or a CRM record. Teams that use Contentful get this out of the box through Zapier (Entry Published, Updated Entry, New Entry; Create, Update and Publish Entry) [VERIFIED: https://help.zapier.com/hc/en-us/articles/30849592994445-App-updates-Contentful-Outreach-and-Sage-Intacct]. EW users have nothing: they would have to write and host their own glue code.

Two facts make this hard:

1. **No public EW webhook source is confirmed.** I found no webhook, event subscription or notification feature in the AEM Admin API reference, the DA Admin API (`adobe/da-admin` routes: config, copy, list, media, move, properties, source, version) or the upstream extension repo. [VERIFIED by reading the sources above; absence of evidence, not proof that no internal event bus exists. OPEN: ask the EW/AEM team.] What does exist is a pull API: the Admin API `log` endpoint records preview and publish operations per site, and folder listings expose last-modified times.
2. **Browser-only code cannot do this.** Events happen whether or not anyone has EW open, subscribers are third-party servers, and the credentials needed (Admin API key, relay credentials) must never reach a browser. A backend that polls and delivers is unavoidable, which is why the ticket says "Backend needed: Yes" and is blocked by the shared worker template.

The maintainer needs a vendor-neutral relay that detects EW content events by polling, de-duplicates them, and delivers each one to every subscriber, plus a first connector (a Zapier app) on top, so a Zap such as "page published to Slack message" works end to end.

## Solution

Ship one extension folder, `automation-connectors`, with three parts:

- **The relay** (a Cloudflare Worker built from the shared worker template): a scheduled poller that watches each connected site, turns Admin API log entries and source changes into normalised events, stores them once, and delivers each event once per subscription to the subscriber's URL. It also exposes a small authenticated REST API for connectors (subscribe, unsubscribe, sample events, create/preview/publish page) and an admin API for the EW app.
- **An EW fullscreen app** (the "Connections" console, registered as a row in the `apps` sheet): a site admin connects a site by supplying an AEM Admin API key, issues and revokes per-site relay credentials, sees whether polling is healthy, and sees recent deliveries. It talks to the relay with the IMS token the SDK provides.
- **A Zapier app** (private, invite-only to start): authentication with the relay credential; instant (REST Hook) triggers Page Published, Page Previewed, Page Updated; actions Create Page from Template, Preview Page, Publish Page. The README lists what Zapier public app review needs and which of those items are open.

The behaviour a user sees: connect a site once in EW, copy a credential into Zapier, build a Zap in the Zapier editor, and within about a minute or two of a page being published in EW the Zap runs. Actions run with that site's Admin API key and nothing else.

## User Stories

Content team lead / Zapier user:

1. As a content team lead, I want a Zap to start when a page is published in EW, so that I can announce it in Slack without anyone remembering to.
2. As a content team lead, I want a Zap to start when a page is previewed, so that reviewers are notified that a page is ready.
3. As a content team lead, I want a Zap to start when a page's content is updated, so that downstream tools (translation, SEO audit, search index) stay in sync.
4. As a content team lead, I want a Zap to create a page from a template path, so that a form submission or CRM record can open a new page ready for authors.
5. As a content team lead, I want a Zap action that previews a page, so that automation can refresh the preview after an upstream change.
6. As a content team lead, I want a Zap action that publishes a page, so that an approval in another tool can publish content.
7. As a Zapier user, I want the triggers to be "Instant", so that the Zap runs within about a minute of the change instead of waiting for Zapier's polling interval.
8. As a Zapier user, I want to see realistic sample data when I set up a trigger, so that I can map fields before any real event has happened.
9. As a Zapier user, I want each trigger result to include the page path, the preview and live URLs, the user who acted and the time, so that my next Zap step has useful data.
10. As a Zapier user, I want to filter a trigger by path prefix (for example `/blog/`), so that only the section I care about starts the Zap.
11. As a Zapier user, I want turning a Zap off to stop deliveries, so that I am not billed tasks or surprised by events from a Zap I disabled.
12. As a Zapier user, I want the same event never to run my Zap twice, so that Slack does not get duplicate messages.
13. As a Zapier user, I want plain-language errors from actions (page already exists, template not found, publish not permitted), so that I can fix my Zap without reading logs.
14. As a Zapier user connecting an account, I want one credential per EW site and a connection label showing `org/site`, so that I can tell connections apart.
15. As a Zapier user with several EW sites, I want to create one Zapier connection per site, so that each Zap only touches the site I chose.

Site admin (EW):

16. As a site admin, I want an app inside EW to connect my site, so that I do not run any infrastructure myself.
17. As a site admin, I want the app to tell me exactly which kind of Admin API key to create and which role it needs, so that I can do it without guessing.
18. As a site admin, I want the connection step to validate the key before saving it, so that I learn about a wrong key or wrong site immediately.
19. As a site admin, I want to issue a relay credential, see it exactly once, and copy it, so that I can paste it into Zapier.
20. As a site admin, I want to give a credential only the scopes it needs (events only, or events plus page actions, or actions only), so that a leaked read-only credential cannot publish.
21. As a site admin, I want to list credentials (label, scopes, created, last used) and revoke one, so that I can cut off a lost or retired integration immediately.
22. As a site admin, I want to see connection health (last successful poll, lag, last error, Admin key expiry), so that I find out before users do that automation has stopped.
23. As a site admin, I want a warning when the Admin API key is close to expiry, so that I can rotate it before everything silently stops. [VERIFIED: Admin API keys expire; default 365 days, `expiresIn` up to 31,536,000 seconds, https://www.aem.live/docs/admin.html (apiKeyConfig)]
24. As a site admin, I want to replace the stored Admin API key without losing subscriptions or credentials, so that rotation is routine.
25. As a site admin, I want to disconnect a site and have the relay delete the stored key, credentials and subscriptions, so that I can leave cleanly.
26. As a site admin, I want to see the active subscriptions and recent delivery outcomes (delivered, retrying, failed, subscriber gone), so that I can debug a Zap that "did not fire".
27. As a site admin, I want to restrict which path prefixes the relay watches for updates, so that a very large site does not exhaust the scan budget.
28. As a site admin, I want to understand in the README exactly what the relay can do with my Admin API key, so that I can make an informed security decision.

Maintainer / operator:

29. As the maintainer, I want the relay to be vendor-neutral (events and REST hooks, not Zapier-specific), so that #8 (Make) and #9 (n8n) reuse it without changes to the core.
30. As the maintainer, I want the polling interval and de-duplication rules documented and enforced by tests, so that "once per subscriber" is a tested property and not a hope.
31. As the maintainer, I want a crash or overlapping cron run never to cause duplicate deliveries, so that Cloudflare's scheduling behaviour cannot break correctness.
32. As the maintainer, I want one slow or failing subscriber never to delay others, so that one bad Zap cannot stall the relay.
33. As the maintainer, I want subscribers' URLs validated against an allowlist and HTTPS-only, so that the relay cannot be turned into a request-forgery tool.
34. As the maintainer, I want the stored Admin API keys encrypted with a key held only in the worker secret store, so that a database leak alone does not leak site keys.
35. As the maintainer, I want the Admin API key never returned by any route and never logged, so that the only way to use it is through the relay's own code paths.
36. As the maintainer, I want relay credentials stored only as hashes, so that a database leak does not leak working credentials.
37. As the maintainer, I want unauthenticated calls to every relay route to be rejected, so that the relay is never a free API for the internet. (Ticket #7 AC9.)
38. As the maintainer, I want the relay to degrade gracefully when the Admin API rate-limits (10 requests per second per project) or errors, so that polling never hammers a site. [VERIFIED limit: https://www.aem.live/docs/limits#admin-api-limits]
39. As the maintainer, I want the Zapier app in the same folder as the relay, with its own tests and README, so that the extension stays self-contained. (AC6.)
40. As the maintainer, I want a README checklist of what Zapier public review requires, so that going public is a known list of tasks and not a surprise. (AC5.)
41. As the maintainer, I want the relay and Zapier app tested without a Zapier account, Slack or a real EW site in CI, so that regressions are caught automatically; and a manual script for the live Zap. (AC4, AC10.)
42. As the maintainer, I want the repo README extensions table to list this extension, so that it is discoverable. (AC7.)

EW end user:

43. As a content author, I want publishing from EW (sidekick or editor) to behave exactly as before, so that the connector never changes how I work.
44. As a content author, I want the console to render everything as text and never show a key or token after I submit it, so that screen sharing the app is safe.

## Implementation Decisions

(No file paths or code. Layout and contract shapes are in the Build Analysis.)

**Event model and detection**

1. **Four event types, two detection sources.** `page.previewed`, `page.published`, `page.unpublished` come from the AEM Admin API `log` endpoint (a successful `preview` or `live` operation); `page.updated` comes from the page's source last-modified time changing. The log is documented as "logs for a project" with `route`, `method`, `status`, `path` or `paths`, `user`, `timestamp` per entry [VERIFIED: https://www.aem.live/docs/admin.html (getLogs example)]. The examples show `POST` on `preview` and `live`; that `DELETE` operations (unpublish, preview delete) also appear is [ASSUMPTION], to be proven by build-plan spike S4. If `DELETE` on `live` is not logged, `page.unpublished` falls back to detection by absence in a live listing and the spec's AC1 mapping stays the same with a different detector.
2. **`page.updated` is defined as "the page's source last-modified time moved forward"**, not "a preview operation happened". This keeps `updated` distinct from `previewed` and matches what authors mean by "someone edited the page". A brand-new page is reported as `page.updated` with `change = created`. Deletions are not reported (out of scope).
3. **Update detection is a rotating scan, not a recursive crawl.** The hlx6 source folder listing returns one folder at a time with `last-modified` per file [VERIFIED: https://www.aem.live/docs/api.html, listSourceFolder]. The relay keeps a per-site table of last-seen modification times and a rotating folder cursor; each scan tick processes a bounded number of folders, so a full pass over the site takes ceil(folders / budget) ticks. First pass records a baseline and emits nothing. The budget, the watched path prefixes and the scan interval are per-site settings with documented defaults and bounds.
3a. **Detection strategy is an interface with per-site capability.** For sites on the new Admin API (hlx6) the strategy above works with an Admin API key. For sites still on the legacy Admin API the DA source listing (`admin.da.live/list`) needs a user-grade IMS token (DA verifies a real IMS user via `/ims/profile/v1` and ACLs by email and groups [VERIFIED: `adobe/da-admin` `src/utils/auth.js`]), which a headless relay does not have. Legacy-site behaviour is therefore a documented limitation until the owner decides otherwise (Open Question 2): the relay still delivers preview/publish/unpublish from the legacy `log` endpoint, and reports `page.updated` as unsupported for that site in the console and in `GET /v1/me`.
4. **Polling cadence.** One Cloudflare Cron Trigger, every minute (the minimum). Each tick polls the log for every connected site that is due; a site's log is polled every tick (default 1 minute), source scans run at the per-site scan interval (default 5 minutes, bounds 1 to 60). Documented detection latency target: events appear to subscribers within about two minutes (p95) for log events and within scan interval plus one tick for `updated`. [ASSUMPTION: the log endpoint returns operations within seconds; measured in spike S4.] Cron Triggers run on UTC time, can be missed during propagation, and may start late [VERIFIED: https://developers.cloudflare.com/workers/configuration/cron-triggers/], so correctness never depends on tick regularity.
5. **Overlapping windows, never a moving gap.** Each log poll asks for `from = last confirmed cursor minus an overlap` (default 2 minutes) and pages until exhausted; correctness comes from de-duplication, not from perfect windows. Entries older than the overlap that first show up late are a documented loss window.
6. **De-duplication is a ledger, in two layers.** (a) Event identity: a deterministic event id (hash of site, type, path, operation timestamp, and for `updated` the new last-modified) with a uniqueness constraint, so the same log entry seen in overlapping polls becomes one event. (b) Delivery identity: one delivery row per (event, subscription) with a uniqueness constraint, so a replayed tick cannot create a second delivery. A site lease prevents concurrent ticks from polling the same site; if the lease is lost, the ledger still prevents duplicates.
7. **"Once" is defined precisely.** The relay delivers each event once per subscription as long as the subscriber acknowledges with a 2xx. If a delivery attempt ends ambiguously (timeout after the subscriber may have processed it) the relay retries, so under that failure the event can arrive twice. Every payload carries a stable `id` so consumers can de-duplicate; the README says so. [OPEN: owner confirms this reading of AC1, Open Question 6.] Zapier's de-duplication guide describes polling triggers only (unique `id`, reverse-chronological order) [VERIFIED: https://docs.zapier.com/integrations/build/deduplication.md]; the REST Hook guide does not mention de-duplication, so the relay must not rely on Zapier to drop repeats [ASSUMPTION].
8. **Retry and failure policy for deliveries.** Delivery is driven by an outbox: attempts at roughly 0, 1, 5, 30, 120 minutes (bounded, configurable), then the delivery is marked failed and surfaced in the console. HTTP 410 from the subscriber means "subscription gone": the relay deletes the subscription and stops delivering [VERIFIED: https://docs.zapier.com/integrations/build/hook-trigger.md, "410 response ... no longer active, and you should stop sending data"]. Repeated failure never blocks other subscriptions. The inline outbound-proxy retry from the template is not used for deliveries (a retry inside the same request would double-deliver on ambiguity and would not survive a restart).
9. **Subscribers' URLs are untrusted input.** A subscription's target URL must be HTTPS on port 443, with no credentials in the URL, no IP literal, host on a configured allowlist (default: Zapier's hook host; Make and n8n tickets add theirs). [ASSUMPTION: Zapier targetUrls are on `hooks.zapier.com`; to be confirmed in spike S6.] The relay never follows redirects on delivery.
10. **Retention.** Events are kept 7 days (enough for sample data and debugging), delivery metadata 30 days, nothing else. Events contain the acting user's email when the log has it; this is personal data (Open Question 13).

**Authentication and tenancy**

11. **Two caller classes, two auth schemes, one worker.** (a) *Admin routes*, called from the EW app with the user's IMS token, use the template's IMS check unchanged (bad or missing token gives 401 before anything else), plus the template's CORS allowlist. (b) *Connector routes*, called server to server by Zapier, authenticate with a relay credential. The template as specified (#2) only knows the IMS scheme, so this ticket depends on a template amendment: pluggable per-route-group authentication with the same invariants (auth before routing, 401 with `WWW-Authenticate`, no handler runs unauthenticated, fail closed). This is a requirement on #2, recorded as R-T1 below. Fallback if the owner prefers not to touch #2: this extension implements the connector authenticator locally and reuses the template's CORS, error, logging, redaction and proxy modules unchanged.
12. **Relay credentials.** 256 bits from a CSPRNG, shown once at issue time, stored only as a SHA-256 hash (adequate for high-entropy secrets), format with a recognisable prefix so leaks are greppable. Each credential belongs to exactly one `{org}/{site}`, has a label and scopes (`events:read`, `pages:create`, `pages:preview`, `pages:publish`), can be revoked instantly, and records last-used time. Every connector request resolves org and site from the credential, never from the URL or body; this is the mechanism behind "actions run with that site's permissions only" (AC3).
13. **Connector routes are not browser routes.** A connector request that carries an `Origin` header is refused (403): Zapier calls from its servers, and refusing browser origins means a leaked credential cannot be exercised from a web page. [ASSUMPTION: Zapier's server-side requests carry no `Origin`; observed in spike S6 and exercised by manual step M5.]
14. **Who may manage a site (admin routes).** The IMS token identifies a person, not authority over a site. Rule: a caller may manage a site connection if they are the user who connected it, or they present a currently valid Admin API key for that exact site (which proves authority and which the relay checks against the Admin API's `log` endpoint). The first connection requires a valid key by definition. A stronger rule (probe the user's own rights with their IMS token against the Admin API) depends on whether `admin.hlx.page` accepts an IMS bearer token for config reads; the DA client attaches `Authorization: Bearer <IMS>` to Admin API origins [VERIFIED: `adobe/da-live` `blocks/shared/utils.js`, `AEM_ORIGINS`], but I could not confirm that the Admin API authorises it for config operations [ASSUMPTION; spike S1]. Open Question 8.
15. **Site Admin API key handling.** The key is entered by the admin in the EW app (they create it themselves following the README, role `publish`: includes `log:read`, preview and live write [VERIFIED: https://www.aem.live/docs/authentication-setup-authoring, role table]). The relay validates it with a real `log` call, encrypts it (authenticated encryption, key from the worker secret store, key id recorded so rotation is possible), and uses it only for outbound calls to the Admin API hosts via the template's proxy helper. It is never returned, never logged, and is deleted on disconnect. The one-click "create the key for me" flow is deliberately not in this ticket (Out of Scope).
16. **No Adobe credentials ever reach the browser, and no relay secret does either beyond the one-time credential display.** The EW app sends the IMS token to the relay and pastes the Admin API key once; after submit the page clears the field and never renders it again. AC9.

**Actions**

17. **Create page from template** copies an existing page at a template path to a new path using the hlx6 source copy operation, authorised by the key's `preview:write` permission [VERIFIED: https://www.aem.live/docs/api.html, putSourceDocument: "When the `source` query parameter is provided, copies the document ... `collision` ... `overwrite` or `unique`"]. Default collision behaviour is "fail with a clear conflict error"; `unique` is selectable. It does not preview or publish. On legacy sites the action returns a documented "not supported for this site" error (same capability gap as 3a).
18. **Preview page** and **Publish page** call the Admin API preview and live operations. Publish defaults to previewing first, because publish copies the preview partition to live [VERIFIED: https://www.aem.live/docs/admin.html, publishResource]; an unpreviewed page would otherwise fail. [OPEN: owner confirms this default, Open Question 10.]
19. **Paths are validated before any outbound call**: leading slash, no traversal segments, no double slashes, no encoded separators, length cap (the full path of a document should not exceed 900 characters [VERIFIED: https://www.aem.live/docs/limits#document-naming-restrictions]), name characters normalised by the Admin API are accepted as input and reported back as the resulting path.
20. **Admin API errors are mapped, not passed through**: 401/403 from the Admin API (expired or insufficient key) become a relay error telling the admin to rotate the key; 404 and 409 become specific user-facing codes; 429 and 5xx use the template's retry helper (the Admin API is rate limited to 10 requests per second per project [VERIFIED limits page]) and then map to 429/502.

**Zapier app**

21. **Zapier integration type: private first.** Starts as a private integration shared by invite link or by email invite. Limits as stated by Zapier: the private-vs-public page says up to 100 users can be invited by email (no limit with a public link, which cannot be revoked once accepted), while the sharing page says "You can only invite 200 users by email"; the two pages disagree, so the README must not state a number [VERIFIED discrepancy: https://docs.zapier.com/integrations/quickstart/private-vs-public-integrations.md vs https://docs.zapier.com/integrations/manage/sharing.md]. Private-integration rate limit: 100 calls per 60 seconds on Free and Professional integration-owner plans, 5000 on Team and Enterprise [VERIFIED: first page above]. Email invites are preferred over the public link because only they are revocable.
22. **Authentication: Zapier "API key" type** with one field (the relay credential), sent as a bearer header; a test request (`GET` "who am I") returns org, site and scopes; connection label shows `org/site`. OAuth v2 would be the preferred scheme for public listing (Zapier recommends it [VERIFIED: https://docs.zapier.com/integrations/publish/integration-build-guidelines.md, Authentication]) but requires the relay to be an OAuth server tied to EW sign-in; deferred and listed in the public-review checklist.
23. **Triggers are REST Hooks** (Zapier marks them Instant): subscribe posts the event type, the Zapier `targetUrl` and an optional path prefix and stores the returned id; unsubscribe deletes by that id; the hook payload is the event envelope; a "perform list" returns recent events in the same schema (required for public listing, optional for private [VERIFIED: https://docs.zapier.com/integrations/build/hook-trigger.md]). Static webhooks are not used (not allowed in public integrations [VERIFIED same]). Date-times are ISO 8601 with offset, not epoch [VERIFIED: https://docs.zapier.com/integrations/publish/integration-build-guidelines.md, Response content].
24. **Actions** (create page from template, preview page, publish page) map 1:1 to relay connector routes and translate relay error codes into Zapier error messages in English.
25. **The relay is connector-agnostic.** Nothing in the event envelope, subscription API or credential model names Zapier; Make (#8) and n8n (#9) use the same endpoints, with their own entries in the subscriber-host allowlist.

**Platform and repo**

26. **Storage: Cloudflare D1** for site connections, credentials (hashed), subscriptions, events, deliveries, last-seen modification times and leases. Reasons: relational uniqueness gives the de-duplication ledger directly, one binding, simple migrations, free tier workable for a prototype (5 million rows read and 100,000 rows written per day on Workers Free [VERIFIED: https://developers.cloudflare.com/d1/platform/pricing/]). Alternative considered: Durable Object per site (serialised polling for free, SQLite inside); not chosen because the fan-out across sites and the admin queries are simpler on one SQL database [ASSUMPTION; Open Question 15]. The template (#2) lists KV/D1/cron as out of scope; this ticket adds a D1 binding and a cron trigger to this extension's worker only, recorded as R-T3.
27. **Workers plan.** Free plan limits per cron invocation are 10 ms CPU and 50 subrequests; Paid allows 30 seconds CPU (cron under one hour interval) and 10,000 subrequests [VERIFIED: https://developers.cloudflare.com/workers/platform/limits/]. A poller doing per-site Admin API calls, D1 queries and subscriber deliveries will not fit the free cron budget beyond a trivial number of sites. Decision: target Workers Paid and say so in the README; the test workspace run (AC4) may fit Free if limited to one site [ASSUMPTION; measured in smoke test SM4]. Open Question 4.
28. **Folder layout.** Per the owner convention: everything in `apps/automation-connectors/`; relay in `worker/`; Zapier app in `providers/zapier/` (vendor follow-ups #8 and #9 add `providers/make/` and `providers/n8n/`); the EW app entry page, JS, CSS, README and tests at the folder root. Type per the config sheet: the row in the `apps` sheet makes it a fullscreen app; the extensions table row says `app`.
29. **The extension reads no EW site config.** It reads the EW SDK `context` for default org/site values only. Per-site relay settings (watched prefixes, scan interval) live in the relay's database and are edited in the console. README says so (AC6).
30. **Org and site in the console are inputs, not trusted context.** The EW app URL carries the org/site that *hosts the extension code*; for a customer using this extension from a different org, the site to connect is a form field prefilled from `context` [VERIFIED mapping: `apps/hello-world/SPEC.md` section 2.3]. The relay's CORS allowlist (template: `https://da.live` and the extension host site's own origins) is configured by the host org/site and is unrelated to the customer site being connected. [OPEN: Open Question 14 on running the relay for third-party hosts.]
31. **Vendor credentials live only in the relay** (AC9): the Admin API keys (per site, encrypted in D1), the key-encryption secret, and the optional subscriber-host config. The Zapier app holds none of them; it holds only the user's relay credential inside Zapier's own censored credential store [VERIFIED: https://docs.zapier.com/integrations/build/apikeyauth.md, "automatically censored at runtime"].

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given requests and a fake outside world (fake Admin API, fake subscriber, fake clock, fake IMS), assert responses, the outbound requests the relay made (count, target, headers, body), what is stored as a user-visible result (events delivered, subscriptions listed), and what is logged. Never assert on internal helper names, table layouts, or how many internal functions ran. Two properties are asserted as negatives across every path: "no secret (Admin API key, relay credential, key-encryption secret, IMS token) appears in any response, outbound request to a non-Admin host, or log line", and "no handler or outbound call happens before authentication succeeds".

**Proposed seams** (recorded instead of asked, per #45). Reused seams first; two new ones, both at the highest possible point; the worker's own boundary stays the single place the relay is tested.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 | Worker HTTP boundary: `worker.fetch(request, env, ctx)` | reused from #2 | Relay unit tests for admin routes and connector routes | Constructed `Request`; env factory; injected fetch/clock; fake IMS from the #2 test kit; fake Admin API and fake subscriber as scripted fetch handlers |
| R1 | **Relay tick**: `worker.scheduled(controller, env, ctx)` run against a fake clock | **new** (sibling of W1: same worker, the other entry point) | Detection, de-duplication, cadence, delivery and retry tests | Same fakes plus a controllable clock; assertions on what the fake subscriber received and on what `GET` routes then show |
| R2 | Store contract: one behavioural suite run against an in-memory store and against real D1 | **new** (but only as a conformance check, not a place logic is tested) | Unique-constraint, lease, retention semantics | In-memory implementation in unit tests; local D1 in the smoke tier |
| Z1 | Zapier app boundary: the integration's triggers/actions invoked through `zapier-platform-core`'s app tester with a bundle | **new** | Zapier app unit tests | HTTP faked at the request layer; golden fixtures shared with the relay tests (contract) |
| S1 | Entry page + SDK module boundary | reused from #1 | Playwright e2e of the EW console | #1's SDK stub (token a test-signed IMS-shaped JWT); real relay in `wrangler dev` (as #2's E2E tier) |
| S2 | Render/logic module + SDK result | reused from #1 | WTR unit tests of the console | Injected fetch; hand-built SDK result |
| S3 | Repo convention check | reused from #1/#2 | CI lint job | Temp-dir fixtures |
| W2 | Same worker in the real workers runtime | reused from #2 | Smoke tier | `wrangler dev` local, fake Admin API and subscriber as local Node servers |

Why R1 is the primary new seam: detection, de-duplication, cadence and delivery are all properties of "what a tick does given the world and the clock", and the ticket's hardest requirement (once per subscriber, documented interval) can only be proven there. Why Z1 exists: the Zapier app is a separate runtime and package; the contract with the relay is a JSON shape, so the relay's golden fixtures are the shared artefact that keeps them from drifting. The live Zapier cloud and Slack are covered only by manual verification.

**Modules tested:** log-to-event mapper, source scan, event ledger and dedupe, subscription registry and URL validation, delivery outbox and retry, connector authenticator and scopes, admin authority rule, key vault (encrypt/decrypt, redaction), Admin API client (legacy and hlx6 modes), page actions, console render/bootstrap, Zapier auth/triggers/actions, repo checks.

**Prior art.** Hello-world and worker-template specs (this repo): seams S1-S3 and W1-W2, test kit (fake IMS, fake upstream, env factory, canary secret), WTR and `node:test` split. Upstream `adobe-rnd/ew-extensions` has no worker or connector tests; its injection pattern (`fetchImpl`, `storage`, `now`) is the model [https://github.com/adobe-rnd/ew-extensions/blob/main/tools/brand-visibility/session-auth.js]. Zapier's own `zapier-platform-core` app tester and `zapier-platform validate` for the Zapier package [https://docs.zapier.com/integrations/build-cli/testing-and-debugging.md; command list https://github.com/zapier/zapier-platform/blob/main/packages/cli/docs/cli.md].

## Out of Scope

- Make app (#8) and n8n node (#9): only the relay seams they need (vendor-neutral events, REST-hook API, per-connector host allowlist).
- Zapier public listing itself (submission, Zapier review, OAuth v2, Zap templates, branding assets). The README checklist (AC5) is in scope; passing review is not.
- A "create the Admin API key for me" flow in the EW app (it needs IMS-bearer acceptance by the Admin API, spike S1) and any use of the signed-in user's token by the relay.
- Headless write access to DA content on legacy-API sites (service accounts, technical-account IMS tokens): reported as a capability gap, not built (Open Question 2).
- Events beyond the four listed (page deleted, page created as a distinct event, media, config, code, snapshot, job events), and any non-page resource.
- A Zapier "Find page" search, "Update page content" action, and an "Unpublished" trigger in Zapier (the relay already emits `page.unpublished`; exposing it in Zapier is a one-trigger addition if the owner wants it, Open Question 11).
- Payload signing for receivers, per-credential rate limiting and lockout (listed as hardening options in Further Notes), multi-region relays, EU data residency.
- Instant (sub-minute) detection: not possible with the pull sources found.
- Running the relay for third-party hosting orgs and a hosted multi-tenant SaaS posture (billing, support, SLAs).
- The Adobe outside-activity/IP policy and security review for a service that stores customers' Admin API keys (flagged, owned by #1 R1 and Open Question 3).

## Further Notes

- **Admin API site not registered yet.** `GET https://admin.hlx.page/log/jazhou-adobe/ew-extensions/main` returned `404` with `x-error: [admin] config for site not found: jazhou-adobe/ew-extensions` on 2026-11-16. That confirms #1 prerequisite R3/R10 (Code Sync, site registered in the Configuration Service) is still pending; nothing in this ticket can be verified against a real site until it is done. [VERIFIED by command.]
- **Two Admin API generations.** The legacy `admin.hlx.page` API and the new `api.aem.live` service coexist; DA's own client routes per site using an `x-api-upgrade-available` header from `GET admin.hlx.page/ping/{org}/{site}` [VERIFIED: `adobe/da-nx` `nx2/utils/api.md`, "hlx6 detection"]. The meaning of that header for a specific site (upgraded vs upgrade possible) was not confirmed; `ping` for `adobe/da-live` returned 200 with no such header on 2026-11-16 [VERIFIED observation]. Spike S2 settles detection.
- **Log retention and latency are undocumented.** The `getLogs` docs describe the `from`, `to`, `since` and `nextToken` parameters (default `from` = now minus 15 minutes) and, in the new API, up to 1000 entries per page, but not how long entries are kept or how soon after an operation they appear [VERIFIED docs; OPEN gap]. Spike S4 measures latency; the 2-minute overlap and 7-day event retention are chosen to be conservative.
- **A user's own session is not involved.** All polling and actions use the stored Admin API key; the acting user in an event is whoever the log recorded (for example the sidekick user), not the connector's user.
- **Hardening backlog (not built):** HMAC-signed deliveries with a per-subscription secret (Zapier does not verify signatures; its model is an unguessable target URL, and it does not support Identity Confirmation for hook subscriptions [VERIFIED: https://docs.zapier.com/integrations/build/cli-hook-trigger.md]), failed-credential lockout, per-credential rate limits (Cloudflare's rate-limit binding is approximate per location [VERIFIED per #2]), GitHub secret scanning for the `ewr_` prefix.
- **Comparable behaviour.** Contentful's Zapier app uses the same trigger and action vocabulary the ticket cites (published/updated entry; create/publish entry) [VERIFIED link above]; this spec maps "entry" to "page" and "publish entry" to the Admin API publish.
- `apps/automation-connectors/SPEC.md` is a planning artefact; keep or delete it when the extension is built, as decided for the hello-world spec [OPEN, low stakes].

---

# Build Analysis

## 1. Architecture and responsibilities

```
 EW (da.live)  ── iframe ──►  EW app "Connections console"  (static, public; origin {ref}--ew-extensions--jazhou-adobe.aem.live | preview.da.live | localhost:3000)
                                 │  SDK: IMS token, context       Authorization: Bearer <IMS>  (CORS preflight; template allowlist)
                                 ▼
 ┌──────────────────────────────────── Relay (Cloudflare Worker, built from shared/worker-template) ───────────────────────────────────┐
 │  fetch():  admin routes (IMS auth)      connector routes (relay-credential auth, no Origin allowed)                                   │
 │  scheduled() every minute:  for each due site → poll log → scan source (budget) → ledger → outbox → deliver to subscribers           │
 │  D1: sites, admin_keys(enc), credentials(hash), subscriptions, events, deliveries, seen_modified, leases                               │
 │  Secrets: KEY_ENCRYPTION_KEY  (+ IMS config as vars)                                                                                   │
 └──────────────┬───────────────────────────────────────┬──────────────────────────────────────────┬────────────────────────────────────┘
                │ Admin API key (stored, per site)       │ event POST (https, allowlisted host)      │ requests from Zapier servers
                ▼                                        ▼                                           ▲
   AEM Admin API: admin.hlx.page (legacy)            Zapier hook URL (hooks.zapier.com)      Zapier private app (providers/zapier)
                  api.aem.live (hlx6)                (Make / n8n later)                          triggers: REST Hook; actions: create/preview/publish
```

Responsibility split:

| Concern | EW app (browser, public static) | Relay (worker, holds secrets) | Zapier app (Zapier's runtime) |
|---|---|---|---|
| Admin API key | form field, sent once, never shown again | validates, encrypts, stores, uses, never returns | never sees it |
| Relay credential | shows once at issue; lists metadata only | generates, stores hash, authenticates | stores in Zapier's censored auth store |
| Detection and dedupe | none (shows status) | all | none |
| Delivery | none | all (outbox, retry, 410 handling) | receives and maps the payload |
| Page actions | none | validates paths, calls Admin API | forwards user inputs |
| IMS token | sent to relay | verified by template | not involved |
| UI | console | none | Zap editor fields |

## 2. EW integration points

- **Type: fullscreen app** (a row in the `apps` sheet; no library plugin is needed). Registration: `https://da.live/config#/{org}/{site}/` apps sheet row with `title` "Automation Connectors", `description`, `path` the full `https://da.live/app/{org}/{site}/apps/automation-connectors/automation-connectors` URL; `ref` blank (semantics undocumented for apps, #1 R11) [VERIFIED mechanism: https://www.aem.live/docs/ew/developing/apps-plugins, per #1 spec 2.5]. The README gives the exact row and notes the trust prompt on first open.
- **SDK actions used:** none beyond `token` and `context` from the SDK result. No `sendText`/`closeLibrary`. [VERIFIED SDK result shape per #1 spec 2.1.]
- **Which org/site is context:** the iframe is served from the extension host site named in the app URL, not the customer site (see Decision 30). The form is prefilled from `context.org`/`context.repo`; the admin can change it.
- **`ref=local`:** page at `http://localhost:3000`, local relay at `http://localhost:8787` (`wrangler dev`), local D1, fake or real Admin API; branch ref pages call the deployed relay's `workers.dev` URL. Same rule as #2 Decision 13: the relay origin is a constant in the page, never taken from the URL.
- **CORS for the console:** the template allowlist. Allowed origins are `https://da.live` and `https://{ref}--{host-site}--{host-org}.{aem.live | aem.page | preview.da.live}` for the *extension host* org/site; `localhost:3000` only in the local env [VERIFIED per #2 Decision 5].
- **No EW config read:** see Decision 29.
- **Reachable from host:** apps card appears at `https://da.live/apps#/{org}/{site}` after the sheet row is saved; also directly at the app URL [per #1 M3].

## 3. External APIs and auth flows

| API | Use | Auth | Source / status |
|---|---|---|---|
| Admin API log (legacy) `GET https://admin.hlx.page/log/{org}/{site}/{ref}` with `from`, `to`, `since`, `nextToken`; response `{from,to,entries[],nextToken,links.next}`; entry fields seen in examples: `timestamp` (epoch ms), `route`, `method`, `status`, `path` or `paths[]`, `user`, `duration`, `contentBusId`, `owner`, `repo`, `ref`, or `event` for custom entries | detect preview/live operations | `authorization: token <API key>` or `x-auth-token`; permission `log:read`, roles `author` and above | [VERIFIED] https://www.aem.live/docs/admin.html ; key header forms https://www.aem.live/docs/admin-apikeys ; role table https://www.aem.live/docs/authentication-setup-authoring. Which DELETE operations appear in the log: [ASSUMPTION], spike S4 |
| Admin API log (hlx6) `GET https://api.aem.live/{org}/sites/{site}/log` with `from`,`to`,`since`,`limit` (max 1000, default 1000),`nextToken` | same | same schemes | [VERIFIED] https://www.aem.live/docs/api.html |
| Admin API preview: legacy `POST /preview/{org}/{site}/{ref}/{path}`; hlx6 `POST /{org}/sites/{site}/preview/{path}` | Preview action | key; `edit:read`, `preview:read`, `preview:write` | [VERIFIED] both docs above. Works with an API key against DA-authored content: [OPEN], spike S5 |
| Admin API publish / unpublish: legacy `POST/DELETE /live/{org}/{site}/{ref}/{path}`; hlx6 `/{org}/sites/{site}/live/{path}` | Publish action (and the operations the log records) | key; `preview:read`, `live:read`, `live:write` (publish) | [VERIFIED] both docs |
| hlx6 source copy `PUT /{org}/sites/{site}/source/{path}?source=<abs path>&collision=overwrite|unique` | Create-from-template | key; `preview:write` | [VERIFIED] https://www.aem.live/docs/api.html (putSourceDocument); responses 200 `{copied:[{src,dst}]}`, 201, 404, 409 (conflict) |
| hlx6 source listing `GET /{org}/sites/{site}/source/{folder}/` → `[{name,size,content-type,last-modified}]` (folders `content-type: application/folder`); `GET .../preview/` listing is paginated with `limit`/`cursor` and `lastModified` | update detection scan | key; `preview:read` | [VERIFIED] https://www.aem.live/docs/api.html. Folder listing response shape differs between the two listing operations in the spec; spike S3 confirms the one used |
| Admin API ping `GET admin.hlx.page/ping/{org}/{site}` header `x-api-upgrade-available` | detect legacy vs hlx6 | none | [VERIFIED as DA's detection method] `adobe/da-nx` `nx2/utils/api.md`; semantics for a site [ASSUMPTION], spike S2 |
| Admin API keys (user creates): `POST /config/{org}/sites/{site}/apiKeys.json` body `{description, roles:["publish"], expiresIn}`; response `{id, value, created, expiration}`; value shown once, never stored by Adobe | the admin makes the key following the README | admin role (`config:write`) | [VERIFIED] https://www.aem.live/docs/admin-apikeys , https://www.aem.live/docs/admin.html. For hlx6 sites the new API's site-config property endpoint is the documented route [https://www.aem.live/docs/api.html]; exact key-creation call: [OPEN] |
| Admin API limits | design polling budget | n/a | [VERIFIED] 10 requests per second per project; 429 on throttle; bulk jobs for large operations; https://www.aem.live/docs/limits |
| DA List `GET https://admin.da.live/list/{org}/{site}/{path}` → `[{path,name,ext,lastModified(ms)}]`, empty array for empty or missing, 401 empty body | not used by the relay (needs a user IMS token) | `Authorization: Bearer <IMS>` | [VERIFIED] https://docs.da.live/developers/api/list ; user-grade token requirement: `adobe/da-admin` `src/utils/auth.js` |
| Zapier REST Hook trigger contract: subscribe request carries `bundle.targetUrl`, response stores `subscribeData`; unsubscribe by stored id; 410 from the hook means stop; hook limits 30 webhooks/second and 10,000 per 5 minutes; payload up to 10 MB; perform list required for public | trigger design | n/a | [VERIFIED] https://docs.zapier.com/integrations/build/hook-trigger.md ; https://docs.zapier.com/integrations/build-cli/overview.md ; limits https://docs.zapier.com/integrations/build/operating-constraints.md |
| Zapier API-key auth, test request, censored fields; connection label | per-site credential | n/a | [VERIFIED] https://docs.zapier.com/integrations/build/apikeyauth.md , https://docs.zapier.com/integrations/build/connection-label.md |
| Zapier private sharing: invite link or email; Zapier CLI `register`, `push`, `validate`, `test`, `users:add`, `users:links`, `promote`, `migrate`; Node 22 | ship the private app | Zapier deploy key (`zapier-platform login`) | [VERIFIED] https://docs.zapier.com/integrations/manage/sharing.md ; https://github.com/zapier/zapier-platform/blob/main/packages/cli/docs/cli.md ; https://docs.zapier.com/integrations/build-cli/overview.md |
| Zapier public review requirements | README checklist (AC5) | n/a | [VERIFIED] https://docs.zapier.com/integrations/publish/integration-publishing-requirements.md ; https://docs.zapier.com/integrations/publish/integration-build-guidelines.md |
| Cloudflare Cron Triggers (`triggers.crons`, `scheduled` handler, `* * * * *` allowed, UTC, propagation up to 15 minutes, 15-minute wall time) | tick | n/a | [VERIFIED] https://developers.cloudflare.com/workers/configuration/cron-triggers/ ; https://developers.cloudflare.com/workers/wrangler/configuration/ ; https://developers.cloudflare.com/workers/platform/limits/ |
| Cloudflare D1 (limits, pricing) | storage | binding | [VERIFIED] https://developers.cloudflare.com/d1/platform/limits/ ; https://developers.cloudflare.com/d1/platform/pricing/ |

**Auth flows.**
1. *Admin (EW app → relay):* SDK token → `Authorization: Bearer` → template IMS verification (unchanged from #2) → admin authority rule (Decision 14).
2. *Connect:* admin creates an Admin API key in the Admin API (outside this extension, steps in README) → pastes it into the console → relay validates with a `log` call using the key → stores encrypted → returns connection status.
3. *Issue credential:* admin chooses label and scopes → relay returns the credential value once.
4. *Connector (Zapier → relay):* credential → bearer header → relay resolves site and scopes by hash lookup → route.
5. *Relay → Admin API:* decrypt key in memory → `authorization: token <key>` via the template proxy (secret injected by the helper; redaction registered for the dynamic value, R-T2).
6. *Relay → subscriber:* HTTPS POST to the allowlisted URL; no credentials forwarded.

## 4. Data contracts

Behaviour contracts (shapes shown for precision; field names are the contract).

**Event envelope** (hook payload = items of `GET /v1/events`):

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable, unique per event; Zapier's primary key; deterministic hash |
| `type` | `page.previewed` / `page.published` / `page.unpublished` / `page.updated` | |
| `occurredAt` | ISO 8601 with offset | from the log timestamp or the new last-modified |
| `detectedAt` | ISO 8601 with offset | when the relay recorded it |
| `org`, `site`, `ref` | string | `ref` default `main` |
| `path` | string | web path, leading slash, no `.html` |
| `user` | string or null | from the log when present |
| `change` | `created` / `modified` / null | only for `page.updated` |
| `urls` | `{preview, live, edit}` | `https://{ref}--{site}--{org}.aem.page{path}`, `.aem.live`, `https://da.live/edit#/{org}/{site}{path}` [ASSUMPTION for the edit URL format, per #1 spec editor URLs] |
| `source` | `log` / `scan` | provenance |

**Connector API (v1; bearer relay credential; JSON; errors use the #2 error shape):**

| Route | Scope | Behaviour |
|---|---|---|
| `GET /v1/me` | any | `{org, site, label, scopes, capabilities:{updated, createPage}}` (Zapier auth test; connection label) |
| `POST /v1/hooks` `{event, targetUrl, pathPrefix?}` | `events:read` | `201 {id}`; idempotent per (credential, event, targetUrl); validates URL (Decision 9) |
| `DELETE /v1/hooks/{id}` | `events:read` | `204`; idempotent; other credential's id gives `204` (no existence leak) |
| `GET /v1/events?type=&limit=` | `events:read` | newest first, at most 50, same schema as hook payload; sample/perform-list |
| `POST /v1/pages` `{templatePath, path, collision?}` | `pages:create` | `201 {path, urls}`; `409 conflict`; `501 unsupported_for_site` (legacy) |
| `POST /v1/pages/preview` `{path}` | `pages:preview` | `200 {path, urls, status}` |
| `POST /v1/pages/publish` `{path, previewFirst?}` | `pages:publish` | `200 {path, urls, status}` |

**Admin API (IMS bearer; CORS):** `POST /v1/admin/sites/{org}/{site}/connect {adminKey, watchPaths?, scanIntervalMinutes?}` (validate + store); `GET /v1/admin/sites/{org}/{site}` (status: connected, `apiMode`, key expiry, last log poll, last scan, lag seconds, last error code, capabilities, counts); `PATCH` same (settings); `DELETE` same (disconnect + cascade); `POST .../credentials {label, scopes}` (returns value once); `GET .../credentials` (metadata); `DELETE .../credentials/{id}`; `GET .../subscriptions`; `GET .../deliveries?limit=` (recent outcomes, no payload bodies). Error codes extend the #2 set: `invalid_admin_key`, `admin_key_insufficient_role`, `site_not_connected`, `credential_scope`, `forbidden_origin` (connector routes with `Origin`), `unsupported_for_site`, `conflict`, `subscription_limit`, `bad_target_url`.

**Documented operational constants** (single source in code, echoed in README; asserted by a doc-consistency test): tick 1 minute; log poll each tick; scan interval default 5 min (1 to 60); overlap 2 min; scan budget per tick (default 20 folders, [ASSUMPTION]); event retention 7 days; delivery retention 30 days; retry schedule 0/1/5/30/120 minutes; max subscriptions per site (default 50); per-tick delivery cap per subscription (default 100).

**Relay configuration (vars):** `ORG`, `SITE` (extension host; CORS), `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS` (as #2); `SUBSCRIBER_HOSTS` (default Zapier hook host); `ADMIN_ORIGINS` (legacy and hlx6 hosts; tests point at fakes). **Secrets (`secrets.required`):** `KEY_ENCRYPTION_KEY`. No other secret exists; there is no vendor key: the per-site Admin API keys are data, not config.

**D1 tables (conceptual):** `sites(org, site, ref, api_mode, watch_paths, scan_interval, next_log_at, next_scan_at, cursor_ts, lease_until, status, last_error, connected_by)`, `admin_keys(site_id, ciphertext, nonce, kid, expires_at)`, `credentials(id, site_id, hash unique, prefix, label, scopes, created_at, last_used_at, revoked_at)`, `subscriptions(id, site_id, credential_id, event, target_url, path_prefix, created_at, state)`, `events(site_id, event_id, ... , unique(site_id, event_id))`, `deliveries(subscription_id, event_id, state, attempts, next_attempt_at, last_status, unique(subscription_id, event_id))`, `seen_modified(site_id, path, last_modified)`, scan cursor columns on `sites`.

## 5. Folder layout (proposed; fits the #1 convention and the #2 template)

```
apps/automation-connectors/
├─ SPEC.md                         this file
├─ README.md                       setup, config-sheet row, site config read (none), admin key how-to, Zapier private setup, public-review checklist (AC5, AC6)
├─ automation-connectors.html      EW app entry page (named after folder)
├─ automation-connectors.js        thin bootstrap (awaits SDK, wires fetch)
├─ automation-connectors-render.js side-effect-free render + logic (testable)
├─ automation-connectors.css
├─ test/unit/  test/e2e/           console tests (WTR, Playwright)
├─ worker/                         relay (from shared/worker-template/scaffold): wrangler config, entry (fetch + scheduled), routes, detection, ledger, outbox, vault, admin-api client, migrations/, .dev.vars.example, README, test/ (node:test), contract/ (golden fixtures)
└─ providers/zapier/               Zapier private app (own package.json, zapier-platform-core, tests, README)
```

Rules: `.hlxignore` must hide `**/worker/`, `**/providers/`, `**/test/` (the #1 spec hides `worker/` and tests; `providers/` is a new line because the Zapier package contains no site-served code); the S3 convention check treats `providers/<vendor>/` as sub-structure (#1). Contract fixtures live in `worker/contract/` and are read by `providers/zapier/` tests by relative path: a deliberate same-extension dependency, not cross-extension.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Adobe outside-activity / IP policy and security review.** A personally hosted service that stores customers' Admin API keys and proxies Adobe APIs is a much bigger exposure than #2's hello proof. Carries over #1 R1 and #2 R1. | High | [OPEN] README note; owner decides account, review and whether this ships beyond the owner's own test sites (Open Question 3). |
| R2 | **Legacy-site capability gap.** DA source operations need a user-grade IMS token; an Admin API key does not authorise DA; hlx6 sources do accept keys per the API. If the test site is legacy, `page.updated` and Create Page cannot work headlessly. | High (blocks AC1 `update` and AC2 create action for such a site) | Spikes S2, S3, S5 first; test workspace must be an hlx6 site, or the owner provides a technical-account approach (Open Question 2). |
| R3 | **Log content unverified:** DELETE operations (unpublish) in the log, bulk entries with `paths[]`, latency, retention, `user` presence on preview entries (example has no `user` on preview). | High for AC1 | Spike S4 with a real key; detector isolated behind the mapper so fixes are local; the contract fixtures record what is actually observed. |
| R4 | **Admin API behaviour with an API key on DA-authored content** (preview needs the content source; DA fetch normally carries the user's token in `x-content-source-authorization` from the DA client [VERIFIED header usage: `adobe/da-live` `blocks/shared/utils.js`]). | High for AC2 preview/publish actions | Spike S5. If it fails the Preview/Publish actions are blocked on legacy sites too; record in README and console capabilities. |
| R5 | **Template (#2) gaps:** pluggable auth, dynamic secret injection and redaction, cron + D1, delivery without inline retry (R-T1..R-T4 below). #2's spec is approved but unbuilt. | Medium | Treated as requirements; Open Question 5 decides amend-#2 vs local implementation. |
| R6 | **Cloudflare plan limits:** Free cron is 10 ms CPU, 50 subrequests; the poller likely needs Paid. | Medium | Target Paid; smoke test SM4 measures one-site cost; owner decision (Open Question 4). |
| R7 | **Duplicate/missed events:** overlapping cron runs, retries, clock skew, late log entries, ambiguous delivery. | High (core AC) | Ledger + lease + overlap (Decisions 5-8); tests DD1-DD6, DL1-DL6; documented loss window and ambiguity case. |
| R8 | **Request forgery via subscriber URLs.** | High | Decision 9; SB4 matrix. |
| R9 | **Admin key sprawl:** a stored `publish` key is powerful (it can publish and unpublish site content). Role is fixed at creation; the relay cannot narrow it. | High | Scopes on relay credentials; README tells admins to use the shortest practical expiry; encryption; console shows expiry; disconnect deletes. Least-privilege split (author key for read-only) is [OPEN]. |
| R10 | **Admin key expiry** silently stops polling. | Medium | Status shows expiry and `needs_attention`; polling backs off on 401/403; no subscriber spam; console banner. |
| R11 | **Admin API rate limit (10 rps/project) and scan cost** on large sites. | Medium | Per-tick budget, rotating cursor, prefix filters, backoff on 429; scan interval bounds. |
| R12 | **Zapier public review not achievable by a personal account for an Adobe API.** Zapier requires the integration owner to be associated with the API's company (email domain), an admin team member with the company's top-level domain, a non-expiring test account, production endpoints, and a publicly launched (non-beta) product [VERIFIED: https://docs.zapier.com/integrations/publish/integration-publishing-requirements.md sections 3.1, 5.1, 5.4, 7.1, 7.2]. Integrations on a public API the developer does not own are private-only. | High for public listing, none for private | README checklist; owner decides whether Adobe sponsors or the Zapier app stays private (Open Question 12). |
| R13 | **Branding/trademark**: Zapier forbids unlicensed trademarks and the name must match core branding [VERIFIED: sections 3.2, 6.1]. "Experience Workspace" and "Adobe" are Adobe marks. | Medium for public listing | Working name for private app: "EW Automation (private)"; final name is an owner/Adobe decision. |
| R14 | **Zapier private-app limits** (100 or 5000 calls per 60 s by owner plan; invite caps) and doc inconsistency on email-invite limits. | Low | Documented; live test uses 1 to 2 users. |
| R15 | **Personal data in events** (acting user email) flows to third parties. | Medium | Field is optional and documented; Open Question 13. |
| R16 | **Hidden coupling to undocumented behaviour:** `x-api-upgrade-available` semantics, `Origin` absence from Zapier servers, Zapier targetUrl host. | Medium | Spikes S2, S6; assumptions encoded as tests so drift is caught. |
| R17 | **D1 and cron under `wrangler dev` local mode in CI** (local D1 persistence, `--test-scheduled`) unverified. | Low-Med | [ASSUMPTION: `wrangler dev --test-scheduled` exposes a `/__scheduled` test endpoint; verify at smoke setup]; fallback: invoke `scheduled` through an exported test-only route only in the local env, with a repo check that the route is absent from production config. |
| R18 | **Node floor:** wrangler requires Node >= 22.12 (per #2); Zapier CLI requires Node 22 [VERIFIED: https://docs.zapier.com/integrations/build-cli/overview.md]. | Low | Pin Node >= 22.12 in CI for both. |

**Template amendment requirements** (inputs to Open Question 5):
- **R-T1** per-route-group authenticator hook with the same fail-closed pipeline guarantees (UA1, UA12 analogues).
- **R-T2** `proxy` accepts a dynamically supplied secret value (not only an env secret name), registers it with the redactor for that request, and accepts a host predicate in addition to a static `allowedHosts` list.
- **R-T3** scaffold support for a D1 binding, a cron trigger and a `scheduled` entry that gets the same request id, structured logging and redaction as `fetch`, with injectable clock; test kit gains an in-memory store helper pattern.
- **R-T4** a documented way to call out without the inline retry policy (used by deliveries).

**Spikes (build-plan step 1; results recorded in the README and the contract fixtures):**
- **S1** Does `admin.hlx.page` / `api.aem.live` accept `Authorization: Bearer <IMS token>` for config reads on a DA site? (Decides Decision 14 strength and the "create key for me" follow-up.)
- **S2** Detect legacy vs hlx6 for the test site (`ping` header meaning).
- **S3** hlx6 source listing shape and last-modified fidelity; legacy equivalent if any.
- **S4** Log: latency from sidekick publish/preview/unpublish to a log entry; shape for DELETE; `paths[]`; `user`; retention.
- **S5** Preview/publish/create-from-template with an API key against DA-authored content on the test site.
- **S6** Zapier hook URL host(s) from a real subscribe; whether Zapier server requests carry `Origin`.

## 7. Ordered build plan (sized to #7's acceptance criteria)

0. **Prerequisites (owner):** #1 and #2 landed (or the amendment decision made); Code Sync and site registration; a test EW site with the right API generation; Cloudflare account and plan decision; Zapier developer account; Slack test workspace; Open Questions 1 to 5 answered.
1. **Spikes S1 to S6** against the real test site with throwaway scripts (not committed); record results and golden fixtures (real log entries with identifiers scrubbed). Gate: if S4/S5 fail, stop and escalate before building detectors or actions.
2. **Relay core, test-first, via R1/W1:** store interface + in-memory store + D1 migrations (step 2a: store contract tests ST1-ST4); key vault; connector authenticator and scopes (CR); admin routes with authority rule (CN, CR6).
3. **Detection (AC1):** log mapper and pager (DT1 to DT5), event ledger and dedupe (DD1 to DD6), cadence (PI1 to PI3).
4. **Subscriptions and delivery (AC1):** registry and URL validation (SB1 to SB6), outbox, retry, 410 handling, isolation (DL1 to DL9), sample events route (EV1, EV2).
5. **Source scan (AC1 `update`):** scan with rotating cursor, baseline, budget (DT6 to DT9), capabilities reporting.
6. **Page actions (AC2 actions):** create/preview/publish with path validation and error mapping (AX1 to AX8).
7. **EW console (AC6, AC7, AC8, AC9):** render/bootstrap test-first (UI1 to UI9), entry page, CSS, then Playwright e2e (E2E1 to E2E4).
8. **Zapier app (AC2, AC3, AC4):** auth, three triggers, three actions, contract tests against golden fixtures (ZA, ZT, ZC); `zapier-platform validate`; push as private; invite.
9. **Runtime smoke (W2):** relay and local D1 in workerd, tick via the scheduled test hook, full chain with fakes (SM1 to SM5).
10. **Repo checks and CI:** S3 extensions for worker/providers/migrations and hlxignore; add `relay-unit`, `relay-smoke`, `zapier-app` jobs; no secrets in CI.
11. **README and repo README row (AC5, AC6, AC7):** setup, registration row, admin key how-to, Zapier private setup, polling interval and dedupe docs, public-review checklist, security notes; add the extensions table row.
12. **Deploy and manual verification (M0 to M10)** with real accounts; the live Zap (AC4); record outcomes and observed values (log latency, origins) in the PR and README.
13. **Hand-off for #8 and #9:** documented connector contract, allowlist extension point, fixtures.

---

# Testing Requirements

## 1. Relay unit tests (seams W1 and R1; Node built-in runner, per #2)

**Fixtures/mocks.** From the #2 test kit: fake IMS (RSA key, JWKS, token factory), env factory (production-like, `ALLOW_LOCALHOST` false, canary secret), injected `fetch`, clock, `random`, `sleep`. New in this extension's `worker/test/`:
- **Fake Admin API:** scripted handlers for both generations (log with paging and `nextToken`, source listing with `last-modified`, preview, live, source copy, ping) that record requests and can inject 401/403/404/409/429/5xx and slow responses; golden log payloads from spike S4.
- **Fake subscriber:** records delivery requests (headers, body), configurable status and delay per URL.
- **In-memory store** satisfying the store interface (the same contract suite runs on real D1 in the smoke tier).
- **Fake clock** driven by tests; `worker.scheduled` invoked directly with a controller object.
- **Canary values** for the Admin API key, relay credential and key-encryption secret; log capture.
Every test enters through `worker.fetch` or `worker.scheduled` and asserts on responses, on what the fake subscriber and fake Admin API received, and on logs.

### 1.1 Detection (AC1)

| ID | Behaviour asserted |
|---|---|
| DT1 | Successful `POST` `preview` log entries become `page.previewed`; `POST` `live` become `page.published`; `DELETE` `live` become `page.unpublished`; non-2xx entries, `DELETE` `preview`, custom `event` entries and unknown routes produce nothing |
| DT2 | A bulk entry with `paths[]` yields one event per path, each with the acting user |
| DT3 | Paging: all pages are consumed via `nextToken`; both API generations' URL and response shapes are handled; a page boundary in the middle of an overlap window loses nothing |
| DT4 | Epoch-millisecond timestamps become ISO 8601 with offset in the envelope; `path` is normalised (leading slash, no `.html`); `urls` are correct for the site |
| DT5 | Entries for another `ref` than the site's are ignored |
| DT6 | Source scan: the first pass records a baseline and emits nothing; a later forward move of `last-modified` emits one `page.updated` (`change=modified`); a new file emits `page.updated` (`change=created`); an unchanged file emits nothing; non-page files are ignored; deletions emit nothing |
| DT7 | Scan budget: with more folders than the per-tick budget, consecutive ticks cover every folder exactly once per pass (rotating cursor) and never exceed the budget; large folders page through the listing cursor |
| DT8 | Watched path prefixes restrict the scan and the log-derived events when configured |
| DT9 | A legacy-mode site reports `page.updated` as unsupported in `GET /v1/me` and the admin status, and still delivers log events |

### 1.2 De-duplication and cadence (AC1: "once", "documented polling interval and de-duplication")

| ID | Behaviour asserted |
|---|---|
| DD1 | The same log entry returned by two overlapping polls yields exactly one event and one delivery per subscription |
| DD2 | Two operations on the same path with different timestamps yield two events |
| DD3 | A tick that stops after storing events but before advancing its cursor (simulated crash) and is rerun produces no second delivery |
| DD4 | Two concurrent `scheduled` runs: the lease lets one poll; a forced lease loss still produces no duplicate event or delivery (uniqueness) |
| DD5 | `page.updated` identity includes the new last-modified: the same value rescanned emits nothing; a newer value emits once |
| DD6 | A late entry within the overlap window is delivered; one older than the overlap is not (documented loss window), asserted so the README claim is exact |
| DD7 | Retention: events older than 7 days and delivery rows older than 30 days are purged; dedupe still holds inside the window |
| PI1 | Every tick polls the log of each due site; scans run only when the scan interval has elapsed (default 5 minutes, clamped 1 to 60 on `PATCH`) |
| PI2 | Documentation consistency: the operational constants exported by the code match the table in the README and in this spec (parsed in a doc test) |
| PI3 | Admin API 429 or 5xx during a poll: the site backs off, other sites still poll, no partial cursor advance, status shows the error code |

### 1.3 Subscriptions and delivery (AC1)

| ID | Behaviour asserted |
|---|---|
| SB1 | `POST /v1/hooks` returns `201` with an id; an unknown event type, missing URL or wrong body gives `400`; the credential's site is the only site used |
| SB2 | Re-subscribing the same (credential, event, URL) returns the same id and creates no second subscription |
| SB3 | `DELETE /v1/hooks/{id}` returns `204`, twice `204`; another site's credential gets `204` and the subscription remains |
| SB4 | URL matrix, each `400 bad_target_url` with no outbound request: `http://`, credentials in URL, IP literal (v4 and v6), `localhost`, non-443 port, host not on the allowlist, look-alike hosts (suffix, punycode, trailing dot), URL with fragment tricks |
| SB5 | A credential without `events:read` gets `403 credential_scope` |
| SB6 | The per-site subscription cap returns `409 subscription_limit` |
| DL1 | A matching event is delivered to every active subscription of that event type and prefix, with a body that validates against the envelope schema; non-matching types and prefixes get nothing |
| DL2 | A 2xx acknowledgement marks the delivery done: the next ticks do not resend |
| DL3 | 5xx or timeout: retries follow the documented schedule (fake clock), the attempt count is capped, then the delivery is `failed` and visible in admin deliveries; the event is not lost for other subscriptions |
| DL4 | `410` from a subscriber deletes the subscription and stops all further attempts for it |
| DL5 | A failing or slow subscriber does not delay or reorder deliveries to others in the same tick; the per-tick delivery time and count caps hold |
| DL6 | Events that occurred before a subscription existed are not delivered to it; events after are |
| DL7 | Delivery request hygiene: no `Authorization` or relay credential, no Admin API key, no inbound headers, `Content-Type: application/json`, redirects not followed (a `302` is a failure, no second request) |
| DL8 | Ambiguous outcome (timeout then retry): the same envelope (same `id`) is resent; the test asserts the documented at-least-once behaviour |
| DL9 | Payload size and per-subscription per-tick cap: a burst of 500 events is delivered across ticks without exceeding the cap, in occurrence order per subscription |
| EV1 | `GET /v1/events` returns newest first, honours `type` and `limit` (max 50), only the credential's site, and items equal the hook payload schema |
| EV2 | Fields use ISO 8601 date-times with offset; keys and types are identical between hook payload and `GET /v1/events` (Zapier guideline) |

### 1.4 Credentials, authentication, tenancy (AC3, AC9)

| ID | Behaviour asserted |
|---|---|
| CR1 | Issue: value has the documented format and is returned exactly once; the store holds only a hash (assert by inspecting the store, no plaintext or reversible form); list shows label, prefix, scopes, created, last used |
| CR2 | Connector routes: no credential, malformed, unknown, revoked, or credential for another site all give `401` (revoked takes effect immediately); no handler or outbound call before the check |
| CR3 | Cross-tenant matrix: with two connected sites and two credentials, every connector route (`hooks`, `events`, `pages`) only ever sees its own site, even when org/site appear in the path or body |
| CR4 | Scope matrix: each route requires its scope; missing scope gives `403 credential_scope` |
| CR5 | A connector request that carries an `Origin` header (allowed or not) gets `403 forbidden_origin`; admin routes keep the #2 CORS behaviour (UC1 to UC9 analogues with the extension host org/site) |
| CR6 | Admin routes: no token, bad token, expired token, wrong key signature, `alg: none` all give `401` before any store or Admin API access (reuses the #2 token matrix); `OPTIONS` preflight needs no token |
| CR7 | Authority rule: the connecting user can manage; a different IMS user cannot (`403`) unless they present a currently valid key for that exact site; a key for another site is rejected |
| CR8 | Credential and key canary property test (the #2 US1 pattern): across success and every error path the canaries never appear in any response, any outbound request to a non-Admin host, or any log line |
| CN1 | Connect: a key that the fake Admin API accepts on `log` is stored; 401/403 or a key for another site gives `400 invalid_admin_key`; a key without `log:read` gives `admin_key_insufficient_role`; the stored value is ciphertext, round-trips, and fails with a different key-encryption secret |
| CN2 | Reconnect replaces the key without changing credentials or subscriptions; disconnect deletes key, credentials, subscriptions, events for the site; the old credential then gives `401` |
| CN3 | Admin API 401/403 during polling or an action: status becomes `needs_attention`, polling backs off, no subscriber deliveries are generated, the console status exposes `last_error` as a code (no upstream text) |
| CN4 | Key expiry is parsed from the key's claims and surfaced; under 30 days adds a warning flag. [ASSUMPTION: the key is a JWT with an `exp` claim; spike S1/S4 confirms; if not, expiry is taken from the creation response the admin pastes] |

### 1.5 Page actions (AC2)

| ID | Behaviour asserted |
|---|---|
| AX1 | Create: a hlx6 site sends one source-copy request with `source` = template path and the chosen `collision`; `201`/`200` map to `201 {path, urls}`; Admin API `409` maps to `409 conflict`; `404` for a missing template maps to a specific not-found code |
| AX2 | Preview: calls the preview operation and returns status and URLs; `404`/`403` map to specific codes |
| AX3 | Publish: with `previewFirst` default it previews then publishes in that order; with it off only publishes; publish of a never-previewed page maps to a clear error |
| AX4 | Path validation matrix, each `400` with no outbound call: missing leading slash, `..`, encoded traversal, double slash, encoded slash, over-long path, control characters |
| AX5 | Admin API `429`/`5xx` are retried by the template helper (schedule asserted with injected clock), then map to `429`/`502`; `401`/`403` map to the key-rotation error |
| AX6 | Outbound hygiene: only the configured Admin hosts are contacted; the Admin key is sent only as the documented auth header; the relay credential is never forwarded; org and site in the outbound URL always come from the credential's site |
| AX7 | Legacy-mode site: create page gives `501 unsupported_for_site`; preview/publish use the legacy routes |
| AX8 | A credential with only `events:read` cannot call any action route |

### 1.6 Store contract (seam R2)

| ID | Behaviour asserted |
|---|---|
| ST1 | Event and delivery uniqueness: a second insert of the same key is ignored, not an error, and reports "not new" |
| ST2 | Lease: compare-and-set grants the lease to exactly one of two concurrent callers and expires by time |
| ST3 | Cascade delete removes every row of a site |
| ST4 | Retention purge removes only expired rows |

The same suite runs against the in-memory store (unit tier) and local D1 (smoke tier, SM2).

## 2. Zapier app tests (seam Z1; Node 22, `zapier-platform-core` app tester)

Fixtures: golden fixtures copied from the relay's contract tests (event envelope, `me`, error bodies); a fake relay at the request layer.

| ID | Behaviour asserted |
|---|---|
| ZA1 | Auth test calls "who am I"; success returns org/site; the connection label is `org/site`; a `401` gives a plain message ("Your relay credential isn't valid or was revoked") |
| ZT1 | Each trigger (published, previewed, updated): subscribe sends event type, `targetUrl` and optional prefix and returns the id; unsubscribe deletes by the stored id; both use the bearer credential |
| ZT2 | Hook perform wraps the payload into an array with the event's `id`; payloads with a different `type` than the trigger's are dropped (empty array) |
| ZT3 | Perform list calls the events route with the trigger's type and returns an array whose keys and value types equal the hook payload (guideline: the same schema as the hook) |
| ZT4 | Sample data keys equal the golden envelope's required keys (no optional-only keys); date-times are ISO 8601 with offset |
| ZC1 | Each action sends the documented body and returns the relay's result; input fields validate path format client-side in the editor (help text) without being the only check |
| ZC2 | Relay error codes (`conflict`, `unsupported_for_site`, `credential_scope`, `invalid_admin_key`) become readable English errors; 4xx is not retried by the app |
| ZV1 | `zapier-platform validate` passes (schema and structure; public-only checks listed separately as the review checklist) |
| ZV2 | The package contains no credential values and no relay URL other than the configured constant for production and one for the private staging version |

## 3. EW console tests

**Unit (seam S2, WTR; injected fetch; hand-built SDK result):**

| ID | Behaviour asserted |
|---|---|
| UI1 | Connect form: org and site prefilled from `context` but editable; submit sends `Authorization: Bearer <sdk token>` and the key to the constant relay origin; the key field is cleared immediately after submit and the key never appears in the DOM, console or storage afterwards |
| UI2 | The issued credential is shown once with a copy action; after dismissal (or re-render) it is gone from the DOM and from any storage |
| UI3 | Status panel renders connected state, API mode, last poll, lag, key expiry warning and `needs_attention` from a fake response |
| UI4 | Credentials list and revoke; subscriptions and deliveries render as text; HTML in values (paths, users) is escaped and creates no elements |
| UI5 | Errors: `401`, `403`, `5xx`, timeout, offline show short plain messages and a bounded wait; no stack traces, no upstream text |
| UI6 | The IMS token never appears in the DOM or console output |
| UI7 | `?relay=https://evil.example` is ignored; the relay origin is the constant (loopback on `localhost`, fixed deployed origin otherwise) |
| UI8 | Standalone (no SDK) state disables all actions with the "not inside Experience Workspace" message |
| UI9 | A disconnect needs an explicit confirmation step and shows what is deleted |

**E2E (seam S1, Playwright, Chromium, hermetic):** the Playwright config starts the #1 static server on `:3000`, the relay via wrangler on `:8787` with local D1, a fake Admin API and a fake subscriber (Node servers), and a fake IMS key server; the #1 SDK stub supplies a signed token.

| ID | Behaviour asserted |
|---|---|
| E2E1 | Connect the fake site with a fake key, issue a credential, see status; the real cross-origin call from `localhost:3000` to `localhost:8787` works, preflight included |
| E2E2 | Full chain: the fake Admin API emits a publish log entry; trigger a tick; the fake subscriber receives one envelope; the console delivery list shows it delivered |
| E2E3 | Revoke the credential in the console; a connector call with it then gets `401` |
| E2E4 | Page HTML, DOM text and all network responses contain neither the token, nor the Admin key, nor the credential after the one-time display; only expected hosts were contacted |

## 4. Runtime smoke tier (seam W2, `wrangler dev` local, no Cloudflare login)

| ID | Behaviour asserted |
|---|---|
| SM1 | The relay bundles (D1 binding, cron entry, shared template import) and starts; a bare request gets `401` (liveness signal, as #2) |
| SM2 | The store contract suite (ST1 to ST4) passes against local D1 with the migrations applied |
| SM3 | A tick invoked through the local scheduled test hook polls the fake Admin API, stores an event, and delivers to the fake subscriber once; a second tick sends nothing |
| SM4 | Records CPU time, wall time and subrequest count for a tick with one site and with N fake sites (informational against R6; no hard threshold until a baseline exists) |
| SM5 | Canary secrets are absent from all responses and logs over real HTTP (CR8 repeated) |

## 5. Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| UR1 | The extension folder has an entry page named after the folder, a README, tests, a `worker/` with wrangler config, README and test, D1 migrations, and `providers/zapier/` with its own tests |
| UR2 | The #2 hygiene rules hold: no tracked `.dev.vars*`/`.env*`, no secret-looking `vars`, every `secrets.required` name in `.dev.vars.example` |
| UR3 | `.hlxignore` hides `**/worker/`, `**/providers/`, `**/test/` |
| UR4 | The repo README extensions table has a row for `automation-connectors` (type `app`) and every row resolves to a folder and entry page |
| UR5 | The production wrangler config contains no scheduled-test route or local-only variable (`ALLOW_LOCALHOST` false or absent) |

## 6. End-to-end checks inside real Experience Workspace (manual; needs interactive Adobe login, Cloudflare, Zapier, Slack)

**Accounts and credentials needed:** GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, per #1); an Adobe IMS identity with access to a DA org and a test site, able to edit the site config and to create Admin API keys (admin role); the test site on the new Admin API (hlx6), or the legacy-site decision from Open Question 2; a throwaway Admin API key with role `publish` and a short expiry; Cloudflare account with Wrangler login on the plan chosen (Paid recommended), a D1 database, the `KEY_ENCRYPTION_KEY` secret; Zapier developer account (private integration) and a second Zapier user to test the invite; a Slack workspace and a test channel (connected inside Zapier via Zapier's own Slack app); Chrome. Never paste an IMS token, Admin API key or relay credential into chat, issues or logs.

- **M0 (prereq):** `curl -si https://admin.hlx.page/log/{org}/{site}/main` with the key returns `200`; deploy the relay and apply D1 migrations; `curl -i <relay>/v1/me` returns `401`; push the Zapier private app and note the invite link.
- **M1 (spikes S1 to S6):** run and record in the PR: IMS-bearer acceptance, API mode, source listing shape, log latency and DELETE shape, preview/create with a key on DA content, Zapier hook host and `Origin`. Update the README and golden fixtures accordingly.
- **M2 (console, `ref=local`):** `npm start` (port 3000) and `wrangler dev` (port 8787) with local D1 and the real Admin API; open the app URL with `?ref=local`, accept the trust prompt; connect the test site with the key; status turns healthy; issue a credential; copy it. Proves AC6, AC8, AC9.
- **M3 (console, branch ref):** push branch `connectors-console`; open the same URL with `?ref=connectors-console` against the deployed relay; repeat connect/status; record the page's `Origin` as seen by the relay. Proves AC8, AC9.
- **M4 (apps card and discoverability):** add the `apps` sheet row; the card appears at `https://da.live/apps#/{org}/{site}`; the repo README table lists the extension. Proves AC7.
- **M5 (live Zap, AC4):** in Zapier, accept the private-app invite, create a connection by pasting the credential (label shows `org/site`), build a Zap "Page Published → Slack: Send Channel Message" using fields from the trigger sample, publish the Zap. In EW preview then publish a page in the test site. Expect: the Slack message within about two minutes, Zap history shows one successful run, the payload fields (`path`, `urls.live`, `user`) are mapped. Repeat for Page Previewed and Page Updated (edit and save a page in DA; the updated event arrives after the scan interval). Publish the same page three times: three Slack messages, no duplicates (AC1, AC2, AC4).
- **M6 (actions):** build a Zap "Schedule or Manual → Create Page from Template → Preview Page → Publish Page" for a template path and a new path; run it; open the new page in EW and on the live URL; run it again to see a clear `conflict` error; run with a read-only credential to see the scope error (AC2, AC3).
- **M7 (unsubscribe and revoke):** turn the Zap off: the subscription disappears in the console and no further messages arrive; delete the credential in the console: the Zap's connection shows an error and a manual action fails with the relay's `401`-based message (AC3).
- **M8 (cadence and dedupe):** with the fake-free real site, measure log latency (action time to relay receipt) over ten publishes, check no duplicates under a quick publish burst, and compare with the documented interval; record in the README (AC1).
- **M9 (secrets and rejection):** search page source, DevTools network and storage for the Admin key and credential (none after the one-time display); `curl` every relay route without a credential/token (all `401`); `curl` a connector route with a browser `Origin` (`403`); a revoked credential (`401`) (AC9).
- **M10 (Zapier public-review dry run):** walk the README checklist item by item against https://docs.zapier.com/integrations/publish/integration-publishing-requirements.md and run `zapier-platform validate`; record which items are blocked (ownership, Adobe-domain team member, trademark, OAuth, test account) (AC5).

## 7. CI additions (no credentials, no Cloudflare or Zapier login)

| Job | Steps | Notes |
|---|---|---|
| `relay-unit` | checkout, Node >= 22.12, `npm ci`, relay unit tests (DT, DD, PI, SB, DL, EV, CR, CN, AX, ST) | every push and PR |
| `relay-smoke` | same setup, smoke tier (SM1 to SM5) | disable wrangler telemetry; advisory vs required follows #2 Open Question 11 |
| `zapier-app` | checkout, Node 22, `npm ci` in `providers/zapier/`, tests (ZA, ZT, ZC) and `zapier-platform validate` | no deploy; deploy key stays on the maintainer machine |
| `lint` (existing) | adds relay, console and Zapier code and UR1 to UR5 | |
| `unit` / `e2e` (existing) | console UI1 to UI9; E2E1 to E2E4 with relay, fake Admin API, fake subscriber started by Playwright | Chromium only |

## 8. Acceptance-criteria traceability (ticket #7)

| # | Acceptance criterion (#7) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Relay detects preview, publish, unpublish and update events for a configured org/site and delivers each event once to every subscriber (REST-hook subscribe/unsubscribe), with a documented polling interval and de-duplication | DT1 to DT9 (detection of all four types, paging, paths, scan), DD1 to DD7 (ledger, crash replay, concurrency, loss window), PI1 to PI3 (cadence and documentation consistency), SB1 to SB6, DL1 to DL9, EV1 to EV2; SM3; E2E2 | **M5** (three event types in a real Zap, no duplicates), **M8** (measured latency and no duplicates under burst), spikes in **M1** (S4 log shape and latency; S3 source listing) |
| AC2 | Zapier triggers: page published, page previewed, page updated; actions: create page from a template path, preview page, publish page | ZT1 to ZT4 (three REST Hook triggers, perform list, sample data), ZC1 to ZC2 (three actions, error mapping), ZV1, AX1 to AX3 (relay-side behaviour of the actions), contract fixtures shared with the relay (ZT3/ZT4 vs EV2) | **M5** (three triggers live), **M6** (three actions live), **M10** (`validate`) |
| AC3 | Zapier auth uses a per-site credential issued by the relay; actions run with that site's permissions only | CR1 to CR4 (issuance, hash-only storage, revocation, scopes), CR3 (cross-tenant matrix), AX6 (org/site only from the credential), AX8, ZA1, ZV2, E2E3 | **M6** (read-only credential refused), **M7** (revoke breaks the connection), **M9** |
| AC4 | A live Zap (page published to Slack message) works end to end in a test workspace | SM3 and E2E2 prove the same chain with fakes; ZT1 to ZT3 prove the Zapier side against fixtures | **M5** (the live Zap itself: Zapier private app, Slack test workspace, EW publish) |
| AC5 | README lists what is needed for Zapier public app review | UR1 (README present); optional grep in S3 for the checklist heading so it is not silently deleted | **M10** (walk-through against Zapier's published requirements); review: the checklist covers ownership and Adobe-domain team member, non-expiring test account, production endpoints and non-beta launch, OAuth preference, static-hook ban and perform-list requirement, ISO dates, English text, trademarks/naming, API documentation, demo test Zaps, support contact (all from https://docs.zapier.com/integrations/publish/integration-publishing-requirements.md and https://docs.zapier.com/integrations/publish/integration-build-guidelines.md) |
| AC6 | All code in its own self-contained `automation-connectors` folder with a README covering setup, the EW config-sheet row, and site config read | UR1 (structure), UR3 (hidden from code bus), S3 convention check | Review: README sections exist (setup, `apps` row, "reads no EW site config; per-site relay settings are in the console", admin key how-to); walk the README once on a clean clone; **M2** |
| AC7 | Listed in the repo README extensions table and reachable from its host platform | UR4 | **M4** (apps card at `da.live/apps#/{org}/{site}`, direct app URL opens) |
| AC8 | Works in EW with `ref=local` and with a branch ref | UI7 (relay origin constant), E2E1 (local cross-origin path), SM1 | **M2** (`ref=local`), **M3** (branch ref, deployed relay, observed `Origin`) |
| AC9 | Vendor credentials only in this extension's worker (built from the shared worker template); the browser never receives them; unauthenticated calls to the worker are rejected | CR2, CR5, CR6 (every route rejects without credential/token; browser `Origin` refused on connector routes), CR8 and SM5 (canary secrets never leak), CN1 (key stored encrypted), UI1/UI2/UI6 and E2E4 (browser never holds the key after submit, credential only once, token never rendered), UR2 (hygiene), template tests UA/UC/UP/US from #2 for the shared parts | **M9** (live rejection matrix and secret search), M0 (`curl` without credential gives `401`) |
| AC10 | Core logic covered by unit tests; lint and CI green | all unit tiers above (relay, Zapier app, console); CI jobs `relay-unit`, `zapier-app`, `lint`, `unit`, `e2e` | Review: CI green on a PR; deliberately break a rule (loosen the SSRF allowlist, weaken the dedupe key) on a scratch branch and see SB4/DD1 fail |

Every acceptance criterion on #7 maps to at least one automated test or a numbered manual verification step above.

## 9. Open questions for the owner

1. **Which Admin API generation is the test site on, and can I have one on hlx6?** Without hlx6, `page.updated` detection and Create Page cannot work headlessly (R2). Is `jazhou-adobe/ew-extensions` registered in the Configuration Service (it returned "config for site not found" today)?
2. **Headless DA access for legacy sites.** Do you want an approach for sites still on the legacy API (a technical-account IMS token that DA accepts, or "the connecting user's token", which expires and is not headless), or is "log events work, update and create are hlx6-only" acceptable for this ticket? Is there anyone on the EW team who can say whether a service identity can be given DA permissions?
3. **Policy and security review (R1).** Is it acceptable under Adobe's outside-activity/IP policy to run a service that stores other teams' Admin API keys and calls Adobe APIs, from your Cloudflare account? Should this run only for your own test sites until reviewed?
4. **Cloudflare plan.** The poller is unlikely to fit Workers Free (10 ms CPU, 50 subrequests per cron). Is Workers Paid acceptable, and which Cloudflare account?
5. **Template amendments (R-T1 to R-T4).** Amend the #2 spec (pluggable auth, dynamic secrets, cron/D1, no-inline-retry delivery) or implement them locally in this extension and reuse only the unchanged template modules?
6. **Meaning of "delivers each event once".** Accept "once per subscriber when the subscriber acknowledges, at-least-once with a stable `id` on ambiguous failures", or do you require a stricter guarantee (which would need receiver-side idempotency, not something Zapier hooks support)?
7. **Admin API key flow.** Paste a key the admin creates (this spec) versus a one-click "create key for me" (needs IMS-bearer acceptance by the Admin API, spike S1). Is paste acceptable for v1? Preferred key lifetime (default 365 days, maximum)?
8. **Site management authority.** Accept "the connecting user, or anyone presenting a valid key for the site" for v1, or require an Adobe-side proof of site admin rights (depends on S1)?
9. **Update semantics.** Confirm `page.updated` = "source last-modified moved" (including new pages as `change=created`), the default scan interval (5 minutes) and scan budget, and whether `page.updated` should also fire when a page is previewed without source change.
10. **Publish action default.** Should "Publish Page" preview first by default (this spec) or only publish and fail if not previewed?
11. **Zapier trigger set.** Ship exactly the three triggers in #7, or also expose "Page Unpublished" (the relay already detects it)?
12. **Zapier ownership and listing.** Who owns the Zapier developer account? Public listing needs an owner/admin with an Adobe-domain email and Adobe's permission to use the API and the trademarks (R12, R13); is the intent to stay private, or to involve Adobe? Final app name?
13. **Personal data.** Events carry the acting user's email when the log has it. Keep it, hash it, or omit it by default?
14. **Hosting model.** One relay for the host org/site only (CORS allowlist as in #2), or should third-party orgs be able to use your deployed relay (needs a different CORS and tenancy story and abuse controls)?
15. **Storage.** D1 as specified, or a Durable Object per site (serialised polling for free, more code)?
16. **Make and n8n (#8, #9).** Confirm the relay stays connector-neutral with a host allowlist per connector, and that Zapier lives in `providers/zapier/` alongside future `providers/make/` and `providers/n8n/`.
17. **Abuse controls.** Do you want failed-credential rate limiting and credential lockout in this ticket (listed as backlog), or deferred?
18. **Naming and hosting URL.** Relay `workers.dev` URL acceptable as the constant in the console and the Zapier app, and a separate private staging version of the Zapier app for testing (Zapier recommends a private version rather than a separate integration)?
