# Spec: Multi-DAM Picker: Cloudinary (picker shell + first DAM)

Ticket: jazhou-adobe/ew-extensions#23 (this spec: #61). Blocked by #1 (repo scaffold; spec `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec `shared/worker-template/SPEC.md`). #23 blocks #25 (Dropbox, which adds the provider-agnostic per-user OAuth plumbing), which in turn blocks #22 (Bynder) and #24 (Frontify); those two reuse Dropbox's OAuth plumbing with no new token-storage code.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked. Facts re-checked against the primary sources on 2026-11-16 are marked [VERIFIED].

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Cloudinary/Cloudflare.

Vocabulary follows #1 and #2: *extension* = one folder `apps/<name>/` (this one is a **library plugin**; its type comes from its `library` config-sheet row); *worker* = the per-extension backend in `apps/multi-dam-picker/worker/`, built from `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension. New terms: *provider* = one DAM integration (Cloudinary first); *shell* = the provider-agnostic browser UI plus the provider-agnostic worker core; *credential kind* = how a provider authenticates to its DAM: **`service`** (one credential held by the worker for every author, Cloudinary) or **`user-oauth`** (each author's own OAuth connection, Dropbox/Bynder/Frontify); *connection* = one author's authorisation against one `user-oauth` provider; *product environment* = Cloudinary's name for one asset store, addressed by a *cloud name*; *delivery URL* = the CDN URL of an asset, which Cloudinary builds from the asset's identifiers plus an optional *transformation* string (this is how Cloudinary produces renditions); *signed delivery URL* = a delivery URL carrying a signature component made from the API secret; *normalised asset* = the provider-neutral asset shape that crosses the worker/browser boundary.

Delivery order (owner decision): **#23 Cloudinary** builds the shell, the provider interface (both credential kinds defined) and is the first DAM, because its Free plan is self-serve with no credit card [VERIFIED: https://cloudinary.com/pricing, "Free forever, No credit card required"]. **#25 Dropbox** then builds the per-user OAuth plumbing (connect/disconnect from the library iframe, encrypted token store, refresh in the worker). **#22 Bynder** and **#24 Frontify** only add provider modules on top of that plumbing.

