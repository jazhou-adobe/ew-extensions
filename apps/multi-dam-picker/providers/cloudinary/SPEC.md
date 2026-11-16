# Spec: Multi-DAM Picker: Cloudinary (provider)

Ticket: jazhou-adobe/ew-extensions#23 (this spec: #61). Blocked by #22 (Multi-DAM Picker shell + Bynder; its spec is `apps/multi-dam-picker/SPEC.md`, spec task #60), which in turn rests on #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). Siblings: #24 (Frontify), #25 (Dropbox), same shell.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1, #2 and #22 specs): **[VERIFIED]** = read in a primary source (URL given) or computed/observed on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Cloudinary/Cloudflare.

Vocabulary follows #1, #2 and #22 exactly: *extension* = one folder `apps/<name>/` (this one is a **library plugin**, type comes from its `library` config-sheet row); *worker* = the per-extension backend in `apps/multi-dam-picker/worker/` built from `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension; *provider*, *shell*, *connection*, *normalised asset*, *conformance suite* as defined in the #22 spec. This spec **implements against the #22 provider interface and does not redesign the shell**. Where the interface as written cannot express something Cloudinary needs, the gap is named (Shell gaps SG1-SG5 in Implementation Decision 3), the smallest additive change is proposed, and a zero-shell-change fallback is given. New terms: *product environment* = Cloudinary's name for one asset store, addressed by a *cloud name* (older docs say "account"/"cloud"); *delivery URL* = the CDN URL of an asset, which Cloudinary builds from the asset's identifiers plus an optional *transformation* string (this is how Cloudinary produces renditions); *signed delivery URL* = a delivery URL carrying a signature component made from the API secret; *service credentials* = the one API key/secret pair for the product environment, as opposed to per-user OAuth tokens.

