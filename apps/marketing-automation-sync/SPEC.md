# Spec: Marketing Automation Sync: Marketo (mapping shell + first vendor)

Ticket: jazhou-adobe/ew-extensions#27 (this spec: #65). Blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). #27 blocks the vendor follow-ups #28 (Adobe Journey Optimizer), #29 (Braze), #30 (Klaviyo), #31 (HubSpot) and #32 (Iterable), which will each add one module to the vendor interface defined here.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1, #2 and #7 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Marketo/Cloudflare.

Vocabulary follows #1 and #2: *extension* = one folder `apps/<name>/`; *worker* = the per-extension backend in `apps/<name>/worker/` built from `shared/worker-template/`; *provider* = one vendor under `apps/<extension>/providers/<vendor>/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension. Domain terms used here:

- **Source page** = an EW page or fragment (a document published to the site's live partition).
- **Field** = one addressable piece of content inside a source page: a cell of a block, or the whole block.
- **Target** = a content object in the vendor that can receive content (Marketo: a program or a snippet).
- **Slot** = a named writable value inside a target (Marketo: one program token; a snippet has exactly one slot, its body).
- **Binding** = one source page mapped to one target: a list of field-to-slot rules plus options.
- **Mapping** = all bindings saved for one site.
- **Sync** = pushing the current values of a binding's fields into its slots. **Re-sync** = a sync the worker starts because the source page's published version changed.

Primary sources read (all 2026-11-16 unless noted): Marketo REST docs on Experience League: [REST API overview](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/rest-api), [Authentication](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/authentication), [Error codes](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/error-codes), [Snippets](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/snippets), [Tokens](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/tokens), [Programs](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/programs), [Folders](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/folders), [Custom services](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/custom-services), [Marketo sandbox](https://experienceleague.adobe.com/en/docs/marketo/using/product-docs/core-marketo-concepts/miscellaneous/marketo-sandbox); the Contentful announcement cited by the ticket (https://www.contentful.com/blog/new-apps-integrations-marketplace/); EW app docs (https://www.aem.live/docs/ew/developing/apps-plugins); EDS markup reference (https://www.aem.live/developer/markup-reference); the AEM Admin API status endpoint (observed by `curl`); DA backend `adobe/da-admin` (`src/routes/list.js`, `src/utils/daResp.js`); upstream `adobe-rnd/ew-extensions` (code search for `marketo`, `plain.html`); the #1, #2 and #7 specs in this repo. Cloudflare facts (cron triggers, D1, plan limits) are cited from the #7 spec, which read them on the same date; they were not re-read here.

---

## Problem Statement

A team that runs its campaign content in Experience Workspace (EW) also runs campaigns in a marketing automation platform. Today the same headline, body copy, call-to-action and image URL are written twice: once as an EW page or fragment, once inside the platform (for Marketo: program tokens such as `{{my.headline}}` and reusable snippets used by emails and landing pages). Every copy fix has to be repeated by hand, and the two copies drift. Contentful recently shipped four marketing automation apps (Klaviyo, HubSpot, Iterable, an updated Braze) that map entry fields to the vendor's content objects and keep them updated [VERIFIED: https://www.contentful.com/blog/new-apps-integrations-marketplace/]; EW users have nothing comparable.

Four things make this harder than "call the vendor API":

1. **The vendor call needs a secret and a backend.** Marketo uses two-legged OAuth with a client id and client secret that must never be in a public page; so the template worker (#2) is mandatory [VERIFIED: https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/authentication].
2. **"When the page is published" has no event source.** No EW webhook or publish event is documented (the #7 spec searched the AEM Admin API, the DA Admin API and the upstream extension repo and found none [VERIFIED by absence in that spec; OPEN: ask the EW team]). The ticket therefore asks for polling, which also needs a backend that keeps running when nobody has EW open.
3. **EW content is documents, not typed fields.** A page is sections, default content and blocks whose cells are free-form; there is no content-model field name to map from. The admin needs a stable way to say "the second cell of the first `hero` block".
4. **Each vendor differs in objects, auth and limits.** Marketo alone returns most failures as HTTP 200 with an error code in the body, enforces 100 calls per 20 seconds and 50,000 per day per instance, and writes one program token per call [VERIFIED: rest-api, error-codes and tokens pages above]. Four more vendors are queued behind this ticket; each must be able to join without touching the mapping UI, the storage or the sync engine.

The maintainer needs a mapping shell (vendor-neutral) plus Marketo as the first vendor, so campaign content is authored once.

## Solution

Ship one extension, `marketing-automation-sync`, a fullscreen EW app plus its worker:

- **The app** (static page in EW, registered as a row in the `apps` sheet): an admin picks a site, picks a source page, sees that page's blocks and fields as read from the published content, picks a vendor and a target (for Marketo: browse programs or snippets), maps fields to slots, previews exactly what would be written, saves the mapping for the site, and presses **Sync now** per binding or for the whole site. A status view shows, per binding and per slot, the last sync time, the state, and the error if there is one.
- **The worker** (Cloudflare Worker built from the shared template, with a D1 database and a cron trigger): holds the Marketo client id and secret, authenticates every call with the caller's IMS token, extracts field values from the published HTML, talks to Marketo, stores the mapping and the sync state, and every few minutes checks each mapped page's published version and re-syncs the ones that changed.
- **The vendor interface**: a small contract (connect, list targets, describe a target, push slot values, normalised errors) implemented by one module per vendor. Marketo is the first module. The mapping model, extraction, storage, sync engine, status view and mapper UI contain no Marketo knowledge; the vendor tickets add a module and its contract-suite run, nothing else.

What the user sees: open **Marketing Automation Sync** from the EW Apps menu, choose `Marketo`, choose program "Spring Launch", map the `hero` block's heading cell to token `headline` and its CTA link to token `cta url`, preview the two values, save, press Sync now, and see the tokens appear in Marketo. Later, an author edits and publishes the page in EW; within the polling interval the status view shows a new "last synced" time and the Marketo token holds the new text. If Marketo rejects something (permission removed, token name invalid), the affected slot shows a plain error and the rest of the binding still syncs.

## User Stories

Admin (site or campaign admin who sets up the mapping):

1. As an admin, I want to pick a source page or fragment from my site, so that I can map content that campaigns actually use.
2. As an admin, I want to see the page's blocks and fields exactly as published, so that I map what the platform will receive.
3. As an admin, I want to map a block field (a cell) to a vendor slot by clicking it, so that I never type a selector.
4. As an admin, I want to map a whole block to a snippet body, so that a reusable section can be kept in sync as HTML.
5. As an admin, I want to choose how a value is converted (plain text, HTML, first link URL, first image URL), so that tokens and snippets receive the right shape.
6. As an admin, I want to pick a Marketo program or snippet from a searchable list, so that I never copy ids around.
7. As an admin, I want to see which tokens already exist in the chosen program, so that I reuse names instead of creating near-duplicates.
8. As an admin, I want to name a new token while mapping and have it created on first sync, so that I do not have to create it in Marketo first.
9. As an admin, I want validation messages while editing (name too long, duplicate slot, same slot mapped twice anywhere in the site), so that I find mistakes before saving.
10. As an admin, I want a preview that shows the exact values and the vendor operations that would run, without changing anything, so that I can trust the first real sync.
11. As an admin, I want to save the mapping per site, so that my setup is there next time and for my colleagues.
12. As an admin, I want a save to fail clearly if a colleague saved first, so that I never silently overwrite their changes.
13. As an admin, I want to disable a binding without deleting it, so that I can pause syncing for a campaign.
14. As an admin, I want to choose per snippet binding whether a sync only updates the draft or also approves it, so that nothing goes live in emails before someone reviews it.
15. As an admin, I want to export and import the mapping as JSON, so that I can back it up or copy it to another site.
16. As an admin, I want to check the Marketo connection from the app and see "connected" or a plain reason it is not, so that I can diagnose setup without reading logs.
17. As an admin, I want to be told how to create the Marketo API-only user and service with the right permission, so that setup needs no guesswork.

Campaign author (edits and publishes in EW):

18. As an author, I want my published edits to reach the platform without me doing anything, so that I do not repeat the copy there.
19. As an author, I want to see when a page was last synced and whether it succeeded, so that I know the campaign shows my latest copy.
20. As an author, I want a Sync now button for a page, so that I can push right after publishing instead of waiting for the next poll.
21. As an author, I want an unpublished or deleted source page to show "source unavailable" rather than blank out vendor content, so that a mistake does not wipe a live campaign.
22. As an author, I want a missing or empty field to be reported per slot with the field named, so that I know which edit broke the mapping.

Maintainer / operator:

23. As the maintainer, I want the Marketo client id and secret only in the worker's secret store, so that no page, response or log can leak them.
24. As the maintainer, I want every worker route to reject unauthenticated callers before doing anything, so that nobody can read mappings or spend Marketo API quota.
25. As the maintainer, I want the worker to serve only an allowlist of sites, so that it cannot be pointed at arbitrary sites or abused as an open fetcher.
26. As the maintainer, I want only users who can write to a site in DA to edit that site's mapping or trigger syncs, so that "any Adobe user" cannot change campaigns.
27. As the maintainer, I want the worker to pace Marketo calls under its rate limit and daily quota, so that this integration cannot starve other integrations on the same instance.
28. As the maintainer, I want Marketo's in-body errors (rate limit, expired token, transient error) handled correctly, so that a throttled or rotated-token run recovers by itself.
29. As the maintainer, I want one failed slot not to block the others, so that a single bad token name does not stop the campaign.
30. As the maintainer, I want the worker to never delete or clear vendor content on its own, so that automation cannot destroy campaign assets.
31. As the maintainer, I want a repeated sync with unchanged content to make no vendor writes, so that polling costs almost no quota.
32. As the maintainer, I want a lease per site so two cron ticks or a tick and a Sync now never push the same binding at once, so that writes do not interleave.
33. As the maintainer, I want structured logs with request ids, binding ids and error codes but no secrets, tokens or content bodies, so that I can debug without a new leak.
34. As the maintainer, I want the mapping and sync state in one database that holds no vendor credentials, so that a database leak does not leak Marketo access.
35. As the maintainer, I want a documented way to add a vendor (one module, one contract-suite run, one secrets block), so that the five queued tickets stay small.
36. As the maintainer, I want the README to document setup, the apps-sheet row, the worker deployment and which site configuration the extension reads, so that a new person can enable it alone.
37. As the maintainer, I want the extension listed in the repo README table and the convention check to pass, so that the repo stays consistent.

Security reviewer:

38. As a security reviewer, I want proof that a canary Marketo client secret and a canary access token never appear in any response, header, log line or stored row, so that "never reaches the browser" is tested.
39. As a security reviewer, I want proof that every route, including ones added later, returns 401 without a token, so that a new route cannot ship unauthenticated.
40. As a security reviewer, I want proof that the user's IMS token is only ever sent to the DA admin host for the permission check, and never to Marketo or logged, so that token handling is auditable.
41. As a security reviewer, I want proof that an org, site, path or Marketo id cannot be used to make the worker call an unintended host, so that user input cannot cause server-side request forgery.
42. As a security reviewer, I want content from pages to be rendered as text in the app and sanitised before it is sent as HTML to a vendor, so that page content cannot inject script into the admin app or a campaign.

Vendor developer (the owner or an agent working #28 to #32):

43. As a vendor developer, I want a documented interface and a contract test suite, so that I know when my module is complete.
44. As a vendor developer, I want a fake vendor in the repo that already passes the suite, so that I have a worked example and the engine is tested without a real vendor.
45. As a vendor developer, I want vendor-specific rate limit and retry behaviour to live in my module, so that I can follow my vendor's rules.
46. As a vendor developer, I want my vendor's secrets declared in the worker config in one place, so that deploys fail loudly when one is missing.

## Implementation Decisions

(No file paths or code. Layout and contract shapes are in the Build Analysis. Decisions about the template are phrased as requirements on #2 in Decision 25.)

**Product shape and scope**

1. **One app, one worker, vendor-neutral core plus vendor modules.** The extension is a fullscreen app (an `apps` sheet row). Per the owner convention the whole extension lives in `apps/marketing-automation-sync/`; the worker in `worker/`; Marketo in `providers/marketo/` (its worker module under `providers/marketo/worker/`, per #2 Decision 3 [OPEN there: confirm that refinement]). The vendor follow-ups add `providers/<vendor>/`.
2. **Scope of #27 = mapping shell + on-demand sync + polled re-sync + Marketo (snippets and program tokens).** One direction only: EW to vendor.
3. **The extension reads no EW site configuration.** It reads the SDK `context` (org, site) only to prefill the site field. All settings live in the worker's own database and variables. The README states this (AC4 "any site config it reads": none).
4. **Source is always the published (live) content.** Sync reads the live partition of the site's main branch. The mapper can optionally read the preview partition so an admin can map a page before first publish; the sync never does. A page that is not published is reported as `source_unavailable`, never as empty content.
5. **Never destructive.** The worker never deletes vendor content: not on unmap, not on page unpublish, not on disable. The vendor interface has no delete operation.
6. **Sites are allowlisted.** The worker serves only `org/site` pairs listed in its configuration (non-secret variable). Everything else is refused (`site_not_allowed`) before any outbound call.

**Content model and extraction**

7. **Field addressing.** A field is addressed by block name (the block's first CSS class as rendered in the published HTML), the block's occurrence index among blocks of that name in document order, and then either a *key* or a *cell position*:
   - For blocks whose rows are key/value pairs (first cell is a label, second the value), the address is the normalised label text (lower-case, whitespace collapsed). It survives row reordering.
   - Otherwise the address is row and cell position (1-based).
   - Omitting the field selects the whole block. A source with no block (page-level default content such as the first `h1`) is out of scope for #27.
   Rationale: EW documents are not typed; this is the smallest addressing scheme that is stable for key/value blocks and usable for everything else. [ASSUMPTION: authors' blocks are mostly key/value or fixed-layout; to be checked against real campaign pages, Open Question 9.]
8. **Four value formats**: `text` (text content, whitespace normalised), `html` (sanitised HTML), `url` (href of the first link in the field), `image` (absolute src of the first image in the field). The format decides the vendor value type (Marketo: `text` and `url` and `image` become `text` tokens; `html` becomes a `rich text` token or a snippet HTML body).
9. **HTML conversion rules for the `html` format.** Allowed tags are the ones EDS renders in block cells and default content [VERIFIED list: https://www.aem.live/developer/markup-reference]; `picture`/`source` collapse to one `img` using the fallback `img`'s absolute `src` (email clients do not render `picture`); headings lose their generated `id`; `loading` attributes are dropped; every `href`/`src` is made absolute against the live origin of the site (relative `./media_...` references are what EDS emits [VERIFIED: observed in `https://main--da-live--adobe.aem.live/index.plain.html`]); scripts, event handlers, styles, forms and unknown tags are stripped. A custom production domain per site is not supported in #27 (Open Question 7).
10. **Missing or empty is an error, not an empty write.** A field that no longer exists is `source_field_missing`; a field that exists but has no value is `empty_value`. In both cases that slot is skipped (vendor value untouched), the slot shows the error, and the other slots still sync. Silently pushing empty strings would blank out live campaign content. [ASSUMPTION: Marketo may also reject blank values, see error 701 "cannot be blank" in the error-code table; behaviour for tokens verified in spike S3.]
11. **Size guard.** An extracted value over a configured cap is `value_too_large` (default 100 KB [ASSUMPTION]); Marketo's own request cap is 1 MB [VERIFIED: error-codes page, HTTP 413]. Marketo's per-token and per-snippet content limits are not documented in the pages read [OPEN, spike S3].
12. **One extraction implementation, in the worker.** The mapper UI asks the worker for the block/field tree of a page, rather than parsing HTML in the browser. This guarantees the preview, the saved mapping and the sync use the same addressing. The worker parses with a small pure-JavaScript HTML parser dependency, not `HTMLRewriter`, so the same code runs in Node unit tests and in workerd [ASSUMPTION: bundles and runs in workerd; spike S4].

**Vendor interface**

13. **Interface (behavioural contract, shapes in section 4).** A vendor module provides: a *descriptor* (id, label, supported target kinds, per kind: how slots are named (`named-slots` or `single`), accepted value formats, name constraints, optional approval step, required secret names); `connect` (obtain a short-lived session from the worker's secrets; the session is held in memory only); `listTargets` (paged, optional text filter, per kind); `describeTarget` (existing slots of a target, so the UI can suggest names); `push` (write a set of slot values to one target, return a per-slot result and any vendor-side state such as "draft"); and a normalised error taxonomy (`auth_failed`, `permission_denied`, `target_not_found`, `invalid_value`, `rate_limited`, `quota_exhausted`, `vendor_unavailable`, `unknown`, each with a `retryable` flag). There is no delete and no create-target operation in #27.
14. **Later vendors only add a module.** The worker registers vendor modules from a list; the descriptor drives the UI (target kinds, slot naming rules, approval option); the sync engine consumes only the interface. Adding a vendor = one module + one descriptor + one run of the shared contract suite + secrets declared in the worker config. Anything a vendor needs that the descriptor cannot express is a deliberate contract change reviewed across all vendors. Whether the interface suffices for AJO content fragments, Braze content blocks, Klaviyo templates, HubSpot module fields and Iterable feeds is [ASSUMPTION: those APIs were not researched here; each vendor ticket's spec must confirm or propose an interface amendment, Open Question 13].
15. **A fake vendor lives in the repo** (test-only module registered in test environments). It passes the same contract suite and lets engine tests run without Marketo.

**Marketo module**

16. **Targets: existing programs (program tokens) and existing snippets.** The module does not create programs or snippets. Program tokens are created on first push (the create-token operation upserts: it "creates a token or updates an existing token with the submitted values") [VERIFIED: tokens page].
17. **Auth: two-legged OAuth, client credentials, header transport.** The module obtains an access token from the instance's Identity endpoint with the client id and secret and sends `Authorization: Bearer` on every REST call [VERIFIED: authentication page]. The `access_token` query parameter is not used; per the Authentication page it was removed on 2026-08-31 (the REST overview page still says it "is being removed on June 30, 2025": the pages disagree; the newer-dated page and the header method are used) [VERIFIED discrepancy]. The Identity endpoint accepts GET or POST [VERIFIED]; the module uses POST so the secret is not in a URL [ASSUMPTION: form-encoded body accepted; spike S3]. The token (3600 s lifetime) is cached in isolate memory until a minute before expiry; `601`/`602` trigger one re-authentication and one retry [VERIFIED codes]. The token is registered for redaction and never stored.
18. **Instance address.** Non-secret variable `MARKETO_MUNCHKIN_ID`; the module derives `https://{id}.mktorest.com/identity` and `https://{id}.mktorest.com/rest`. The id must match the Munchkin pattern and the host is fixed to `*.mktorest.com`; no URL comes from callers [ASSUMPTION: pattern and domain; the REST pages describe the endpoint as found under Admin > Web Services]. Single-tenant in #27: one Marketo instance per worker deployment (Open Question 2).
19. **Operations used** (all under `/rest/asset/v1`, form-encoded bodies, not JSON [VERIFIED]):
   - list programs: `GET programs.json` with `maxReturn` (default 20, max 200) and `offset`; get by exact name `GET program/byName.json` [VERIFIED: programs page];
   - list snippets: `GET snippets.json` (`status` filter for approved/draft); **there is no query-by-name for snippets**, so the module pages through results and filters by name in the worker within a bounded page budget [VERIFIED limitation: snippets page; pagination parameters for snippets are [ASSUMPTION], programs and folders documented `maxReturn`/`offset`];
   - existing tokens of a program: `GET folder/{id}/tokens.json?folderType=Program` [VERIFIED];
   - write a token: `POST folder/{id}/tokens.json` with `name`, `type`, `value`, `folderType=Program`; token `name` must not exceed 50 characters; one token per call [VERIFIED];
   - write snippet content: `POST snippet/{id}/content.json` with `type=HTML` (or `Text`) and `content` [VERIFIED];
   - approve: `POST snippet/{id}/approveDraft.json`; the snippet must be in draft status; approving something with no draft is business-rule error `709` [VERIFIED: snippets page and error table]; the module treats "already approved" as success.
20. **Snippet approval default is draft only.** Writing content creates or updates the draft; the binding option `approve` (default off) also approves. Approved assets that embed the snippet pick up the approved version, so auto-approval changes live campaigns [ASSUMPTION on downstream effect; Open Question 3].
21. **Marketo-specific error handling lives in the module.** Most Marketo failures are HTTP 200 with `success: false` and a code [VERIFIED]. The module classifies by code: `601`/`602` re-authenticate; `603` is `permission_denied`; `606` (rate limit) and `615` (concurrent limit) and `713` (transient) and `604`/`608`/`611` retry with backoff; `607` (daily quota) is `quota_exhausted` and stops further calls for the day; `610`/`710`/`711` or a missing target are `target_not_found`; `701`/`704`/`709` on a value are `invalid_value` [codes VERIFIED in the error table; which of 604/608/611/713 are worth retrying is [ASSUMPTION]]. Marketo error message text is not passed to the browser; fixed messages keyed by code are (messages can name assets).
21a. **Pacing.** The module and the sync engine together keep calls under Marketo's published limits: at most 2 concurrent calls, at most 5 calls per second from this worker [ASSUMPTION: conservative share of 100 per 20 s], and a per-tick call budget and a per-day counter (default 10,000 of the 50,000 daily quota [VERIFIED quota; chosen share is ASSUMPTION], Open Question 11). Idempotence: token writes and snippet content writes are safe to repeat; the module passes the template's explicit "safe to retry" flag for them.
22. **Required Marketo setup** (documented in the README): an API-only user whose role has the Read-Write Assets permission, a LaunchPoint custom service for it, the Identity and REST endpoint host, and the client id and secret [VERIFIED: custom-services and rest-api pages]. Asset access is per workspace [VERIFIED: custom-services page]; the user's role must cover the workspace that holds the target programs and snippets.

**Storage and sync engine**

23. **Storage: Cloudflare D1** (as #7 Decision 26) for: the mapping per site (one versioned JSON document, size-capped, validated on write), the per-binding sync state, the per-slot sync state, per-site leases, and the Marketo call counter per day. It holds **no vendor credentials and no content bodies**: only hashes of last pushed values. Optimistic concurrency: saves carry the version they edited and fail with a conflict if it moved.
24. **Change detection and cadence.** One cron trigger every 5 minutes [ASSUMPTION: default; minimum cron granularity is 1 minute, [VERIFIED via #7 spec: https://developers.cloudflare.com/workers/configuration/cron-triggers/]]. Per tick, for each enabled binding due: do a conditional request for the page's live `.plain.html` using the stored `Last-Modified`; a `304` means unchanged. Observed on 2026-11-16: live pages return `Last-Modified`, `Cache-Control: max-age=7200, must-revalidate`, `Access-Control-Allow-Origin: *` and no `ETag`; a missing page returns `404` with an `x-error` header [VERIFIED by `curl`: `https://main--da-live--adobe.aem.live/index.plain.html`]. Whether the CDN honours `If-Modified-Since` with `304` and how soon after a publish the new `Last-Modified` appears is [OPEN, spike S2]. Correctness never depends on the header: after any non-304 response the worker extracts, hashes each slot value, and writes only slots whose hash differs from the last successful push. A false "changed" costs one fetch and zero vendor calls. The Admin API status endpoint (`https://admin.hlx.page/status/{org}/{site}/{ref}/{path}`) exposes `live.lastModified`; it answered `200` anonymously for a public site on 2026-11-16 with a limit header of 10 requests per second [VERIFIED by `curl`]; it is the documented fallback detection signal if conditional GET proves unreliable (spike S2).
25. **Sync engine rules.** Per binding: fetch live source, extract, compare hashes, build the slot list of changed (or forced) slots, push to the vendor module, record per-slot results. A binding is `in_sync`, `pending` (changed, not yet pushed), `partial` (some slots failed), `error` (nothing pushed), `source_unavailable`, or `disabled`. Failed slots retry with backoff (5, 15, 60 minutes, then wait for the next source change or a manual sync) when the error is `retryable`; non-retryable errors (`permission_denied`, `invalid_value`, `target_not_found`, `source_field_missing`, `empty_value`) wait for a fix. **Sync now** forces all slots of the chosen bindings regardless of hash and runs inline up to a bounded number of vendor calls; whatever is left continues on the next tick and the response says so. A per-site lease prevents concurrent runs; the lease expires so a crashed run cannot block forever. Marketo `quota_exhausted` pauses the vendor for the rest of the day and leaves items `pending`.
26. **Last sync time and per-item errors are first-class data.** Every binding carries `lastSyncedAt` (last successful push or confirmed in-sync check), `lastAttemptAt`, `sourceLastModified`; every slot carries `state`, and on failure `errorCode` and a fixed human message (never a raw upstream message).

**Authentication, authorisation, secrets**

27. **Authentication**: the template's IMS check applies to every route unchanged (#2 Decisions 4 and 6). There are no unauthenticated routes except the template's `OPTIONS` preflight. The cron entry point is not an HTTP route.
28. **Authorisation** (beyond the template's client-id allowlist): after authentication, every `/v1/sites/{org}/{site}/...` route (a) requires the pair to be on the site allowlist and (b) checks the caller's DA permission on that site by asking DA's admin host with the caller's own token: a read on the site root is allowed for status and read routes; write permission is required for save, preview, sync and import. The check uses the actions DA reports for the caller: the `list` route returns `403` when the caller cannot read, and every response carries an `X-da-actions` header listing the caller's actions on the key, e.g. `/{key}=read,write` [VERIFIED in source: `adobe/da-admin` `src/routes/list.js`, `src/utils/daResp.js`]. The token is sent only to the fixed DA admin host (`admin.da.live`), never to Marketo, never logged. If DA is unreachable the route fails closed (`503`). Behaviour for sites with no permission configuration, and whether "write on the site root" is the right proxy for "may edit campaign mappings", are [OPEN, spike S1, Open Question 6]. Fallback if the owner dislikes forwarding the token: a configured allowlist of user ids or emails per site.
29. **Secrets**: `MARKETO_CLIENT_ID` and `MARKETO_CLIENT_SECRET` (Cloudflare Worker secrets, declared in the worker's `secrets.required`, `.dev.vars.example` for local). Non-secret vars: `MARKETO_MUNCHKIN_ID`, the site allowlist, `ALLOW_LOCALHOST` in the local env, content-origin override in the local env only. The browser sends and receives none of the secrets; no route returns the Munchkin id's credentials or the OAuth `scope` field (it contains the API user's email [VERIFIED: authentication page example]). The worker's responses to connection checks say only `ok` or a fixed reason.
30. **The worker origin is a constant in the page**, never from the URL (#2 Decision 13): loopback worker on `localhost`, fixed deployed origin otherwise.

**Platform**

31. **Workers plan**: cron plus D1 plus Marketo pacing do not fit the free per-invocation limits beyond a trivial load (see the limits table cited in the #7 spec); target Workers Paid and say so in the README [ASSUMPTION; Open Question 4].
32. **Tooling per owner convention**: ESLint 8 + helix config, Stylelint 16, `@web/test-runner` for browser code, Node built-in runner for worker code (#2 Decision 14), Playwright, Node 22 (>= 22.12 for wrangler 4), husky. Tests live inside the extension folder.
33. **README is part of AC4/AC5**: setup (Marketo user and service, secrets, D1 migration, deploy), the apps-sheet row, the "reads no site config" statement, `ref=local` and branch-ref instructions, how to add a vendor, the policy note carried from #1 (R1).

## Testing Decisions

**What makes a good test here.** Assert external behaviour only. Given an HTTP request or a cron tick and a fake outside world (fake Marketo, fake published site, fake DA admin, fake IMS, fake clock, in-memory store), assert the response, what was written to the fake Marketo (operations, order, count, values), what the status routes then say, and what was logged. Never assert on internal helper names, table layouts or how many internal functions ran. Four properties are asserted as negatives across every path: (1) the canary client secret and canary access token never appear in any response, header, log line or stored row; (2) no handler or outbound call happens before authentication and authorisation succeed; (3) nothing is ever deleted or blanked in the vendor; (4) an unchanged page causes zero vendor writes.

**Proposed seams** (recorded instead of asked, per #65). Reused seams first; two new ones, each at the highest point that has its own contract.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 (primary) | Worker HTTP boundary: `worker.fetch(request, env, ctx)` | reused from #2 | Route, authorisation, mapping, preview, extraction-via-API and security tests | Constructed `Request`; env factory; injected fetch, clock; fake IMS from the #2 test kit; fake published site, fake DA admin and fake Marketo as scripted fetch handlers |
| R1 | Worker tick: `worker.scheduled(controller, env, ctx)` on a fake clock, plus the on-demand sync route | reused from #7 (same worker, other entry point; if #7 has not landed it is built here, see R-T1) | Change detection, pacing, retry, lease, partial-failure tests | Same fakes plus a controllable clock; assertions on the fake Marketo's received operations and on the status route |
| V1 | **Vendor contract suite**: one behavioural suite that takes a vendor module and a fake of that vendor's API | **new** | Marketo module and the in-repo fake vendor now; every later vendor | Per-vendor fake HTTP handler; the suite only calls the module's public interface |
| R2 | Store contract: one suite run against an in-memory store and real local D1 | reused from #7 (conformance check only) | Version conflict, lease, uniqueness, pruning | In-memory implementation; local D1 in the smoke tier |
| S1 | Entry page + SDK module boundary | reused from #1 | Playwright e2e of the app | #1's SDK stub with a test-signed IMS-shaped token; the real worker in `wrangler dev` (as #2's E2E tier) plus local fakes |
| S2 | Render/logic module + SDK result | reused from #1 | WTR unit tests of the app | Injected `fetch`; hand-built SDK result |
| S3 | Repo convention check | reused from #1/#2 | CI lint job | Temp-dir fixtures |
| W2 | Same worker in the real workers runtime | reused from #2 | Smoke tier | `wrangler dev` local with local D1, fake Marketo/site/IMS/DA as local Node servers |

Why V1 is new: AC3 ("later vendors only add a module") is a property of an interface, so it needs a test that is independent of Marketo. Running the same suite against Marketo and the fake vendor, and running the sync engine against the fake vendor only, is the proof. Why content extraction has no seam of its own: it is exercised through W1 (preview and content routes) with golden HTML fixtures; if its fixtures grow unwieldy a focused fixture suite may be added without a new seam. The real boundary to Marketo and real EW is covered only by manual verification.

**Modules tested:** field extraction and format conversion, mapping validation and versioning, authorisation rule, site allowlist and input validation, Marketo module (auth, classification, pacing, push, approval), vendor registry, sync engine (change detection, hashing, retry, lease, budget), store contract, app render and bootstrap (mapper, preview, status), repo checks.

**Prior art:**
- This repo: #1 seams S1 to S3 and hello-world tests; #2 worker boundary seam W1, test kit (fake IMS, fake upstream, env factory, canary secret) and the `node:test` plus smoke split; #7 tick seam R1 and store conformance R2.
- Upstream `adobe-rnd/ew-extensions` has no worker code and no `marketo` reference (code search 2026-11-16: no hits for `marketo`); its only relevant prior art is the injection pattern (`fetchImpl`, `storage`, `now`) in `tools/brand-visibility/session-auth.js` and `tools/block-editor/library.js`, which fetches `.plain.html` through `daFetch` for hosted blocks [VERIFIED by code search], the same document shape this extension reads.

## Out of Scope

- Any vendor other than Marketo (#28 to #32), including their API research; only the interface and the fake vendor.
- Creating programs, snippets or folders in Marketo; deleting or clearing vendor content; vendor-to-EW sync; drift detection when someone edits a token in Marketo (a later sync overwrites it; last write wins, README says so).
- Marketo emails, landing pages and Design Studio assets beyond snippets and program tokens; Lead Database APIs; Marketo dynamic content segmentation (`DynamicContent` snippet sections).
- Multi-tenant vendor credentials (per-site credentials entered in the app and stored encrypted). #27 is single-tenant, one Marketo instance per deployment (Open Question 2).
- Sites protected by EW site authentication (the worker reads live content anonymously); locale and language variants as a mapping dimension (a localised page is just another page).
- Page-level default content and page metadata as sources (only blocks and their cells).
- A custom production domain for absolute URLs; image rendition choice beyond the fallback `img`.
- An event-driven (webhook) trigger; the 5-minute poll is the trigger.
- CI-driven worker deployment; Cloudflare credentials in CI (#2 Decision 15).
- Visual design beyond basic semantics and accessibility; automatic mapping suggestions.
- The Adobe outside-activity/IP policy decision (flagged; owned by #1 R1).

## Further Notes

- **Marketo asset writes are per call and form-encoded.** Tokens are written one per call (so a binding with 10 tokens costs 10 calls plus at most one authentication), snippets in two calls (content, then optional approve). Hash-gated writes keep steady-state cost near zero; a first sync of a large mapping is bounded by the pacing budget and may span several ticks.
- **Marketo error semantics differ from HTTP.** The template's retry helper (#2 Decision 8) retries HTTP `429` and `5xx`; Marketo reports rate limiting as HTTP 200 with code `606`/`615` in the body. The helper alone would therefore never retry Marketo throttling; see R-T3.
- **Marketo sandbox is a paid add-on** ("Not everyone has purchased this feature"; contact the Account Manager) [VERIFIED: sandbox page]. No sandbox or test instance is available to the agent; every Marketo behaviour here comes from documentation and must be confirmed in spike S3 against a real instance. Until then the fake Marketo's fixtures are hand-written from the docs [ASSUMPTION].
- **Comparable behaviour.** Contentful's Klaviyo app maps individual entry fields and locales; its HubSpot app maps structured entries to custom modules; its Braze app selects fields and pushes to campaigns [VERIFIED: https://www.contentful.com/blog/new-apps-integrations-marketplace/]. This spec maps "entry field" to "block field", "entry update" to "page published", and picks program tokens and snippets as the Marketo equivalents. Whether Adobe Journey Optimizer should come first for Adobe fit (the scoring note) is a sequencing choice already made by the ticket graph (#28 follows #27).
- **No Marketo prior art upstream.** `adobe-rnd/ew-extensions` code search for `marketo` returned nothing on 2026-11-16.
- **The `apps/marketing-automation-sync/SPEC.md` file** is a planning artefact; keep or delete it when the extension is built, as decided for the hello-world spec [OPEN, low stakes].

---

# Build Analysis

## 1. Architecture and responsibilities

```
 EW (da.live)  ── iframe ──►  EW app "Marketing Automation Sync"   (static, public; origin {ref}--{site}--{org}.aem.live | .preview.da.live | http://localhost:3000)
                                │  SDK: IMS token, context           Authorization: Bearer <IMS>   (CORS preflight; template allowlist)
                                │  actions.daFetch -> admin.da.live  (page picker: list pages of the site)
                                ▼
 ┌────────────────────────── Worker (Cloudflare, built from shared/worker-template) ────────────────────────────────────┐
 │ fetch():  1 origin gate  2 IMS auth  3 site allowlist + DA permission  4 routes                                      │
 │ scheduled() every 5 min:  per site (lease) → per due binding → conditional GET live .plain.html → extract → hash     │
 │                           → changed slots → vendor module push (paced) → state                                       │
 │ vendor registry:  marketo (providers/marketo/worker)   fake-vendor (test only)                                       │
 │ D1: site_mappings, binding_state, slot_state, leases, vendor_usage      Secrets: MARKETO_CLIENT_ID, MARKETO_CLIENT_SECRET │
 └───────┬───────────────────────────────┬───────────────────────────────────────────┬─────────────────────────────────┘
         │ GET live content (anon)       │ DA permission check (caller's token)      │ Identity + REST (client credentials)
         ▼                               ▼                                           ▼
 https://main--{site}--{org}.aem.live   https://admin.da.live/list/{org}/{site}/   https://{munchkin}.mktorest.com/identity , /rest/asset/v1/...
```

| Concern | App (browser, public static) | Worker (holds secrets) |
|---|---|---|
| Marketo client id/secret, access token | never | only place; secrets store; token in isolate memory |
| IMS token | obtained from SDK, sent as bearer | verified by the template; forwarded only to `admin.da.live` for the permission check |
| Page picking | `actions.daFetch` list | none |
| Field tree, preview, extraction | renders text | fetches live HTML, parses, sanitises, extracts |
| Mapping storage and versioning | edit and send | validate, store, version |
| Change detection and sync | triggers "Sync now", shows status | all of it; cron |
| Vendor calls, pacing, retries, error mapping | none | all |
| UI | all | none |

## 2. EW integration points

- **Type: fullscreen app.** A row in the `apps` sheet of the site config (`https://da.live/config#/{org}/{site}/`): `title` "Marketing Automation Sync", `description`, `path` the full `https://da.live/app/{org}/{site}/apps/marketing-automation-sync/marketing-automation-sync` URL, `ref` blank (semantics for apps undocumented, #1 R11). Saving it makes a card at `https://da.live/apps#/{org}/{site}` [VERIFIED mechanism: https://www.aem.live/docs/ew/developing/apps-plugins; per #1 spec 2.5]. This is what AC5's "reachable from the EW Apps menu" means; the README gives the exact row and notes the trust prompt (#1 2.4).
- **No library plugin.** Not an editor-canvas feature; no `library` row. The extensions table `type` is `app`.
- **SDK usage**: `token`, `context` (prefill org and site), `actions.daFetch` (page picker). No `sendText`, no `closeLibrary` [VERIFIED SDK shape per #1 spec 2.1].
- **Which site is "the site"**: the iframe is served from the extension host site named in the app URL; the customer site whose pages are mapped is a form field prefilled from `context` (same reasoning as #7 Decision 30). The worker's CORS allowlist (the template's: `https://da.live` plus the host org/site's own origins, `localhost:3000` locally) concerns the host; the *site allowlist* (Decision 6) concerns the customer sites.
- **`ref=local`**: page at `http://localhost:3000` (#1 dev server), local worker at `http://localhost:8787` (`wrangler dev`, local D1; cron driven by the scheduled test endpoint or a documented manual trigger), content origin overridden to a local fake or real `aem.live` (anonymous), Marketo real sandbox or a local fake.
- **Branch ref**: page on `{branch}--{site}--{org}.aem.live` or `.preview.da.live` calls the **deployed** worker's `workers.dev` URL; mapping data therefore lives per worker deployment, not per branch (README says so). Which `Origin` the page sends is the template's R2 (#2) and is observed in manual step M5.
- **Reading published content**: the worker fetches `https://main--{site}--{org}.aem.live/{path}.plain.html`; CORS is not involved server-side. Site, org and path are validated against slug and path rules before building the URL (Decision 6, UA/SE tests).

## 3. External APIs and auth flows

| API | Use | Auth | Source / status |
|---|---|---|---|
| Marketo Identity `GET\|POST {identity}/oauth/token?grant_type=client_credentials&client_id&client_secret` -> `{access_token, token_type, expires_in: 3599, scope}` | obtain a one-hour token | client id and secret of a LaunchPoint custom service | [VERIFIED] https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/authentication ; Identity API reference https://developer.adobe.com/marketo-apis/api/identity/ (linked from that page; not read). POST body encoding: [ASSUMPTION], spike S3 |
| Marketo REST base `https://{munchkin}.mktorest.com/rest` | all asset calls; header `Authorization: Bearer <token>` | access token | [VERIFIED] header method; query parameter `access_token` removed (dates disagree between pages, Decision 17). Avoid double slashes in gateway URLs [VERIFIED mention: rest-api page links the "double slash deprecation" post, not read] |
| `GET /rest/asset/v1/programs.json` (`maxReturn` default 20 max 200, `offset`), `GET program/byName.json` | list targets (programs) | Read-Write Assets role | [VERIFIED] https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/programs |
| `GET /rest/asset/v1/snippets.json` (`status`, `maxReturn`), `GET snippet/{id}.json`, `GET snippet/{id}/content.json` | list/describe snippets; no query-by-name | same | [VERIFIED] snippets page; `offset` for snippets [ASSUMPTION] |
| `POST snippet/{id}/content.json` (`type=HTML`, `content`), `POST snippet/{id}/approveDraft.json`, `POST snippet/{id}/discardDraft.json` | write snippet body, approve | same | [VERIFIED] snippets page. Discard is not used. Approving an asset with no draft yields `709` [VERIFIED error table] |
| `GET folder/{id}/tokens.json?folderType=Program`, `POST folder/{id}/tokens.json` (`name`,`type`,`value`,`folderType`), delete variant (not used) | existing tokens; create-or-update token | same | [VERIFIED] https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/assets/tokens (types: date, number, rich text, score, sfdc campaign, text; name max 50; only "My Tokens" editable) |
| Marketo limits | pacing design | n/a | [VERIFIED] 50,000 calls/day (resets 12:00 AM CST), 100 calls/20 s per instance, 10 concurrent, 1 MB body, 8 KB URI: rest-api and error-codes pages |
| Marketo errors | classification | n/a | [VERIFIED] response-level `success:false` with `errors[{code,message}]` at HTTP 200; codes 601-616, 701-719 per error-codes page |
| Marketo permissions | setup docs | n/a | [VERIFIED] API-only user, role permission "Read-Write Assets", assets belong to workspaces: custom-services page |
| EDS live content `GET https://main--{site}--{org}.aem.live/{path}.plain.html` | extraction | anonymous (public sites) | [VERIFIED by curl] returns the `<main>` content: sections as `div`, blocks as `div.{name}` with row and cell `div`s, `Last-Modified`, CORS `*`, 404 + `x-error` when missing. Element/attribute allowlist: https://www.aem.live/developer/markup-reference ; `.plain.html` use confirmed in upstream `tools/block-editor/library.js` |
| AEM Admin API status `GET https://admin.hlx.page/status/{org}/{site}/{ref}/{path}` -> `live.lastModified`, `sourceLastModified`, `permissions` | fallback change signal | anonymous worked for a public site | [VERIFIED by curl] on `adobe/da-live`; rate limit header 10; authenticated sites need a key (#7 spec) |
| DA admin `GET https://admin.da.live/list/{org}/{site}/` | permission check; `403` when no read; `X-da-actions` header lists caller actions | `Authorization: Bearer <IMS>` | [VERIFIED in source] `adobe/da-admin` `src/routes/list.js`, `src/utils/daResp.js`; behaviour for unconfigured orgs [OPEN], spike S1 |
| Cloudflare cron triggers, D1, limits, wrangler `--test-scheduled` | platform | n/a | cited from the #7 spec (https://developers.cloudflare.com/workers/configuration/cron-triggers/ , https://developers.cloudflare.com/d1/platform/limits/ , https://developers.cloudflare.com/workers/platform/limits/); not re-read |
| Parser library (pure JS, runs in Node and workerd) | extraction | n/a | [ASSUMPTION] candidate `parse5`; selection and bundle size confirmed in spike S4 |

**Auth flows.**
1. *App to worker*: SDK token -> `Authorization: Bearer` -> template IMS verification -> site allowlist -> DA permission check (caller's token to `admin.da.live`, response actions cached for a short time per user and site, [ASSUMPTION] 60 s) -> handler.
2. *Worker to Marketo*: secrets from `env` -> Identity POST -> access token in isolate memory -> bearer on REST calls; `601`/`602` re-authenticate once. Redaction is registered for the dynamic access token (R-T2).
3. *Worker to published site*: anonymous GET, host fixed to `main--{site}--{org}.aem.live` built from validated slugs.
4. *Cron*: no user, no IMS token; uses only the stored mapping, anonymous content fetch, and the Marketo secrets.

## 4. Data contracts

Behaviour contracts; field names are the contract. All routes are under `/v1`, JSON, and require the IMS bearer token (template). Errors use the template contract (`{error:{code,message,requestId}}`, #2 Decision 9) plus the extension codes in R-T5.

**Vendor descriptor** (`GET /vendors`): `{ id, label, configured: boolean, targetKinds: [ { kind, label, slotModel: "named-slots"|"single", valueFormats: ["text","html","url","image"], slotName: { maxLength, pattern? }, supportsApproval: boolean } ] }`. Marketo: kinds `program` (named-slots, token names max 50, formats all) and `snippet` (single, formats `html`/`text`, approval true).

**Vendor module interface** (worker-side; names are the contract):

| Operation | Input | Output |
|---|---|---|
| `descriptor` | none | descriptor above plus required secret names |
| `connect` | env (secrets, non-secret config) | session handle (in memory only) or error `auth_failed` / `permission_denied` / `vendor_unavailable` |
| `listTargets` | session, `kind`, optional `query`, `cursor`, `limit` | `{ items: [{ id, name, kind, location?, status?, updatedAt? }], nextCursor? }` |
| `describeTarget` | session, `kind`, `id` | `{ id, name, kind, slots: [{ name, type? }] }` (existing slots) |
| `push` | session, target `{kind,id}`, slots `[{ name, format, value }]`, options `{ approve? }` | `{ results: [{ slot, outcome: "written"\|"failed", error?: { code, retryable } }], vendorState?: "draft"\|"approved"\|... }` |

Error taxonomy: `auth_failed`, `permission_denied`, `target_not_found`, `invalid_value`, `rate_limited`, `quota_exhausted`, `vendor_unavailable`, `unknown`; each with `retryable`. A module never throws raw vendor text across the boundary.

**Mapping document** (per site, stored versioned): `{ version, bindings: [ { id, label, enabled, vendor, target: { kind, id, name }, source: { path }, rules: [ { field: { block, index, key } | { block, index, row, cell } | { block, index }, format, slot } ], options: { approve } } ] }`. Constraints (validated on save): path begins with `/`, no traversal, length cap; `format` allowed by the descriptor for the kind; slot name within descriptor limits; `single` kinds have exactly one rule; no two rules anywhere in the site write the same (vendor, target, slot); caps (e.g. 200 bindings, 50 rules per binding, 256 KB document) [ASSUMPTION: numbers].

**Content tree** (`GET /sites/{org}/{site}/content?path=&partition=live|preview`): `{ path, lastModified, blocks: [ { name, index, variants: [..], layout: "key-value"|"grid", rows: [ { cells: [ { text, hasLink, hasImage } ] } ], fields: [ { address, label, preview } ] } ] }`. Text only; no HTML is returned for rendering.

**Routes**: `GET /vendors`; `POST /vendors/{id}/test` -> `{ ok:true }` or error; `GET /vendors/{id}/targets?kind&q&cursor`; `GET /vendors/{id}/targets/{kind}/{targetId}`; `GET /sites/{org}/{site}/content`; `GET|PUT /sites/{org}/{site}/mapping` (PUT requires `If-Match: <version>`; `409 mapping_conflict` otherwise); `POST /sites/{org}/{site}/preview` `{ binding }` -> `{ slots: [{ name, format, value, length, error? }] }` with no vendor write; `POST /sites/{org}/{site}/sync` `{ bindingIds?: [] }` -> `{ items: [...], remaining: n }`; `GET /sites/{org}/{site}/status`.

**Status** (`GET .../status`): `{ lastTickAt, vendors: [{ id, state }], bindings: [ { id, state, lastSyncedAt, lastAttemptAt, sourceLastModified, error?: { code, message }, slots: [ { name, state, lastSyncedAt?, error?: { code, message } } ] } ] }`. States: `in_sync`, `pending`, `partial`, `error`, `source_unavailable`, `disabled`, `never_synced`.

**Stored state** (D1, no credentials, no content bodies): mapping document + version + updated-by user id + updated-at; per binding: source `Last-Modified`, last checked, last changed seen, state; per slot: last pushed value hash, state, error code, attempts, next attempt, last synced; leases (site, holder, expiry); vendor usage per day (calls). Retention: current state only, no history in #27.

**Configuration** (non-secret vars): `ORG`/`SITE` of the extension host (template CORS), `SITE_ALLOWLIST` (comma list of `org/site`), `MARKETO_MUNCHKIN_ID`, `ALLOWED_IMS_CLIENT_IDS` (template), `VALUE_MAX_BYTES`, `TICK_CALL_BUDGET`, `DAILY_CALL_BUDGET`, local-only `ALLOW_LOCALHOST` and `CONTENT_ORIGIN_OVERRIDE`. **Secrets**: `MARKETO_CLIENT_ID`, `MARKETO_CLIENT_SECRET`.

## 5. Folder layout (proposed; fits #1 and #2)

```
apps/marketing-automation-sync/
├─ SPEC.md                              this file
├─ marketing-automation-sync.html       entry page: SDK script + app script
├─ marketing-automation-sync.js         bootstrap (awaits SDK, wires worker client)
├─ marketing-automation-sync-render.js  side-effect-free render + view logic (testable)   (naming is the implementer's call)
├─ marketing-automation-sync.css
├─ README.md                            setup, apps-sheet row, "reads no site config", ref=local, branch ref, adding a vendor, policy note
├─ test/unit/  test/e2e/                S2 and S1 tests
├─ worker/                              scaffold from shared/worker-template: wrangler config (cron, D1, secrets.required), entry, routes, content extraction, mapping, sync engine, store (+ migrations), vendor registry, .dev.vars.example, README, test/
└─ providers/marketo/                   README (vendor setup); worker/ = Marketo module (+ test/ with fake Marketo and the V1 suite run)
shared/worker-template/                 (#2) amended per R-T1..R-T5
```

The V1 contract suite and the fake vendor live in this extension's `worker/` (they are the interface's reference), not in `shared/`: other extensions do not share a vendor interface [OPEN: if #7's vendor-like pieces want it later, promote then].

## 6. Template amendment requirements (inputs to the owner decision on #2)

The #2 spec lists cron, D1/KV, in-body error classification and body-injected secrets as out of scope or unsupported. This ticket needs them; overlap with #7's R-T1..R-T4 is intentional (build once, whichever ticket lands first).

- **R-T1** scaffold support for a D1 binding, a cron trigger and a `scheduled` entry with the same request id, structured logging and redaction as `fetch`, and an injectable clock (same as #7 R-T3).
- **R-T2** `proxy` accepts a *dynamically supplied* secret value (the Marketo access token) and registers it for redaction for the request (same as #7 R-T2), and can inject a secret into a **form body field** (Marketo Identity), not only a header or query.
- **R-T3** `proxy` accepts a response classifier hook so a vendor module can tell the retry loop "this HTTP 200 is a retryable throttle" (Marketo `606`/`615`/`713`); or, fallback, the Marketo module owns its own retry loop above `proxy` with `retries: 0`.
- **R-T4** a handler can read the caller's bearer token and send it, explicitly and only to a fixed allowlisted host (`admin.da.live`) for the permission check, without weakening "the proxy never forwards the inbound Authorization header" for vendor calls. Fallback: per-site user allowlist (Decision 28).
- **R-T5** extension-registered error codes in the error contract (`site_not_allowed`, `mapping_conflict`, `invalid_mapping`, `vendor_not_configured`, `source_unavailable`, ...) with the same shape and no-echo rule.

If the owner prefers not to touch #2, each requirement has an in-extension fallback; the cost is duplicating security-sensitive plumbing, which #2 was created to avoid.

## 7. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Adobe outside-activity/IP policy**, and the worker holding a customer-grade Marketo credential under a personal Cloudflare account (carries over from #1 R1, #2 R1) | High for publishing | [OPEN] README note; owner decides the account before sharing |
| R2 | **No Marketo instance available.** Sandbox is a paid add-on [VERIFIED]; every Marketo behaviour here is from docs | High | Spike S3 as the first step needing credentials; fixtures hand-written until then; manual steps M1-M8 blocked without an instance |
| R3 | **No publish event.** Polling latency is up to the interval plus CDN propagation; load grows with mapped pages | Medium | 5-minute default, Sync now for impatience; fallback signals (Admin status) ready; relay events from #7 could replace polling later |
| R4 | **Conditional GET behaviour unverified** (no `ETag` observed; `Last-Modified` after publish; CDN cache `max-age=7200` with `must-revalidate`) | Medium | Hash-gating makes it correctness-neutral; spike S2 measures publish-to-visible latency; Admin status fallback |
| R5 | **Authorisation model**: DA permission probe semantics for unconfigured orgs; "write on site root" as a proxy for "may edit campaign mappings"; forwarding the token to `admin.da.live` | High | Spike S1; site allowlist as the hard outer gate; fallback user allowlist; owner decision (OQ 6) |
| R6 | **Marketo in-body errors defeat the template retry helper** | High | R-T3 or module-level loop; tests MK/SY with injected `606`/`615`/`713`/`607` |
| R7 | **Marketo quota/rate** shared with other integrations on the instance | High | Conservative pacing, daily budget, hash-gated writes, `quota_exhausted` pause; OQ 11 |
| R8 | **Token name rules, value limits, rich-text sanitising by Marketo, locked programs** undocumented in the pages read | Medium | Spike S3; validation in descriptor tightened from results; per-slot error mapping |
| R9 | **Block field addressing fragility** (authors reorder or rename) | Medium | Key addressing for key/value blocks; per-slot `source_field_missing`; no destructive action; OQ 9 |
| R10 | **Content XSS / injection**: page content to admin app (text only) and to campaigns (sanitised HTML) | Medium | Text-only rendering; sanitiser allowlist with tests EX/UI; a content value never executes in the app |
| R11 | **SSRF / open fetcher** via org/site/path/ids | Medium | Site allowlist; slug and path validators; fixed hosts; no redirects followed; tests SE |
| R12 | **Parser in workerd / bundle size / CPU on Free plan** | Low-Med | Spike S4; target Paid (OQ 4) |
| R13 | **D1 and cron under `wrangler dev` in CI** (#7 R17) | Low-Med | [ASSUMPTION] scheduled test endpoint; fall back to invoking the scheduled handler directly in unit tests and run D1 smoke locally |
| R14 | **Interface fit for #28-#32** (AJO fragments, Braze blocks, Klaviyo templates, HubSpot module fields, Iterable feeds) not researched | Medium | Each vendor spec reviews the interface; contract changes are cross-vendor; OQ 13 |
| R15 | **Template amendments (R-T1..R-T5) block this ticket** if #2 does not take them | Medium | Land amendments first (shared with #7) or use fallbacks |
| R16 | **`ref=local` plus local worker plus cron**: the poller is awkward to exercise by hand | Low | README documents the manual tick trigger; e2e drives Sync now |
| R17 | **Docs drift**: Marketo pages disagree on `access_token` removal date; EDS `.plain.html` shape is observed, not a documented contract | Low-Med | Header auth only; golden fixtures from real pages; canary spike in S2/S3 |

**Spikes (build-plan step 1; results recorded in the README and the fixtures):**
- **S1** DA permission probe: what `GET admin.da.live/list/{org}/{site}/` returns for (a) a user with write, (b) read-only, (c) no access, (d) an org with no permission config; is `X-da-actions` present and trustworthy? Decides Decision 28.
- **S2** Live content change signal: does `If-Modified-Since` give `304`; how long after publish does `Last-Modified` change; does Admin status agree. Decides the cadence and the fallback.
- **S3** Marketo reality check (needs an instance): Identity POST body; token name characters; rich-text value size and HTML stripping; empty value behaviour; snippet pagination and draft/approve semantics; effect of editing tokens in a locked or approved program; `606` window behaviour; whether Read-Write Assets alone suffices; record real responses as fixtures.
- **S4** Parser: pick the library, prove it bundles and runs in workerd, measure CPU on a large page.
- **S5** D1 and the scheduled hook under `wrangler dev` in CI.

## 8. Ordered build plan (sized to #27's acceptance criteria)

0. **Prerequisites (owner):** #1 and #2 landed; decisions on OQ 1, 2, 4, 5, 6; Cloudflare account (Paid for cron plus D1 at real load); a Marketo instance and an API-only user with Read-Write Assets, or an explicit decision to build against the fake only; Code Sync and site registration (#1 R3, R10).
1. **Spikes S1-S5**; commit their findings to fixtures and README notes. (AC1, AC2, AC7)
2. **Template amendments R-T1..R-T5** (or in-extension fallbacks). (AC7)
3. **Fixtures and fakes first**: golden `.plain.html` samples (key/value block, grid block, images, links, fragment), fake published site, fake DA admin, fake Marketo (stateful; scripted errors; call-rate model), fake vendor, in-memory store. (AC8)
4. **Extraction and format conversion**, test-first (EX). (AC1)
5. **Store and migrations**, with the R2 conformance suite (ST). (AC1, AC2)
6. **Vendor interface, registry, V1 contract suite**; fake vendor passes. (AC3)
7. **Marketo module**, test-first against the suite plus MK cases. (AC2, AC3, AC7)
8. **Mapping validation and versioning; authorisation; routes** (MP, AZ, SE). (AC1, AC7)
9. **Sync engine and tick** (SY): change detection, hash gating, pacing, retry, lease, partial failure, status. (AC2)
10. **App UI**, test-first (UI): page picker, content tree, rule editor, target picker, preview, save with conflict handling, status, Sync now. (AC1, AC2)
11. **Playwright e2e (S1)** with the real local worker and fakes (E2E). (AC1, AC2, AC6, AC7)
12. **Runtime smoke (W2)** (SM). (AC7)
13. **README, extensions-table row, apps-sheet row docs, `.hlxignore`/convention check extensions, CI jobs** (UR). (AC4, AC5, AC8)
14. **Deploy and manual verification in EW** M0-M9, record results and observed Origins in the README. (AC2, AC5, AC6, AC7)
15. **Hand-off note** for #28-#32: interface contract, contract-suite usage, vendor checklist.

---

# Testing Requirements

## 1. Worker tests via the HTTP boundary (seam W1; Node built-in runner)

Fixtures and fakes (all from the #2 test kit plus extension-local fakes): `makeEnv()` with production-like config (`ALLOW_LOCALHOST` false) and canary `MARKETO_CLIENT_SECRET` and `MARKETO_CLIENT_ID` values; `fakeIms` signed-token factory; `fakeSite` (published pages by path with `Last-Modified`, 304 support, 404s, scripted 5xx); `fakeDa` (permission responses with `X-da-actions`, 403, 5xx, records the Authorization header and host); `fakeMarketo` (stateful: programs, tokens per program, snippets with draft/approved state, Identity with 3600 s tokens, 100-per-20-seconds window, 10-concurrent limit, daily quota, scripted `601`/`602`/`603`/`606`/`607`/`613`/`615`/`709`/`713` responses, always HTTP 200 for response-level errors); fake clock, `sleep`, `random`; `fakeVendor`; in-memory store. Golden HTML under `test/fixtures/`.

### 1.1 Extraction and conversion (via content and preview routes)

| ID | Behaviour asserted |
|---|---|
| EX1 | Key/value block: fields addressed by normalised label (`Heading` and ` heading ` are the same key); reordering rows keeps the mapping valid |
| EX2 | Grid block: row and cell addressing; two blocks of the same name addressed by occurrence index; a block with variant classes keeps its name from the first class |
| EX3 | `text` format: markup stripped, whitespace collapsed, entities decoded |
| EX4 | `html` format: only allowed tags survive; `picture`/`source` collapse to one `img` with absolute `src`; relative `href`/`src`/`srcset` made absolute against the live origin; heading `id` and `loading` removed |
| EX5 | Hostile content: `<script>`, `onerror=`, `javascript:` URLs, `<style>`, `<form>`, unknown tags and `data:` URIs never appear in `html` output |
| EX6 | `url` format returns the first link's absolute href; `image` returns the first image's absolute src; a field with neither returns `empty_value` |
| EX7 | Field removed from the page -> `source_field_missing` naming the field; empty cell -> `empty_value`; neither produces a vendor write |
| EX8 | Value over `VALUE_MAX_BYTES` -> `value_too_large` for that slot only |
| EX9 | Page 404 on the fake site -> `source_unavailable`; 5xx retried by the proxy and then `source_unavailable` (not "empty") |
| EX10 | Fragment path (`/fragments/...`) behaves like a page; `partition=preview` reads the preview host and the sync never does |
| EX11 | Content tree response contains text only, never raw HTML |

### 1.2 Mapping, validation, versioning

| ID | Behaviour asserted |
|---|---|
| MP1 | Save then read returns the same mapping with a new version; unknown fields rejected |
| MP2 | Stale `If-Match` -> `409 mapping_conflict`, stored mapping unchanged; correct version succeeds |
| MP3 | Validation errors returned together with their locations: bad path (relative, `..`, double slash, too long), format not allowed for the target kind, slot name over the limit (Marketo 50), duplicate slot in a binding, same (vendor, target, slot) in two bindings, `single` kind with two rules, caps exceeded |
| MP4 | Two sites keep separate mappings; a site not on the allowlist can neither read nor write one |
| MP5 | Removing a rule or binding deletes its sync state and **never** calls the vendor |
| MP6 | Export (read) then import (write) round-trips; import validates like save |
| MP7 | Disabled binding is never fetched or pushed by a tick; Sync now on it reports `disabled` |

### 1.3 Authentication, authorisation, input safety (AC7)

| ID | Behaviour asserted |
|---|---|
| AZ1 | **Route enumeration:** the test builds the route table from the worker's own registry and, for every route and method, asserts a request with no `Authorization` returns `401` before any fake (site, DA, Marketo) receives a request; adding a route without registering it fails the test |
| AZ2 | Invalid, expired, wrong-key and wrong-client tokens -> `401` on a sample of routes (the full matrix is the template's UA tests; not repeated) |
| AZ3 | Caller with DA write on the site: all routes allowed. Read-only: `GET` routes allowed, `PUT`/`POST preview|sync` -> `403`. No read: `403` on all site routes |
| AZ4 | DA admin unreachable or 5xx -> `503`, no handler, no Marketo call (fail closed) |
| AZ5 | The caller's token reaches only the fake DA host; the fake site and fake Marketo never see an `Authorization` value derived from it; the token is absent from every response and log line |
| AZ6 | Permission on site A does not authorise site B in the path; site not in `SITE_ALLOWLIST` -> `403 site_not_allowed` and zero outbound requests |
| AZ7 | Permission results may be cached briefly per user and site; a cache never crosses users or sites |
| SE1 | Canary property test: a matrix of scenarios (success, every error code, Marketo echoing its secret or token in an error body, handler throw, missing-secret path, connection test) -> the canary client secret and canary access token never appear in any response body, header, log line, or in any row the store holds |
| SE2 | Marketo `scope` (API-user email) and raw Marketo error messages never appear in responses; responses carry fixed messages |
| SE3 | Input validation: org/site slugs with `.` `/` `@` `:` `%2f` uppercase or over-length, paths with traversal, encoded separators, backslashes, query or fragment smuggling -> `400` and zero outbound requests; Marketo ids must be integers |
| SE4 | Redirects from the published site or Marketo are not followed; the fake sees no second request |
| SE5 | Disallowed `Origin` with a valid token -> `403` on every route group (template behaviour verified on this worker's routes) |
| SE6 | `POST /vendors/marketo/test` with missing secrets -> `vendor_not_configured` (generic), no secret name or value leaked beyond the secret *name* in logs |
| SE7 | No HTTP route can trigger a scheduled tick; the only on-demand entry is the authenticated, authorised sync route |

### 1.4 Marketo module and the vendor contract suite (seam V1; run for Marketo and for the fake vendor)

| ID | Behaviour asserted |
|---|---|
| VC1 | `descriptor` is complete and valid (kinds, slot model, formats, name constraints, required secret names); the app can render a target picker and slot editor from it alone |
| VC2 | `connect` with good credentials yields a session; bad credentials -> `auth_failed`; missing permission -> `permission_denied`; unreachable -> `vendor_unavailable` (retryable) |
| VC3 | `listTargets` pages: stable order, `nextCursor` until exhausted, `query` filters by name, unknown kind rejected |
| VC4 | `describeTarget` returns existing slots; unknown target -> `target_not_found` |
| VC5 | `push` writes exactly the slots given, no others; repeat push of the same values is safe |
| VC6 | Per-slot failure isolation: one invalid slot fails with its own error, the other slots are written |
| VC7 | The module never throws raw vendor text; every failure maps to a taxonomy code with `retryable` |
| VC8 | The module exposes no delete or create-target operation |
| MK1 | Auth: Identity called with the credentials in the body, not the URL; subsequent REST calls carry `Authorization: Bearer`; no `access_token` query parameter anywhere |
| MK2 | Token reuse until a minute before `expires_in`; expiry or `601`/`602` -> one re-auth and one retry, then success; a second consecutive `601` -> `auth_failed` (no loop) |
| MK3 | Program token write: form-encoded `name`, `type`, `value`, `folderType=Program`; `text`/`url`/`image` become `text`, `html` becomes `rich text`; one call per token; name over 50 characters rejected before any call |
| MK4 | Snippet write: `type=HTML` content to the snippet; no approve call by default; with `approve` the approve call follows the write; approving when already approved (`709`) counts as success |
| MK5 | In-body errors at HTTP 200: `603` -> `permission_denied`; `610`/`710`/`711` -> `target_not_found`; `701`/`709` on a value -> `invalid_value`; none are treated as success because the HTTP status was 200 |
| MK6 | `606` and `615` retried with backoff under the injected clock until success; exhausted -> `rate_limited` (retryable); `713` retried; `607` -> `quota_exhausted`, no further calls that day |
| MK7 | Snippet listing without name search: a name filter pages through at most the page budget and reports truncation; programs use `maxReturn`/`offset` up to 200 |
| MK8 | Pacing: with 150 slots against the fake's 100-per-20-seconds window and 10-concurrent limit, the run never provokes `606`/`615`; concurrency never exceeds 2 |
| MK9 | URLs: the module only ever calls `{munchkin}.mktorest.com`; a malformed `MARKETO_MUNCHKIN_ID` fails configuration check before any call |
| MK10 | `describeTarget` for a program lists existing My Tokens; non-editable (inherited) tokens are not offered as writable |

### 1.5 Sync engine and tick (seam R1)

| ID | Behaviour asserted |
|---|---|
| SY1 | First sync of a binding writes all slots, records `lastSyncedAt`, state `in_sync` |
| SY2 | Tick with the fake site answering `304` -> no extraction, zero Marketo calls, `lastSyncedAt` unchanged or advanced as "confirmed in sync" per the contract |
| SY3 | Page republished with a new `Last-Modified` but identical mapped values -> zero Marketo writes |
| SY4 | Only the edited field changed -> exactly that slot is written (one token call), others untouched |
| SY5 | Edit then tick within the interval: `pending` becomes `in_sync` after the tick; the timing follows the fake clock and the configured 5-minute cadence |
| SY6 | **Sync now** forces all slots regardless of hash and returns per-item results; with more work than the inline budget it returns `remaining` and the next tick completes it |
| SY7 | Per-slot failure: `partial` state, failing slot shows `errorCode` and fixed message, others `in_sync`; the retryable slot retries at 5, 15, 60 minutes then stops; non-retryable waits for a source change or Sync now |
| SY8 | Source page 404 -> `source_unavailable`; **no vendor write**, existing vendor values untouched; page reappears -> resumes |
| SY9 | `quota_exhausted` pauses the vendor, items stay `pending`, no retry storm; resumes the next day |
| SY10 | Per-tick call budget: with more due bindings than the budget the remainder is deferred, fairly (no binding starves) |
| SY11 | Lease: two overlapping ticks (or a tick and Sync now) never push the same binding concurrently; an expired lease is taken over |
| SY12 | Retry safety: a token write interrupted and replayed leaves the vendor in the same state (idempotent) |
| SY13 | Disabled or removed bindings are skipped; nothing is ever deleted or blanked in the fake Marketo (assert the fake's delete/empty counters stay zero across the whole suite) |
| SY14 | A site with a bad Marketo credential surfaces `auth_failed` in the status for its bindings without crashing the tick for other sites |
| SY15 | Engine runs the same scenarios with the fake vendor registered and no Marketo knowledge (AC3: the engine is vendor-agnostic) |
| SY16 | Status route reflects `lastTickAt`, per-binding `lastSyncedAt`/`lastAttemptAt`/`sourceLastModified`, per-slot errors, and contains no content bodies |

### 1.6 Store contract (seam R2; in-memory and real local D1)

ST1 optimistic version check (conflict leaves data unchanged); ST2 lease acquire/renew/expire semantics; ST3 slot-state uniqueness and pruning on mapping change; ST4 per-day usage counter rollover; ST5 mapping size cap; ST6 the store never contains a canary secret (SE1 reused over a dump).

## 2. App unit tests (seam S2; `@web/test-runner`; injected `fetch`, SDK stub from #1)

| ID | Behaviour asserted |
|---|---|
| UI1 | Standalone (SDK never resolves): "not running inside Experience Workspace" state; all controls disabled |
| UI2 | Site field prefilled from `context`; a changed site clears page and mapping state |
| UI3 | Content tree renders every block and field as **text** (a field containing `<img src=x onerror=...>` creates no element); selecting a field adds a rule with the right address |
| UI4 | Target picker renders from the vendor descriptor alone (kinds, slot rules, approval option shown only when supported); pagination and search send the expected requests |
| UI5 | Rule editor shows validation errors from the worker beside the right rule; save sends `If-Match` with the loaded version; a `409` shows "changed by someone else" and offers reload without losing local edits |
| UI6 | Preview shows exact values and format; errors per slot |
| UI7 | Status view shows last sync time (human-readable with the ISO value available), state, and per-slot errors with fixed messages; failed/partial are visually distinguishable and exposed to assistive tech as text |
| UI8 | Sync now sends the selected binding ids and shows progress and `remaining`; double-click does not send two requests |
| UI9 | Every worker call carries `Authorization: Bearer <sdk token>` to the configured worker origin; `?worker=https://evil.example` is ignored |
| UI10 | The token and any client secret never appear in the DOM or console output; the page never receives or holds a vendor secret (no route it calls returns one: contract asserted by SE1 in the worker tier) |
| UI11 | Worker failure / slow response -> plain bounded message, no stack trace |
| UI12 | Export downloads the mapping JSON; import validates via the worker before applying |

## 3. End-to-end (seam S1; Playwright, Chromium, hermetic)

The Playwright config starts the #1 static server on `:3000`, the real worker via `wrangler dev` on `:8787` (local env, local D1, `IMS_ORIGIN` at a fake key server), and Node fakes for the published site, DA admin and Marketo. The #1 SDK stub supplies a test-signed token. No network beyond localhost.

| ID | Behaviour asserted |
|---|---|
| E2E1 | Full path: open the app, choose a page from the fake site, map a heading and a link to two tokens of a fake Marketo program, preview, save, Sync now; the fake Marketo holds the two tokens with the right values (A1, A2) |
| E2E2 | Edit the fake page's heading, advance the worker's scheduled test hook, reload status: new last-synced time and the fake Marketo token updated; the other token untouched (A2) |
| E2E3 | Fake Marketo returns `603` for one token: status shows that slot's plain error and the other slot succeeded (A2) |
| E2E4 | Snippet binding: draft written, no approval by default; with the option, approved (A1, A3) |
| E2E5 | Request without a token to every worker route -> `401` visible to the browser (CORS headers present) (A7) |
| E2E6 | Page HTML, DOM text and all network responses contain neither the token nor the canary Marketo client secret/access token (A7) |
| E2E7 | Only expected hosts contacted from the browser: the static server, the worker, the SDK stub, (`admin.da.live` stubbed for the picker) |
| E2E8 | Two browser contexts: second save from a stale version gets the conflict message (A1) |

## 4. Runtime smoke (seam W2; Node test file driving `wrangler dev`)

SM1 the worker (with `shared/` imports, parser and D1 binding) bundles and starts; a bare request gets `401`. SM2 migrations apply to local D1; mapping save/read round-trips. SM3 the scheduled hook runs a tick against the fakes. SM4 Marketo module against the fake Marketo over real HTTP including a `606` retry with real timers (tiny delays). SM5 canary absent from all responses (SE1 over HTTP). SM6 records CPU and wall time for extraction of a large fixture page and for a 50-slot sync (informational, R12).

## 5. Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| UR1 | `apps/marketing-automation-sync/` has the entry page named after the folder, a README, tests, `worker/` (wrangler config, README, test, migrations) and `providers/marketo/` with its own tests |
| UR2 | The repo README extensions table has a row for `marketing-automation-sync` (type `app`, entry point, description) and the row resolves to a real folder and entry page |
| UR3 | The extension README documents the apps-sheet row (`apps` sheet fields) and states which site configuration it reads (none) |
| UR4 | Hygiene rules from #2 (no tracked `.dev.vars*`, no secret-looking `vars`, `secrets.required` names present in `.dev.vars.example`) pass for this worker; `MARKETO_*` secret names are not in `vars` |
| UR5 | A vendor folder under `providers/` must contain a module that passes the contract suite (a fixture test fails if a provider registers without a suite run) |
| UR6 | Lint (ESLint, Stylelint) and all test tiers run in CI on every push and PR (#1 workflow); this ticket adds `worker-unit`, `worker-smoke` and extends `e2e` (no secrets in CI) |

## 6. Manual verification inside real Experience Workspace (needs interactive Adobe login; cannot be automated)

Accounts and credentials needed: GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, #1); an Adobe IMS identity with write access to the DA org/site and permission to edit the site config; Chrome; a Cloudflare account with `wrangler login` (Paid plan for cron plus D1 at real load, OQ 4); **a Marketo Engage instance (a sandbox is a paid add-on [VERIFIED]; OQ 1)** with: an API-only user whose role has Read-Write Assets, a LaunchPoint custom service for it, the Munchkin id, a test program and a test snippet; a published test page with a key/value block and a grid block. Never paste the IMS token, client secret or an access token into chat, issue comments or logs.

- **M0 (prereq):** deploy; set secrets (`MARKETO_CLIENT_ID`, `MARKETO_CLIENT_SECRET`) with `wrangler secret put`; apply migrations; set the site allowlist and Munchkin id; `curl -i <worker>/v1/vendors` returns `401` (A7). Check `https://main--ew-extensions--jazhou-adobe.aem.live/` serves a pushed file (#1 M0).
- **M1 (`ref=local`, full path):** `npm start` (port 3000) and the worker dev script (port 8787) with local D1 and the real sandbox. Open `https://da.live/app/jazhou-adobe/ew-extensions/apps/marketing-automation-sync/marketing-automation-sync?ref=local`, accept the trust prompt (#1 2.4). Run vendor test (connected); pick the test page; map heading and CTA link to two tokens of the test program; preview; save; Sync now; verify in Marketo (Marketing Activities, program, My Tokens) both tokens exist with the right values (A1, A2, A6).
- **M2 (published edit, polled re-sync):** in the EW editor change the heading, publish; without touching the app wait up to the polling interval (use the local scheduled trigger in `ref=local`); status shows a new last-synced time and Marketo holds the new text; the unedited token's value is unchanged (A2). Record publish-to-sync latency in the README (R3, S2).
- **M3 (per-item errors):** remove Read-Write Assets from the API role or point a binding at a deleted program; Sync now shows the plain per-slot error and the rest of the page unaffected; restore and see recovery (A2, MK5).
- **M4 (snippet):** map a block to a test snippet; sync; Marketo shows a draft with the sanitised HTML; enable approve and sync; approved version updated; check an email using it picks up the approved version only (Decision 20) (A1, A3).
- **M5 (branch ref):** push branch `mas-spec` (simple name), wait for code sync, open the app URL with `?ref=mas-spec` against the deployed worker; repeat M1's save and sync; record the page's actual `Origin` (`aem.live` or `preview.da.live`) in the README (A6; #2 R2).
- **M6 (apps sheet and menu):** add the `apps` sheet row; the card appears at `https://da.live/apps#/jazhou-adobe/ew-extensions` and opens the app (A5).
- **M7 (security):** with `curl`: no token -> `401`; valid token from a user without write -> `403`; valid token with disallowed `Origin` -> `403`; site not in the allowlist -> `403`; search page source, Network responses and DevTools storage for the client secret and access token (none) (A7).
- **M8 (limits):** with the sandbox, sync a mapping of ~100 tokens; confirm no `606` in the worker logs, the API usage report (Admin > Web Services) shows the expected call count, and the daily budget guard stops at its configured value (R7).
- **M9 (rotation):** `wrangler secret put MARKETO_CLIENT_SECRET` with a rotated secret; the next sync succeeds with no code change (A7).

## 7. Acceptance-criteria traceability (ticket #27)

Labels: A1 to A8 are #27's eight acceptance criteria in the order the ticket lists them; "AC1" to "AC8" elsewhere in this spec (build plan, tests) mean the same criteria.

| # | Acceptance criterion (#27) | Automated proof | Manual / review verification |
|---|---|---|---|
| A1 | Admin maps EW page/fragment content (by block and field) to the vendor's content objects and saves the mapping per site | EX1-EX11 (addressing, formats, fragments), MP1-MP7 (save, version, validation, per-site isolation), VC3/VC4/MK7/MK10 (targets), UI3-UI6/UI12, E2E1, E2E4, E2E8 | **M1** (map and save), **M4** (snippet) |
| A2 | Content pushes on demand, and the worker re-syncs mapped pages whose published version changed (polled); the app shows last sync time and per-item errors | SY1-SY16 (on-demand, change detection, hash gating, retry, partial failure, status), MK2-MK6, MK8, EX7/EX9, UI7/UI8, E2E1-E2E3, SM3 | **M1** (Sync now), **M2** (publish then polled re-sync, latency recorded), **M3** (per-item errors), **M8** (limits) |
| A3 | Vendor interface (auth, list targets, push mapped content) is defined so later vendors only add a module | VC1-VC8 (contract suite run on Marketo and the fake vendor), SY15 (engine with fake vendor only), UI4 (UI driven by the descriptor), UR5 | Review: section 4 interface table and README "adding a vendor" checklist; a reviewer follows it once with a scratch vendor folder; **M4** (snippet kind through the same interface) |
| A4 | All code in its own self-contained folder (per the scaffold convention), with a README covering setup, the EW config-sheet row that enables it, and any site config it reads | UR1, UR3 (folder completeness; README documents the apps row and the "reads no site config" statement), UR4 | Review: README walk-through on a scratch checkout from clean clone to local run; confirm the documented `apps` sheet row works (**M6**); the one allowed exception, importing `shared/worker-template`, is the #2 decision |
| A5 | Listed in the repo README extensions table and reachable from the EW Apps menu | UR2 (table row resolves to a real folder and entry page) | **M6** (card at `https://da.live/apps#/{org}/{site}` opens the app); review of the README row |
| A6 | Works in EW with `ref=local` and with a branch ref | UI9 and E2E1-E2E8 (page at `localhost:3000` against a local worker); SM1-SM5; origin handling covered by the template's UC tests | **M1** (`ref=local`), **M5** (branch ref against the deployed worker; observed `Origin` recorded) |
| A7 | Vendor credentials live only in this extension's worker (from the shared template); the browser never receives them; unauthenticated calls are rejected | AZ1 (every route 401 without a token, enumerated from the registry), AZ2-AZ7, SE1-SE7 (canary secret/token never in any response, log or stored row; no token to Marketo; SSRF), UI10, E2E5, E2E6, ST6, UR4, SM1, SM5 | **M0** (`curl` 401), **M7** (security checks incl. page-source and storage search), **M9** (rotation); review that Marketo secrets appear only in worker config |
| A8 | Core logic covered by unit tests; lint and CI green | all unit tiers (EX, MP, AZ, SE, VC, MK, SY, ST, UI); CI jobs `lint`, `unit`, `worker-unit`, `worker-smoke`, `e2e` (UR6) | Review: CI green on a PR; deliberately break a rule on a scratch branch (for example drop auth from one route, or let `html` keep `<script>`) and see AZ1 / EX5 fail |

Every acceptance criterion on #27 maps to at least one automated test or a numbered manual verification step above.

## 8. Open questions for the owner

1. **Marketo access (R2).** Which Marketo instance can be used for build verification? A sandbox is a paid add-on [VERIFIED]; does Adobe provide an internal instance, or should the build proceed against the fake only with M1-M9 deferred? Who creates the API-only user and service?
2. **Tenancy.** Single-tenant secrets (one Marketo instance per worker deployment; this spec) or per-site connections entered in the app and stored encrypted in D1 (as #7 does for Admin API keys)? The latter makes the worker usable by other orgs but adds a key-encryption secret and a credential-management UI.
3. **Snippet approval default.** Draft-only unless the binding opts in (this spec), or auto-approve? Auto-approve changes live emails/landing pages that use the snippet.
4. **Cloudflare plan and account (R1).** Paid plan required for cron plus D1 at real load [ASSUMPTION]; personal account or an Adobe-provided one? Same question as #2 Q1 and #7.
5. **Template amendments (R-T1..R-T5).** Extend #2 (preferred; shared with #7) or build fallbacks inside this extension? Which ticket lands first?
6. **Authorisation model.** Accept "site allowlist + DA write permission checked with the caller's token sent to `admin.da.live`" (spikes S1 and R-T4), or a per-site user allowlist? Is "write on the site root" the right permission for editing campaign mappings?
7. **Absolute URL origin.** Use the `aem.live` live origin for URLs inside synced HTML and image/link values (this spec), or a per-site production domain setting? Email assets typically need the production domain.
8. **Polling interval.** Is 5 minutes (one cron for all sites) acceptable for "re-syncs mapped pages whose published version changed"? A faster or per-site interval costs more quota and subrequests.
9. **Addressing.** Is block + occurrence + key/cell the right way to name fields for your real campaign pages? Do authors use key/value blocks (assumed) or free-form default content? Should page metadata and default-content headings be sources in a follow-up?
10. **Empty and missing values.** Treat as per-slot errors without writing (this spec), or allow pushing an empty value on request?
11. **Marketo budget.** Default share of the instance quota this worker may use (10,000 of 50,000 per day; 5 calls per second) [ASSUMPTION]; confirm or give the real constraint for your instance.
12. **Overwrite policy.** One-way, last write wins, no drift detection or conflict warning when someone edits a token in Marketo: acceptable for #27?
13. **Interface fit for #28-#32.** The interface assumes "target with named or single slots, push values, optional approval". Please confirm that is a fair model for AJO content fragments, Braze content blocks, Klaviyo templates, HubSpot module fields and Iterable feeds, or give a first-priority vendor to review against now (AJO is the Adobe-fit favourite in the scoring note).
14. **Protected sites and branches.** Public live content on `main` only, no EW site authentication, no non-main refs: acceptable for #27?
15. **Ref semantics.** The branch-ref test uses the deployed worker, so data is shared across refs. Is that acceptable, or should each ref get its own database for safety?
16. **Policy item (R1).** Carry-over: confirm the Adobe outside-activity/IP position before a worker holding a Marketo credential is run under a personal account or shared.