Primary sources read (2026-11-16): Cloudinary Admin API overview and Search for resources (https://cloudinary.com/documentation/admin_api_overview.md, https://cloudinary.com/documentation/admin_api_resources_search_for_resources.md), Get details of a single resource by asset ID (https://cloudinary.com/documentation/admin_api_resources_get_details_of_a_single_resource_by_asset_id.md), Search API method and expressions (https://cloudinary.com/documentation/search_method.md, https://cloudinary.com/documentation/search_expressions.md), access control and signed URLs (https://cloudinary.com/documentation/control_access_to_media.md, https://cloudinary.com/documentation/delivery_url_signatures.md), transformation counting (https://cloudinary.com/documentation/transformation_counts.md), image transformations and cropping (https://cloudinary.com/documentation/image_transformations.md, https://cloudinary.com/documentation/resizing_and_cropping.md), contextual metadata and alt text (https://cloudinary.com/documentation/contextual_metadata.md, https://cloudinary.com/documentation/accessible_media_images.md), folder modes (https://cloudinary.com/documentation/folder_modes.md), glossary (https://cloudinary.com/documentation/cloudinary_glossary.md), Media Library widget (https://cloudinary.com/documentation/media_library_widget.md), pricing (https://cloudinary.com/pricing). EW and SDK facts are carried from the #1/#2 research (https://www.aem.live/docs/ew/developing/apps-plugins, https://da.live/nx/utils/sdk.js, https://github.com/adobe/da-live/tree/main/blocks/canvas/ew-panel-extensions, https://github.com/adobe/da-nx/blob/main/nx/blocks/shell/shell.js). Upstream `adobe-rnd/ew-extensions` has no worker, DAM or OAuth code (tree checked in the #2 research on the same date: `blocks`, `tools`, `test`), so there is no upstream prior art for this ticket.

---

## Problem Statement

Content authors in Experience Workspace (EW) can insert images from AEM Assets (first-party), but many sites keep their media in a third-party DAM, and only AEM Assets is documented in EW. Today an author who wants a **Cloudinary** image has to leave EW, open the Cloudinary Media Library, find the asset, hand-build or copy a delivery URL, guess whether the multi-megabyte original or a resized version is appropriate, paste it, and retype alt text from the asset's metadata. Nobody checks that the URL works for a visitor, that its size is sensible, or that the alt text exists.

Cloudinary brings two problems that shape the design:

1. **No per-user login for the API.** Cloudinary's Admin and Search APIs authenticate with one API key and secret for the whole product environment (HTTP Basic) [VERIFIED: https://cloudinary.com/documentation/admin_api_overview.md]. There is no end-user OAuth flow to put behind a "Connect" button. The secret is powerful (it can read, change and delete every asset and sign any delivery URL), the extension code is public, so a worker must hold it. Because every EW author then acts through one credential, the worker is also the only place that can limit who may browse and how much.
2. **Renditions are made, not listed.** Cloudinary does not return a list of ready-made renditions. A rendition is a delivery URL with a transformation string inserted ("scale down to at most 1200 px wide, automatic format and quality"). With **strict transformations** enabled, unsigned dynamic transformations are rejected, and the fix, a signed delivery URL, needs the API secret, so it can only be produced on the server [VERIFIED: https://cloudinary.com/documentation/control_access_to_media.md, "Strict transformations": transformations are allowed only via eager transformations, signed delivery URLs, allow-listed named transformations or referral domains].

For the maintainer there is a third problem: four DAMs are planned (Cloudinary, Dropbox, Bynder, Frontify; the Contentful marketplace carries apps for all of them). If each were its own extension, the picker UI, error handling, quota protection and (for three of them) the OAuth/token plumbing would be written four times and drift. The first ticket must therefore deliver one picker shell and a provider interface that already expresses **both** credential kinds, so that Dropbox can add per-user OAuth without redesigning anything and Bynder and Frontify can arrive as modules.

## Solution

A **Multi-DAM Picker** library plugin, listed in the EW editor library. An author opens it and, because the site's Cloudinary credential is configured in the worker, sees the Cloudinary asset grid immediately (newest first), with no sign-in step. They search by keyword (typing searches automatically after a short pause), filter by type (images, videos, documents, audio), sort, and open an asset to see a larger preview with name, dimensions and type. They choose a rendition (default **Web**: at most 1200 px wide, automatic format and quality, never upscaled; others Large, Medium, Small, and the original file when browsers can display it), review an alt text prefilled from Cloudinary metadata (editable, or marked decorative), and insert it at the cursor as an `<img>` with the rendition URL and the alt text. Videos, audio, PDFs and other files are inserted as a link with the asset name.

Behind it, the per-extension **worker** (built from the #2 template, IMS-token-authenticated, CORS-restricted) holds the Cloudinary API key and secret as Worker secrets, calls Cloudinary's Search and Admin APIs server-side, maps the author's search and filters to a Cloudinary search expression in which user text can only ever be quoted literals, normalises results, builds rendition URLs from structured fields Cloudinary returns, and, when the site enables it, **signs those URLs server-side** so they work under strict transformations. To protect Cloudinary's Admin API quota (500 requests per hour on Free [VERIFIED: admin_api_overview.md]) the browser debounces search, page sizes are modest, and the worker caches results briefly and stops early when Cloudinary reports the quota is nearly spent. The browser only ever holds the author's own IMS token and normalised asset data, never the Cloudinary credential.

The shell is provider-agnostic. A **provider interface** defines identity and capabilities, the **credential kind** (`service` or `user-oauth`, with the members each kind must supply), browse/search, asset detail with renditions and metadata, and failure classes. A shared conformance suite enforces it for every provider and both kinds. This ticket fully builds the `service` kind (Cloudinary) and defines, validates and reserves the `user-oauth` kind; #25 turns that kind on (OAuth routes, token store, browser connect panel) without changing the interface or any browse code, and #22/#24 add one module each.

## User Stories

Content author (EW end user):

1. As a content author, I want the Multi-DAM Picker in my editor library, so that I can find it where I already insert content.
2. As a content author, I want Cloudinary assets to load as soon as I open the picker with no sign-in step, so that I am not asked for credentials I do not have.
3. As a content author, I want the most recently created assets shown before I search, so that the panel is useful immediately.
4. As a content author, I want to search by keyword (name, tag, folder, public ID, caption), so that I can find an asset without knowing where it lives.
5. As a content author, I want searching to start automatically after a short pause in typing (and Enter to search at once), so that I need no Search button and do not trigger a request per keystroke.
6. As a content author, I want multi-word searches to match assets that contain all the words, so that more words narrow the result.
7. As a content author, I want quotes, colons, asterisks, parentheses and other special characters in my search treated as plain text and never to cause an error or odd results, so that pasting a filename always works.
8. As a content author, I want a stale search never to overwrite a newer one, so that the grid always matches what I typed last.
9. As a content author, I want to filter by asset type (all, images, videos, documents, audio), so that I only see what I can use at my cursor.
10. As a content author, I want PDFs listed as documents and MP3s listed as audio even though Cloudinary stores them under "image" and "video", so that the type filter matches my expectation.
11. As a content author, I want to sort by newest, oldest, name or (when I searched) relevance, so that I can order the list the way I think about it.
12. As a content author, I want results as a thumbnail grid with the asset name, so that I can recognise assets at a glance.
13. As a content author, I want a "Load more" action instead of an unbounded list, so that the panel stays fast on a large library.
14. As a content author, I want to be told when I have reached the end of what the picker can show for a query (the first 500 matches) and be able to narrow the search, so that I am not left guessing why the list stopped.
15. As a content author, I want a larger preview with name, dimensions and file type, so that I can confirm it is the right asset.
16. As a content author, I want to choose a rendition (Web, Large, Medium, Small, or the original when displayable) with a sensible default, so that I never publish a multi-megabyte original by accident.
17. As a content author, I want renditions that never scale an image up, so that a small logo is not blurred into a big one.
18. As a content author, I want the inserted URL to work on the published page for anonymous visitors, including on a Cloudinary environment with strict transformations enabled, so that the image does not break after publish.
19. As a content author, I want the alt text prefilled from the asset's `alt` metadata, else its caption, else a cleaned-up name, and to see which source was used, so that accessible markup is the default.
20. As a content author, I want to edit the alt text or mark the image decorative (empty alt), so that I can fit it to the page.
21. As a content author, I want one click to insert the chosen rendition at the cursor and the library to close, so that I can keep editing.
22. As a content author, I want videos, audio, PDFs and other files inserted as a link with the asset name, so that non-image assets are not a dead end.
23. As a content author, I want assets visitors cannot load (access-controlled, rejected by moderation) marked not insertable with a one-line reason, so that I never publish a broken link.
24. As a content author, I want a plain message with the wait time when Cloudinary is rate-limiting, so that I know whether to retry now or later.
25. As a content author, I want a plain message (no stack trace, no credential hint) when the site's Cloudinary setup is broken, so that I know to ask the administrator.
26. As a content author, I want a clear message when no DAM is configured on this site, so that an empty panel is self-explanatory.
27. As a content author, I want the picker usable with the keyboard and a screen reader (labelled search field and filters, buttons for grid items, focus management), so that it works for everyone on the team.
28. As a content author, I want a clear "not running inside Experience Workspace" message if I open the page directly, so that a mis-opened URL is self-explanatory.
29. As a content author on a site with more than one DAM later, I want a source switcher that only appears when more than one is available, so that the UI stays simple for single-DAM sites.

Site administrator / maintainer:

30. As a site admin, I want to enable the picker with one `library` config-sheet row, so that adoption is copy-paste.
31. As a site admin, I want to enable Cloudinary by setting worker configuration and two secrets, with no change to browser code, so that adoption is a configuration step.
32. As a site admin, I want the README to list every setting (cloud name, API key and secret, API host, folder mode, root folder, alt-text keys, delivery hosts, signing switch, cache) and the Cloudinary-side prerequisites (where to find the key, strict transformations, folder mode), so that I can set it up without reading code.
33. As a site admin, I want to confine the picker to one Cloudinary folder and its subfolders, so that authors cannot browse assets outside what they should use.
34. As a site admin with strict transformations enabled, I want one switch that makes the worker sign every rendition URL, so that I do not hand-maintain an allow-list of transformations.
35. As a site admin, I want to choose which contextual-metadata key (and optionally which structured-metadata field) holds alt text, so that my existing alt-text practice works unchanged.
36. As a site admin on a private CDN or custom delivery hostname, I want to list my delivery hosts, so that the picker accepts my URLs and still rejects any other host.
37. As a site admin on the EU or AP data centre, I want to set the API host, so that calls go to my region.
38. As a site admin, I want the README to say plainly that every EW author who can reach the worker sees the same Cloudinary assets and what controls exist (root folder, client-id allow-list, `authorize` hook), so that I can decide whether that is acceptable.
39. As the maintainer, I want the Cloudinary key and secret to exist only in the worker's secret store and never in a response, header, log line or the browser, so that nothing sensitive is in the public site.
40. As the maintainer, I want every call to the worker rejected without a valid IMS token, so that the worker is not an open door to the product environment.
41. As the maintainer, I want signing done server-side with only the resulting signature leaving the worker, so that strict-transformations environments work without exposing the secret.
42. As the maintainer, I want to rotate the API secret with one documented command and no code change, so that a leak is a short fix.
43. As the maintainer, I want proof that user text cannot alter the structure of the Cloudinary search expression or the upstream path, so that the picker cannot be used to enumerate assets outside the intended scope.
44. As the maintainer, I want the shared Admin API quota protected by debounced search, modest page sizes, a short result cache and an early stop when the quota is nearly spent, so that a few busy authors cannot lock everyone out for an hour.
45. As the maintainer, I want the whole flow tested hermetically in CI against a fake IMS and a fake Cloudinary, plus recorded fixtures from a real sandbox so the fake matches reality, so that no credentials are needed on every push.
46. As the maintainer, I want unit tests for the core logic and lint and CI green on every push and PR, so that regressions do not merge.
47. As the maintainer, I want the extension listed in the root README extensions table, so that the repo stays a catalogue of what exists.
48. As the maintainer, I want all extension code in one self-contained folder with a README covering setup, the config-sheet row and the site config it reads, so that the extension can be moved or reviewed as a unit.

Provider author (later tickets #25, #22, #24):

49. As a provider author, I want one documented interface to implement for either credential kind, so that I know exactly what a DAM module must supply.
50. As a provider author, I want the shell to own authentication of the author, routing, validation, error mapping, caching, output URL policy, logging and the browser UI, so that I never touch security-critical plumbing.
51. As a provider author, I want capability declarations (asset types, sorts, result window) that drive the UI, so that a DAM with fewer features needs no browser change.
52. As a provider author, I want a conformance suite and fixture conventions that run against my module automatically, so that I can prove compatibility before manual testing.
53. As the author of #25 (Dropbox), I want the `user-oauth` members and the places the OAuth plumbing plugs in (connection state on the provider list, credential injection into provider calls, reserved routes and error classes) defined now, so that adding per-user OAuth is additive and does not change the Cloudinary module or the browse code.
54. As the author of #22 and #24 (Bynder, Frontify), I want to add a provider as one module plus one registry entry on top of #25's plumbing, so that no token-storage code is written again.
55. As a provider author, I want a repo check that fails when vendor-specific code leaks outside a provider's own folder, so that the shell cannot quietly become Cloudinary-only.

## Implementation Decisions

(No file paths or code, except tables where a shape carries a decision. Layout is in the Build Analysis.)

**D1. Surface: library plugin only, one extension, one worker.** Registered by one row in the site's `library` config tab (the #1 convention: the folder is `apps/multi-dam-picker/`, the type comes from the sheet row). No fullscreen app. All providers share the same page, the same browser code and the same worker; a provider adds server-side code only.

**D2. Build our own picker UI; do not embed Cloudinary's Media Library widget.** The widget (https://cloudinary.com/documentation/media_library_widget.md) loads third-party JavaScript into the page, requires each user to log in to Cloudinary with a seat licence, and can fail where third-party cookies are blocked [VERIFIED: that page]; its authentication happens in the browser, which contradicts AC2/AC8 (credentials held only by the worker), and it is Cloudinary-only, so it cannot be the provider-agnostic shell AC4 requires. Its upside is per-user Cloudinary permissions; that is a different design [OPEN: Question 6].

**D3. The provider interface (the AC4 deliverable).** A provider is a self-describing module owned by its own folder and registered by one registry entry. Members (behaviour-level; the exact field names are fixed by the contract tests):

| Half | Member | Required for | Meaning |
|---|---|---|---|
| Identity | `id` (lower-case slug), `label` | both | namespaces routes, config and cache; label is shown to authors |
| Identity | `credentialKind` | both | `service` or `user-oauth` (D4) |
| Capabilities | `assetTypes` | both | subset of image, video, document, audio the provider can filter by |
| Capabilities | `sorts` and `defaultSort` | both | provider-declared sort ids with labels; a sort may be flagged *requires a query* |
| Capabilities | `window` | both | the maximum number of results reachable per query (Cloudinary 500); the shell never asks beyond it |
| Capabilities | `assetIdPattern` | both | the shell validates every asset id against it before any provider call |
| Capabilities | `outboundHosts` | both | the list of hosts the provider may call; the shell's proxy pins calls to it |
| Capabilities | `deliveryHosts` (a function of config) | both | the hosts allowed in every URL the provider returns (D13) |
| Capabilities | `cacheSeconds` default | both | default result-cache lifetime; `0` disables (D17) |
| Config | required vars and secrets, optional vars and secrets with validators | both | a provider whose required items are absent is omitted, not fatal; invalid optional values fail registration naming the setting, never the value (D5) |
| Browse | `search(query, type, sort, page, pageSize)` | both | returns normalised summaries, `hasMore`, optional `total` |
| Browse | `getAsset(id)` | both | returns the normalised detail (renditions, alt candidate, insertable, link URL); may perform an idempotent provider-side effect (a documented, README-stated exception; none in this ticket) |
| Failure | failure classes | both | the provider reports failures as one of: bad request, not found, forbidden, rate limited (with a retry delay), misconfigured, upstream unavailable; `user-oauth` adds *reauth required* and *not connected* (D4) |
| Auth: `service` | credential application | `service` | the provider composes its own credential from the secret accessor and applies it to its outbound calls (Cloudinary: Basic) |
| Auth: `user-oauth` | `scopes`, `buildAuthorizeUrl(state, redirectUri)`, `exchangeCode(code, redirectUri)`, `refresh(refreshToken)`, `accountName(credentials)`, optional `revoke(credentials)`, optional maximum `state` length | `user-oauth` | pure HTTP mappings; the shell owns state sealing, cookies, token encryption and storage, refresh orchestration and credential injection into `search`/`getAsset` (D4) |

The shell owns everything else: author authentication (#2), routing, input validation, error mapping to the #2 error contract, the result cache, the output URL policy (D13), logging and redaction, and all UI. A provider never receives the IMS token and never reads raw storage; it is handed a per-call context (validated config, secret accessor, an outbound-call helper pinned to its `outboundHosts`, the injected clock, and for `user-oauth` the author's credentials). Registration is validated at worker start: a provider missing a required member, with a malformed id or id pattern, with a duplicate id, or declaring a credential kind this build cannot host fails the start with a message naming the provider and the member.

**D4. Two credential kinds are defined now; only `service` is hosted by this ticket.** `service` (Cloudinary) is fully built. `user-oauth` is **defined, validated and reserved**: its required members are part of the interface (D3) and the conformance suite validates a stub `user-oauth` declaration, but the worker core hosts only the kinds in a "hosted kinds" set, which is `{service}` in this ticket. Registering a `user-oauth` provider while the set lacks it fails fast at start ("credential kind not hosted by this build"), so a half-working OAuth provider can never ship. #25 adds `user-oauth` to the set together with: the worker routes (connect, session, disconnect, the two public OAuth browser routes), the encrypted token store, refresh orchestration and credential injection, and the browser connect/disconnect panel. The places it plugs in are fixed here so that it is additive:

- The provider list reports, per provider, `credentialKind` and a `connection` object with a `state` of `connected`, `not_connected` or `reauth_required` (plus an optional account label). `service` providers always report `connected`. The browser shell acts on `connected` only; for any other state it shows the provider as unavailable with a fixed notice (this branch is the single browser extension point that #25 replaces with the connect panel).
- The routes `/dam/{provider}/connect|session|disconnect` and `/oauth/{provider}/begin|callback` are **reserved and not routed** in this ticket (with the auth-first pipeline: no token gives `401`, a token gives `404`).
- The failure classes *reauth required* and *not connected* are reserved; no shell code path in this ticket emits them, so no new error codes are added to the #2 contract here.
- The result cache applies to `service` providers only (D17); #25 defines the per-user scope for `user-oauth` before enabling it there.
- The unauthenticated OAuth callback and the template gaps it needs (public routes with a custom authenticator, a storage binding, per-request dynamic redaction, HTML responses with custom headers) are **#25's**, not this ticket's; none is a prerequisite of #23.

[OPEN: Question 1: the owner's decision that #25 may add the OAuth host (routes, store, browser panel) to the shell, because #25's own acceptance criteria say "no changes needed in the shell beyond registering the provider" for the *provider*, while its first criterion set adds the provider-agnostic plumbing.]

**D5. Provider hosting rules (settled here so no later ticket must amend the shell).**
- *Config and secrets:* a provider's secrets are **optional at deploy time**: they are not listed in the wrangler `secrets.required` guard (a site using only Cloudinary must not have to set Dropbox's secrets) and the provider is omitted from the provider list, with its routes answering `404 not_found`, when a required var or secret is absent. The worker still starts. Invalid *optional* config (bad API host, bad root folder, bad renditions JSON, bad signing algorithm) fails the registration at start with a message naming the setting. [Needs template gap TG2, D22; the #2 `secrets.required` guard keeps protecting shell-owned secrets in #25.]
- *Thumbnails:* `thumbnailUrl` is optional on a summary (audio and raw files have none; the browser shows a file-type placeholder). When present it is an `https:` URL on a delivery host, or an inline `data:image/jpeg|png|webp;base64,...` URI of at most 64 KB (needed by Dropbox, which exposes no thumbnail URL; costs nothing before the shell is built). Nothing else is allowed in `thumbnailUrl`, and every other URL the shell returns is `https:` only [OPEN: Question 8: drop the data-URI allowance if the owner prefers #25 to ask for it].
- *Result window instead of cursors:* the shell's list call takes `page` and `pageSize` and returns `hasMore`; a provider declares a `window` (the largest result count it can reach) and emulates pages by fetching `page x pageSize` results and slicing. Cloudinary (500) and Dropbox (cursor-only) fit; Bynder (100,000) fits. A cursor on the wire is not added until a provider needs more than its window [OPEN: Question 9].
- *Sorts and types:* a provider may declare a subset of the four asset types and any list of sort ids; the browser builds its filter and sort controls from the declaration.
- *URL rule:* the **shell** never constructs or parses vendor URLs. A provider may build URLs only from the vendor's documented URL grammar and the structured fields its API returned (Cloudinary does so for renditions, D13), must never derive them from user input, and every URL it returns passes the shell's output policy (D13).

**D6. Auth model for Cloudinary: one service credential, HTTP Basic, held by the worker.** The worker calls `https://{api-host}/v1_1/{cloud_name}/...` with `Authorization: Basic base64(api_key:api_secret)` [VERIFIED: https://cloudinary.com/documentation/admin_api_overview.md, "Basic Authentication over secure HTTP" with the API key and secret from Console Settings > API Keys]. Both the key and the secret are Worker **secrets** (the key is an identifier, but AC2 says "API key/secret are held by the worker" and a secret keeps both out of `vars` and under the #2 hygiene check). The cloud name is a non-secret var (it is in every public delivery URL). The credential travels in the header, never in a URL (the documented `curl` form puts it in the URL userinfo; `fetch` does not use that). The inbound IMS token is never forwarded. The API host defaults to `api.cloudinary.com`; `api-eu.cloudinary.com` and `api-ap.cloudinary.com` exist for EU/AP data centres, a premium Enterprise feature [VERIFIED: admin_api_overview.md]; the host must be one of the three and is the only outbound host.

**D7. Authorisation reality (shared credential).** Every authenticated EW caller of the worker acts as the one Cloudinary credential, so Cloudinary's own per-user permissions do not apply (no per-user mechanism for the Admin/Search API was found in the docs read [ASSUMPTION it does not exist]). Controls the design provides: (a) an optional **root folder** ANDed into every search and checked on detail; (b) only the public `upload` delivery type is browsable (D8); (c) the template's IMS client-id allow-list and optional `authorize` hook (#2 Decision 6), which decide who may call the worker at all; (d) the README states the model in the first lines of the Cloudinary section. A per-user allow-list by IMS user id is a possible follow-up [OPEN: Question 3].

**D8. Only publicly deliverable assets are browsable.** The search expression always contains `type=upload` (the public CDN delivery type); `private` and `authenticated` delivery types need signed URLs for the original and (authenticated) every derivative, and a signed URL "doesn't prevent link sharing", so they are excluded rather than inserted [VERIFIED: control_access_to_media.md, "Restrictive delivery types"]. Within `upload` assets, one with a non-empty `access_control` (token or time-limited access) is returned but flagged not insertable with the reason "access-restricted in Cloudinary", and one whose `moderation_status` is `rejected` is likewise not insertable [ASSUMPTION: the field is present only when moderation is in use]. The older `access_mode` field is documented as "no longer supported" in favour of `access_control` [VERIFIED: search reference, Expression fields table], so it is not relied on. Assets with `status` other than active are not offered. The shell warning enum (limited-use, archived, watermarked) has no Cloudinary equivalent, so `warnings` is empty.

**D9. Search: POST with a JSON body to the Admin API search method; user text confined to quoted literals (the AC1 filter logic and the injection boundary).** Endpoint `resources/search` (Tier 1, on by default for environments under 10 million assets [VERIFIED: https://cloudinary.com/documentation/search_method.md]). The reference states "When making direct calls to the Cloudinary endpoint, make sure to pass any parameters using JSON (with `Content-Type: application/json`) as in the cURL examples", and those examples send `-d '{...}'` bodies (`curl -d` issues a POST) with `expression`, `sort_by`, `max_results`, `next_cursor`, `fields` [VERIFIED: admin_api_resources_search_for_resources.md, re-read 2026-11-16; the page's syntax line says `GET /resources/search`, so a GET variant is documented but unspecified: [ASSUMPTION] POST confirmed in sandbox, M1]. The template's proxy retries `POST` only on `429` by default, so the provider marks the read-only search as safe to retry on `5xx` through the template's explicit opt-in (#2 Decision 8).
- **Expression:** the AND of (1) always `type=upload`, (2) the root-folder clause when configured, (3) the type clause, (4) the keyword clause. *Keyword:* the user text is trimmed, limited to 200 characters and 8 words; every `"`, `\`, `*` and control character is replaced by a space (removed, not escaped, so nothing depends on escape semantics); each remaining word is wrapped in double quotes and the words joined with `AND` inside parentheses. This leans on the documented rule that inside quotes colons, parentheses and other reserved characters are literal and only `"` and `*` need escaping [VERIFIED: https://cloudinary.com/documentation/search_expressions.md]. *Type clause:* `image` = `resource_type=image` and not a document format; `video` = `resource_type=video` and not an audio format; `audio` = `resource_type=video` and an audio format; `document` = `format=pdf` or `resource_type=raw`; `all` = no clause. The audio and document format lists are provider constants [ASSUMPTION: audio = mp3, wav, flac, aac, m4a, ogg, oga, opus, aiff; reconciled against sandbox assets in M3]. The split exists because PDFs are stored as `image` and audio as `video` [VERIFIED: https://cloudinary.com/documentation/cloudinary_glossary.md, "Audio files and PDFs are NOT raw files"]. *Root clause:* `asset_folder` in dynamic folder mode (the exact folder or the prefix form), `folder` in fixed folder mode [VERIFIED field split: Expression fields table; `asset_folder` and `display_name` are "not supported" in legacy fixed folder mode]; the root is administrator configuration, validated at start against a conservative character set and escaped with the documented backslash rules for unquoted terms.
- **Sort:** `newest` omits `sort_by` (the default is descending creation date [VERIFIED]); `oldest` = `created_at` ascending; `name` = `public_id` ascending (the identifier, not the display name); `relevance` = `score` descending, accepted only with a keyword [VERIFIED for `score` and `sort_by` shape; the sortable-field list beyond the doc examples is unverified, M1].

**D10. Request and response size control.** The search request sends a `fields` list limited to what mapping needs: `public_id`, `asset_id`, `asset_folder`, `display_name`, `filename`, `format`, `resource_type`, `type`, `version`, `width`, `height`, `bytes`, `secure_url`, `created_at`, `uploaded_at`, `tags`, `context`, `access_control`, `moderation_status`, `status`. `fields` takes top-level attribute names, takes precedence over `with_field`, and `public_id`, `asset_id`, `asset_folder`, `created_at`, `status`, `type`, `resource_type` are always returned [VERIFIED: search reference]; that each listed name is honoured is confirmed in M1. The single-resource detail call has no `fields` parameter and returns "details on all derived assets" [VERIFIED: the by-asset-ID page], so its payload grows as renditions are generated; the mapper drops everything it does not allow-list. Raw Cloudinary payloads never cross to the browser: Cloudinary "may add more fields ... at any time" [VERIFIED: admin_api_overview.md], so mapping is allow-list based and forward compatible.

**D11. Asset identity and detail.** The shell id is Cloudinary's immutable `asset_id` (stable across rename and move, supported in both folder modes [VERIFIED: https://cloudinary.com/documentation/folder_modes.md]); the provider's `assetIdPattern` is 32 lowercase hex [ASSUMPTION universal; every documented sample id has that form]. Detail uses `GET resources/{asset_id}` [VERIFIED endpoint: the by-asset-ID page] because it is authoritative and immediate whereas search is eventually consistent ("within a few seconds" [VERIFIED]) and because the single-resource response carries structured `metadata` and `context` (the documented by-public-ID sample shows `context.custom.alt` and `caption` [VERIFIED on the by-public-ID page in the earlier research of 2026-11-16; the by-asset-ID response is assumed identical, ASSUMPTION; M1 records a real one]). Detail enforces the same scope as search: an asset whose delivery type is not `upload` or that sits outside the configured root returns `404 not_found`, never its data.

**D12. Result window and pagination.** The shell passes `page` and `pageSize` (default 24, cap 50). The provider requests `max_results = min(500, page x pageSize)` and returns the slice for that page; `total` = `total_count`; `hasMore` is true only while the end of the slice is below both `total_count` and the 500 window; a page whose first item would fall beyond the window is `400 bad_request`. [VERIFIED: `max_results` maximum 500, `next_cursor`, `total_count`.] Cost: one Admin API request per call, equal to cursor paging; the payload grows with the page number (trimmed by `fields`), and results can shift between calls because of eventual consistency, so the browser de-duplicates on append. The README says "browse shows the first 500 matches per query; refine with a keyword, type or folder".

**D13. Normalised asset contract, rendition construction and the shell's output URL policy.**
- *Summary:* `id`, `provider`, `name`, `type` (image, video, document, audio, other), optional `thumbnailUrl`, optional `width`, `height`, `extension`, `fileSize`, `dateModified`, `warnings[]`. *Detail* adds `description`, `tags[]`, `copyright`, `alt { value, source: property | description | name | none }`, `renditions[] { id, label, url, kind: derivative | original, width?, height? }`, `defaultRenditionId`, `insertable { ok, reason? }`, `linkUrl?` (non-image asset URL).
- *Cloudinary mapping:* `id` = `asset_id`; `name` = `display_name` in dynamic mode, else the last path segment of `public_id`; `type`: PDF (`resource_type=image`, format `pdf`) is `document`, `image` is `image`, `video` with an audio format is `audio`, other `video` is `video`, `raw` is `document` (or `other` for fonts and similar by a small format list); `extension` = `format`; `fileSize` = `bytes`; `dateModified` from `uploaded_at` when present (search returns `created_at` and `uploaded_at`). `copyright` is omitted (no native field).
- *Rendition grammar* [VERIFIED: https://cloudinary.com/documentation/image_transformations.md, "Transformation URL structure"]: `https://res.cloudinary.com/<cloud_name>/<asset_type>/<delivery_type>/<transformations>/<version>/<public_id>.<extension>`; transformations, version and extension are optional; chained steps are separated by `/`.
- *Method:* take the `secure_url` exactly as the API returned it, locate the first `/<resource_type>/<type>/` segment, require the remainder to begin with `v<version>/` and the public ID, and insert the transformation (and, when signing, the signature) between the delivery type and the version. If the URL does not match, the asset is not insertable with the reason "unrecognised Cloudinary URL". No public ID, cloud name or host is re-derived from user input or from other fields; only API-returned values are used.
- *Default set (images; administrator-overridable by a JSON list):* `web` (default) = scale down to at most 1200 px wide with automatic format and quality; `large` = 2000 px; `medium` = 800 px; `small` = 400 px; `original` = the returned `secure_url` unchanged, offered only for browser-displayable formats (jpg, jpeg, png, gif, webp, avif, svg). "Scale down only" is the `limit` crop mode ("Same as fit, but only scales down the image" [VERIFIED: https://cloudinary.com/documentation/resizing_and_cropping.md]); `f_auto` and `q_auto` are the documented optimisation transformations [VERIFIED: image_transformations.md]. Each rendition's reported dimensions are `min(asset width, rendition width)` with proportional height.
- *Non-image assets:* no transformation; `linkUrl` is the returned `secure_url` for videos, audio, PDFs and raw files; `renditions` is empty.
- *Thumbnails:* images get a fixed small `limit` rendition (320 px wide with `f_auto,q_auto` [ASSUMPTION: size]); videos use the same with a still-image extension; PDFs use the first page as an image; audio and raw files have none [ASSUMPTION: the video-poster and PDF-page URL forms are not stated in the pages read; confirmed in M3]. Thumbnails are signed like any transformed URL.
- *Output URL policy (shell-enforced, provider-agnostic):* after a provider returns, the shell drops every field outside the contract, requires every URL (renditions, `linkUrl`, `thumbnailUrl`) to be `https:` (thumbnails may also be the inline form of D5) and its host to be in the provider's `deliveryHosts(config)`; a violating rendition or link makes the asset not insertable with a fixed reason, a violating thumbnail is dropped. For Cloudinary the hosts are `res.cloudinary.com` plus the administrator's list (private CDNs and CNAMEs are a paid-plan feature [VERIFIED: pricing page lists "Custom domain (CNAME) support" on Advanced and above; image_transformations.md, "cloud_name" row]). This is what turns "a provider may construct URLs" (D5) into a safe rule.

**D14. Signed delivery URLs, generated server-side (AC2).** When `CLOUDINARY_SIGN_URLS` is on, every transformed URL (renditions and thumbnails) carries a signature component `s--<8 chars>--` immediately after the delivery type. The signature is the first 8 characters of the URL-safe base64 of the SHA-1 (or, when configured, SHA-256) digest of the string made of the transformation(s), public ID and extension joined with `/`, followed immediately by the API secret [VERIFIED: https://cloudinary.com/documentation/delivery_url_signatures.md, re-read 2026-11-16; the documented example `c_fill,w_300,h_250/e_grayscale/sample-authenticated.png` with secret `abcd` gives `iDy_JeBq` with SHA-1: a known-answer test vector, also recomputed independently]. Both SHA-1 and SHA-256 are accepted by default and an account can restrict itself to SHA-256 [VERIFIED], hence the algorithm switch. Why it is needed: with strict transformations enabled dynamic transformations are rejected unless eager, allow-listed, referral-domain based or signed [VERIFIED: control_access_to_media.md]. Why server-side: the secret "should never be generated on the client side" [VERIFIED: delivery_url_signatures.md]. The signed `original` URL is not altered (it carries no transformation).
- **Version handling (documented ambiguity).** The doc says the signed string contains "any transformation parameters, the version number, the public_id, and file extension that will be used in the delivery URL", yet its worked example has no version, and the SDK convention is to leave the version out [ASSUMPTION about the SDK]. To make both readings agree, **signed URLs omit the `v<version>/` segment** (so the signed string is exactly the documented example form); unsigned URLs keep the API's version. The rule is one provider constant covered by a test and confirmed against a strict-enabled environment in M6; fallback if M6 shows version-less URLs fail: include the version in the URL and in the signed string [OPEN: Question 5].
- **Percent-encoded public IDs.** How a public ID containing `%` (or other characters that need URL encoding) must be signed is not stated; when signing is on, such an asset is not insertable with a reason, until M6 settles it [ASSUMPTION].
- **Default off, guidance on.** `CLOUDINARY_SIGN_URLS` defaults to `false` until M6 proves the signing rule against a real strict-enabled environment; the README recommends `true` whenever strict transformations are on [OPEN: Question 5: flip the default after M6]. The signature is derived data that ends up in public page content by design; the secret and the digest input are never returned or logged.

**D15. Alt text policy (AC1 "alt text from asset metadata").** A ranked fallback returned with its source, mapped to the shell enum: (1) `property`: the contextual-metadata key named by `CLOUDINARY_ALT_CONTEXT_KEY` (default `alt`, Cloudinary's documented text-alternative field [VERIFIED: https://cloudinary.com/documentation/accessible_media_images.md]) or, when configured, the structured-metadata field `CLOUDINARY_ALT_METADATA_FIELD` (detail only: search returns `metadata` only on Tier 2 [VERIFIED: search reference, `with_field`]); (2) `description`: the contextual key `CLOUDINARY_CAPTION_CONTEXT_KEY` (default `caption`; documented as a conventional example key, [ASSUMPTION it is conventional rather than built-in]); (3) `name`: the display name or filename without extension, separators turned into spaces; (4) `none`: empty, flagged "needs alt text". The context object appears as `context.custom.<key>` in the documented single-resource sample; the mapper accepts both `context.custom.<key>` and `context.<key>` because the search response shape was not shown [ASSUMPTION, fixture-settled in M1]. All candidates are stripped to plain text (markup, entities and control characters removed, whitespace collapsed). The author always sees and may edit the value or mark the image decorative. Cloudinary's AI captioning add-on is out of scope.

**D16. Errors and limits (all mapped to the #2 error contract; fixed messages; no upstream text).** Cloudinary statuses: 200, 400, 401, 403, 404, 409, 420 [VERIFIED: admin_api_overview.md "Error handling"]. Mapping: `400` -> `400 bad_request`; `401` and `403` -> `500 misconfigured` with a log line naming the cause class only (the credential is shared, so the author cannot fix it and must not be invited to "reconnect"; Cloudinary notes HTML bodies on authentication problems [VERIFIED], so a non-JSON body on any status is never parsed and is treated as upstream failure); `404` on detail -> `404 not_found`; `409` -> generic `502`; `420` and `429` -> `429 rate_limited` with `Retry-After` computed from `X-FeatureRateLimit-Reset` (an HTTP date [VERIFIED headers: `-Limit`, `-Remaining`, `-Reset`]) minus now, at least 1 s, capped at 3600 s, 60 s when the header is absent; `5xx` and network errors -> the proxy's retries, then `502 upstream_unavailable`. A `420` is deliberately **not** retried by the proxy (the window is up to an hour, longer than the proxy's 8 s deadline).

**D17. Quota protection (AC3).** The Admin API allows **500 requests per hour on the Free plan and from 2,000 per hour on paid plans**, counted per request and shared by every author; search and detail each cost one request (a detail call with `versions=true` costs more and is never used) [VERIFIED: admin_api_overview.md, "Usage limits" and "How requests are counted"]. Four controls: (a) the browser **debounces** search (about 350 ms after the last keystroke, Enter searches immediately [ASSUMPTION: value]) and cancels a superseded request; (b) **modest page sizes**: default 24, hard cap 50, enforced by the shell for every provider; (c) a **short result cache in the shell**, default 30 s per provider (`CLOUDINARY_CACHE_SECONDS`, `0` disables), keyed by provider, the provider's configuration fingerprint (cloud name and root) and the full validated request (query, type, sort, page, page size); it applies to `service` providers only, where it is safe to share across authors precisely because every author sees the same data under the shared credential and scope; detail responses and errors are never cached; the cache is an optimisation, not a correctness feature, because isolates are short-lived and may be many, so the hit rate is best effort [ASSUMPTION; measured in smoke SM3]; (d) an **early stop**: the provider records `X-FeatureRateLimit-Remaining` and `-Reset` from each response and, when `Remaining` falls to the reserve (20 requests [ASSUMPTION: starting point]), answers the next calls with `429 rate_limited` until the reset time instead of spending the last requests. Thumbnails and renditions are delivered by the CDN and do not count against the Admin API limit [VERIFIED: the limit "refers only to Admin API requests"; delivery is not an Admin API request].

**D18. Insertion and experience.** Images: the browser builds one `<img>` with only `src` (the chosen rendition URL) and `alt`, serialises it with DOM APIs (never string concatenation), and sends it with `actions.sendHTML`, then `actions.closeLibrary`; non-images: a single `<a>` whose text is the asset name; only `https:` URLs are ever inserted. The SDK actions are fire-and-forget with no acknowledgement (verified in the SDK source in #1/#2), so "inserted" is shown optimistically and verified only in EW manually. [VERIFIED: https://da.live/nx/utils/sdk.js and https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/iframe-protocol.js, read in #1/#2; the host parses the HTML and inserts at the selection.] The detail preview shows the selected rendition URL, so the author sees exactly what will be inserted and the CDN is warmed. Default registration recommendation is `experience = fullsize-dialog` (a large grid and detail pane need room); the narrow inline layout (single-column responsive grid) must also work and is the documented fallback. `fullsize-dialog` appears in the da-live source (`helpers.js`) but is **not** in the public docs [OPEN: Question 4].

**D19. Browser to worker authentication and origin.** Every worker call carries `Authorization: Bearer <IMS token from the SDK>` (the #2 contract). The worker origin is a constant in the extension (loopback on `localhost`, the deployed origin elsewhere), never taken from the URL (the #2 Decision 13 rule; a test proves a `?worker=` parameter is ignored).

**D20. Worker API surface in this ticket (small, provider-namespaced).** `GET /dam/providers` (configured providers with credential kind, connection state, account label, capabilities), `GET /dam/{provider}/assets?q&type&sort&page&pageSize` (search), `GET /dam/{provider}/assets/{id}` (detail). The reserved routes of D4 are not routed. Errors reuse the #2 contract with no extension-defined codes in this ticket (an unknown or unconfigured provider is `404 not_found`). Full table in the Build Analysis.

**D21. Configuration split.** Non-secret vars: `CLOUDINARY_CLOUD_NAME` (required); `CLOUDINARY_API_HOST` (default `api.cloudinary.com`); `CLOUDINARY_FOLDER_MODE` (`dynamic` default, or `fixed`; accounts created after 2024-06-04 are dynamic, older ones may be fixed [VERIFIED: folder_modes.md]; the mode is read once by hand through the config endpoint [VERIFIED: https://cloudinary.com/documentation/admin_api_config.md], not at runtime, to spend no quota); `CLOUDINARY_ROOT_FOLDER` (optional); `CLOUDINARY_ALT_CONTEXT_KEY` (default `alt`); `CLOUDINARY_CAPTION_CONTEXT_KEY` (default `caption`); `CLOUDINARY_ALT_METADATA_FIELD` (optional); `CLOUDINARY_RENDITIONS` (optional JSON list overriding D13's defaults, validated at start against a conservative transformation-string character set, a maximum count and unique ids); `CLOUDINARY_SIGN_URLS` (`false` default); `CLOUDINARY_SIGNATURE_ALGORITHM` (`sha1` default or `sha256`); `CLOUDINARY_DELIVERY_HOSTS` (optional comma list); `CLOUDINARY_CACHE_SECONDS` (default 30). Secrets (secret store only): `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. The shell adds no vars or secrets in this ticket beyond the template's (`ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS`); no KV binding is used. The extension reads **no site config** except its own `library` row, and the README says so (AC5). Secret/var classification follows #2 Decision 7 and its UR3 check.

**D22. Template contract gaps this ticket depends on** (gathered so the owner can approve them as #2 additions, or accept this ticket carrying a thin wrapper that reuses the template's exported helpers). **TG1 (Basic credential and redaction):** the template's proxy `auth` injects one named secret; Cloudinary needs Basic from two secrets, and the composed header value is derived data that the #2 redaction (which replaces configured secret values) does not know. Preferred: an additive `basic` scheme in `proxy` taking two secret names and registering the composed value for redaction; fallback: the provider composes the header through the secret accessor and registers the composed value through a small per-request redaction hook. **TG2 (optional secrets):** a way to ask whether an optional secret is present without a `500 misconfigured` (D5), and `secrets.required` kept for shell-owned secrets only. **TG3 (prefix routes):** a route form that captures a path prefix and parameters (`/dam/{provider}/...`), or an explicit statement that the shell registers one catch-all and dispatches itself [ASSUMPTION: the template's "METHOD + path -> handler" declarations support path parameters; unknown]. None is a redesign of the template; the auth-before-routing order, CORS and error contract are used unchanged. [OPEN: Question 2.]

**D23. Tooling and conventions** follow #1/#2 unchanged and are pinned to upstream: ESLint 8 + helix config, Stylelint 16, `@web/test-runner` for browser unit tests, Node `node:test` for worker tests, Playwright (Chromium) for e2e, Node 22 (>= 22.12 for wrangler 4), husky. Tests live inside the extension folder; the provider's tests live under the provider folder.

**D24. Docs ship with the code (AC5, AC6).** The extension README covers: what it does and the shared-credential model; Cloudinary-side prerequisites (where to find the cloud name, API key and secret, folder mode, strict transformations and when to turn signing on, private CDN, data centre, Free-plan transformation credits); the exact vars/secrets table (name, kind, default, example); `wrangler secret put` commands; the exact `library` config-sheet row; the site config read (none, stated explicitly); local development; rate limits and the 500-result window; a privacy note (no per-user data stored in this ticket); the "add a provider" checklist (implement the interface for your credential kind, add fixtures, add the registry line, pass the suite, add a README section, add manual steps) and the hand-off contract for #25. The root README gets one extensions-table row (`multi-dam-picker`, folder, entry page, type `library plugin`, description).

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given an HTTP request to the worker (fake IMS, fake Cloudinary), assert the response, headers and the requests the fake Cloudinary received (method, path, JSON body, headers); given normalised data and an SDK result, assert what the DOM shows and which SDK actions fire. Never assert on internal helper names or call counts of internal functions. Properties asserted as negatives across every path: **no Cloudinary key, secret, Basic value or signature material ever reaches a response, log line or the browser**, **nothing runs before authentication succeeds**, and **no user-supplied byte can alter the structure of the Cloudinary search expression or the upstream path**.

**Proposed seams** (recorded here instead of asked, per #61). Existing seams from #1/#2 are reused; one new seam is added because AC4 is otherwise unverifiable and because the same seam will carry every later DAM.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 (primary) | The worker's HTTP boundary: `worker.fetch(request, env, ctx)` | reused from #2 | Node unit tests for routes, validation, output policy, errors, cache, and the Cloudinary provider (query build, mapping, renditions, signing, limits, security) | Constructed `Request`s; the #2 test kit (`makeEnv`, `fakeIms`, `signToken`, `fakeUpstream`, canaries); **new double `fakeCloudinary(script)`**: a scripted upstream that checks the Basic header, records every request (method, path, headers, JSON body) and replays recorded fixtures, `420`s, HTML `401` pages and malformed bodies |
| P1 (**the one new seam**) | The provider interface: the shell registry plus a shared conformance suite | new | Contract tests run once per registered provider and once per credential kind (`service` real, `user-oauth` as a declaration-only stub); later vendors get them for free | Recorded Cloudinary responses sanitised from a real sandbox, replayed by `fakeCloudinary`; stub providers (a second `service` provider, a `user-oauth` declaration) prove "add a module only" without shell changes |
| S2 | Browser render/logic module + SDK result | reused from #1 | `@web/test-runner` tests for the picker UI | Hand-built SDK result; injected `fetch` standing in for the worker; fake timers |
| S1 | Entry HTML page + SDK module boundary, against a real local worker | reused from #1/#2 | Playwright e2e | #1 SDK stub (`sendHTML`/`closeLibrary` call log); real worker under `wrangler dev`; fake IMS and `fakeCloudinary` as throwaway Node servers; the browser harness answers delivery-host image requests |
| W2 | The same worker in the real workers runtime over HTTP | reused from #2 | Smoke tier | `wrangler dev` local, no Cloudflare login |
| S3 | Repo convention check | reused from #1/#2, extended | CI lint job | Filesystem fixtures in a temp dir |

The real EW boundary (real Adobe IMS login, real Cloudinary environment, real library iframe, real editor insertion, real CDN behaviour under strict transformations) is covered only by numbered manual verification steps.

**Modules tested:** provider registry and conformance suite; shell routes, validation, output URL policy, error mapping and result cache; Cloudinary provider (expression builder, window pagination, mapping, rendition and thumbnail builder, signed-URL generator, alt chain, error and quota mapper, config validation); browser picker (providers, search, debounce, filter, sort, paging, detail, insert, states, accessibility); repo convention additions.

**Prior art:**
- `shared/worker-template/SPEC.md` (#2): the test kit and the UA/UC/UP/US/UK families, which apply to this worker automatically and are not repeated.
- `apps/hello-world/SPEC.md` (#1): the SDK stub, S1/S2 patterns, the HP worker-call tests, the S3 convention check.
- Upstream `adobe-rnd/ew-extensions`: no worker, OAuth or DAM code; injection-style seams (`fetchImpl`, `storage`, `now`) in `tools/brand-visibility/session-auth.js`. Adobe's own AEM Assets picker in da-live (`blocks/canvas/ew-panel-extensions/aem-assets.js`) uses Adobe's asset selector and the user's IMS token directly rather than a worker, so it is a UX reference only.
- Cloudinary's own documentation supplies a **known-answer vector** for URL signatures, used as a test.

## Out of Scope

- **Per-user OAuth for any provider** and everything it needs: connect/disconnect UI, the OAuth begin/callback routes, state and ticket sealing, the encrypted token store, refresh orchestration, Workers KV, per-request dynamic redaction (all #25). Only the interface members, the reserved wire fields and the fail-fast hosting rule are built here (D4).
- Dropbox, Bynder and Frontify providers (#25, #22, #24).
- Uploading to Cloudinary, editing or tagging assets, deleting, folder management, collections, usage reports, the upload widget, usage tracking back to the DAM.
- Embedding Cloudinary's Media Library widget (D2).
- `private` and `authenticated` delivery types, token-based and cookie-based access (premium) and any URL that expires; signing of protected assets.
- Dynamic transformations beyond the configured fixed set (crops, overlays, effects, art direction, responsive `srcset`, `dpr_auto`), adaptive video streaming, video players, 3D, remote fetch delivery types. Automating Cloudinary's strict-transformations allow-lists or named transformations (signing is the supported route; the admin-managed alternatives in control_access_to_media.md are documentation only).
- Visual search, AI captioning, Tier 2 search features (aggregations, embedded metadata search), structured-metadata search and facets, multi-select, saved searches.
- Per-user Cloudinary permissions, per-user quota enforcement, user allow-lists (follow-up), multiple Cloudinary environments per site, runtime folder-mode detection, cursor (unbounded) paging on the wire (D5).
- CI-driven deployment, a custom worker domain, Durable Objects (as in #2).
- AEM Assets (first-party), the EW trust-prompt flow, marketplace publishing, i18n of the UI, offline use.
- The Adobe outside-activity/IP policy decision and the data-protection review for holding a production-capable media credential in a Cloudflare account under a personal name (flagged; owned by #1 R1 and #2 R1).

## Further Notes

- **Docs say nothing about third-party pickers or backends in EW.** The cited EW developer doc (https://www.aem.live/docs/ew/developing/apps-plugins) documents the SDK, `sendText`, `sendHTML`, `closeLibrary` and the config rows; nothing on workers, OAuth or DAMs [VERIFIED in the #1/#2 research, 2026-11-16]. All EW-side design derives from the SDK and library source.
- **Why Cloudinary goes first.** Its Free plan is self-serve ("Free forever", "No credit card required", 3 users, 25 monthly credits [VERIFIED: https://cloudinary.com/pricing]) and includes "Upload widget, API, and search". The OAuth DAMs need either an enabled portal (Bynder: Customer Support must enable OAuth Apps) or a developer app review path. Cloudinary also needs no token store, so the shell can be built and proven before the harder plumbing.
- **What differs between credential kinds, in one table.**

  | Concern | `service` (Cloudinary, this ticket) | `user-oauth` (Dropbox #25, then Bynder #22, Frontify #24) |
  |---|---|---|
  | Who authenticates | the worker, with one key/secret for everyone | each author, via an OAuth pop-up |
  | Who sees what | everyone sees the same assets, scoped by root folder and `upload` type | each author's own DAM permissions |
  | Sign-in UI | none; grid loads at once | connect/disconnect panel (#25) |
  | Stored by the worker | nothing (secrets only) | encrypted per-user tokens (#25) |
  | Result cache | shared across authors | per-user scope, defined by #25 |
  | Failure classes | misconfigured on `401`/`403` | reauth required, not connected (reserved) |

- **Free-plan transformation credits.** A new derived asset (a new transformation URL) counts one transformation the first time it is generated; repeated requests to the identical URL are not counted again [VERIFIED: https://cloudinary.com/documentation/transformation_counts.md]. One credit equals 1,000 transformations [VERIFIED: pricing page], so the Free plan's 25 monthly credits cover about 25,000 new derived assets. Every previewed thumbnail and every inserted rendition is one such asset on first view; the design keeps one thumbnail size and a short fixed rendition list so browsing does not explode the count, and the README says so.
- **Search latency and consistency.** Search is eventually consistent (seconds): a just-uploaded asset may be missing briefly; detail by `asset_id` is immediate. The type clauses use negation for the image and video filters, and Cloudinary warns that `NOT`/`-` "can lead to significant latency on large repositories" [VERIFIED: search_expressions.md]; large environments are timed in the sandbox (R8).
- **Embedded-URL longevity.** Inserted URLs reference Cloudinary: deleting an asset breaks the page; renaming or moving does not change the public ID or delivery URL in dynamic folder mode but does in fixed mode [VERIFIED: folder_modes.md]. One README sentence: pickers insert references, not copies.
- **Library iframe and policies.** In the da-live code paths that create plugin iframes the iframe carries no `sandbox` attribute [VERIFIED in the #1/#2 research]; this ticket opens no pop-up, so that fact matters to #25, not here.
- **EDS and external images.** Whether Edge Delivery Services keeps an external `<img src>` from a DA document untouched on publish is [ASSUMPTION it is kept]; checked in manual step M5.
- **Template and scaffold are not built yet.** `shared/worker-template/` and `apps/hello-world/` hold only their specs. Everything that says "the template provides" presumes #2 has landed as specified plus TG1-TG3 (D22).

---

# Build Analysis

## 1. Architecture and responsibilities

```
EW editor (da.live)                                         Cloudinary product environment
 └─ library iframe: apps/multi-dam-picker (static, public)    https://{api-host}/v1_1/{cloud_name}/...   Admin/Search API, Basic auth
      │ SDK handshake -> { token (IMS), context, actions }      ▲
      │ fetch(worker, Authorization: Bearer <IMS>)              │ one service credential (API key + secret)
      ▼                                                         │
 Cloudflare Worker (apps/multi-dam-picker/worker; core from shared/worker-template; ONE worker for all providers)
   1 origin gate -> 2 IMS token check -> 3 router -> 4 shell routes (/dam/providers, /dam/{provider}/assets[/{id}])
        -> validation -> cache -> 5 provider module (providers/cloudinary) -> 6 proxy(retries) ──┘
        -> output URL policy -> normalised JSON
   secrets: CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.  No KV, no OAuth routes in this ticket.
   CDN (res.cloudinary.com or the site's private CDN): contacted only by browsers (authors' thumbnails, visitors' pages), never by the worker.
```

| Concern | Browser extension (static, public) | Worker (private runtime) |
|---|---|---|
| Cloudinary API key and secret | never | only place (secret store); used for Basic auth and URL signing |
| Author identity | gets the IMS token from the SDK and sends it | verifies it; gates access (client-id allow-list, optional `authorize`) |
| Search expression | sends `q`, `type`, `sort`, `page`, `pageSize` | builds the Cloudinary expression; the only place user text meets the vendor query language |
| Result shaping | renders normalised assets | normalises, maps types, builds and signs rendition URLs, computes the alt candidate, enforces the output URL policy |
| Quota protection | debounce, cancel superseded requests, honour `Retry-After` | page-size cap, short cache, `420` mapping, early stop when the quota is low |
| Insertion into the document | all (`sendHTML`, `closeLibrary`) | none |
| Provider knowledge | generic: driven by the provider list and capability declarations | provider modules (Cloudinary first) |

## 2. EW integration points

- **Library plugin vs app:** library plugin. One row in the site's `library` config tab (columns per https://www.aem.live/docs/ew/administering/set-up-library; behaviours from https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/helpers.js, as established in #1):

  | `title` | `path` | `format` | `ref` | `icon` | `experience` |
  |---|---|---|---|---|---|
  | `Multi-DAM Picker` | `/apps/multi-dam-picker/multi-dam-picker.html` | (blank) | (blank for main; a branch name for branch testing) | (optional) | `fullsize-dialog` (recommended, [OPEN]) or blank (`inline`) |

  `path` starting with `/` resolves to `http://localhost:3000{path}` when the editor URL has `?ref=local`, else to `https://{branch}--{site}--{org}.aem.live{path}`; the row's `ref` column filters; `experience` defaults to `inline`. Do not use a reserved library title (`blocks`, `templates`, `icons`, `placeholders`, `aem-assets*`).
- **SDK actions used:** `actions.sendHTML(html)` (an `<img>` or `<a>`), `actions.closeLibrary()`; `token` (the worker bearer); `context` is not needed. No `daFetch`.
- **Registration of providers:** none in EW. Cloudinary appears in the existing panel when its worker configuration is present; no new config-sheet row per provider.
- **`ref=local`:** page `http://localhost:3000` (#1 server) + worker `http://localhost:8787` (`wrangler dev`) with the Cloudinary secrets in the untracked `.dev.vars`; non-secret overrides come from a wrangler environment's `vars` (#2 R8: when `secrets` are declared only those keys are read from `.dev.vars`; here the Cloudinary secrets are optional and not declared, so `.dev.vars` is read in full [ASSUMPTION; SM1 proves it]).
- **Branch ref / main:** pages on `*.aem.live` or `*.preview.da.live` call the deployed worker (`workers.dev` URL, a constant in the extension). The author's browser also loads delivery images from `res.cloudinary.com` (or the private CDN); whether the EW editor frame restricts `<img>` hosts is not documented [ASSUMPTION none; observed in M2].
- **Site config read:** none beyond the library row (README states it).

## 3. External APIs and auth flows

All Cloudinary calls go to `https://{api-host}/v1_1/{cloud_name}/...`, `api-host` default `api.cloudinary.com`, with HTTP Basic (API key as user, API secret as password) [VERIFIED: https://cloudinary.com/documentation/admin_api_overview.md].

| API | Use | Auth | Source / status |
|---|---|---|---|
| `resources/search` (JSON body: `expression`, `sort_by`, `max_results` <= 500, `fields`; `next_cursor` unused) | browse and search | Basic | [VERIFIED params and JSON-body examples] https://cloudinary.com/documentation/admin_api_resources_search_for_resources.md; POST vs GET [ASSUMPTION, M1] |
| `GET resources/{asset_id}` | asset detail: `context`, structured `metadata`, URLs | Basic | [VERIFIED endpoint] https://cloudinary.com/documentation/admin_api_resources_get_details_of_a_single_resource_by_asset_id.md; response shape from the by-public-ID sample [ASSUMPTION identical] |
| `GET config?settings=true` | folder mode (dynamic/fixed) | Basic | [VERIFIED] https://cloudinary.com/documentation/admin_api_config.md; used by hand during setup (README, M1), not at runtime |
| `GET ping` | reachability | Basic | listed in the Admin API index [VERIFIED listed]; manual use only; whether it counts toward the quota is [OPEN] |
| CDN delivery (`res.cloudinary.com` or a private CDN) | rendition and thumbnail display by browsers | none, or a signature in the URL | [VERIFIED structure] https://cloudinary.com/documentation/image_transformations.md; signature https://cloudinary.com/documentation/delivery_url_signatures.md |

Limits [VERIFIED: admin_api_overview.md]: Free plan 500 Admin API requests per hour, paid plans from 2,000; each request counts one; the Upload API is not rate-limited (not used); headers `X-FeatureRateLimit-Limit`, `-Remaining`, `-Reset` on every Admin API response; status `420` = rate limited. Search is Tier 1 by default; `metadata` in search results is Tier 2 only.

**Auth flow (author to worker):** SDK token -> `Authorization: Bearer` -> #2 verification -> `identity.userId` (used for logging and the optional `authorize` hook only; not for the Cloudinary call).
**Auth flow (worker to Cloudinary, per call):** secret accessor -> Basic header (composed value registered for redaction, TG1) -> proxy to the pinned API host -> parse only if JSON -> normalise -> output URL policy -> respond. No token exchange, refresh, state, cookie or storage.
**Signing flow (rendition URLs):** API-returned `secure_url` -> locate the delivery-type segment -> choose the transformation -> if signing is on: digest(`<transformation>/<public_id>[.<ext>]` + secret) -> first 8 URL-safe base64 characters -> insert `s--sig--` and the transformation, drop the version -> https and delivery-host check -> include in the normalised asset.

## 4. Data contracts

Behaviour contracts, not code.

**Worker API (all `Authorization: Bearer <IMS>`; JSON; CORS and errors per #2):**

| Method + path | Purpose | Success | Notable errors |
|---|---|---|---|
| `GET /dam/providers` | configured providers with credential kind, connection state, capabilities | `200 { providers: [{ id, label, credentialKind, connection: { state, account? }, capabilities }] }` (Cloudinary: `connected`, account label = cloud name) | |
| `GET /dam/{provider}/assets?q&type&sort&page&pageSize` | search | `200 { items, page, pageSize, total?, hasMore }` | `400 bad_request`, `404 not_found` (unknown or unconfigured provider), `429 rate_limited` (+ `Retry-After`), `500 misconfigured`, `502 upstream_unavailable` |
| `GET /dam/{provider}/assets/{id}` | detail with renditions and alt candidate | `200 { asset }` | as above plus `404 not_found` |
| (reserved, not routed) `POST /dam/{provider}/connect`, `GET .../session`, `POST .../disconnect`, `GET /oauth/{provider}/begin`, `GET /oauth/{provider}/callback` | #25 | none in this ticket | `401` without a token, `404` with one |

**Provider capabilities (Cloudinary):** `assetTypes = [image, video, document, audio]`; `sorts = newest (default), oldest, name, relevance (requires a query)`; `window = 500`; `assetIdPattern = 32 lowercase hex`; `outboundHosts = [api host]`; `deliveryHosts = res.cloudinary.com + configured hosts`; `cacheSeconds = 30`.

**Query rules (shell, all providers):** `q` <= 200 characters; `type` in the provider's `assetTypes` or `all`; `sort` in the provider's `sorts` (a sort that requires a query without one is `400`); `page` >= 1; `pageSize` 1-50 (default 24); `page x pageSize` beyond the provider's window is `400`; any rejection makes zero upstream calls.

**Upstream request (Cloudinary search):** `{ expression, sort_by?, max_results, fields }`, `Content-Type: application/json`, `Authorization: Basic ...`; no other header forwarded. **Expression grammar produced** (illustrative strings): `type=upload`; with a root: `AND (asset_folder=<root> OR asset_folder:<root>/*)`; type image: `AND resource_type=image AND NOT format=pdf`; keyword: `AND ("word1" AND "word2")`.

**Rendition table (defaults, overridable by `CLOUDINARY_RENDITIONS`):**

| id | label | transformation | applies to |
|---|---|---|---|
| `web` (default) | Web, up to 1200 px | `c_limit,w_1200/f_auto/q_auto` | images |
| `large` | Large, up to 2000 px | `c_limit,w_2000/f_auto/q_auto` | images |
| `medium` | Medium, up to 800 px | `c_limit,w_800/f_auto/q_auto` | images |
| `small` | Small, up to 400 px | `c_limit,w_400/f_auto/q_auto` | images |
| `original` | Original file | none (the returned `secure_url`) | browser-displayable image formats only |

The strings use the documented `limit` crop, width and automatic format/quality parameters; whether a single component (`c_limit,w_1200,f_auto,q_auto`) or chained components is preferable matters only for allow-listing on strict accounts that do not sign, and is settled in M6 [OPEN: Question 7].

**Normalised asset, capabilities, errors:** as D13, D3 and D16. The error shape is the #2 contract `{ error: { code, message, requestId } }`; messages are fixed strings.

**Worker configuration:**

| Name | Kind | Meaning |
|---|---|---|
| `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS` | var (from #2) | origin gate and IMS verification |
| `CLOUDINARY_CLOUD_NAME` | var, required | product environment; appears in public URLs |
| `CLOUDINARY_API_HOST` | var, optional | one of the three documented hosts |
| `CLOUDINARY_FOLDER_MODE`, `CLOUDINARY_ROOT_FOLDER` | var, optional | `dynamic`/`fixed`; scope root |
| `CLOUDINARY_ALT_CONTEXT_KEY`, `CLOUDINARY_CAPTION_CONTEXT_KEY`, `CLOUDINARY_ALT_METADATA_FIELD` | var, optional | alt-text sources (D15) |
| `CLOUDINARY_RENDITIONS`, `CLOUDINARY_DELIVERY_HOSTS` | var, optional | rendition list override; extra delivery hosts |
| `CLOUDINARY_SIGN_URLS`, `CLOUDINARY_SIGNATURE_ALGORITHM` | var, optional | signing switch and digest |
| `CLOUDINARY_CACHE_SECONDS` | var, optional | result cache lifetime |
| `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | **secret**, required for the provider | Basic credential and signing secret; not under `secrets.required` (D5) |

A provider is "configured" when all its required items are present; the provider list is built from that.

## 5. Folder layout (proposed; fits #1/#2)

```
apps/multi-dam-picker/
├─ SPEC.md                         this file
├─ README.md                       setup, Cloudinary-side setup, config-sheet row, site config read (none), local dev, privacy, add-a-provider checklist
├─ multi-dam-picker.html           entry page (SDK script tag + extension script)
├─ multi-dam-picker.js             bootstrap: await SDK, wire the render/logic modules
├─ multi-dam-picker.css
├─ config.js                       constant worker origin(s): loopback on localhost, deployed origin otherwise (#2 Decision 13)
├─ picker/                         side-effect-free logic + render (state machine, API client, insertion builder)   <- S2 seam
├─ test/unit/*.test.js             WTR tests (S2); test/e2e/*.spec.js Playwright (S1)
├─ worker/                         scaffold from shared/worker-template; the extension's worker entry (one provider registry line per provider)
│   ├─ src/shell/                  registry + interface validation, routes, validation, output URL policy, error mapping, result cache
│   ├─ wrangler config, .dev.vars.example, README, test/ (W1 tests, P1 conformance suite, stub providers)
│   └─ test/fixtures/              shared recorded responses used by the conformance suite
└─ providers/
    └─ cloudinary/                 vendor code (#1: providers/<vendor>/)
        └─ worker/                 Cloudinary provider module (#2 Decision 3), its fixtures (with a recording README), tests, fakeCloudinary
```

Later DAMs add `providers/<vendor>/worker/` plus one registry line. `.hlxignore` hides `**/worker/` and `**/test/` from the code bus (per #1/#2). [OPEN, carried from #2 Question 3: confirm the `providers/<vendor>/worker/` refinement.] The old `providers/cloudinary/SPEC.md` is superseded by this file and is deleted by the owner.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Shared credential: every EW author who can reach the worker sees the same Cloudinary assets** and can drive the quota. Policy, not a bug. | High (policy) | Root folder, `upload`-only, client-id allow-list, `authorize` hook; README states the model first; per-user allow-list as a follow-up [OPEN Q3] |
| R2 | **Signing rule uncertainty** (doc says the signed string includes the version if used in the URL; the example omits it; percent-encoded public IDs unspecified). A wrong rule breaks every signed URL on strict accounts. | High for AC2 | Drop the version segment from signed URLs, known-answer test, default off until M6 proves it on a strict-enabled environment; decision gate in the build plan |
| R3 | **Admin API quota 500/h (Free), shared.** Search plus detail per author action. | Med-High | Debounce, page cap, shared cache, early stop, `Retry-After` UX (D17); M10 observes real consumption |
| R4 | **Search expression injection** via user text. | High | Remove-then-quote construction, fixed prefix, fuzz corpus, parenthesis/quote balance test (CQ3-CQ4, CQ10, CX1) |
| R5 | **Template gaps TG1-TG3** (Basic credential redaction, optional secrets, prefix routes). | High for scheduling | Approve as #2 additions or carry a thin wrapper reusing exported helpers [OPEN Q2] |
| R6 | **Interface drift for #25:** the `user-oauth` members are defined from vendor documentation and validated only by a stub; the real needs surface when Dropbox is built. | Medium | The conformance suite is the contract; #25 may extend it additively; members cover the known needs (outbound host list, id pattern, failure classes, state-length limit, inline thumbnails); owner confirms the split [OPEN Q1] |
| R7 | **Free-plan transformation credits** (25 credits ~ 25,000 new derived assets/month) consumed by thumbnails and renditions. | Medium | One thumbnail size, short rendition list, README note; counting rule [VERIFIED] |
| R8 | **Search latency of negation** on large environments; **eventual consistency**. | Low-Med | Type clauses timed in the sandbox; detail by `asset_id` is immediate; browser de-duplicates |
| R9 | **Undocumented search details:** POST accepted (documented via cURL examples), the `context` shape in search results, accepted `fields` names, sortable fields beyond examples. | Medium | M1 sandbox contract checks first; fixtures recorded from them; mapper tolerates both context shapes |
| R10 | **Folder mode:** `asset_folder`/`display_name` unsupported in legacy fixed mode; the name sort uses the public ID. | Low-Med | `CLOUDINARY_FOLDER_MODE`, README check via the config endpoint, tests for both |
| R11 | **Public IDs needing URL encoding** under signing; **delivery host/CNAME** accounts. | Low-Med | Not insertable with a reason when signing; `CLOUDINARY_DELIVERY_HOSTS`; M6 |
| R12 | **Editor schema behaviour** for `sendHTML('<img src alt>')` (kept attributes, wrapping). | Medium | M2 inspects the document source; fall back to `<p><img></p>` if needed |
| R13 | **External image URLs on publish** may be rewritten or dropped by EDS. | Medium | M5 publish round trip [ASSUMPTION kept] |
| R14 | **`fullsize-dialog` undocumented** and may change. | Low-Med | Layout works inline; README documents both rows [OPEN Q4] |
| R15 | **IMS client id / `user_id` unverified** against a real token (#2 R3/R4); a pure signature check lets any Adobe user call the worker. | Medium | Client-id allow-list after inspecting a real token (#2 W2); `authorize` hook; M8 |
| R16 | **Workers Free CPU (10 ms) and subrequests** with a 500-item response to parse and normalise. | Low-Med | `fields` trims the payload; page cap; SM2 records CPU/wall; Paid plan is an owner decision |
| R17 | **Cloudinary API drift** (new fields; `access_mode` already deprecated). | Low | Allow-list mapping; recorded fixtures; conformance suite |
| R18 | **Policy:** a production-capable media credential in a Cloudflare account under a personal name (carries #1 R1, #2 R1). | High (policy) | README note; owner decides the account before real credentials are stored [OPEN Q10] |
| R19 | **Pages shift between window-emulated calls** (no stable cursor). | Low | De-duplicate on append; documented |

## 7. Ordered build plan (sized to #23's acceptance criteria)

0. **Prerequisites (owner):** #1 and #2 landed; decisions on Open Questions 1-3 and 10 (shell split, template gaps, shared-credential model, account); a Cloudinary Free-plan environment (and a second one with strict transformations on) with test assets; a Cloudflare account. Without the sandbox, steps 2-8 proceed against fakes but fixtures are hand-written.
1. **Sandbox contract checks (M1) first:** settle POST vs GET, accepted `fields`, the `context` shape in search, sortable fields; **signing rule on the strict environment (M6 subset)**: this is a decision gate before step 5 builds the signer. Record sanitised fixtures.
2. **Template gaps TG1-TG3** landed in #2 (or a thin wrapper agreed); one new test per gap.
3. **Test kit extensions (the seam):** `fakeCloudinary`, the stub providers (a second `service` provider; a `user-oauth` declaration), the fixture loader. Self-check tests.
4. **Provider interface + registry + conformance suite (P1), test-first** (AC4): PC1-PC8 against the stubs first.
5. **Shell routes and policies, test-first** (AC3, AC4, AC8): SH1-SH12 (list, validation, window, output URL policy, error mapping, cache, auth-first).
6. **Cloudinary provider, test-first** (AC1, AC2, AC3): CQ (expression), CS/CM (calls, mapping), CR (renditions, known-answer signature first), CT (alt), CE (errors, quota early stop), CX (security).
7. **Browser picker, test-first** (AC1, AC3 browser half): UI1-UI16.
8. **Entry page, CSS, config constant, extension README, root README row** (AC5, AC6).
9. **Playwright e2e** (E2E1-E2E10) with fake IMS and fake Cloudinary against the real local worker; **runtime smoke** (SM1-SM3).
10. **Repo checks and CI** (AC9): RC1-RC6; add jobs to the #1/#2 workflow; no secrets in CI.
11. **Deploy the worker, set the two secrets, add the `library` row; manual verification M0-M12** (AC2, AC6, AC7, AC8); record observed `Origin`, real alt field shape, signed-URL behaviour and the EDS publish result in the PR and README.
12. **Hand-off for #25/#22/#24:** README "add a provider" checklist and the contract of D4 (provider-list wire fields, reserved routes and failure classes, credential injection point, cache scope rule, browser extension point).

---

# Testing Requirements

Template-provided tests (UA authentication matrix, UC CORS matrix, UP proxy/retry matrix, US secret hygiene, UK kit self-check) run unchanged for this worker; the IDs below are additional. ID prefixes: SH = shell worker, PC = provider contract, CQ = Cloudinary query, CS = Cloudinary calls, CM = mapping, CR = renditions and signing, CT = alt text, CE = errors and quota, CX = security, UI = picker UI, E2E, SM = smoke, RC = repo check, M = manual.

## 1. Worker unit tests (seams W1, P1; Node built-in runner)

Fixtures/mocks: the #2 test kit (`makeEnv`, `fakeIms`, `signToken`, canaries); `fakeCloudinary(script)` recording every request (method, path, headers, JSON body) and replaying recorded fixtures (image, PDF-as-image, MP3-as-video, MP4, raw docx, font, access-controlled, moderation-rejected, no-`display_name` fixed-mode, context variants `context.custom.alt` and `context.alt`, empty and null fields, 420 with rate headers, HTML 401, malformed JSON); stub providers (a second `service` provider; a complete and an incomplete `user-oauth` declaration); canaries for `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` and the composed Basic value; injected `now`, `sleep`, `random`.

### 1.1 Shell routes, validation, output policy, cache (AC1, AC3, AC4, AC8; seam W1)

| ID | Behaviour asserted |
|---|---|
| SH1 | `GET /dam/providers`: no token -> `401`; valid token -> `200` listing only configured providers, each with `id`, `label`, `credentialKind`, `connection.state = connected` (service), account label, capabilities; response contains no secret or config value other than the cloud name |
| SH2 | Auth before routing on `/dam/*`: any path without a token -> `401` (including unknown ones); with a token, unknown -> `404 not_found`; the reserved routes (`/dam/cloudinary/connect`, `/dam/cloudinary/session`, `/dam/cloudinary/disconnect`, `/oauth/cloudinary/begin`, `/oauth/cloudinary/callback`) give `401` without and `404` with a token |
| SH3 | `{provider}` validated against the registry (`__proto__`, `constructor`, encoded variants, unknown id -> `404 not_found`); `userId`/`user` in query, headers or body is ignored (identity comes from the verified token only) |
| SH4 | Query validation: unknown `type`/`sort`, a sort that requires a query used without one, non-numeric or negative paging, `q` over 200 characters -> `400 bad_request` with zero upstream calls; `pageSize` default 24, cap 50 |
| SH5 | Window: `page x pageSize` beyond the provider's declared window -> `400`; `hasMore` is correct at the window end and when `total` is smaller |
| SH6 | Output URL policy with a stub provider returning bad data: `http:`, `javascript:`, `data:` (outside `thumbnailUrl`), an attacker host, a host outside `deliveryHosts`, empty -> the rendition/link is dropped and the asset is not insertable with a fixed reason; a bad `thumbnailUrl` is dropped; a `data:image/(jpeg|png|webp);base64` thumbnail up to 64 KB passes, larger or other types are dropped |
| SH7 | Allow-list: unknown provider fields never appear in the response, including a field named like a secret |
| SH8 | Error mapping from provider failure classes: bad request `400`, not found `404`, forbidden `403`, rate limited `429` with `Retry-After` (clamped 1-3600 s), misconfigured `500 misconfigured`, upstream unavailable `502`; fixed messages; no upstream text; every error has the #2 shape, `Cache-Control: no-store` and `x-request-id` |
| SH9 | Result cache: two identical searches within the TTL -> one upstream call; different `q`, `type`, `sort`, `page`, `pageSize`, root or cloud name -> separate calls; expiry via injected `now`; TTL `0` disables; detail responses and error responses are never cached; two providers never share an entry |
| SH10 | Per-provider config: required item absent -> provider omitted from `/dam/providers`, its routes `404 not_found`, the worker still starts and other providers work; invalid optional config (bad API host, bad root, bad renditions JSON, bad algorithm) fails the start with a message naming the setting and never its value |
| SH11 | Logging: one line per request with provider id, outcome, status, retry count; never tokens, `Authorization`, Basic value, secrets, search text or asset bodies (extends US5) |
| SH12 | CORS and origin re-asserted on `/dam/*`: allowed origins get ACAO on every status; a disallowed `Origin` with a valid token -> `403` and no provider call (extends UC6/UC7) |

### 1.2 Provider contract (AC4; seam P1)

Run once per registered provider and per credential kind:

| ID | Behaviour asserted |
|---|---|
| PC1 | A provider missing any required member (identity, kind, capabilities, config, `search`, `getAsset`; for `user-oauth` also scopes, authorize-URL, code exchange, refresh, account name) fails the worker start with a message naming the provider and member; a complete one registers |
| PC2 | Malformed id, malformed `assetIdPattern`, duplicate id, empty `assetTypes`, a `defaultSort` not in `sorts`, `window` below the page-size cap -> start fails with a clear error |
| PC3 | `search` output validates against the normalised-summary schema (required keys, no extra keys, https URLs, type enum) on every fixture; `getAsset` output against the detail schema (renditions, alt with source, insertable, warnings) |
| PC4 | **Add-a-module proof (service):** registering the second stub `service` provider with **no change to shell code** makes it appear in `/dam/providers`, routable under its own id, with its own cache namespace and no token-store or OAuth route created |
| PC5 | **`user-oauth` kind defined but not hosted:** a complete stub declaration passes interface validation yet fails the start with "credential kind not hosted by this build"; an incomplete one fails validation naming the missing member; no OAuth route, token store or cookie exists (RC and SH2 cover absence). This test is replaced by #25's tests when it adds `user-oauth` to the hosted set |
| PC6 | Failure classes: a provider failing with each class is mapped as SH8; a provider throwing an untyped error -> `500 internal` with no message; a provider returning malformed shapes -> `502 upstream_unavailable`, never a thrown error |
| PC7 | A provider never receives the IMS token, the inbound `Authorization` or cookies: the per-call context contains none (inspected via the stub) |
| PC8 | The outbound helper handed to a provider refuses hosts outside its `outboundHosts` before any fetch and does not follow redirects |

### 1.3 Cloudinary query build and paging (AC1, AC3)

| ID | Behaviour asserted |
|---|---|
| CQ1 | No `q`, `type=all` -> expression is exactly the fixed prefix (`type=upload`); no `sort_by` (newest default); `max_results` = page size |
| CQ2 | Keyword `red shoes` -> `("red" AND "shoes")` appended with `AND`; more words narrow; at most 8 words and 200 characters |
| CQ3 | Hostile text (`"`, `\`, `*`, `)`, `OR`, `-`, `:`, `NOT`, newline, NUL, very long, unicode, emoji) never produces unquoted user characters; `"`, `\`, `*` and controls are replaced by spaces; the fixed prefix survives |
| CQ4 | Injection corpus: `x" OR type=private`, `*`, `) OR (`, `public_id:*`, `a" AND "b` -> the final expression is parsed by a test-side tokenizer: balanced parentheses and quotes, exactly one `type=upload` clause, no clause added or removed by user text |
| CQ5 | Type `image` -> image and not-document clause; `video` -> video and not-audio; `audio` -> video and audio-format; `document` -> pdf or raw; unknown type -> `400` (SH4) |
| CQ6 | Sort `newest` -> no `sort_by`; `oldest` -> `created_at` ascending; `name` -> `public_id` ascending; `relevance` with a keyword -> `score` descending, without -> `400` |
| CQ7 | Root configured, dynamic mode -> exact-folder OR prefix clause on `asset_folder`; fixed mode -> `folder`; roots with spaces and reserved characters are escaped; an invalid root fails registration (SH10) |
| CQ8 | Paging: `page=1,pageSize=24` -> `max_results=24`; `page=3` -> 72; `page=21,pageSize=24` -> `max_results=500` and a 20-item slice; `page=22,pageSize=24` -> `400`; zero upstream calls on every rejection |
| CQ9 | Slice and flags: page 2 of a 60-item `total_count` returns items 24-47, `hasMore` true; the last partial page returns the remainder, `hasMore` false; end at the window with `total_count` 900 -> `hasMore` false and `total` 900 |
| CQ10 | Fuzz (seeded, 1,000 random strings incl. unicode and control characters): the outgoing expression always starts with the fixed prefix, is balanced, and contains no unquoted user characters |
| CQ11 | Case, unicode and emoji in `q` pass through quoted and correctly JSON-encoded |
| CQ12 | The request is `POST` with `Content-Type: application/json` to the pinned API host and the exact cloud-name path; the `fields` list is the documented set; search `5xx` is retried via the explicit opt-in, nothing else is retried on `5xx` |

### 1.4 Cloudinary calls, mapping and detail (AC1, AC2)

| ID | Behaviour asserted |
|---|---|
| CS1 | Outbound `Authorization` is exactly `Basic base64(key:secret)` from the secrets; no inbound `Authorization`, `Cookie`, `Host` or forwarded header is sent; the IMS token never leaves the worker |
| CS2 | Outbound host is the configured API host only; a `CLOUDINARY_API_HOST` outside the three documented hosts fails registration; redirects are not followed |
| CS3 | Detail: `GET .../resources/{asset_id}` with the same Basic header; id must match `^[0-9a-f]{32}$`; `..`, `%2f`, extra segments, uppercase, wrong length, public-ID-style ids -> `400`, zero upstream calls |
| CS4 | Detail of an asset outside the configured root, or with delivery type other than `upload`, returns `404 not_found` with no asset data |
| CS5 | Non-JSON body (HTML) on 200, 401, 403 or 5xx is never parsed or echoed -> the mapped status per CE1/CE4 |
| CM1 | Image: `id` = `asset_id`, `name` = `display_name`, `type=image`, width, height, extension, fileSize, `warnings=[]` |
| CM2 | PDF (`resource_type=image`, `format=pdf`) -> `document`; MP3 (`video`, `mp3`) -> `audio`; MP4 -> `video`; raw `.docx` -> `document`; font -> `other` |
| CM3 | Fixed-folder fixture: no `display_name` -> name from the last path segment of `public_id`; `folder` used for the root check |
| CM4 | A fixture row whose `type` is not `upload` or whose `status` is not active is dropped by the mapper as a belt-and-braces check |
| CM5 | `access_control` non-empty -> `insertable:false` with the access-restricted reason and still listed; `moderation_status=rejected` -> not insertable; the deprecated `access_mode` field is ignored |
| CM6 | Non-https or non-allow-listed host in `secure_url` -> not insertable; the default allows `res.cloudinary.com`; `CLOUDINARY_DELIVERY_HOSTS` extends exactly the listed hosts |
| CM7 | Non-image with a good URL -> `linkUrl` and `insertable:true`, `renditions` empty; no thumbnail for audio and raw |
| CM8 | Each rendition's dimensions are `min(asset width, rendition width)` with proportional height; missing width -> a rendition without dimensions |
| CM9 | Search response with missing optional fields, nulls and empty arrays still normalises without throwing; a detail response with a large `derived` array is mapped and the array dropped |

### 1.5 Renditions, thumbnails, signing (AC1, AC2)

| ID | Behaviour asserted |
|---|---|
| CR1 | Default set `web`, `large`, `medium`, `small` built by inserting the configured transformation between delivery type and version of the **API-returned** URL; `defaultRenditionId = web`; the remainder (version, public ID, extension) is unchanged |
| CR2 | `original` is offered only for jpg, jpeg, png, gif, webp, avif, svg and equals the returned `secure_url`; a tiff/psd image gets derived renditions with automatic format but no `original` |
| CR3 | URL shape mismatch (no `/{resource_type}/{type}/`, missing `v{version}/`) -> `insertable:false` "unrecognised URL"; no URL is ever synthesised from `cloud_name` or ids |
| CR4 | Public IDs with folders, spaces, unicode and dots survive byte-for-byte in unsigned rendition URLs |
| CR5 | `CLOUDINARY_RENDITIONS` override replaces the defaults; invalid entries (characters outside the allowed set, too long, too many, duplicate ids) fail registration |
| CR6 | Signing off: no `s--` component anywhere; the version segment is kept |
| CR7 | Signing on: every transformed URL (renditions and thumbnails) contains `s--<8 URL-safe base64 characters>--` immediately after the delivery type and has no `v<version>/` segment; the `original` URL is unaltered |
| CR8 | **Known-answer vector:** transformation `c_fill,w_300,h_250/e_grayscale`, public ID `sample-authenticated`, extension `png`, secret `abcd`, SHA-1 -> signature `iDy_JeBq` (the value printed in https://cloudinary.com/documentation/delivery_url_signatures.md) |
| CR9 | SHA-256 mode gives a different 8-character URL-safe signature (computed independently in the test with Node `crypto`); SHA-1 remains the default |
| CR10 | The signed string is `<transformation>/<public_id>[.<ext>]` + secret with no version [ASSUMPTION; the test pins the chosen rule and is amended only if M6 shows otherwise] |
| CR11 | A public ID needing percent-encoding with signing on -> `insertable:false` with a reason; with signing off -> allowed |
| CR12 | The API secret, the Basic value and the digest input never appear in any response, header, log line or error (canary scan across all CR scenarios) |
| CR13 | Thumbnails: the image thumbnail transformation is applied and signed when signing is on; video and PDF use the still-image forms; audio and raw have none |

### 1.6 Alt text (AC1)

| ID | Behaviour asserted |
|---|---|
| CT1 | `context.custom.alt` present -> `source: property` (default key `alt`); also accepts the `context.alt` shape |
| CT2 | A custom `CLOUDINARY_ALT_CONTEXT_KEY` is honoured; the structured field `CLOUDINARY_ALT_METADATA_FIELD` (detail only) is used when configured and present, strings only |
| CT3 | Alt absent, `caption` present -> `source: description` |
| CT4 | Both absent -> display name (or filename) without extension, separators to spaces (`Hero_Banner-2024.jpg` -> `Hero Banner 2024`), `source: name` |
| CT5 | Nothing usable -> empty value, `source: none` |
| CT6 | Markup, entities and control characters stripped; whitespace collapsed |
| CT7 | Alt text containing `"><script>` is returned as plain text (the browser builds the attribute safely; re-asserted in UI10 and E2E3) |

### 1.7 Errors, quota, cache (AC3)

| ID | Behaviour asserted |
|---|---|
| CE1 | Upstream `401` or `403` (JSON or HTML) -> `500 misconfigured`, fixed message, log line with provider id and class only, no `reauth` code, no credential or upstream text |
| CE2 | Upstream `420` with `X-FeatureRateLimit-Reset` 90 s ahead -> `429 rate_limited`, `Retry-After` about 90; header absent -> 60; reset in the past -> 1; reset over an hour away -> 3600; **no retry** on `420` (one upstream call) |
| CE3 | Upstream `429` behaves like `420` |
| CE4 | Upstream `5xx` / network failure: search is retried per the template schedule; exhausted -> `502 upstream_unavailable`; no upstream body in the response |
| CE5 | Upstream `400` -> `400 bad_request`; `404` on detail -> `404 not_found`; `409` -> `502` generic |
| CE6 | A success with `Remaining` at or below the reserve -> the next request is refused early with `429 rate_limited` until `Reset` (no upstream call); a later success after the reset restores normal service [ASSUMPTION: reserve 20] |
| CE7 | 2xx with invalid JSON or the wrong shape -> `502 upstream_unavailable`, never a thrown error |
| CE8 | Cache settings: `CLOUDINARY_CACHE_SECONDS` default 30 reaches the shell cache (SH9); `0` disables; the cache key includes cloud name and root, so a config change cannot serve stale scope |

### 1.8 Cloudinary security (AC2, AC8)

| ID | Behaviour asserted |
|---|---|
| CX1 | No user-controlled value can add a clause, close a quote, or remove `type=upload` or the root clause (replays the CQ3/CQ4/CQ10 corpus against the final expression with the test-side tokenizer) |
| CX2 | Path safety: the cloud name and API host come only from configuration; the asset id is the only user value in an upstream path, regex-validated; nothing from the request `Host` or headers reaches upstream |
| CX3 | Canary scan across a matrix (search, detail, every CE status, signing on and off, every fixture): `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` and the Basic value appear in no response body, header, `Location` or log line (extends US1) |
| CX4 | Every `/dam/*` path without a valid token -> `401`; disallowed `Origin` with a valid token -> `403` (template UA/UC re-asserted on these routes) |
| CX5 | A fixture whose `secure_url` points at an attacker host or uses `javascript:`, `data:` or `http:` never yields an insertable URL |
| CX6 | Credential composition: with TG1 as a `basic` scheme, or the fallback accessor plus redaction hook, a Cloudinary response that echoes the Basic value in its body is redacted in the response |

## 2. Browser unit tests (seam S2; `@web/test-runner`, injected `fetch` standing in for the worker)

Fixtures: the #1 SDK stub with `sendHTML`/`closeLibrary` recorded; a worker-API fake returning the normalised contracts; fake timers.

| ID | Behaviour asserted |
|---|---|
| UI1 | The page awaits the SDK, fetches `/dam/providers` with `Authorization: Bearer <sdk token>`, shows the Cloudinary grid with **no connect prompt**; the token never appears in the DOM or console |
| UI2 | Empty provider list -> a message that no DAM is configured on this site (and where the administrator sets it up); no grid |
| UI3 | Typing debounces (a single request after the pause); Enter searches immediately; an empty query lists newest first |
| UI4 | Changing the type filter or sort resets to page 1 and sends `type`/`sort`; the options come from the provider's capabilities |
| UI5 | Out-of-order responses: the response for the latest query always wins; the superseded request is aborted/ignored |
| UI6 | "Load more" appends the next page without duplicates and disappears when `hasMore` is false; at the window end a hint to narrow the search is shown |
| UI7 | States: loading, empty, generic error with retry, `rate_limited` message with `Retry-After` honoured (search disabled until then), `misconfigured` -> "ask your administrator" (no Reconnect prompt) |
| UI8 | Select an asset -> detail fetched; the rendition selector defaults to `defaultRenditionId`; the preview shows the selected rendition URL; alt prefilled with its source label; editable; "decorative" sets alt empty and disables the field; warnings and not-insertable reasons visible |
| UI9 | Insert an image: `sendHTML` is called once with HTML that parses to exactly one `<img>` whose `src` equals the selected rendition URL and `alt` equals the field; then `closeLibrary` once, **in that order**; alt text containing `"><script>` stays attribute text (no extra elements) |
| UI10 | Non-image with `linkUrl` -> one `<a href>` with the asset name as text; `insertable:false` -> Insert disabled with the reason shown |
| UI11 | Every worker call carries the bearer token; with the SDK never resolving, a standalone message and no calls; `?worker=https://evil.example` is ignored (origin constant: loopback on `localhost`, deployed origin elsewhere) |
| UI12 | A worker-supplied non-`https:` URL is neither rendered as an image nor insertable; a missing thumbnail shows a file-type placeholder; a valid inline thumbnail renders |
| UI13 | Grid items are buttons with accessible names; search, type and sort are labelled; focus moves to the detail pane on select and back on close |
| UI14 | One provider -> no source switcher; two (stub) -> a switcher; each provider's capabilities drive its own filters |
| UI15 | A provider whose `connection.state` is not `connected` is shown as unavailable with the fixed notice and no grid (the single extension point #25 replaces) |
| UI16 | Rapid repeated typing issues no more requests than the debounce allows (counted over a scripted keystroke burst), proving the AC3 browser half |

## 3. End-to-end tests (S1; Playwright, Chromium, hermetic, no credentials)

Servers started by the Playwright config/global setup: static server `:3000`; the real worker under `wrangler dev` `:8787` with `ALLOW_LOCALHOST=true`, test secrets from a temp env file and the API host overridden to the fake; a fake IMS key server; `fakeCloudinary` as a Node server. The #1 SDK stub supplies a token signed by the fake IMS key. The browser harness fulfils delivery-host image requests with a 1x1 PNG and records the hosts requested.

| ID | Behaviour asserted |
|---|---|
| E2E1 | Open the picker: the Cloudinary grid loads with no connect prompt; the fake's request log shows the default expression, `max_results` and the Basic header (key and secret appear only there) |
| E2E2 | Search and type filter: the log shows the keyword and type clauses; thumbnails render; "Load more" appends and stops at `hasMore:false` |
| E2E3 | Select -> change rendition -> edit alt -> Insert: the stub log shows `sendHTML` with exactly one `<img src alt>` whose `src` equals the chosen rendition URL, then `closeLibrary` |
| E2E4 | Token hygiene: page HTML, DOM, `localStorage`/`sessionStorage`, script-visible cookies and all network responses contain neither the key, the secret nor the Basic value; the page never calls the Cloudinary API host |
| E2E5 | Rate limited: the fake answers `420` -> the UI shows the rate-limit message and waits; no Reconnect prompt |
| E2E6 | Auth: a direct `fetch` to `/dam/cloudinary/assets` with no token -> `401` (readable by the page: CORS headers); a token from another key -> `401`; `?worker=` ignored |
| E2E7 | Non-image: a PDF and an MP3 insert one `<a href>` with the asset name; an access-controlled asset shows Insert disabled with the reason |
| E2E8 | Signing on: every thumbnail request and the inserted `src` carry `s--...--`; signing off: none |
| E2E9 | Quota: ten rapid keystrokes produce one search request at the fake; a second identical search within the TTL produces none (cache); the early-stop threshold in the fake's headers makes the next search show the rate-limit message without a request |
| E2E10 | Only expected hosts are contacted by the browser: page, worker, SDK stub, fake IMS, delivery host(s) |

## 4. Runtime smoke (W2; Node test driving `wrangler dev`, no Cloudflare login)

| ID | Behaviour asserted |
|---|---|
| SM1 | The worker bundles and starts with Cloudinary configured, **without** any KV binding or OAuth secret; the optional Cloudinary secrets are read from `.dev.vars`/the env file although `secrets.required` does not list them; a bare `/dam/providers` -> `401` |
| SM2 | Search against `fakeCloudinary` in workerd: the Basic header is correct; Web Crypto SHA-1 and SHA-256 signing works and matches CR8/CR9; a 500-item response normalises; CPU/wall time and payload size are recorded (informational; Free-plan 10 ms budget, R16) |
| SM3 | The in-isolate cache works across two requests in the same worker; `420` handling over real HTTP (headers preserved, `Retry-After` set); a start with a bad optional setting fails with the named-setting message |

## 5. Repo checks (S3, extended)

| ID | Behaviour asserted |
|---|---|
| RC1 | The string `cloudinary` (any case) does not appear in shell, browser or core code outside `providers/cloudinary/`, tests, fixtures, docs, the single registry line, and the worker's wrangler config and `.dev.vars.example`; a fixture tree with a leak fails (**machine proof of AC4**) |
| RC2 | Every `providers/<vendor>/` has a worker module, fixtures with a recording README, a conformance-suite registration and a matching README section; missing any fails |
| RC3 | The root README extensions table has the `multi-dam-picker` row (name, folder, entry point, type `library plugin`, description) and the type matches the `library` registration row documented in the extension README (existing S3 rules) |
| RC4 | The worker's wrangler config declares the non-secret vars with no secret-looking names or values and no KV binding; both Cloudinary secrets appear in `.dev.vars.example`; no tracked `.dev.vars*` (extends #2 UR1-UR5; provider secrets are optional, so UR5's "every `secrets.required` name" is complemented by "every documented provider secret") |
| RC5 | The extension README contains the required sections (setup, Cloudinary-side setup, the `library` row verbatim, site config read, local dev, shared-credential model, limits, privacy, add-a-provider checklist) and documents exactly the vars and secrets the worker declares |
| RC6 | No file under `providers/cloudinary/` contains browser code or its own `package.json`/wrangler config (the provider is a module of the extension's worker) |

## 6. Manual end-to-end verification in EW and against real Cloudinary (needs interactive logins and a sandbox; cannot run in CI)

**Accounts and credentials needed:** GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, per #1); two Adobe IMS identities with access to the DA org/site (one with config-edit rights) and Chrome; a **Cloudinary Free-plan environment** (self-serve, no card [VERIFIED: pricing page]) with its cloud name, API key and secret (Console Settings > API Keys); a **second environment, or the same one toggled, with Strict transformations enabled** (Console Settings > Security) for M6; ideally one environment in legacy fixed folder mode for R10 [OPEN]; Cloudflare account with Wrangler login. **Test assets** to upload: a public JPEG with `alt` and `caption` contextual metadata; one with only a caption; one with neither; a large PNG; a small logo; a TIFF or PSD; a PDF; an MP3; an MP4; a raw `.docx`; an asset with a space and one with non-ASCII characters in its public ID; an asset in a subfolder and one outside it; an asset with `access_control` set (premium; skip if unavailable). Never paste real API secrets or IMS tokens into chat, issues or logs.

- **M0 (prereq/liveness):** set `CLOUDINARY_CLOUD_NAME`; `wrangler secret put CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`; deploy; `curl -i <worker>/dam/providers` -> `401`; `wrangler secret list` shows names only. Proves AC2/AC8 (secrets held by the worker, unauthenticated rejected on the deployed worker).
- **M1 (sandbox contract checks, run before coding, record in the PR):** with `curl` and the sandbox credentials confirm: search accepts `POST` with a JSON body (and what `GET` does); which `fields` names are accepted; the `context` shape in a search result; `max_results=500` on Free; the `X-FeatureRateLimit-*` headers on a search; the status for exceeding the limit if it can be provoked safely; whether `ping` consumes quota; sortable fields (`public_id`, `created_at`, `display_name`); folder mode via `config?settings=true`. Record sanitised responses as the fixtures. Settles R9, R10 and Questions 5, 7.
- **M2 (`ref=local`):** terminal A `npm start` (3000), terminal B worker dev (8787) with sandbox secrets in `.dev.vars`. Open an EW document with `?ref=local`; open **Multi-DAM Picker**: the grid shows immediately with no connect step; search a known keyword; filter to Images; open an asset; confirm the default `web` rendition, alt prefill and its source label; insert; inspect the document source: one `<img>` with the chosen `src` and alt; the library closes. Proves AC1, AC7 (local).
- **M3 (type mapping and thumbnails):** PDF under Documents, MP3 under Audio, MP4 under Videos, raw under Documents; thumbnails for image, video poster and PDF page render, audio/raw show the placeholder; record the working URL forms for video poster and PDF page. Proves AC1 (type filter).
- **M4 (branch ref):** push `multi-dam-picker-cloudinary` (simple name), wait for code sync, set the library row `ref` to that branch (or use the main row), open the editor with `?ref=<branch>`, repeat M2 against the deployed worker. Record the page's real `Origin` and any CORS or local-network prompts (#2 R2/R11). Proves AC7 (branch ref).
- **M5 (publish round trip):** insert a `web` rendition and an `original`; preview and publish; open the published page in a private window with no Adobe or Cloudinary session: images load. Record whether EDS keeps the external URL and whether anything rewrites it. Proves "appropriate rendition URL".
- **M6 (strict transformations and signing, decision gate for D14):** in the strict-enabled environment with `CLOUDINARY_SIGN_URLS=false`, insert a `web` rendition and confirm it fails (`401`/`404` with an `x-cld-error` header); set `true` and redeploy the var, insert again and confirm it loads anonymously. Compare the version-less signed form (default) with a version-included signed string if the first fails; repeat with SHA-256 if the account is SHA-256-only; insert assets with a space and non-ASCII characters in the public ID and record the signing outcome (settles CR10/CR11, R2, R11); compare single-component and chained transformation strings. Proves AC2 (signed URLs generated server-side, secret never exposed) and AC1.
- **M7 (secret hygiene and rotation):** search DevTools Network responses, page source and Application storage for the API key and secret (none); confirm the page never contacts the Cloudinary API host; `wrangler secret list` names only. Rotate `CLOUDINARY_API_SECRET` (new secret in the Console, `wrangler secret put`) and confirm the picker works afterwards; record whether signed URLs inserted earlier under the old secret stay valid. Proves AC2, AC8.
- **M8 (negative checks on the deployed worker):** `Origin: https://evil.example` with a valid token -> `403`; no token -> `401`; a token from another IMS client id (if the allow-list is set) -> `401`/`403`; search with adversarial `q` (quotes, `*`, `OR`, `-`, backslash) returns normal results scoped to the root folder only. Proves AC8.
- **M9 (scope and access):** set `CLOUDINARY_ROOT_FOLDER`; assets outside it never appear in search and detail by id returns `404`; `authenticated`/`private` assets are absent; an access-controlled asset is listed not insertable with the reason (if available). Proves AC1 (appropriate URL) and the documented authorisation model.
- **M10 (quota):** with the Console's usage view or the `X-FeatureRateLimit-*` headers, perform a scripted session (open, ten searches by typing, three detail opens, repeat of an identical search inside 30 s) and record the Admin API requests consumed; then drive searches until the early-stop or `420` message appears (or lower the reserve in a test deploy) and confirm the UI message and recovery. Proves AC3.
- **M11 (reachability and experience):** the plugin appears with the main-branch row (blank `ref`) for editors who open a document without `?ref`; the root README table row is present and accurate; compare `experience = fullsize-dialog` and blank (inline) and record the owner's preference and whether `fullsize-dialog` behaves in the current EW build. Proves AC6.
- **M12 (README walk-through):** a reviewer follows the extension README from a clean clone to a working local picker; any missing step is fixed in the PR. Proves AC5.

Record results and screenshots in the PR (the PR template asks for the branch-ref test URL).

## 7. CI additions (no credentials, no Cloudflare login)

| Job | Steps | Notes |
|---|---|---|
| `lint` (existing) | ESLint + Stylelint over the extension, worker and provider; `npm run check` runs RC1-RC6 | |
| `unit` (existing) | WTR runs UI1-UI16 | |
| `worker-unit` (from #2) | Node tests: SH, PC, CQ, CS, CM, CR, CT, CE, CX plus the template's UA/UC/UP/US/UK | one job; the conformance suite includes Cloudinary and the stubs |
| `worker-smoke` (from #2) | SM1-SM3 | advisory vs required per #2 Open Question 11 |
| `e2e` (existing) | starts the static server, the worker, fake IMS and `fakeCloudinary`; E2E1-E2E10 | Chromium only; upload traces on failure |

All run on every push and PR (#1 decision). Real-Cloudinary checks (M*) are manual; no Cloudinary credential is stored in CI. Branch protection requiring the jobs is an owner repo setting.

## 8. Acceptance-criteria traceability (ticket #23)

| # | Acceptance criterion (#23, in the order of its checkboxes) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Author can browse and search Cloudinary, filter by type, and insert an image with an appropriate rendition URL and alt text from asset metadata | CQ1-CQ12 (search, filter, sort, paging build), CM1-CM9 (type mapping, normalisation), CR1-CR5, CR13 (renditions and thumbnails: no upscaling, original only when displayable), CT1-CT7 (alt chain), SH4-SH6 (validation, window, output URL policy); UI3-UI10 (search, filter, load more, detail, rendition choice, alt editing, `sendHTML` then `closeLibrary`); E2E2, E2E3, E2E7 | **M2** (browse, search, filter, insert, inspect `<img>` and alt), **M3** (type filter and thumbnails), **M5** (rendition loads anonymously after publish), **M6** (renditions work under strict transformations), **M9** (scope, restricted assets) |
| AC2 | Cloudinary API key/secret are held by the worker; signed delivery URLs are generated server-side | CS1, CS2, CS5 (Basic auth from secrets only, host pinned, IMS token not forwarded); CR6-CR12 (server-side URL signing, known-answer vector, secret never exposed); CX3, CX6 (canary scan, composed-credential redaction); RC4 (secrets declared, none in vars/git); E2E4, E2E8; SM1, SM2 | **M0** (secrets by name, bare `curl` -> 401), **M6** (signed URLs load under strict transformations), **M7** (secret hygiene and rotation) |
| AC3 | Admin API quota (500 requests/hour on Free) is protected by debounced search, modest page sizes and a short result cache | SH4 (page-size default and cap), SH9, CE8 (result cache: hits, keys, expiry, no cache of detail/errors), CE2, CE3, CE6 (`420` mapping, early stop, no retry), UI3, UI16 (debounce, burst), UI5 (superseded requests), UI7 (rate-limit UX); E2E5, E2E9 (burst -> one request, cache hit, early stop); SM3 | **M10** (measured Admin API consumption for a scripted session; early-stop and `420` recovery); review: README documents the 500-per-hour limit, the window and the controls |
| AC4 | Provider interface (credential kind, browse/search, rendition URL, metadata) is defined so later DAMs only add a module | PC1-PC8 (interface enforced for both credential kinds, schema-validated outputs, second stub provider added with zero shell change, `user-oauth` declaration validated and refused until hosted), SH10 (per-provider config isolation), RC1, RC2, RC6 (no vendor leakage; machine proof), UI14, UI15 (capability-driven UI, source switcher, connection extension point) | Review: the README interface table and "add a provider" checklist match this spec's D3/D4; D4's reserved wire fields and routes are present; #25-#24 as the real-world check |
| AC5 | All code in its own self-contained `multi-dam-picker` folder, with a README covering setup, the EW config-sheet row that enables it, and any site config it reads | RC3, RC5, RC6 (S3 convention: entry page, README, tests, required README sections, worker and provider placement) | **M12** (clean-clone walk-through); review: the README states the `library` row verbatim and that no other site config is read |
| AC6 | Listed in the repo README extensions table and reachable from the editor library | RC3 (table row and type consistency); E2E1 (page loads as the library plugin would) | **M2/M4** (plugin present in the library with `ref=local` and a branch), **M11** (main-branch row, README table) |
| AC7 | Works in EW with `ref=local` and with a branch ref | E2E1-E2E10 prove the page + worker contract on `localhost:3000`/`:8787`; SM1-SM3 in the real runtime | **M2** (`ref=local`), **M4** (branch ref against the deployed worker, real `Origin`) |
| AC8 | Vendor credentials live only in this extension's worker (built from the shared template); the browser never receives them; unauthenticated calls to the worker are rejected | SH1-SH3, SH10-SH12, CX1-CX6, template UA1-UA15 (401 matrix, auth before routing), CX3 (no leakage), RC4, UI1, UI11; E2E4, E2E6; SM1 | **M0**, **M7**, **M8** |
| AC9 | Core logic covered by unit tests; lint and CI green | All of sections 1, 2 and 5 run in `worker-unit`, `unit` and `lint`; e2e and smoke jobs green | Review: CI shows all jobs green on the PR; deliberately break a rule on a scratch branch (let `q` bypass the character stripping, drop the `type=upload` clause, return the Basic value in an error, skip the debounce) and see CQ3/CX1/CX3/UI16 fail |

Every acceptance criterion on #23 maps to at least one automated test and at least one numbered manual or review step above. (AC4 and AC9 are largely machine-proved; AC5's README quality is irreducibly a human review; strict-transformations behaviour in AC1/AC2 is only provable against a real Cloudinary environment, M6.)

## 9. Open questions for the owner

1. **Shell split with #25 (D4).** Confirm that #23 builds only the `service` kind and *defines and reserves* `user-oauth` (interface members, `credentialKind` and `connection.state` on the provider list, reserved routes and failure classes, a fail-fast "not hosted" rule), and that #25 adds the OAuth host (routes, encrypted token store, refresh, browser connect/disconnect panel) as additive shell work plus the Dropbox module. #25's acceptance criteria also say "no changes needed in the shell beyond registering the provider"; I read that as the *provider* part, with the plumbing as #25's own deliverable.
2. **Template gaps TG1-TG3 (R5).** Approve as #2 additions (TG1 a `basic` proxy scheme or a per-request redaction hook for the composed credential; TG2 an optional-secret presence check with `secrets.required` kept for shell-owned secrets; TG3 prefix or parameterised routes), or accept a thin wrapper in this worker that reuses the template's exported helpers? Is a missing optional secret acceptable as "provider omitted" rather than a failed deploy?
3. **Shared credential model (R1).** Is "every EW author who can reach the worker sees the same Cloudinary assets, scoped by an optional root folder" acceptable? Do you want a dedicated Cloudinary environment (or a restricted key) for the picker, and a per-user allow-list by IMS user id as a follow-up?
4. **Plugin `experience`.** Recommend `fullsize-dialog` (seen in da-live source, undocumented) over the documented default `inline`. Which should the README lead with? Can you ask the EW team whether `fullsize-dialog` is supported for third-party plugins?
5. **Signing (R2).** Accept "signed URLs omit the version segment", default `CLOUDINARY_SIGN_URLS=false` until M6 proves it, then flip the default to on for any environment with strict transformations? Will production have strict transformations (then signing must be on)?
6. **Build vs Cloudinary's Media Library widget (D2).** This spec builds the shared-credential grid, consistent with the provider-agnostic shell. The widget gives per-user Cloudinary permissions but needs a seat licence per user, third-party cookies and vendor JavaScript, and puts authentication in the browser. Confirm, or ask for a widget-based variant (which would not satisfy AC2/AC8 as written).
7. **Rendition set and format.** Are `web` (1200 px), `large` (2000), `medium` (800), `small` (400) and `original` the right defaults? Should `f_auto,q_auto` be on by default (the published page then depends on Cloudinary's content negotiation)? Single-component or chained transformation strings (matters for allow-listing on strict accounts that do not sign)?
8. **Inline thumbnails (D5).** Allow `data:image/...` thumbnails in the contract now (Dropbox needs them; costs nothing before the shell exists), or drop the allowance and let #25 request it?
9. **Window vs cursor (D5, D12).** Is a 500-result window per query acceptable for v1, with cursor paging on the wire only if a provider needs it? Is `public_id` ascending acceptable for "name" sorting (Cloudinary sorts by the identifier, not the display name)?
10. **Policy and privacy (R18).** The worker will hold a production-capable media credential in a Cloudflare account that, per #1 R1/#2 R1, may be personal. Which account, and who signs off? Should the README ship a rotation statement before real credentials are stored?
11. **Cloudinary sandbox.** Is there a Free-plan environment I can use, and who owns it? Can you create a second environment with strict transformations enabled, and ideally one in legacy fixed folder mode? Without them real verification (AC1/AC2/AC8, manual M1-M10) is blocked and fixtures are hand-written.
12. **Names and org.** Env var names (`CLOUDINARY_*`), the provider label `Cloudinary`, the sort ids, the worker name (`ew-multi-dam-picker-worker`) and the library row `title` (`Multi-DAM Picker`) are proposals; confirm the `ORG`/`SITE` assumption (`jazhou-adobe`/`ew-extensions`, #1 R10) and the `providers/<vendor>/worker/` placement (#2 Question 3).