Primary sources read (all 2026-11-16): Cloudinary Admin API docs (https://cloudinary.com/documentation/admin_api, `admin_api_overview.md`, `admin_api_resources_search_for_resources.md`, `admin_api_resources_get_details_of_a_single_resource_by_asset_id.md`, `admin_api_resources_get_details_of_a_single_resource_by_public_id.md`, `admin_api_config.md`), Search API method and expression guides (https://cloudinary.com/documentation/search_method, https://cloudinary.com/documentation/search_expressions), access-control and signed-URL pages (https://cloudinary.com/documentation/control_access_to_media, https://cloudinary.com/documentation/delivery_url_signatures), transformation URL structure (https://cloudinary.com/documentation/image_transformations, section "Transformation URL structure"), crop modes (https://cloudinary.com/documentation/resizing_and_cropping), contextual metadata and alt text (https://cloudinary.com/documentation/contextual_metadata, https://cloudinary.com/documentation/accessible_media_images), folder modes (https://cloudinary.com/documentation/folder_modes), glossary (https://cloudinary.com/documentation/cloudinary_glossary), Media Library widget (https://cloudinary.com/documentation/media_library_widget). Upstream `adobe-rnd/ew-extensions` root tree re-checked via the GitHub API on 2026-11-16: no worker, DAM or Cloudinary code (only `blocks`, `tools`, `test`), so there is no upstream prior art for this ticket.

---

## Problem Statement

Content authors in Experience Workspace (EW) can insert images from AEM Assets (first-party), and after #22 from Bynder. Many sites, especially smaller ones and developer-led ones, keep their media in **Cloudinary** instead. Only AEM Assets is documented in EW. Today an author who wants a Cloudinary image has to leave EW, open the Cloudinary Media Library, find the asset, hand-build or copy a delivery URL, guess whether the original (often several megabytes) or a resized version is appropriate, paste it, and retype alt text from the asset's metadata. Nobody checks that the URL works for a visitor, that the size is sensible, or that the alt text exists.

Cloudinary raises two problems the Bynder case did not:

1. **No per-user login for the API.** Cloudinary's Admin and Search APIs authenticate with one API key and secret for the whole product environment (HTTP Basic). There is no end-user OAuth flow to put behind a "Connect" button. The secret is powerful (it can read, change and delete every asset and sign any delivery URL), so it must never reach the browser, and extension code is public. A worker must hold it, and because every EW author then acts through one credential, the worker is the only place that can limit who may browse and how much.
2. **Renditions are made, not listed.** Cloudinary does not return a list of ready-made renditions per asset. A rendition is a URL with a transformation string inserted (for example "scale to at most 1200 px wide, automatic format and quality"). Picking the wrong shape, or an account with *strict transformations* enabled (which rejects unsigned dynamic transformations), gives a broken image on the published page. Strict transformations are exactly the setting security-minded Cloudinary customers turn on, and the fix (a signed delivery URL) needs the API secret, so it can only be generated on the server.

The maintainer needs the Cloudinary provider to be a self-contained module in the #22 shell: no new browser code, no changes to the worker core beyond registering it, and the shared conformance suite as proof.

## Solution

**Cloudinary** appears in the existing Multi-DAM Picker library plugin as a provider. There is no "Connect" step: when the site's worker has Cloudinary configured, the author opens the library, sees the Cloudinary asset grid immediately (newest first), searches by keyword, filters by type (images, videos, documents, audio), opens an asset to see a larger preview with its name, dimensions and type, chooses a rendition (default: "Web", at most 1200 px wide, automatic format and quality, never upscaled; others: large, medium, small, and the original file when a browser can display it), reviews an alt text prefilled from Cloudinary metadata (editable, or marked decorative), and inserts it at the cursor as an `<img>` with the rendition URL and the alt. Videos, audio, PDFs and other files with a public URL are inserted as a link carrying the asset name. Assets that visitors could not load (non-public delivery types, access-controlled assets) are shown as not insertable with a one-line reason.

Behind it, the **worker** (the same per-extension worker as #22, built from the #2 template, IMS-token-authenticated, CORS-restricted) holds the Cloudinary API key and secret as Worker secrets. It calls Cloudinary's Search and Admin APIs server-side with HTTP Basic authentication, maps the author's search and filters to a Cloudinary search expression (user text is confined to quoted tokens so it cannot change the query structure), normalises results to the #22 asset contract, builds rendition URLs from the structured fields Cloudinary returns, and, when the site enables it, **signs those URLs server-side** with the API secret so they work under strict transformations. The browser only ever holds the author's own IMS token and normalised asset data.

Because all authors share one service credential, Cloudinary visibility is controlled by configuration: an optional root folder confines the picker to a subtree, only publicly deliverable assets are offered, and the worker's IMS client-id allow-list (and optional `authorize` hook) decides who may call it at all. This is stated plainly in the README as a difference from Bynder.

## User Stories

Content author (EW end user):

1. As a content author, I want Cloudinary to appear inside the Multi-DAM Picker I already use, so that I do not learn a second tool.
2. As a content author, I want the Cloudinary assets to load as soon as I open the picker, with no sign-in step, so that I am not asked for credentials I do not have.
3. As a content author, I want to see the most recently created assets before I have searched, so that the panel is useful immediately.
4. As a content author, I want to search by keyword (name, tag, folder, public ID, caption), so that I can find an asset without knowing where it lives.
5. As a content author, I want multi-word searches to match assets containing all the words, so that more words narrow the result instead of widening it.
6. As a content author, I want special characters in my search (quotes, colons, asterisks, parentheses) to be treated as plain text and never to produce an error or odd results, so that pasting a filename always works.
7. As a content author, I want to filter by asset type (all, images, videos, documents, audio), so that I see only what I can use at the cursor.
8. As a content author, I want PDFs listed as documents (not as images) and MP3s listed as audio (not as video), so that the type filter matches what I expect, even though Cloudinary stores them under "image" and "video".
9. As a content author, I want results as a thumbnail grid with the asset name, so that I can recognise assets at a glance.
10. As a content author, I want a "Load more" action, so that the panel stays fast on a large library.
11. As a content author, I want to know when I have reached the end of what the picker can show for a query (the first 500 matches), and to be able to narrow the search, so that I am not left guessing why the list stopped.
12. As a content author, I want to sort by newest, oldest, name or (when I searched) relevance, so that I can order the list the way I think about it.
13. As a content author, I want a larger preview with name, dimensions and file type, so that I can confirm it is the right asset.
14. As a content author, I want to choose a rendition (web, large, medium, small, or the original when displayable) with a sensible default, so that I never publish a multi-megabyte original by accident.
15. As a content author, I want renditions that never scale an image up, so that a small logo is not blurred into a big one.
16. As a content author, I want the rendition URL to work on the published page for anonymous visitors, including on a Cloudinary account that has strict transformations turned on, so that the image never breaks after publish.
17. As a content author, I want the alt text prefilled from the asset's `alt` metadata, else its caption, else a cleaned-up name, and to be told which one was used, so that accessible markup is the default.
18. As a content author, I want to edit the alt text, or mark the image decorative (empty alt), so that I can fit it to the page.
19. As a content author, I want one click to insert the chosen rendition at the cursor, and the library to close, so that I can keep editing.
20. As a content author, I want videos, audio, PDFs and other files inserted as a link with the asset name, so that non-image assets are not a dead end.
21. As a content author, I want assets that cannot be loaded by visitors (private or authenticated delivery, access-controlled, rejected by moderation) to be clearly marked not insertable with the reason, so that I never publish a broken link.
22. As a content author, I want a plain message when Cloudinary is rate-limiting (including how long to wait), so that I know whether to retry now or later.
23. As a content author, I want a plain message (not a stack trace or a credential hint) when the site's Cloudinary setup is broken, so that I know to ask the administrator.
24. As a content author, I want the picker to be usable with the keyboard and a screen reader, so that the tool works for everyone on the team (provided by the shell).

Site administrator / maintainer:

25. As a site admin, I want to enable Cloudinary by setting worker configuration and two secrets, with no change to the extension's browser code or its `library` row, so that adoption is a configuration step.
26. As a site admin, I want the README to list every setting (cloud name, API key and secret, API host, root folder, folder mode, alt-text keys, delivery hosts, signing switch) and the Cloudinary-side prerequisites (where to find the key, strict-transformations behaviour, folder mode), so that I can set it up without reading code.
27. As a site admin, I want to confine the picker to one Cloudinary folder (and its subfolders), so that authors cannot browse assets outside what they should use.
28. As a site admin with strict transformations enabled, I want one switch that makes the worker sign every rendition URL, so that I do not have to allow-list transformations by hand.
29. As a site admin, I want to choose which contextual-metadata key holds alt text (and optionally a structured-metadata field), so that my existing alt-text practice works unchanged.
30. As a site admin on a private CDN or custom delivery hostname, I want to list my delivery hosts, so that the picker accepts my URLs and still rejects anything else.
31. As a site admin on the EU or AP data center, I want to set the API host, so that calls go to my region.
32. As a site admin, I want to know (in the README) that every EW author who can reach the worker sees the same Cloudinary assets, and what controls exist (root folder, client-id allow-list, `authorize` hook), so that I can decide whether that is acceptable.
33. As the maintainer, I want the Cloudinary API key and secret to exist only in the worker's secret store and never in a response, header, log line or the browser, so that nothing sensitive is in the public site.
34. As the maintainer, I want every call to the worker rejected without a valid IMS token, so that the worker is not an open door to the product environment.
35. As the maintainer, I want the API secret used server-side to generate signed delivery URLs, with only the resulting signature leaving the worker, so that strict-transformations accounts work without exposing the secret.
36. As the maintainer, I want to rotate the API secret with one documented command and no code change, so that a leak is a short fix.
37. As the maintainer, I want user text proven unable to alter the structure of the Cloudinary search expression, so that the picker cannot be used to enumerate assets outside the intended scope.
38. As the maintainer, I want the shared Admin API quota (500 requests per hour on the Free plan, 2,000 and up on paid plans) protected by modest page sizes, debouncing and a short result cache, so that a few busy authors do not lock everyone out for an hour.
39. As the maintainer, I want a repo check that fails when Cloudinary-specific code leaks outside the provider's own folder, so that the shell cannot become Cloudinary-aware.
40. As the maintainer, I want the whole flow tested hermetically in CI against a fake IMS and a fake Cloudinary, so that no credentials are needed on every push, plus recorded fixtures from a real sandbox so the fake matches reality.
41. As the maintainer, I want unit tests for the core logic and CI lint and tests green on every push and PR, so that regressions do not merge.

Provider author (later tickets #24, #25):

42. As a provider author, I want the Cloudinary module to show how a service-credential (non-OAuth) provider and a cursor-only upstream fit the shell interface, so that I can copy the pattern.
43. As a provider author, I want the shell's conformance suite to run against the Cloudinary module unchanged, so that "add a module only" is demonstrated twice, with two different auth models.

## Implementation Decisions

(No file paths or code, except type tables where they carry a decision. Layout is in the Build Analysis.)

1. **Add Cloudinary as a provider module inside the #22 shell; no new surface, no new extension.** Same library plugin, same worker, same browser code, same `library` row. Registration footprint of this ticket, nothing more: the provider module and its fixtures and tests under the provider folder, **one registry entry**, the provider's non-secret `vars` and secret names declared in the worker's wrangler config and `.dev.vars.example`, and a Cloudinary section in the extension README. (#22's RC1 allow-list names only "providers/<vendor>/, tests, fixtures, docs, and the single registry line"; the wrangler config and example env file must be added to it: SG4.)
2. **Provider identity.** `id = cloudinary`, label `Cloudinary`. Capabilities: asset types `image`, `video`, `document`, `audio`; sort ids `newest` (default), `oldest`, `name`, `relevance` (accepted only with a keyword); `paging = page` with a hard window of 500 results per query (Decision 9). The provider is *configured* when its cloud name and both secrets are present; otherwise it is omitted from `/dam/providers` and its routes return `404 provider_not_configured` (#22 PC6), the worker still starts.
3. **Interface fit and the Shell gaps (SG1-SG5).** The #22 interface was written around per-user OAuth (Bynder). Mapping each member to Cloudinary exposes five gaps. None changes the browser shell's design; all are additive. They are prerequisites to schedule in #22's stream, not part of this ticket's pull request, so that **#23's own PR touches only the provider folder plus the registration footprint** (AC3). [OPEN: Question 1.]
   - **SG1 (required, service-credential providers).** The interface has an auth half (authorize URL, code exchange, refresh, account name, optional revoke), the `connect`/`session`/`disconnect` routes and the OAuth `begin`/`callback` routes. Cloudinary has no end-user OAuth. Proposal: a capability `auth = oauth-user` (default, all of #22 unchanged) or `auth = service`. For `service`: the provider has no auth half; the shell skips the token store, ticket, state and binding cookie; `/dam/providers` reports `connected: true` with an optional account label (the cloud name); `connect` and `disconnect` are not routed for that provider (`404 not_found`); the picker shows the grid with no Connect or Disconnect controls. Fallback **F1** if the owner declines SG1: implement the OAuth-shaped members as a null handshake (the provider's "authorize URL" redirects straight to the callback with a fixed pseudo-code and the "exchange" returns a long-lived placeholder token record). That satisfies the interface literally but makes every author click Connect once, stores meaningless per-user records in KV, and makes Cloudinary require the KV binding and sealing keys. It is documented, not recommended.
   - **SG2 (optional upgrade, cursor paging).** Cloudinary search is cursor-only: no offset, `max_results` up to 500, and `next_cursor` to continue. #22 declares `paging: page|cursor` as a capability but its worker API has only `page` in and `hasMore` out; there is no cursor field. Default (needs no shell change): the provider declares `paging = page` and **emulates** pages with a window (Decision 9). Upgrade if the owner prefers: add an opaque `cursor` request parameter and `nextCursor` response field for providers that declare `paging = cursor`, which removes the 500 window.
   - **SG3 (small clarifications).** The shell validates asset ids against a provider-declared pattern (#22 BR6 for Bynder) and treats `thumbnailUrl` as an https URL. Confirm (a) the id pattern is a provider member (Cloudinary: 32 lowercase hex, the `asset_id`) and (b) `thumbnailUrl` may be absent for assets with no visual (audio, raw files), with the browser showing a file-type placeholder.
   - **SG4 (secrets and config registration).** #22's RC4 requires its secrets under `secrets.required`, which makes `wrangler deploy` fail when they are missing; but #22 Decision 10 also says a provider with absent secrets is omitted, not fatal. These conflict for a multi-provider worker: a site that only uses Cloudinary should not have to set Bynder's secrets, and vice versa. Proposal: per-provider secrets are declared as **optional** (listed in the example env file and README, validated per provider at start) and `secrets.required` keeps only secrets the shell itself always needs. Also extend RC1's allow-list to the wrangler config and the example env file.
   - **SG5 (wording of #22 Decision 11).** "The shell and providers never construct or parse DAM URLs" was motivated by Bynder migrating link formats. For Cloudinary, constructing a delivery URL (inserting a transformation into the URL grammar) is the documented way to get a rendition. Clarify the rule as "the **shell** never constructs or parses vendor URLs; a provider may build them only from the vendor's documented URL grammar and the structured fields its API returns, and must return only https URLs on allow-listed hosts". This ticket follows that reading (Decision 12).
4. **Auth model: one service credential, HTTP Basic, held by the worker.** The worker calls `https://{api-host}/v1_1/{cloud_name}/...` with `Authorization: Basic base64(api_key:api_secret)` [VERIFIED: https://cloudinary.com/documentation/admin_api_overview.md, "Basic Authentication over secure HTTP" with the API key and secret from the Console API Keys page]. Both the key and the secret are Worker **secrets** (the key is an identifier, but AC2 says "API key/secret are held by the worker", and treating both as secrets keeps them out of `vars` and passes the #2 hygiene check). The cloud name is a non-secret var (it is in every public delivery URL). The credential goes in the header, never in a URL (userinfo URLs are the documented `curl` form but are not used by `fetch`). The inbound IMS token is never forwarded. The Admin API host is configurable (`api.cloudinary.com` by default; `api-eu.cloudinary.com` and `api-ap.cloudinary.com` for EU/AP premium environments [VERIFIED: admin_api_overview.md]) and is the only host on the outbound allow-list.
5. **Authorisation reality (shared credentials).** Every authenticated EW caller of the worker acts as the one Cloudinary credential, so Cloudinary's own per-user permissions do not apply. This differs from #22 Decision 3, which rejected a shared service account for Bynder because Bynder offers per-user OAuth; Cloudinary offers no equivalent for these APIs [no per-user API mechanism found in the Admin API docs above; ASSUMPTION it does not exist for Search]. Controls provided: (a) an optional **root folder** that is ANDed into every search and checked on detail; (b) only the `upload` delivery type is browsable (Decision 7); (c) the template's IMS client-id allow-list and optional `authorize` hook (#2 Decision 6), which decide who may call the worker at all; (d) the README states the model in the first lines of the Cloudinary section. A per-user allow-list (by IMS user id) is a possible follow-up [OPEN: Question 3].
6. **Search: POST to the Admin API search method with a JSON body.** Endpoint `resources/search` (Tier 1, enabled by default for environments under 10 million assets [VERIFIED: https://cloudinary.com/documentation/search_method.md]). The documented REST example posts JSON (`Content-Type: application/json`) with `expression`, `sort_by`, `max_results`, `next_cursor`, `fields` [VERIFIED: search_method.md and admin_api_resources_search_for_resources.md; the syntax header lists `GET /resources/search`, the worked examples use a JSON body, so POST is [ASSUMPTION] confirmed in sandbox, manual step M-C1]. Because the template's proxy retries `POST` only on 429 by default, the provider marks search as safe to retry (it is read-only) via the template's explicit opt-in (#2 Decision 8). Request: `expression` (built as below), `sort_by`, `max_results`, `fields`. Response used: `resources[]`, `total_count`, `next_cursor`.
   - **Expression build (the AC1 filter logic and the injection boundary).** The expression is the AND of: always `type=upload` (Decision 7); the root-folder clause if configured; the type clause; the keyword clause. Keyword: the user text is trimmed, limited to 200 characters and 8 words; every character in the set `" \ *` and every control character is replaced by a space (removing, not escaping, so no reliance on escape semantics); each remaining word is wrapped in double quotes and the words are joined with `AND` inside parentheses. This leans on the documented rule that inside quotes colons, parentheses and other reserved characters are literal and only `"` and `*` need escaping [VERIFIED: https://cloudinary.com/documentation/search_expressions.md]. Type clause: `image` = `resource_type=image` and not a document format; `video` = `resource_type=video` and not an audio format; `audio` = `resource_type=video` and an audio format; `document` = `format=pdf` or `resource_type=raw`; `all` = no clause. The document and audio format lists are constants of the provider [ASSUMPTION: the audio list is mp3, wav, flac, aac, m4a, ogg, oga, opus, aiff; to be reconciled against sandbox assets]. Basis for the split: PDFs are `image` assets and audio files are `video` assets in Cloudinary [VERIFIED: https://cloudinary.com/documentation/cloudinary_glossary.md, "Audio files and PDFs are NOT raw files"]. Root-folder clause: `asset_folder` in dynamic folder mode (exact folder or prefix with `/*`), `folder` in fixed folder mode [VERIFIED field split: Expression Fields table in admin_api_resources_search_for_resources.md]; the root value is administrator configuration, validated at start against a conservative character set, and escaped with the documented backslash rules for unquoted terms (whitespace and the reserved characters). Sort: `newest` omits `sort_by` (the API default is newest first [VERIFIED]), `oldest` = `created_at` ascending, `name` = `public_id` ascending, `relevance` = `score` descending (documented, meaningful only with a keyword) [VERIFIED for `score`; sortable-field list for `public_id`/`created_at` follows the doc examples, other sort fields not verified, OPEN Question 9].
7. **Only publicly deliverable assets are browsable.** The expression always includes `type=upload` (Cloudinary delivery type "upload" = public CDN; `private` and `authenticated` require signed URLs to deliver the original and, for authenticated, every derivative [VERIFIED: https://cloudinary.com/documentation/control_access_to_media.md, "Restrictive delivery types"]; a signed URL "doesn't prevent link sharing" and is not a durable pattern for public pages, so those assets are excluded rather than inserted). Within `upload` assets, one with a non-empty `access_control` (token or time-limited access) or `access_mode = authenticated` is returned but flagged `insertable: false` with the reason "access-restricted in Cloudinary" [VERIFIED fields: `access_mode`, `access_control` in the search sample response]; an asset whose `moderation_status` is `rejected` is likewise not insertable [ASSUMPTION: the field is returned when moderation is in use]. Cloudinary's `status = deleted` assets are not returned by default [VERIFIED: expression fields table]. The #22 `warnings` enum (`limited-use`, `archived`, `watermarked`) has no Cloudinary equivalent, so `warnings` is empty.
8. **Asset identity and detail.** The shell id is Cloudinary's immutable `asset_id` (stable across rename, move and display-name change, and supported in both folder modes [VERIFIED: https://cloudinary.com/documentation/folder_modes.md, identifiers table]). Detail uses `GET resources/{asset_id}` [VERIFIED: admin_api_resources_get_details_of_a_single_resource_by_asset_id.md] because it is authoritative and immediate (search is **eventually consistent**, results reflect changes "within a few seconds" [VERIFIED: search reference]) and because the single-resource response carries structured `metadata` and `context` (documented sample shows `context.custom.alt` and `caption` and a `metadata` object [VERIFIED: admin_api_resources_get_details_of_a_single_resource_by_public_id.md; the by-asset-id response is assumed identical, ASSUMPTION]). The provider validates the id against `^[0-9a-f]{32}$` before any upstream call [pattern from every documented sample id; ASSUMPTION it is universal]. The detail response is normalised and root-folder-checked (an asset outside the configured root returns `404 not_found`, never its data).
9. **Pagination: window emulation, 500 maximum.** The shell asks for `page` and `pageSize` (default 24, cap 50, #22 Decision 20). The provider requests `max_results = min(500, page * pageSize)` and returns the slice for that page; `total` = `total_count`; `hasMore` is true only while the end of the slice is below both `total_count` and the 500 window. A page whose first item would be beyond the window returns `400 bad_request`. [VERIFIED: `max_results` max 500, `next_cursor`, `total_count` in the search reference.] Cost: one Admin API request per call (the same cost as cursor paging), payload grows with page number (up to 500 items; reduced by the `fields` list below), and a result set can shift between calls because of eventual consistency; the shell already de-duplicates on append. The README documents "browse shows the first 500 matches per query; refine with a keyword, type or folder". Cursor upgrade: SG2.
10. **Request and response size control.** The provider sends a `fields` list limited to what mapping needs: `public_id`, `asset_id`, `asset_folder` (or `folder`), `display_name`, `filename`, `format`, `resource_type`, `type`, `version`, `width`, `height`, `bytes`, `secure_url`, `created_at`, `tags`, `context`, `access_control`, `access_mode`, `moderation_status`. `fields` takes precedence over `with_field`, and `public_id`, `asset_id`, `asset_folder`, `created_at`, `status`, `type`, `resource_type` are always returned [VERIFIED: search reference]. Whether each name is accepted is not documented as an enumerated list [OPEN: Question 9]; if sandbox shows any is rejected or ignored, drop `fields` and rely on the allow-listed mapping, which is the real boundary (raw Cloudinary payloads are never passed through).
11. **Normalised mapping (what crosses the worker/browser boundary).** Summary: `id` = `asset_id`; `name` = `display_name` (dynamic mode) else the last path segment of `public_id`; `type`: `resource_type=image` and format `pdf` -> `document`; `image` -> `image`; `resource_type=video` and an audio format -> `audio`; `video` -> `video`; `raw` -> `document` (or `other` for fonts and similar by a small format list); `thumbnailUrl` per Decision 12; `width`, `height`, `extension` = `format`, `fileSize` = `bytes`, `dateModified` omitted (search returns `created_at`/`uploaded_at`; the shell field is optional, uploaded_at is used when present). Detail adds `description` (the caption), `tags`, `copyright` (omitted: no native field), `alt`, `renditions`, `defaultRenditionId`, `insertable`, `linkUrl`. Unknown upstream fields are dropped (Cloudinary says it may add fields at any time [VERIFIED: admin_api_overview.md], so mapping is forward compatible by allow-listing).
12. **Renditions are constructed from structured fields; URLs are https on allow-listed hosts.**
    - **Grammar** [VERIFIED: https://cloudinary.com/documentation/image_transformations.md, "Transformation URL structure"]: `https://res.cloudinary.com/<cloud_name>/<asset_type>/<delivery_type>/<transformations>/<version>/<public_id>.<extension>`, where transformations, version and extension are optional, and chained steps are separated by `/`.
    - **Method:** take the asset's `secure_url` exactly as the API returned it, locate the first `/<resource_type>/<type>/` segment, require the remainder to begin with `v<version>/` and the public ID, and insert the transformation (and, when signing, the signature) between the delivery type and the version. If the URL does not match this shape, the asset is `insertable: false` with the reason "unrecognised Cloudinary URL". No public ID, cloud name or host is re-derived from user input; only API-returned values are used. This honours the "treat API-returned URLs as given" spirit of #22 Decision 11 while using the documented grammar (SG5).
    - **Default rendition set** (images; each is one fixed transformation string, configurable by the admin through a JSON list): `web` = scale down to at most 1200 px wide, automatic format, automatic quality (default); `large` = at most 2000 px; `medium` = at most 800 px; `small` = at most 400 px; `original` = the `secure_url` as returned, offered only for browser-displayable formats (jpg, jpeg, png, gif, webp, avif, svg). "Scale down only" is Cloudinary's `limit` crop mode ("Same as fit, but only scales down the image") [VERIFIED: https://cloudinary.com/documentation/resizing_and_cropping.md]; `f_auto` (automatic format) and `q_auto` (automatic quality) are the documented optimisation transformations [VERIFIED: image_transformations.md]. Renditions are offered per asset only if they make sense (a smaller rendition than the asset's own width is still listed; dimensions reported are `min(asset width, rendition width)` with proportional height).
    - **Non-image assets:** no transformations; `linkUrl` = the returned `secure_url` for videos, audio, PDFs and raw files; `renditions` empty.
    - **Thumbnails:** images: a fixed small `limit` rendition with `f_auto,q_auto`; video: the same image rendition with the extension changed to a still-image format; PDF: first page as an image; audio and raw files: none (SG3). [ASSUMPTION: the video-poster and PDF-page URL forms; the Cloudinary docs pages checked did not state them; verified in sandbox, manual step M-C3.] Thumbnails are signed like any other transformed URL.
    - **Host allow-list:** the URL host must be `res.cloudinary.com` or be in the admin's delivery-host list (for private CDNs and CNAMEs, which are a paid-plan feature [VERIFIED: image_transformations.md, "cloud_name" row]); the scheme must be `https`. Otherwise `insertable: false` with a reason, never an insertion of an unvetted host.
13. **Signed delivery URLs, generated server-side (the AC2 "signed requests").** When `CLOUDINARY_SIGN_URLS` is on, every transformed URL (renditions and thumbnails) carries a signature component `s--<8 chars>--` placed right after the delivery type. The signature is the first 8 characters of the URL-safe base64 of the SHA-1 (or, when configured, SHA-256) digest of `<transformations>/<public_id>.<extension>` followed immediately by the API secret [VERIFIED: https://cloudinary.com/documentation/delivery_url_signatures.md; I recomputed the documented example (`c_fill,w_300,h_250/e_grayscale/sample-authenticated.png` plus secret `abcd`) with SHA-1 and obtained `iDy_JeBq`, matching the doc, so the algorithm and encoding are pinned by a known-answer test]. Why it is needed: with **strict transformations** enabled, dynamic transformations are rejected unless eager, allow-listed, or signed [VERIFIED: control_access_to_media.md, "Strict transformations" and delivery_url_signatures.md: 401 "Transformation … is not allowed"]. Why server-side: the secret "should never be generated on the client side" [VERIFIED: delivery_url_signatures.md]. Both SHA-1 and SHA-256 are accepted by default, and an account can restrict itself to SHA-256 [VERIFIED], hence the algorithm switch. The signature is computed over the version-less string in the documented example; whether the version segment is excluded and how a percent-encoded public ID is signed is not stated in prose (the SDK convention excludes the version) [ASSUMPTION; sandbox strict-account step M-C6 settles it; until then IDs containing `%` are not signed and the asset is `insertable: false` with a reason when signing is on]. The signature is derived data that ends up in public page content by design; it is not logged, and the secret is never returned.
14. **Alt text policy (AC1 "alt text from DAM metadata").** Ranked fallback returned with its source, mapped onto the #22 enum: (1) `property`: the contextual-metadata key named by `CLOUDINARY_ALT_CONTEXT_KEY` (default `alt`, which Cloudinary documents as its built-in text-alternative field [VERIFIED: https://cloudinary.com/documentation/accessible_media_images.md]), or, when configured, the structured-metadata field `CLOUDINARY_ALT_METADATA_FIELD` (detail only: search returns `metadata` only on the premium Tier 2 [VERIFIED: search reference, `with_field`]); (2) `description`: the contextual key `CLOUDINARY_CAPTION_CONTEXT_KEY` (default `caption`; Cloudinary's docs show `caption` as a standard example key, [ASSUMPTION it is conventional rather than built-in]); (3) `name`: the display name (or filename) without extension, separators turned into spaces; (4) `none`: empty alt, flagged. The context object appears as `context.custom.<key>` in the documented single-resource sample; the mapper accepts both `context.custom.<key>` and `context.<key>` because the search response shape was not shown [ASSUMPTION, fixture-settled]. All candidates are stripped to plain text (no markup, entities or control characters), whitespace collapsed (#22 AT4). Cloudinary's paid AI captioning add-on is out of scope.
15. **Errors and limits (all mapped to the #2 error contract; messages are fixed strings; no upstream text).** Cloudinary statuses: 200, 400, 401, 403, 404, 409, 420 [VERIFIED: admin_api_overview.md "Error handling"]. Mapping: `400` -> `400 bad_request`; `401`/`403` -> `500 misconfigured` with a log line naming the cause class only (the credential is shared, so the author cannot fix it and must not be invited to "reconnect"; Cloudinary notes HTML bodies on authentication problems [VERIFIED: admin_api_overview.md], so a non-JSON body on any status is never parsed and is treated as upstream failure); `404` on detail -> `404 not_found`; `420` (rate limited) and `429` -> `429 rate_limited` with `Retry-After` computed from `X-FeatureRateLimit-Reset` (an HTTP date) minus now, at least 1 s, capped at 3600 s, 60 s if the header is absent [VERIFIED headers: `X-FeatureRateLimit-Limit`, `-Remaining`, `-Reset`]; `5xx` and network errors -> the template's proxy retries then `502 upstream_unavailable`. `420` is deliberately **not** retried by the proxy (the window is up to an hour, longer than the proxy's 8 s deadline). No new error codes are needed; the SG1 prerequisite removes `provider_not_connected` and `provider_reauth_required` from this provider's paths.
16. **Rate-limit protection (R3).** The Admin API is rate limited: **500 requests per hour on the Free plan, from 2,000 per hour on paid plans**, counted per request, shared by every author [VERIFIED: admin_api_overview.md]. Search and detail each cost one request. Controls: debounce and `pageSize` from the shell; the worker keeps a short in-isolate result cache (default 30 s, `CLOUDINARY_CACHE_SECONDS`, 0 disables) keyed by the full normalised request (expression, sort, `max_results`), which is safe to share across authors precisely because every author sees the same data under the shared credential and root scope; remaining-quota headers are logged by value (count only) and, when `Remaining` is low, surfaced as an early `rate_limited` instead of burning the last requests [ASSUMPTION: the threshold, 20 requests, is a starting point]. The cache is an optimisation, not a correctness feature: isolates are short-lived and may be many, so hit rate is best effort [ASSUMPTION; measured in smoke SM-C2].
17. **Insertion and experience** follow #22 Decisions 14-15 unchanged: `<img src alt>` built by DOM APIs and sent with `sendHTML`, then `closeLibrary`; non-images as one `<a>`; only https. The shell's browser code is not modified. The Cloudinary provider adds no browser code.
18. **Configuration.** Non-secret vars (wrangler `vars`): `CLOUDINARY_CLOUD_NAME` (required); `CLOUDINARY_API_HOST` (default `api.cloudinary.com`; must be one of the three documented hosts); `CLOUDINARY_FOLDER_MODE` (`dynamic` default, or `fixed`; Cloudinary accounts created after 2024-06-04 are dynamic [VERIFIED: folder_modes.md], older ones may be fixed; the mode can be read with the config endpoint [VERIFIED: admin_api_config.md] and is checked in the README setup, not at runtime, to avoid spending quota); `CLOUDINARY_ROOT_FOLDER` (optional); `CLOUDINARY_ALT_CONTEXT_KEY` (default `alt`); `CLOUDINARY_CAPTION_CONTEXT_KEY` (default `caption`); `CLOUDINARY_ALT_METADATA_FIELD` (optional); `CLOUDINARY_RENDITIONS` (optional JSON list overriding the defaults; validated at start against a conservative transformation-string character set and a maximum count); `CLOUDINARY_SIGN_URLS` (`false` default); `CLOUDINARY_SIGNATURE_ALGORITHM` (`sha1` default, or `sha256`); `CLOUDINARY_DELIVERY_HOSTS` (optional comma list); `CLOUDINARY_CACHE_SECONDS` (default 30). Secrets (secret store only): `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. No KV, no state or encryption keys are used by this provider. The extension reads no site config beyond its own `library` row. Secret/var classification follows #2 Decision 7 and its UR3 check.
19. **Credential composition and redaction.** The Basic header value is derived from the key and secret at call time. It, the raw secret and the key are registered for #2 redaction so none can appear in a response, header or log line even if Cloudinary echoed it. If the template's proxy `auth` option cannot express Basic authentication from two values (it injects a single named secret), the provider composes the header from the secret accessor and registers the composed value for redaction (template gap G3, already requested by #22); the preferred outcome is a small additive `basic` scheme in the template [OPEN: Question 8; the template is not built yet].
20. **Tooling and conventions** follow #1/#2/#22 unchanged: ESLint 8 + helix config, Stylelint 16, `@web/test-runner`, Node `node:test` for worker tests, Playwright (Chromium) for e2e, Node 22 (>= 22.12 for wrangler 4), husky. Tests live in the extension folder (provider tests under the provider folder).
21. **Docs ship with the code (AC4).** The extension README gains a **Cloudinary** section: what it does and the shared-credential model; Cloudinary-side prerequisites (where to find the cloud name, API key and secret, folder mode, strict transformations and when to turn on signing, private CDN, data center); the exact vars and secrets table (name, kind, default, example); `wrangler secret put` commands; the `library` row (unchanged, with a pointer to the shell section); site config read (none); rate limits and the 500-result window; privacy note (no per-user data stored by this provider); the manual verification checklist link. The root README extensions table is unchanged (the extension row exists from #22).

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given an HTTP request to the worker (fake IMS, fake Cloudinary), assert the response and the requests the fake Cloudinary received (method, path, JSON body, headers); given normalised data, assert the DOM and which SDK actions fire (shell tests). Never assert on internal helper names or call counts. Properties asserted as negatives across every path: **the Cloudinary key, secret, Basic header and any rendition signature material never reach a response, redirect, log line or the browser**, **nothing runs before authentication succeeds**, and **no user-supplied byte can alter the structure of the Cloudinary search expression or the upstream path**.

**Proposed seams** (recorded here instead of asked, per #61). **No new seam**; this ticket reuses #22's and adds only a test double.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 (primary) | The worker's HTTP boundary: `worker.fetch(request, env, ctx)` | reused from #2/#22 | Node unit tests for routes, query building, mapping, renditions, signing, errors, security | Constructed `Request`s; the #2 test kit and the #22 kit; **new double `fakeCloudinary(script)`**: a scripted upstream that checks the Basic header, records every request (method, path, query, headers, JSON body), and replays recorded fixtures, 420s, HTML 401 pages and malformed bodies |
| P1 | The provider interface: shell registry + conformance suite | reused from #22 | PC-suite runs once more for Cloudinary, **with the service-credential kind**; proves "add a module only" for a non-OAuth provider | Recorded Cloudinary responses sanitised from a real sandbox (Free plan environment, available self-serve [ASSUMPTION, owner to confirm], unlike Bynder) |
| S1 | Entry HTML page + SDK module, real local worker | reused | Playwright e2e of the picker with the Cloudinary provider | #1 SDK stub; real worker under `wrangler dev`; fake IMS; `fakeCloudinary` as a throwaway Node server; thumbnails routed by the browser harness |
| S2 | Browser render/logic module | reused | `@web/test-runner`: only if SG1/SG3 add shell behaviour; otherwise none in this ticket | n/a |
| W2 | Same worker in workerd over HTTP | reused | Smoke tier | `wrangler dev`, no Cloudflare login |
| S3 | Repo convention check | reused, extended | CI lint job | Filesystem fixtures in a temp dir |

The real EW boundary (real IMS login, real Cloudinary environment, real library iframe, real editor insertion, real CDN behaviour under strict transformations) is covered only by numbered manual steps.

**Modules tested:** keyword/type/sort/root expression builder, pagination window, normalised mapping, rendition and thumbnail builder, signed-URL generator, alt-text chain, error and limit mapper, result cache, config validation and per-provider registration, provider conformance, repo checks.

**Prior art:**
- #22's seams, IDs and kit, which this spec extends (BR, RD, AT, PC, SC families re-used and re-run for Cloudinary; new `CQ`, `CM`, `CR`, `CS`, `CT`, `CE`, `CX`, `CC` families below).
- #2's test kit and UA/UC/UP/US matrices (apply to this worker automatically).
- Upstream `adobe-rnd/ew-extensions`: no relevant prior art (checked 2026-11-16).
- Cloudinary's own docs give a **known-answer vector** for URL signatures (verified above), used as a test.

## Out of Scope

- Uploading to Cloudinary, editing or tagging assets, deleting, folders management, collections, usage reports, upload widget.
- Embedding Cloudinary's **Media Library widget** (https://cloudinary.com/documentation/media_library_widget). Rejected for the same reasons as #22 Decision 2 for Bynder's UCV, plus Cloudinary specifics: it loads third-party JavaScript (`media-library.cloudinary.com/global/all.js`) into the picker page, requires each user to log in to Cloudinary with a **separate seat license** and, for Enterprise accounts, an Assets plan, and can fail where third-party cookies are blocked [VERIFIED: media_library_widget.md]; and it is Cloudinary-only, so it cannot be the provider-agnostic shell. Its authentication (users logging in as themselves) would give per-user permissions, which is a genuine upside; if the owner wants per-user Cloudinary permissions, that is a different design [OPEN: Question 6].
- `private` and `authenticated` delivery types, token-based and cookie-based access (premium) and any URL that expires; signed-URL generation for protected assets.
- Dynamic transformations beyond the configured fixed set (crops, overlays, effects, art direction, responsive `srcset`, `dpr_auto`), adaptive video streaming, video players, 3D, fetch/remote delivery types.
- Visual search, AI captioning add-on, Tier 2 search features (aggregations, embedded metadata search), structured-metadata search and facets, multi-select, saved searches.
- Per-user Cloudinary permissions, per-user quota enforcement, user allow-lists (follow-up), multiple Cloudinary environments per site, runtime folder-mode detection.
- Cursor (unbounded) paging unless the owner takes SG2.
- Changes to the shell's browser code, token store, OAuth flow, KV, or the template beyond SG1-SG5 and the template gaps already requested by #22 (G1-G4) plus G5 (Decision 19).
- CI-driven deployment, Durable Objects, custom domains (as in #2/#22).
- The Adobe outside-activity/IP policy and data-protection decisions about holding a third-party credential in a personal Cloudflare account (flagged, owned by #1 R1 and #22 Question 13).

## Further Notes

- **Docs say nothing about third-party pickers or backends in EW.** The cited EW developer doc (https://www.aem.live/docs/ew/developing/apps-plugins) documents the SDK, `sendText`, `sendHTML`, `closeLibrary` and the config rows only [VERIFIED by #22 and #2]. All EW-side behaviour here is inherited from #22's source reading.
- **What differs from Bynder, in one table.**

  | Concern | Bynder (#22) | Cloudinary (this ticket) |
  |---|---|---|
  | Auth | per-user OAuth, pop-up, tokens in KV | one service API key/secret, Basic auth, no KV |
  | Who sees what | each author's own Bynder permissions | everyone sees the same assets, scoped by root folder and `upload` type |
  | Renditions | listed by the API, treated as opaque | constructed by the provider from the documented URL grammar, optionally signed |
  | Alt text | configurable metaproperty, description, name | `context` key `alt` (default), structured metadata, caption, name |
  | Paging | page-based, window 100,000 | cursor-only upstream; emulated, window 500 |
  | Rate limit | 4,500 per 5 min per IP | 500 per hour (Free) or 2,000+ per hour (paid) per environment, status 420 |
  | Sandbox | needs Customer Support to enable OAuth Apps | free plan environment (self-serve) [ASSUMPTION: no card, no sales contact] |

- **Search latency and consistency.** Search is eventually consistent (seconds). An author who just uploaded an asset may not see it for a few seconds. Detail by `asset_id` is immediate. Using `NOT`/`-` in expressions "can lead to significant latency on large repositories" [VERIFIED: search_expressions.md]; the type clauses use a negation for the image and video filters, so large environments should be checked in sandbox (R9).
- **Embedded-URL longevity.** Inserted URLs reference Cloudinary; deleting or renaming (in fixed folder mode, where the public ID is the path) breaks the page; in dynamic folder mode renaming or moving does not change the public ID or delivery URL [VERIFIED: folder_modes.md]. One README sentence: pickers insert references, not copies.
- **EDS and external images.** Whether Edge Delivery Services keeps an external `<img src>` untouched on publish is [ASSUMPTION it is kept], checked in #22's M6 and again here (M-C5).
- **Template and shell are not built yet.** `shared/worker-template/` and `apps/multi-dam-picker/` hold only their specs. "The template/shell provides" presumes #2 and #22 landed as specified plus the gaps listed here.

---

# Build Analysis

## 1. Architecture and responsibilities

```
EW editor (da.live)                                         Cloudinary product environment
 └─ library iframe: apps/multi-dam-picker (static, public)     https://{api-host}/v1_1/{cloud_name}/...   (Admin/Search API, Basic auth)
      │ SDK handshake -> { token (IMS), actions }              ▲
      │ fetch(worker, Authorization: Bearer <IMS>)             │ one service credential (API key + secret)
      ▼                                                        │
 Cloudflare Worker (apps/multi-dam-picker/worker, core from shared/worker-template; ONE worker for all providers)
   1 origin gate -> 2 IMS token check -> 3 router -> 4 shell routes (/dam/providers, /dam/cloudinary/assets[/{id}])
        -> 5 Cloudinary provider module -> 6 proxy(retries; search marked safe to retry) ──┘
        └─ NO KV record, NO OAuth routes used for this provider; secrets: CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
   Delivery CDN (res.cloudinary.com or the site's private CDN): contacted only by visitors' and authors' browsers, never by the worker
```

| Concern | Browser extension (static, public) | Worker (private runtime) |
|---|---|---|
| API key and secret | never | only place (secret store); used for Basic auth and URL signing |
| Author identity | IMS token from the SDK | verified by the template; gates access (client-id allow-list, optional `authorize`) |
| Search expression | sends `q`, `type`, `sort`, `page`, `pageSize` | builds the Cloudinary expression; the only place user text meets the vendor query language |
| Result shaping | renders normalised assets | normalises, maps types, builds and signs rendition URLs, computes alt candidate |
| Rate-limit protection | debounce, honours `Retry-After` | short cache, 420 mapping, quota-low early stop |
| Insertion | `sendHTML`, `closeLibrary` | none |

## 2. EW integration points

- **Library plugin vs app:** library plugin, already registered by #22's single `library` row (title `Multi-DAM Picker`, `path` `/apps/multi-dam-picker/multi-dam-picker.html`, `experience` as decided in #22). **No new config-sheet row** for Cloudinary; the provider appears in the existing panel when its worker config is present. (#22 manual step M9 covers reachability.)
- **SDK actions used:** `actions.sendHTML`, `actions.closeLibrary`, `token` (unchanged from #22).
- **No pop-up, no cookies, no callback** for this provider (SG1).
- **`ref=local`:** page `http://localhost:3000` + worker `http://localhost:8787` (`wrangler dev`) with Cloudinary secrets in the untracked `.dev.vars`. Non-secret overrides come from a wrangler environment's `vars`, not `.dev.vars` (#2 R8: when `secrets` are declared only those keys are read from `.dev.vars`). **Branch ref / main:** pages on `*.aem.live` / `*.preview.da.live` call the deployed worker.
- **Site config read:** none beyond the library row (state explicitly in the README).
- **Browser-to-CDN:** the author's browser loads thumbnails from the delivery host. The editor and published page load the inserted URL. Whether the EW editor frame or its CSP restricts `<img>` hosts is not documented [ASSUMPTION none; observed in M-C2].

## 3. External APIs and auth flows

All endpoints on `https://{api-host}/v1_1/{cloud_name}/...`, `api-host` default `api.cloudinary.com`. Auth: HTTP Basic with the API key (user) and API secret (password) [VERIFIED: https://cloudinary.com/documentation/admin_api_overview.md].

| API | Use | Auth | Source / status |
|---|---|---|---|
| `resources/search` (JSON body: `expression`, `sort_by`, `max_results` <= 500, `next_cursor`, `fields`) | browse and search | Basic | [VERIFIED params] https://cloudinary.com/documentation/admin_api_resources_search_for_resources.md; POST vs GET [ASSUMPTION, sandbox M-C1] |
| `GET resources/{asset_id}` | asset detail: structured `metadata`, `context`, URLs | Basic | [VERIFIED endpoint] https://cloudinary.com/documentation/admin_api_resources_get_details_of_a_single_resource_by_asset_id.md; response shape from the by-public-ID sample [ASSUMPTION identical] |
| `GET config?settings=true` | folder mode (dynamic/fixed) | Basic | [VERIFIED] https://cloudinary.com/documentation/admin_api_config.md; README/manual only, not called at runtime |
| `GET ping` | reachability | Basic | [VERIFIED listed in the Admin API index]; used only in manual verification [whether it counts toward quota: OPEN] |
| CDN delivery (`res.cloudinary.com` or private CDN) | rendition and thumbnail display by browsers | none, or signature in URL | [VERIFIED structure] https://cloudinary.com/documentation/image_transformations.md; signature https://cloudinary.com/documentation/delivery_url_signatures.md |

Limits [VERIFIED: admin_api_overview.md]: Free plan 500 Admin API requests/hour, paid from 2,000/hour; each request counts as one; the Upload API is not rate-limited (not used). Rate headers on every Admin API response: `X-FeatureRateLimit-Limit`, `-Remaining`, `-Reset`. Status 420 = rate limited. Search is Tier 1 by default (environments under 10 million assets) [VERIFIED: search_method.md]; structured `metadata` in search results is Tier 2 only.

**Auth flow (author to worker):** SDK token -> `Authorization: Bearer` -> #2 verification -> `identity.userId` (used only for logging and the optional `authorize` hook, not for the Cloudinary call).
**Auth flow (worker to Cloudinary, per call):** secret accessor -> Basic header (registered for redaction) -> proxy to the allow-listed API host -> response parsed only if JSON -> normalise -> respond. No token exchange, refresh, state, cookie or storage.

**Signing flow (rendition URLs):** API-returned `secure_url` -> locate delivery-type segment -> choose transformation string -> if signing on: digest(`<transformation>/<public_id>[.<ext>]` + secret) -> first 8 URL-safe base64 chars -> insert `s--sig--` and transformation -> https + host allow-list check -> include in the normalised asset.

## 4. Data contracts

Behaviour contracts, not code. The worker API and the normalised asset are #22's (Data contracts section); only Cloudinary-specific content is stated.

**Worker API used (#22):** `GET /dam/providers`, `GET /dam/cloudinary/assets?q&type&sort&page&pageSize`, `GET /dam/cloudinary/assets/{id}`. Under SG1, `providers` lists `{ id: cloudinary, label: Cloudinary, connected: true, account: { displayName: <cloud name> }, capabilities }`. No `connect`, `session`, `disconnect`, `begin`, `callback` routes for this provider. Errors: `400 bad_request`, `404 not_found`, `404 provider_not_configured`, `429 rate_limited` (+ `Retry-After`), `500 misconfigured`, `502 upstream_unavailable` (the #2 and #22 shapes).

**Capabilities:** `assetTypes = [image, video, document, audio]`, `sorts = [newest, oldest, name, relevance]`, `paging = page`.

**Upstream request (search):** `{ expression, sort_by?, max_results, fields }`, `Content-Type: application/json`, `Authorization: Basic ...`, no other headers forwarded.

**Expression grammar produced** (illustrative strings, not code): `type=upload`; with root: `AND (asset_folder=<root> OR asset_folder:<root>/*)`; with type image: `AND resource_type=image AND NOT format=pdf`; with keyword: `AND ("word1" AND "word2")`.

**Rendition table (defaults, overridable by `CLOUDINARY_RENDITIONS`):**

| id | label | transformation | applies to |
|---|---|---|---|
| `web` (default) | Web, up to 1200 px | `c_limit,w_1200/f_auto/q_auto` | images |
| `large` | Large, up to 2000 px | `c_limit,w_2000/f_auto/q_auto` | images |
| `medium` | Medium, up to 800 px | `c_limit,w_800/f_auto/q_auto` | images |
| `small` | Small, up to 400 px | `c_limit,w_400/f_auto/q_auto` | images |
| `original` | Original file | none (returned `secure_url`) | browser-displayable image formats only |

(Strings are the documented `limit` crop, width, and automatic format/quality parameters; the exact chaining form, `c_limit,w_1200,f_auto,q_auto` single component versus chained components, matters for strict-transformation allow-listing and is settled in M-C6 [OPEN: Question 7].)

**Detail rules:** `insertable.ok = false` with a reason for: URL shape unrecognised; host not allow-listed; non-https; asset outside root; `access_control` present or `access_mode = authenticated`; moderation rejected; signing on and the public ID contains `%`. Non-image assets expose `linkUrl` and no renditions.

**Normalised alt:** `{ value, source }` per Decision 14.

**Worker configuration:** the table in Implementation Decision 18, plus the #2 vars (`ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS`) and the #22 shell vars and secrets that remain required by the shell for any OAuth provider (`PUBLIC_WORKER_ORIGIN`, `TOKEN_ENC_KEY`, `OAUTH_STATE_KEY`, KV `DAM_TOKENS`). With SG4 accepted, a Cloudinary-only deployment need not set the OAuth-related ones.

## 5. Folder layout (proposed; fits #1/#2/#22)

```
apps/multi-dam-picker/
├─ README.md                    gains a "Cloudinary" section (setup, keys, secrets, signing, limits, shared-credential model)
├─ worker/                      #22 shell; changed here only by one registry line + wrangler vars/secret names + .dev.vars.example
└─ providers/
   └─ cloudinary/
      ├─ SPEC.md                this file
      └─ worker/                provider module (identity, capabilities, expression builder, search/detail calls, mapping,
                                rendition + signing, alt chain, error/limit mapping, cache), test/ (W1 + conformance registration),
                                test/fixtures/ (recorded and sanitised Cloudinary responses + a fixtures README on how to record them)
```

No browser code under `providers/cloudinary/`. Test doubles (`fakeCloudinary`) live with the provider tests; reusable parts may be proposed to the #22 kit.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Interface mismatch (SG1-SG5).** The #22 interface assumes OAuth and URL opacity; adopting Cloudinary without amendment either breaks AC3 ("no shell changes") or forces F1's null-handshake hack. | High for scheduling | Owner decision before build (Open Question 1); SG1 and SG4 are prerequisites in #22's stream; F1 documented as fallback; SG2/SG3/SG5 small and additive |
| R2 | **Shared credential blast radius.** The API key/secret can read, modify, delete all assets and mint signatures. Any EW user who passes the worker's auth browses the whole (root-scoped) environment. | High | Secret store only; redaction; root folder; `upload`-type only; client-id allow-list and `authorize` hook; README states the model; recommend creating a dedicated environment or API key for the picker (Console supports multiple keys [ASSUMPTION; the API Keys page is referenced in admin_api_overview.md]); per-user allow-list as follow-up (Question 3) |
| R3 | **Admin API quota is tiny and shared** (500/hour on Free). A few active authors can exhaust it; Cloudinary then answers 420 for up to an hour for everyone using the Admin API (including their own tooling). | High (Free) / Medium (paid) | Debounce, page-size cap, 30 s cache, early stop when `Remaining` is low, plain UI message with wait time; README warns; recommend a dedicated environment or a paid plan for production |
| R4 | **Strict transformations** reject unsigned dynamic URLs (404/401). Without signing, `web`/`large`/`medium`/`small` and every thumbnail break on such accounts. | High | `CLOUDINARY_SIGN_URLS`; known-answer test; M-C6 on a strict-enabled sandbox; the `original` rendition always works for `upload` type; README tells admins to turn signing on |
| R5 | **Signature details unverified:** version segment inclusion and encoding of non-ASCII or `%`-escaped public IDs; chained versus single-component transformation strings allow-listing. | Medium | Known-answer vector now; strict sandbox in M-C6; until settled, IDs with `%` are not signed and are flagged not insertable when signing is on |
| R6 | **Search expression correctness and injection.** Misunderstood quoting or escaping could return the wrong assets or let user text widen the scope past the root folder or type filter. | High | Remove rather than escape `" \ *` and control characters; quote every word; AND-compose in the worker; root and `type=upload` clauses are always present and tested to survive adversarial input (CX1-CX5); fuzz test |
| R7 | **Windowed paging cost and ceiling.** Page N fetches N*pageSize items; ceiling 500; eventual consistency can shuffle items between pages. | Medium | `fields` trimming, 500 hard cap, UI de-dup, README; SG2 cursor upgrade if the ceiling bites; measure CPU/payload in smoke (SM-C2) against Free-plan 10 ms CPU [#2 R7] |
| R8 | **Free-plan CPU:** parsing up to 500 resource objects plus up to 24 SHA-1 signatures (Web Crypto, async) per request. | Low-Med | `fields` trimming; measure SM-C2; Paid plan fallback |
| R9 | **`NOT` latency on large environments** for image/video filters [VERIFIED caution in search_expressions.md]. | Low-Med | Sandbox with a large sample if available; alternative positive-only clauses (format lists) if slow |
| R10 | **`fields` names, sort fields, POST-vs-GET, context shape in search results** not fully documented. | Medium | Recorded fixtures from a real sandbox decide; mapper is tolerant; each is a numbered check in M-C1; fallback: omit `fields` |
| R11 | **Folder mode.** Fixed-mode (legacy) accounts lack `display_name` and use `folder` not `asset_folder`; `asset_id` support differs in the field table ("not supported in fixed folder mode" for the *search field*, but the identifier table says supported) [VERIFIED both statements; they conflict]. | Medium | Var `CLOUDINARY_FOLDER_MODE`; both modes covered by fixtures if a fixed-mode sandbox exists, else documented as untested; README tells admins to check mode |
| R12 | **Delivery host variants** (private CDN, CNAME) rejected by default. | Low-Med | `CLOUDINARY_DELIVERY_HOSTS`; clear reason string; README |
| R13 | **Thumbnails for video/PDF/audio** use URL forms not confirmed in the docs read. | Low | Sandbox M-C3; missing thumbnails degrade to placeholder (SG3) |
| R14 | **Cloudinary API drift** (new fields, deprecations: `image_metadata` deprecated in favour of `media_metadata` on the by-public-ID page). | Low-Med | Allow-listed mapping, fixtures, conformance suite; detail call does not request deprecated flags |
| R15 | **Credential rotation and blast on leak.** | Medium | `wrangler secret put` rotation, README procedure; no secrets in repo/CI; secret scanning (#2 R12) |
| R16 | **Policy:** holding a third-party production credential in a personal Cloudflare account (carries #2 R1, #22 R4). | High (policy) | Owner decision (Question 10) |
| R17 | **Alt-text key conventions vary** (`alt` documented; `caption` conventional; some customers use structured metadata or other keys). | Low-Med | Configurable keys and optional structured field; fixture variants |

## 7. Ordered build plan (sized to #23's acceptance criteria)

0. **Prerequisites (owner):** #1, #2, #22 landed; decisions on Open Questions 1-3 and 10; template gaps G1-G4 (from #22) plus G5 (Basic scheme or secret-accessor composition, Decision 19) settled; **SG1 and SG4 landed in #22's shell** (or F1 chosen); SG2/SG3/SG5 decided. A Cloudinary sandbox environment (Free plan) with test assets (checklist in Testing Requirements section 5). Without the sandbox, steps 2-9 proceed against fakes and hand-written fixtures; fixtures must be replaced by recorded ones before release.
1. **Record fixtures first** from the sandbox (document the curl recipes in the provider's fixtures README; sanitise cloud name, ids, signatures, keys): search results (images, PDF, video, audio, raw, access-controlled, `private`), single-resource details (with and without `alt`/`caption`/structured metadata), empty result, 420 with rate headers, 401 HTML, malformed JSON. Settles R10 and the context shape.
2. **`fakeCloudinary` double** (Basic-auth check, request log, fixture replay, error scripts) and the Cloudinary provider skeleton registered in the test registry; conformance suite wiring (service kind). Self-test the double.
3. **Expression builder, test-first** (CQ1-CQ12, CX1-CX5): keyword, type, sort, root, window. AC1.
4. **Search and detail calls with error/limit mapping, test-first** (CS*, CE*, CC*): Basic header, proxy opt-in, 420 handling, cache. AC1, AC2.
5. **Normalised mapping and alt-text chain, test-first** (CM*, CT*). AC1.
6. **Rendition and thumbnail builder, host allow-list, signing, test-first** (CR*): the known-answer vector first. AC1, AC2.
7. **Provider registration and config validation** (PC-C*, startup fail-fast, omit-if-unconfigured). AC3.
8. **Repo checks** (RC-C*): vendor-leak rule, registration footprint check. AC3, AC6.
9. **Playwright e2e** (E2E-C1-C9) and **runtime smoke** (SM-C1-SM-C3). AC1, AC2, AC5.
10. **README Cloudinary section** (AC4), written alongside the code and walked on a clean clone.
11. **Add the wrangler vars/secret names, example env, registry line.** Deploy secrets (`wrangler secret put CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`), set vars, run **manual verification M-C0-M-C10** (AC1, AC2, AC5, AC6); record observed rendition behaviour (strict mode, thumbnails, EDS publish) in the PR and README.
12. **Hand-off note** for #24/#25: what the second provider taught (service kind, cursor-to-page emulation, URL construction), added to the "add a provider" checklist.

---

# Testing Requirements

Template tests (UA authentication, UC CORS, UP proxy/retry, US secret hygiene, UK kit self-check) and the #22 shell tests (OAuth, token store, shell UI) run unchanged and are not repeated; the IDs below are additional or are #22 families re-run for this provider. ID prefixes: CQ = query building, CS = search/detail calls, CM = mapping, CR = renditions and signing, CT = alt text, CE = errors/limits, CC = cache, CX = security/injection, PC-C = provider contract, E2E-C, SM-C = smoke, RC-C = repo check, M-C = manual.

## 1. Worker unit tests (seam W1; Node built-in runner)

Fixtures/mocks: #2 test kit (`fakeIms`, `signToken`, canaries, injected `now`/`sleep`/`random`); `fakeCloudinary(script)`; recorded fixtures (list under Build Plan step 1); **canaries** for `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and the composed Basic value; a fixed test secret for signature vectors.

### 1.1 Query building (AC1)

| ID | Behaviour asserted |
|---|---|
| CQ1 | No `q`, type `all`, no root: upstream body has the `type=upload` clause only, no `sort_by`, `max_results` = `page * pageSize` (capped 500), `fields` present |
| CQ2 | `q = "red shoe"` -> keyword clause `("red" AND "shoe")` ANDed with `type=upload`; `q` over 200 chars or over 8 words -> `400 bad_request`, zero upstream calls |
| CQ3 | `q` containing `"`, `\`, `*`, newline, tab, NUL -> those characters never appear in the outgoing expression (replaced by spaces); remaining words quoted |
| CQ4 | `q` containing `:`, `(`, `)`, `AND`, `OR`, `NOT`, `-`, `+`, `!`, `{`, `}`, `[`, `]`, `~`, `^`, `=`, `>`, `<`, `&`, `#` -> each word stays inside its own quote pair; the clause structure (parenthesised AND of quoted words) is unchanged |
| CQ5 | Type `image` -> `resource_type=image` and not-document clause; `video` -> video and not-audio; `audio` -> video and audio-format; `document` -> pdf or raw; unknown type -> `400` |
| CQ6 | Sort `newest` -> no `sort_by`; `oldest` -> `created_at asc`; `name` -> `public_id asc`; `relevance` with keyword -> `score desc`; `relevance` without keyword -> `400`; unknown sort -> `400` |
| CQ7 | Root configured, dynamic mode -> exact-folder OR prefix clause on `asset_folder`; fixed mode -> `folder`; root with spaces and reserved characters is escaped; invalid root config fails registration at start (PC-C) |
| CQ8 | Paging: `page=1,pageSize=24` -> `max_results=24`; `page=3` -> 72; `page=21,pageSize=24` -> `max_results=500` and a 20-item slice; `page=22,pageSize=24` -> `400`; `pageSize` over 50, non-numeric or negative page -> `400`; zero upstream calls on every rejection |
| CQ9 | Slice and flags: page 2 of a 60-item `total_count` returns items 24-47, `hasMore` true; the last partial page returns the remainder, `hasMore` false; end at 500 with `total_count` 900 -> `hasMore` false and `total` 900 |
| CQ10 | Fuzz (seeded, 1,000 random strings including unicode and control characters): the outgoing expression always starts with the fixed prefix (`type=upload` and root clause when set), is balanced in parentheses and quotes, and contains no unquoted user characters |
| CQ11 | Case, unicode and emoji in `q` pass through quoted and correctly JSON-encoded |
| CQ12 | Request is `POST` with `Content-Type: application/json` to the allow-listed API host and the exact cloud-name path; the proxy opt-in makes a `5xx` retry for the search POST (and not for anything else) |

### 1.2 Calls, auth and limits (AC2)

| ID | Behaviour asserted |
|---|---|
| CS1 | Outbound `Authorization` is exactly `Basic base64(key:secret)` from the secrets; no inbound `Authorization`, `Cookie`, `Host` or forwarded header is sent; the IMS token never leaves the worker |
| CS2 | Outbound host is the configured API host only; a `CLOUDINARY_API_HOST` outside the three documented hosts fails registration; redirects are not followed |
| CS3 | Detail: `GET .../resources/{asset_id}` with the same Basic header; id must match `^[0-9a-f]{32}$`; `..`, `%2f`, extra segments, uppercase, wrong length, public-ID-style ids -> `400`, zero upstream calls |
| CS4 | Detail of an asset outside the configured root returns `404 not_found` with no asset data |
| CS5 | Non-JSON body (HTML) on 200, 401, 403 or 5xx is never parsed or echoed -> the mapped status per CE table |
| CS6 | Per-provider config absent (cloud name, key or secret) -> provider omitted from `/dam/providers`, routes `404 provider_not_configured`, worker still starts, other providers work |
| CS7 | Response with an unknown extra field (including a field named like a secret) -> field absent from the normalised output |

### 1.3 Mapping and detail (AC1)

| ID | Behaviour asserted |
|---|---|
| CM1 | Image: `id`=`asset_id`, `name`=`display_name`, `type=image`, width, height, extension, fileSize, `warnings=[]` |
| CM2 | PDF (`resource_type=image`, `format=pdf`) -> `document`; MP3 (`resource_type=video`, `format=mp3`) -> `audio`; MP4 -> `video`; raw `.docx` -> `document`; font -> `other` |
| CM3 | Fixed-folder fixture: no `display_name` -> name from the last path segment of `public_id`; `folder` used for root checks |
| CM4 | `type` other than `upload` never appears (the query excludes it; a fixture row that slips through is dropped by the mapper as a belt-and-braces check) |
| CM5 | `access_control` non-empty, or `access_mode=authenticated` -> `insertable:false` with the access-restricted reason and still listed; `moderation_status=rejected` -> not insertable |
| CM6 | Non-https or non-allow-listed host in `secure_url` -> `insertable:false`; default allows `res.cloudinary.com`; `CLOUDINARY_DELIVERY_HOSTS` extends exactly the listed hosts |
| CM7 | Non-image with a good URL -> `linkUrl` and `insertable:true`, `renditions` empty; no thumbnail for audio/raw |
| CM8 | Dimensions of each rendition are `min(asset width, rendition width)` with proportional height; missing width -> rendition without dimensions |
| CM9 | Search response with missing optional fields, nulls, zero-length arrays -> still normalised without throwing |

### 1.4 Renditions, thumbnails, signing (AC1, AC2)

| ID | Behaviour asserted |
|---|---|
| CR1 | Default set: `web`, `large`, `medium`, `small` built by inserting the configured transformation between delivery type and version of the **API-returned** URL; `defaultRenditionId = web`; unchanged remainder of the URL (version, public ID, extension) |
| CR2 | `original` offered only for jpg, jpeg, png, gif, webp, avif, svg and equals the returned `secure_url`; a tiff/psd image gets derived renditions with automatic format but no `original` |
| CR3 | URL shape mismatch (no `/{resource_type}/{type}/`, missing `v{version}/`, different version) -> `insertable:false` "unrecognised URL"; no URL is synthesised from `cloud_name` or ids (the #22 RD5 rule: never invent a URL the API did not give) |
| CR4 | Public IDs with folders, spaces, unicode and dots survive byte-for-byte in the rendition URL |
| CR5 | `CLOUDINARY_RENDITIONS` override replaces the default list; invalid entries (characters outside the allowed set, too long, too many, duplicate ids) fail registration at start |
| CR6 | Signing off: no `s--` component anywhere |
| CR7 | Signing on: every transformed URL (renditions and thumbnails) contains `s--<8 url-safe base64 chars>--` immediately after the delivery type; the `original` URL is not altered |
| CR8 | **Known-answer vector:** transformation `c_fill,w_300,h_250/e_grayscale`, public ID `sample-authenticated`, extension `png`, secret `abcd`, SHA-1 -> signature `iDy_JeBq` (the value printed in https://cloudinary.com/documentation/delivery_url_signatures.md) |
| CR9 | SHA-256 mode produces a different, 8-character URL-safe signature (computed independently in the test with Node `crypto`), and SHA-1 remains the default |
| CR10 | The signed string is `<transformation>/<public_id>[.<ext>]` + secret, version excluded [ASSUMPTION; the test asserts the chosen rule and is amended if M-C6 shows otherwise] |
| CR11 | Public ID containing `%` with signing on -> `insertable:false` with a reason; without signing -> allowed (R5) |
| CR12 | The API secret and the digest input never appear in any response, header, log line or error (canary scan across all CR scenarios) |
| CR13 | Thumbnails: image thumbnail transformation applied and signed when signing is on; video and PDF thumbnails use the still-image forms; audio and raw have none |

### 1.5 Alt text (AC1)

| ID | Behaviour asserted |
|---|---|
| CT1 | `context.custom.alt` present -> `source: property` (default key `alt`); also accepts `context.alt` shape |
| CT2 | Custom `CLOUDINARY_ALT_CONTEXT_KEY` is honoured; the structured field `CLOUDINARY_ALT_METADATA_FIELD` (detail only) is used when configured and present, string only |
| CT3 | Alt absent, `caption` present -> `source: description` |
| CT4 | Both absent -> display name (or filename) without extension, separators to spaces (`Hero_Banner-2024.jpg` -> `Hero Banner 2024`), `source: name` |
| CT5 | Nothing usable -> empty value, `source: none` |
| CT6 | Markup, entities, control characters stripped; whitespace collapsed (same cases as #22 AT4) |
| CT7 | Alt text containing `"><script>` is returned as plain text (the shell builds the attribute safely; re-asserted in e2e) |

### 1.6 Errors, limits, cache (AC2)

| ID | Behaviour asserted |
|---|---|
| CE1 | Upstream `401` or `403` (JSON or HTML) -> `500 misconfigured`, fixed message, log line with provider id and class only, no `reauth` code, no credential or upstream text |
| CE2 | Upstream `420` with `X-FeatureRateLimit-Reset` 90 s ahead -> `429 rate_limited`, `Retry-After` about 90; header absent -> 60; reset in the past -> 1; reset over an hour away -> 3600; **no retry** on 420 (one upstream call) |
| CE3 | Upstream `429` behaves like 420 |
| CE4 | Upstream `5xx` / network failure: search POST is retried per the template schedule, exhausted -> `502 upstream_unavailable`; no upstream body in the response |
| CE5 | Upstream `400` -> `400 bad_request`; upstream `404` on detail -> `404 not_found`; upstream `409` -> `502` generic |
| CE6 | `Remaining` header at or below the low-water mark on a success -> the next request is refused early with `429 rate_limited` until `Reset` (no upstream call) [ASSUMPTION: threshold 20] |
| CE7 | 2xx with invalid JSON, or JSON of the wrong shape -> `502 upstream_unavailable`, never a thrown error |
| CC1 | Two identical searches within the TTL -> one upstream call; different `q`, `type`, `sort`, `page` or root -> separate calls |
| CC2 | After the TTL (injected `now`) the next identical search calls upstream again; `CLOUDINARY_CACHE_SECONDS=0` disables caching |
| CC3 | Detail responses are not cached beyond a single request; error responses are never cached |
| CC4 | The cache never mixes content across providers or across configuration (key includes cloud name and root) |

### 1.7 Security (AC2)

| ID | Behaviour asserted |
|---|---|
| CX1 | No user-controlled value can add a clause, close a quote, or remove `type=upload` or the root clause (replays the CQ3/CQ4/CQ10 corpus against the final expression, parsed by a small test-side tokenizer) |
| CX2 | Path safety: the cloud name and API host come only from configuration; the asset id is the only user value in an upstream path, regex-validated; nothing from the request `Host` or headers reaches upstream |
| CX3 | Canary scan across a matrix (search, detail, every CE status, signing on and off, every fixture): `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` and the Basic value appear in no response body, header, `Location` or log line (extends #22 TS6/SC3 and template US1) |
| CX4 | Every `/dam/cloudinary/*` path without a valid token -> `401`; disallowed `Origin` with a valid token -> `403` (template UA/UC re-asserted on these routes); unknown paths without a token -> `401` |
| CX5 | `{provider}` segment validation (`__proto__`, `constructor`, encoded variants -> `404`) and `userId`/`user` in query, headers or body ignored (#22 SC1/SC2 re-asserted for this provider) |
| CX6 | A fixture whose `secure_url` points at an attacker host, or uses `javascript:`/`data:`/`http:`, never yields an insertable URL |

### 1.8 Provider contract (AC3; seam P1)

| ID | Behaviour asserted |
|---|---|
| PC-C1 | Cloudinary registers with the **service** auth kind and declares capabilities, sorts and id pattern; a Cloudinary module missing a required member fails registration at start (#22 PC1) |
| PC-C2 | `search` output validates against the #22 normalised-summary schema and `getAsset` output against the detail schema (required keys, no extra keys, https URLs, type enum) on every fixture |
| PC-C3 | **Add-a-module proof, second provider:** registering Cloudinary (with the Bynder module present and the stub provider) requires **no change to shell code**, appears in `/dam/providers` as `connected: true`, is routable under its own id, and does not create token-store records or OAuth routes (#22 PC5) |
| PC-C4 | Missing required config or secret -> omitted from the list, `404 provider_not_configured`, other providers unaffected (#22 PC6); invalid optional config (bad API host, bad root, bad renditions JSON, bad algorithm) fails fast at registration with a message naming the setting and never the value |
| PC-C5 | Bynder and Cloudinary coexist: a Bynder connection record is invisible to Cloudinary and Cloudinary calls never use Bynder tokens, and vice versa |

## 2. End-to-end tests (S1; Playwright, Chromium, hermetic, no credentials)

Servers: static `:3000`; the real worker under `wrangler dev` `:8787` with `ALLOW_LOCALHOST=true`, test secrets from a temp env file, a fake IMS key server, and `fakeCloudinary` as a Node server (the worker's API host is overridden for the test environment; no Bynder configured). The #1 SDK stub supplies a token signed by the fake IMS key. The browser harness fulfils delivery-host image requests with a 1x1 PNG and records which hosts were requested.

| ID | Behaviour asserted |
|---|---|
| E2E-C1 | Open the picker: Cloudinary grid loads with **no connect prompt**; the fake request log shows the expected default expression, `max_results`, and Basic header (key and secret appear only there) |
| E2E-C2 | Search and type filter: log shows keyword and type clauses; thumbnails render; "Load more" appends and stops at `hasMore:false` |
| E2E-C3 | Select -> change rendition -> edit alt -> Insert: stub log shows `sendHTML` with exactly one `<img src alt>` whose `src` equals the chosen rendition URL, then `closeLibrary` |
| E2E-C4 | Token hygiene: page HTML, DOM, `localStorage`/`sessionStorage`, script-visible cookies and all network responses contain neither the key, the secret nor the Basic value; page never calls the Cloudinary API host |
| E2E-C5 | Rate limited: fake answers 420 -> the UI shows the rate-limit message with the wait honoured; no Reconnect prompt appears |
| E2E-C6 | Auth: direct `fetch` to `/dam/cloudinary/assets` with no token -> `401`; token from another key -> `401`; `?worker=` ignored |
| E2E-C7 | Non-image: select a PDF and an MP3 -> insertion produces one `<a href>` with the asset name; an access-controlled asset shows Insert disabled with the reason |
| E2E-C8 | Signing on: every thumbnail request and the inserted `src` carry `s--...--`; signing off: none |
| E2E-C9 | Only expected hosts contacted by the browser: page, worker, SDK stub, fake IMS, delivery host(s) |

(Shell UI behaviours already proven by #22's UI1-UI16 are not duplicated; E2E-C1 additionally proves the SG1 service-kind UI path.)

## 3. Runtime smoke (W2; Node test driving `wrangler dev`, no Cloudflare login)

| ID | Behaviour asserted |
|---|---|
| SM-C1 | The worker bundles and starts with Cloudinary configured and **without** the OAuth secrets/KV (if SG4 accepted); bare `/dam/providers` -> `401` |
| SM-C2 | Search against `fakeCloudinary` in workerd: Basic header correct, Web Crypto SHA-1 and SHA-256 signing works and matches the CR8/CR9 vectors, a 500-item response normalises; CPU/wall time and payload size recorded (informational; Free-plan 10 ms budget, R7/R8) |
| SM-C3 | In-isolate cache works across two requests in the same worker; `420` handling over real HTTP (headers preserved, `Retry-After` set) |

## 4. Repo checks (S3, extended)

| ID | Behaviour asserted |
|---|---|
| RC-C1 | The string `cloudinary` (any case) does not appear in shell, browser or core code outside `providers/cloudinary/`, tests, fixtures, docs, the single registry line, and the worker's wrangler config and `.dev.vars.example` (SG4 extends #22's RC1 allow-list); a fixture tree with a leak fails (**machine proof of AC3**) |
| RC-C2 | `providers/cloudinary/` has a worker module, fixtures with a recording README, a conformance registration and a matching README section in the extension README (extends #22 RC2) |
| RC-C3 | Registration footprint: the wrangler config declares `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` as secrets (required or optional per SG4), declares the non-secret vars with no secret-looking names, has no secret-looking value in `vars`; both secrets appear in `.dev.vars.example`; no tracked `.dev.vars*` (extends #22 RC4, #2 UR1-UR5) |
| RC-C4 | The extension README's Cloudinary section contains the required parts (shared-credential model, Cloudinary-side prerequisites, vars/secrets table, secret-put commands, signing guidance, limits and 500-window, local dev, privacy note) |
| RC-C5 | No file under `providers/cloudinary/` contains browser code or a `package.json`/wrangler config of its own (the provider is a module of the extension's worker) |

## 5. Manual end-to-end verification in EW and against real Cloudinary (needs interactive logins and a sandbox; cannot run in CI)

**Accounts and credentials needed:** GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, per #1); two Adobe IMS identities with access to the DA org/site (one with config-edit rights) and Chrome; a **Cloudinary Free-plan environment** (self-serve signup, per the Free plan referenced in admin_api_overview.md [ASSUMPTION: no card or sales contact needed, owner to confirm]) with its cloud name, API key and secret (Console Settings > API Keys); a **second environment (or the same, toggled) with Strict transformations enabled** (Console Settings > Security) for M-C6; Cloudflare account with Wrangler login. **Test assets** to upload: a public JPEG with `alt` and `caption` contextual metadata; one with only a caption; one with neither; a large PNG; a tiny image (to check no upscaling); a GIF; an SVG; a TIFF or PSD; a PDF; an MP4; an MP3; a raw file (e.g. `.txt`); an asset in a subfolder with spaces and non-ASCII in its name and one with non-ASCII public ID; an `authenticated`-type asset and a `private`-type asset (uploaded with that delivery type); an asset with token-based `access_control` if the plan allows; a structured metadata text field with a value (optional, for `CLOUDINARY_ALT_METADATA_FIELD`). Folder mode noted from the Dashboard or `GET config?settings=true` [VERIFIED: admin_api_config.md]; a legacy fixed-mode environment is a nice-to-have for R11.

- **M-C0 (prereq/liveness):** set the cloud name var and `wrangler secret put CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`; deploy; `curl -i <worker>/dam/providers` -> `401`; `wrangler secret list` shows names only. Proves AC2 (unauthenticated rejected on the deployed worker, secrets held by the worker).
- **M-C1 (sandbox contract checks, run first, record in the PR):** with `curl` and the sandbox credentials, confirm: search accepts `POST` with a JSON body (and what `GET` does); which `fields` names are accepted; the shape of `context` in a search result (`context.custom.alt` or `context.alt`); that `max_results=500` works on Free; the `X-FeatureRateLimit-*` headers on a search; the status for exceeding the limit (420) if it can be provoked safely; whether `ping` consumes quota; sortable fields (`public_id`, `created_at`, `display_name`). Settles R10/R11 and Questions 9 and 11. Record sanitised responses as the fixtures.
- **M-C2 (`ref=local`):** terminal A `npm start` (3000), terminal B worker dev (8787) with sandbox secrets in `.dev.vars`. Open an EW document with `?ref=local`; open **Multi-DAM Picker**: Cloudinary grid shows immediately with no Connect step; search a known keyword; filter to Images; open an asset; confirm default `web` rendition, alt prefill and its source label; insert; inspect the document source: one `<img>` with the chosen `src` and the alt; library closes. Proves AC1, AC5 (local).
- **M-C3 (type mapping and thumbnails):** confirm PDF appears under Documents, MP3 under Audio, MP4 under Videos, raw under Documents; thumbnails for image, video poster and PDF page render, audio/raw show the placeholder; record the working URL forms for video poster and PDF page (R13). Proves AC1 (type filter).
- **M-C4 (branch ref):** push `multi-dam-picker-cloudinary` (simple name), wait for code sync, add/adjust the library row `ref` to that branch (or use the main row), open the editor with `?ref=<branch>`, repeat M-C2 against the deployed worker. Record the page's real `Origin` and any CORS or local-network prompts (#2 R2/R11). Proves AC5 (branch ref).
- **M-C5 (publish round trip):** insert a `web` rendition and an `original`; preview and publish; open the published page in a private window with no Adobe or Cloudinary session: images load. Record whether EDS keeps the external URL and whether anything rewrites it (#22 R12). Proves "appropriate rendition URL".
- **M-C6 (strict transformations and signing):** in the strict-enabled environment, with `CLOUDINARY_SIGN_URLS=false`, insert a `web` rendition and confirm it fails (404/401 with `x-cld-error` header); set `true`, redeploy the var, insert again and confirm it loads anonymously. Repeat with SHA-256 if the account is SHA-256-only. Insert an asset whose public ID has spaces or non-ASCII characters and check signing behaviour (settles CR10/CR11, R5), and check whether `c_limit,w_1200,f_auto,q_auto` vs `c_limit,w_1200/f_auto/q_auto` matter. Proves AC2 (signed URLs generated server-side, secret never exposed) and AC1.
- **M-C7 (secret hygiene):** search DevTools Network responses, page source and Application storage for the API key and secret (none); confirm the page never contacts the Cloudinary API host; `wrangler secret list` names only. Rotate `CLOUDINARY_API_SECRET` (new secret in Console, `wrangler secret put`) and confirm the picker works after, and whether signed URLs inserted earlier under the old secret remain valid (record; Cloudinary behaviour on key rotation). Proves AC2, AC6.
- **M-C8 (negative checks on the deployed worker):** `Origin: https://evil.example` with a valid token -> `403`; no token -> `401`; token from another IMS client id (if the allow-list is set) -> `401`/`403`; search with adversarial `q` (quotes, `*`, `OR`, `-`, backslash) returns normal results scoped to the root folder only. Proves AC6.
- **M-C9 (scope and access):** set `CLOUDINARY_ROOT_FOLDER` and confirm assets outside it never appear in search and detail by id returns `404`; confirm `authenticated`/`private`/access-controlled assets are absent or not insertable with the reason. Proves AC1 (appropriate URL) and the documented authorisation model.
- **M-C10 (rate limit and README):** on the Free plan, perform repeated searches until the early-stop or 420 message appears (or simulate by lowering the threshold in a test deploy); confirm the UI message and recovery. A reviewer then follows the README Cloudinary section from a clean clone to a working local picker; any missing step is fixed in the PR. Proves AC4.

Record results and screenshots in the PR (the PR template asks for the branch-ref test URL).

## 6. CI additions (no credentials, no Cloudflare login)

| Job | Steps | Notes |
|---|---|---|
| `lint` (existing) | ESLint + Stylelint over extension and provider; `npm run check` runs RC1-RC5 and RC-C1-RC-C5 | |
| `unit` (existing) | WTR (shell UI tests; none added by this ticket unless SG1/SG3 add shell behaviour) | |
| `worker-unit` (from #2/#22) | Node tests: CQ, CS, CM, CR, CT, CE, CC, CX, PC-C plus the template's UA/UC/UP/US and #22's shell families | one job; conformance suite includes Cloudinary |
| `worker-smoke` (from #2/#22) | SM-C1-SM-C3 | advisory vs required per #2 Open Question 11 |
| `e2e` (existing) | static server + worker + fake IMS + `fakeCloudinary`; E2E-C1-C9 | Chromium only; upload traces on failure |

All run on every push and PR (#1 decision). Real-Cloudinary checks (M-C*) are manual; no Cloudinary credential is stored in CI.

## 7. Acceptance-criteria traceability (ticket #23)

| # | Acceptance criterion (#23, in the order of its checkboxes) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Author can browse and search Cloudinary, filter by type, and insert an image with an appropriate rendition URL and alt text from DAM metadata | CQ1-CQ12 (search/filter/sort/paging build), CM1-CM9 (type mapping, normalisation), CR1-CR5, CR13 (rendition and thumbnail construction, no upscaling, original only when displayable), CT1-CT7 (alt chain from `alt`/structured metadata/caption/name); shell UI4-UI11 re-run with Cloudinary data; E2E-C1, C2, C3, C7 | **M-C2** (browse, search, filter, insert, inspect `<img>` and alt), **M-C3** (type filter and thumbnails), **M-C5** (rendition loads anonymously after publish), **M-C6** (renditions work under strict transformations), **M-C9** (scope, restricted assets) |
| AC2 | Cloudinary API key/secret are held by the worker; signed requests are generated server-side | CS1, CS2, CS5 (Basic auth from secrets only, host pinned, IMS token not forwarded); CR6-CR12 (server-side URL signing, known-answer vector, secret never exposed); CX3 (canary scan); CE1; RC-C3 (secrets declared, none in vars/git); E2E-C4, E2E-C8; SM-C2 | **M-C0** (secrets by name, bare `curl` -> 401), **M-C6** (signed URLs load under strict transformations), **M-C7** (secret hygiene and rotation) |
| AC3 | Added inside the existing `multi-dam-picker` folder as a new provider; no changes needed in the shell beyond registering the provider | PC-C1-PC-C5 (conformance with the service kind, add-a-module with zero shell code change, isolation from Bynder), RC-C1 (no vendor leakage; machine proof), RC-C2, RC-C5 (provider folder complete, no browser code, no own tooling); E2E-C1 (provider appears in the existing panel with no shell change) | Review: the #23 pull request diff touches only `providers/cloudinary/`, the single registry line, the wrangler vars/secret names, `.dev.vars.example` and the extension README; SG1/SG4 (and chosen SG2/SG3/SG5) landed earlier in #22's stream, or F1 explicitly chosen; README "add a provider" checklist updated |
| AC4 | Extension README documents this vendor's setup (credentials, site config keys) | RC-C4 (required README parts), RC-C3 (documented names equal declared names) | **M-C10** (clean-clone walk-through); review: README lists every var and secret, states "site config read: none beyond the library row", and states the shared-credential model |
| AC5 | Works in EW with `ref=local` and with a branch ref | E2E-C1-C9 prove the page+worker contract on `localhost:3000`/`:8787` | **M-C2** (`ref=local`), **M-C4** (branch ref against the deployed worker, real `Origin`) |
| AC6 | Vendor credentials live only in this extension's worker (built from the shared template); the browser never receives them; unauthenticated calls to the worker are rejected | CX1-CX6, CS6, CE1, template UA1-UA14 (401 matrix), CX3 (no leakage), RC-C3, E2E-C4, E2E-C6; SM-C1 | **M-C0**, **M-C7**, **M-C8** |
| AC7 | Core logic covered by unit tests; lint and CI green | All of sections 1 and 4 run in `worker-unit` and `lint`; e2e and smoke jobs green | Review: CI green on the PR; deliberately break a rule on a scratch branch (let `q` bypass the character stripping, drop the `type=upload` clause, return the Basic value in an error) and see CQ3/CX1/CX3 fail |

(The AC numbers are this spec's labels for the seven checkboxes on #23, in order. The reachability criterion "listed in the repo README extensions table and reachable from the editor library" exists on #22, not #23; it is covered here only by E2E-C1 and #22's manual step M9, since this ticket adds no new row.)

Every acceptance criterion on #23 maps to at least one automated test and at least one numbered manual or review step above. (AC3 and AC7 are largely machine-proved; AC4's README quality is irreducibly a human review; strict-transformations behaviour in AC1/AC2 is only provable against a real Cloudinary environment, M-C6.)

## 8. Open questions for the owner

1. **Shell gaps SG1-SG5 (R1).** May the #22 shell be amended, additively, with: **SG1** a `service` provider kind (no OAuth routes, always connected, no token store), **SG4** per-provider optional secrets and a wider RC1 allow-list, and clarifications **SG3** (provider-declared id pattern; optional thumbnail) and **SG5** (providers may build vendor URLs from the documented grammar)? Optionally **SG2** (cursor paging wire fields) instead of the 500-result window? If you decline SG1, accept fallback F1 (every author clicks a pointless "Connect", records stored in KV)? The default recommendation is SG1 + SG4 + SG3 + SG5 now and SG2 only if the 500 ceiling bites.
2. **Cloudinary sandbox (affects every M-C step).** Is there a Cloudinary Free-plan environment I can use, and who owns it? Can I create a second environment with strict transformations enabled? Is a fixed-folder-mode environment available (legacy) for R11? Without them real verification (AC1/AC2/AC6) is blocked and fixtures cannot be recorded; hand-written fixtures are a poor substitute.
3. **Shared credential model (R2).** Is "every EW author who can reach the worker sees the same Cloudinary assets, scoped by an optional root folder" acceptable? Do you want a dedicated environment or a restricted API key for the picker, and a per-user allow-list (by IMS user id) in the worker as a follow-up?
4. **Rate limit exposure (R3).** The Free plan's 500 Admin API requests per hour are shared with any other tooling on that environment. Is a paid plan or a dedicated environment for production acceptable? Is the 30 s in-isolate cache plus the early-stop threshold (20 remaining) the right default, or do you want a per-user request limit?
5. **Strict transformations (R4).** Will the production environment have strict transformations enabled (then signing must be on)? Should the worker offer only `original` when signing is off and the account is strict (it cannot detect strictness today), or is a README warning enough?
6. **Per-user permissions vs build-your-own UI.** Cloudinary's Media Library widget would give per-user Cloudinary login and permissions but needs a seat licence per user, third-party cookies and loads vendor JavaScript. This spec builds the shared-credential grid consistent with #22 Decision 2. Confirm, or ask for a widget-based variant (which would not satisfy AC2 as written, since users authenticate in the browser).
7. **Rendition set and format (R5).** Are `web` (1200 px), `large` (2000), `medium` (800), `small` (400) and `original` the right defaults? Should `f_auto,q_auto` be on by default (it lets Cloudinary pick the format per browser; the published page then depends on Cloudinary's content negotiation)? Single-component or chained transformation strings (matters for allow-listing on strict accounts)?
8. **Template gap G5.** May the #2 template's `proxy` gain a `basic` auth scheme (key from one secret, password from another, composed value auto-redacted), or should the provider compose the header itself via the secret accessor and register the composed value for redaction?
9. **Undocumented search details (R10).** I could not confirm from docs: that search should be POST, which `fields` names are accepted, which `sort_by` fields are valid beyond `public_id`, `created_at` and `score`, and the `context` shape in search results. M-C1 resolves them with a sandbox; if you know any, tell me now.
10. **Policy and privacy (R16).** The worker will hold a production-capable media credential in a Cloudflare account that, per #1 R1/#22 Q13, is a personal one. Which account and who signs off? Should the README ship a rotation statement before real credentials are stored?
11. **Window and ordering.** Is a 500-result window per query acceptable for v1, and is `public_id` ascending acceptable for "name" sorting (Cloudinary sorts by the identifier, not the display name; displayed names in dynamic mode can differ)?
12. **Names.** Env var names (`CLOUDINARY_*`), the provider label `Cloudinary`, and the sort ids are proposals. The worker name and KV namespace are #22's. Confirm the `ORG`/`SITE` assumption (#1 R10).
