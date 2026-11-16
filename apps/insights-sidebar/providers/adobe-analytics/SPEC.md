# Spec: Insights & Experiment Sidebar: Adobe Analytics (provider #2 for the insights sidebar)

Ticket: jazhou-adobe/ew-extensions#34 (this spec: #72). Blocked by #33 (sidebar shell + GA4; its spec is `apps/insights-sidebar/SPEC.md`, spec task #71), which is itself blocked by #1 (repo scaffold; `apps/hello-world/SPEC.md`) and #2 (shared worker template; `shared/worker-template/SPEC.md`). #34 is a vendor follow-up: it adds one provider folder and one registration line; it does not redesign the shell.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as #1, #2, #33): **[VERIFIED]** = read in a primary source (URL given) or observed on 2026-11-16; **[ASSUMPTION]** = inferred or taken from a non-primary source, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Cloudflare, or a manual check against a real report suite.

Vocabulary follows #1, #2 and #33: *extension* = one folder `apps/<name>/`; *worker* = the per-extension backend in `apps/<name>/worker/` built from `shared/worker-template/`; *provider* = one vendor under `apps/<extension>/providers/<vendor>/`; *source* = one analytics backend shown in the sidebar, implemented by exactly one provider; *insights result* = the closed, versioned, vendor-neutral JSON a provider returns; *section* = `stats`, `trend` or `table`; *content site* = the DA org/site of the page being edited (SDK `context.org`/`context.site`); *IMS token* = the Adobe IMS access token the DA App SDK hands the page. Terms specific to this ticket: *company* = an Adobe Analytics company, addressed by its **global company id**; *report suite* (`rsid`) = the Adobe Analytics data container queried; *API client* = the Adobe Developer Console project with an **OAuth Server-to-Server** credential (client id + client secret) used by the worker; *page value* = the string stored in the report suite's page dimension for a page (by default the `pageName`); *suite time zone* = the report suite's reporting time zone.

Provider-interface assumptions: #33's spec exists and is the contract (section "Provider contract (behaviour)" of its Build Analysis, 4). Where this spec needs something #33 does not state, it is listed in "Dependencies on #33 and #2" (Implementation Decision 3) and marked [OPEN]; every such item has a documented fallback that needs no shell change.

---

## Problem Statement

Teams that run Adobe Analytics (AA) for their Edge Delivery Services (EDS) sites have the page numbers in Analysis Workspace, not in the editor. A content author editing a page in Experience Workspace (EW) has to leave EW, open Workspace, find the right report suite, work out how the page is named in the Page dimension, build a freeform table for it and pick a date range. Authors rarely do this, so edits are made blind.

