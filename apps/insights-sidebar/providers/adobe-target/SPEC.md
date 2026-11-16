# Spec: Insights & Experiment Sidebar: Adobe Target experiments (provider)

Ticket: jazhou-adobe/ew-extensions#35 (this spec: #73). Blocked by #33 (sidebar shell + GA4; spec in `apps/insights-sidebar/SPEC.md`), which is itself blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). #35 sits beside #34 (Adobe Analytics source); no spec for #34 existed when this was written (`apps/insights-sidebar/` held only `SPEC.md`), so nothing here depends on it. #35 blocks nothing.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1, #2 and #33 specs): **[VERIFIED]** = read in a primary source (URL given) or observed on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Cloudflare.

Vocabulary follows #1, #2 and #33: *extension* = one folder `apps/<name>/` (here the **library plugin** `insights-sidebar`, registered by a row in the `library` tab); *worker* = the per-extension backend `apps/insights-sidebar/worker/` built from `shared/worker-template/`; *provider* = one vendor under `apps/<extension>/providers/<vendor>/`; *source* = a provider as seen by the author in the sidebar; *insights result*, *section* (`stats`, `trend`, `table`), *note codes*, *content site* (the DA org/site of the page being edited), *conformance suite* and *registry* as defined in #33; *IMS token* = the Adobe IMS access token the DA App SDK hands the page. Terms specific to this ticket:

