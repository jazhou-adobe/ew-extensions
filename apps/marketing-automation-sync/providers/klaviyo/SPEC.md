# Spec: Marketing Automation Sync: Klaviyo (vendor provider: email templates and universal content)

Ticket: jazhou-adobe/ew-extensions#30 (this spec: #68). Blocked by #27 (mapping shell + first vendor; its spec is `apps/marketing-automation-sync/SPEC.md`, task #65), which is itself blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`, task #40). Sibling vendor follow-ups: #28 (Adobe Journey Optimizer), #29 (Braze), #31 (HubSpot), #32 (Iterable).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1, #2 and #27 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Klaviyo/Cloudflare.

Vocabulary follows #1, #2 and #27 and is not redefined: *extension*, *worker*, *provider*, *IMS token*, *source page*, *field*, *target*, *slot*, *binding*, *mapping*, *sync*, *re-sync*. Klaviyo terms used here:

- **Template** = a Klaviyo email template (`/api/templates`). Only `CODE` (custom HTML) and `USER_DRAGGABLE` (hybrid) templates are in scope: their HTML is a string the worker can edit. `SYSTEM_DRAGGABLE` (native drag-and-drop, structured `definition`) and `SIMPLE` are out of scope.
- **Universal content block** (UC block) = a reusable block (`/api/template-universal-content`) that is embedded in many templates; saving a change "will propagate to all email templates using that block" [VERIFIED: https://developers.klaviyo.com/en/reference/universal_content_api_overview]. Only block types `html` and `text` are in scope.
- **Slot marker** = an HTML attribute `data-ew-slot="<name>"` that the Klaviyo template author places on an element of a template; it turns that element's contents (or one attribute) into a named slot this provider can write. A UC block needs no markers: its body is its single slot.
- **Private API key** = Klaviyo's server-side credential (`pk_...`), sent as `Authorization: Klaviyo-API-Key <key>` [VERIFIED: https://developers.klaviyo.com/en/docs/authenticate_].
- **Revision** = Klaviyo's date-based API version, sent in the `revision` request header [VERIFIED: https://developers.klaviyo.com/en/docs/api_versioning_and_deprecation_policy].

Primary sources read (all 2026-11-16): Klaviyo developer docs: [API overview](https://developers.klaviyo.com/en/reference/api_overview), [Authenticate API requests](https://developers.klaviyo.com/en/docs/authenticate_), [Rate limits, status codes, and errors](https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling), [API versioning and deprecation policy](https://developers.klaviyo.com/en/docs/api_versioning_and_deprecation_policy), [Changelog](https://developers.klaviyo.com/en/docs/changelog_), [Templates API overview](https://developers.klaviyo.com/en/reference/templates_api_overview), [Universal Content API overview](https://developers.klaviyo.com/en/reference/universal_content_api_overview), reference pages [Get Templates](https://developers.klaviyo.com/en/reference/get_templates), [Create Template](https://developers.klaviyo.com/en/reference/create_template), [Update Template](https://developers.klaviyo.com/en/reference/update_template), [Get All Universal Content](https://developers.klaviyo.com/en/reference/get_all_universal_content), [Get Universal Content](https://developers.klaviyo.com/en/reference/get_universal_content), [Update Universal Content](https://developers.klaviyo.com/en/reference/update_universal_content), [Assign Template to Campaign Message](https://developers.klaviyo.com/en/reference/assign_template_to_campaign_message), [Set up OAuth](https://developers.klaviyo.com/en/docs/set_up_oauth), [Create a test account](https://developers.klaviyo.com/en/docs/create_a_test_account), [Monitor API usage](https://developers.klaviyo.com/en/docs/monitor-api-usage), [Django message design](https://developers.klaviyo.com/en/docs/django_message_design); the Contentful announcement cited by #30 ([blog](https://www.contentful.com/blog/new-apps-integrations-marketplace/)); the EW developer doc cited by #30 ([apps and plugins](https://www.aem.live/docs/ew/developing/apps-plugins)); parse5 source ([token.ts](https://github.com/inikulin/parse5/blob/master/packages/parse5/lib/common/token.ts), [ParserOptions](https://parse5.js.org/interfaces/parse5.ParserOptions.html)). The OpenAPI specs (https://github.com/klaviyo/openapi) were read only through the reference pages above.

---

## Problem Statement

A team that runs its campaign content in Experience Workspace (EW) also sends email from Klaviyo. Today the same headline, body copy and call-to-action are written twice: once as an EW page or fragment, once inside Klaviyo, either in a reusable *universal content block* that many templates share, or inline in an HTML template. Every copy fix is repeated by hand and the two copies drift. Contentful already ships a Klaviyo app that maps individual entry fields to Klaviyo so that "any update in Contentful is immediately reflected in Klaviyo" [VERIFIED: https://www.contentful.com/blog/new-apps-integrations-marketplace/]; EW users have nothing comparable, and #27 built the vendor-neutral shell (mapper, storage, sync engine, polling, status view) that this ticket plugs Klaviyo into.

Klaviyo differs from the Marketo module in #27 in ways that change the design:

1. **No named-variable store.** Marketo has program tokens; Klaviyo has nothing equivalent. The Templates API treats a template as one HTML string (`html`) and a UC block as one `definition` object [VERIFIED: templates and universal-content overview pages above]. "Map this EW field to that slot" therefore needs a convention for what a slot *is* inside Klaviyo content.
2. **Update means replace.** Updating a UC block fully replaces its `definition` ("if you only need to update the content, you must include the `content` as well as existing `styles` and `display_options`. Otherwise, the data for those fields will be cleared") [VERIFIED: universal content overview]. A naive write would wipe a block's styling. Updating a template means writing the whole `html`.
3. **A UC write is live immediately.** There is no draft or approval step; "Updating a universal content block ... will visually update all templates using the universal content", and Klaviyo itself says "User confirmation is strongly recommended before updating existing universal content" [VERIFIED: universal content overview]. The Marketo module's draft-only default (#27 Decision 20) has no Klaviyo counterpart for blocks. A template edit is the safe contrast: assigning a template to a campaign message "creates a non-reusable version of the template" (a clone), so editing the reusable template does not alter messages already built from it [VERIFIED: https://developers.klaviyo.com/en/reference/assign_template_to_campaign_message].
4. **Content is not inert.** Klaviyo renders HTML with a Django-style template engine: `{{ first_name }}`, `{% if %}`, `{% unsubscribe %}` and web-feed loops are evaluated at send time [VERIFIED: django_message_design and universal-content overview pages above]. A page value that happens to contain `{{ person.email }}` would be evaluated, not displayed.
5. **Different limits and auth.** Rate limits are per account, per endpoint tier, with burst (1 s) and steady (1 min) windows and ordinary HTTP `429` responses; private-key integrations share one account-wide quota [VERIFIED: rate-limits page]. Auth is a static private key, not a token exchange. Lists are small-paged (templates: max 10 per page) and weakly filterable (UC names only by exact match) [VERIFIED: reference pages].

The maintainer needs Klaviyo added as a provider module so the shell, storage and sync engine of #27 stay untouched.

## Solution

Ship one provider, `klaviyo`, for the existing `marketing-automation-sync` extension: a worker-side vendor module (plus its tests, fake Klaviyo and README) registered in the extension worker's vendor list, with its secret declared in the worker config. No shell, UI, storage or engine code changes (#30 AC3): everything Klaviyo-specific is expressed through the #27 vendor descriptor and the five operations of the vendor interface.

What the admin sees, in the existing app: choose vendor `Klaviyo`; choose a target kind, **Universal content block** or **Email template (HTML slots)**; search and pick a target; map fields to its slots; preview exactly what will be written; save; Sync now; see last-synced time and per-slot errors; later, an author publishes an edit in EW and within the polling interval the Klaviyo content shows the new text.

Two target kinds, both added without shell changes:

- **Universal content block** (`single` slot model, formats `html` and `text`). The block's `definition.data.content` is the slot. The module reads the block, replaces only `content`, and writes back the full definition with `styles`, `properties` and `display_options` carried over unchanged. Because the effect is immediate and wide, the descriptor label states it ("updates go live immediately in every email that uses the block"), and the README recommends adding the binding disabled, syncing once by hand, then enabling it.
- **Email template** (`named-slots` model, formats `text`, `html`, `url`, `image`). The Klaviyo template author marks regions in the template HTML with `data-ew-slot="headline"`; an element with that attribute becomes a slot whose *contents* are replaced, and an element that also carries `data-ew-attr="href"` (or `src`, `alt`) becomes a slot for that *attribute*. The module reads the template, splices only the marked ranges (every other byte of the HTML is left exactly as Klaviyo returned it), and writes back `html` only. One read and one write per binding, however many slots it has.

Safety rules specific to Klaviyo, all enforced inside the module: values containing Klaviyo template syntax (`{{`, `{%`, `{#`) are rejected per slot instead of being written; `text` values are HTML-escaped (every Klaviyo target is an HTML context); one bad slot never blocks the others; the module can read and update but exposes no create or delete.

## User Stories

Admin (site or campaign admin who sets up the mapping), using the shell stories of #27 unchanged plus:

1. As an admin, I want to choose Klaviyo as the vendor in the same mapper I use for other vendors, so that I learn one tool.
2. As an admin, I want to search Klaviyo email templates by name, so that I can find the one my campaign uses without copying ids.
3. As an admin, I want to search universal content blocks by name, so that I can find the shared block I want to keep in sync.
4. As an admin, I want only targets this provider can actually write (HTML and hybrid templates; HTML and text blocks) to be offered, so that I never pick something that fails on first sync.
5. As an admin, I want to see the slots a template already declares, so that I reuse the exact names the template author put there.
6. As an admin, I want a slot that is missing from the template to show a plain error naming the slot, so that I know whether the mapping or the template is wrong.
7. As an admin, I want to map a block field to a template slot by name and choose how it is converted (text, HTML, link URL, image URL), so that headlines, body copy, buttons and images land in the right shape.
8. As an admin, I want a universal content block to be one slot (its body), so that mapping it is a single click.
9. As an admin, I want a clear warning in the target picker that a universal content block is live in every email that uses it, so that I do not break a running campaign by accident.
10. As an admin, I want to save a universal content binding disabled and enable it after a manual first sync, so that the first real write is my decision.
11. As an admin, I want the preview to show the exact value that would be written (escaped text, sanitised HTML, URL), so that I can trust the first sync.
12. As an admin, I want to know whether my Klaviyo connection works and which permission is missing, so that I can fix the API key without reading logs.
13. As an admin, I want the README to tell me exactly which API key scopes to create and where to store the key, so that setup needs no guesswork.
14. As an admin, I want values that contain Klaviyo syntax such as `{{ first_name }}` to be reported as an error on that slot, so that page copy never accidentally personalises or breaks an email.

Campaign author (edits and publishes in EW):

15. As an author, I want my published headline and body edits to reach the Klaviyo template or block without any manual step, so that I do not edit email copy twice.
16. As an author, I want to see when each binding last synced and which slot failed and why, so that I know whether the email shows my latest copy.
17. As an author, I want an unpublished or deleted page to leave Klaviyo content untouched, so that a mistake does not blank a live email.
18. As an author, I want Sync now to push right after publishing, so that I do not wait for the next poll.
19. As an author, I want an email template's design, tracking tags, unsubscribe tag and Klaviyo logic to survive a sync byte for byte, so that automated copy updates never break layout or compliance.

Klaviyo template author / marketer:

20. As a Klaviyo template author, I want a documented, tiny marker convention (`data-ew-slot`), so that I can make a template syncable without developer help.
21. As a Klaviyo template author, I want the same slot name usable in several places in a template (for example subject-like text in a preheader and in the body), so that one EW field fills all of them.
22. As a Klaviyo template author, I want the sync to refuse to touch drag-and-drop templates, so that I never find a structured template overwritten with HTML.
23. As a marketer, I want a template edit made by sync not to alter emails already built from that template, so that automated updates only affect future sends.

Maintainer / operator:

24. As the maintainer, I want the Klaviyo private key only in the worker's secret store, so that no page, response, log or database row can leak it.
25. As the maintainer, I want the key scoped to `templates:read` and `templates:write` only, so that a leak cannot touch profiles, campaigns or lists.
26. As the maintainer, I want every worker route that serves Klaviyo (vendor test, targets, describe, sync) to reject unauthenticated callers, so that nobody can spend the account's API quota.
27. As the maintainer, I want the module to stay well under Klaviyo's account-wide rate limit and to back off on `429` and `Retry-After`, so that this integration cannot starve other integrations on the same account.
28. As the maintainer, I want the Klaviyo API revision pinned in one place and an unmistakable log line when Klaviyo reports it retired, so that a yearly upgrade is routine and a silent break is impossible.
29. As the maintainer, I want one failed slot not to block the others and one failed target not to block other bindings, so that a single bad template does not stop a campaign.
30. As the maintainer, I want no delete and no create anywhere in the module, so that automation can never destroy Klaviyo assets.
31. As the maintainer, I want rotating the key to be: create a new key in Klaviyo, `wrangler secret put`, delete the old key, with no code change, so that a leaked key is a five-minute fix.
32. As the maintainer, I want adding Klaviyo to require only a registry entry, a secret declaration and the module itself, so that the shell stays vendor-neutral and #28 to #32 are not disturbed.
33. As the maintainer, I want the README to document the key, the scopes, the variables, the marker convention and the "reads no site configuration" statement, so that a new person can enable Klaviyo alone.

Security reviewer:

34. As a security reviewer, I want proof that a canary Klaviyo key never appears in any response, header, log line or stored row, even when Klaviyo echoes it back in an error body.
35. As a security reviewer, I want proof that user-supplied ids, cursors and search text cannot alter the host, path or query structure of a Klaviyo call.
36. As a security reviewer, I want proof that page content cannot inject Klaviyo template logic or script into an email.
37. As a security reviewer, I want proof that the caller's IMS token is never sent to Klaviyo.

Vendor developer (#28 to #32):

38. As a vendor developer, I want the Klaviyo module to pass the shared contract suite unchanged, so that it is a second worked example of the interface.
39. As a vendor developer, I want a written assessment of where the interface fit Klaviyo and where it strained, so that later vendors and the shell owner can decide on amendments with evidence.

## Implementation Decisions

(No file paths or code. Layout and contract shapes are in the Build Analysis. The shell's decisions and the #2 worker contract are reused, not restated; "Decision N" below means a #27 decision unless noted.)

**Scope and placement**

1. **A provider, not a rewrite.** The module implements the #27 vendor interface (descriptor, `connect`, `listTargets`, `describeTarget`, `push`, normalised errors) exactly as defined there. The committed baseline requires **zero changes to the shell**; shell-side improvements that Klaviyo would benefit from are listed as optional amendment proposals (Build Analysis section 6) with a working fallback each. Klaviyo lives in `providers/klaviyo/` (module under `providers/klaviyo/worker/`, #2 Decision 3), is added to the vendor registry list, and its secret is added to the worker's `secrets.required` and `.dev.vars.example`.
2. **Direction and scope.** EW to Klaviyo only; existing targets only (no create, no delete, Decision 5 of #27 inherited); two kinds: `universal-content` (block types `html`, `text`) and `template` (`CODE` and `USER_DRAGGABLE`). Button, image, section and the other UC block types, `SYSTEM_DRAGGABLE` templates, web feeds, campaigns, flows, profiles and lists are out of scope.
3. **No EW site configuration is read** (inherited from #27 Decision 3). Provider configuration is non-secret worker variables only: the optional `KLAVIYO_REVISION` and `KLAVIYO_CALLS_PER_MINUTE`. The README states this, which answers #30's "any site config keys" requirement: there are none.
4. **Single tenant.** One Klaviyo account per worker deployment, one private key (inherited from #27 Open Question 2).

**Auth, revision, credentials**

5. **Private API key, not OAuth.** The key is the Cloudflare secret `KLAVIYO_PRIVATE_API_KEY`, injected by the template's `proxy` as `Authorization: Klaviyo-API-Key <key>` and registered for redaction. OAuth is "recommended" for tech partners and is required to be listed in Klaviyo's App Marketplace, and it gives a separate rate-limit quota per installed app [VERIFIED: authenticate and rate-limit pages]; neither is a goal of this ticket, and OAuth needs a redirect/consent flow and per-customer token storage that the single-tenant design (Decision 4) avoids [ASSUMPTION on cost]. Keys cannot be edited or have scopes added after creation, only deleted and recreated [VERIFIED: authenticate page], which defines the rotation procedure.
6. **Least-privilege key.** README instructs a custom-scope key with `templates:read` and `templates:write` only [VERIFIED scopes: reference pages and authenticate page scope table]. Keys are created by Owner, Admin or Manager roles [VERIFIED]. A key from the wrong account or an invalid key fails with `400` per the authenticate page, with `401` per the status-code table [VERIFIED discrepancy within Klaviyo docs; both are treated as `auth_failed` on the connection probe, Decision 21].
7. **Revision pinned to the latest stable, `2026-10-15`** (the newest GA revision in the changelog; Klaviyo recommends the latest stable for net-new integrations [VERIFIED: versioning policy, changelog]). The module sends `revision` on every call, `accept` and `content-type` as `application/vnd.api+json` (the JSON:API media type used by the reference pages [VERIFIED]). The pin is one constant, overridable only by the non-secret `KLAVIYO_REVISION` variable for local and test environments (to rehearse the next revision). Revisions are stable for a year, deprecated for a year, then retired; a retired revision "falls forward" silently to the next-oldest revision unless the client sends the opt-out header, and calls to endpoints removed since that revision get `410` [VERIFIED: versioning policy]. The module does **not** send the opt-out header (silent fall-forward is tolerated because the read-modify-write design carries unknown members through untouched [ASSUMPTION]; choice is Open Question 6) and logs a retirement warning on any `410`.
8. **Fixed host.** `https://a.klaviyo.com` [VERIFIED: servers entry of every reference page]; no host or path segment comes from a caller. Local and test environments may override the base URL to loopback only. Calls use `proxy` with `allowedHosts` set to that one host.
9. **No Klaviyo SDK.** Plain `fetch` through the template `proxy` keeps secret injection, retry, host allowlist and redaction in the shared, tested code (#2), and avoids a Node-oriented dependency in the worker bundle [ASSUMPTION; Klaviyo publishes SDKs, https://developers.klaviyo.com/en/docs/sdk_overview, not evaluated for workerd].

**Targets and slots**

10. **Universal content kind.** `slotModel: single`, formats `html` and `text`, `supportsApproval: false`, slot name fixed (`content`). Supported when `definition.content_type = block` and `definition.type` is `html` or `text` (a text block holds "text or HTML" [VERIFIED: overview data model]). Any other type or content type is `target_not_found` with no write. Rationale for excluding `button`, `image`: they need several slots of different shapes or an image asset (`images:write`), which the one-kind-one-slot-model descriptor cannot express without a shell change (Out of Scope; Open Question 2).
11. **Template kind.** `slotModel: named-slots`, formats `text`, `html`, `url`, `image`, `supportsApproval: false`, slot names `[a-z][a-z0-9_-]{0,49}` (the 50-character cap matches Marketo's token limit so shell validation is uniform). Only `CODE` and `USER_DRAGGABLE` templates are offered and writable; `SYSTEM_DRAGGABLE` and `SIMPLE` yield `target_not_found`.
12. **Slot marker convention (template).** An element carrying `data-ew-slot="<name>"` is a *content slot*: the text between its start and end tag is replaced. If the same element also carries `data-ew-attr="href"|"src"|"alt"` it is an *attribute slot*: only that attribute's value is replaced (added if absent). Rules: the same name may appear on several elements and all are written with the same value; a content slot must have an explicit end tag and must not contain another marker (otherwise the affected slots fail `invalid_value`, fixed message "slot markup unsupported"); a value format must fit the slot type (content: `text`, `html`; `href`: `url`; `src`: `image`; `alt`: `text`), otherwise that slot fails `invalid_value`. The module reports each slot's type in `describeTarget` so the UI can suggest names. Why attributes: Klaviyo, unlike Marketo, has no separate place for a call-to-action URL, so a URL or image value must land in an attribute of an element in the HTML. Why `data-` attributes and not comments: [ASSUMPTION] attributes are more likely to survive Klaviyo's HTML normalisation than comments; Klaviyo does re-format stored HTML (the documented create-template example returns minified CSS and re-indented markup [VERIFIED: templates overview]), and whether markers survive is spike K3.
13. **Byte-preserving splice.** The template is parsed with the same pure-JavaScript parser the shell chooses (#27 Decision 12; parse5 candidate) with source-location tracking enabled, which gives start and end offsets of start tags, end tags and attributes [VERIFIED: parse5 `sourceCodeLocationInfo` option and `ElementLocation.startTag/endTag/attrs` in source]. The module computes replacement ranges from offsets and edits the original string; it never re-serialises the document. Everything outside the marked ranges, including Django tags, comments, `{% unsubscribe %}` and hybrid-template `data-klaviyo-*` attributes, is therefore unchanged by construction. A binding with N slots on one template costs exactly one read and one write; a template's marked regions are applied together and written once.
14. **Universal content write is read-modify-write.** One read of the block (fields `name`, `definition`), replace `definition.data.content` only, one `PATCH` carrying the full definition and no `name`. This is required because `definition` replaces what is stored [VERIFIED]. The block's type must be unchanged ("a block's `type` can't be changed via `definition`" [VERIFIED]); the module never sends a different type. Round-trip validity of a read definition under `2026-10-15` (for example read-only members) is spike K4.
15. **Template write sends `html` only** (no `name`, `text`, `amp`, `definition`), which the Update Template schema allows ("html ... not allowed for SYSTEM_DRAGGABLE", `definition` "not allowed for CODE/USER_DRAGGABLE") [VERIFIED: update_template reference]. The plain-text part and AMP part are left as they are; the plain-text part can therefore go stale [OPEN K3: whether Klaviyo regenerates it].
16. **Last write wins; no lock.** Neither endpoint offers conditional requests or version checks in the pages read [ASSUMPTION; spike K7]. The read and the write happen back to back inside one push. A concurrent edit by a Klaviyo user inside that window can be lost; the README says Klaviyo content written by sync is overwritten by the next change in EW (same policy as #27's out-of-scope drift detection).
17. **Listing and search.** Templates: `GET /api/templates` with `page[size]` capped at 10 (the documented maximum), `fields[template]=name,editor_type,updated`, server-side name filter `contains(name,'<text>')` (supported), `sort=-updated`; `SYSTEM_DRAGGABLE`/`SIMPLE` removed client-side because `editor_type` is not a filterable field [VERIFIED: get_templates reference, allowed filters `id`, `name`, `created`, `updated` only]. Universal content: `GET /api/template-universal-content` with `page[size]` up to 100, `fields[template-universal-content]=name,definition.content_type,definition.type,updated`; name filter only supports `equals`, so a text query is applied in the worker after paging, case-insensitively; types other than `html`/`text` removed client-side [VERIFIED: get_all_universal_content reference]. A shell `listTargets` call may read up to 5 Klaviyo pages to fill `limit` and returns the next position as an opaque cursor; the cursor is the `page[cursor]` value taken from `links.next` (the module never follows a URL from a response) and is validated as base64url-like before reuse [VERIFIED pagination shape: API overview].
18. **Values are inserted into HTML, so the module escapes.** `text` is HTML-escaped (`&`, `<`, `>`, quotes) wherever it lands, content or attribute; `html` is inserted as given (the shell has already sanitised it, #27 Decision 9); `url` and `image` are attribute-escaped and must be `https:`, `http:` (and for `url` only, `mailto:` and `tel:`) absolute URLs; anything else, including `javascript:` and `data:`, is `invalid_value`. Double-escaping is avoided because the shell's `text` format is already plain text.
19. **Klaviyo template syntax guard.** Any value (every format) containing `{{`, `{%` or `{#` is rejected for that slot as `invalid_value` (fixed message "value contains Klaviyo template syntax") and not written. Klaviyo evaluates these constructs in templates and in UC HTML blocks [VERIFIED: django_message_design lists variables, tags, `{% if %}`, `{% for %}`; the universal-content overview shows `{{ review_article.title }}` and `{% if %}` inside an HTML block]. Rejecting is the safe baseline; an opt-in to allow deliberate personalisation (`{{ first_name }}`) would need a per-binding option the shell does not have (Open Question 5). Content already in the template or block outside the slots is untouched, so authors can keep personalisation in Klaviyo and only sync copy.
20. **Size.** The shell caps each extracted value (default 100 KB, #27 Decision 11). The module additionally refuses a result whose request body would exceed 4 MB as `invalid_value`, below Klaviyo's documented global payload limit of 5 MB (decompressed) [VERIFIED: rate-limits page]. Template and block content size limits are not documented in the pages read [OPEN, spike K3/K4].

**Connection, errors, pacing**

21. **`connect`** validates that the secret exists (else the shell's `vendor_not_configured`) and makes one cheap authenticated call, `GET /api/templates?page[size]=1&fields[template]=name`, which proves the key is valid and carries `templates:read`. Success is cached in isolate memory for 10 minutes so a tick does not probe per binding. The session handle holds only base URL, revision and a pacer; it never contains the key (the proxy injects it by secret name). A missing `templates:write` scope cannot be probed without writing; it surfaces as `permission_denied` on the first write [ASSUMPTION: no scope-introspection call; Open Question 12].
22. **Error classification is HTTP-based.** Unlike Marketo, Klaviyo uses real status codes [VERIFIED: status table] so the template's retry loop applies unchanged (no #27 R-T3 needed). Mapping: `400` -> `auth_failed` on the connection probe, otherwise `invalid_value` (body rejected); `401` -> `auth_failed`; `403` -> `permission_denied` (missing scope or plan limitation); `404` -> `target_not_found`; `409` -> `unknown`, retryable once [ASSUMPTION on cause]; `410` -> `unknown` and a retirement log line; `415` -> `unknown` (a bug in this module); `429` -> `rate_limited` (retryable); `5xx`, timeouts and network errors -> `vendor_unavailable` (retryable); a `2xx` whose body does not have the expected shape -> `unknown`. Klaviyo error text (`errors[].title/detail`) never crosses the boundary; the error `id` is logged for support [VERIFIED error shape: rate-limits page]. How `400` "invalid key" differs from `400` "invalid body" in `errors[].code` is spike K2.
23. **Retries.** The template `proxy` retries `429` and `5xx` with backoff, honours `Retry-After`, and treats `PATCH` as non-idempotent by default (#2 Decision 8). Both Klaviyo writes set absolute values, so the module passes the explicit "safe to retry" flag for them. Klaviyo states that a retry "should only be attempted after the current rate limit is lifted" via `Retry-After` and that immediate retries always get `429` [VERIFIED]. Per-call overrides raise the delay cap so a burst-window `Retry-After` of a few seconds is waited out inside the call; a `Retry-After` longer than the per-call wait cap is returned as `rate_limited` (retryable) and the sync engine's own backoff (5, 15, 60 minutes, #27 Decision 25) takes over.
24. **Pacing and quotas.** Documented limits: the template and UC read and write endpoints each state `75/s` burst and `750/m` steady per account (the reference pages; the general tier table lists "L" as 75/s and 700/m, so the endpoint pages are taken as authoritative and the difference is noted [VERIFIED discrepancy]); the account's quota is shared by every private-key integration; `429` carries `Retry-After`; non-`429` responses carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` [VERIFIED: rate-limits page, reference pages; the docs spell the first header with an en dash, so header names are matched case-insensitively and tolerantly]. The `SYSTEM_DRAGGABLE` endpoints use the smaller "S" tier (`3/s`, `60/m`) per the 2026-04-15 changelog; they are not used [VERIFIED]. The module limits itself to 2 concurrent calls, 5 calls per second, and `KLAVIYO_CALLS_PER_MINUTE` (default 300, i.e. 40% of the steady window [ASSUMPTION], Open Question 8), and pauses until `RateLimit-Reset` when `RateLimit-Remaining` falls below 10% of the limit. There is no daily quota on these endpoints [VERIFIED by absence; the only daily cap in the Templates area is the unused Template Preview Send, `100/day`], so the module never returns `quota_exhausted`.

**Platform and docs**

25. **Template amendments:** none required beyond what #27 already asks of #2 (cron and D1 from R-T1; R-T4 for the DA permission check). R-T2 (dynamic secret) and R-T3 (response classifier) are Marketo-only and not needed here; a static header secret with a custom scheme (`Klaviyo-API-Key`) must be expressible by `proxy`'s `auth` option [ASSUMPTION: `auth: { secret, header, scheme }` accepts a free-form scheme; verify against the implemented #2 helper, otherwise a one-line template extension].
26. **Tooling and docs per owner convention.** Same pins as #27 Decision 32. The provider README covers: Klaviyo account and key setup (scopes, key storage, rotation), the secret and variables, the marker convention with a copy-pasteable HTML example, the live-effect warning for universal content, the recommended first-sync workflow, the "reads no site configuration" statement, `ref=local` and branch-ref notes pointing to the extension README, and the Klaviyo revision policy.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only, through the interface the shell consumes: the exact HTTP requests a fake Klaviyo receives (method, path, headers, body, count, order), what the module returns, and what the shell's routes then say. Never assert on internal helper names, parser internals or call counts of internal functions. Properties asserted as negatives across every path (carried from #27, restated for Klaviyo): (1) the canary private key never appears in any response, header, log line or stored row; (2) no Klaviyo call happens before authentication and authorisation succeed; (3) nothing is deleted or created in Klaviyo and a block's styling, a template's untouched bytes are preserved; (4) an unchanged page causes zero Klaviyo calls.

**Proposed seams** (recorded instead of asked, per #68). No new seam is introduced: all five are #27 seams reused, which is the point of AC3.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| V1 (primary) | Vendor contract suite against the module's public interface | reused from #27 | descriptor, connect, list, describe, push, error-taxonomy conformance; Klaviyo behavioural tests (marker splice, read-modify-write, escaping, syntax guard, pacing) | **fake Klaviyo**: a stateful scripted `fetch` handler, the "per-vendor fake" that V1 requires |
| W1 | Worker HTTP boundary | reused from #2/#27 | route, auth and security tests with Klaviyo registered; secret hygiene | #2 test kit + the fake Klaviyo + #27 fakes (site, DA admin) |
| R1 | Worker tick + on-demand sync | reused from #27 | end-to-end sync scenarios through Klaviyo: first sync, republish re-sync, partial failure, `429` recovery | same fakes, fake clock |
| S1 / S2 | Entry page + SDK boundary; render/logic module | reused from #1/#27 | descriptor-driven UI rendering with the Klaviyo descriptor; Playwright path | #1 SDK stub; fake Klaviyo as a local Node server |
| S3 / W2 | Repo convention check; worker in workerd | reused | provider folder rules, secret hygiene, import-graph rule; smoke | temp-dir fixtures; `wrangler dev` with fake Klaviyo local server |

**Modules tested:** Klaviyo descriptor, connect, list/search and cursor handling, describe (marker discovery), template splice, UC read-modify-write, value escaping, syntax guard, error classification, retry and pacing behaviour, revision handling, canary and input safety, shell integration with Klaviyo registered, descriptor-driven UI fixtures, repo checks.

**Prior art:**
- This repo: the #27 test plan (vendor contract suite V1, Marketo module tests MK1-MK10 as the pattern for per-vendor behaviour tests, fakes in the `worker/` test kit), #2's test kit (canary, fake upstream, fake clock) and W1/W2, #1's S1-S3.
- Upstream `adobe-rnd/ew-extensions` has no Klaviyo reference: `gh search code klaviyo --repo adobe-rnd/ew-extensions` returned no hits on 2026-11-16; prior art there is only the dependency-injection pattern already cited by #27 (`fetchImpl`, `storage`, `now`).
- Klaviyo publishes OpenAPI specs (https://github.com/klaviyo/openapi) usable to validate the fake's request and response shapes; the fake should be checked against them [ASSUMPTION: schema validation of the fake is feasible with a standard OpenAPI validator; not evaluated].

## Out of Scope

- Anything in the shell (mapper, storage, engine, polling, status view): #27 owns it; this ticket only registers a provider.
- Creating or deleting templates, UC blocks, folders or any other Klaviyo asset; campaigns, flows, messages, lists, segments, profiles, events, catalogs, forms, coupons; sending or test-sending email (the Template Preview Send job is capped at 100 per day [VERIFIED: changelog] and unused).
- UC block types other than `html` and `text` (button, image, section, header, product, review, social, split, table, video, coupon, divider, spacer, drop shadow); web-feed-driven blocks; `SYSTEM_DRAGGABLE` and `SIMPLE` templates (their structured `definition` would need a different writer); AMP and plain-text template parts.
- Uploading images to Klaviyo (Images API, `images:write`): `image` values are absolute URLs on the EW live origin; whether email clients and Klaviyo tolerate externally hosted images is a deployment judgement (Open Question 11).
- OAuth, the Klaviyo App Marketplace listing, multi-account or per-site credentials (single tenant, #27 Open Question 2).
- Localisation: Klaviyo translations API; locale handling (a localised EW page is just another page).
- Opt-in personalisation syntax per binding (Open Question 5), draft or approval workflow in Klaviyo (none exists for these objects), drift detection when a Klaviyo user edits synced regions (last write wins).
- The Adobe outside-activity/IP policy decision (owned by #1 R1) and the question of which Cloudflare account holds a customer Klaviyo key (carried as Open Question 14).

## Further Notes

- **Cheaper than Marketo.** A Klaviyo push costs one read and one write per binding regardless of slot count; Marketo costs one call per token. Hash-gating makes steady state zero calls (#27). The read is not wasted: it is what makes the write safe (styles preserved; markup outside slots preserved).
- **HTML normalisation does not matter to change detection.** The engine hashes the values it pushed, not Klaviyo's stored HTML (#27 Decision 23), so Klaviyo re-formatting the stored HTML cannot cause push loops. It does matter to marker survival (spike K3).
- **Free test accounts exist.** "A new account you create for testing starts on the free plan"; a test account is an ordinary Klaviyo account linked to a production login [VERIFIED: https://developers.klaviyo.com/en/docs/create_a_test_account]. Unlike Marketo's paid sandbox add-on (#27), a Klaviyo test account needs no purchase. Whether the Templates and Universal Content APIs are available on the free plan is not stated in the pages read [OPEN, spike K1]. No Klaviyo account or key is available to the agent: every Klaviyo behaviour here comes from documentation and must be confirmed in spikes K1-K7; until then the fake's fixtures are hand-written from the docs [ASSUMPTION].
- **Documentation drift to watch.** The Klaviyo docs disagree with themselves on bad-key status (`400` vs `401`), spell a response header with an en dash, show UC examples under revisions `2024-10-15` and `2025-04-15` while the reference is `2026-10-15`, and introduced a breaking `display_options` shape change in `2026-10-15` [VERIFIED: changelog]; the read-modify-write design carries unknown members through untouched so it is robust to that change, but fixtures must be recorded under the pinned revision.
- **Template limit.** Creating or cloning templates fails at 1,000 templates [VERIFIED: create_template reference]; irrelevant here (no create) but explains why accounts with many templates are plausible and listing is paged and budgeted.
- **No Klaviyo prior art upstream** (see Testing Decisions). The Contentful Klaviyo app maps entry fields and locales and keeps Klaviyo in step with updates; this spec maps "entry field" to "block field", "entry update" to "page published" and chooses UC blocks and HTML template regions as the Klaviyo equivalents (the specific Contentful mapping targets inside Klaviyo are not described on the page read [VERIFIED by absence]).
- This `SPEC.md` is a planning artefact; keep or delete it when the provider is built, as decided for the hello-world and #27 specs [OPEN, low stakes].

---

# Build Analysis

## 1. Architecture and responsibilities

The extension architecture is #27's, unchanged. The provider adds one module to the worker and nothing to the browser app.

```
 EW app (static, public)  ──IMS bearer──►  Worker (Cloudflare, shared/worker-template core + #27 shell)
                                           │ fetch(): origin gate → IMS auth → site allowlist + DA permission → routes
                                           │ scheduled(): per site/binding → fetch live page → extract → hash → push
                                           │ vendor registry:  marketo   klaviyo (this ticket)   fake-vendor(test)
                                           │   klaviyo module:  descriptor · connect · listTargets · describeTarget · push
                                           │   secret: KLAVIYO_PRIVATE_API_KEY (injected by proxy by name)
                                           ▼
                           https://a.klaviyo.com/api/templates · /api/template-universal-content
                           headers: Authorization: Klaviyo-API-Key <key> · revision: 2026-10-15 · accept/content-type: application/vnd.api+json
```

| Concern | App (browser) | Worker | Klaviyo provider module |
|---|---|---|---|
| Klaviyo private key | never | secret store only | injected by name via `proxy`, never held in session |
| Mapping, polling, status, authorisation | all shell behaviour, no Klaviyo code | shell | none |
| Which kinds exist, slot rules, notices | renders from descriptor | serves descriptor | defines descriptor |
| Target search and slot discovery | renders lists | routes | `listTargets`, `describeTarget` |
| HTML escaping, syntax guard, marker splice, read-modify-write | none | none | all |
| Rate limits, `Retry-After`, revision | none | template retry loop | pacing, call overrides, classification |

## 2. EW integration points

Identical to #27 section 2: the same fullscreen app row in the `apps` sheet (`https://da.live/config#/{org}/{site}/`), no library plugin, SDK `token`/`context`/`actions.daFetch` only, no site configuration read. Klaviyo adds **no** new config-sheet row, **no** new SDK action, **no** new site-config key. What an admin does in EW is unchanged except for choosing the vendor. `ref=local` uses the local worker (`http://localhost:8787`) with the fake Klaviyo or a real Klaviyo test account; a branch ref calls the deployed worker (#27 section 2; the data is shared across refs, #27 Open Question 15). Klaviyo marker authoring happens in Klaviyo's HTML editor, not in EW.

## 3. External APIs and auth flows

| API | Use | Auth | Source / status |
|---|---|---|---|
| `GET /api/templates` (`page[size]` 1-10, `page[cursor]`, `filter` on `id`,`name` (`equals`,`contains`),`created`,`updated`, `sort`, `fields[template]`, `additional-fields[template]`) | list/search templates; connection probe | private key, scope `templates:read`; 75/s burst, 750/m steady | [VERIFIED] https://developers.klaviyo.com/en/reference/get_templates |
| `GET /api/templates/{id}` (`fields[template]`) | read `html` and `editor_type` before splice | same | [VERIFIED endpoint exists and returns `html`, `editor_type`: https://developers.klaviyo.com/en/reference/templates_api_overview ("Get Template"); its reference page was not read separately] |
| `PATCH /api/templates/{id}` (JSON:API body `data.type=template`, `data.id`, `attributes.html`) | write spliced HTML | scope `templates:write`; 75/s, 750/m | [VERIFIED] https://developers.klaviyo.com/en/reference/update_template ; `html` not allowed for `SYSTEM_DRAGGABLE`; `name`/`text`/`amp`/`definition` optional |
| `GET /api/template-universal-content` (`page[size]` 1-100 default 20, `page[cursor]`, `filter` on `id`/`name` (`equals`), `created`/`updated` ranges, `definition.content_type`, `definition.type` (`equals`), `sort`, `fields[template-universal-content]`) | list UC blocks | `templates:read`; 75/s, 750/m | [VERIFIED] https://developers.klaviyo.com/en/reference/get_all_universal_content |
| `GET /api/template-universal-content/{id}` | read the full definition | same | [VERIFIED] https://developers.klaviyo.com/en/reference/get_universal_content (rate limits and scope); response shape [VERIFIED] from the overview page examples |
| `PATCH /api/template-universal-content/{id}` (`attributes.definition` replaces the whole definition; omit it to rename only; type cannot change) | write block content | `templates:write`; 75/s, 750/m | [VERIFIED] https://developers.klaviyo.com/en/reference/update_universal_content and overview page; "name optional on PATCH" [ASSUMPTION, spike K4] |
| Auth header `Authorization: Klaviyo-API-Key <pk_...>`; scopes `templates:read`/`templates:write`; keys uneditable, created by Owner/Admin/Manager | credentials | private key | [VERIFIED] https://developers.klaviyo.com/en/docs/authenticate_ |
| `revision` header, stability one year, deprecated one year, fall-forward, opt-out header `X-Klaviyo-Revision-Fall-Forward-Opt-Out:1` | versioning | n/a | [VERIFIED] https://developers.klaviyo.com/en/docs/api_versioning_and_deprecation_policy ; latest GA `2026-10-15` [VERIFIED] https://developers.klaviyo.com/en/docs/changelog_ |
| Rate limits (burst 1 s window, steady 1 min window; tiers; `Retry-After`; `RateLimit-*` headers; 5 MB payload) | pacing | n/a | [VERIFIED] https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling |
| Status codes 200/201/202/204/400/401/403/404/405/409/410/415/429/500/503 and the `errors[]` shape | classification | n/a | [VERIFIED] same page |
| `POST /oauth/token` at `a.klaviyo.com` (not used) | OAuth alternative | OAuth app | [VERIFIED] https://developers.klaviyo.com/en/docs/set_up_oauth (tokens last one hour; route to `a.klaviyo.com`, not `www.klaviyo.com`) |
| Klaviyo template language (variables, tags, `{% if %}`, `{% for %}`, `{% unsubscribe %}`) | basis of the syntax guard | n/a | [VERIFIED] https://developers.klaviyo.com/en/docs/django_message_design ; behaviour of `{{`/`{%` inside UC `text` blocks and inside attribute values not confirmed [OPEN, spike K4] |
| Assign template to campaign message clones the template | basis of "template edits are not live-propagating" | n/a | [VERIFIED] https://developers.klaviyo.com/en/reference/assign_template_to_campaign_message ; whether flow messages behave the same is [ASSUMPTION] |
| Klaviyo API logs tool (14 days retention, filter by status, path, key, revision) | manual verification aid | Klaviyo UI | [VERIFIED] https://developers.klaviyo.com/en/docs/monitor-api-usage |
| parse5 `sourceCodeLocationInfo`, `ElementLocation.startTag/endTag/attrs` | splice offsets | n/a | [VERIFIED] https://parse5.js.org/interfaces/parse5.ParserOptions.html ; https://github.com/inikulin/parse5/blob/master/packages/parse5/lib/common/token.ts ; behaviour in workerd on large email HTML [ASSUMPTION, spike K6] |
| Test account (free plan, linked to production login) | verification | Klaviyo UI | [VERIFIED] https://developers.klaviyo.com/en/docs/create_a_test_account ; API availability on the free plan [OPEN, spike K1] |

**Auth flows.**
1. *App to worker, DA permission, site allowlist*: unchanged (#27 section 3).
2. *Worker to Klaviyo*: `proxy` injects `Authorization: Klaviyo-API-Key <env.KLAVIYO_PRIVATE_API_KEY>` by secret name; the caller's IMS token is never forwarded (#2 Decision 6/8); there is no token exchange, no cache, nothing to refresh.
3. *Cron*: no user token; uses the stored mapping, the anonymous content fetch and the Klaviyo secret.

## 4. Data contracts

Behavioural contracts; the interface itself is #27 section 4 and is not repeated.

**Descriptor** (`GET /vendors` returns it; names are the #27 contract):

| Field | `universal-content` | `template` |
|---|---|---|
| `kind` / `label` | `universal-content` / "Universal content block (updates go live immediately in every email using the block)" | `template` / "Email template (HTML slots)" |
| `slotModel` | `single` | `named-slots` |
| `valueFormats` | `html`, `text` | `text`, `html`, `url`, `image` |
| `slotName` | fixed (`content`) | `maxLength` 50, `pattern` `^[a-z][a-z0-9_-]{0,49}$` |
| `supportsApproval` | false | false |
| required secrets | `KLAVIYO_PRIVATE_API_KEY` | same |

**Operation mapping.**

| Operation | Klaviyo calls | Result |
|---|---|---|
| `connect` | `GET /api/templates?page[size]=1&fields[template]=name` (cached OK 10 min) | session `{baseUrl, revision, pacer}` or `auth_failed`/`permission_denied`/`vendor_unavailable` |
| `listTargets(template)` | `GET /api/templates` (page 10, `contains(name,..)`, `sort=-updated`), editor types filtered client-side | `{items:[{id,name,kind:"template",status:editor_type,updatedAt}], nextCursor?}` |
| `listTargets(universal-content)` | `GET /api/template-universal-content` (page up to 100), type and name filtered client-side | `{items:[{id,name,kind:"universal-content",status:block type,updatedAt}], nextCursor?}` |
| `describeTarget(template)` | `GET /api/templates/{id}?fields[template]=name,editor_type,html` | `{slots:[{name, type: "html"\|"url"\|"image"\|"text"}]}` from markers; `[]` if none |
| `describeTarget(universal-content)` | `GET /api/template-universal-content/{id}` | `{slots:[{name:"content", type: block type}]}` |
| `push(template)` | one `GET` + one `PATCH` (`attributes.html` only) | per-slot results; `vendorState: "saved"` |
| `push(universal-content)` | one `GET` + one `PATCH` (full definition, no `name`) | one result; `vendorState: "live"` |

**Slot marker contract (template HTML).** Content slot: `<td data-ew-slot="headline">Placeholder</td>`. Attribute slot: `<a href="#" data-ew-slot="cta_url" data-ew-attr="href">Shop now</a>`; image: `<img src="" alt="" data-ew-slot="hero" data-ew-attr="src">`. Names unique per purpose, reusable across elements. Markers survive in the template after sync; they are never removed or rewritten.

**Error classification** (module-internal table, HTTP-driven): see Decision 22; every outcome is `{code, retryable}` with codes from the #27 taxonomy; slot-level conditions (marker missing -> `target_not_found`; syntax guard, format mismatch, malformed or nested marker, URL scheme, size -> `invalid_value`).

**Configuration.** Secret: `KLAVIYO_PRIVATE_API_KEY`. Non-secret: `KLAVIYO_REVISION` (optional, default pinned `2026-10-15`), `KLAVIYO_CALLS_PER_MINUTE` (default 300), local-only `KLAVIYO_BASE_URL_OVERRIDE` (loopback only, ignored in production config). Shell variables (#27 section 4) are unchanged. No stored state of its own: all persistence is the shell's D1 (mapping, hashes of pushed values, sync state).

## 5. Folder layout (proposed; fits #1, #2, #27)

```
apps/marketing-automation-sync/providers/klaviyo/
├─ SPEC.md                 this file
├─ README.md               Klaviyo setup: key and scopes, secret, variables, marker convention, live-effect warning, rotation, revision policy
└─ worker/                 klaviyo module (descriptor, interface operations, marker splice, escaping and guards, error classification, pacing)
   └─ test/                fake Klaviyo (stateful), golden templates and blocks, V1 suite run, Klaviyo behavioural tests
```

Registration touches, and only touches: the extension worker's vendor registry list (one entry), its wrangler `secrets.required` (one name) and `.dev.vars.example` (one line), and the extension README's vendor list (one row linking this README). No file of the shell's own logic changes. [OPEN, low stakes: whether the README row counts as "registering" for AC3; the spec treats it as documentation of the registration.]

## 6. Interface fit assessment (this ticket's answer to #27 Open Question 13) and optional amendments

**Fit.** The #27 interface (descriptor, connect, list, describe, push, error taxonomy) fits Klaviyo with zero changes: two kinds, `single` for UC blocks, `named-slots` for templates, `supportsApproval` false, errors mapped from HTTP statuses. The model "target with named or single slots, push values" is sound for Klaviyo **only for HTML-bearing objects**; native drag-and-drop templates and non-HTML block types do not fit one slot model (Decision 2, 10).

**Strains, each with its baseline behaviour (no shell change) and an optional amendment.** The baseline is committed; amendments are owner decisions to be reconciled with #28 to #32 (and especially #28's spec when it lands [OPEN]).

| # | Strain | Baseline (no shell change) | Optional amendment (cross-vendor decision) |
|---|---|---|---|
| KA-1 | UC writes are immediately live with no draft; Marketo's `supportsApproval` has no equivalent. | Warning carried in the kind `label`; README recommends add-disabled, manual first sync, then enable. | descriptor flag `liveEffect` that makes the UI require an acknowledgement before enabling a binding and optionally show a current-vs-new preview (adds an optional `currentPreview` text field to `describeTarget` slots). |
| KA-2 | Template slots exist only if the template author placed markers; Marketo creates tokens on first push. The mapper UI lets an admin type any slot name. | A name with no marker fails that slot at sync with `target_not_found`; `describeTarget` lists existing names so the UI can suggest them (user story 7 of #27). | descriptor `slotName.existingOnly: true` so the UI restricts to listed names and validates at save. |
| KA-3 | Klaviyo `429` carries a precise `Retry-After`; slot-level "marker missing" has no taxonomy code. | `rate_limited` retryable, engine backoff 5/15/60 min; marker missing mapped to `target_not_found`. | optional `retryAfterSeconds` on errors; code `slot_not_found`. |
| KA-4 | Per-binding opt-in for deliberate Klaviyo syntax (`{{ first_name }}`) would need a per-binding option; `options` is `{approve?}` only. | Strict reject, no option. | descriptor-declared generic per-kind options replacing the hard-coded `approve`. |
| KA-5 | Value-format versus slot-type mismatch (for example `url` into a content slot) is only knowable after `describeTarget`. | Reported per slot at push (`invalid_value`) and in preview if the shell previews through `describeTarget`. | shell-side type-aware validation using `slots[].type`. |

None of the amendments is needed for #30's acceptance criteria. If any is adopted, it changes the shared interface for every vendor and needs its own review (#27 Decision 14).

## 7. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Adobe outside-activity/IP policy** and a customer Klaviyo key under a personal Cloudflare account (carries over from #1 R1, #2 R1, #27 R1) | High for publishing | [OPEN] README note; owner decides the account before sharing |
| R2 | **No Klaviyo account or key available** to the agent; every behaviour is from docs | High | Spikes K1-K7 first once an account exists; free test accounts need no purchase [VERIFIED]; fixtures hand-written until recorded |
| R3 | **UC writes are live in every email using the block**, no draft | High (campaign impact) | Label warning, README workflow, `enabled:false` first-sync guidance, template kind as the safe default for experiments; optional KA-1 |
| R4 | **Template syntax injection**: page content containing `{{`/`{%` evaluated by Klaviyo | High | Syntax guard rejecting per slot (Decision 19), tests KS1; confirm engine behaviour in spike K4 |
| R5 | **Markers may not survive Klaviyo's HTML normalisation** (comments or attributes stripped or rewritten) | High (blocks template kind) | Spike K3 decides between `data-ew-slot` (baseline) and a fallback marker form; the splice design is marker-agnostic |
| R6 | **Whole-definition replace** wipes UC styling if mis-implemented; read definition may contain members PATCH rejects under `2026-10-15` | High | Read-modify-write with carry-over; test KU1 against a fake that clears omitted members; spike K4 for round-trip validity |
| R7 | **Lost update** between read and write, no conditional request known | Medium | Back-to-back read/write; README states last write wins; spike K7 looks for `updated`-based or ETag mechanisms |
| R8 | **Account-wide shared quota** (750/min steady on the endpoint pages) with other integrations | Medium | Conservative 300/min default, header-driven backoff, hash-gated writes; Open Question 8 |
| R9 | **Docs disagree on bad-key status** (`400` vs `401`) and one `RateLimit` header name has an en dash | Low-Med | Treat both as `auth_failed` on probe, tolerant header matching, record real responses in K2/K5 |
| R10 | **Revision lifecycle**: a revision is stable one year; `2026-10-15` is current but the UC `display_options` shape just broke | Medium | Single pinned constant; read-modify-write preserves unknown members; yearly bump task in README; log on `410` |
| R11 | **Free plan may not expose Templates/UC APIs**, or may cap templates | Medium | Spike K1; fall back to a paid test account via the owner |
| R12 | **Template and block size limits undocumented**; plain-text part may go stale after an HTML write | Low-Med | Size pre-check at 4 MB; spikes K3/K4 record limits and plain-text behaviour |
| R13 | **parse5 in workerd on large email HTML** (CPU on the Free plan; large inline CSS) | Low-Med | Shared spike with #27 S4, K6 measures a 300 KB template; target Workers Paid (#27 Open Question 4) |
| R14 | **Interface amendments** KA-1..KA-5 conflicting with #28 to #32 | Medium | Baseline needs none; reconcile with #28's spec once it lands |
| R15 | **A text block may evaluate or escape `{{`** differently from an HTML block; attribute values may be handled differently again | Low-Med | Guard applies to all formats and all slots; spike K4 confirms |

**Spikes (build-plan step 1; results recorded in the README and fixtures):**
- **K1** Account and scope: create a free test account and a custom-scope key (`templates:read`, `templates:write`); confirm Templates and UC create/get/update work on the free plan; confirm the `revision: 2026-10-15` header; record actual `RateLimit-*` header names and values.
- **K2** Auth and error shapes: invalid key, key from another account, key missing a scope, missing revision header, wrong content type: record status codes and `errors[].code` so the module can tell "bad key" `400` from "bad body" `400`.
- **K3** Template round-trip: for a `CODE` and a `USER_DRAGGABLE` template, do `data-ew-slot`/`data-ew-attr` attributes, HTML comments, `{% unsubscribe %}`, `{% if %}` and `data-klaviyo-*` survive PATCH then GET; how does Klaviyo re-format; maximum `html` size; does the plain-text part regenerate; are `href`/`src` attribute edits retained.
- **K4** UC round-trip: is a block read under `2026-10-15` accepted unchanged by PATCH; is `name` optional on PATCH; does `{{ }}` evaluate in `text` and `html` blocks; maximum `content` size; confirm in the Klaviyo editor that a template embedding the block shows the new content.
- **K5** Rate limits: observe `429` behaviour, `Retry-After` values and burst vs steady windows on the template and UC endpoints from a worker-like client; settle the 750/m (endpoint pages) versus 700/m (general tier table) discrepancy.
- **K6** parse5 location info in workerd on a 300 KB hybrid template (shared with #27 S4).
- **K7** Concurrency: does Klaviyo expose any version or conditional-write signal on templates or blocks; what happens to a UI edit saved between the module's read and write.

## 8. Ordered build plan (sized to #30's acceptance criteria)

0. **Prerequisites (owner):** #27 landed (shell, registry, V1 contract suite, fake vendor); a Klaviyo test account and a custom-scope private key (or an explicit decision to build against the fake only); decisions on Open Questions 1-6; Cloudflare account from #27.
1. **Spikes K1-K7**, fixtures and README notes committed. (AC1, AC2, AC6)
2. **Fake Klaviyo and golden fixtures first**: stateful fake with the documented behaviours (revision and auth checks, scopes, JSON:API media types, page sizes, `links.next`, name filters, replace-whole-definition semantics, optional HTML re-formatting, `429` windows with `Retry-After` and `RateLimit-*`, scripted `4xx`/`5xx`), plus golden templates (plain, hybrid, Django logic, comments, unsubscribe, nested/malformed markers) and UC blocks (html, text, button, image, with styles and display options). (AC7)
3. **Escaping, URL validation and syntax guard**, test-first. (AC1, AC6)
4. **Template splice** (content and attribute slots, byte preservation, multi-occurrence), test-first. (AC1, AC2)
5. **UC read-modify-write**, test-first. (AC1, AC2)
6. **Error classification, retry flags, pacing**, test-first. (AC2, AC6)
7. **Descriptor, connect, listTargets, describeTarget**; run the shell's V1 contract suite for Klaviyo. (AC1, AC3)
8. **Register the provider** (registry entry, `secrets.required`, `.dev.vars.example`, README vendor row). (AC3)
9. **Integration tests** through W1/R1 with Klaviyo registered; descriptor-driven UI fixtures; Playwright path with the fake Klaviyo. (AC1, AC2, AC5, AC6)
10. **Runtime smoke** in workerd (module against fake Klaviyo over HTTP, parse5 splice on a large template). (AC6)
11. **Provider README and repo checks** (secret hygiene, import-graph rule, README sections). (AC4, AC7)
12. **Deploy, set the secret, manual verification** MK0-MK8 against a real Klaviyo test account in real EW; record results (observed `Origin`, publish-to-sync latency, marker survival) in the README. (AC1, AC2, AC5, AC6)
13. **Hand-off note** for #28/#29/#31/#32: the interface-fit assessment (section 6) added to the shell's "adding a vendor" checklist.

---

# Testing Requirements

## 1. Fixtures and fakes

Everything below runs with no Klaviyo account, no Cloudflare login and no Adobe login. Fakes extend the #2 test kit and the #27 fakes; none talks to the network.

- **Fake Klaviyo** (scripted `fetch` handler, also runnable as a local Node server for W2/E2E): requires `Authorization: Klaviyo-API-Key <canary>` (else `400`/`401`, configurable to test the `400` ambiguity), `revision` (else `400`), `accept`/`content-type: application/vnd.api+json` on bodies (else `415`); per-key scopes (`templates:read` only keys get `403` on PATCH); templates of editor types `CODE`, `USER_DRAGGABLE`, `SYSTEM_DRAGGABLE`, `SIMPLE` with `html`; UC blocks of types `html`, `text`, `button`, `image` with `styles`, `properties`, `display_options` and **whole-definition replace semantics** (omitted members are cleared, so a module that does not carry them over visibly fails); JSON:API pages (`links.next` absolute URL with `page[cursor]`; template page size capped at 10, UC at 100), filters (`contains(name,..)` for templates, `equals` only for UC), `fields[...]` honoured; optional HTML re-formatting on template save; fixed-window `429` model (75/s and 750/min) with `Retry-After` and `RateLimit-*` headers on non-429; scripted `409`/`410`/`5xx`/timeouts/malformed JSON; an error body that echoes the `Authorization` header (secret-leak probe); records every request; counters for `POST` create and `DELETE` (must stay zero).
- **Golden templates**: plain `CODE` template with content and attribute slots; hybrid template with `data-klaviyo-*` attributes; template with `{% unsubscribe %}`, `{% if %}...{% endif %}` between table rows, comments, `<style>`, entities, non-ASCII; templates with duplicate slot names, nested markers, a marker on a void element, a content marker with no end tag; a 300 KB template.
- **Golden blocks**: html and text blocks with styles and `display_options` in both the pre-`2026-10-15` and `2026-10-15` shapes, plus unsupported types.
- #27 fakes (published site, DA admin, IMS, fake clock, in-memory store, fake vendor); canary key value such as `pk_CANARY_not_a_real_key_<random>` that must not match real Klaviyo key patterns so repository secret scanning is not triggered.
- After spikes K1-K7, recorded real responses (sanitised) replace or supplement the hand-written fixtures; a fixture-drift test compares the fake's shapes to them.

## 2. Vendor contract suite (seam V1, #27 VC1-VC8) run for Klaviyo

The shared suite runs unchanged against the Klaviyo module and the fake Klaviyo; it is the primary proof of AC3. Klaviyo-specific expectations for each:

| ID | Klaviyo expectation |
|---|---|
| VC1 | descriptor has both kinds, slot models, formats, name limits, required secret `KLAVIYO_PRIVATE_API_KEY`, no approval support; the app can render a picker and slot editor from it alone |
| VC2 | good key -> session; wrong key -> `auth_failed`; key lacking `templates:read` -> `permission_denied`; unreachable -> `vendor_unavailable` (retryable); secret absent -> shell `vendor_not_configured` |
| VC3 | `listTargets` pages with stable order and `nextCursor`; `query` filters; unknown kind rejected |
| VC4 | `describeTarget` returns existing slots; unknown id -> `target_not_found` |
| VC5 | `push` writes exactly the slots given; repeating it leaves the fake in the same state |
| VC6 | one invalid slot fails with its own error while the others are written (template kind; Klaviyo achieves this by pre-validation and, if the single `PATCH` is rejected, sequential fallback, KT9) |
| VC7 | no raw Klaviyo text crosses the boundary; every failure has a taxonomy code and `retryable` |
| VC8 | no delete or create operation exists; the fake's create/delete counters stay zero |

## 3. Klaviyo behaviour tests (seam V1; module public interface + fake Klaviyo)

### 3.1 Authentication, revision, host

| ID | Behaviour asserted |
|---|---|
| KA1 | Every call carries `Authorization: Klaviyo-API-Key <canary>`, `revision: 2026-10-15`, `accept: application/vnd.api+json`; write calls carry `content-type: application/vnd.api+json`; the key is in no URL, query or body; only `a.klaviyo.com` (or the loopback override in a local env) is contacted |
| KA2 | `connect` probe is `GET /api/templates?page[size]=1&fields[template]=name`; a `400` or `401` on the probe -> `auth_failed`, `403` -> `permission_denied`, `5xx`/network -> `vendor_unavailable`; success is cached 10 minutes (second `connect` makes no call, an expired cache calls again) |
| KA3 | The session object, JSON-serialised, contains no key; the caller's IMS token never appears in any Klaviyo request |
| KA4 | `KLAVIYO_REVISION` override honoured only in a local env; a production-config env ignores it |
| KA5 | A `410` from Klaviyo -> `unknown` plus a log line naming "revision retired"; no fall-forward opt-out header is sent |

### 3.2 Listing and describing

| ID | Behaviour asserted |
|---|---|
| KL1 | Templates: requests use `page[size]` <= 10, `contains(name,'...')` with a quote or special characters in the query safely encoded, `sort=-updated`; `SYSTEM_DRAGGABLE` and `SIMPLE` are not returned; `nextCursor` is the `page[cursor]` value from `links.next`, not a followed URL |
| KL2 | UC: `page[size]` <= 100; only `html` and `text` blocks of `content_type=block` returned; text query applied case-insensitively in the worker; unsupported types never returned |
| KL3 | `limit` larger than a Klaviyo page: the module reads at most 5 Klaviyo pages and returns a `nextCursor` when more remain; a short page with a cursor is not treated as the end |
| KL4 | A malformed, over-long or non-base64url-like cursor is rejected (shell `400`) with zero Klaviyo calls |
| KD1 | `describeTarget(template)` returns slots found by markers with types (`content` -> html/text, `href` -> url, `src` -> image, `alt` -> text); duplicates reported once; none -> empty list, not an error; `SYSTEM_DRAGGABLE` -> `target_not_found` |
| KD2 | `describeTarget(universal-content)` returns the single `content` slot with the block's type; `button`/`image`/`section` -> `target_not_found` |
| KD3 | Nested markers, a content marker without an end tag, and an unsupported `data-ew-attr` value are reported in a way that makes `push` fail those slots (KT6) |

### 3.3 Template write (splice)

| ID | Behaviour asserted |
|---|---|
| KT1 | **Byte preservation**: after a push, the `PATCH` html equals the read html with only the marked ranges changed; all other bytes identical, verified on every golden template including Django tags, comments, `<style>`, entities and non-ASCII |
| KT2 | Attribute slots: `href`, `src`, `alt` replaced in place; an absent attribute is added; quotes in values are escaped; `data-ew-attr` with a disallowed attribute (`onclick`, `style`) -> `invalid_value` for that slot |
| KT3 | The same slot name on several elements: all are written with the same value |
| KT4 | N slots on one template produce exactly one `GET` and one `PATCH`; the `PATCH` body's attributes contain `html` only (no `name`, `text`, `amp`, `definition`) |
| KT5 | A slot with no marker: that slot fails `target_not_found`; other slots are written; if no slot is writable no `PATCH` is sent |
| KT6 | Nested markers, missing end tag, marker on a void element, unsupported attribute, format not matching slot type: those slots fail `invalid_value`; others written |
| KT7 | Idempotence: pushing the same values twice yields a `PATCH` that leaves the fake's html unchanged (also when the fake re-formats html on save) |
| KT8 | `SYSTEM_DRAGGABLE` / `SIMPLE` template -> `target_not_found`, no `PATCH` |
| KT9 | When the multi-slot `PATCH` is rejected `400` by the fake, the module applies slots sequentially, writing the valid ones and isolating the failing one with its own `invalid_value` |
| KT10 | A resulting body larger than 4 MB -> `invalid_value`, no `PATCH` |

### 3.4 Universal content write (read-modify-write)

| ID | Behaviour asserted |
|---|---|
| KU1 | **Definition carry-over**: after a push the fake block's `styles`, `properties` and `display_options` are identical to before (the fake clears omitted members, so dropping them fails the test), in both `display_options` shapes; only `data.content` changed |
| KU2 | The `PATCH` has no `name` attribute and an unchanged `type` and `content_type`; the block id in body and path agree |
| KU3 | `html` block: `html` and `text` formats accepted, `text` is HTML-escaped; `text` block likewise; one `GET` and one `PATCH` per push |
| KU4 | `button`, `image`, `section` and unknown block types -> `target_not_found`, no `PATCH` |
| KU5 | The descriptor label for the kind states immediate, account-wide effect (asserted by a stable substring of the label); no approval option is offered |
| KU6 | A block deleted between listing and push (`404`) -> `target_not_found`; other bindings unaffected |

### 3.5 Values, syntax guard, input safety (AC6)

| ID | Behaviour asserted |
|---|---|
| KS1 | `{{`, `{%`, `{#` in a value of any format and for any slot (content, attribute, UC) -> `invalid_value`, not written, other slots proceed; benign single braces and a lone `}}` pass |
| KS2 | `text` containing `<script>`, `&`, quotes lands escaped; `html` is inserted as provided; `url`/`image` accept absolute `https:`/`http:` (and `mailto:`/`tel:` for `url`), reject `javascript:`, `data:`, relative and protocol-relative values |
| KS3 | **Canary property**: across success, every error class, a fake error body echoing the `Authorization` header, a thrown error, a missing secret and the connection probe, the canary key appears in no module output, response, header, log line or stored row |
| KS4 | Target ids not matching `^[A-Za-z0-9]{6,40}$` (slashes, `..`, `%2f`, `?`, `#`, whitespace) and search text over 100 characters are rejected with zero outbound requests |
| KS5 | Redirects (`3xx`) from the fake are not followed; the fake sees no second request; no key is sent to a second host |
| KS6 | No request other than `GET` (reads) and `PATCH` (writes) is ever sent; no `POST` create, no `DELETE` (fake counters) across the whole suite |

### 3.6 Errors, retries, pacing

| ID | Behaviour asserted |
|---|---|
| KE1 | Status table: `400` body-rejected -> `invalid_value`; `401` -> `auth_failed`; `403` on write -> `permission_denied`; `404` -> `target_not_found`; `409` -> `unknown` retryable once; `415` -> `unknown`; `429` -> `rate_limited` retryable; `500`/`502`/`503`/timeout/network -> `vendor_unavailable` retryable; malformed JSON or unexpected `2xx` shape -> `unknown`; Klaviyo error text appears nowhere in the output; the error `id` appears in the log |
| KE2 | `429` with `Retry-After` shorter than the per-call cap is waited out on the fake clock then succeeds; longer than the cap returns `rate_limited` without sleeping past the cap |
| KE3 | `5xx` on a `GET` is retried; a `PATCH` `503` is retried (explicit safe flag) with the identical body bytes; exhausted retries -> `vendor_unavailable` |
| KP1 | Pacing: with 100 queued pushes the fake never emits `429` for burst or steady limits; concurrency never exceeds 2; calls per second <= 5; calls per minute <= `KLAVIYO_CALLS_PER_MINUTE` |
| KP2 | `RateLimit-Remaining` below 10% of `RateLimit-Limit` -> the module waits until `RateLimit-Reset` (fake clock) before the next call; absent or oddly-cased headers are tolerated |
| KP3 | Steady-window exhaustion on the fake surfaces as `rate_limited` retryable to the engine, which retries later (SY7 of #27) and eventually succeeds |

## 4. Shell integration with Klaviyo registered (seams W1 and R1)

| ID | Behaviour asserted |
|---|---|
| KI1 | `GET /vendors` lists `klaviyo` with both kinds; `configured` is true only when the secret is set; `POST /vendors/klaviyo/test` returns `ok` or a fixed reason (never the key) |
| KI2 | Mapping validation uses Klaviyo descriptor limits: slot names over 50 characters or violating the pattern rejected; a `single` kind with two rules rejected; format not allowed for the kind rejected |
| KI3 | Save a mapping with one template binding (two slots) and one UC binding, Sync now: the fake Klaviyo holds the new template regions and block content; status shows `lastSyncedAt` and `in_sync` (#30 A1/A2) |
| KI4 | Republish (new `Last-Modified`, one field changed) and tick: exactly one `GET`+`PATCH` for the affected binding; an unchanged page produces zero Klaviyo calls (#30 A2) |
| KI5 | A missing marker and a syntax-guard rejection show per-slot errors with fixed messages; the binding is `partial`; sibling slots synced; no raw Klaviyo text in the status (#30 A2) |
| KI6 | A `429` storm on the fake recovers through the engine's retry schedule without losing the change |
| KI7 | Route enumeration (AZ1 of #27) covers `/vendors/klaviyo/*`: every route returns `401` without a token before the fake Klaviyo receives anything; a read-only DA user gets `403` on sync (#30 A6) |
| KI8 | With Klaviyo registered, Marketo and the fake vendor behave as before (the shell suite passes unchanged with and without the Klaviyo registration) (#30 A3) |
| KI9 | A disabled binding is not synced; unmapping or disabling never calls Klaviyo |

## 5. App unit tests (seam S2; `@web/test-runner`; Klaviyo fixtures only)

The app is not modified (AC3). Two parametrised fixtures prove it is descriptor-driven for Klaviyo: **UKI1** the target picker, slot editor and format choices render from the Klaviyo descriptor alone, show the live-effect label, offer no approval control, and apply the 50-character slot-name limit; **UKI2** `describeTarget` slot names with types are offered as suggestions and a template with no markers shows an empty list and the plain "no slots found" state (text only, no HTML rendering of any Klaviyo-provided string).

## 6. End-to-end (seam S1; Playwright, Chromium, hermetic)

Same harness as #27: static server `:3000`, real worker via `wrangler dev` `:8787`, fake Klaviyo as a local Node server, #1 SDK stub.

| ID | Behaviour asserted |
|---|---|
| KE2E1 | Pick Klaviyo, a template target and the heading/CTA fields; map to `headline` (content) and `cta_url` (`href`) slots; preview shows the escaped text and the URL; save; Sync now; the fake template html has both values and every other byte unchanged (#30 A1, A2) |
| KE2E2 | Map a block field to a UC block; Sync now; fake block content updated, styles preserved (A1, A2) |
| KE2E3 | Edit the fake page, advance the scheduled hook; status shows the new last-synced time and only the affected binding was written (A2) |
| KE2E4 | Remove the marker in the fake template; status shows the slot's plain error and the other slot succeeded (A2) |
| KE2E5 | Request without a token to every worker route -> `401` readable in the browser (CORS headers present) (A6) |
| KE2E6 | Page HTML, DOM and all network responses contain neither the IMS token nor the canary Klaviyo key (A6) |
| KE2E7 | Only expected hosts contacted from the browser (static server, worker, SDK stub; `admin.da.live` stubbed); Klaviyo is contacted only by the worker (A6) |

## 7. Runtime smoke (seam W2)

SMK1 the worker bundles with the Klaviyo module and starts; a bare request gets `401`. SMK2 the module against the fake Klaviyo over real HTTP including a `429` with `Retry-After` and real (tiny) timers; the canary is absent from every response (KS3 over HTTP). SMK3 parse5 splice on the 300 KB golden template in workerd: result byte-identical outside marked ranges; CPU and wall time recorded (informational, R13).

## 8. Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| UKR1 | `providers/klaviyo/` contains `README.md` and `worker/` with its tests; the README documents the key and its scopes (`templates:read`, `templates:write`), the secret name, `KLAVIYO_REVISION` and `KLAVIYO_CALLS_PER_MINUTE`, the marker convention, the live-effect warning, rotation, and the statement that no site configuration is read (#30 A4) |
| UKR2 | `KLAVIYO_PRIVATE_API_KEY` is in the worker's `secrets.required` and in `.dev.vars.example`, and not in `vars` (#2 UR3/UR5); no tracked file contains a value matching a Klaviyo private key pattern (`pk_` followed by 30+ alphanumerics) |
| UKR3 | **Registration-only rule**: the Klaviyo provider imports only the vendor interface, the shell's public vendor types and the #2 core; no shell internals; the shell directory has no Klaviyo-specific identifier outside the registry entry and the vendor list row (static import-graph and grep check) (#30 A3) |
| UKR4 | The V1 contract suite is executed for Klaviyo (a provider without a suite run fails, #27 UR5) |
| UKR5 | Lint (ESLint, Stylelint) and all test tiers run in CI on every push and PR (#27 UR6); no secret in CI (#30 A7) |

## 9. Manual verification inside real Experience Workspace and a real Klaviyo test account

Accounts and credentials needed: GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, #1); an Adobe IMS identity with write access to the DA org/site and permission to edit the site config; Chrome; a Cloudflare account with `wrangler login` and the #27 worker deployed (Paid plan for cron plus D1, #27 Open Question 4); **a Klaviyo test account** (free, linked to the owner's production login [VERIFIED]) and a **custom private API key with only `templates:read` and `templates:write`**, created by an Owner/Admin/Manager of that account; never use a production account's key. In the test account: an HTML template with the README's marker snippet, a hybrid template if available, an HTML universal content block and a template that embeds it; a published EW test page with a key/value block. Never paste the IMS token or the Klaviyo key into chat, issue comments or logs.

- **MK0 (prereq):** `wrangler secret put KLAVIYO_PRIVATE_API_KEY`; deploy; `curl -i <worker>/v1/vendors/klaviyo/test` returns `401`; with a valid token it returns `ok` (connected) (#30 A6).
- **MK1 (`ref=local`, templates):** local worker (port 8787) and `npm start` (port 3000); open `https://da.live/app/jazhou-adobe/ew-extensions/apps/marketing-automation-sync/marketing-automation-sync?ref=local`, accept the trust prompt (#1 2.4); choose Klaviyo, the marked template; map heading and CTA link to `headline` and `cta_url`; preview; save; Sync now; in Klaviyo open the template's HTML: only the marked regions changed, `{% unsubscribe %}` and layout intact; use the Klaviyo template preview to see the rendered copy (A1, A2, A5).
- **MK2 (universal content):** map a block field to the UC block, save it disabled, Sync now once, confirm in Klaviyo that the block content changed and its styling is intact and that the template embedding it shows the new content; enable the binding (A1, A2). Record that the change is immediate (R3).
- **MK3 (published edit, polled re-sync):** change the heading in the EW editor and publish; wait one polling interval (local scheduled trigger under `ref=local`); status shows a new last-synced time and Klaviyo holds the new text; unedited slots untouched; record latency in the README (A2).
- **MK4 (per-item errors):** remove a marker in the Klaviyo template, put `{{ first_name }}` in an EW field, delete the UC block: Sync now shows the plain per-slot errors; restore and see recovery (A2).
- **MK5 (branch ref):** push branch `klaviyo-spec` (simple name), wait for code sync, open the app with `?ref=klaviyo-spec` against the deployed worker; repeat MK1's save and sync; record the page's `Origin` in the README (A5; #2 R2).
- **MK6 (credentials and security):** with `curl`: no token -> `401`; read-only DA user -> `403` on sync; disallowed `Origin` -> `403`; search page source, Network responses and DevTools storage for the Klaviyo key (none). In Klaviyo's API logs tool confirm the worker's calls use the expected revision, only `templates` endpoints and no `4xx` surprises (A6).
- **MK7 (rotation):** delete the key in Klaviyo (status shows `auth_failed` on next sync), create a new key, `wrangler secret put KLAVIYO_PRIVATE_API_KEY`; the next sync succeeds with no code change (A6).
- **MK8 (limits and registration):** sync a mapping of ~50 bindings and watch the Klaviyo API activity dashboard: no `429`, calls within the configured per-minute budget; confirm the vendor picker lists Klaviyo with no other shell change in the diff (A2, A3).

## 10. Acceptance-criteria traceability (ticket #30)

Labels A1 to A7 are #30's seven acceptance criteria in the order the ticket lists them.

| # | Acceptance criterion (#30) | Automated proof | Manual / review verification |
|---|---|---|---|
| A1 | Admin maps EW page/fragment content (by block and field) to the vendor's content objects and saves the mapping per site | KL1-KL4, KD1-KD2 (targets and slots offered), KT1-KT6, KU1-KU4 (slots really addressable and written), KI2, KI3 (save and sync both kinds), UKI1-UKI2, KE2E1, KE2E2 (plus the shell's EX*, MP* suites, which Klaviyo reuses) | **MK1**, **MK2** |
| A2 | Content pushes on demand, the worker re-syncs mapped pages whose published version changed (polled); the app shows last sync time and per-item errors | KI3-KI6, KT7, KP1-KP3, KE1-KE3, KE2E1-KE2E4, SMK2 (plus the shell's SY* suite via the fake vendor) | **MK1** (Sync now), **MK3** (polled re-sync, latency recorded), **MK4** (per-item errors), **MK8** (limits) |
| A3 | Added inside the existing `marketing-automation-sync` extension folder as a new provider; no shell changes beyond registering the provider | VC1-VC8 (shared contract suite passes unchanged), KI8 (shell suite unchanged with Klaviyo registered), UKR3 (registration-only import and identifier rule), UKR4, UKI1 (app untouched, descriptor-driven) | Review of the diff: only `providers/klaviyo/**`, one registry entry, one secret declaration, one `.dev.vars.example` line, one README row; **MK8** (vendor appears in the picker) |
| A4 | Extension README documents this vendor's setup (credentials, site config keys) | UKR1 (provider README sections and the no-site-config statement), UKR2 (secret declared) | README walk-through on a scratch checkout from clean clone to a successful sync against the fake and a real test account; reviewer confirms the key scopes and marker snippet work (**MK0**, **MK1**) |
| A5 | Works in EW with `ref=local` and with a branch ref | KE2E1-KE2E7 (page at `localhost:3000` against the local worker), SMK1-SMK3, origin handling by the template's UC tests | **MK1** (`ref=local`), **MK5** (branch ref against the deployed worker; observed `Origin` recorded) |
| A6 | Vendor credentials live only in this extension's worker (from the shared template); the browser never receives them; unauthenticated calls to the worker are rejected | KA1, KA3, KS3 (canary never leaks, including an echoing Klaviyo error body), KS4-KS5, KI1 (`/vendors` and test route never return the key), KI7 (every route 401 without a token, enumerated), KE2E5-KE2E7, UKR2, SMK1-SMK2 | **MK0** (`curl` 401), **MK6** (security checks, API logs), **MK7** (rotation); review that the key appears only in worker config |
| A7 | Core logic covered by unit tests; lint and CI green | all of sections 2-4 (VC, KA, KL, KD, KT, KU, KS, KE, KP, KI) run in `worker-unit`; UKI1-UKI2 in `unit`; KE2E in `e2e`; SMK in `worker-smoke`; UKR5 | Review: CI green on a PR; deliberately break a rule on a scratch branch (drop `styles` carry-over in the UC write, or let the splice re-serialise the HTML) and see KU1 or KT1 fail |

Every acceptance criterion on #30 maps to at least one automated test or a numbered manual verification step above.

## 11. Open questions for the owner

1. **Klaviyo account and key (R2).** Who creates the Klaviyo test account and the custom-scope key (`templates:read`, `templates:write`)? Is a free plan acceptable if spike K1 shows the Templates and Universal Content APIs work there, or should a paid test account be used? Building against the fake only, with MK0-MK8 deferred, is the alternative.
2. **Scope of Klaviyo objects.** This spec covers UC `html`/`text` blocks and HTML/hybrid templates with `data-ew-slot` markers. Is that the right first cut, or should it be UC-only (no marker convention to maintain) or also include button and image blocks (needs interface or per-block-type kinds, and image hosting)?
3. **Marker convention.** Is asking Klaviyo template authors to add `data-ew-slot` (and `data-ew-attr`) attributes acceptable, or do you prefer a different form (HTML comments, or replacing a whole template body)? Spike K3 may force the issue.
4. **Live effect of UC blocks (R3).** Accept the baseline (warning in the kind label, add-disabled-then-enable workflow in the README), or adopt amendment KA-1 (acknowledgement before enabling, current-versus-new preview) for all vendors?
5. **Template syntax in page content.** Keep the strict reject of `{{`, `{%`, `{#` (baseline), or add an opt-in per binding for deliberate personalisation (needs KA-4, a shell change)?
6. **Revision pin.** Pin `2026-10-15` (latest GA, with the UC `display_options` breaking change) or an older, more battle-tested revision? Do you want the fall-forward opt-out header sent so a retired revision fails loudly rather than behaving like the next revision?
7. **Private key versus OAuth.** Private key, single tenant now (this spec). Is OAuth (higher per-app rate limit, App Marketplace listing, per-account install) a future goal that should shape the credential seam?
8. **Rate-limit share.** Default 300 calls per minute of the shared 750 per minute account budget (40%) and 5 calls per second [ASSUMPTION]: confirm, or give the real constraint for the account (other integrations may share it).
9. **Drag-and-drop templates.** `SYSTEM_DRAGGABLE` templates are excluded (different writer, smaller rate tier). Acceptable?
10. **Interface amendments (section 6).** Adopt none (baseline), or any of KA-1 (live-effect flag and preview), KA-2 (existing-only slot names), KA-3 (`retryAfterSeconds`, `slot_not_found`), KA-4 (per-kind options), KA-5 (type-aware validation)? Reconcile with #28's spec before deciding.
11. **Images in email.** `image` values are absolute URLs on the EW live origin (`aem.live`). Acceptable for Klaviyo email deliverability and branding, or should a follow-up upload images to Klaviyo (`images:write`) or use a production domain (#27 Open Question 7)?
12. **Write-scope detection.** A missing `templates:write` scope only surfaces on the first write (no introspection call found). Acceptable, or should the connection test do a no-op write to a designated scratch template?
13. **Klaviyo region/data centre.** Docs show one host, `a.klaviyo.com`; confirm your account needs no regional host [ASSUMPTION].
14. **Policy and account (R1).** Carry-over: confirm the Adobe outside-activity/IP position and which Cloudflare account may hold a customer Klaviyo private key before the worker is shared.
15. **Overwrite policy.** One-way, last write wins, no drift or conflict detection when a Klaviyo user edits a synced region: acceptable (carried from #27 Open Question 12)?