The insights sidebar (#33) already answers this for Google Analytics 4. It does nothing for organisations whose analytics system of record is Adobe Analytics; for them the sidebar is empty.

AA makes the obvious approach unsafe or awkward in four ways, and a naive port of GA4 would get all four wrong:

1. **Credentials.** The AA 2.0 API needs a client secret (OAuth Server-to-Server) that must never reach the browser or the public code bus. A static extension cannot call it.
2. **Page identity.** AA has no URL dimension in the Reporting API. The "Page URL" dimension exists only in Data Warehouse; the "Page" dimension holds whatever the implementation sends as `pageName` (a title, a path, `host:path`, a breadcrumb). The sidebar cannot assume "the page's URL" is a queryable value the way GA4's `pagePath` is.
3. **Quota.** The AA 2.0 API allows 12 requests per 6 seconds per user, and Adobe's own guidance explicitly warns against "driving a web page with a site performance widget by making an API request every time the web page is loaded". Every author of a site shares one server credential, so one busy hour can starve everyone.
4. **Semantics.** AA's vocabulary differs from GA4's: visits (not sessions), unique visitors (not active users), bounce rate = bounces / entries (not "not engaged"). Showing both sources with the same labels would mislead.

## Solution

An **"Adobe Analytics" source** inside the existing Insights plugin. For a content site whose worker configuration maps it to an AA company and report suite, the sidebar shows a source tab "Adobe Analytics" next to (or instead of) GA4. Opened on a page, it shows, over a date range the author selects (last 7, 28 or 90 days, or a custom range), the page's **page views, visits, unique visitors, entries and bounce rate**, a **per-day page-view trend**, and a **top marketing channels** table (visits and share). It never changes the document.

Behind it, the worker holds the AA client secret, mints and caches the OAuth access token, finds the page in the report suite, runs three small reports (page totals, daily trend, channel breakdown), normalises them into #33's vendor-neutral result and lets the shell cache it briefly. The browser gets only the normalised result.

The extension shell, routes, cache, renderers and range control do not change. A new provider folder implements the #33 provider contract and one line in the registry registers it. A per-site configuration entry (company, report suite, time zone, and optional page-naming settings) says how that site's pages are named in AA, which is the one thing only the site's owner knows.

## User Stories

Content author (EW user):

1. As a content author, I want an "Adobe Analytics" tab in the Insights panel for sites that use it, so that I can see page performance from our analytics system of record without leaving EW.
2. As a content author, I want the numbers to be for the page I am editing, so that I do not have to find it in Analysis Workspace.
3. As a content author, I want to see page views for the page, so that I know how much traffic it gets.
4. As a content author, I want to see visits, so that I understand how many sessions included the page.
5. As a content author, I want to see unique visitors, so that I can tell repeat views from distinct people.
6. As a content author, I want to see entries, so that I know how often this page is where a visit starts.
7. As a content author, I want to see the bounce rate, so that I can spot landing pages people leave immediately.
8. As a content author, I want a per-day page-view trend, so that I can see whether traffic is rising, falling or spiking.
9. As a content author, I want the top marketing channels (visits and share), so that I know where visitors come from.
10. As a content author, I want to pick last 7, 28 or 90 days, so that I can look at the period that matters to me.
11. As a content author, I want to pick a custom start and end date, so that I can inspect a campaign or release window.
12. As a content author, I want the same range control for every source, so that switching between GA4 and Adobe Analytics does not change how I work.
13. As a content author, I want a clear "no data for this page in this period" message, so that I can tell an unpublished or zero-traffic page from a broken panel.
14. As a content author, I want a clear "analytics is not set up for this site" message with who to ask, so that I do not think the panel is broken.
15. As a content author, I want a clear "analytics is not set up correctly" message when the credential or report suite access is wrong, so that I report it to the right person and do not retry endlessly.
16. As a content author, I want a "too many requests, try again in N seconds" message when the shared AA quota is exhausted, so that I know to wait and not to refresh repeatedly.
17. As a content author, I want a note that today's numbers may be incomplete, so that I do not misread a partial day as a drop.
18. As a content author, I want to see when the numbers were generated and whether they came from the short-lived cache, so that I can judge freshness.
19. As a content author, I want one failing source not to blank the other, so that an Adobe outage does not hide GA4 (and the reverse).
20. As a content author, I want labels that say "Visits" and "Unique visitors" for Adobe Analytics, so that I am not told it means the same as GA4 "Sessions" and "Active users".
21. As a content author, I want a note when Adobe lumped rarely seen values into "Low-Traffic", so that I know a channel row is approximate.

Analytics administrator (owner of the AA company):

22. As an analytics administrator, I want to give the worker a dedicated read-only API client (OAuth Server-to-Server) tied to one product profile, so that its access is limited to the report suites I choose and can be revoked in one place.
23. As an analytics administrator, I want to rotate the client secret without downtime (Adobe allows two active secrets), so that a leak is recoverable.
24. As an analytics administrator, I want each EW site mapped to a report suite by configuration, so that onboarding a site is a config change and not a code change.
25. As an analytics administrator, I want to say how my pages are named in the report suite (default page dimension, a name template such as `{host}:{path}`), so that the sidebar finds pages in the way my implementation records them.
26. As an analytics administrator, I want to point the page lookup at a custom eVar when my implementation stores the URL path there, so that I do not have to change my tagging to fit the sidebar.
27. As an analytics administrator, I want the suite time zone in the configuration, so that "last 28 days" and "yesterday" mean the same as in Workspace.
28. As an analytics administrator, I want the sidebar to be gentle on the API (cached, rate limited, no polling), so that it does not slow down Workspace or hit Adobe's 429 for other integrations that share the credential.
29. As an analytics administrator, I want to cross-check any number in the panel against an Analysis Workspace freeform table (Page × metrics), so that I can trust it. The README gives the exact table to build.

Maintainer / extension author:

30. As the maintainer, I want the AA client secret to live only in the worker's secret store, so that the repo, the browser and the EDS code bus never contain it.
31. As the maintainer, I want derived credentials (the minted access token) redacted from every response and log, so that "never echoed" holds for more than the stored secret.
32. As the maintainer, I want unauthenticated calls rejected with `401` before any AA code or AA request, so that nobody can read my analytics or burn my AA quota.
33. As the maintainer, I want the browser unable to choose the company, report suite, dimension, metric or search expression, so that a crafted request cannot read anything I did not map.
34. As the maintainer, I want the access token cached until shortly before expiry and minted by one in-flight request, so that Adobe does not throttle my credential for minting too many tokens.
35. As the maintainer, I want one provider folder and one registry line to be the whole change in the shell, so that the "no shell changes beyond registering the provider" promise of #33 holds and is checked.
36. As the maintainer, I want the provider to pass #33's conformance suite, so that contract violations are found before review.
37. As the maintainer, I want local development and all CI tests against a fake Adobe (token endpoint and report API) on loopback, so that no Adobe account is needed to run them.
38. As the maintainer, I want the provider README to document credentials setup, every site-config key, the page-naming rules and the Workspace cross-check, and a test that the documented keys equal the validated keys, so that docs cannot drift.
39. As the maintainer, I want a limiter inside the provider that keeps one isolate under Adobe's request budget, so that a burst of authors gets an honest "try again in N seconds" and not a flood of 429s.
40. As a reviewer, I want a branch-ref URL and a manual verification checklist in the PR, so that I can verify the source in real EW with a branch.
41. As a reviewer, I want a touch-list check (only registry, worker config and README may change outside the provider folder), so that I do not review shell changes by eye.

Security reviewer:

42. As a security reviewer, I want proof that the client secret, the access token and the IMS token never appear in a browser-visible response, in the DOM or in logs, so that "the browser never receives credentials" is tested.
43. As a security reviewer, I want proof that a request without a token, with a token from another key, or from a disallowed origin never reaches Adobe, so that the worker is not a free AA reader.
44. As a security reviewer, I want proof that analytics-derived strings (channel names, page values) render as text and never as HTML, so that hostile data cannot script the editor.
45. As a security reviewer, I want proof that the provider can only call the two Adobe hosts it declares, so that a bug cannot turn the worker into an open proxy.

## Implementation Decisions

(No file paths or code, except where noted. Paths and layout are in the Build Analysis. Wire-level names (endpoints, metric ids) are API contracts, not code.)

1. **Provider, not a fork of the shell.** Adobe Analytics is one provider that implements #33's provider contract exactly: id `adobe-analytics` (matches the id pattern; it is also the route segment and the key under which a site's entry is looked up), label "Adobe Analytics", `secrets` = the client secret, `hosts` = the two Adobe hosts (Decision 5), `siteConfig(entry)` and `fetch(ctx, { site, page, range })` returning an insights result. It gets the #2 handler context through `ctx`, never the raw IMS token and never `Request`/headers. Registration is one entry in the registry module plus the provider's secrets/vars in the worker configuration. The only files outside the provider folder this ticket may touch: the registry (one line), the worker configuration (one secret, a few non-secret vars), `.dev.vars.example`, and the extension README's provider list. A repo check enforces this (Testing Requirements 6, UA3).
2. **Result mapping onto the closed schema, with no new section kinds, formats or notes.** One `stats` section "Overview" (page views, visits, unique visitors, entries as `integer`; bounce rate as `percent`), one `trend` section "Page views per day" (`integer`), one `table` section "Top channels" (columns: channel `text`, visits `integer`, share `percent`). Notes use only codes from the closed set: `data_delay` when the range includes today in the suite time zone; `other_row` when the channel table contains Adobe's "Low-Traffic" item. `sampled`, `thresholded` and `truncated` are never emitted (AA reports are not sampled or thresholded in the API sense [ASSUMPTION]; Workspace-style "Low-Traffic" bucketing is the closest analogue and is `other_row`). The AA labels say "Visits" and "Unique visitors" (story 20); labels are plain text in the result, not shell-owned prose, which #33 permits for section and item labels. `status` is `ok`, `empty` (page not found or zero page views in the range) or `not_configured` (returned by the shell when `siteConfig` yields `null`).
3. **Dependencies on #33 and #2 (all additive; each has a fallback).**
   - *Required from #2/#33 (already specified there as D1/D2 and per-status retry caps):* D1 dynamic outbound credential (the minted access token is not an env secret), D2 redaction of derived values (the access token), and per-status retry caps on the proxy (GA4's Decision 16 needs the same). Fallback as in #33: the provider sets the outbound `Authorization` itself and registers the value for redaction.
   - *Proposed, optional:* **D-AA1** an optional provider-descriptor member `cacheTtlSeconds` (default = the shell's TTL). Adobe says not to poll faster than every 30 minutes and warns against per-page-load requests (Decision 15), so AA wants 1800 s. Fallback: accept the shell default (300 s); the in-provider limiter (Decision 13) protects the quota either way. **D-AA2** an optional `page.label` string in the result so the panel can show the *matched page value* (the most useful debugging hint for the page-naming problem). Fallback: log the matched value; README documents how to find it.
   - *To confirm in #33's implementation [OPEN]:* (a) the shell's cache key includes the content-site key `org/site` (or provider-supplied key parts), so two sites mapped to different report suites never share an entry; GA4's text says "keyed by source, property, the candidate page paths and the resolved range tokens", where "property" is the GA4 name for the vendor-side data container; for AA the data container is `companyId/rsid` plus page-naming settings. (b) `page.host` may be absent when the site config has no host (GA4's example shows it present). (c) The range object's `startToken`/`endToken` are GA4-oriented; AA derives its own dates from `range.id` and `range.start`/`range.end`, so only `id`, `start` and `end` are relied on. (d) The per-site mapping variable name: #33 lists `GA4_SITES`; this spec uses `AA_SITES` with the same key (`org/site`) and the entry shape in Build Analysis 4. If #33 instead ships one generic map keyed by source id, only the variable name changes; `siteConfig(entry)` receives the same shape.
4. **Authentication to Adobe: OAuth Server-to-Server, client-credentials grant.** The worker `POST`s a form (client id, client secret, `grant_type=client_credentials`, scopes) to Adobe IMS's token endpoint and receives a bearer access token with `expires_in` (about 24 hours) [VERIFIED: https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/ims, "Fetching access tokens"]. The token is cached in isolate memory until five minutes before expiry; concurrent cold requests share one mint (Adobe "can throttle your integration if it generates too many access tokens" and says to cache tokens until they expire [VERIFIED: .../ServerToServerAuthentication/implementation]). On an AA `401` the token is dropped and minted once more; a second `401` is `misconfigured`. **JWT service-account credentials are not supported**: Adobe has deprecated them in favour of OAuth Server-to-Server [VERIFIED: https://developer.adobe.com/analytics-apis/docs/2.0/guides/ "JWT authentication is deprecated"]. The scope list is a non-secret variable with a documented default `openid,AdobeID,additional_info.projectedProductContext` [ASSUMPTION: from a third-party scope catalogue (https://apis.io/scopes/adobe-analytics/adobe-analytics-scopes); Adobe says the scopes available to a credential are shown in its Developer Console project page, and the owner should copy the exact string from there, Open Question 10].
5. **Outbound calls and hosts.** The only API call is the Reports `POST` to `https://analytics.adobe.io/api/{global company id}/reports`; tokens come from `https://ims-na1.adobelogin.com/ims/token/v3`. The provider's `hosts` are exactly those two hosts. Every AA call carries `Authorization: Bearer <access token>` and `x-api-key: <client id>`; no other header is needed for the 2.0 reports endpoint [VERIFIED: https://developer.adobe.com/analytics-apis/docs/2.0/guides/endpoints/reports/overview]. The client id is treated as a non-secret variable but is still registered for redaction (cheap defence in depth). Local/test host overrides are non-secret variables honoured only in the local environment, refused otherwise (the #33 Decision 20 pattern).
6. **Per-site configuration (non-secret worker configuration, one JSON-valued variable keyed by `org/site`).** Required: `companyId` (the global company id; found with the Discovery API, `GET https://analytics.adobe.io/discovery/me` [VERIFIED: https://developer.adobe.com/analytics-apis/docs/2.0/guides/endpoints/discovery]), `rsid`, `timeZone` (IANA name of the suite's reporting time zone). Optional: `hostName` (production host; used in the page-value template and shown as `page.host`), `pageDimension` (default `variables/page`; allowlist: `variables/page`, `variables/evarN`, `variables/propN`), `pageValueTemplate` (default `{path}`; tokens `{host}` and `{path}`; must contain `{path}`; `{host}` requires `hostName`), `sourceDimension` (default `variables/marketingchannel`; allowlist: `variables/marketingchannel`, `variables/lasttouchchannel`, `variables/referringdomain`). `siteConfig` validates strictly: unknown keys, wrong types, patterns, an invalid IANA time zone, template characters that are unsafe inside an AA search clause (`'`, `\`, `*`) are `misconfigured`, with a log line naming the key, never a value. `null` = no entry for the site = source not enabled. The README documents every key and a test proves README keys equal validated keys (Testing Requirements 1.1).
7. **Page identity (the central design problem of this provider).** The report API has no page-URL dimension: "Page URL" is only available in Data Warehouse and Data Feeds, and the "Page" dimension is the `pageName`, falling back to the page URL only when `pageName` is unset [VERIFIED: https://experienceleague.adobe.com/en/docs/analytics/components/dimensions/page-url, .../dimensions/page, .../implementation/vars/page-vars/pageurl]. Adobe's own recommendation for a URL dimension is to copy `hostname + pathname` into an eVar on every hit [VERIFIED: same pageurl page]. So the provider matches **the site's page-naming convention**, not a URL: it takes the shell's normalised page (`path` and its candidate paths: with/without trailing slash, folder path for `index`), maps each candidate through `pageValueTemplate` into a page value, deduplicates (at most 4), and looks them up in `pageDimension`. The default (`variables/page` with `{path}`) matches implementations whose `pageName` is the EDS path; sites with another convention set the template (for example `{host}:{path}`) or point `pageDimension` at the eVar that holds the path. The README states the three common conventions and how to discover the real one (Workspace freeform table of the Page dimension). [ASSUMPTION: no single naming convention can be assumed for EDS sites using AA; Open Question 2.]
8. **Report plan: three reports, executed as 1 then 2 in parallel.** (a) *Page totals and lookup*: a ranked report on `pageDimension` with a search clause that matches the candidate page values exactly (the `MATCH` operator; searches are case-insensitive [VERIFIED: https://developer.adobe.com/analytics-apis/docs/2.0/guides/endpoints/reports/search-filters]), metrics page views, visits, unique visitors, entries, bounces, at most 4 rows, sorted by page views. This yields the item ids of the matched page values and the range totals for each, with unique visitors correctly de-duplicated per row. If more than one value matches (for example case or trailing-slash variants recorded separately), **the row with the most page views is the page**; the others are ignored and the event is logged (Open Question 8: primary-only vs. summing). (b) *Daily trend*: a ranked report on the daily date dimension (`variables/daterangeday`), metric page views, restricted to the matched item by a **breakdown metric filter** on `pageDimension` and its item id [VERIFIED shape: .../reports/breakdowns], ascending by date, `return-nones`, limit 400 [VERIFIED settings: .../reports/kpi, .../reports/breakdowns]. (c) *Channels*: a ranked report on `sourceDimension`, metric visits, same breakdown filter, descending by visits, limit 10. Item ids are not guessed or cached across ranges; (a) always runs first. Cold cost: 3 requests. An inline ad hoc segment (the `segmentDefinition` filter exists in the request schema [VERIFIED: https://github.com/AdobeDocs/analytics-2.0-apis/blob/main/static/swagger.json]) was considered and rejected: its bounce/entry semantics under a hit-level container differ from the Workspace freeform table the owner will compare against [ASSUMPTION], and the breakdown form reproduces that table exactly. The rejected alternatives: one request per candidate value, and using `itemValue` in the breakdown filter (mentioned in prose in the breakdown guide but absent from the request schema, so unreliable).
9. **Metric definitions, stated in the README and mirrored in labels.** *Page views* = `metrics/pageviews`. *Visits* = `metrics/visits`. *Unique visitors* = `metrics/visitors`, de-duplicated over the range per page row. *Entries* = `metrics/entries`. *Bounce rate* = bounces / entries, computed in the provider from `metrics/bounces` and `metrics/entries` (a fraction `0..1`; `null` when entries are 0, never `NaN`/`Infinity`); Adobe defines it as "bounces divided by entries" [VERIFIED: https://experienceleague.adobe.com/en/docs/analytics/components/metrics/bounce-rate]. Computing it from two integers avoids guessing whether the API's `metrics/bouncerate` is a fraction or a percentage [OPEN: unit; checked in XA3]. The metric ids `visits`, `pageviews`, `visitors` are in Adobe's own example [VERIFIED: .../reports/overview]; `entries`, `bounces` and the dimension `variables/marketingchannel` come from a third-party catalogue [ASSUMPTION; verified against the report suite's own `GET /metrics` and `GET /dimensions` in XA3]. Average time on page / engagement time is **not** offered (no standard page-level metric identified; Open Question 6).
10. **Date ranges.** Same ids as the shell: `last7`, `last28` (default), `last90`, `custom` (start, end; at most 366 days, validated by the shell). The provider converts every range to **absolute dates in the suite time zone** and sends them as an inclusive absolute `dateRange` (`YYYY-MM-DDT00:00:00.000/YYYY-MM-DDT23:59:59.999`; both forms are documented [VERIFIED: .../reports/overview, .../search-filters]). Presets are "the N complete days before today" (end = yesterday), to match GA4's `NdaysAgo`..`yesterday` and the shell's preset meaning. "Today" comes from the injected clock and the configured `timeZone` (via `Intl`), so a browser or worker in another time zone cannot shift the window and tests are deterministic. Adobe's date *formulas* (`td-28d/td`) are evaluated in the suite time zone [VERIFIED: .../reports/overview, "Timezone behavior"] but their end-exclusivity is unstated, which is why absolute dates are used. [ASSUMPTION: absolute dates are interpreted in the suite time zone; checked in XA3.] The result carries absolute start, end and `timeZone` (the configured value).
11. **Normalisation.** Row values are aligned by `columnId` from the response's `columns`, not by position. The trend decodes each daily row's **`itemId`**, not its display `value`: the date is `(1900 + floor(id / 10000), floor(id / 100) mod 100 + 1, id mod 100)`, e.g. `1251028` = 2025-11-28, and the display label varies with the report suite's calendar [VERIFIED: https://developer.adobe.com/analytics-apis/docs/2.0/guides/endpoints/reports/advanced, "How the itemId encodes the date"]. The trend is ascending and **zero-filled** across the absolute range, and rows outside the range are dropped. Channel `share` = row visits / the report's total visits (`summaryData.totals` for the filtered column covers all rows, not just the returned ten, per the breakdown example in the docs), safe when the total is 0. Missing or non-finite numbers become `null`. A malformed response (missing columns, wrong types) is `502 upstream_unavailable`.
12. **Error mapping, within #2's closed error contract.** Adobe's gateway answers too many requests with `429` and body `{"error_code":"429050",...}` [VERIFIED: https://developer.adobe.com/analytics-apis/docs/2.0/guides/faq]. Mapping: AA `429` → `429 rate_limited` with `Retry-After` from the negative-cache remainder (Adobe is not documented to send `Retry-After`; no header is assumed); AA `401`/token-class `403` → token drop, one re-mint, then `500 misconfigured`; AA `403` with a permission/access error code (`insufficient_access`, `invalid_dimension_access`, `invalid_metric_access`, `invalid_access`, `authorization_error`, `invalid_client_id`, `insufficient_scope`: the enum of the error schema [VERIFIED: swagger.json `ReportErrorStatus`]) → `500 misconfigured` with a log line carrying the error *code only*; AA `400` (`invalid_parameters`, `invalid_json_input`, `invalid_request`) → `500 internal`; AA `5xx`, network error, timeout, and `206` ("partially successful: some response columns contain errors" [VERIFIED: swagger.json]) → `502 upstream_unavailable`. IMS token endpoint `4xx` → `500 misconfigured`, `5xx`/network → `502`, negative-cached. Upstream text never reaches the browser; only fixed template messages do.
13. **In-provider request limiter.** Because all authors share one server credential and Adobe's budget is 12 requests per 6 seconds per user [VERIFIED: .../guides/faq], the provider holds a sliding-window limiter per isolate: at most 10 AA requests per 6-second window (two of headroom), at most 3 in flight. A request that would have to wait longer than its remaining deadline fails fast as `429 rate_limited` with `Retry-After` = the wait; otherwise it waits (injected clock and sleep). This is per isolate only: several isolates can still exceed the account budget, which is why the shell's negative cache and the short per-isolate TTL remain the second line (Risk R3). A global limiter would need Durable Objects, which #33 puts out of scope.
14. **Retries.** AA report requests are `POST` but read-only, so the provider passes the "safe to retry" flag. Retry policy: **no in-request retry on `429`** (the limiter and the negative cache handle it; a retry cannot clear a 6-second window inside the deadline without risking the next window), at most **one** retry on `5xx`/network. The overall deadline is below the shell's browser-side wait (Risk R10). Adobe's own timeout at its gateway is 60 s [VERIFIED: .../guides/faq], so per-attempt timeouts are shorter than that.
15. **Caching and politeness.** The shell's cache provides the brief caching, the negative cache and single-flight (#33 Decision 15); the AA provider adds nothing to the key except what is needed for correctness (Decision 3a). Adobe's guidance: request once and cache, do not poll faster than 30 minutes, avoid per-page-load widget requests [VERIFIED: .../guides/faq]. Hence D-AA1 (TTL 1800 s) and the README note. Presets are keyed by id (not resolved dates), so an entry cached just before midnight in the suite time zone can show the previous day's window for up to one TTL; accepted and documented.
16. **Authorisation (who may call).** Same as #33 Decision 17: IMS token validated by the template, optional client-id allowlist, only mapped content sites are queryable, the company/report suite/dimension/metric/search are never client-chosen. The AA credential's product profile limits the report suites it can read; the README tells the administrator to scope it to the mapped report suites only. The optional `authorize` hook (DA read access) from #33 applies to this provider unchanged if the owner approves it there; this ticket adds no authorisation logic.
17. **Browser: unchanged.** The shell lists sources from the worker, so a site mapped to AA gets the AA tab with no browser change; the existing renderers handle the three section kinds. The browser sends the same five parameters (org, site, path, source, range) and nothing AA-specific. Repo check UA6 keeps AA hostnames and ids out of browser code.
18. **Observability.** The #33 structured log line plus: matched-row count (`aa_page_matches`), whether the token was cached or minted, AA status class per report, limiter wait. Never tokens, headers, bodies or page values of other users.
19. **Data handling.** Only aggregate counts, dates and channel labels are returned; nothing user-level is requested. The cache holds normalised results only.
20. **Tooling and CI: as decided.** Lives in `apps/insights-sidebar/providers/adobe-analytics/` (server code in its `worker/` subfolder, per #2 Decision 3), ESLint 8 + helix config, Stylelint 16, `node:test` for worker code, `@web/test-runner` and Playwright reused from the shell, Node >= 22.12, husky. No new dependency: the OAuth form POST and report JSON need none.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given a `Request` to the worker and a fake outside world, the `Response` and the *outbound requests Adobe would have received*. The fake Adobe has two parts: an IMS token endpoint that checks the form (grant type, client id, client secret, scopes) and issues tokens, and a Reports endpoint that answers only for a bearer token it issued and the right `x-api-key`, parses the request body (global filters, search clause, breakdown metric filters, metrics, dimension, limit), validates it against the documented request schema, and computes its answer from a small in-memory dataset (pages × days × channels). Computing the answer, rather than replaying fixtures only, lets tests assert numbers independently of the provider (for example that the trend sums to the page views). Never assert on internal helper names or call counts of internal functions. The standing negative properties apply everywhere: no client secret, access token or IMS token in any browser-visible byte or log; no request reaches Adobe from an unauthenticated, wrong-origin or invalid request; analytics strings render as text.

**Proposed seams** (recorded instead of asked, per #72; **no new seam is required**; everything reuses #33's seams):

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 (primary) | Worker HTTP boundary `worker.fetch(request, env, ctx)` | reused (#2, #33) | routes, shell cache with the AA provider, token, query, normalisation, errors, limiter | #2 test kit + the **fake Adobe** (new fixture, in this provider's tests); injected `fetch`/`sleep`/`random`/`now` |
| W1-C | #33 provider conformance suite parametrised by provider | reused | the AA provider runs the same suite as GA4 and the test-only second provider | provider-supplied scripted fake vendor = the fake Adobe |
| W2 | Worker in workerd over real HTTP (`wrangler dev`) | reused | smoke tier | fake IMS + fake Adobe on loopback; secret from a temp env file |
| S1 | Entry HTML page + SDK stub | reused | Playwright e2e | SDK stub, real local worker, fake Adobe |
| S2 | Render modules + SDK result | reused | WTR unit | injected `fetch`; AA-shaped result fixture |
| S3 | Repo convention check | reused, extended | CI lint job | temp-dir fixtures |

The real boundary (real Adobe IMS, a real report suite with data, real EW) is covered by manual verification only (Testing Requirements 5). **Modules tested:** site-config validator, page-value mapping, date/range resolution in the suite time zone, token mint/cache, report request builder, response normaliser, error mapping, limiter, provider registration/conformance, README-vs-config consistency, repo touch-list check.

**Prior art.** #33 spec: fake Google with a verifying token endpoint, conformance suite PC1-PC8, GC/GA/GQ/GN test families, SM-I and PW tiers. #2 spec: test kit, W1/W2 seams, canary secret. #1 spec: SDK stub, convention check. Upstream `adobe-rnd/ew-extensions` contains no analytics or worker code (see #33).

## Out of Scope

- Any change to the shell, the result schema, the section kinds, the routes or the cache beyond the registration line and the optional additive proposals D-AA1/D-AA2.
- Customer Journey Analytics (a different API and data model, https://developer.adobe.com/cja-apis/docs/) and Adobe Target (#35).
- Segments, calculated metrics, time spent / engagement metrics, anomaly detection, comparison periods, realtime, Data Warehouse and Data Feeds, commerce metrics, custom events, classifications, virtual report suites beyond what the same API call already accepts.
- Reading a DA site-config sheet for per-site settings (as #33).
- A global (cross-isolate) rate limiter, KV/Durable Objects, Cloudflare Cache API, cron pre-warming.
- JWT (service account) authentication, user-OAuth (3-legged) authentication, multiple AA credentials per worker or per site, multi-IMS-org mapping.
- Creating or changing tracking on the sites (the page-naming convention is configuration, not an implementation change).
- Authorisation against DA permissions unless the owner approves #33 Open Question 3.
- CI-driven deployment and Cloudflare/Adobe credentials in CI (as #2).
- The Adobe outside-activity/IP policy question (carried by #1 R1).

## Further Notes

- **Overlap risk is carried from #33** (scoring 4/5): first-party insights and EDS experimentation tooling may overlap; Adobe Analytics is the biggest enterprise source, which is why the provider split exists.
- **Documentation drift.** Adobe's developer docs are rewritten often (several pages read for this spec carry 2026 dates and some formerly documented pages 404). The API base `https://analytics.adobe.io/api/{global-company-id}/reports` and the Reports request shape are stable across the pages read [VERIFIED]. Pin the base URL in one place.
- **Data latency.** Complete data is typically visible about 2 hours after collection (30-90 minutes of batching and transfer; timestamped hits up to 15 minutes to 24 hours) [VERIFIED: https://experienceleague.adobe.com/en/docs/analytics/technotes/latency]. Manual verification therefore seeds data hours ahead (XA2).
- **Low-Traffic.** Past a per-dimension, per-report-suite, per-month threshold (2,000,000 unique values by default) further values are bucketed as "Low-Traffic" [VERIFIED: https://experienceleague.adobe.com/en/docs/analytics/technotes/low-traffic]. A page whose value falls into the bucket cannot be found; the panel shows `empty`. High-cardinality `pageName` implementations (full URLs with query strings) are the likely cause; the README covers it.
- **`ref=local` and branch refs** concern where extension code is served, not which data is shown (#33). The numbers are always the mapped report suite's.
- **Cross-spec consistency.** Placement (`providers/adobe-analytics/worker/`), the secret-handling rules, the S3 checks, the SDK stub and the manual steps follow #1, #2 and #33; test ID families are prefixed `A` to avoid collisions with #33's `PC/IR/GC/GA/GQ/GN`.

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)
 └─ editor library -> iframe: Insights   (unchanged shell from #33)
       │  GET {worker}/insights/sources?org&site                              Authorization: Bearer <IMS token>
       │  GET {worker}/insights/adobe-analytics?org&site&path&range[&start&end]
       ▼
Cloudflare Worker "insights-sidebar worker"  (apps/insights-sidebar/worker; core from shared/worker-template)
   1 origin gate + preflight -> 2 IMS token check -> 3 route: validate -> site mapping (AA_SITES) -> registry lookup
   4 shell cache (hit | coalesced | miss | negative hit)
   5 provider "adobe-analytics" (providers/adobe-analytics/worker):
        map page -> page values; resolve range in suite tz; limiter;
        token (cached | mint)  ->  report A (page lookup + totals)  ->  reports B (trend) ∥ C (channels)
   6 normalise -> shell validates result schema -> respond
       │
       ├─ POST https://ims-na1.adobelogin.com/ims/token/v3              (client_credentials; secret AA_CLIENT_SECRET)
       └─ POST https://analytics.adobe.io/api/{companyId}/reports       (Bearer + x-api-key)
```

| Concern | Browser extension (static, public) | Worker (private runtime, holds secrets) |
|---|---|---|
| Client secret, access token | never | only place (secret store, isolate memory) |
| Company, report suite, time zone, page naming | never chosen | resolved from configuration by org/site |
| Report definition (dimensions, metrics, filters, limits) | none | provider-owned constants + validated config |
| Page identity | sends `context.path` as given | normalised by the shell; provider maps to page values |
| Range | sends preset id or dates | provider converts to absolute dates in the suite time zone |
| Quota (12 req / 6 s per user) | shows the message | limiter, negative cache, no 429 retry |
| Caching | none | shell cache, single-flight, negative cache; token cache in provider |
| Rendering, formatting, accessibility, states | all (unchanged) | none |

## 2. EW integration points

- **Library plugin, no new config-sheet row.** Adobe Analytics is a *source inside* the existing "Insights" library plugin. The `library` row from #33 (`title` Insights, `path` `/apps/insights-sidebar/insights-sidebar.html`) stays exactly as is [VERIFIED columns: https://www.aem.live/docs/ew/administering/set-up-library; row semantics per the #33/#1 specs]. No `apps` row. No change to the README extensions table (the extension row exists; its description may add "Adobe Analytics"). [ASSUMPTION: one extension, several providers, as #33 states.]
- **SDK data used:** `token` and `context.org`/`site`/`path` only (as #33). No SDK actions.
- **`ref=local` loop:** extension page at `http://localhost:3000` calls the local worker at `http://localhost:8787`; locally the AA secret is a real client secret in an untracked `.dev.vars`, or, hermetically, the fake-Adobe overrides with a throwaway secret. **Branch ref:** `?ref=<branch>` loads the page from `{branch}--{site}--{org}.aem.live` (or `.preview.da.live`) and calls the **deployed** worker. The shell is already exercised on both topologies by #33; this provider adds only server-side behaviour, so AC5 is proven by the same topology tests with the AA provider enabled.
- **Site configuration read:** none from DA. Per-site AA settings are in the worker variable `AA_SITES` (Build Analysis 4). The README states "reads no DA site config".

## 3. External APIs and auth flows

| API | Use | Auth | Primary source |
|---|---|---|---|
| Adobe Analytics 2.0 Reports `POST https://analytics.adobe.io/api/{global-company-id}/reports` | ranked and date-trended reports; a request without a `dimension` returns `summaryData` only | `Authorization: Bearer`, `x-api-key` (client id) | https://developer.adobe.com/analytics-apis/docs/2.0/guides/endpoints/reports/ and `.../reports/overview` (request shape, headers); request schema: https://github.com/AdobeDocs/analytics-2.0-apis/blob/main/static/swagger.json (`RankedRequest`, `ReportFilter`, `ReportSearch`, `ReportMetric`, `RankedSettings`; `200`, `206`, `400`) |
| Date range formats (absolute `start/end` ISO 8601, formula, mixed); formulas evaluated in the suite time zone | resolve ranges | n/a | https://developer.adobe.com/analytics-apis/docs/2.0/guides/endpoints/reports/ |
| Search filters: `search.clause` (`MATCH`, `CONTAINS`, `BEGINS-WITH`, `ENDS-WITH`, `AND`/`OR`/`NOT`, single-quoted strings, case-insensitive, `*` glob) | find the page value(s) | n/a | https://developer.adobe.com/analytics-apis/docs/2.0/guides/endpoints/reports/search-filters |
| Breakdowns: `metricFilters` of `type: breakdown` with `dimension` and `itemId` referenced by a metric's `filters` | restrict trend and channels to the matched page | n/a | https://developer.adobe.com/analytics-apis/docs/2.0/guides/endpoints/reports/breakdowns |
| Date-trended report and itemId date encoding | trend | n/a | https://developer.adobe.com/analytics-apis/docs/2.0/guides/endpoints/reports/kpi , `.../reports/advanced` |
| Discovery `GET https://analytics.adobe.io/discovery/me` | find `globalCompanyId` (setup only, not at runtime) | Bearer + `x-api-key` | https://developer.adobe.com/analytics-apis/docs/2.0/guides/endpoints/discovery |
| Metrics / Dimensions listing `GET .../api/{company}/metrics?rsid=` and `.../dimensions?rsid=` | verify ids per report suite (manual XA3) | same | https://developer.adobe.com/analytics-apis/docs/2.0/guides/endpoints/metrics/ ; dimensions: swagger.json |
| Adobe IMS token `POST https://ims-na1.adobelogin.com/ims/token/v3` (form: `client_id`, `client_secret`, `grant_type=client_credentials`, `scope`) -> `{access_token, token_type, expires_in}`; tokens "usually expire in 24 hours"; cache them; Adobe may throttle excessive minting | token | client id + secret | https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/ims and `.../implementation` |
| OAuth Server-to-Server credential setup (Developer Console project, product profiles, up to 2 client secrets for rotation, rotate in UI or via I/O Management API) | setup, rotation | n/a | https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/ , `.../implementation`; AA entry: https://developer.adobe.com/analytics-apis/docs/2.0/guides/ (permissions via Admin Console product profile; JWT deprecated) |
| Rate limit / timeout / best practices | limiter, cache | n/a | https://developer.adobe.com/analytics-apis/docs/2.0/guides/faq (12 requests per 6 s per user; `429` body `{"error_code":"429050"}`; 60 s timeout; do not poll faster than 30 min; avoid per-page-load widget calls) |
| Page, Page URL, `pageName`, `pageURL`, Bounce rate, Marketing channel, Data latency, Low-Traffic | semantics | n/a | https://experienceleague.adobe.com/en/docs/analytics/components/dimensions/page , `.../dimensions/page-url` , `.../implementation/vars/page-vars/pageurl` , `.../components/metrics/bounce-rate` , `.../components/dimensions/marketing-channel` , `.../technotes/latency` , `.../technotes/low-traffic` |
| Data Insertion API (test data only) | seed a dev report suite for manual verification: `GET https://{tracking-host}/b/ss/{rsid}/1/{token}?AQB=1&g=...&pageName=...&AQE=1` with visitor id (`mid`/`aid`/`vid`) | none beyond a valid tracking host | https://developer.adobe.com/analytics-collection-apis/methods/data-insertion/ and `.../variable-reference` |
| Cloudflare Workers secrets, limits | as #2/#33 | n/a | https://developers.cloudflare.com/workers/configuration/secrets/ , https://developers.cloudflare.com/workers/platform/limits/ |

**Auth flow (caller to worker):** unchanged from #2/#33. **Auth flow (worker to Adobe):** read `AA_CLIENT_SECRET` through the secrets accessor and `AA_CLIENT_ID`/`AA_SCOPES` from vars -> if no valid cached token (more than five minutes to expiry), single-flight `POST` to the IMS token endpoint -> cache `access_token` + expiry, register the token for redaction (D2) -> call the Reports endpoint with `Authorization: Bearer` and `x-api-key`. On `401` the token is dropped and minted once more; a second `401` is `misconfigured`.

**Unverified facts [OPEN]**, each resolved by a numbered manual step: (a) whether the 12 requests / 6 s limit is per API client (credential) or per human user, and how it behaves for a Server-to-Server credential [ASSUMPTION: per credential] (XA7); (b) whether absolute date ranges are interpreted in the suite time zone [ASSUMPTION] (XA3); (c) that `daterangeday` returns a row for every day with `return-nones` and that a no-dimension request returns `summaryData` totals [VERIFIED for the latter in docs; former ASSUMPTION] (XA3); (d) metric ids `entries`/`bounces` and dimension `variables/marketingchannel` in the real report suite (XA3); (e) bounces and entries under a page breakdown reproduce the Workspace freeform table (XA3); (f) the OAuth scope string for the credential (XA1); (g) that `MATCH` treats characters in real page values (spaces, `:`, `%`) as literals (XA3); (h) the unit returned by `metrics/bouncerate` (not used; XA3 records it); (i) that Adobe sends no `Retry-After` on `429` [ASSUMPTION from a third-party transcription of the FAQ, https://apis.io/rate-limits/adobe-analytics/adobe-analytics-rate-limits] (XA7); (j) that the report-suite path `.../reportsuites/collections/suites/{rsid}` with `timezoneZoneinfo` exists as the swagger lists it [VERIFIED in static/report-suites.json; not used at runtime, see Decision 6 and Open Question 9].

## 4. Data contracts

All contracts are behaviour contracts. Short JSON shows shape only.

**Routes: unchanged (#33).** `GET /insights/sources` lists `{"id":"adobe-analytics","label":"Adobe Analytics"}` for sites with an `AA_SITES` entry; `GET /insights/adobe-analytics?org=&site=&path=&range=...` returns the result. Errors are the #2 contract.

**Per-site configuration entry** (value in `AA_SITES`, key `org/site` of the *content* site):

| Key | Required | Meaning / default | Validation |
|---|---|---|---|
| `companyId` | yes | Adobe Analytics global company id (from `discovery/me`) | `^[A-Za-z0-9_-]{1,64}$` |
| `rsid` | yes | report suite id | `^[A-Za-z0-9_.-]{1,255}$` |
| `timeZone` | yes | IANA name of the suite's reporting time zone (e.g. `America/Los_Angeles`) | accepted by `Intl.DateTimeFormat` |
| `hostName` | no | production host; used for `{host}` and `page.host` | hostname pattern |
| `pageDimension` | no, `variables/page` | where page values live | `variables/page`, `variables/evar<1-250>`, `variables/prop<1-75>` |
| `pageValueTemplate` | no, `{path}` | how a normalised path becomes a page value | contains `{path}`; `{host}` needs `hostName`; no `'`, `\`, `*`; at most 200 chars |
| `sourceDimension` | no, `variables/marketingchannel` | traffic-source dimension | `variables/marketingchannel`, `variables/lasttouchchannel`, `variables/referringdomain` |

**Worker configuration (additive to the #2 and #33 tables).**

| Name | Meaning | Production | Local env |
|---|---|---|---|
| `AA_SITES` | JSON object, key `org/site`, value = entry above | owner-provided [OPEN Q1/Q2] | a fake company/report suite |
| `AA_CLIENT_ID` | OAuth client id (also the `x-api-key`); non-secret, still redacted | owner-provided | a fake id |
| `AA_SCOPES` | comma-separated scopes for the token request | default from Decision 4 [OPEN Q10] | same |
| `AA_API_ORIGIN`, `AA_TOKEN_ORIGIN` | override the two Adobe hosts | unset | loopback fakes; ignored/refused unless loopback and `ALLOW_LOCALHOST` |

**Secrets (`secrets.required`, additive):** `AA_CLIENT_SECRET`; listed in `.dev.vars.example`. JSON-object `vars` in wrangler: the #33 [ASSUMPTION] applies (fallback: JSON string).

**Report A (lookup + totals)** *(shape)*: `rsid`; one global `dateRange` (absolute, inclusive); `search.clause` = `MATCH '<value1>' OR MATCH '<value2>'` (at most 4); `dimension` = the page dimension; `metricContainer.metrics` = page views (sort desc), visits, unique visitors, entries, bounces, each with a `columnId`; `settings` = `limit` 4, `page` 0, `nonesBehavior` `exclude-nones`. Response rows give `itemId`, `value`, `data[]` aligned to `columns.columnIds`.

**Report B (trend)**: `dimension` = `variables/daterangeday`; one metric (page views) with `filters` referencing one `metricFilters` entry `{ type: breakdown, dimension: <page dimension>, itemId }`; `settings` = `limit` 400, `dimensionSort` `asc`, `nonesBehavior` `return-nones`.

**Report C (channels)**: `dimension` = the source dimension; one metric (visits, sort desc) with the same breakdown filter; `settings` = `limit` 10.

**Result (shape; `status: ok`)**: `source {id: adobe-analytics, label: Adobe Analytics}`; `page {path, host?}`; `range {id, start, end, timeZone}`; `generatedAt`; `cached`; `sections`: `stats` key `overview` (`pageViews`, `visits`, `visitors`, `entries`: integer; `bounceRate`: percent or `null`), `trend` key `pageViewsByDay` (integer points `{date, value}`), `table` key `channels` (columns `channel` text, `visits` integer, `share` percent); `notes` from `data_delay`, `other_row` only.

**Provider contract binding (behaviour):** `id` `adobe-analytics`; `label` `Adobe Analytics`; `secrets` `[AA_CLIENT_SECRET]`; `hosts` `[analytics.adobe.io, ims-na1.adobelogin.com]`; `siteConfig(entry)` = the validator above (`null` when the site has no entry); `fetch(ctx, { site, page, range })` = the report plan (Decision 8). `ctx` is used for `secret()`, `proxy()`, `redact()`, `now`, `log` and the cache adapter only.

## 5. Folder layout (fits the #1/#2/#33 convention)

```
apps/insights-sidebar/
├─ SPEC.md                                   (#33)
├─ README.md                                 gains one line in its provider list linking to this provider's README
├─ worker/
│   ├─ wrangler config · .dev.vars.example   gain AA_CLIENT_SECRET (secrets.required) and AA_* vars
│   └─ src/registry.js                       gains ONE entry: the adobe-analytics provider
└─ providers/adobe-analytics/
    ├─ SPEC.md                               this file
    ├─ README.md                             Adobe setup, site-config keys, page-naming conventions, metric definitions, Workspace cross-check, rotation, troubleshooting
    └─ worker/
        ├─ adobe-analytics.js                provider descriptor + fetch (report plan)
        ├─ site-config.js                    validation of the per-site entry (exports the key schema the README test reads)
        ├─ page-values.js                    candidate paths -> page values
        ├─ dates.js                          suite-time-zone range resolution, itemId date decoding, zero-fill
        ├─ adobe-auth.js                     OAuth client-credentials mint + cache + single-flight
        ├─ query.js                          report A/B/C builders
        ├─ normalize.js                      responses -> result sections
        ├─ limiter.js                        sliding-window request limiter
        └─ test/                             fake Adobe (token + reports over a dataset), fixtures, node:test tests
```

The `.hlxignore` already hides `**/worker/` and `**/test/`; the README stays public.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **No AA sandbox in hand.** Adobe Analytics is an entitlement-gated product; the owner's access, a dev report suite and an admin able to create an OAuth Server-to-Server credential are all unconfirmed. | High for manual verification, none for automated tiers | All automated tiers are hermetic (fake Adobe). Manual XA1-XA13 are blocked until Open Question 1 is answered; no free tier is assumed [ASSUMPTION]. |
| R2 | **Page identity.** The API has no URL dimension; the page value depends on each implementation's `pageName` (or an eVar). A wrong template shows `empty` for every page. | High | Configurable `pageDimension` + `pageValueTemplate`; README with the three common conventions and the Workspace table to discover it; `page.label` (D-AA2) or the matched value in logs; XA12 observes real names. |
| R3 | **Shared quota:** 12 requests / 6 s per user; all authors share one credential; per-isolate limiter cannot see other isolates. | Medium-High | Limiter, no `429` retry, shell negative cache, TTL (D-AA1), cold cost 3 requests; XA7 measures real behaviour; global limiter is out of scope (Open Question 13). |
| R4 | **Credential blast radius.** The S2S credential reads whatever its product profile allows; any authenticated Adobe user can call the worker for any *mapped* site (#33 R1). | High if a sensitive suite is mapped | Product profile scoped to mapped report suites only; mapping-only sites; client-id allowlist; optional DA-access `authorize` hook (#33 Q3). |
| R5 | **Token minting throttle:** Adobe may throttle excessive minting; isolates restart. | Low-Med | 24 h token cached with five-minute margin, single-flight; log mint vs cached; AT tests. |
| R6 | **Metric semantics differ from GA4** (visits, unique visitors, bounce = bounces/entries; breakdown semantics). | Medium | Distinct labels; README definitions; XA3 cross-check against a Workspace freeform table and the Oberon debugger's request JSON (https://developer.adobe.com/cja-apis/docs/endpoints/reporting/debugger/, linked from the AA reports overview). |
| R7 | **Low-Traffic bucketing** can hide a page or inflate "Low-Traffic" in the channels table. | Low-Med | `other_row` note; README; `empty` message. |
| R8 | **Data latency** (~2 h typical). | Low | `data_delay` note when today is in range; XA2 seeds hours ahead. |
| R9 | **Unverified API behaviours** (Build Analysis 3 list). | Medium | Marked [OPEN]/[ASSUMPTION]; resolved in XA1-XA3 before first release; the tests encode current assumptions in single, named places so a correction is a one-line change. |
| R10 | **Deadline budget.** A cold request is 3 sequential-then-parallel AA calls plus a possible token mint, each with a 60 s gateway timeout; the shell's browser wait is shorter. | Medium | Per-attempt and overall deadlines below the shell's wait [OPEN: read the real value from #33's implementation]; limiter fails fast; SM-A5 records timings. |
| R11 | **Dependencies on #33/#2 additions (D1, D2, per-status retries; optional D-AA1, D-AA2).** | Medium | Sequenced in the build plan; documented fallbacks; tests for secrecy run regardless. |
| R12 | **Docs vs behaviour drift** (Adobe pages move; two read pages 404 on 2026-11-16). | Low-Med | Cite stable pages; pin base URL; recorded-shape fixtures refreshed from the real suite in XA3. |
| R13 | **Customers on Customer Journey Analytics**, not AA. | Strategic | Out of scope; Open Question 12. |
| R14 | **Single credential per worker** ties all AA-mapped sites to one IMS org. | Low | Documented; multi-credential is out of scope. |
| R15 | **Cache key correctness** across sites with different report suites. | Medium (wrong data) | Decision 3a; test AHT5; confirm in #33 implementation. |

## 7. Ordered build plan (sized to #34's acceptance criteria)

0. **Prerequisites (owner):** #1, #2 and #33 landed (shell, registry, conformance suite, test kit, CI); #2/#33 D1/D2 and per-status retry caps agreed or fallback chosen; D-AA1/D-AA2 decided; for manual verification: an Adobe org with Analytics, a dev report suite, a Developer Console project with an OAuth Server-to-Server credential bound to a product profile, a Cloudflare account (Open Questions 1-3).
1. **Fake Adobe first** (the test seam): IMS token endpoint and Reports endpoint over an in-memory dataset, request-schema validation, scripted failures (`429`, `5xx`, `206`, `401`, permission `403`). Self-test: its own answers sum consistently.
2. **Site config and registration (AC3, AC4):** validator + exported key schema; provider descriptor; run #33's conformance suite red/green against the AA provider (ACF*, ACN*).
3. **Page mapping and dates (AC1):** page values, suite-time-zone range resolution, itemId decoding, zero-fill (APG*, ARG*).
4. **Auth (AC2, AC6):** token mint/cache/single-flight, redaction, errors (ATK*, AER* auth part).
5. **Query and normalisation (AC1):** reports A/B/C, result sections, notes (AQY*, ANM*).
6. **Limiter and error mapping (AC2):** ALM*, AER*.
7. **Through-the-shell tests (AC2, AC6):** routes, auth ordering, cache, steering with the AA provider enabled (AHT*).
8. **Worker configuration and registration line (AC3):** wrangler config (secret, vars), `.dev.vars.example`, one registry entry; README provider list.
9. **Provider README (AC4):** credentials setup, key table, naming conventions, definitions, cross-check, rotation; the README-vs-schema test (ACF8).
10. **Browser/e2e and smoke (AC1, AC3, AC5, AC6):** AA-shaped fixture through existing renderers (BU-A*), Playwright with two sources (PW-A*), workerd smoke (SM-A*).
11. **Repo checks and CI (AC3, AC7):** touch-list and isolation checks (UA*); AA tests plug into the existing jobs; no credentials in CI.
12. **Deploy and manual verification (AC1, AC2, AC5, AC6):** XA0-XA13 with a real report suite; record real page names, observed rate-limit behaviour and recorded response shapes in the PR and README.

---

# Testing Requirements

Fixtures and mocks: the #2 test kit (`makeEnv`, fake IMS key server, `signToken`, canary secret, injected `fetch`/`sleep`/`random`/`now`); the **fake Adobe** (Build Analysis 7 step 1) with two parts as in Testing Decisions; a **dataset** (page `/en/pricing` with 40 days of daily page views, visits, visitors, entries, bounces; three channels incl. one `Low-Traffic` variant; a second page differing only by trailing slash; a second report suite for the cross-site test); **recorded-shape fixtures** hand-built from the examples in Adobe's docs (first-calls, KPI and breakdown guides) and refreshed from the real suite in XA3. Time-dependent tests inject `now` and use three suite time zones (`America/Los_Angeles`, `UTC`, `Pacific/Auckland`) to expose boundary bugs.

## 1. Worker unit and contract tests (seam W1; `node:test`; no network, no Adobe account)

### 1.1 Site configuration and registration (AC3, AC4)

| ID | Behaviour asserted |
|---|---|
| ACF1 | A site with no `AA_SITES` entry: `siteConfig` returns `null`; the sources route omits the source; the result route answers `status: not_configured` and the fake Adobe sees zero requests |
| ACF2 | Valid minimal entry (`companyId`, `rsid`, `timeZone`) gets defaults (`variables/page`, `{path}`, `variables/marketingchannel`); a full entry round-trips |
| ACF3 | Invalid entries are `500 misconfigured` with a log line naming the key, never the value: unknown key, wrong type, bad `companyId`/`rsid` patterns, unparsable or non-IANA `timeZone`, `pageDimension`/`sourceDimension` outside the allowlist, template without `{path}`, `{host}` without `hostName`, template containing `'`, `\` or `*`, template over 200 chars |
| ACF4 | `AA_SITES` that is not valid JSON or not an object: `500 misconfigured`, no Adobe call |
| ACF5 | Registry: adding the provider is one entry; the sources route for a mapped site lists `adobe-analytics`; duplicate ids make startup fail (extends #33 PC8) |
| ACF6 | Hosts: the provider declares exactly `analytics.adobe.io` and `ims-na1.adobelogin.com`; a request to any other host through its `ctx.proxy` is refused and the fake sees nothing |
| ACF7 | Secrets: `AA_CLIENT_SECRET` is in the worker's `secrets.required` and in `.dev.vars.example`; a missing secret behaves as #2 US2 (`500 misconfigured`, name only) |
| ACF8 | **README parity:** the set of keys in the provider README's site-config table equals the validator's exported key schema (names, required/optional, defaults); the README documents every `AA_*` var and the secret |

### 1.2 Conformance (AC3, AC6)

| ID | Behaviour asserted |
|---|---|
| ACN1 | #33's conformance suite (descriptor PC1, schema PC2, secrecy PC3, host confinement PC4, no IMS token in `ctx` PC5, status/sections rules PC6, runtime guard PC7) passes for the AA provider with the fake Adobe as its scripted vendor |
| ACN2 | Secrecy canaries: the client secret, the minted access token and the client id are absent from every response body, header and captured log line, across success and every error path in 1.8 (requires D2), including a fake Adobe that echoes the bearer token or the posted form in an error body |
| ACN3 | `ctx` handed to the provider and every outbound request contain neither the caller's IMS token nor the inbound `Authorization` |
| ACN4 | Every result for the dataset validates against #33's schema: ok, empty, 1-day range, 90-day range, 366-day custom range, null bounce rate |

### 1.3 Page mapping (AC1)

| ID | Behaviour asserted |
|---|---|
| APG1 | Default template: `/en/pricing` and its candidates (`/en/pricing/`) map to page values equal to the paths; duplicates removed; at most 4 |
| APG2 | Template `{host}:{path}` with `hostName` gives `example.com:/en/pricing`; `index` document candidates map through the same template |
| APG3 | The search clause contains each candidate as an exact `MATCH` operand, joined by `OR`; never `CONTAINS`, `BEGINS-WITH`, regex or user-controlled operators; paths are never interpolated outside quotes |
| APG4 | Percent-encoded and unusual-but-valid path characters are sent as given (as GA4's IR7); the clause stays well-formed |
| APG5 | Case variants recorded as separate items: the item with the most page views is the page; the others are ignored; log `aa_page_matches` = count (Open Question 8) |
| APG6 | `pageDimension` `variables/evar12` is used both in the lookup `dimension` and in the breakdown filter `dimension` |

### 1.4 Date ranges (AC1)

| ID | Behaviour asserted |
|---|---|
| ARG1 | `last28` with injected `now` = 2026-11-16 12:00 in the suite time zone gives start 2026-10-19, end 2026-11-15, sent as `2026-10-19T00:00:00.000/2026-11-15T23:59:59.999`; `last7` and `last90` likewise |
| ARG2 | "Today" is computed in the **suite** time zone: at an instant that is already the 17th in `Pacific/Auckland` and still the 16th in `America/Los_Angeles`, the two configurations resolve different windows; the worker's and browser's own time zones are irrelevant |
| ARG3 | Day boundary and DST: the window across a DST change keeps whole calendar days; no day is dropped or duplicated |
| ARG4 | Custom range passes through as absolute inclusive; a single-day custom range works; the result `range` echoes absolute start/end and the configured `timeZone` |
| ARG5 | `data_delay` is present iff the end date is today or later in the suite time zone (custom range including today), absent for presets at normal times |
| ARG6 | Trend decoding: `itemId` `1251028` is 2025-11-28; `1120001` is 2012-01-01; the display `value` is ignored (a fixture with a non-Gregorian-looking label still decodes) |
| ARG7 | Zero-fill: omitted days appear with value 0; days outside the range are dropped; the series is ascending with exactly one point per day |
| ARG8 | Range input is trusted only after the shell's validation, but the provider rejects a range whose end precedes its start with `400 bad_request` (defence in depth) |

### 1.5 Token (AC2, AC6)

| ID | Behaviour asserted |
|---|---|
| ATK1 | Mint is a form `POST` to the token endpoint with `grant_type=client_credentials`, the client id, the client secret and the configured scopes; the fake verifies all four |
| ATK2 | The Reports call carries `Authorization: Bearer <minted token>` and `x-api-key: <client id>` and no inbound caller credential (the fake asserts both headers) |
| ATK3 | One mint serves many requests; a new mint happens once the injected clock is within five minutes of `expires_in`; the three reports of one request use one token |
| ATK4 | Concurrent cold requests share exactly one mint (single-flight) |
| ATK5 | Token endpoint `4xx` (`invalid_client`, `invalid_scope`) gives `500 misconfigured` (generic), log names the reason class only; `5xx`/network gives `502 upstream_unavailable` and is negative-cached |
| ATK6 | Reports `401` once: cached token dropped, one re-mint, one retry succeeds; `401` twice gives `500 misconfigured`; no loop |
| ATK7 | Rotating `AA_CLIENT_SECRET` (new env) is used by the next mint; the old secret is never sent again |
| ATK8 | Host overrides are honoured only in the local env; a non-loopback override is refused as `misconfigured` and nothing is sent |
| ATK9 | Cached token and secret are not in the shell's cached values (inspect the cache adapter) |

### 1.6 Query building (AC1)

| ID | Behaviour asserted |
|---|---|
| AQY1 | Exactly one request to `https://analytics.adobe.io/api/{companyId}/reports` per report (A, then B and C after A returns), for the mapped company and report suite |
| AQY2 | Report A: dimension = page dimension; metrics `pageviews`, `visits`, `visitors`, `entries`, `bounces` with unique `columnId`s; limit 4; sorted by page views; one global date range |
| AQY3 | Report B: dimension `variables/daterangeday`; one metric referencing a `breakdown` metric filter with the page dimension and the matched item id; limit 400, ascending, `return-nones` |
| AQY4 | Report C: dimension = source dimension; visits with the same breakdown filter; limit 10; sorted descending |
| AQY5 | Only the documented dimensions and metrics are ever requested; no user-level, no free-form, nothing from the browser; the request validates against the documented schema (fake validator) |
| AQY6 | If report A finds no row, B and C are **not** sent (cost and quota) and the result is `empty` |
| AQY7 | B and C run concurrently (the fake observes overlap) and respect the limiter |
| AQY8 | The Reports call carries no cookie, forwarded or inbound `Origin`/`Host` headers (#2 proxy rules) |
| AQY9 | The request body never contains the client secret or the token |

### 1.7 Normalisation (AC1)

| ID | Behaviour asserted |
|---|---|
| ANM1 | Stats equal the dataset's row values for the matched page (page views, visits, visitors, entries); mapping is by `columnId` and survives reordered `columnIds` |
| ANM2 | Bounce rate = bounces / entries as a fraction; entries 0 gives `null`; never `NaN`/`Infinity` |
| ANM3 | The sum of trend points equals the stats page views for the dataset (consistency across reports A and B) |
| ANM4 | Channels sorted by visits descending, at most 10, share = row visits / `summaryData.totals` of the filtered column, safe when 0; `(none)`/`None` preserved as labelled by Adobe |
| ANM5 | A `Low-Traffic` channel row adds the `other_row` note; no `sampled`/`thresholded`/`truncated` is ever emitted |
| ANM6 | Zero page views for the matched row, or no matched row, is `status: empty` with no sections |
| ANM7 | Malformed bodies (missing `rows`/`columns`, non-numeric data, wrong column count) give `502 upstream_unavailable`, no upstream text |
| ANM8 | `206` partial responses give `502 upstream_unavailable` and are not rendered partially |
| ANM9 | `page.path` is the normalised path; `page.host` equals `hostName` when configured and is absent otherwise |
| ANM10 | Notes and labels are fixed strings/codes; a hostile page value or channel label (`<img onerror>`) passes through as inert text (rendered inert in PW-A5) |

### 1.8 Errors and retries (AC2, AC6)

| ID | Behaviour asserted |
|---|---|
| AER1 | Reports `429` (body `error_code` `429050`) gives `429 rate_limited` with `Retry-After`, **no in-request retry** (the fake counts one call), and is negative-cached (a second request makes no Adobe call until the negative TTL passes) |
| AER2 | Reports `5xx`/network/timeout: one retry, then `502 upstream_unavailable`; negative-cached |
| AER3 | Permission/access error codes (`insufficient_access`, `invalid_dimension_access`, `invalid_metric_access`, `invalid_access`, `authorization_error`, `invalid_client_id`, `insufficient_scope`) give `500 misconfigured` with a log line carrying only the code; nothing upstream in the response |
| AER4 | `invalid_parameters`/`invalid_json_input`/`invalid_request` (`400`) give `500 internal` |
| AER5 | Unknown error body or non-JSON body: mapped by status class only |
| AER6 | A failure in report B or C (after A succeeded) fails the whole request (no partial results) and does not cache a success |
| AER7 | Each response uses only the #2 error codes; no provider-invented code |
| AER8 | Overall deadline: a slow fake exceeds the provider deadline and gives `502`; the deadline is below the shell's injected browser wait |
| AER9 | The `safe to retry` flag is set on report requests and not on the token request |

### 1.9 Limiter (AC2)

| ID | Behaviour asserted |
|---|---|
| ALM1 | With an injected clock, the 11th request inside a 6-second window waits until the window slides; ten are never exceeded (asserted on the fake's timestamps) |
| ALM2 | At most 3 requests are in flight at once |
| ALM3 | A request that would wait longer than its remaining deadline fails fast as `429 rate_limited` with `Retry-After` = the wait (rounded up) |
| ALM4 | Two concurrent cold page requests (6 reports) are served in order without exceeding the budget |
| ALM5 | The limiter is not consulted for the token mint (mint is not an Analytics API request) and does not affect cache hits |

### 1.10 Through the shell (routes, auth, cache) with the AA provider (AC2, AC6)

| ID | Behaviour asserted |
|---|---|
| AHT1 | No token: `401` with CORS headers for an allowed origin; the fake Adobe (token and reports) received **zero** requests; wrong-key token, expired token, disallowed origin: `401`/`403`, zero Adobe requests |
| AHT2 | **Client cannot steer:** `companyId`, `rsid`, `dimension`, `metrics`, `clause`, `segment` and any unknown parameter give `400` before any Adobe call; a mapped site always queries its configured company and report suite |
| AHT3 | Second identical request within the TTL: no Adobe call, `cached: true` with the original `generatedAt` (AC2 caching, via the shell cache) |
| AHT4 | After the TTL (injected clock) Adobe is called again; different range, path or site give different entries |
| AHT5 | **Cross-site isolation:** two content sites mapped to different report suites (and one with a different template) asking for the same path never share an entry and each sees its own dataset |
| AHT6 | N concurrent identical cold requests produce exactly one report A and one mint |
| AHT7 | A cached result is never served to an unauthenticated, wrong-origin or invalid-parameter request (checked after warming) |
| AHT8 | Unknown source id still `404`; with both GA4 and AA mapped the sources route lists both; one failing leaves the other working |

## 2. Browser unit tests (seam S2; WTR; unchanged shell)

| ID | Behaviour asserted |
|---|---|
| BU-A1 | The existing renderers draw an AA-shaped result fixture (stats with integer/percent, trend of integer points, table with channel/visits/share) with correct labels and formatting; **no renderer change is needed** (AC3) |
| BU-A2 | With sources `ga4` and `adobe-analytics` listed, the switcher shows both labels, each loads independently with the same five parameters (org, site, path, source, range), and one failing leaves the other rendered |
| BU-A3 | Hostile channel labels and notes render as literal text; unknown notes render a generic note (inherits BU7/BU11) |
| BU-A4 | The sent requests contain no AA-specific parameter and the IMS token appears only in the `Authorization` header (inherits BU2/BU8) |

## 3. Runtime smoke tier (seam W2; Node test driving `wrangler dev` locally; no Cloudflare login)

Real insights worker in workerd with `IMS_ORIGIN`, `AA_API_ORIGIN`, `AA_TOKEN_ORIGIN` at loopback fakes; the secret from a temp env file.

| ID | Behaviour asserted |
|---|---|
| SM-A1 | The worker with the AA provider bundles and starts; a bare request gets `401` |
| SM-A2 | Valid token + fake Adobe: `200` equal to the fixture; the fake verified the form fields of the token request produced in workerd |
| SM-A3 | The canary client secret and the minted token are absent from all responses (ACN2 over HTTP) |
| SM-A4 | Second identical request is served from cache (fake saw one report A) |
| SM-A5 | Records CPU/wall time and subrequest count for a cold request (mint + 3 reports) and a warm one, informational (cold = 4 subrequests, within the Free plan's 50) |

## 4. End-to-end tests (seam S1; Playwright, Chromium, hermetic: real local worker, fake IMS, fake Adobe)

Setup as #33 section 4: static server on 3000, worker on 8787 (local env), fakes on loopback, SDK stub with a library-shaped context, token signed by the test key, viewport 360x800. The test worker environment maps the content site to the AA dataset.

| ID | Behaviour asserted |
|---|---|
| PW-A1 | The panel shows an "Adobe Analytics" source with the dataset's numbers for `/en/pricing`; the fake received report A then B and C with the mapped company/report suite and the last-28-days absolute range (AC1, AC2) |
| PW-A2 | Switching to last 7 days and to a custom range shows new numbers; the fake saw the matching absolute ranges (AC1) |
| PW-A3 | Reload within the TTL shows the same numbers with the cached indicator; the fake saw no second report (AC2) |
| PW-A4 | SDK stub with no token, and with a token signed by another key: sign-in message; worker answered `401` readable through CORS; the fake Adobe received zero requests (AC6) |
| PW-A5 | Scan of page HTML, DOM text, storage and every network response for the IMS token (allowed only in the request `Authorization` header to the worker), the client secret and the minted access token: none present; hostile channel strings render inert (AC6) |
| PW-A6 | With GA4 also mapped the switcher offers both sources; with AA's fake failing, GA4 still renders; **no shell file was changed** to make AA appear (the e2e runs against the shell as shipped by #33; UA3 checks the diff) (AC3) |
| PW-A7 | Only expected hosts were contacted by the browser: static page, worker, SDK stub (never an Adobe host) (AC6) |
| PW-A8 | Unmapped site shows `not_configured`; AA quota error shows the "try again in N seconds" message; an unknown page shows the empty state |

## 5. End-to-end checks inside real Experience Workspace (manual; needs interactive Adobe login, a Cloudflare account, an Adobe Analytics company)

**Accounts and credentials needed (none in the repo):** GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, #1 M0); Adobe IMS identity with access to the DA org/site and config rights; Chrome; Cloudflare account with Wrangler login (#2 W0); **an Adobe organisation with an Adobe Analytics entitlement and a dedicated *development* report suite with a few thousand hits or a way to send some**; an Adobe admin who can give a Developer Console user the Developer role on an Analytics product profile (Admin Console: Products, Adobe Analytics, product profile, Developers) [VERIFIED procedure: https://developer.adobe.com/analytics-apis/docs/2.0/guides/]; a **Developer Console project with the Adobe Analytics API and an OAuth Server-to-Server credential** (client id, client secret, scopes) bound to that product profile, scoped to the dev report suite and the components needed; the **global company id** (Discovery API) and the report suite's **time zone**; a **test content site and published pages**; Analysis Workspace access to cross-check. Never paste a real IMS token or client secret into a ticket, chat or the repo.

- **XA0 (prereq):** #33's panel works with GA4 or the test-only provider on `ref=local`; `curl -i <worker>/insights/sources?org=x&site=y` returns `401`.
- **XA1 (credential):** create the project and credential; copy the exact **scopes** shown for the credential (resolves the scope assumption); mint a token by hand with the documented `curl` to the IMS token endpoint and check `expires_in`; call Discovery with that token to read the `globalCompanyId`; call `GET .../api/{company}/metrics?rsid=` and `.../dimensions?rsid=` and record the ids `metrics/pageviews`, `visits`, `visitors`, `entries`, `bounces`, `variables/page`, `variables/daterangeday`, `variables/marketingchannel` (resolves ids, R9d).
- **XA2 (seed, day D):** send hits to the dev report suite with the Data Insertion API (https://developer.adobe.com/analytics-collection-apis/methods/data-insertion/): several distinct visitor ids, a known number of page views for the test pages, fixed `pageName` per the chosen convention (and the same value in an eVar if testing `pageDimension`), a first-touch channel variety if possible (campaign tracking code / referrers; otherwise the default channels). Write down expected page views, visits, visitors, entries and bounces per page. Wait for processing (typically about 2 h; https://experienceleague.adobe.com/en/docs/analytics/technotes/latency). [ASSUMPTION: hits sent live land in "today"; timestamped hits need a timestamp-enabled suite.]
- **XA3 (ground truth):** in Analysis Workspace build a freeform table: **Page** rows, columns Page Views, Visits, Unique Visitors, Entries, Bounces, Bounce Rate, same date range; a line chart of Page Views by Day filtered to the page; a Marketing channel × Visits breakdown under the page. Use Adobe's Oberon debugger (linked from the reports overview) to copy Workspace's request JSON and compare with the request the provider sends (log redacted). Record: the numbers, the unit of `bounceRate` in the API, whether `daterangeday` returns zero days, whether absolute dates follow the suite time zone, whether `MATCH` is literal for the real page values (R9). Replace the recorded-shape fixtures with scrubbed real responses.
- **XA4 (deploy):** `wrangler secret put AA_CLIENT_SECRET`; set `AA_CLIENT_ID`, `AA_SITES` for the test site; deploy from `apps/insights-sidebar/worker/`; `curl` with a valid IMS token returns the result; without a token `401`; `Origin: https://evil.example` `403`; `?rsid=other` `400` (AC6).
- **XA5 (`ref=local`):** `npm start` + worker dev script with `.dev.vars` holding the real secret; open the document in the EW editor with `?ref=local`, open Insights, pick **Adobe Analytics**: numbers equal XA3 for last 28, last 7 and a custom range; DevTools shows the preflight `204`, `Authorization` only on worker calls, no client secret or token in any response (AC1, AC5, AC6).
- **XA6 (branch ref):** push a simple-named branch, wait for code sync; open with `?ref=<branch>`; the panel loads from the branch and calls the **deployed** worker; same checks as XA5; record the page's real `Origin` (AC5).
- **XA7 (cache and quota):** reopen within the TTL: logs show a cache hit and no Analytics requests; open ~15 distinct pages/ranges within a few seconds: the limiter queues, then the UI shows "try again in N seconds" without a burst of Adobe `429`s; note whether Adobe ever sends `429`, whether it sends `Retry-After`, and whether the limit is per credential (R3, R9a/i) (AC2).
- **XA8 (secret hygiene and rotation):** search responses, page source and storage for the client secret and token; `wrangler secret list` shows names only; add a second client secret in the Developer Console (Adobe allows two), `wrangler secret put` it, confirm the panel works after the worker restarts or the cached token expires, delete the old secret (AC6).
- **XA9 (negative: access revoked):** remove the report suite from the product profile (or the credential): the panel shows "analytics is not set up correctly", logs show the Adobe error code, nothing upstream reached the browser; restore (AC6).
- **XA10 (states):** an unknown or unpublished path shows the empty state; a site not in `AA_SITES` shows not-configured; a wrong worker URL shows the retry message and the editor stays usable.
- **XA11 (two sources):** with GA4 also mapped, the switcher offers both; break the AA secret: GA4 still renders (AC3).
- **XA12 (page-name conventions):** open nested documents, an `index` document and a document with a hash; note `context.path` and the real page values in the report suite; confirm the candidate/template rules match each; fix the README conventions or add a template example if not (resolves R2, Open Question 2).
- **XA13 (README walk-through):** a reviewer follows the provider README from a clean clone to a working Adobe Analytics source on a scratch site, using only what it says (AC4).

## 6. Repo checks (seam S3, extended; temp-dir fixtures)

| ID | Behaviour asserted |
|---|---|
| UA1 | The provider folder exists with `SPEC.md`, `README.md` and `worker/` containing tests; every registry entry resolves to a provider folder and vice versa (extends #33 UI4) (AC3, AC4) |
| UA2 | The provider README has the required sections (credentials, site-config keys, page-naming conventions, metric definitions, cross-check, rotation); runs ACF8's parity check in the lint job (AC4) |
| UA3 | **Touch-list:** outside `providers/adobe-analytics/`, the strings `adobe-analytics`, `analytics.adobe.io`, `ims-na1.adobelogin.com` and `AA_` may appear only in the registry module, the worker configuration, `.dev.vars.example` and the README provider list; a fixture that references them from a route, cache or browser file fails (AC3) |
| UA4 | #2/#33 rules apply: `AA_CLIENT_SECRET` in `secrets.required` and `.dev.vars.example`; no secret-named key in `vars` (`AA_CLIENT_ID`, `AA_SITES`, `AA_SCOPES` allowed); no tracked `.dev.vars*`; `.hlxignore` hides the provider's server code and tests (AC6) |
| UA5 | The provider imports nothing from the shell except the documented contract/test-support exports; the shell imports providers only through the registry (extends #33 UI3) (AC3) |
| UA6 | Browser code (outside `worker/` and `providers/*/worker/`) contains no Adobe hostname, company id or report suite id (AC6) |

## 7. CI additions (no credentials, no Cloudflare login, no Adobe account)

No new jobs: the provider's tests plug into the existing #1/#2/#33 jobs on every push and PR.

| Job | Gains |
|---|---|
| `lint` | ESLint/Stylelint over the provider (worker override); S3 UA1-UA6 and ACF8 |
| `unit` | BU-A1-BU-A4 (WTR) |
| `worker-unit` | ACF*, ACN*, APG*, ARG*, ATK*, AQY*, ANM*, AER*, ALM*, AHT* (`node:test`, `providers/adobe-analytics/worker/test` and the shell's conformance suite) |
| `worker-smoke` | SM-A1-SM-A5 (workerd; advisory if flaky, per #2 Open Question 11) |
| `e2e` | PW-A1-PW-A8 (Chromium) |

## 8. Acceptance-criteria traceability (ticket #34)

| # | Acceptance criterion (#34) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Opening the plugin on a page shows Adobe Analytics metrics for that page's URL over a selectable date range | APG1-APG6 (page identity), ARG1-ARG8 (ranges, time zone, trend dates), AQY1-AQY8 (report plan), ANM1-ANM6 and ANM9 (metrics, trend, channels, states), BU-A1, PW-A1, PW-A2, PW-A8 | **XA3** (ground truth), **XA5**, **XA6**, **XA12** (real page names) |
| AC2 | Metrics fetched by the worker with server-held credentials and cached briefly | ATK1-ATK4 and ATK6 (token and credential use in the worker), AQY1, ALM1-ALM5, AER1-AER2, AHT3-AHT6 (cache TTL, negative cache, single-flight, cross-site isolation), SM-A2, SM-A4, PW-A1, PW-A3 | **XA4** (secret in the store), **XA7** (cache hit, quota behaviour), **XA8** |
| AC3 | Added inside the existing `insights-sidebar` folder as a new provider; no shell changes beyond registering | ACF5, ACF6, ACN1, ACN3, ACN4 (conformance), BU-A1, BU-A2, PW-A6, UA1, **UA3**, UA5 | Review: PR diff outside `providers/adobe-analytics/` limited to the registry line, worker config, `.dev.vars.example` and README provider list; **XA11** |
| AC4 | Extension README documents this vendor's setup (credentials, site config keys) | ACF8, UA2 (README sections and key parity), UA1 | **XA13** (README walk-through from a clean clone); review: README links the provider README, states "reads no DA site config; per-site settings in `AA_SITES`" |
| AC5 | Works in EW with `ref=local` and with a branch ref | PW-A1-PW-A8 and SM-A1-SM-A5 run against the `localhost:3000` + local worker topology (the `ref=local` setup); the provider adds no browser code (BU-A4, UA6) | **XA5** (`ref=local`), **XA6** (branch ref, deployed worker, observed `Origin`) |
| AC6 | Vendor credentials only in the worker (shared template); browser never receives them; unauthenticated calls rejected | AHT1, AHT2, AHT7 (auth ordering, steering, cache gating), ACN2, ACN3, ATK9, AQY9, SM-A3 (secret and derived-token secrecy), BU-A4, PW-A4, PW-A5, PW-A7, UA4, UA6 | **XA4** (curl: no token `401`, evil origin `403`, steering `400`), **XA8** (hygiene, rotation), **XA9** (revocation) |
| AC7 | Core logic covered by unit tests; lint and CI green | Sections 1-4 are the core-logic tests and run in the section-7 jobs | Review: CI green on the PR (all jobs); a deliberately broken rule on a scratch branch (for example add a `CONTAINS` operator to the search clause, or send the secret in the query) turns APG3/AQY5/ACN2 red |

Every acceptance criterion on #34 maps to at least one automated test or a numbered manual verification step above.

## 9. Open questions for the owner

1. **Adobe Analytics access (R1).** Do you have an Adobe org with an Analytics entitlement, a dedicated dev report suite, and an admin who can create an OAuth Server-to-Server credential bound to a product profile? Under which Adobe org and account? If not, manual steps XA1-XA13 are blocked (automated tiers are unaffected); is a customer-provided suite acceptable for verification?
2. **Page naming convention (R2).** How do your sites' AA implementations populate `pageName`: path, `host:path`, the page title, or something else? Recommended: have the implementation copy `hostname + pathname` into an eVar (Adobe's own recommendation) and set `pageDimension` to it; or agree a `pageValueTemplate`. Which default do you want in the README?
3. **Credential scoping.** One credential per worker, bound to a product profile that can read only the mapped report suite(s): acceptable? Who creates and owns it?
4. **Cache TTL (D-AA1).** Approve the optional `cacheTtlSeconds` descriptor member in #33 (AA wants 1800 s per Adobe's polling guidance), or accept the shell's 300 s for all sources?
5. **Authorisation depth.** Same as #33 Question 3: v1 = authenticated Adobe user + client-id allowlist + mapped sites only, or approve the DA read-access `authorize` hook before mapping any real suite? The AA credential can read real business data, so the recommendation is to approve the hook before mapping a production suite.
6. **Metric set.** Page views, visits, unique visitors, entries, bounce rate (bounces / entries): confirm. Do you want average time on page / engagement? That needs a calculated metric or another component the owner names; a config key for a calculated-metric id would be a small follow-up.
7. **Traffic-source dimension.** Marketing channel (default; depends on the suite's channel processing rules) vs referring domain vs last-touch channel: which default?
8. **Multiple matching page values.** Use the highest-page-view item only (this spec) or sum additive metrics across matches? (Unique visitors cannot be summed.)
9. **Time zone.** Required in configuration (this spec; no extra API call, no extra failure mode) or auto-discovered from the report suite's metadata (one cached call per suite)? Recommended: configuration.
10. **Scopes.** Please copy the exact scope string shown on the credential in the Developer Console (the default here comes from a third-party catalogue).
11. **Contract additions in #33.** Approve D-AA1 and D-AA2 (`page.label`), and confirm the shell cache key includes the content-site key, `page.host` optionality and which range fields providers may rely on (Decision 3).
12. **Customer Journey Analytics.** Are any of your sites on CJA instead of Adobe Analytics? That needs a different provider (different API and data model).
13. **Rate-limit sharing.** Accept the per-isolate limiter plus negative cache plus a user-visible "try again" (this spec), or do you want a global limiter (Durable Object; outside the current platform scope)? What traffic do you expect?
14. **Overlap and sequencing (#33 Q12).** Before investing further in #34/#35: have the EW team said whether first-party page insights are planned?