- **Target tenant** = the account identifier in the Target URL subdomain (`https://<tenant>.experiencecloud.adobe.com/...`); it appears in every Admin API path and is different from the Target `clientcode` [VERIFIED: https://experienceleague.adobe.com/en/docs/target-dev/developer/api/configure-authentication, "Test the bearer access token", step 8 note].
- **Activity** = a Target test or personalisation. This ticket handles **A/B** (`ab`) and **Experience Targeting** (`xt`); **variant** = what Target calls an *experience* inside an activity.
- **Catalog** = the worker's in-memory index of a tenant's live and scheduled activities with their variants and page-URL conditions. **Page-URL condition** = a `page`/`url` leaf inside an audience's `targetRule`. **Match reason** = why an activity is shown for a page: `url` (a page-URL condition matches), `pinned` (the site config pins it to the path) or `sitewide` (no page-URL condition at all, shown only when enabled).
- **Technical account credential** = the Adobe Developer Console project credential (OAuth Server-to-Server) the worker uses to call Target; it is not a person's token.

---

## Problem Statement

An author editing a page in Experience Workspace (EW) cannot tell whether that page is part of a running Adobe Target experiment. The page may be showing different content to different visitors, a test may be about to end, or a variant may be winning, and none of this is visible in the editor. To find out the author opens Target, filters hundreds of activities by name, opens each one, works out whether its audience rules touch this page, and reads the report. Authors rarely do this, so they edit pages that are under test without knowing it, and experiment owners find out afterwards.

For the maintainer the problem is structural. Target's Admin API needs an Adobe technical-account credential (client id and secret) that gives read access to the whole tenant. That cannot ship in public static files, and any browser-side shortcut would hand a tenant-wide credential to every visitor of the code bus. Target also has **no "activities for this URL" query**: the list endpoint filters by mbox, offer and view but not by page URL [VERIFIED: https://raw.githubusercontent.com/AdobeDocs/target-developers/main/src/admin-api.json, `GET /{tenant}/target/activities` parameters], so the page-to-activity link has to be derived, and its limits must be visible to the author rather than hidden.

## Solution

**Adobe Target** becomes a second source in the existing **Insights** library panel, next to Google Analytics 4 (the source switcher the shell already shows when more than one source is enabled). Opened on a page, the Target tab shows:

- a short overview (how many activities were found for this page, how many live activities could not be checked);
- a table of the activities that apply to the page: name, type, status (live or scheduled), why it matched, visitors and the best variant's conversion lift;
- for each activity, a variant table: variant name, traffic split, visitors, conversions, conversion rate and the lift against the control variant.

Behind it, the same worker that serves GA4 gains one provider module. The worker holds the Adobe Developer Console client secret, mints and caches the Adobe access token, builds a short-lived catalog of the tenant's live and scheduled A/B and XT activities (activity list, activity definitions and the audiences they reference), decides which activities apply to the page from the audiences' page-URL conditions (plus optional per-site pins), fetches Target's performance report for the matched live activities, computes conversion rate and lift, and returns the vendor-neutral result the shell already knows how to render. The browser still receives only the normalised result.

It is added **inside the existing extension folder** as `providers/adobe-target/`, registered with one line in the worker's registry, plus its secret and settings in the worker configuration. The shell, routes, cache, contract and renderers do not change.

## User Stories

Content author (EW user):

1. As a content author, I want an "Adobe Target" tab in the Insights panel, so that I can see experiment information without leaving EW.
2. As a content author, I want the Target tab to appear only for sites that are connected to Target, so that I am not shown a source that cannot work.
3. As a content author, I want to see which Target activities apply to the page I am editing, so that I know whether the page is under test.
4. As a content author, I want each activity's name, so that I can find it in Target or ask its owner.
5. As a content author, I want each activity's status (live or scheduled), so that I know whether visitors are seeing it now.
6. As a content author, I want each activity's type (A/B test or Experience Targeting), so that I know whether traffic is split or targeted.
7. As a content author, I want to see why an activity matched (a page-URL rule, a pinned path, or "all pages"), so that I can judge how certain the match is.
8. As a content author, I want the variants of each activity, so that I know what is being compared.
9. As a content author, I want each variant's traffic split, so that I know how many visitors see it.
10. As a content author, I want visitors and conversions per variant, so that I can see how much evidence exists.
11. As a content author, I want each variant's conversion rate, so that I can compare variants.
12. As a content author, I want the conversion lift of each variant against the control, so that I can see which one is ahead.
13. As a content author, I want a missing or undefined lift shown as an empty value rather than zero or an error, so that I do not misread "no data" as "no difference".
14. As a content author, I want a negative lift shown as a negative number, so that a losing variant is visible.
15. As a content author, I want the section titles to say the numbers are cumulative since the activity started, so that I do not assume they follow the date range control.
16. As a content author, I want a visible count of live activities that could not be checked against this page (unsupported types, rules the panel cannot read, or a catalog still loading), so that "none found" is not mistaken for "none exist".
17. As a content author, I want a note when the list was truncated to the most relevant activities, so that I know there are more.
18. As a content author, I want a clear "no Target activities found for this page" message, so that I can tell a page without tests from a broken panel.
19. As a content author, I want a clear "Target is not set up for this site" message with who to ask, so that I do not think the panel is broken.
20. As a content author, I want a clear "your session expired, reopen the panel" message, so that an expired sign-in does not look like missing data.
21. As a content author, I want a "try again" action on temporary failures, so that I can recover without reloading EW.
22. As a content author, I want a "too many requests, try again in N seconds" message when Target or Adobe throttles, so that I know to wait.
23. As a content author, I want one failing source not to blank the others, so that a Target outage does not hide GA4.
24. As a content author, I want to see when the numbers were generated and whether they came from the short-lived cache, so that I can judge freshness.
25. As a content author, I want the panel to show the host and path it matched against, so that I can verify it found my page.
26. As a content author, I want the panel to be readable in the narrow library column with a keyboard and a screen reader, so that it is usable by everyone (inherited from the shell).
27. As a content author, I want opening the Target tab never to change my document or my Target activities, so that it is safe.

Extension maintainer / site owner:

28. As the maintainer, I want the Adobe client secret to live only in the worker's secret store, so that the public repo, the browser and the EDS code bus never contain it.
29. As the maintainer, I want the minted Adobe access token, which is derived from the secret, redacted from every response and log, so that "never echoed" covers more than the stored string.
30. As the maintainer, I want unauthenticated calls to the Target route rejected with `401` before any Adobe call, so that nobody can use my credential to read my experiments.
31. As the maintainer, I want the browser unable to choose the tenant, workspace, activity id or pin, so that a crafted request cannot read a tenant I did not map to a site.
32. As the maintainer, I want the site-to-tenant mapping and per-site Target settings in worker configuration, so that onboarding a site is a config change and not a code change.
33. As the maintainer, I want the worker to only ever send read (`GET`) requests to Target, so that the credential can never change or delete an activity through this extension.
34. As the maintainer, I want the activity catalog and the performance reports cached briefly, so that opening the panel repeatedly does not exhaust Adobe's API capacity.
35. As the maintainer, I want one in-flight catalog build shared by concurrent requests, so that several authors opening pages cost one build.
36. As the maintainer, I want the catalog build to stay inside a fixed upstream call budget per invocation and to continue on the next request, so that a large tenant does not exceed the worker platform's subrequest limit.
37. As the maintainer, I want outbound calls confined to Adobe's two hosts, so that a bug cannot turn the worker into an open proxy.
38. As the maintainer, I want the credential created as an OAuth Server-to-Server credential, so that I do not build on the deprecated Service Account (JWT) credential.
39. As the maintainer, I want local development against a fake Target on loopback, so that I never need a real Adobe credential to run the tests or the dev loop.
40. As the maintainer, I want the extension README to document this vendor's setup (Developer Console project, secret, scopes, settings keys, Target role), so that onboarding a tenant is copy-paste.
41. As the maintainer, I want adding Target to touch only the provider folder, one registry line, the worker configuration and the READMEs, so that the shell stays stable.
42. As the maintainer, I want the matching rules and their known limits documented, so that authors and reviewers understand what "applies to this page" means.
43. As the maintainer, I want to pin an activity to a path in configuration when its page targeting cannot be read from Target, so that a page can still be associated with an activity deterministically.
44. As the maintainer, I want sitewide activities (no page-URL condition) hidden by default and an opt-in per site, so that every page does not show the same long list.
45. As a reviewer, I want a branch-ref URL and a manual checklist in the PR, so that I can verify the tab in real EW and against a real Target tenant.
46. As the maintainer, I want unit tests on authentication, matching, normalisation, lift, caching and the provider contract that run in CI without credentials, so that regressions are caught on every push.

Security reviewer:

47. As a security reviewer, I want proof that the IMS token, the Adobe client secret and the Adobe access token never appear in a browser-visible response, in the DOM, or in logs, so that "the browser never receives credentials" is tested.
48. As a security reviewer, I want proof that a request without a token, with a token from another key, or from a disallowed origin never reaches Adobe, so that the worker is not a free Target reader.
49. As a security reviewer, I want proof that activity and variant names (author-controlled strings in Target) render as text, never as HTML, so that a hostile experiment name cannot script the editor.
50. As a security reviewer, I want proof that the tenant used in an upstream URL can only come from configuration and is validated, so that a bad config value cannot redirect the credential to another host or path.

## Implementation Decisions

(No file paths or code, except where noted. Paths and layout are in the Build Analysis.)

1. **Shape: a provider, nothing else.** The ticket adds one provider with id `adobe-target` and label "Adobe Target" to the #33 shell. It implements the #33 provider contract exactly (`id`, `label`, `secrets`, `hosts`, `siteConfig`, `fetch`) and returns the closed, versioned result. It adds no route, no result field, no section kind, no format and no note code, and changes no browser file. Where Target does not fit the contract cleanly (Decisions 12 to 14) the provider adapts to the contract and the gap is recorded as an open question; it does not extend the shell.
2. **Credential: OAuth Server-to-Server, one per worker.** The worker authenticates to Target as a technical account: POST to Adobe IMS `/ims/token/v3` with the `client_credentials` grant, `client_id`, `client_secret` and `scope`, as documented for the Developer Console [VERIFIED: https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/implementation, "Generating access tokens programmatically"]. The Service Account (JWT) credential is deprecated in favour of this one [VERIFIED: https://experienceleague.adobe.com/en/docs/target-dev/developer/api/configure-authentication, "IMPORTANT" box], so JWT signing is not built (this also removes the RS256 signing the GA4 provider needs). Access tokens expire after about 24 hours and Adobe advises caching them and may throttle integrations that mint too many [VERIFIED: same page]. The token is cached per isolate until about five minutes before `expires_in`, with one in-flight mint shared by concurrent requests, and dropped on an upstream `401`. One credential serves the whole worker, so v1 connects one Adobe organisation; sites are distinguished by tenant (Decision 5).
3. **Secrets and settings.** One secret, `TARGET_CLIENT_SECRET`, in the Cloudflare secret store and the worker's required-secrets list. Non-secret variables: the credential's client id (`TARGET_CLIENT_ID`; it is also the `x-api-key` header value Target requires [VERIFIED: https://developers.adobetarget.com/api/, sample requests]; non-secret by Adobe's own examples, flagged as Open Question 7), the OAuth scopes (`TARGET_OAUTH_SCOPES`, copied from the Developer Console credential page), the per-site mapping (`TARGET_SITES`), the catalog and report cache TTLs, the per-page activity cap, the per-invocation upstream call budget, and loopback-only host overrides for tests (Decision 15). The variable names contain none of the secret-looking words the #2 repo check rejects.
4. **Declared hosts.** `mc.adobe.io` (Target Admin API gateway [VERIFIED: admin-api.json `servers`]) and `ims-na1.adobelogin.com` (token endpoint [VERIFIED: Developer Console implementation guide]); https only, loopback `http` only in the local environment. The EU/APAC IMS hosts and region-specific Target gateways are not supported in v1 [ASSUMPTION: the global NA IMS endpoint issues tokens for any region; to be confirmed in X-step T2].
5. **Site mapping (non-secret, in worker configuration).** `TARGET_SITES` is a JSON object keyed by the content site (`org/site`, as `GA4_SITES` in #33). Each entry has: `tenant` (required, the Target tenant), `baseUrl` (strongly recommended: the production origin of the site, e.g. the host that appears in Target URL rules), `workspace` (optional: a premium-tenant workspace id used to filter the activity list [VERIFIED: legacy docs "GET activity list filtered by workspaces", https://developers.adobetarget.com/api/]), `includeSitewide` (optional, default false) and `pins` (optional list of `{activityId, paths}`; a path is an exact path or ends with `*` for a prefix). A site without an entry, or an entry with no valid `tenant`, means the source is not enabled for it (the provider's `siteConfig` returns nothing); an invalid entry is a worker misconfiguration (`500 misconfigured`, name logged, value never). This reads the provider-owned variable the way #33's variable table does for GA4 [ASSUMPTION: #33 Decision 8 says "a single JSON-valued variable", its table names `GA4_SITES`; this spec follows the table; Open Question 12]. The tenant is validated against a conservative host-label pattern before use in any upstream URL.
6. **Read-only, by construction.** The provider issues only `GET` requests, only to the two declared hosts, and only to these paths: activity list, activity definition (`ab` or `xt`), audience definition, and the AB/XT performance report [VERIFIED paths in admin-api.json]. A test asserts that no other method or path is ever requested. The credential's Target role should itself be read-only (README); the worker does not rely on that.
7. **Which activities are considered.** Only activities in API state `approved` whose dates make them **live** (started, not ended) or **scheduled** (not started) [VERIFIED mapping: ActivityState description in admin-api.json: approved + start past + end future = Live; approved + both in future = Scheduled; approved + end past = Ended; saved = Inactive; deactivated = Archived], and only types `ab` and `xt`. The list is requested with `state=approved` and, when configured, the workspace filter [ASSUMPTION: the legacy docs show generic attribute filters such as `?id=3&name=ab` and `?workspace=...`; filtering by `state` is expected to work the same and is checked in T2; the worker filters client-side regardless, so a filter that is ignored only costs more calls]. Ended, inactive and archived activities are out of scope for v1 (Open Question 3). Multivariate (`mvt`), Automated Personalization (`abt`), Auto-Allocate (`auto_allocate`) and Recommendations (`recs`) are listed by the API but not evaluated; live ones are counted in "not checked" (Decision 11).
8. **Page-to-activity matching (the central design decision).** Target has no query by page URL, so the worker derives the link and shows how it was derived. For each catalog activity the worker collects the audience ids referenced by its variants, mbox/selector locations and views (all the `audienceIds` fields in the activity definition [VERIFIED fields: admin-api.json `Experience`, `Locations`, `Mbox`, `Selector`, `ViewReference`]), loads each audience's `targetRule` and reads its page-URL conditions. The legacy docs show the rule shape `{"and":[{"page":"url","equals":["http://www.myhomepage.com/"]},{"geo":"region","matches":["california"]}]}` [VERIFIED sample: https://developers.adobetarget.com/api/, "Create Audience"]; the current OpenAPI types `targetRule` only as an opaque object, so the operator vocabulary and nesting are **not documented** [VERIFIED: admin-api.json `TargetRule` = `{"type":"object"}`; Open Question 2, risk R2]. The matcher is therefore data-driven and conservative:
   - It builds the page's absolute URL candidates from `baseUrl` plus the normalised path candidates the shell supplies (#33 Decision 9: with and without trailing slash, `index` to folder). Without `baseUrl` it compares paths only and the README warns about cross-host false positives.
   - It evaluates only page-URL leaves, with the operators it recognises (equality, contains, starts-with, ends-with, a wildcard/match form, and their negations) [ASSUMPTION: this operator set mirrors the Target UI's URL conditions; the exact JSON keys are recorded from a real tenant in T2 before the matcher is built].
   - Leaves that are not page-URL conditions (geo, profile, browser, ...) are pruned from the tree. If nothing is left the activity is `sitewide`. Otherwise the remaining boolean tree (`and`, `or`, `not`) is evaluated over the candidates; true means match reason `url`.
   - An audience whose structure or operator the matcher does not recognise makes the activity **not checked**; it is never matched on a guess.
   - A site `pin` (activity id plus path or prefix) adds an activity with match reason `pinned`, regardless of rules; this is the deterministic escape hatch when rules are unreadable or the page is selected by other means.
   - `sitewide` activities are excluded unless the site entry sets `includeSitewide`; when included they carry the reason "All pages".
   This is a heuristic and the README, the panel's labels (match reason, not-checked count) and the manual verification (T12) say so.
9. **Catalog: built under a call budget, cached, resumable.** Building the catalog costs one activity-list call (paged), one definition call per candidate activity and one call per distinct audience. On the Workers Free plan a single invocation allows 50 subrequests, six of them simultaneously open [VERIFIED: https://developers.cloudflare.com/workers/platform/limits/, "Subrequests", "Simultaneous open connections"], and the caller-token key fetch and the Adobe token mint also count. The provider therefore enforces an upstream-call budget per invocation (default 40, configurable, because the Paid plan allows far more), fetches at most four things at once, and when the budget is exhausted stores the partial catalog, returns what it can with the existing `truncated` note and counts the unfetched activities in "not checked"; the next request resumes the build and fetches nothing twice. A completed catalog is cached per tenant+workspace with a TTL (default 600 s) and is shared by all sites that map to the same tenant and workspace; audience definitions are cached with it. Concurrent cold requests share one build. The batch endpoint (`POST /{tenant}/target/batch`, up to 256 operations [VERIFIED: admin-api.json `BatchRequest`]) would cut calls but its request carries undocumented `authRequestData` and `requestHost` parameters, so it is not used [VERIFIED parameters; Open Question 16].
10. **Reports: only for matched live activities, capped, cached.** For each matched **live** activity (at most a per-page cap, default 8, ordered live first then by name; excess sets `truncated`) the provider calls the activity's performance report: `GET /{tenant}/target/activities/ab/{id}/report/performance` or the `xt` equivalent [VERIFIED paths: admin-api.json]. Reports are cached per activity id with a TTL (default 300 s), independent of the page and of the range. Scheduled activities have no report call: their variant rows show the split and empty metrics. The report body is read defensively: the current OpenAPI declares only `reportParameters` and `activity` in the response, while the legacy documentation sample shows a `report.statistics` block with per-experience `visitor`, `visit`, `impression` and `landing` totals of `entries` and `conversions` [VERIFIED both; drift is risk R4]. A report that lacks the expected totals degrades that activity to empty metrics and is counted; it does not fail the request.
11. **Metrics, lift and the control (provider-computed; definitions in the README).** *Visitors* = the variant's visitor `entries`; *conversions* = the variant's visitor `conversions`; *conversion rate* = conversions divided by visitors (empty when visitors is zero); *control* = the non-deleted variant with the lowest `experienceLocalId`; *lift* = the variant's rate divided by the control's rate, minus one (empty for the control itself and whenever the control's rate is empty or zero); *best lift* = the largest lift among variants of an activity (empty when none). Deleted variants (`deletedAt` present) are not shown. For `xt` activities (audience-targeted, no traffic split) the split and lift are empty. Which conversion metric the report's `conversions` field reflects (the report parameters list `conversionMetricLocalIds`, and the legacy sample shows only a placeholder metric) and whether Target's UI computes its conversion rate per visitor or per visit are **not documented**; the visitor basis and "lowest id is the control" are [ASSUMPTION], cross-checked against the Target UI in T4 and listed as Open Question 4. No statistical confidence or significance is computed or shown: the ticket asks for lift, and a significance figure that disagrees with Target's own would mislead.
12. **Range handling.** The performance report endpoints document no date parameters [VERIFIED: admin-api.json lists only `id`; the legacy samples show a `reportInterval` spanning the activity's life], so the Target numbers are **cumulative since the activity started** whatever range the author picked. The provider ignores the requested range for the data, titles its sections accordingly (Decision 4 of the shell makes labels provider-owned), and returns `range` with the requested id and the real cumulative window (earliest report start to the latest report end, time zone from the report interval's chronology, falling back to the shell's resolved range when no report was fetched) [ASSUMPTION: the shell validator accepts a start/end that does not match the preset's span; checked by conformance test TX3]. Because the shell's range control will remain visible and have no effect on this tab, this is recorded as a contract gap (Open Question 5): an optional, additive descriptor flag such as "range does not apply" would let the shell disable the control for this source, but it is #33's decision, not made here.
13. **Result mapping into the closed schema.** `ok` result with: one `stats` section (activities shown; live activities not checked); one `table` section listing the matched activities (name, type, status, match reason, visitors, best lift); and one `table` section per matched activity listing its variants (variant, traffic, visitors, conversions, conversion rate, lift). Numbers are numbers or `null`; traffic, rate and lift use the `percent` format; counts use `integer`; names, type, status and match reason are `text`. Lift can be negative and above 100 percent, while #33 describes `percent` as a fraction from 0 to 1; the validator is documented as requiring only finite numbers, so negative and large values are expected to pass [ASSUMPTION; conformance test TX4; Open Question 6]. Activity and variant names are author-controlled plain text, length-capped and stripped of control characters by the provider; the shell renders them with `textContent`. The result stays below the 64 KB ceiling by construction (per-page activity cap times a variant cap of 10 per activity). `empty` = the catalog was fully evaluated and nothing applies; `not_configured` = no site entry. Note codes used: `truncated` only (activity cap reached, call budget exhausted, or variant cap reached). `sampled`, `thresholded`, `other_row` and `data_delay` do not apply to Target data and are not emitted.
14. **Domain states and errors.** Per #33 Decision 5 the provider throws only template `HttpError`s. IMS token endpoint `4xx` (bad client, bad scope) = `500 misconfigured`; token endpoint `5xx` or network failure = `502 upstream_unavailable`. A Target `401` once drops the cached token, mints again and retries once; a second `401` is `500 misconfigured`. Target `403` (technical account lacks Target access or role) is `500 misconfigured` with a log line naming the reason class; Target `404` on the activity list or tenant is `500 misconfigured`; a `404` on one activity definition or report (deleted between list and fetch) skips that activity silently. Target `429` is `429 rate_limited` with `Retry-After`; `5xx` and network failures are `502 upstream_unavailable`. A caution from Adobe's own SDK README: calls made with insufficient Target roles return **500** errors [VERIFIED: https://github.com/adobe/aio-lib-target, "User-based OAuth Tokens and Role Requirements", stated for user tokens], so a persistent `500` is also a permission suspect and is logged with that hint. Target's error body (`httpStatus`, `requestId`, `errors[]`) is never forwarded [VERIFIED shape: legacy docs, "Versioning"]. A `406` (wrong `Accept` version) is `500 internal`.
15. **Retries, caching and Adobe's limits.** Target's rate limits are not documented in the sources read [OPEN: R8]. The provider overrides the #2 retry defaults like the GA4 provider: at most one retry on `5xx`, at most two on `429`, every call is an idempotent `GET`, and an overall deadline shorter than the browser's wait. The shell's result cache and negative cache apply unchanged (#33 Decision 15); the provider adds the catalog, audience and report caches above and never caches a failure in them. Local and test overrides of the two Adobe hosts (`TARGET_API_ORIGIN`, `TARGET_OAUTH_ORIGIN`) are honoured only in the local environment and a non-loopback override is refused as `misconfigured`, mirroring #33 Decision 20. No fake-data mode exists in production code.
16. **Page identity and the browser.** Unchanged from #33: the browser sends org, site, path and range only; the worker normalises the path. The Target route is `GET /insights/adobe-target` under the same pipeline; unknown parameters (including `tenant`, `workspace`, `activityId`, `pins`) are rejected with `400`; unauthenticated calls get `401` before the provider runs; a site without an entry gets `200` with `status: not_configured` and no Adobe call.
17. **Authorisation depth is inherited and matters more here.** Experiment names, variants and results are business-sensitive, and #33 R1 applies: any authenticated Adobe user passing the client-id allowlist can call the worker for any mapped site. Mitigations are #33's (mapped sites only, tenant never client-chosen, client-id allowlist, and the recommended DA read-access `authorize` hook, #33 Open Question 3). This spec recommends the hook be approved **before a real company Target tenant is mapped**; mapping only a sandbox tenant is fine without it.
18. **Observability.** The #33 structured log line plus: source id, tenant (not the credential), catalog hit/miss/partial, count of upstream calls by class (token, list, definition, audience, report), activities matched and not checked, and the upstream status class. No token, secret, header value, activity name or report body is logged.
19. **Tooling and CI: as decided.** Everything lives in `apps/insights-sidebar/providers/adobe-target/` per the #1/#2/#33 convention; ESLint 8 + helix config, Stylelint 16, `@web/test-runner`, Playwright (Chromium, stub tier), `node:test` for worker code, Node >= 22.12, husky. No new dependency: the provider needs no JWT/RSA library (client-credentials is a form POST).
20. **Docs are part of the deliverable.** The extension README gains an "Adobe Target" section (secret, variables, `TARGET_SITES` keys, scopes, Target role, link to the provider README) and the provider README holds the full setup, the matching rules and their limits, the metric definitions and troubleshooting (AC4 of #35 and the #33 provider-layout rule).

## Testing Decisions

**What makes a good test here.** As in #33: assert external behaviour only. Given a `Request` to the worker and a fake outside world (fake IMS key server for the caller, fake Adobe token endpoint, fake Target Admin API), assert the `Response` and the *outbound requests Adobe would have received*. The fake Adobe token endpoint accepts only the configured client id and secret; the fake Admin API answers only to a bearer token it issued plus the matching `x-api-key` and the right `Accept` version (and answers `406` like the real service when the version is wrong), and records every request. Never assert on internal helper names or call counts of internal functions. The standing negative properties apply: no secret or derived credential in any browser-visible byte or log line; no provider code or outbound call before authentication; no non-`GET` outbound request.

**Proposed seams** (recorded instead of asked, per #73; **no new seam is required**; the provider is tested through the seams #33 defined):

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 (primary) | Worker HTTP boundary `worker.fetch(request, env, ctx)` | reused from #2/#33 | Node tests for the Target route, auth to Adobe, catalog, matching, normalisation, caching | Constructed `Request`; env factory with `TARGET_*` settings; the #2 test kit (fake IMS key server, token factory, canary secret); a **fake Target** (Adobe token endpoint + Admin API) in the provider's `worker/test`; injected `fetch`/`sleep`/`random`/`now` |
| W1-C | Provider conformance suite parametrised by provider | reused from #33 | the Target provider (and the shell's test-only second provider is unchanged) | the same fake Target, scripted per scenario |
| W2 | Worker in workerd over real HTTP (`wrangler dev`, local) | reused from #2/#33 | smoke tier | fake IMS and fake Target on loopback servers; secrets from a temp env file |
| S1 | Entry HTML page + SDK module boundary | reused from #1/#33 | Playwright e2e of the Target tab | #1 SDK stub with a library-shaped context and a token signed by the test key; the real local worker; fake Target (and fake Google) on loopback |
| S2 | Render/logic modules + SDK result | reused from #1/#33 | WTR test that the shell renders a Target-shaped result | injected `fetch`; hand-built result fixture |
| S3 | Repo convention check | reused, extended | CI lint job | temp-dir fixtures |

The real boundaries (a real Adobe Target tenant, the real shape of activity/audience/report JSON, real EW) are covered by manual verification only (Testing Requirements 5); the fake Target's fixtures are authored from the documented schema and replaced or extended by sanitised recorded samples from the sandbox tenant (step T2) before the matcher and normaliser are finalised.

**Modules tested:** Adobe token minting and caching, Target request building and host/method confinement, activity catalog (list, definitions, audiences, budget, resume, coalescing, TTL), page matcher (URL conditions, boolean composition, pins, sitewide, indeterminate rules), status derivation, report parsing and metric computation (rate, control, lift), result mapping and schema conformance, Target error mapping, registry registration, README and config checks.

**Prior art.** #33 spec: fake Google (a verifying token endpoint plus a recording data API), the conformance suite, the GA4 query/normalise/auth test tables (`GA*`, `GQ*`, `GN*`, `GC*`, `PC*`), the Playwright PW tier. #2 spec: the test kit and W1/W2. #1 spec: SDK stub and S3. Upstream `adobe-rnd/ew-extensions` contains no Target, analytics or worker code (checked via the GitHub tree API on 2026-11-16: 137 paths, none matching target, insight, experiment or analytics); Adobe's `aio-lib-target` (https://github.com/adobe/aio-lib-target) is prior art for calling the same endpoints (`getActivities`, `getABActivityById`, `getABActivityPerformance`) and for the permission caveat, but it is a Node client and is not used.

## Out of Scope

- Adobe Analytics (#34) and any other source; the GA4 provider and the shell (#33) are not modified.
- Ended, inactive and archived activities; activity types other than A/B and Experience Targeting (MVT, Automated Personalization, Auto-Allocate, Recommendations); activity search by name; a list of all of a tenant's activities.
- Statistical significance, confidence intervals, sample-size guidance, Bayesian or sequential statistics, revenue/AOV metrics, per-audience or per-metric report slices, secondary goals.
- Any write operation to Target (creating, editing, activating, pausing or deleting activities; QA preview links).
- Target's Delivery API (`POST https://{clientCode}.tt.omtrdc.net/rest/v1/delivery`) as a way to find which activities a synthetic visitor would receive on a page [VERIFIED endpoint: https://raw.githubusercontent.com/AdobeDocs/target-developers/main/src/delivery-api.json]. It would show only the winning experience for one synthetic profile, not all variants, traffic split or results, and a prefetch call's side effects on profile and counting are unverified; it is rejected as the matching mechanism and may be revisited (Open Question 2).
- Date-range filtering of Target results; period-over-period comparison.
- Multiple Adobe organisations or credentials in one worker; EU/APAC-specific IMS hosts; Target on-device decisioning.
- Reading a DA site-config sheet for per-site settings (the mapping is worker configuration, as #33).
- CI-driven deployment, custom domains, Cloudflare credentials in CI (as #2/#33).
- Updating the panel when the author navigates inside the editor (as #33).
- Authorisation against DA permissions unless the owner approves #33's `authorize` hook (Decision 17).
- The Adobe outside-activity/IP policy question (carried by #1 R1).

## Further Notes

- **API facts used (all read on 2026-11-16).** Base URL `https://mc.adobe.io/{tenant}/target/...`; auth headers `Authorization: Bearer`, `x-api-key`, and the API version in the `Accept` header for requests without a body (v3 for activities and audiences; v1 documented for reports) [VERIFIED: https://developers.adobetarget.com/api/, "Versioning"; response media types in admin-api.json]. The current published OpenAPI document is the source for the Admin and Reporting API at https://developer.adobe.com/target/administer/admin-api (its `index.md` names `https://raw.githubusercontent.com/AdobeDocs/target-developers/main/src/admin-api.json` as `openAPISpec`) [VERIFIED]. The list response carries `id`, `name`, `type`, `state`, `startsAt`, `endsAt`, `priority`, `workspace`, `modifiedAt` per activity [VERIFIED: admin-api.json `ActivityListDescription`]. The activity definition carries `experiences` (`experienceLocalId`, `name`, `visitorPercentage`, `audienceIds`), `locations` (`mboxes`, `selectors`), `views` and `metrics` [VERIFIED: `ABActivity`, `Experience`, `Locations`, `ViewReference`, `Metric`]. Audiences: `GET /{tenant}/target/audiences/{id}` returns `targetRule` [VERIFIED path; rule shape only from legacy samples].
- **`ref=local` and branch refs concern where the extension code is served, not what data is shown** (#33 note): the Target numbers are always the configured tenant's; a branch ref changes which code and which deployed worker are used.
- **JWT deprecation.** The Service Account (JWT) credential was announced to stop working on January 1, 2025, so anything found in older Target tutorials that mints a JWT is not followed [VERIFIED: configure-authentication page]. The legacy `developers.adobetarget.com` pages still show the JWT exchange and now redirect to Experience League; they are used only for request and response shapes that the OpenAPI document does not repeat.
- **Report latency.** The only latency statement found concerns the API versus the UI when *setting* activity state (about 15 minutes) [VERIFIED: `ActivityState` description]; nothing about reporting freshness was found, so no freshness claim or `data_delay` note is made [OPEN: T3/T4 observe it].
- **Overlap risk is real (#33 R13; scoring 4/5).** EDS offers its own experimentation tooling (https://www.aem.live/docs/experimentation); Target is a heavyweight alternative that many EDS sites do not use [ASSUMPTION]. The provider cost is deliberately small and isolated so that it can be dropped without touching the shell.
- **Shared Adobe plumbing with #34.** Adobe Analytics 2.0 and Target both use the Developer Console OAuth Server-to-Server flow. This spec keeps the token minting inside its own provider folder (about one small module) because the layout says providers do not share code; if #34's spec lands with the same module, the owner may want to hoist it into the worker's `src/` (Open Question 15).

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)
 └─ editor library -> iframe: Insights (unchanged shell; origin https://{ref}--{site}--{org}.aem.live | .preview.da.live | http://localhost:3000)
       │  GET {worker}/insights/sources?org&site                      -> includes "adobe-target" when TARGET_SITES has the site
       │  GET {worker}/insights/adobe-target?org&site&path&range      Authorization: Bearer <IMS token>
       ▼
Cloudflare Worker "insights-sidebar worker"  (apps/insights-sidebar/worker; core from shared/worker-template; registry gains one line)
   1 origin gate + preflight -> 2 IMS token check -> 3 route: validate params -> site entry -> registry lookup
   4 shell result cache -> 5 provider adobe-target:
        a token (cached)  b catalog (cached; list + definitions + audiences, under a call budget)  c match page
        d reports for matched live activities (cached)  e lift/normalise  6 validate result schema -> respond
       │
       ├─ POST https://ims-na1.adobelogin.com/ims/token/v3              (client_credentials; secret TARGET_CLIENT_SECRET)
       └─ GET  https://mc.adobe.io/{tenant}/target/activities ... audiences/{id} ... activities/{ab|xt}/{id}[/report/performance]
```

| Concern | Browser extension (static, public) | Worker (private runtime, holds secrets) |
|---|---|---|
| Adobe client secret, access token | never | only place (secret store + isolate memory) |
| Which tenant/workspace to read, pins, base URL | never chosen | from `TARGET_SITES` by org/site |
| Which activities apply to the page | none | catalog + matcher |
| Report definition, metric and lift maths | none | provider-owned |
| Range | sends the preset/custom id as for every source | ignored for Target data; real window returned |
| Identity | obtains and sends the IMS token | verifies it (#2) |
| Caching | none | shell result cache + catalog/audience/report caches + token cache |
| Rendering of stats and tables | all (existing) | none |
| Adobe limits and retries | shows the message | budget, tuned retries, `Retry-After` |

The shell and the other provider do not change. The provider is a pure function of `(site entry, page, range)` plus the injected context.

## 2. EW integration points

- **Library plugin, not an app; no new config-sheet row.** Target appears inside the existing **Insights** library entry (the one `library` row from #33, path `/apps/insights-sidebar/insights-sidebar.html`). There is no `apps` row and no second entry page. Whether the Target tab appears for a site depends only on the worker's `TARGET_SITES`, not on the sheet.
- **SDK data used:** unchanged from #33: `token` and `context` (`org`, `site`, `path`), no SDK actions. The provider never sees the raw IMS token.
- **Site config read:** none from DA. Per-site Target settings are in the worker's `TARGET_SITES` (Section 4); the extension README says so.
- **`ref=local` loop:** the #33 loop: page at `http://localhost:3000` calls the local worker at `http://localhost:8787`; locally the Adobe secret is in an untracked `.dev.vars` (a real credential against the sandbox tenant) or, for hermetic work, the loopback overrides point the worker at the fake Target with throwaway values.
- **Branch ref:** the page loads from the branch and calls the *deployed* worker; the deployed worker must therefore contain the provider, its secret and its mapping before the branch check (manual step T7).
- **Repo README extensions table:** the existing "Insights & Experiment Sidebar" row; its description is extended to mention Adobe Target (the row, type `library plugin` and entry page do not change).
- **Where authors configure Target itself:** nowhere in EW; they use Target, the Developer Console and the Admin Console as described in the provider README.

## 3. External APIs and auth flows

| API | Use | Auth | Primary source |
|---|---|---|---|
| Adobe IMS `POST https://ims-na1.adobelogin.com/ims/token/v3` | mint the technical-account access token | form body `client_id`, `client_secret`, `grant_type=client_credentials`, `scope`; response `access_token`, `expires_in` (seconds, usually about 24 h) | https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/implementation ; reference https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/ims |
| Target Admin API: list activities `GET https://mc.adobe.io/{tenant}/target/activities` | catalog of activities (id, name, type, state, dates, workspace); filters `mbox`, `offerId`, `viewId` documented; `limit`/`offset`/`sortBy`, attribute filters (`id`, `name`, `workspace`, date ranges) from the legacy docs | `Authorization: Bearer`, `x-api-key`, `Accept: application/vnd.adobe.target.v3+json` | https://raw.githubusercontent.com/AdobeDocs/target-developers/main/src/admin-api.json ; https://developers.adobetarget.com/api/ ("List Activities") |
| Activity definitions `GET /{tenant}/target/activities/ab/{id}` and `/xt/{id}` | variants (`experiences`), traffic split (`visitorPercentage`), locations, views, `audienceIds`, metrics | as above (`Accept` v3; v4 also listed) | admin-api.json ; legacy "Get AB Activity by ID" |
| Audiences `GET /{tenant}/target/audiences/{id}` | `targetRule` with page-URL conditions | as above | admin-api.json ; legacy "Get Audience by ID" and "Create Audience" samples (rule shape) |
| Performance reports `GET /{tenant}/target/activities/ab/{id}/report/performance` and `/xt/{id}/...` | per-variant visitors/conversions | as above (`Accept` v1) | admin-api.json (response declares `reportParameters`, `activity`); legacy "Get AB Performance Report" sample (declares `report.statistics.totals/experiences[]` with `visitor`, `visit`, `impression`, `landing` x `entries`, `conversions`) |
| Target tenant id | path segment | n/a | https://experienceleague.adobe.com/en/docs/target-dev/developer/api/configure-authentication ("Test the bearer access token", step 8 note) |
| Adobe Developer Console project + product profile | creating the OAuth Server-to-Server credential with the Adobe Target API; requires Product Admin and Developer access | n/a | https://experienceleague.adobe.com/en/docs/target-dev/developer/api/configure-authentication ("Create an Adobe I/O project") ; https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/implementation ("Selecting Product Profiles") |
| Cloudflare Workers limits and secrets | 50 subrequests (Free) / 10,000 (Paid) per invocation; 6 simultaneous outgoing connections; secret storage | n/a | https://developers.cloudflare.com/workers/platform/limits/ ; https://developers.cloudflare.com/workers/configuration/secrets/ |
| Adobe IMS key set, DA App SDK | caller authentication and the SDK handshake | as #2 / #1 | #2 spec section 3; #1 spec section 2 |

**Auth flow (caller to worker):** unchanged from #2/#33.

**Auth flow (worker to Target):** read `TARGET_CLIENT_SECRET` -> if no cached access token still valid for five minutes: POST the client-credentials form to IMS -> cache token and expiry (derived values registered for redaction, #33 D2) -> call `mc.adobe.io` with `Authorization: Bearer <access token>`, `x-api-key: <client id>` and the endpoint's `Accept` version. On an upstream `401` drop the cached token and mint once more; a second `401` is `misconfigured`. There is no signing step.

**Observed from sample tokens (not a contract):** the access token in Adobe's legacy documentation decodes to scopes `openid,AdobeID,target_sdk,read_organizations,additional_info.projectedProductContext` [VERIFIED: decoded from the sample token in https://developers.adobetarget.com/api/]. That was a JWT-era token; the right scope string for an OAuth Server-to-Server credential is whatever the Developer Console shows for the credential, supplied through `TARGET_OAUTH_SCOPES` [OPEN: not read from a primary source for this credential type; Open Question 14].

**Unverified Adobe facts** [OPEN], each resolved by manual step T2/T3/T4 before the matcher and normaliser are finalised: where exactly a URL-targeted activity stores its page-URL condition (experience, activity or location `audienceIds`) for form-based and Visual Experience Composer (VEC) activities; the operator vocabulary and nesting of `targetRule`; whether `state` is an accepted list filter; paging behaviour of `limit`/`offset`; the real report body (`report.statistics` present or not, which metric `conversions` reflects, whether a query parameter chooses the metric or interval); how the Target UI computes conversion rate and lift (per visitor or per visit; the control definition); the minimum Target role for read access and whether a missing role returns `403` or `500`; Target's rate limits; the accepted tenant character set; whether the global NA IMS host works for tenants in other regions; reporting freshness.

## 4. Data contracts

All contracts are behaviour contracts. Short JSON shows shape only.

**Worker route (from #33, instantiated):** `GET /insights/adobe-target?org=&site=&path=&range=last7|last28|last90` (or `range=custom&start=&end=`); behaviour and errors exactly as #33 section 4: unknown source `404`, known source without an entry `200 not_configured`, unknown or repeated parameter `400`, no token `401`, disallowed origin `403`, method other than `GET` `405`.

**Worker configuration (additive to #33's table; non-secret `vars`):**

| Name | Meaning | Production | Local env |
|---|---|---|---|
| `TARGET_CLIENT_ID` | the Developer Console credential's client id (sent as `x-api-key`) | owner-provided [OPEN Q1, Q7] | a fake id |
| `TARGET_OAUTH_SCOPES` | scope string for the token request | copied from the credential page [OPEN Q14] | a fake scope |
| `TARGET_SITES` | JSON object: key `org/site` of the *content* site, value as below | owner-provided [OPEN Q1, Q12] | a fake tenant |
| `TARGET_CATALOG_TTL_SECONDS` | completed catalog (and audiences) TTL | `600` | `600` (tests inject the clock) |
| `TARGET_REPORT_TTL_SECONDS` | per-activity report TTL | `300` | `300` |
| `TARGET_MAX_ACTIVITIES_PER_PAGE` | cap on matched activities shown | `8` | small in tests |
| `TARGET_CALL_BUDGET` | upstream calls per invocation (token, list, definitions, audiences, reports) | `40` (Free); raise on Paid | small in tests |
| `TARGET_API_ORIGIN`, `TARGET_OAUTH_ORIGIN` | override the two Adobe hosts | unset (defaults) | loopback fakes; refused unless loopback and `ALLOW_LOCALHOST` |

`TARGET_SITES` entry (shape only): `{ "tenant": "<target tenant>", "baseUrl": "https://www.example.com", "workspace": "<optional>", "includeSitewide": false, "pins": [ { "activityId": 123456, "paths": ["/en/pricing", "/en/offers/*"] } ] }`. `tenant`: 1-63 characters of lowercase letters, digits and hyphen [ASSUMPTION: DNS-label shape]; `baseUrl`: an `https` origin without path; `workspace`: digits; `pins[].paths`: begin with `/`, an optional single trailing `*`. JSON-object `vars` support is [ASSUMPTION per #33: fallback is a JSON string parsed by the worker].

**Secrets (`secrets.required`, additive):** `TARGET_CLIENT_SECRET`. Listed in `.dev.vars.example`. Consequence: a deployment of the insights worker needs this secret set before `wrangler deploy` succeeds, even for a GA4-only site (Open Question 8).

**Provider descriptor (behaviour):** `id = adobe-target`; `label = Adobe Target`; `secrets = [TARGET_CLIENT_SECRET]`; `hosts = [mc.adobe.io, ims-na1.adobelogin.com]`; `siteConfig(entry)` returns the validated entry or nothing (source not enabled); `fetch(ctx, { site, page, range })` as in #33 section 4 (`page = { path, candidates[] }`).

**Result (shape, `status: ok`):**

```json
{
  "source": { "id": "adobe-target", "label": "Adobe Target" },
  "status": "ok",
  "page": { "path": "/en/pricing", "host": "www.example.com" },
  "range": { "id": "last28", "start": "2026-08-02", "end": "2026-11-16", "timeZone": "America/Los_Angeles" },
  "generatedAt": "2026-11-16T12:00:00.000Z",
  "cached": false,
  "sections": [
    { "kind": "stats", "key": "overview", "label": "Target activities for this page", "items": [
      { "key": "matched", "label": "Activities found", "value": 2, "format": "integer" },
      { "key": "notChecked", "label": "Live activities not checked", "value": 3, "format": "integer" } ] },
    { "kind": "table", "key": "activities", "label": "Activities (totals since each activity started)", "columns": [
        { "key": "name", "label": "Activity", "format": "text" },
        { "key": "type", "label": "Type", "format": "text" },
        { "key": "status", "label": "Status", "format": "text" },
        { "key": "match", "label": "Matched by", "format": "text" },
        { "key": "visitors", "label": "Visitors", "format": "integer" },
        { "key": "bestLift", "label": "Best lift", "format": "percent" } ],
      "rows": [ { "name": "Pricing page hero", "type": "A/B test", "status": "Live", "match": "Page URL", "visitors": 5120, "bestLift": 0.084 } ] },
    { "kind": "table", "key": "activity-168824", "label": "Pricing page hero: variants (since start)", "columns": [
        { "key": "variant", "label": "Variant", "format": "text" },
        { "key": "traffic", "label": "Traffic", "format": "percent" },
        { "key": "visitors", "label": "Visitors", "format": "integer" },
        { "key": "conversions", "label": "Conversions", "format": "integer" },
        { "key": "rate", "label": "Conversion rate", "format": "percent" },
        { "key": "lift", "label": "Lift vs control", "format": "percent" } ],
      "rows": [ { "variant": "Experience A", "traffic": 0.5, "visitors": 2560, "conversions": 205, "rate": 0.0801, "lift": null },
                { "variant": "Experience B", "traffic": 0.5, "visitors": 2560, "conversions": 222, "rate": 0.0867, "lift": 0.0827 } ] }
  ],
  "notes": [ "truncated" ]
}
```

Rules specific to this provider, on top of the #33 validator: section keys are `overview`, `activities` and `activity-<id>`; at most `TARGET_MAX_ACTIVITIES_PER_PAGE` variant tables and 10 variant rows per table; row text is plain, length-capped and control-character-free; `lift` and `bestLift` may be negative or above 1 and may be `null`; `traffic`, `rate` and `lift` are fractions, not preformatted strings; `empty` and `not_configured` carry no sections; `notes` is empty or `["truncated"]`.

**Internal catalog entry (not exposed):** activity id, type, name, state, start and end, workspace, status (live, scheduled), variants (local id, name, traffic fraction, deleted flag), the set of referenced audience ids, the evaluated page-URL rule tree per audience (or an "unreadable" marker), and the derived `sitewide` flag. Cached per tenant+workspace; holds no caller identity and no token.

## 5. Folder layout (fits the #1/#2/#33 convention)

```
apps/insights-sidebar/
├─ README.md                             gains an "Adobe Target" section (AC4): secret, vars, TARGET_SITES keys, scopes, role, link
├─ worker/
│   ├─ wrangler config                   gains TARGET_* vars and TARGET_CLIENT_SECRET in secrets.required
│   ├─ .dev.vars.example                 gains TARGET_CLIENT_SECRET
│   └─ src/registry.js                   gains ONE line registering adobe-target (the only shell-side code edit)
└─ providers/adobe-target/
    ├─ SPEC.md                           this file
    ├─ README.md                         setup (Developer Console, credential, scopes, Target role), TARGET_SITES keys, matching rules and limits, metric definitions, caching, troubleshooting
    └─ worker/
        ├─ adobe-target.js               provider descriptor + fetch orchestration
        ├─ adobe-auth.js                 client-credentials token mint/cache
        ├─ catalog.js                    list, definitions, audiences, budget, resume, cache
        ├─ match.js                      page candidates, URL-rule evaluation, pins, sitewide, status
        ├─ report.js                     report parsing, rate, control, lift
        ├─ normalize.js                  result mapping
        └─ test/                         fake Target, fixtures (sanitised recorded samples), tests
```

Per the shell rules (#33 UI3/UI4): nothing outside `providers/adobe-target/` imports from it except the registry module; the extension's browser files are untouched; the `.hlxignore` already hides `**/worker/` and `**/test/` from the code bus; the provider README is public (no secrets, no tenant names). Where the shell's browser tests need a Target-shaped fixture (test BT1-BT3), the fixture is added to the existing browser test folder as data, not as code.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **No "activities for this URL" API.** Page association is derived from audience rules, pins or "all pages"; it can be wrong or incomplete (activities whose page targeting lives elsewhere, unsupported types, VEC specifics). | High | Match reason shown per row; "not checked" count; pins as a deterministic fallback; T12 compares against Target for several URL operators; README states the limits; Open Question 2. |
| R2 | **`targetRule` is undocumented** (OpenAPI: opaque object). Operator names, nesting and where URL rules sit for VEC vs form activities are unknown. | High | Spike T2 records real JSON before the matcher is built; matcher is conservative (unreadable = not checked, never guessed); fixtures are sanitised recordings. |
| R3 | **Subrequest limits on the Free plan** (50 per invocation, 6 simultaneous) versus a catalog of N activities plus audiences plus reports. | Medium-High | Call budget, resumable partial catalog, concurrency 4, caches with sensible TTLs, `truncated`; Paid plan is an owner decision (#33 Q13; Open Question 10). |
| R4 | **Report semantics and doc drift.** OpenAPI omits the `report` block that the 2017 sample shows; which metric `conversions` counts and how Target computes rate/lift are undocumented; "control = lowest local id" is inferred. | High | Defensive parsing; T4 cross-check against the Target UI; lift labelled with README definition; no significance figure (Decision 11); Open Question 4. |
| R5 | **Range does not apply to Target data**, yet the shell's range control stays active on this tab. | Medium (UX) | Section titles say "since start"; real window returned; additive contract flag proposed to #33 (Open Question 5). |
| R6 | **Experiment data exposure:** any authenticated Adobe user can read any mapped site's Target data (#33 R1); activity names and results can be confidential. | High if a company tenant is mapped | Mapped sites only; tenant never client-chosen; client-id allowlist; recommend the `authorize` hook first (Decision 17); sandbox tenant needs nothing more. |
| R7 | **Permissions of the technical account:** needs a Target product profile and a role; Adobe's own SDK says insufficient roles can surface as `500`, so errors can be mislabelled upstream failures. | Medium | README lists the profile and a read-only role; `403` and persistent `500` both log a permission hint; T10 exercises revocation; minimum role [OPEN]. |
| R8 | **Target rate limits undocumented.** Catalog builds fan out many calls. | Medium | Budget, caches, retries tuned down, `Retry-After` mapping; log call counts; Open Question 1 (sandbox) lets us observe. |
| R9 | **Sandbox availability.** A Target tenant, an Admin Console admin and traffic to generate conversions are needed for real verification; whether a free or trial route exists was not established. | High for verification | Owner Question 1; everything but T1-T12 runs on fakes in CI; the discovery spike must precede matcher work. |
| R10 | **Deploy coupling:** adding `TARGET_CLIENT_SECRET` to `secrets.required` makes GA4-only deployments fail until it is set. | Medium | Documented; Open Question 8 (optional secrets in the template). |
| R11 | **Contract fit:** negative/above-one `percent` values; range-ignoring; vendor-supplied text in section labels. | Low-Medium | Conformance tests TX3/TX4 decide whether the shell accepts them; amend #33 additively if not (never fork the shell). |
| R12 | **Workspaces and multi-org** (premium tenants, several Adobe orgs) are not modelled beyond an optional workspace filter. | Low-Medium | Out of scope; one credential per worker; README states it. |
| R13 | **Name/tenant strings in URLs and logs.** A malformed `tenant` in config could redirect the credential or break paths. | Low | Strict pattern, host fixed, tenant used only as a path segment; test TQ1/TA10; activity names never logged. |
| R14 | **Overlap and demand** (scoring 4/5 overlap; EDS has its own experimentation tooling). | Strategic | Isolated provider; Open Question 13. |
| R15 | **Shared-plumbing drift with #34.** Two providers may each reimplement Adobe S2S token handling. | Low | Small module; revisit once #34's spec exists (Open Question 15). |

## 7. Ordered build plan (sized to #35's acceptance criteria)

0. **Prerequisites (owner):** #33 landed (shell, registry, conformance suite, GA4) and with it #1/#2; the #2 additions D1 (dynamic outbound credential) and D2 (derived-value redaction) available or the documented fallback; a Target tenant with at least one live A/B activity targeted to a URL (T1); an Adobe Developer Console project with the Adobe Target API and an OAuth Server-to-Server credential, a product profile and the owner decisions on Open Questions 1, 2, 7, 8, 9.
1. **Discovery spike (manual, no merged code), resolves R2/R4:** T2 to T4: call the real list, definition, audience and report endpoints with `curl`, record sanitised JSON (operators, where URL rules live for form and VEC activities, `state` filter, real report body, role behaviour) and the Target UI's numbers. Output: fixtures and a short "recorded facts" appendix in the provider README. Adjust Decisions 8, 10 and 11 if reality differs.
2. **Fake Target and fixtures (AC7):** token endpoint, Admin API with version enforcement and request recording; fixtures from the sanitised recordings.
3. **Adobe auth (AC2, AC6):** token mint/cache, header handling, error mapping, derived-credential redaction (`TA*`).
4. **Catalog (AC1, AC2):** list paging, definition and audience fetch, host/method confinement, budget, resume, coalescing, caches (`TQ*`, `TC*`).
5. **Matcher (AC1):** URL conditions, boolean composition, pins, sitewide, status derivation, ordering and caps (`TM*`).
6. **Reports and normalisation (AC1):** parsing, rate, control, lift, result mapping, schema conformance (`TN*`, `TX*`).
7. **Provider assembly and registration (AC3):** descriptor, `siteConfig`, the one registry line, worker config (secret, vars, `.dev.vars.example`), conformance run (`TX1`-`TX4`), regression of GA4 tests.
8. **READMEs (AC4):** extension README "Adobe Target" section; provider README with setup, keys, matching limits, metric definitions, troubleshooting; extensions-table description.
9. **Browser-side proof without shell changes (AC1, AC3):** WTR render fixtures (`BT*`), Playwright against the real local worker and fake Target (`PW-T*`).
10. **Runtime smoke (AC2, AC6):** `SM-T*` in workerd, recording call counts against the 50-subrequest limit.
11. **Repo checks and CI (AC3, AC4, AC7):** extend S3 (`UT*`); extension tests join the existing `lint`, `unit`, `worker-unit`, `worker-smoke`, `e2e` jobs; no credentials in CI.
12. **Deploy and manual verification (AC1, AC2, AC5, AC6):** T0 to T14 against the sandbox tenant and real EW; record observed `context.path` and tenant behaviour in the PR and the provider README.
13. **Shell-isolation review (AC3):** the PR diff outside `providers/adobe-target/` is limited to the registry line, worker config, `.dev.vars.example`, the extension README, the root README row text and test fixtures (T14).

---

# Testing Requirements

## 1. Worker unit and contract tests (seam W1; Node built-in runner; no network, no Cloudflare login)

Fixtures/mocks: the #2 test kit (`makeEnv`, fake IMS key server and `signToken`, canary secret, injected `fetch`/`sleep`/`random`/`now`) and the #33 conformance suite, plus a **fake Target** in `providers/adobe-target/worker/test`:

- (a) an IMS token endpoint that parses the posted form, checks `grant_type=client_credentials`, the client id, the client secret and the scope string, and returns an opaque access token with `expires_in` (seconds);
- (b) an Admin API that accepts only a bearer token it issued together with `x-api-key` equal to the client id, enforces the `Accept` version per endpoint (list and definitions v3, reports v1; otherwise `406` with an error body shaped like the real one), serves scripted tenants, activities, audiences and reports, and records every request (method, path, headers, query, time) so tests can assert counts, methods and concurrency.

Fixtures are authored from the OpenAPI schema and the documented samples, then replaced or extended by sanitised recordings from the sandbox tenant after step T2 (until then they are [ASSUMPTION]-grade). Scenario fixtures: a small tenant (A/B live with URL rule, XT live, scheduled A/B, ended A/B, saved, MVT live, AP live), a sitewide-only tenant, a large tenant (60 live activities), an unreadable-rule tenant, and a malformed-report tenant. `TARGET_SITES` fixture: one fully configured site (tenant, baseUrl, workspace, a pin), one with only a tenant, one unmapped.

### 1.1 Authentication to Adobe (AC2, AC6)

| ID | Behaviour asserted |
|---|---|
| TA1 | The token request is a form `POST` to `{oauth origin}/ims/token/v3` with `grant_type=client_credentials`, `client_id` from `TARGET_CLIENT_ID`, `client_secret` from the secret, `scope` from `TARGET_OAUTH_SCOPES` |
| TA2 | Every Admin API call carries `Authorization: Bearer <minted token>`, `x-api-key: <client id>` and the endpoint's `Accept` version, and **no** inbound caller credential (the IMS token and the inbound `Authorization` are absent) |
| TA3 | One mint serves many requests (including different ranges and sites); a new mint happens once the injected clock is within the refresh window before `expires_in`; concurrent cold requests share one mint |
| TA4 | Token endpoint `4xx` (`invalid_client`, `invalid_scope`) gives `500 misconfigured` (generic) with a log line naming the reason class only; `5xx` or network failure gives `502 upstream_unavailable` (and is negative-cached by the shell) |
| TA5 | Target `401` once: cached token dropped, one re-mint, one retry succeeds; `401` twice gives `500 misconfigured`; no retry loop |
| TA6 | Target `403` gives `500 misconfigured` with a `target_permission_denied` log line and no upstream text in the response; a persistent `500` from the list endpoint gives `502 upstream_unavailable` with a permission-hint log line |
| TA7 | Target `429` gives `429 rate_limited` with `Retry-After`; `5xx` or network failure gives `502`; retries are capped (at most 1 on `5xx`, at most 2 on `429`), asserted on the fake's request count; a `406` gives `500 internal` |
| TA8 | **Derived-credential canary** (extends #2 US1 and #33 GA8): the client secret and the minted access token never appear in any response body, header or log line across success and every error above, including a fake Target that echoes the token or the secret in an error body (requires D2) |
| TA9 | Missing `TARGET_CLIENT_SECRET` behaves as #2 US2; missing or blank `TARGET_CLIENT_ID` or `TARGET_OAUTH_SCOPES` gives `500 misconfigured`; the log names the variable, never a value |
| TA10 | Host overrides are honoured only in the local environment; a non-loopback override is refused as `misconfigured` and no request is sent; an invalid `tenant` in `TARGET_SITES` (path characters, uppercase beyond normalisation, empty, over 63 chars) is `500 misconfigured` and no request is sent |
| TA11 | Target `404`/`403` on the activity list (wrong tenant) gives `500 misconfigured`; `404` on one definition or report skips that activity only |

### 1.2 Requests, confinement and the call budget (AC1, AC2, AC6)

| ID | Behaviour asserted |
|---|---|
| TQ1 | List call is `GET {api origin}/{tenant}/target/activities` with `state=approved` (and `workspace` when configured), paged until the reported total is read; the tenant comes only from `TARGET_SITES` |
| TQ2 | Definition calls use `/activities/ab/{id}` or `/activities/xt/{id}` by type; `mvt`, `abt`, `auto_allocate`, `recs` are never fetched |
| TQ3 | Audience calls only for referenced ids, each id once per catalog build |
| TQ4 | Report calls only for matched **live** activities, at the per-type path, with the report `Accept` version; none for scheduled, ended or unmatched activities |
| TQ5 | Only `mc.adobe.io` and the IMS host (or the loopback overrides) are contacted; no request reaches any other host |
| TQ6 | **Read-only:** across every scenario, every outbound request to Target is a `GET`; no `POST`/`PUT`/`PATCH`/`DELETE` is ever sent to `mc.adobe.io` (the only `POST` is the token request to the IMS host) |
| TQ7 | At most four upstream requests are in flight at once (asserted on the fake's concurrency record); the total number of upstream calls in one invocation never exceeds `TARGET_CALL_BUDGET` |
| TQ8 | **Client cannot steer the query:** `tenant`, `workspace`, `activityId`, `activity`, `pins`, `baseUrl`, `status` or any unknown parameter gives `400`; repeating a known parameter gives `400`; no Adobe request is made; a mapped site always queries its configured tenant |

### 1.3 Catalog and caching (AC1, AC2)

| ID | Behaviour asserted |
|---|---|
| TC1 | A second request within the TTLs: no list, definition, audience or report call; response `cached: true` or a cache-served catalog/report with the same data |
| TC2 | After the catalog TTL (injected clock) the next request rebuilds it; after the report TTL only reports are re-fetched |
| TC3 | N concurrent cold requests for the same tenant cause exactly one list call, one definition call per activity, one audience call per distinct audience, and one mint |
| TC4 | **Budget and resume:** 60 live activities with a budget of 40: the first request makes at most 40 upstream calls, returns `ok` with the `truncated` note and a non-zero `notChecked`; subsequent requests resume without re-fetching any definition or audience already held; after enough requests the catalog completes, `truncated` disappears (unless the activity cap applies) and `notChecked` reflects only unsupported or unreadable activities |
| TC5 | Two sites mapped to the same tenant+workspace share one catalog; two sites on different tenants or workspaces do not mix entries |
| TC6 | The catalog, audience and report caches are bounded and hold no caller identity and no token (inspect the cache adapter's stored values; extends GC8); a failed build is not cached, partial progress is |
| TC7 | Through the shell: an upstream failure is negative-cached (a second request inside the negative TTL gets the same error without an upstream call), and a cached success is never served to an unauthenticated, wrong-origin or invalid-parameter request (extends GC6/GC7) |

### 1.4 Matching and status (AC1)

| ID | Behaviour asserted |
|---|---|
| TM1 | URL-condition matrix against a page whose candidates are `/en/pricing` and `/en/pricing/` with `baseUrl https://www.example.com`: equals, contains, starts-with, ends-with, wildcard/match and the negated forms each yield the expected match/non-match; a non-matching host does not match |
| TM2 | Boolean composition: `and`, `or`, `not` over URL leaves; non-URL leaves (geo, profile, ...) are pruned; a tree with no URL leaf left is `sitewide`; an `and` of a URL leaf and a geo leaf matches on the URL leaf alone |
| TM3 | Normalisation: scheme and host compared case-insensitively; trailing-slash variants equal; a rule value with a query string does not match a path-only candidate; `index` documents match their folder URL |
| TM4 | An audience whose operator or structure is not recognised makes the activity "not checked": never matched, counted in `notChecked`, no exception, no response detail |
| TM5 | Pins: exact path and trailing-`*` prefix match the page candidates; a pinned live or scheduled activity appears with match reason "Pinned"; a pin to an activity missing from the catalog or not live is ignored (logged by id only) |
| TM6 | `includeSitewide` false (default) excludes sitewide activities; true includes them with match reason "All pages" |
| TM7 | Audience ids are gathered from variants, mbox locations, selector locations and views; an audience referenced by several is evaluated once |
| TM8 | Without `baseUrl` matching is on path only; with it, rules for another host do not match |
| TM9 | Ordering and caps: live before scheduled, then by name; more matches than `TARGET_MAX_ACTIVITIES_PER_PAGE` yields the cap and the `truncated` note |
| TM10 | Status derivation with an injected `now`: approved + started + not ended = Live; approved + not started = Scheduled; approved + ended, saved, deactivated, deleted are excluded; unsupported types are never matched |

### 1.5 Reports, metrics and result (AC1, AC3)

| ID | Behaviour asserted |
|---|---|
| TN1 | Variant table: names, traffic from `visitorPercentage` as a fraction (`null` for `xt`), visitors and conversions from the visitor totals, rate = conversions / visitors, `null` when visitors is zero (never `NaN`/`Infinity`) |
| TN2 | Lift: control = lowest `experienceLocalId` among non-deleted variants; lift = rate / control rate - 1; the control's lift is `null`; control rate `0` or `null` makes every lift `null`; negative lift is preserved as a negative number; values above 1 are preserved |
| TN3 | Deleted variants (`deletedAt`) are not shown and do not become the control; at most 10 variant rows |
| TN4 | Overview table and stats: matched count, `notChecked` (unsupported types + unreadable rules + not yet fetched), visitors from the report totals, `bestLift` = largest variant lift or `null` |
| TN5 | A scheduled activity: no report call; rows show the split and `null` metrics |
| TN6 | Fully evaluated catalog, nothing applies: `status: empty`, no sections; no site entry: `status: not_configured` and zero requests to Adobe |
| TN7 | Range independence: requests for `last7`, `last28`, `last90` and a custom range return identical sections and make no extra upstream calls; `range.id` echoes the request; `range.start`/`end` are the cumulative report window and `timeZone` comes from the report interval; with no report fetched they fall back to the shell's resolved range |
| TN8 | Hostile activity, variant and audience names (`<img src=x onerror=...>`, control characters, very long strings, RTL marks) come out as inert plain text, control characters stripped, names length-capped; nothing is HTML |
| TN9 | Every fixture result passes the #33 conformance schema; the worst case (cap activities x 10 variants, long names) stays below 64 KB |
| TN10 | Malformed Target bodies: a report without totals or experiences degrades that activity to `null` metrics and counts it in `notChecked`; numeric strings are parsed; a malformed list or definition body gives `502 upstream_unavailable` with no detail; unknown extra fields are ignored |

### 1.6 Provider contract, registry, route (AC3, AC6)

| ID | Behaviour asserted |
|---|---|
| TX1 | The #33 conformance suite (PC1-PC6) passes for `adobe-target`: descriptor valid, secrets a subset of `secrets.required`, hosts https-only, schema, secrecy (canary and registered derived values absent from success and error responses, headers and logs), host confinement, no IMS token in `ctx` or outbound requests, `empty` and `not_configured` accepted with no sections |
| TX2 | Registry: with the one added line, `adobe-target` appears in the sources route for a site that has a `TARGET_SITES` entry, not for a site that has only a `GA4_SITES` entry, and both appear for a site with both; no routing, cache or contract file changed (asserted by the existing shell tests passing unmodified); GA4's own tests still pass |
| TX3 | The #33 runtime validator accepts a result whose `range` start/end do not match the preset's span (Decision 12); if it rejects it, this test records the contract gap instead of being weakened |
| TX4 | The validator accepts negative and above-one `percent` values and `null`s in the Target tables (Decision 13); same rule on failure |
| IT1 | Route behaviour for `/insights/adobe-target`: no token `401` with CORS for an allowed origin; token from another key, expired token, wrong type `401`; disallowed origin with a valid token `403`; in every case the fake Target receives zero requests (extends IR2) |
| IT2 | A known source without a site entry returns `200` `not_configured` with no Adobe call; an unknown source id `404` (extends IR4) |
| IT3 | Methods other than `GET` `405`; unknown route with token `404`; without token `401` (pipeline order) |

## 2. Browser unit tests (seam S2; WTR + Mocha + chai; injected `fetch`; SDK stub from #1; Target-shaped fixtures as data)

No shell code changes, so these prove the *unchanged* shell renders the Target result. [ASSUMPTION: the shell's WTR configuration picks up fixtures and tests from the existing test folder.]

| ID | Behaviour asserted |
|---|---|
| BT1 | The shell renders the Target fixture: overview stats, the activities table and one variant table per activity, with integer, percent (one decimal) and text formats; `null` shows as an em dash; negative lift shows as `-12.5%`; table captions and column headers are present |
| BT2 | With `ga4` and `adobe-target` both enabled the switcher shows both; each loads independently; a failing Target (`502`) leaves GA4 rendered and offers retry on the Target tab only (extends BU10) |
| BT3 | Hostile activity and variant names in the fixture render as literal text and create no elements (extends BU7) |
| BT4 | The `truncated` note renders the shell's own message; an unknown note or section kind still degrades safely (BU11 unchanged) |
| BT5 | The fixture request is made with exactly org, site, path and range; no tenant, workspace, activity or credential parameter; the IMS token appears only in the `Authorization` header (extends BU2/BU8) |

## 3. Runtime smoke tier (seam W2; Node test file driving `wrangler dev` locally; no Cloudflare login)

Starts the real insights worker in workerd with `IMS_ORIGIN`, `TARGET_API_ORIGIN` and `TARGET_OAUTH_ORIGIN` pointing at loopback fakes and secrets from a temp env file.

| ID | Behaviour asserted |
|---|---|
| SM-T1 | The worker bundles with the provider (registry resolves it; no new dependency needed) and starts; a bare request gets `401` |
| SM-T2 | Valid token + fake Target: `200` result equals the fixture-derived expectation; the fake token endpoint saw a correct client-credentials request |
| SM-T3 | Preflight and CORS behaviour for the Target route over real HTTP as #33 SM-I3; canary and derived credentials absent from all responses (TA8 over HTTP) |
| SM-T4 | Second identical request is served from cache (the fake saw one build); a request for another range makes no extra Target calls |
| SM-T5 | Records CPU/wall time and the subrequest count of a cold request (small tenant and the 60-activity tenant under the budget) and a warm request, informational against R3 (no hard threshold until a baseline exists; the count must stay within `TARGET_CALL_BUDGET`) |

## 4. End-to-end tests (seam S1; Playwright, Chromium, hermetic: real local worker, fake IMS, fake Target, fake Google)

Setup as #33 section 4 (viewport 360x800, library-shaped SDK stub context with `path: /en/pricing`, token signed by the test key) with `TARGET_SITES` set for the test site and `GA4_SITES` optionally set.

| ID | Behaviour asserted |
|---|---|
| PW-T1 | The Target tab shows the overview, the activities table and the variant tables for `/en/pricing`; numbers equal the fixture; the fake Target received exactly the token request and the list, definition, audience and report calls (AC1, AC2) |
| PW-T2 | Reloading within the TTLs shows the same data with the cached indicator; the fake Target saw no new calls (AC2) |
| PW-T3 | SDK stub with no token, and with a token signed by a different key: the UI shows the sign-in message; the worker answered `401` readable through CORS; the fake Target received zero requests (AC6) |
| PW-T4 | Scan of the page HTML, DOM text, storage and every network response for the IMS token (allowed only in the request `Authorization` header to the worker), the Adobe client secret and the Adobe access token: none present (AC6) |
| PW-T5 | Only expected hosts were contacted by the browser: the static page, the worker, the SDK stub; never `mc.adobe.io` or an Adobe IMS token host (AC6) |
| PW-T6 | A site present only in `TARGET_SITES` shows a single source (no switcher); a site in neither shows the not-configured message and makes no result request |
| PW-T7 | Hostile names from the fake Target render inert; the accessibility tree shows a captioned table per section and a live status region |

## 5. End-to-end checks inside real Experience Workspace and a real Target tenant (manual; needs interactive Adobe logins, a Cloudflare account)

**Accounts and credentials needed (none in the repo):** everything from #33 X-section (GitHub admin for Code Sync; Adobe IMS identity with access to the DA org/site and config rights; Chrome; Cloudflare account with Wrangler login) plus: an **Adobe Target tenant** (a sandbox or trial, or a company tenant the owner agrees to read; Open Question 1) with a Target user who can create activities and audiences; **Product Admin and Developer rights** in the Adobe Admin Console/Developer Console to create the credential; an **Adobe Developer Console project** with the Adobe Target API and an **OAuth Server-to-Server credential** attached to a product profile that can read activities and reports (client id, client secret and scopes; the secret goes to `wrangler secret put`, never to chat or the repo); a **test content site and published page** for which a Target A/B activity targets the page URL; the ability to generate real visitors and conversions on that page (the page must run Target's client library, at.js or the Web SDK, which is outside this repo) [ASSUMPTION: the test site can be tagged]. Never paste a real IMS token, client secret or access token into chat, issue comments or logs.

- **T0 (prereq):** #33's X0 passes (deployed insights worker returns `401` to a bare request; GA4 panel works or is skipped).
- **T1 (sandbox setup, Target UI):** create a reusable audience "Page URL equals `https://<test-host>/en/pricing`"; create an A/B activity (form-based) with two experiences split 50/50 on that page with a click or mbox conversion goal, audience attached; activate it; note the activity id and tenant. Create a second activity with a "Page URL contains" audience, a third that is a VEC activity (Visual Experience Composer) targeting the same page, a fourth with no URL condition (sitewide), a fifth that is Experience Targeting, a scheduled one, and an ended one, to exercise every branch.
- **T2 (discovery spike, `curl` with a temporary token; resolves R2, R4):** in the Developer Console generate an access token (the console's button or the documented `curl` to `/ims/token/v3`); call list (`?state=approved`, with and without `workspace`), the definition endpoint for each activity from T1, the audience endpoint for each referenced audience, and the performance report for the live A/B and XT activities. Record, sanitised, in the provider README appendix and as test fixtures: where each URL condition appears (activity, experience, location, view), the exact `targetRule` operator keys and nesting, whether `state` filters, `limit`/`offset` behaviour, the real report body (is `report.statistics` present? which metric do `conversions` reflect? any interval/metric query parameters?), the error shape and status for a token without the product profile or role, and the minimum role that works.
- **T3 (seed data):** drive visits (several browsers/profiles, cookie resets) and conversions on the test page so variants and conversion counts are non-trivial; record expected visitors per variant; note how long reports take to appear.
- **T4 (ground truth):** in the Target UI open each activity's report: record visitors, conversions, conversion rate and lift per experience, the control experience, and the report's date window; compare with the T2 report body and with the panel later; this settles Decision 11 (visitor vs visit basis, control definition) and Open Question 4.
- **T5 (deploy):** `wrangler secret put TARGET_CLIENT_SECRET`; set `TARGET_CLIENT_ID`, `TARGET_OAUTH_SCOPES`, `TARGET_SITES` for the test site; `wrangler deploy` from `apps/insights-sidebar/worker/`; `curl` with a valid IMS token (inspect the token as in #2 W2) returns the Target result; without a token `401`; with `Origin: https://evil.example` `403`; with `?tenant=other` `400`.
- **T6 (`ref=local`):** terminal A `npm start` (port 3000); terminal B the worker dev script (port 8787) with the local env and a real `.dev.vars` (or loopback overrides for a UI-only pass); open a document for the test page in the EW editor with `?ref=local`, open the library, pick **Insights**: the source switcher lists Adobe Target (and GA4 if mapped); the Target tab shows the T1 activities that should match with the right match reason, statuses, variants, splits, visitors, conversions, rates and lift equal to T4 within the documented definitions; the range control changes nothing on this tab and the section titles say "since start". DevTools Network: preflight `204`, `Authorization` only on the worker call, no Adobe credential or token in any response (AC1, AC2, AC5, AC6).
- **T7 (branch ref):** push a branch with a simple name (e.g. `insights-target`), wait for code sync; open the editor with `?ref=insights-target`; the panel loads from the branch and calls the **deployed** worker; same checks as T6; record the page's real `Origin` (AC5).
- **T8 (caching and call counts):** reopen within five minutes: worker logs show cache hits and no new Adobe calls; after the report TTL only report calls recur; for a tenant with many activities, the first open reports `truncated` and a later open completes the catalog (AC2; R3).
- **T9 (secret hygiene):** search responses, page source and Application storage for the client secret and any access token; `wrangler secret list` shows names only; rotate the client secret in the Developer Console (add new, deploy `wrangler secret put`, delete old) and confirm the panel keeps working after the cached token expires or the worker restarts (AC6).
- **T10 (negative: access revoked):** remove the credential's product profile (or role) in the Admin Console: the panel shows a not-set-up-correctly style message, the log shows the permission reason class, no upstream text reached the browser; restore access (R7).
- **T11 (states):** a page with no matching activity shows the empty state; a site not in `TARGET_SITES` shows no Target source (and the not-configured message if requested directly); worker down shows the retry message and the editor stays usable.
- **T12 (matching accuracy):** for each T1 activity and several URLs (exact page, a sibling page, a trailing-slash variant, an `index` page, a query-string variant, a different host) compare the panel's list with what Target's own targeting says; record false positives and false negatives; verify `includeSitewide` and a `pins` entry; update Decision 8 and the README limits accordingly.
- **T13 (README walk-through):** a reviewer follows the extension README's Adobe Target section from a clean clone to a working Target tab on a scratch site, using only what it says (AC4).
- **T14 (shell isolation review):** `git diff --stat origin/main...` shows changes only in `providers/adobe-target/`, the registry line, worker config (`TARGET_*` vars and `TARGET_CLIENT_SECRET`), `.dev.vars.example`, the extension README, the root README row text and test fixtures; no browser source, route, cache, contract or GA4 file (AC3).

## 6. Repo checks (seam S3, extended; temp-dir fixtures)

| ID | Behaviour asserted |
|---|---|
| UT1 | `providers/adobe-target/` has a README and `worker/` with tests; the registry entry for `adobe-target` resolves to that folder and the folder is registered (extends #33 UI4) |
| UT2 | Shell isolation stays green with the provider present: only the registry module imports from `providers/` (#33 UI3); a fixture importing `providers/adobe-target/...` from a route file fails |
| UT3 | `TARGET_CLIENT_SECRET` is in `secrets.required` and in `.dev.vars.example`; `TARGET_CLIENT_ID`, `TARGET_OAUTH_SCOPES`, `TARGET_SITES` and the tunables are in `vars`; no `vars` key is secret-looking (#2 UR3); no tracked `.dev.vars*`/`.env*` (#2 UR2) |
| UT4 | Browser code (outside `worker/` and `providers/*/worker/`) contains no `mc.adobe.io`, no Adobe IMS token host and no tenant id (extends #33 UI6 with the Target host list; [ASSUMPTION: the forbidden-host list is data in the check]) |
| UT5 | The extension README has an Adobe Target section naming the secret, the variables, the `TARGET_SITES` keys and the required scopes and role; the provider README exists and documents the matching rules, their limits and the metric definitions (AC4) |
| UT6 | The root README extensions table row for `insights-sidebar` still resolves and its description mentions Adobe Target (#33 UI1 stays green) |

## 7. CI additions (no credentials, no Cloudflare login, no Adobe account)

No new jobs; the provider's tests plug into the #1/#2/#33 jobs on every push and PR.

| Job | Gains |
|---|---|
| `lint` | ESLint/Stylelint over the provider (worker code with the #2 Node/worker override); S3 UT1-UT6 |
| `unit` | BT1-BT5 (WTR) |
| `worker-unit` | TA*, TQ*, TC*, TM*, TN*, TX*, IT* (`node:test` over `providers/adobe-target/worker/test` and the shell's worker tests, including the conformance suite) |
| `worker-smoke` | SM-T1-SM-T5 (workerd via wrangler; advisory if flaky, per #2 Open Question 11) |
| `e2e` | PW-T1-PW-T7 (Chromium); the global setup starts the worker, fake Target, fake IMS and fake Google |

## 8. Acceptance-criteria traceability (ticket #35)

| # | Acceptance criterion (#35) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Sidebar lists Target activities targeting the page URL with status, variants and conversion lift | TM1-TM10 (page association, status, ordering, caps), TQ1-TQ4 (list, definitions, audiences, reports), TN1-TN10 (variants, split, rates, lift, empty/not-configured, hostile text, schema), TX3-TX4 (shell accepts the shapes), BT1, BT2 (rendering), PW-T1, PW-T6, PW-T7 | **T2** (real JSON), **T4** (ground truth), **T6**, **T7**, **T12** (matching accuracy against Target), **T11** (states) |
| AC2 | Target credentials are held by the worker | TA1-TA3 (the worker mints and uses the credential), TQ1, TC1-TC7 (caching of data, never of identity), SM-T2, SM-T4, PW-T1, PW-T2 | **T5** (secret in the store), **T8** (cache and call counts), **T9** (rotation) |
| AC3 | Added inside the existing `insights-sidebar` folder as a new provider; no shell changes beyond registering the provider | TX1 (conformance), TX2 (registry with one line; shell and GA4 tests pass unmodified), UT1, UT2 (isolation), UT3 (config-only additions), BT1-BT5 (unchanged shell renders it), PW-T6 | **T14** (diff review limited to the allowed files); review of Decisions 12-13 gaps recorded as open questions, not shell edits |
| AC4 | Extension README documents this vendor's setup (credentials, site config keys) | UT3 (`.dev.vars.example` and vars lists), UT5 (README sections present), UT6 | **T13** (README walk-through from a clean clone); review: README names the Developer Console steps, scopes, role, `TARGET_SITES` keys and matching limits |
| AC5 | Works in EW with `ref=local` and with a branch ref | PW-T1-PW-T7 and SM-T1-SM-T5 run against `localhost:3000` + local worker (the `ref=local` topology); SM-T3 (local CORS) | **T6** (`ref=local`), **T7** (branch ref against the deployed worker, observed `Origin`) |
| AC6 | Vendor credentials live only in this extension's worker (built from the shared template); the browser never receives them; unauthenticated calls are rejected | IT1, TQ8 (auth/origin/steering before any Adobe call), TA8 and TX1 (canary and derived credentials), TQ5-TQ6 (host and read-only confinement), SM-T3, BT5, PW-T3, PW-T4, PW-T5, UT3, UT4; the #2 template tests (UA*, UC*, US*) | **T5** (curl: no token `401`, evil origin `403`, steering `400`), **T9** (hygiene, rotation), **T10** (revocation), **T0** |
| AC7 | Core logic covered by unit tests; lint and CI green | all of sections 1-4 run in the CI jobs of section 7; TA*, TQ*, TC*, TM*, TN*, TX* are the core-logic tests | Review: CI green on the PR (all five jobs); a deliberately broken rule on a scratch branch (e.g. send a `PUT` to Target, or drop the `Accept` version) turns TQ6 or the fake's `406` red |

Every acceptance criterion on #35 maps to at least one automated test or a numbered manual verification step above.

## 9. Open questions for the owner

1. **Target sandbox and credentials (R9).** Which Target tenant, Adobe org and Developer Console project may be used for T1-T12 (a sandbox or trial, or a company tenant), under which account (#1 R1: infrastructure under a personal account), and who is Product Admin? Can the test site run Target's client library so real variants and conversions exist? Without a tenant the spike (T2) cannot happen and the matcher stays unverified.
2. **Matching strategy.** Approve "audience page-URL rules + site pins + optional sitewide" as the v1 meaning of "targeting the page URL", knowing Target offers no URL query and the rule JSON is undocumented (R1, R2)? Alternatives: pins only (deterministic, manual config), or Delivery API prefetch (rejected here as incomplete). Should sitewide stay opt-in?
3. **Which activities.** v1 shows live and scheduled A/B and XT only. Should ended activities (concluded tests with final results) be included, and should MVT, Automated Personalization, Auto-Allocate or Recommendations ever be?
4. **Lift definition (R4).** Confirm visitor-based conversion rate, control = lowest experience id, lift = rate/control rate - 1, and **no significance figure**. If Target's UI differs (visit-based, a different control, a confidence value shown to authors), which definition wins? T4 settles the facts; you settle the policy.
5. **Range semantics.** Target data is cumulative since start; the range control will have no effect on this tab. Accept that for v1, or ask #33 to add an optional descriptor flag ("range does not apply") so the shell can disable the control?
6. **Negative and large `percent` values.** The #33 text calls `percent` a fraction 0..1 and the validator is described as finite-only. Confirm the shell is meant to accept lift below 0 and above 1 (TX4), or approve an additive format.
7. **Client id as a variable.** Keep `TARGET_CLIENT_ID` (the `x-api-key` value) as a non-secret `vars` entry, or treat it as a secret?
8. **Required secrets coupling (R10).** `TARGET_CLIENT_SECRET` in `secrets.required` blocks GA4-only deploys. Accept, or request optional secrets in the #2 template?
9. **Authorisation depth.** Experiment data is sensitive (R6). Approve #33's DA read-access `authorize` hook before any company tenant is mapped (recommended), or accept sandbox-only until then?
10. **Worker plan (R3).** Free plan allows 50 subrequests per invocation; the provider budgets 40 and resumes. Accept, or run Paid so a large catalog builds in one request?
11. **Tenant model.** One Adobe organisation and one credential per worker, many sites mapped by tenant (and optional workspace). Is that enough, or do you need several credentials?
12. **`TARGET_SITES` shape and `baseUrl`.** Confirm a provider-owned variable (per the #33 table) rather than a single shared mapping variable, and that `baseUrl` should be required (recommended; avoids cross-host false positives) rather than optional.
13. **Overlap and sequencing (#33 R13).** EDS has its own experimentation tooling. Do you still want Target before #34 or any first-party source?
14. **Scopes.** Confirm the scope string the Developer Console shows for an OAuth Server-to-Server credential with the Adobe Target API (the only scope list found came from a JWT-era sample); provide it for `TARGET_OAUTH_SCOPES`.
15. **Shared Adobe token code.** If #34 ends up with the same client-credentials module, hoist it into the worker's shared `src/` or keep one copy per provider?
16. **Batch endpoint.** The batch API could cut catalog calls but needs undocumented `authRequestData` and `requestHost` parameters. Worth a spike once a sandbox exists, or leave it unused?
