# Spec: Video Picker: Wistia (provider)

Ticket: jazhou-adobe/ew-extensions#14 (this spec: #52). Blocked by #13 (picker shell + Mux; spec `apps/video-picker/SPEC.md`), which is blocked by #1 (repo scaffold; spec `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec `shared/worker-template/SPEC.md`). Sibling vendor ticket: #15 (Brightcove).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1, #2 and #13 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from a vendor/Adobe.

Vocabulary follows #13: *extension* = one folder `apps/<name>/` (this one is the **library plugin** `video-picker`); *shell* = the provider-agnostic picker UI and insertion logic; *provider* = one video vendor's module (browser part plus worker part); *worker* = the per-extension backend built from the *template* (`shared/worker-template/`); *IMS token* = the Adobe IMS access token the DA App SDK hands the extension; *editor library* = the EW panel the plugin appears in. Added here: *media* = a Wistia object (Wistia's word for a video/audio/image/document); *hashed ID* = Wistia's public alphanumeric media identifier; *Data API* = `https://api.wistia.com/modern/...`.

This spec **implements against #13's provider/connector interface exactly** (list/search a page, `getEmbed`, provider error codes, registry, worker route + contract fixtures + conformance suite) and does not redesign the shell. Where #13's text is silent and Wistia needs something, the assumption is stated and collected in Open Questions 8 and 9.

Observations made on 2026-11-16 with `curl` and no Wistia account (cited later as **O1..O8**):
- **O1** `OPTIONS https://api.wistia.com/modern/medias` with `Origin: https://da.live` and `Access-Control-Request-Headers: authorization,x-wistia-api-version` returned `200`, `access-control-allow-origin: https://da.live`, `access-control-allow-headers: authorization,x-wistia-api-version`.
- **O2** `GET /modern/medias` with no token returned `401 {"code":"unauthorized_credentials","error":"Invalid credentials."}` with `access-control-allow-origin: *` and `www-authenticate: Basic realm="Wistia"`; an invalid Bearer token returned the identical `401` body.
- **O3** Responses carry `x-wistia-api-version-served: 2026-09`.
- **O4** `GET https://fast.wistia.net/embed/iframe/26sk4lmiix` returned `200` HTML with **no** `X-Frame-Options` header and `access-control-allow-origin: *`.
- **O5** `GET https://fast.wistia.net/oembed?url=https%3A%2F%2Fsupport.wistia.com%2Fmedias%2F26sk4lmiix` returned `200` JSON (iframe `html`, `thumbnail_url`, `duration`, `title`) with `access-control-allow-origin: *`.
- **O6** `GET https://embed-ssl.wistia.com/deliveries/56cacb9a5d6ea04b1f29defaf4b55d1ec979e1b0.jpg?image_crop_resized=320x180` with `Referer: https://da.live/` returned `200 image/jpeg`.
- **O7** `GET https://fast.wistia.net/embed/iframe/zzzzzzzzzz` (nonexistent ID) returned `200` with body `{"error":true,"iframe":true}`: a bad hashed ID cannot be detected from the HTTP status.
- **O8** `GET /modern/search?q=test` with no token returned the same `401` as O2.

---

## Problem Statement

A content author in Experience Workspace (EW) whose organisation hosts its marketing video in **Wistia** has to leave the editor, open Wistia, find the video, work out what to copy (the media page URL, the `fast.wistia.net` iframe URL, an async embed `<script>` snippet, a hashed ID) and paste it into a document in a form the site's embed block understands. Each step is error-prone: wrong ID, a media-page URL that does not embed, an embed snippet whose `<script>` is stripped by the editor, a hand-built table. Content-platform marketplaces solve this with an in-editor picker; Contentful's Wistia app lets editors "view your videos, search for the right video, and embed it directly" and lets admins "select which projects you want to include or exclude" [VERIFIED: https://www.contentful.com/marketplace/wistia].

For this repo the second problem is the one #13 already solved structurally: the video picker must not be forked per vendor. #13 built the shell and a provider contract with Mux as the first provider; #14 must now prove the contract by adding Wistia **as a new provider with no shell changes beyond registering it**.

Third, Wistia's listing API needs a secret token, and Wistia says explicitly not to put it in browser code: "Make sure that these tokens are kept secret! Do not put them in client-side code or commit them to a Github repository." [VERIFIED: https://docs.wistia.com/docs/making-api-requests]. Unlike Mux, Wistia's API *does* answer CORS preflights for `https://da.live` (O1), so a browser could technically call it with the token; that is exactly the trap, and the reason the credential must be held by the worker, never the page (#14 AC5).

## Solution

The existing **Video Picker** library plugin gains a second provider, **Wistia**. The author opens the editor library, opens *Video Picker*, picks *Wistia* in the provider switch the shell shows once more than one provider is registered, and sees a grid of videos from the connected Wistia account: thumbnail, title, duration, newest first. The author types in the search box to find a video by its title or by words spoken in it; the grid narrows. Loading more works for the browse list. Clicking a video inserts an **embed block** at the cursor (a link to Wistia's hosted player, `https://fast.wistia.net/embed/iframe/{hashedId}`) and closes the editor library. On preview the site's `embed` block renders the player in an iframe and the video plays (given the site prerequisites in Further Notes).

Under the hood, exactly the #13 split:

- A **browser provider module** implements the #13 contract: `list({query, cursor, signal})` returning `{items, nextCursor}`, `getEmbed(item)` returning `{url, title}`, provider errors with the fixed code set, plus the embed host allowlist the shell's single renderer enforces. It never calls Wistia and never holds a Wistia credential.
- A **worker route module** (registered into the extension's worker built from the #2 template) verifies the caller's IMS token first, then calls the Wistia Data API with the token held as a Cloudflare secret, and returns only a fixed projection of each media. The Wistia token travels as a plain `Bearer` credential, so the #2 `proxy` helper's native single-secret form fits with no template change (unlike Mux's precomputed Basic value).
- Registration is: one entry in the shell's provider registry, one route registration in the worker entry, and the worker's declarations of the new secret and variables. Everything else lives under the Wistia provider folder.

Around it: unit tests (browser provider, worker route), the shared contract fixtures and conformance suite from #13 run against Wistia, a hermetic Playwright run against the real local worker with a fake Wistia, a Wistia README section covering credentials and configuration, a documented set of site prerequisites for playback, and manual steps for verifying in real EW with `ref=local` and a branch ref.

## User Stories

Content author (EW end user):

1. As a content author, I want to choose *Wistia* in the Video Picker, so that I can use the video library my team actually uses.
2. As a content author, I want to see my Wistia videos as a grid of thumbnails with title and duration, so that I can recognise the right video at a glance.
3. As a content author, I want the newest videos first without any setup, so that the video I just uploaded is easy to find.
4. As a content author, I want a search box that finds videos by title, so that I can find one video in a large library.
5. As a content author, I want search to also match words spoken in the video, so that I can find a video I only remember by what was said.
6. As a content author, I want search to ignore upper/lower case and surrounding spaces, so that I do not have to guess how the title was typed.
7. As a content author, I want results to update as I type after a short pause, so that I do not have to press a button and do not see flicker of stale results.
8. As a content author, I want "Load more" to continue the newest-first list when the library is larger than one screen, so that large libraries are reachable.
9. As a content author, I want videos that are still processing or failed, archived videos, non-video media (audio, images, PDFs) and password-protected videos left out of the list, so that I cannot insert something that will not play.
10. As a content author, I want a video whose title is blank to still appear with a readable fallback label, so that it is not invisible.
11. As a content author, I want durations as `m:ss` or `h:mm:ss`, so that I can tell a clip from a webinar.
12. As a content author, I want one click on a video to insert an embed block at my cursor and close the editor library, so that I can carry on editing.
13. As a content author, I want the inserted content to be a normal embed block, so that I can move, delete and edit it like any other block.
14. As a content author, I want the video to play when I preview the page, so that I know the insertion worked.
15. As a content author, I want a plain "No videos found" or "no match" message, so that I know whether the library or my query is the issue.
16. As a content author, I want a short plain error with "Try again" when Wistia or the backend is slow, down or rate limited, so that I know whether to retry or contact the maintainer.
17. As a content author, I want a visible "session expired, reload the editor" message only when my own login token is rejected, so that a Wistia-side problem does not send me to log in again.
18. As a content author, I want the picker to stay responsive with a bounded wait and a visible loading state, so that the editor library never looks hung.
19. As a content author, I want the same keyboard support and narrow-panel layout as with Mux, so that switching vendor does not change how I work.
20. As a content author, I want video titles shown as text exactly as written (never as markup), so that an odd title cannot break the picker or the page.
21. As a content author, I want switching between Mux and Wistia to clear the search and the grid, so that I never see one vendor's results under the other's name.

Extension author (maintainer, or an agent working #15 or a later vendor):

22. As an extension author, I want Wistia added as exactly one provider folder plus one registration line plus worker declarations, so that the shell's "providers only add a module" promise is demonstrated and trusted.
23. As an extension author, I want Wistia to run the #13 conformance suite and use the #13 contract fixtures, so that I can see the pattern for #15 working end to end.
24. As an extension author, I want a fake Wistia server in the test kit, so that I can test the provider and the worker route with no Wistia account.
25. As an extension author, I want all Wistia-specific tests, fixtures and docs inside the Wistia provider folder, so that the vendor ticket touches one folder.
26. As an extension author, I want the Wistia README section to list every credential, variable and account-side setting, so that enabling Wistia on a site is copy-paste.

Maintainer / operator:

27. As the maintainer, I want the Wistia API token stored only as a Cloudflare worker secret, so that nothing credential-like exists in the repo, the page, the network log or the logs.
28. As the maintainer, I want the token to be a read-only token, so that a leak cannot create, modify or delete videos.
29. As the maintainer, I want unauthenticated calls to the worker rejected before any Wistia call is made, so that the internet cannot spend my Wistia rate limit (600 requests per minute per account) or enumerate my library.
30. As the maintainer, I want the worker to return only a fixed projection of each media (never the raw Wistia JSON), so that direct file URLs of the original upload, transcripts, descriptions, folder and custom-metadata values can never reach the browser.
31. As the maintainer, I want the option to restrict the picker to one Wistia folder, so that private or personal folders in the same account cannot be enumerated by every authenticated EW user.
32. As the maintainer, I want the Wistia API version pinned in worker configuration, so that a Wistia release cannot silently change response shapes.
33. As the maintainer, I want search and scan work bounded per request, so that one request cannot exhaust the Wistia rate limit or the Workers subrequest limit.
34. As the maintainer, I want CI (lint, unit, worker tests, convention check, e2e) to cover Wistia on every push and PR, so that regressions cannot merge.
35. As the maintainer, I want the site-side prerequisites for playback (an `embed` block, Wistia Domain Restrictions allow-list, CSP) documented in one place, so that "inserted but does not play" has a documented cause.
36. As the maintainer, I want password-protected, audio and non-video media clearly out of scope for v1 and documented, so that nobody expects them to work.

Security reviewer:

37. As a security reviewer, I want a test proving the Wistia token never appears in any worker response, header or log line across success and every error path, so that "browser never receives it" is tested rather than promised.
38. As a security reviewer, I want a test proving the worker's Wistia requests only go to the configured Wistia API host and carry the token only there, so that a bug cannot turn the worker into an open proxy.
39. As a security reviewer, I want user-supplied search text and cursors validated and length-capped before they reach the outbound URL, so that parameter injection (extra `per_page`, `folder_id`, `include`) is impossible.
40. As a security reviewer, I want the hashed ID validated against a strict pattern before it is used to build an embed URL, and the thumbnail URL restricted to https Wistia hosts, so that a malformed or hostile value cannot inject markup or redirect the iframe or image.

## Implementation Decisions

(No file paths or code. Paths and layout are in the Build Analysis. Every decision refines a #13 decision rather than replacing it; #13's numbers are cited as "#13 d<n>".)

**Shape and registration (AC2)**

1. **Wistia is a provider of the existing library plugin, not a new extension.** It adds no EW config-sheet row, no entry page and no library title: the existing `Video Picker` `library` row serves both vendors. Provider `id` is `wistia`, `label` is `Wistia`.
2. **Footprint outside the Wistia folder is exactly four registrations** and nothing else (#13 d5, #13 d29): (a) one entry in the shell's static provider registry, appended after Mux; (b) one route-module registration in the extension worker's entry (#2 d3, #13 d29); (c) the worker configuration's declaration of the new secret and non-secret variables, and the `.dev.vars.example` line for the secret (#2 requires secrets to be declared in the worker config); (d) one short section/link in the extension README (AC3). No shell logic (state machine, renderer, formatting, registry mechanics) changes. A repo check proves the vendor name appears outside the Wistia folder only in those places (test WR1).
3. **Dependency on #13 behaviour, stated as assumptions** (see Open Questions 8): the shell shows a provider switch when two or more providers are registered and resets query, cursor and grid on switching (#13 test PC6); the shell's embed renderer accepts only `https` URLs whose host is on an allowlist **declared by the active provider** (#13 d8: "the allowlist of hosts the active provider declares"), so Wistia declares its own; the contract-fixture shape checker and conformance suite accept a per-provider item/response shape.

**Provider contract (browser) (AC1, AC2)**

4. **Item mapping.** Each list item is `{ id, title, durationSeconds, thumbnailUrl, ref }` with `id` = the media's hashed ID, `ref` = the same hashed ID (the opaque value `getEmbed` understands), `title` plain text (blank titles already replaced by a fallback in the worker), `durationSeconds` number or `null`, `thumbnailUrl` an `https` URL on a Wistia host or `null`.
5. **`getEmbed`.** Pure and synchronous. Returns `{ url, title }` where `url` is Wistia's iframe embed URL built from the validated hashed ID on host `fast.wistia.net`, with no query parameters, and `title` the item's plain-text title. A hashed ID that fails validation throws a provider error with code `bad_response`. The embed host allowlist the provider declares is exactly `fast.wistia.net`. Rationale for the form: it is the documented "Fallback (iframe)" embed URL [VERIFIED: https://docs.wistia.com/docs/construct-a-wistia-embed-code, "Using a Template Approach (Fallback)": `https://fast.wistia.net/embed/iframe/<media-hashed-id>`], it is frameable (no `X-Frame-Options`, O4), and it renders through the Block Collection `embed` block's default branch, which turns any link into a lazily loaded full-width 16:9 iframe with `allowfullscreen` [VERIFIED: https://raw.githubusercontent.com/adobe/aem-block-collection/main/blocks/embed/embed.js, `getDefaultEmbed`]. Whether that default iframe (which sets `allow="encrypted-media"` but not `autoplay`/`fullscreen` permission policy, only the `allowfullscreen` attribute) plays and goes fullscreen with Wistia's player is not documented and is verified manually [ASSUMPTION; step VW5].
6. **Alternatives considered for the embed (not chosen).** (a) Wistia "Standard (async)" embed, a `<script>` plus `<div class="wistia_embed wistia_async_{id}">`: needs script injection, which the shell (data only, single block-table renderer, #13 d6/d8) and the editor schema will not carry. (b) The oEmbed endpoint (public, no token, O5) to fetch ready-made `html`: returns HTML plus a script, and adds a network dependency at insert time; rejected for the same reason, though its public thumbnail/duration data is noted for a possible future "paste a Wistia URL" mode (out of scope). (c) A media-page URL (`https://{account}.wistia.com/medias/{id}`): oEmbed accepts it, but the page is not an embeddable player and cannot be an iframe `src` [ASSUMPTION; not tested]. (d) Wistia's **Chooser** widget [VERIFIED beta, requires an access token in the page and asks beta users to contact beta@wistia.com: https://docs.wistia.com/docs/wistia-chooser]: puts a token in the browser, bypasses the provider contract, and is incompatible with channels; rejected on AC5 alone. (e) **Expiring access tokens** to give the browser a short-lived token: documented as "still under development and can change at any time", and aimed at iframe embeds and delegated permissions [VERIFIED description: https://docs.wistia.com/reference/post_expiring-token via the index at https://docs.wistia.com/llms.txt]; rejected as unstable and still requiring a minting backend.
7. **Hashed ID validation.** The same strict, letters-and-digits-only rule as Mux's playback ID (#13 d21), bounded in length (1 to 64 characters). Observed Wistia IDs are 10 lowercase alphanumerics (for example `26sk4lmiix`, `e4a27b971d`, `g5pnf59ala` in the docs); the docs only say "unique alphanumeric identifier" so the length and case are deliberately not pinned tighter [ASSUMPTION; widen only if a real ID fails step VW4].
8. **Thumbnails come from the worker.** Unlike Mux, a Wistia thumbnail URL cannot be derived from the ID; it is a content-addressed URL returned by the Data API in each media's `thumbnail.url` [VERIFIED field: https://docs.wistia.com/reference/get_medias]. The worker returns it, re-sized (decision 17); the browser provider accepts it only if it is `https` on a Wistia-owned host (`wistia.com` or `wistia.net` or a subdomain of either) and otherwise treats it as `null` (the shell shows its neutral placeholder). Thumbnails are loaded by the browser straight from Wistia's CDN with plain `<img>` (observed `200` with a foreign `Referer`, O6), carry no credential, and do not count against the API rate limit [VERIFIED: "Simply accessing a media asset ... does not count" refers to asset downloads, https://docs.wistia.com/docs/making-api-requests; thumbnails are served from `embed-ssl.wistia.com`, not the API host: ASSUMPTION that the same applies].
9. **Error mapping and worker origin** are exactly #13's (provider codes `unauthorized`, `rate_limited`, `unavailable`, `timeout`, `bad_response`, `aborted`; worker origin is a constant, loopback on `localhost`, fixed deployed origin otherwise, a `?worker=` parameter ignored; 15 s bound; IMS token sent only as `Authorization: Bearer` to the worker origin). The only Wistia-specific mapping lives in the worker (decision 20), so the browser sees `401` only when *its own* IMS token is bad.

**Worker route (AC1, AC5)**

10. **One route, `GET /wistia/medias`**, query `q` and `cursor`. Success: `200 { items: [{ id, title, durationSeconds, thumbnailUrl, createdAt }], nextCursor }`. Errors follow the #2 contract. The route is registered in the extension's one worker next to the Mux route; the two vendors' routes, secrets and variables are independent (a request to the Wistia route never reads the Mux secret and vice versa).
11. **Credentials.** The Wistia token is held as the Cloudflare worker secret **`WISTIA_API_TOKEN`**, declared in the worker's `secrets.required` list so a deploy without it fails (#2 d7). The route calls Wistia through the #2 `proxy` helper with the secret injected **by name** as `Authorization: Bearer <token>` [Bearer is the documented method: https://docs.wistia.com/docs/making-api-requests, "API authentication"; the #2 proxy's `auth: { secret, header, scheme }` contract covers it natively, so no template extension is needed here, unlike Mux's `MUX_BASIC_AUTH`]. Query-string token auth is deprecated by Wistia [VERIFIED: https://docs.wistia.com/docs/wistia-deprecation-schedule, "July 30, 2022: Authentication in query parameters"] and is never used. The caller's IMS token is never forwarded (#2).
12. **Token scope.** Read-only. Per the endpoint pages: listing media needs "Read all folder and media data"; **search needs "Read all data"** (an `all:delegate_to_contact_permissions` token also works for both) [VERIFIED: https://docs.wistia.com/reference/get_medias and https://docs.wistia.com/reference/get_search]. So the README tells the account owner to create a token with **Read all data**, which covers both calls and cannot write [permission labels as shown in the Wistia token UI are not verified; scopes `all:read` and `media:read` are documented for OAuth: https://docs.wistia.com/docs/authenticating-with-oauth2; ASSUMPTION that "Read all data" is a superset of "Read all folder and media data"]. Only the account owner can create and view API tokens, and a token can be copied only once at creation [VERIFIED: https://docs.wistia.com/docs/making-api-requests]. [OPEN: Question 2.]
13. **Pinned API version.** Every Wistia call is made to the modern path (`/modern/...`) with the `X-Wistia-API-Version` header, which the endpoint pages mark as required, set from a worker variable defaulting to `2026-09` [VERIFIED: https://docs.wistia.com/reference/get_medias; observed served version `2026-09`, O3]. Wistia supports a stable release for up to a year from its release date and serves the nearest supported version if an unsupported one is requested [VERIFIED: https://docs.wistia.com/docs/migration-from-v1-guide, "Version Stability Guarantees"], so the pin must be reviewed yearly (the legacy `/v1/` path is "evergreen" but "will never be updated with new features" and is "only recommended for existing users"; not used).
14. **Two data paths, chosen by the query.**
    - **Browse** (empty or whitespace-only `q`): `GET /modern/medias` filtered server-side to videos that are not archived (`type=Video`, `archived=false`), newest first (`sort_by=created`, `sort_direction=0`), `per_page` from a variable (default 50, Wistia maximum 100), with **cursor pagination** (`cursor[enabled]=1` for the first page, `cursor[after]=<cursor>` for later pages) [VERIFIED parameters and enums: https://docs.wistia.com/reference/get_medias ; "When using cursor pagination, only `id` and `created` are supported" for `sort_by`, and a cursor is only valid for the same sort ordering, which is a constant here]. The worker's `nextCursor` is the `cursor` property of the **last raw record** of the last scanned page (so post-filtering never skips a record), or `null` when the last page was short (fewer records than `per_page`) or empty. A trailing empty "Load more" can therefore happen once at the very end of a library whose size is an exact multiple of the page size; that is acceptable and documented (the Wistia list response is a bare array with no total or end flag [VERIFIED schema]).
    - **Search** (non-empty `q`): `GET /modern/search` with `q` and `resource_type[]=media`. It "searches through video transcripts" as well as names, returns `data.medias[]` among other resource types, and has **no pagination parameters** [VERIFIED: https://docs.wistia.com/reference/get_search; the only documented size bound is in the `custom_metadata` text: "The primary match set holds at most 100 media with no pagination; a non-blank q can add up to 100 more transcript-only matches": whether this bound applies to every search, not only that filter, is unstated ASSUMPTION]. The worker therefore returns `nextCursor: null` for search, applies the same projection and filters, and caps the output at a variable (default 100). Search order is whatever Wistia returns (relevance is not documented) and is not re-sorted [ASSUMPTION]. Only the `medias` array is read; `folders`, `subfolders`, `channels`, `channel_episodes`, `webinars` and every `transcript_matches` entry in the response are discarded in the worker.
    - Wistia's list endpoint has only an **exact** `name` filter (no substring or full-text) [VERIFIED: parameter description "Find a media or medias whose name exactly matches this parameter"], which is why search uses the Search endpoint and not a scan (unlike Mux, #13 d12). A `cursor` supplied together with a non-empty `q` is a client error (`400 bad_request`).
15. **Bounded scan for browse, no lost items.** Because `status = ready` and `protected` cannot be filtered server-side (only `type` and `archived` can), a browse page can contain items the worker must drop. So the worker follows #13 d14 for browse: it keeps fetching pages until it has at least a configured minimum of kept items (default 24), the library is exhausted, or a maximum number of Wistia calls (default 3) is reached, returns **all** kept items from every scanned page, and sets `nextCursor` as in decision 14. This bounds one request to at most 3 Wistia calls plus the IMS key fetch, far below the Workers Free plan's 50 subrequests and negligible against Wistia's 600 requests per minute per account [VERIFIED limits: https://docs.wistia.com/docs/making-api-requests; https://developers.cloudflare.com/workers/platform/limits/].
16. **Filtering and projection.** Keep a media only if it is a video (`type = Video`), is `ready`, is not archived, is not password-protected (`protected` is not true), and has a hashed ID [fields VERIFIED: https://docs.wistia.com/reference/get_medias]. Projection is a fixed allowlist: `id` (hashed ID), `title`, `durationSeconds`, `thumbnailUrl`, `createdAt` (Unix seconds from the ISO date-time `created`; `null` if unparsable). Title is the media's `name` when it has non-blank text, otherwise a fixed fallback built from the first 8 characters of the hashed ID (for example `Untitled video (26sk4lmi)`). Duration is `duration` when it is a finite non-negative number, otherwise `null`. **Never returned**, by construction of the allowlist: `assets` (direct-access URLs to the original upload and renditions), `embedCode` (deprecated), `description`, `folder`, `subfolder`, `section`, `tags`, `speakers`, `transcript_matches`, `custom_metadata_field_values`, the numeric `id`, `progress`, `updated`, and any other field.
17. **Thumbnail normalisation (worker).** The worker takes `thumbnail.url`, requires `https` and a Wistia-owned host (decision 8) and no credentials in the URL, drops any existing query string, and appends the documented resize parameter for a single fixed 16:9 size, `image_crop_resized=320x180` [VERIFIED parameter and example form: https://docs.wistia.com/docs/working-with-images; accepted by the CDN, O6]. Anything else gives `thumbnailUrl: null`. The exact shape of `thumbnail.url` in the modern response is not shown with a real value in the docs [ASSUMPTION: a `.../deliveries/<hash>.jpg?...` URL as in the oEmbed and Chooser examples; checked in build plan step 0].
18. **Optional folder restriction.** An optional worker variable `WISTIA_FOLDER_ID` (one folder hashed ID). When set, browse passes `folder_id` to Wistia, and search results are post-filtered to medias whose `folder_hashed_id` equals it [VERIFIED fields: `folder_id` parameter, https://docs.wistia.com/reference/get_medias; `folder_hashed_id` on search media results, https://docs.wistia.com/reference/get_search]. When unset the whole account is listed. Rationale: Wistia folders have their own access control and an account-level token sees all of them (Contentful's Wistia app has the same include/exclude-by-project control, https://www.contentful.com/marketplace/wistia); see risk R3.
19. **Inputs validated at the worker boundary** (as #13 d16): `q` trimmed, at most 100 characters (longer gives `400 bad_request`); `cursor` at most 512 characters from a conservative URL-safe set (letters, digits and `-_=.~:+/`) [Wistia documents the cursor as an opaque string; its alphabet is not specified: ASSUMPTION, widen if a real cursor fails VW4]; repeated or unknown parameters ignored or rejected as #2 defines. The outbound query is built by encoding validated values into a fixed parameter set; the host is fixed to the configured Wistia API origin; the path is fixed.
20. **Error mapping (Wistia-specific rule on top of #2's mapper).** Wistia `429` after the proxy's retries (it sends `Retry-After`) becomes `429 rate_limited` with `Retry-After` [VERIFIED: https://docs.wistia.com/docs/making-api-requests, "Rate limit"; and Wistia moved rate limiting from `503` to `429` in 2022, https://docs.wistia.com/docs/wistia-deprecation-schedule]. Wistia `401` (any of its documented machine codes `unauthorized_credentials`, `account_inactive`, `unauthorized_scope`, `unauthorized_params`) and `403` (token valid but the account lacks the feature, documented on the search endpoint) become **`502 upstream_unavailable`**, never `401`, because the caller's IMS login is fine and the browser must not tell the author to log in again; each logs a distinct outcome code for the operator (token rejected, scope insufficient, account inactive, forbidden) and never any Wistia body text. Any other Wistia failure, a network error, a non-JSON body, or a body whose shape is not what the endpoint documents (browse: a JSON array; search: an object with a `data.medias` array) becomes `502 upstream_unavailable`.
21. **Single tenant.** One deployed worker serves the one Wistia account its secret points to, to every authenticated EW caller that passes the #2 gates (#13 d20). Per-site or per-user Wistia accounts, and delegated "act with a team member's permissions" tokens, are out of scope. This is a security-relevant policy; see R3 and Open Question 4.

**UX behaviour specific to Wistia**

22. **No new UX.** Debounce, stale-response handling, loading/empty/no-match/error states, keyboard behaviour and layout are the shell's (#13 d23-d26). Search returning no `nextCursor` simply shows no "Load more". Because search results are capped and unpaged, the README states that a very broad query shows at most the first ~100 matches; narrowing the query is the remedy. The grid shows the title only; spoken-word matches are not explained (the contract has no snippet field).
23. **Provider order and default.** Registry order is Mux then Wistia; the first registered provider is the shell's default. The provider switch is shell behaviour (#13 PC6); Wistia contributes only its `id` and `label`.

**Documentation and repo conventions**

24. **README (AC3).** A dedicated Wistia README in the provider folder holds the full setup, and the extension README (owned by #13) gets a provider section that summarises it and links to it. Contents: creating a read-only token (who can, copy-once), `wrangler secret put` command that reads the token from stdin without shell history, the worker variables table, the optional folder restriction, local dev (`.dev.vars` and the local env), branch-ref testing, **account-side prerequisites** (Domain Restrictions allow-list, referrer policy), **site prerequisites** (`embed` block, CSP `frame-src`), an explicit statement that the provider reads **no DA site config, no query parameters, no cookies** (#13 d27; this is what AC3's "site config keys" resolves to: none, plus the existing `library` row that already enables the picker), unsupported media (protected, audio, channels) and the yearly API-version review.
25. **No cross-extension imports; vendor code stays in its folder** (#13 d29, d30). The worker route module imports only the shared template core, per #2's documented exception.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: what the author sees and which SDK actions fire given a stubbed SDK and a fake worker (browser side); which `Response` and which outbound Wistia requests happen given a `Request` and a fake Wistia (worker side). Never assert on internal helper names, module structure, CSS classes or call counts of internal functions. The two negative properties carry the most weight: "the Wistia token never appears anywhere outside the single outbound `Authorization` header" and "no Wistia call happens before auth succeeds". A third, new to this vendor: "no raw Wistia field outside the projection ever reaches the browser" (the raw media object carries direct file URLs).

**Proposed seams** (recorded here instead of asked, per #52). Every seam is reused from #13/#2/#1; the Wistia ticket adds **no new seam** (the ideal count). Only the fakes and fixtures are new.

| # | Seam (name in #13/#2) | Status | Used by | How the outside world is faked |
|---|---|---|---|---|
| S1 (primary, highest) | Entry HTML page + SDK module boundary with the real local worker behind it | reused (#1, extended in #13) | Playwright e2e | #1's `page.route` SDK stub supplies a token signed by the test IMS key; the extension worker runs under `wrangler dev` with `IMS_ORIGIN` and `WISTIA_API_ORIGIN` pointing at throwaway local Node servers (fake IMS, **fake Wistia**); thumbnails host routed to a tiny local image |
| S2 | Shell and provider logic modules + SDK result | reused | WTR unit tests | injected `fetch`; hand-built SDK result with recording `actions`; fake timers |
| W1 | The worker's HTTP boundary `worker.fetch(request, env, ctx)` | reused (#2, #13) | Node unit tests (`node:test`) | #2 test kit (`makeEnv`, `fakeIms`, canary secret) with `fakeUpstream` configured as a **fake Wistia** (path, query incl. bracketed parameters, `Authorization` and `X-Wistia-API-Version` aware; cursor-paged; scripted statuses) |
| W2 | Same worker in the real workers runtime | reused | smoke tier | `wrangler dev`, no Cloudflare login |
| C1 | Shared contract fixtures | reused from #13 (extended with Wistia sets) | W1 asserts its responses conform; S2 serves them as the fake worker's replies | static JSON plus the #13 shape checker, parameterised per provider |
| P1 | Provider conformance suite | reused from #13 | S2 for the Wistia provider | injected `fetch` |
| S3 | Repo convention check | reused (#1, extended in #13) | CI lint job | filesystem fixtures |

The real EW boundary (real IMS login, real `sendHTML` into the editor, real preview, real Wistia) is verified manually only.

**Modules tested:** the Wistia browser provider (mapping, embed URL, ID and thumbnail validation, error mapping, origin selection); the Wistia worker route (validation, auth ordering, browse paging and scan budget, search path, filtering, projection, thumbnail normalisation, folder restriction, error mapping, secret hygiene, route independence from Mux); the Wistia contract fixtures; the registration footprint check; the conformance run; the two-provider shell behaviour with Wistia registered.

**Prior art:** #13's tests MP*, MW*, CT*, PC*, SH*, EV* are the templates; this spec's tests are deliberately parallel (same shapes, Wistia semantics) so #15 can copy the pattern. #2's UA*, UC*, UP*, US* cover the template and are **not repeated**. Upstream `adobe-rnd/ew-extensions` has no worker or picker prior art [VERIFIED by #2's tree check]; its dependency-injection pattern (`fetchImpl`, `now`) in `tools/brand-visibility/session-auth.js` is the browser-side pattern.

## Out of Scope

- Other providers (Brightcove #15, and any other vendor); the shell, renderer, state machine and registry mechanics (#13).
- Uploading, editing, deleting, tagging or moving media; Wistia webhooks; the Upload API; analytics/stats; captions and transcript display; audio descriptions; localisations.
- Password-protected media, **Video Playback Protection**/SSO-gated playback (Enterprise feature [VERIFIED listing: https://wistia.com/pricing]), signed or expiring-token embeds, and Wistia **Channels** and channel episodes (Wistia formally supports its APIs for videos in folders, not channel episodes: https://docs.wistia.com/docs/construct-a-wistia-embed-code).
- Non-video media (audio, images, PDFs, Office documents).
- Webinars, even though Search returns them.
- OAuth2 (not available to all accounts, "contact us to get it enabled": https://docs.wistia.com/docs/authenticating-with-oauth2), per-user or per-site Wistia credentials, delegated team-member tokens.
- The **Standard (async)** and **popover** embed types, embed options (`autoPlay`, `playerColor`, `videoFoam`, `seo`, plugins) and the Player API; the picker inserts the plain Fallback (iframe) URL.
- A "paste a Wistia URL" mode using oEmbed; folder/collection browsing or filtering UI; sort options; multi-select; start time; poster/placeholder image in the block.
- Server-side caching, a title/transcript index, and Wistia custom-metadata filters.
- Shipping any site block, site CSP or Wistia Domain Restrictions change (the target site's and the Wistia account's responsibility; documented as prerequisites).
- Cloudflare deployment from CI; cross-browser e2e beyond Chromium; real-session e2e in CI.
- The Adobe outside-activity/IP question and the personal-Cloudflare-account question for handling a third-party vendor credential (owned by #1 R1 and #2 R1; carried by #13 R15).

## Further Notes

- **Site and account prerequisites for "plays on preview" (all outside this ticket's code):**
  1. The target site must have an `embed` block that renders unknown links as iframes (Block Collection's does). Same prerequisite and open question as #13 R1/OQ1; this spec inherits whatever #13 decides.
  2. If the Wistia account has **Domain Restrictions** enabled, the page that embeds the video must be on the account's allow-list or the player shows "Video not authorized to be embedded here"; matching walks parent domains, so allow-listing `example.com` covers `www.example.com` and every subdomain, entries are normalised (`www.`, `*.`, scheme stripped), and `wistia.com` pages, `fast.wistia.net` and active custom domains are always allowed [VERIFIED: https://docs.wistia.com/docs/using-wistias-domain-restrictions-with-a-referrer-policy]. For a page previewed on `{ref}--{site}--{org}.aem.page` (or `.aem.live`) the account owner must allow-list that host or its parent; allow-listing the shared parent `aem.page`/`aem.live` would authorise *every* site on that domain, which is a security trade-off for the owner [ASSUMPTION about which host the EW preview uses; observed in VW5].
  3. The embedding page's referrer policy must not be `no-referrer` or `same-origin`, or Domain Restrictions cannot be evaluated [VERIFIED: same page]. Whether the site's EDS pages set one is not checked here [OPEN].
  4. If the site sets a Content Security Policy, `frame-src` must allow `https://fast.wistia.net` (and `https://fast.wistia.com`) [VERIFIED: https://docs.wistia.com/docs/how-to-create-a-wistia-friendly-content-security-policy-csp].
- **The Wistia API speaks CORS.** Preflight from `https://da.live` succeeds (O1) and unauthenticated errors even carry `access-control-allow-origin: *` (O2). That is irrelevant to the design (the token is secret regardless) but it means the worker is **not** needed to dodge CORS, only to hold the credential and to project the response. This differs from Mux (#13 Problem Statement) and is worth stating so nobody "simplifies" by calling Wistia from the page.
- **Page size is unambiguous in Wistia's docs** (unlike Mux's, #13 d14): `per_page` has default and maximum 100 [VERIFIED: https://docs.wistia.com/docs/making-api-requests, "Paging"]; the worker passes `per_page` explicitly anyway.
- **No Wistia account was available to this spec.** All response shapes (the actual `thumbnail.url` value, `cursor` values, hashed-ID length, search result bounds and ordering, status/protected values on real media) come from the OpenAPI definitions on docs.wistia.com, not from a real response. Build plan step 0 is a one-hour spike with a real token to turn these [ASSUMPTION]s into fixtures.
- **A free Wistia plan probably suffices for a sandbox, unconfirmed.** Wistia's Free plan is $0, no credit card, 25 GB storage, 1 user, 3,000+ lifetime credits [VERIFIED: https://wistia.com/pricing]; Contentful's listing says its Wistia app needs "A Wistia account with any plan" and "A Wistia read only API token" [VERIFIED: https://www.contentful.com/marketplace/wistia]. Wistia itself does not state that API access and the Search endpoint are available on the Free plan [ASSUMPTION; spike in build plan step 0].
- **Current repo state:** `apps/video-picker/` contains only #13's `SPEC.md` (plus this folder); #1, #2 and #13 are specified but not implemented, so everything marked "reuse" presumes they have landed.
- **Brightcove (#15) readiness:** this spec confirms #13's prediction that the contract's "provider decides how to search" allows a vendor with real server-side search (Wistia Search) and one with a different credential form (Bearer here vs Mux's Basic).

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)
 └─ editor library panel
     └─ iframe: Video Picker page   (origin: https://{ref}--{site}--{org}.aem.live | .preview.da.live | http://localhost:3000)
          │  SDK handshake gives { token (IMS), context, actions }
          │
          │  shell ──list({query,cursor})──► provider switch ──► Wistia provider (browser)
          │                                                         │ fetch  Authorization: Bearer <IMS token>   (cross-origin, preflight first)
          │                                                         ▼
          │                         Cloudflare Worker (apps/video-picker/worker + providers/wistia/worker; core from shared/worker-template)
          │                            1 origin gate  2 IMS token check  3 route GET /wistia/medias
          │                            4 proxy ──Bearer WISTIA_API_TOKEN, X-Wistia-API-Version──► https://api.wistia.com/modern/medias   (browse)
          │                                                                                     └► https://api.wistia.com/modern/search   (search)
          │  click on a video: getEmbed(item) → { url: https://fast.wistia.net/embed/iframe/{id} } → shell renderer → block table HTML
          │       actions.sendHTML(html)  →  editor inserts at cursor ;  actions.closeLibrary()
          ▼
 page preview: site's `embed` block → <iframe src="https://fast.wistia.net/embed/iframe/{id}"> → Wistia hosted player
 thumbnails:   <img src="https://embed-ssl.wistia.com/deliveries/{hash}.jpg?image_crop_resized=320x180">  (browser → Wistia CDN, no credential)
```

| Concern | Browser extension (public static files) | Worker (private runtime, holds the secret) |
|---|---|---|
| Wistia credential | never | only place; `WISTIA_API_TOKEN` secret, injected by `proxy` |
| Identity | gets IMS token from SDK, sends as Bearer | verifies it (template) before any Wistia call |
| Wistia API calls (list, search) | none | all, host-locked to the configured Wistia API origin, version-pinned |
| Search semantics | debounce, stale handling, no "Load more" when `nextCursor` is null | chooses Search vs list, validates `q`/`cursor` |
| Which videos are shown | shows what the worker returned | drops non-video, non-ready, archived, protected; optional folder restriction |
| What leaves the worker | n/a | fixed projection only (no `assets`, transcripts, descriptions, folders) |
| Thumbnails | validates host, passes to `<img>` | normalises URL to a fixed size |
| Embed markup | descriptor to block table (shell's single renderer), `sendHTML`, close | none |
| Retries / 429 | retry UI | #2 proxy retries `429`/`5xx`; maps exhausted retries |
| CORS | none | #2 origin gate (`da.live` + site origins) |

## 2. EW integration points

- **Library plugin, not an app; no new row.** Wistia rides on #13's `library` row (`title` = `Video Picker`, `path` = `/apps/video-picker/video-picker.html`; resolution and `ref` behaviour per the #1 spec 2.5 and #13 section 2). The picker offers Wistia only after the registry holds it; enabling or disabling Wistia is a code change (registry line), not a sheet change (#13 d27: no site config read).
- **SDK surface used:** unchanged from #13: `token`, `actions.sendHTML`, `actions.closeLibrary`. No new SDK action.
- **`ref=local`:** page on `http://localhost:3000` calls the local worker at `http://localhost:8787`; the local env's `.dev.vars` carries `WISTIA_API_TOKEN` (a sandbox account's token) and the local env's `vars` carry `ALLOW_LOCALHOST` (#2 d5, d7).
- **Branch ref:** `https://{branch}--ew-extensions--jazhou-adobe.aem.live/apps/video-picker/video-picker.html` calls the **deployed** worker (which holds the production or sandbox `WISTIA_API_TOKEN`; one deployed worker serves Mux and Wistia, #2 d3).
- **Which page `Origin` is sent** remains the #2 R2 unknown; this ticket inherits #2's step W3 and #13's VW/V7 result.
- **Repo README row:** unchanged row for `video-picker`; its description may mention Wistia (one-line edit allowed, the S3 check keeps the row valid).

## 3. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| Wistia Data API `GET https://api.wistia.com/modern/medias` | browse: list media; params `per_page` (max 100), `cursor[enabled]`/`cursor[after]`, `sort_by` (`created`), `sort_direction` (`0` desc), `type`, `archived`, `folder_id`, `name` (exact only), `tags[]`, `hashed_ids[]`; response: bare JSON array of media with a `cursor` field when cursor pagination is on | `Authorization: Bearer <token>`, header `X-Wistia-API-Version` (required); permission "Read all folder and media data" | https://docs.wistia.com/reference/get_medias |
| Wistia Data API `GET /modern/search` | search names and transcripts: params `q` (required), `resource_type[]`, `tags[]`, `created_after`, `created_before`, `custom_metadata`; response `{ data: { folders, subfolders, medias, channels, channel_episodes, webinars } }`; no paging params; errors `400`, `401`, `403`, `500` | same; permission "Read all data" | https://docs.wistia.com/reference/get_search |
| Wistia rate limit | 600 requests per minute per account; `429` with `Retry-After` | n/a | https://docs.wistia.com/docs/making-api-requests |
| Wistia API versioning | `/modern/*` + `X-Wistia-API-Version`; stable release supported up to a year; unsupported version gets the nearest supported; `v1` evergreen but frozen | n/a | https://docs.wistia.com/docs/migration-from-v1-guide |
| Wistia access tokens | account owner creates them under Account Settings > API; copyable once at creation; never in client-side code | n/a | https://docs.wistia.com/docs/making-api-requests |
| Wistia iframe embed | `https://fast.wistia.net/embed/iframe/{hashedId}` | none (public media; Domain Restrictions apply) | https://docs.wistia.com/docs/construct-a-wistia-embed-code ; O4 |
| Wistia thumbnails | `image_crop_resized=WxH` on delivery image URLs | none | https://docs.wistia.com/docs/working-with-images ; O6 |
| Wistia Domain Restrictions | allow-list evaluated by the player from the embedding page's referer | n/a | https://docs.wistia.com/docs/using-wistias-domain-restrictions-with-a-referrer-policy |
| Wistia CSP guidance | `frame-src https://fast.wistia.net https://fast.wistia.com` | n/a | https://docs.wistia.com/docs/how-to-create-a-wistia-friendly-content-security-policy-csp |
| Block Collection `embed` block | default branch renders any link as an iframe | n/a | https://raw.githubusercontent.com/adobe/aem-block-collection/main/blocks/embed/embed.js |
| DA App SDK, #2 worker template, #13 shell | insert/close; IMS check, CORS, proxy, error contract; provider contract | IMS Bearer | `apps/video-picker/SPEC.md`, `shared/worker-template/SPEC.md`, https://da.live/nx/utils/sdk.js |

**Auth flows.** Browser to worker: SDK-supplied IMS token as `Authorization: Bearer`; verified offline (#2). Worker to Wistia: `Authorization: Bearer <WISTIA_API_TOKEN>` plus `X-Wistia-API-Version`, injected by `proxy`; the caller's token is never forwarded. Browser to Wistia CDN (thumbnails) and player (iframe on the preview page): no credential.

## 4. Data contracts

All are behaviour contracts, not code.

**Provider contract**: #13 d6 (unchanged). **Wistia item**: `{ id (hashed ID), title, durationSeconds, thumbnailUrl, ref (= hashed ID) }`. **Embed descriptor**: `{ url: https://fast.wistia.net/embed/iframe/{hashedId}, title }`. **Embed host allowlist declared**: `fast.wistia.net`.

**Worker route `GET /wistia/medias`**

| Aspect | Contract |
|---|---|
| Auth | `Authorization: Bearer <IMS token>`; per #2: missing/invalid `401`, disallowed origin `403`, preflight `204` |
| Query | `q` (optional, trimmed, max 100 chars; empty means browse), `cursor` (optional, max 512 chars from the conservative set; only valid when `q` is empty) |
| `200` body | `{ items: [{ id, title, durationSeconds, thumbnailUrl, createdAt }], nextCursor }`; `durationSeconds` number or `null`; `thumbnailUrl` https Wistia URL or `null`; `createdAt` Unix seconds or `null`; `nextCursor` string or `null` (always `null` for search); `Cache-Control: no-store` |
| Errors | #2 JSON `{ error: { code, message, requestId } }`; Wistia `429` to `429 rate_limited` + `Retry-After`; Wistia `401/403`, other upstream failures, malformed upstream bodies to `502 upstream_unavailable`; invalid `q`/`cursor`, or `cursor` with `q`, to `400 bad_request`; missing secret `500 misconfigured` |
| Never present | any Wistia field other than the projection; the Wistia token in any form; upstream error text; any `assets` URL |

**Worker configuration (wrangler `vars`, non-secret)**, in addition to #2's `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS` and #13's Mux variables:

| Name | Meaning | Production | Local/test env |
|---|---|---|---|
| `WISTIA_API_ORIGIN` | origin the route calls; the only allowed outbound host for this route | `https://api.wistia.com` | local fake in tests/e2e |
| `WISTIA_API_VERSION` | value of `X-Wistia-API-Version` | `2026-09` | same |
| `WISTIA_PAGE_SIZE` | Wistia `per_page` for browse | `50` | small (for example `3`) |
| `WISTIA_MIN_RESULTS` | stop scanning once this many kept items are collected | `24` | small |
| `WISTIA_MAX_PAGES` | max Wistia browse calls per request | `3` | small |
| `WISTIA_MAX_RESULTS` | cap on items returned for a search | `100` | small |
| `WISTIA_FOLDER_ID` | optional: restrict browse and search to this folder's hashed ID | unset (whole account) | set in tests |

**Secrets (`secrets.required`):** `WISTIA_API_TOKEN` (the raw Wistia API token), listed in the worker's `.dev.vars.example`. `WISTIA_API_ORIGIN` must not be set to anything but `https://api.wistia.com` in the production wrangler config (repo check WR5).

**Library row:** unchanged (#13). **Block markup contract:** unchanged shell form: header row `embed`; one content row; one cell; one `<a href="https://fast.wistia.net/embed/iframe/{hashedId}">` whose text equals the href.

## 5. Folder layout (proposed; fits #1, #2, #13)

```
apps/video-picker/providers/wistia/
├─ SPEC.md                    this file
├─ README.md                  Wistia setup: token, secret, variables, folder restriction, account + site prerequisites, local dev, branch ref, limits
├─ wistia.js                  browser provider (list via worker, getEmbed, ID/thumbnail validation, declared embed host)
├─ worker/                    Wistia route module (GET /wistia/medias): validation, browse/search, scan, filter, projection, error mapping
│   └─ test/                  W1 worker tests, fake Wistia
└─ test/
    ├─ unit/                  WTR tests: provider, conformance run, two-provider shell run
    ├─ fixtures/              Wistia contract fixtures (worker responses) + raw fake-Wistia pages (media list, search)
    └─ e2e/                   Playwright specs (fake Wistia server is started next to the fake Mux/IMS servers)
```

Files **outside** this folder touched by #14 (the complete list; anything else in the PR diff fails review, test WR1): the provider registry (one entry), the extension worker's route list (one registration), the worker's wrangler config (secret + variables) and `.dev.vars.example` (one line), the extension README (one provider section/link), and, if #13's WTR glob or e2e config does not already pick up `providers/*/test`, the repo test configs (a glob widening; see risk R10). The #1 `.hlxignore` already hides `**/test/` and `**/worker/` from the code bus.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **"Plays on preview" depends on three external settings**: the site's `embed` block (#13 R1), the **Wistia account's Domain Restrictions allow-list** covering the preview/live host, and a compatible referrer policy and CSP. Any one missing gives an inserted-but-unplayable video. | High (AC1 "plays") | README prerequisites; manual VW5 tests with Domain Restrictions off and on and records the host that needs allowing; [OPEN] owner decides who manages the Wistia allow-list and whether to allow-list a shared parent domain (OQ6). |
| R2 | **The Search endpoint is unverified against a real account**: permission needed is "Read all data" (broader than list), plan/feature availability (a documented `403` exists for features the plan lacks), result bound (up to 100 + 100 transcript-only, stated only under `custom_metadata`), ordering unknown. If Search is unavailable, AC1's "search" has no server-side path (the list endpoint has only exact-name filtering). | High (AC1) | Build plan step 0 spike with a real token before any code. **Contingency (only if the spike fails):** replace the search path with a bounded worker-side scan of the browse pages matching name/description substrings (the #13 d12-d14 design, already specified and tested for Mux), behind a worker variable; the spec's tests WW11-WW13 are then replaced by the Mux-style scan tests. Triggered by an owner decision on OQ3, not silently. |
| R3 | **An account-level token sees every folder, including private/personal ones.** Any authenticated EW user passing #2's gates can list titles and embeddable IDs of the whole account. Wistia folders have their own sharing controls, so this is worse than Mux's single environment. Inherits #2 R3 and #13 R3. | High | Optional `WISTIA_FOLDER_ID` restriction (decision 18, tests WW22-WW23); #2 client-id allowlist and `authorize` hook; documentation; owner decides policy and whether one folder is enough (OQ4). |
| R4 | **Response shapes come from OpenAPI, not a real response**: `thumbnail.url` form, cursor alphabet and presence, hashed-ID length, whether `archived`/`protected` appear on search results. | Medium | Spike (step 0) records real samples as fixtures; validation patterns are conservative and widenable; marked [ASSUMPTION] throughout. |
| R5 | **Rate limits**: 600 requests per minute per account, shared with every other Wistia API user of the account (including other integrations). A burst of searches (one call each, debounced) or scans (max 3 calls) is small, but the budget is not ours alone. | Low-Med | 300 ms debounce + abort (shell), call budget, `429` retried by the #2 proxy and then surfaced as a friendly retry message; the README notes the shared budget. |
| R6 | **Large list payloads on the Workers Free plan.** The list response has no field selection (the parameter list has none [VERIFIED]); each media carries an `assets` array. 3 pages x 50 medias could be a few hundred KB of JSON parsed within 10 ms CPU. | Low-Med | Page size is a variable; smoke test WS5 measures CPU and wall time for a worst-case scan with realistic payloads (the spike supplies a realistic one); default page size lowered if needed; paid plan is an owner decision (#2 R7). |
| R7 | **Wistia API version lifecycle**: `2026-09` is supported for about a year; after that Wistia serves the "nearest supported" version, which may change shapes silently; `v1` is frozen. | Medium over time | Version pinned in a variable and documented in the README with a review date; the contract test (WW/WC) fails on shape drift in fixtures but cannot detect a server-side version change: manual yearly re-verification (README checklist item). |
| R8 | **Wistia `401` ambiguity**: invalid token, insufficient scope (`unauthorized_scope`), inactive account and bad parameters all arrive as `401`. Mapping them to `502` hides the cause from the author (intended) but operators need the cause. | Low-Med | Distinct log outcome per machine `code` (no body text); manual VW6 revokes the token and checks the author sees the generic retry message and the log shows the outcome. |
| R9 | **Wistia only formally supports videos in folders**, not audio or channel episodes; items from channels may appear or not in the list; embedding them may fail (oEmbed returns `501` for non-embeddable media). | Low | `type=Video` filter, documented unsupported cases; manual VW4 includes an audio file and (if the plan has them) a channel video to record behaviour. |
| R10 | **Test wiring that #13 may not cover**: WTR/Playwright globs for nested `providers/<vendor>/test/`, the contract-shape checker being Mux-specific, the S3 convention check treating `providers/<vendor>` as sub-structure, the shell's provider switch and embed-host allowlist actually existing. | Medium | Build plan step 0 re-reads the merged #13; each mismatch is a small additive change to #13's *shared test support* flagged in the PR as "support for vendor tickets", or raised to the #13 owner; no shell logic change. [OPEN] OQ8. |
| R11 | **The default `embed` block iframe may not give Wistia fullscreen/autoplay-permissions** (it sets `allowfullscreen` and `allow="encrypted-media"` only). | Low-Med | Manual VW5 verifies play and fullscreen; if fullscreen fails the remedy is a site-block change, not a picker change (documented); [ASSUMPTION] it works. |
| R12 | **Hashed-ID/length assumptions and the cursor alphabet** (decision 7, 19) could reject legitimate values. | Low | Validation is strict-but-wide; manual VW4 with real IDs/cursors; widen if needed. |
| R13 | **Dependency on #1/#2/#13 landing** and on the #2 `proxy` `auth` shape supporting `Bearer` with a named secret. | Medium | Step 0 re-reads the merged template API; mismatch is raised to the template owner, not patched here. |
| R14 | **Titles and spoken-word search text are vendor-controlled input**; Wistia names can be edited by any Wistia collaborator. | Medium | Titles only via `textContent` (shell, #13 R11); the worker never returns descriptions or transcript text; fixtures contain markup payloads (WW/WP/CT). |
| R15 | Inherits #1/#2/#13 policy risks: Adobe outside-activity/IP, personal Cloudflare account holding a third-party credential, Code Sync + DA naming. | High for publishing | Owned by #1 R1/R3/R10, #2 R1, #13 R15; the Wistia README repeats the third-party-credential note. |

## 7. Ordered build plan (sized to #14's acceptance criteria)

0. **Prerequisites and spike (owner + implementer).** #13 merged (shell, registry, provider switch, conformance suite, contract fixtures, Mux worker route, fake-server pattern); #1/#2 merged and the hello worker verified. Owner provides a Wistia account (Free plan acceptable) and a **Read all data** token (the owner is the only person who can create it). With that token, one hour of `curl` against `/modern/medias` (cursor pagination, filters, a short page) and `/modern/search` (including a transcript-only match and a protected/archived media) to record: real `thumbnail.url`, `cursor`, hashed-ID shape, search bounds/order, and whether Search works on the plan. **Gate:** if Search is unavailable, stop and take OQ3 to the owner before step 3. Also re-read the merged #13 against the assumptions in decision 3 and risk R10, and the #2 template's real `proxy`/redaction/test-kit API (R13).
1. **Contract first (AC1, AC2).** Write the Wistia contract fixtures (browse page, last page, empty, blank-title, search results, long title, markup in title) from the spike's real shapes, plus the raw fake-Wistia pages (with `assets`, `transcript_matches`, `description`, folders) used to prove projection. Add them to the conformance run; failing tests first.
2. **Browser provider, test-first (AC1, AC2, AC5).** `list` via the worker with Bearer, item mapping, `getEmbed`, hashed-ID and thumbnail validation, declared embed host, error mapping. Tests WP1-WP9. Register it (registry entry) only when WP* pass; this is footprint item (a).
3. **Worker route, test-first at W1 (AC1, AC5).** Input validation; browse with cursor + scan budget; search path; filtering; projection; thumbnail normalisation; folder restriction; error mapping; route registration (footprint item (b)); worker config for secret and variables (item (c)). Tests WW1-WW25 against the fake Wistia; contract fixtures verified (WC).
4. **Runtime smoke (W2).** WS1-WS5 under `wrangler dev` with fake IMS/Wistia; measure calls and CPU (R6).
5. **E2E (S1).** Add the fake Wistia server to the Playwright config; WE1-WE10 against the real local worker, including a Mux+Wistia switch.
6. **Docs and repo integration (AC3, AC6).** Wistia README, extension-README provider section (footprint item (d)), `.dev.vars.example` line, README table description tweak; repo checks WR1-WR5; lint; CI jobs green.
7. **Deploy and manual verification in EW (AC1, AC4, AC5).** `wrangler secret put WISTIA_API_TOKEN` (stdin), deploy the worker (the one worker now carries both vendors' secrets), run VW0-VW9 on `ref=local` and a branch ref, record the observed host that needed Domain Restrictions allow-listing, the table shape that worked (from #13's V3), and screenshots in the PR and READMEs.
8. **Hand-off notes for #15.** In the Wistia README's "pattern" paragraph and the PR description: what a second vendor needed (one folder, four registrations, test-support tweaks found in R10), so #15 can estimate itself.

---

# Testing Requirements

## 1. Test IDs and layers

IDs are local to this spec and use vendor-specific prefixes so they cannot collide with #13's (`EM`, `SH`, `PC`, `MP`, `CT`, `MW`, `SMV`, `EV`, `UR-V`, `V`): **WP** Wistia browser provider (seam S2), **WC** contract fixtures (C1), **WW** Wistia worker route (W1), **WS** smoke (W2), **WE** end-to-end (S1), **WR** repo checks (S3), **VW** manual verification in EW. Template behaviour (#2's UA/UC/UP/US) and shell behaviour (#13's SH/EM) are **not repeated**; they are exercised through Wistia only where a Wistia-specific property is at stake. #13's `PC1`-`PC6` and `SH*` suites are *re-run* with Wistia registered (WP9, WE6).

## 2. Browser tests: Wistia provider (seam S2, `@web/test-runner`)

Fixtures/mocks: #1's SDK stub (records `sendHTML`, `closeLibrary`; token `stub-token`); an injected `fetch` that serves the Wistia contract fixtures; fake timers.

| ID | Behaviour asserted | Proves |
|---|---|---|
| WP1 | `list` sends `Authorization: Bearer <sdk token>` to the worker origin's `/wistia/medias`, with `q` and `cursor` only when set; no other credential-bearing headers; **no request to any `wistia.com`/`wistia.net` host** | AC1, AC5 |
| WP2 | A worker `200` fixture maps to items: `id` and `ref` equal the hashed ID; `title` and `durationSeconds` carried; `thumbnailUrl` kept only when `https` on `wistia.com`/`wistia.net` (or subdomain): `http:`, `data:`, `javascript:`, `https://wistia.com.evil.example/x.jpg`, `https://evil.example/wistia.com/x.jpg`, credentialed and malformed URLs become `null` | AC1, AC5 |
| WP3 | `getEmbed` returns `{ url: "https://fast.wistia.net/embed/iframe/<id>", title }` for valid IDs, with no query string; IDs outside letters/digits or empty or over 64 characters (`../`, spaces, `?x=1`, `"`, `<`, newline) throw a `bad_response` provider error and produce no URL | AC1, AC5 |
| WP4 | The provider's declared embed host allowlist is exactly `fast.wistia.net`; the shell renderer (real one, #13) accepts the Wistia descriptor and rejects `fast.wistia.net.evil.com`, `evilfast.wistia.net`, `http://fast.wistia.net/...`, `https://fast.wistia.com/...` (not declared), credentialed URLs | AC1, AC2 |
| WP5 | Status/code mapping: worker `401` to `unauthorized`; `403 forbidden_origin` to `unavailable`; `429` to `rate_limited` (retry-after as data); `502`/`5xx`/network failure to `unavailable`; no response within the bound to `timeout`; non-JSON or wrong-shape body (missing `items`, wrong types, extra raw-Wistia-looking fields) to `bad_response` | AC1 |
| WP6 | A page URL with `?worker=https://evil.example` is ignored; on `localhost` the worker origin is the loopback worker, elsewhere the fixed deployed origin (the same shared helper as Mux; one assertion through the Wistia provider) | AC4, AC5 |
| WP7 | No request made by the provider contains a credential-like value: inspects all headers and URLs of every injected `fetch` call; the canary Wistia token never appears in any DOM, console line or request | AC5 |
| WP8 | `list` honours an abort signal (rejects with `aborted`) and a late response after abort is dropped | AC1 |
| WP9 | **Conformance and two-provider shell:** the #13 conformance suite passes for Wistia (`list` shape, unique ids, `https`-only thumbnails, pure/sync `getEmbed`, provider-error-only rejections); with Mux and Wistia both registered the shell shows a provider switch, defaults to Mux, selecting Wistia resets query, cursor and grid, and the #13 shell suite (SH*) passes unchanged | AC1, AC2 |
| WP10 | Titles containing `<script>`, `<img src=x onerror=...>`, `"`, `&` render as visible text in the grid (through the real shell) and never reach the block table unescaped on insert | AC1, AC5 |

## 3. Contract fixtures (seam C1)

| ID | Behaviour asserted | Proves |
|---|---|---|
| WC1 | Every Wistia fixture (browse page with `nextCursor`, last page with `nextCursor: null`, empty, blank-title fallback, search result, long title, markup title, null duration/thumbnail) validates against the #13 shape checker configured for the Wistia item shape (`id`, `title`, `durationSeconds`, `thumbnailUrl`, `createdAt`; no extra fields) | AC2, AC5 |
| WC2 | Worker tests (WW*) assert their responses equal/conform to the same fixtures, so a worker shape change fails the worker suite **and** the provider suite (WP2) | AC2 |
| WC3 | The checker **rejects** a fixture containing any non-projected field (`assets`, `embedCode`, `description`, `folder`, `tags`, `transcript_matches`, `hashed_id`, numeric Wistia `id` as a separate field, `custom_metadata_field_values`): the machine form of "raw Wistia JSON never reaches the browser" | AC5 |
| WC4 | The raw fake-Wistia fixtures are never served to the browser provider tests (a lint-style test asserts provider tests import only the projected fixtures), so the browser tests cannot pass on raw data by accident | AC5 |

## 4. Worker tests (seam W1, `node:test`, in `providers/wistia/worker/test/`)

Fixtures/mocks from the #2 test kit: `makeEnv` (production-like; canary `WISTIA_API_TOKEN` such as `canary-wistia-<random>`; Wistia variables set small: page size 3, min results 4, max pages 3, max results 5), `fakeIms` (`signToken`), `fakeUpstream` configured as a **fake Wistia**: matches `GET /modern/medias` and `GET /modern/search` only; checks `Authorization: Bearer <canary>` and `X-Wistia-API-Version`; parses bracketed parameters (`cursor[enabled]`, `cursor[after]`, `resource_type[]`); honours `per_page`, `type`, `archived`, `sort_by`, `sort_direction`, `folder_id`; serves a scripted library (videos ready/queued/processing/failed, protected, archived, audio, image, blank and missing names, null durations, with `assets` containing direct file URLs, `embedCode`, `description`, folder objects, tags, and search results with `transcript_matches` and sibling `folders`/`channels`/`webinars`); each record carries a `cursor` when cursor pagination is requested; `sleep`, `random`, `now` injected.

| ID | Behaviour asserted | Proves |
|---|---|---|
| WW1 | No token: `401`; fake Wistia received **zero** requests | AC5 |
| WW2 | Browse, first page: exactly one Wistia call to `<WISTIA_API_ORIGIN>/modern/medias` with `type=Video`, `archived=false`, `sort_by=created`, `sort_direction=0`, `per_page=<WISTIA_PAGE_SIZE>`, `cursor[enabled]=1`, header `Authorization: Bearer <canary>`, header `X-Wistia-API-Version` equal to the configured value (default `2026-09`), no caller `Authorization`; response `200` conforming to the fixture | AC1, AC5 |
| WW3 | Browse continuation: a returned `nextCursor` sent back as `cursor` produces `cursor[after]=<cursor>` and no `cursor[enabled]`; the continuation returns the records after it | AC1 |
| WW4 | Projection: every item has exactly `{ id, title, durationSeconds, thumbnailUrl, createdAt }`; a string search of the whole body finds none of: any `assets[].url`, `embedCode`, description text, folder name, tag names, transcript text, `custom_metadata`, the numeric Wistia `id` | AC5 |
| WW5 | Filtering: `status` other than `ready`, `protected: true`, `archived: true`, `type` other than `Video`, and records without a hashed ID are dropped; `protected: null` and `protected: false` are kept | AC1 |
| WW6 | Titles: non-blank `name` used as is (inner whitespace kept, outer trimmed); blank, whitespace-only and missing name give `Untitled video (<first 8 chars of hashed id>)`; a 600-character name is passed through unchanged (the shell clamps) | AC1 |
| WW7 | Duration: finite non-negative number carried; `null`, absent, negative, `NaN` string give `null`; `createdAt` parsed from ISO date-time to Unix seconds, unparsable gives `null` | AC1 |
| WW8 | Thumbnails: a Wistia delivery URL with an existing query is rewritten to `<same path>?image_crop_resized=320x180`; `http:`, a non-Wistia host, a look-alike host (`wistia.com.evil.example`), a URL with credentials, and a missing `thumbnail` give `null` | AC1, AC5 |
| WW9 | Scan budget (page size 3, min 4, max 3): stops when at least 4 items are kept, when a short page ends the library, or at 3 calls, whichever comes first (three scenarios); never exceeds the call budget; `nextCursor` equals the `cursor` of the **last raw record** of the last scanned page when that page was full, `null` when it was short or empty | AC1 |
| WW10 | No lost or duplicated items: following `nextCursor` repeatedly over a scripted library with mixed kept/dropped records yields every kept item exactly once, in newest-first order, for several page sizes; a library whose size is an exact multiple of the page size ends with one empty page and `nextCursor: null` | AC1 |
| WW11 | Search: a non-empty `q` (padded, mixed case) is trimmed and sent as `q` with `resource_type[]=media` to `/modern/search` (and **no** call to `/modern/medias`); items come from `data.medias` only, with the same filters and projection; `folders`, `channels`, `webinars` and `transcript_matches` in the upstream body never appear in the response; `nextCursor` is `null` | AC1 |
| WW12 | Search cap and order: more than `WISTIA_MAX_RESULTS` kept results are truncated to that many in upstream order; zero matches give `items: []`, `nextCursor: null` (not an error) | AC1 |
| WW13 | Whitespace-only `q` behaves as browse; `q` with a `cursor` gives `400 bad_request` and no Wistia call | AC1, AC5 |
| WW14 | Input validation: `q` over 100 characters; `cursor` over 512 characters or with characters outside the allowed set (`&`, space, `%`, `?`, `#`, `\`); repeated `q`/`cursor` parameters give `400 bad_request` and no Wistia call; a `q` containing `&per_page=100&include=speakers&folder_id=x` cannot alter the outbound query (the outbound query has exactly the expected parameters, `q` carrying the literal text) | AC5 |
| WW15 | Canary property test: across success, empty, every error path (Wistia `401` with each machine code, `403`, `429` exhausted, `500` exhausted, network error, malformed JSON, wrong-shape JSON, missing secret) and a fake Wistia that echoes the `Authorization` header in an error body and in a `thumbnail.url`, the canary token does not appear in any response body, response header or captured log line | AC5 |
| WW16 | Wistia `429` then `200`: retried by the #2 proxy (injected `sleep`, `Retry-After` honoured), final `200`; always `429`: `429 rate_limited` with `Retry-After`, no upstream text | AC1 |
| WW17 | Wistia `401` (each of `unauthorized_credentials`, `account_inactive`, `unauthorized_scope`, `unauthorized_params`) and `403`: response is `502 upstream_unavailable` (never `401`); the log carries a distinct outcome code per case; body contains no Wistia text | AC1, AC5 |
| WW18 | Wistia `5xx`/network error exhausts retries: `502`; non-JSON body, a JSON object where an array is documented (browse), or an array where an object is documented (search), or `data.medias` missing: `502`; a record of the wrong type inside the array is skipped or rejected consistently (one documented behaviour, asserted) | AC1 |
| WW19 | Host safety: a `302` from the fake Wistia is not followed and the token is never sent to another host; `WISTIA_API_ORIGIN` pointing at a non-`https` non-loopback host throws before any fetch | AC5 |
| WW20 | Missing `WISTIA_API_TOKEN` secret: `500 misconfigured` generic; log names the secret, never a value; no Wistia call | AC5 |
| WW21 | Template integration through this worker's real config: disallowed origin with a valid token gives `403` and no handler/Wistia call; `OPTIONS` from an allowed origin gives `204` without a token and without a Wistia call; exactly one Wistia route exists (`GET /wistia/medias`); other methods on it give `405`; unknown routes give `404` with a token and `401` without (auth before routing, #2 UA12) | AC5 |
| WW22 | Folder restriction on: browse sends `folder_id=<WISTIA_FOLDER_ID>`; search results are kept only when `folder_hashed_id` equals it (medias with another or null folder are dropped); with it unset neither happens | AC5 (R3) |
| WW23 | The restriction cannot be overridden by the caller: a `q` or `cursor` carrying `folder_id` text never changes the outbound `folder_id` | AC5 |
| WW24 | Route independence: with `MUX_BASIC_AUTH` absent from `env` the Wistia route still works; with `WISTIA_API_TOKEN` absent the Mux route (#13 MW*) still works; neither route's outbound request carries the other's credential | AC2, AC5 |
| WW25 | Production wrangler config (parsed in a test, extends #13 MW18): `WISTIA_API_TOKEN` is in `secrets.required` and not in `vars`; `WISTIA_API_ORIGIN` is unset or exactly `https://api.wistia.com`; `WISTIA_API_VERSION` is set; no variable name looks like a secret; `ALLOW_LOCALHOST` is false | AC5 |

## 5. Runtime smoke (seam W2)

Starts the real worker under `wrangler dev` (no Cloudflare login) with `IMS_ORIGIN` and `WISTIA_API_ORIGIN` pointing at local Node servers (fake IMS, fake Wistia), the secret from a temp env file.

| ID | Behaviour asserted |
|---|---|
| WS1 | The worker bundles with the Wistia route module registered and starts; a bare `GET /wistia/medias` gets `401` |
| WS2 | Valid test-signed token: `200`, fixture-conforming body for browse and for search over real HTTP; preflight from an allowed origin and from `https://evil.example` behave per #2 |
| WS3 | A multi-page scripted library returns the same items as W1 (WW9/WW10 scenarios repeated in the real runtime), including bracketed parameters surviving the real fetch/URL stack |
| WS4 | The canary token is absent from all responses (WW15 repeated over HTTP) |
| WS5 | Records Wistia subrequests, wall time and CPU for a worst-case browse (full `WISTIA_MAX_PAGES` scan over realistic-size media objects including `assets`); informational against the Free plan's 10 ms CPU / 50 subrequest limits (R6); no hard threshold until a baseline exists |

## 6. End-to-end tests (seam S1, Playwright, Chromium, hermetic)

Config: extends #13's: the static server serves the repo on `:3000`; `webServer` starts the extension worker (wrangler, local env, `:8787`), the fake IMS server and the fake Mux server; **this ticket adds a fake Wistia server** (a small Node server with a scripted library larger than one page, search results with transcript-only matches, and non-embeddable records). The #1 SDK stub supplies a token signed by the fake IMS key and records `sendHTML`/`closeLibrary`. Every other external request is aborted except thumbnail hosts, which are routed to a tiny local image.

| ID | Behaviour asserted | Proves |
|---|---|---|
| WE1 | Open the plugin, choose Wistia (real provider switch): the grid shows thumbnails, titles, durations from the fake Wistia through the real worker (real cross-origin request, preflight included), newest first | AC1, AC4 (local origins), AC5 |
| WE2 | Type a search term: the grid narrows to the fake Wistia search results (including a transcript-only match), "Load more" is absent; clearing restores the browse grid; typing quickly shows only the final query's results | AC1 |
| WE3 | Library larger than one page: "Load more" appends the rest with no duplicates and disappears at the end | AC1 |
| WE4 | Click a video: recorded SDK calls are `sendHTML` (one table whose single link is `https://fast.wistia.net/embed/iframe/<hashedId>` for exactly the clicked video) then `closeLibrary` | AC1 |
| WE5 | Non-ready, archived, protected, audio and image records never appear in the grid | AC1 |
| WE6 | Switch Mux to Wistia and back: query and grid reset each time; the Mux flow (#13 EV1-EV4) still passes with Wistia registered | AC2 |
| WE7 | Worker `401` (stub token signed by a different key) shows "session expired" and no grid; fake Wistia returning `401` shows the generic retry message, **not** "session expired" | AC1, AC5 |
| WE8 | Worker down or fake Wistia slow beyond the bound: visible loading, then timeout/unavailable and "Try again"; no stack trace or upstream text | AC1 |
| WE9 | Page HTML, DOM text and every network request/response contain neither the IMS token nor the Wistia token anywhere except the allowed `Authorization` header to the worker; only expected hosts were contacted (page, worker, SDK stub, local thumbnail image); no request to `api.wistia.com` (it is faked locally) or any real Wistia host | AC5 |
| WE10 | Folder restriction on in the e2e worker env: only medias from that folder appear in browse and search | AC5 (R3) |

## 7. Repo checks (seam S3, extended)

| ID | Behaviour asserted | Proves |
|---|---|---|
| WR1 | **Footprint check:** outside `apps/video-picker/providers/wistia/`, the string `wistia` (case-insensitive) appears only in the provider registry, the extension worker's route list, the worker's wrangler config and `.dev.vars.example`, the extension README, and the repo README row; no shell module (state machine, renderer, formatting, registry mechanics, entry page) mentions it | AC2 |
| WR2 | The #13 convention check (UR-V1) passes for `apps/video-picker` with `providers/wistia/` as sub-structure (README present, tests present); the Wistia section exists in the extension README with its link | AC2, AC3 |
| WR3 | The #2 worker checks (UR-V2) pass: `.dev.vars.example` lists `WISTIA_API_TOKEN`; no tracked `.dev.vars*`; no secret-looking key in `vars` | AC5 |
| WR4 | Lint (ESLint 8 + helix, Stylelint 16) covers all new JS (provider, worker module, tests); worker globals override from #2 applies to the route module | AC6 |
| WR5 | The Wistia README documents every item in the README checklist (below), asserted by a heading/keyword presence test: token creation and permission, `wrangler secret put`, the variables table, the folder restriction, local dev, branch-ref testing, Domain Restrictions, referrer policy, CSP, `embed` block, "reads no site config", unsupported media, API-version review | AC3 |

README checklist asserted by WR5 (and reviewed by a person): credentials, every variable in section 4 with its default, the explicit "no DA site config keys / no query parameters / no cookies" statement, and the account/site prerequisites from Further Notes.

## 8. End-to-end checks inside real Experience Workspace (manual; needs interactive Adobe login and a Wistia account)

Accounts and credentials needed (none can be provided by an agent):
- Everything #13 Testing section 8 lists: GitHub admin with Code Sync (#1 M0); an Adobe IMS identity with DA org/site access and config-edit permission; Chrome; a Cloudflare account with `wrangler login` (#2 W0); a site with an `embed` block (#13 R1); #13's deployed worker.
- A **Wistia account** (Free plan is enough to start: https://wistia.com/pricing, no credit card) where the tester is the **account owner**, because only the owner can create API tokens (https://docs.wistia.com/docs/making-api-requests). A **Read all data** token; the secret is shown once at creation, so it must be piped straight into `wrangler secret put` and `.dev.vars` without pasting it into chat, issues, PRs or logs.
- Sandbox library (2 folders if possible): at least 3 titled videos (one title with `&` and a double quote), 1 video renamed to a blank-looking title if Wistia allows it (otherwise skip; the fallback is unit-tested), 1 **password-protected** video (must be hidden), 1 **archived** video (hidden), 1 audio file (hidden), 1 video that is still processing or failed (hidden, optional), a video with distinctive **spoken words** and a transcript (for transcript search; the Free plan's credit use for transcription is not documented [OPEN]), and either more videos than one page or a lowered `WISTIA_PAGE_SIZE` to exercise paging.
- For VW5: owner access to the Wistia account's **Domain Restrictions** settings (Account Settings), to toggle and edit the allow-list.

Steps (numbered VW to avoid collision with #13's V and #2's W):

- **VW0 (prereq, spike):** build plan step 0 done; `wrangler secret put WISTIA_API_TOKEN` (stdin) for the deployed worker; set Wistia variables; deploy from `apps/video-picker/worker/`; `curl -i <worker>/wistia/medias` returns `401` and does not call Wistia (check the Wistia account's API activity if visible, otherwise rely on WW1). [AC5]
- **VW1 (registered, provider switch):** open a document in the EW editor with `?ref=local`, open the library, choose *Video Picker*: a provider switch with *Mux* and *Wistia* is visible; repeat with a branch ref. Switching resets the grid. [AC2, AC4]
- **VW2 (`ref=local`, browse/search):** terminal A `npm start` (3000), terminal B the worker dev script (8787, sandbox token in `.dev.vars`, `ALLOW_LOCALHOST` via the local env). Choose *Wistia*: newest-first grid with thumbnail, title, duration; at real panel width nothing is clipped; protected, archived and audio items are absent. Type a title fragment: narrows; type a spoken word: the right video appears. DevTools Network: `OPTIONS` `204`, `GET /wistia/medias` `200` with `Access-Control-Allow-Origin: http://localhost:3000`; **no** request to `api.wistia.com`; search the Network panel and page for the token (none). [AC1, AC4, AC5]
- **VW3 (insert):** with the cursor in an empty paragraph, click a video: the library closes and an `embed` block with the link `https://fast.wistia.net/embed/iframe/<id>` appears; inspect the saved/preview HTML (`.plain.html`) to confirm the block and link. Also try mid-paragraph and inside an existing block (as #13 V3). [AC1]
- **VW4 (paging and real shapes):** lower `WISTIA_PAGE_SIZE` or use a larger library; "Load more" returns the rest without duplicates; confirm a **real** Wistia `cursor` passes validation, a **real** hashed ID passes the ID pattern, the real `thumbnail.url` is accepted and resized, and note how an audio file and (if available) a channel video behave (R4, R9, R12). [AC1]
- **VW5 (plays on preview):** preview the page on the site with the `embed` block (`ref=local` code, then a branch/main ref). With Wistia Domain Restrictions **off**: the player loads and plays, including fullscreen (R11). Then turn Domain Restrictions **on** without allow-listing the site: record the "Video not authorized to be embedded here" message and the exact host (`aem.page`/`aem.live`/custom) the page loads from; add that host (or the owner-approved parent) to the allow-list and confirm the video plays (R1). Record both outcomes in the Wistia README. [AC1]
- **VW6 (failure modes):** (a) revoke the sandbox token in Wistia: the author sees the generic retry message (not "session expired") and the worker log shows the distinct outcome (R8); (b) create a token with only a media-read scope (if the UI allows) and confirm search fails with the scope outcome and the README explains it (R2); (c) stop the local worker: unavailable/timeout message and "Try again" recovers once restarted. [AC5]
- **VW7 (branch ref, deployed worker):** push branch `video-picker-wistia` (simple name), wait for code sync, open the editor with `?ref=video-picker-wistia`, repeat VW1-VW5 against the deployed worker; record the page's real `Origin` and confirm CORS passes. [AC4, AC5]
- **VW8 (secret hygiene and negatives against the deployed worker):** `wrangler secret list` shows names only; `curl` with no token returns `401`; with `Origin: https://evil.example` and a valid token returns `403`; search the page source, Network responses and Application storage for the Wistia token (none); with `WISTIA_FOLDER_ID` set, confirm a video in another folder never appears. [AC5]
- **VW9 (README walkthrough):** a person who has not seen this spec follows only the Wistia README from a clean clone to a working local Wistia picker and to a deployed one; every gap becomes a README fix. [AC3]

## 9. CI

No new job types; Wistia's tests join #1/#2/#13's jobs. No credentials, no Wistia account and no Cloudflare login in CI.

| Job | Covers | Notes |
|---|---|---|
| `lint` | ESLint/Stylelint for all new code; S3 convention check and WR1-WR5 | existing; WR1 added to the repo-check script |
| `unit` | WP*, WC* (WTR) | existing; glob must include `apps/*/providers/*/test/unit` (R10) |
| `worker-unit` | WW* (`node:test`) | existing from #2/#13 |
| `worker-smoke` | WS1-WS5 | #2 R13 flakiness policy applies |
| `e2e` | WE1-WE10 (starts page server, worker, fake IMS, fake Mux, fake Wistia) | existing job gains the fake Wistia server |

## 10. Acceptance-criteria traceability

### Ticket #14

| # | Acceptance criterion (#14) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Author can browse/search Wistia medias and insert an embed that plays on preview | WP1-WP5, WP8-WP10 (provider behaviour, mapping, embed URL, error mapping, markup-safe titles); WC1, WC2; WW2-WW14, WW16-WW18 (browse, paging, scan budget, no lost items, search, filters, projection, thumbnails, validation, upstream robustness); WE1-WE5, WE7, WE8; WS2, WS3 | **VW1** (provider visible), **VW2** (browse/search in real EW), **VW3** (insertion lands as a block), **VW4** (real-Wistia paging and shapes), **VW5** (plays on preview; depends on the `embed` block R1, Wistia Domain Restrictions, CSP) |
| AC2 | Added inside the existing `video-picker` folder as a new provider; no shell changes beyond registering the provider | WR1 (footprint: vendor name only in the registry, worker route list, wrangler config/`.dev.vars.example`, README), WR2; WP4, WP9 (conformance; shell SH* unchanged with two providers; two-provider switch); WW24 (route independence); WE6; WC1 | Review: PR diff outside `providers/wistia/` is exactly the five footprint files listed in section 5 (plus a test-glob widening if R10 requires it, called out in the PR); **VW1** |
| AC3 | Extension README documents this vendor's setup (credentials, site config keys) | WR2 (Wistia section and link exist in the extension README), WR5 (checklist keywords present) | Review of the checklist; **VW9** (a fresh reader completes setup from the README alone); the README states "no site config keys read" and points at the existing `library` row |
| AC4 | Works in EW with `ref=local` and with a branch ref | WE1 (local origins, real local worker); WP6 (origin selection by host) | **VW2** (`ref=local`), **VW7** (branch ref against the deployed worker, real `Origin` recorded), **VW1** |
| AC5 | Vendor credentials only in this extension's worker (from the shared template); browser never receives them; unauthenticated calls rejected | WW1, WW15, WW19-WW21, WW24, WW25 (auth first, no leakage, host-locked outbound, secret presence, config); WW4, WC3 (no raw Wistia JSON); WW14, WW22, WW23 (injection and folder override); WP1, WP7; WE7, WE9, WE10; WR3; WS1, WS2, WS4 | **VW0** (bare `curl` gives `401`), **VW8** (deployed negatives, secret hygiene, folder restriction), **VW2** (Network panel), **VW6** |
| AC6 | Core logic covered by unit tests; lint and CI green | WP*, WC*, WW* run by the `unit` and `worker-unit` jobs; WR4 lint; `worker-smoke` and `e2e` jobs | Review: CI shows all jobs green on the PR; on a scratch branch, loosening a filter or the thumbnail host check turns WW5/WW8 red, and adding a Wistia mention to a shell module turns WR1 red (not merged) |

Every acceptance criterion on #14 maps to at least one automated test or a numbered manual verification step above.

### Ticket #52 (this spec task)

| Criterion (#52) | Where satisfied |
|---|---|
| `apps/video-picker/providers/wistia/` exists and contains `SPEC.md` | this file |
| SPEC.md follows the to-spec template and adds Build Analysis and Testing Requirements | Problem Statement, Solution, User Stories, Implementation Decisions, Testing Decisions, Out of Scope, Further Notes, then top-level `# Build Analysis` and `# Testing Requirements` |
| Every #14 criterion mapped to a test or verification step | section 10, ticket #14 table |
| External API claims cite primary-source URLs; unverified items tagged | Wistia docs URLs, Block Collection source, Contentful listing and pricing page cited inline; observations O1-O8 are dated `curl` results; unverified items carry [ASSUMPTION] or [OPEN] |
| No implementation code written | none; behavioural descriptions only |

## 11. Open questions for the owner

1. **Wistia account and sandbox.** Can you provide a Wistia account (Free plan acceptable) where you are the owner, plus a **Read all data** token for local testing, so build step 0 (the spike) and manual steps VW0-VW9 can run? Is the production worker to point at a production Wistia account or a sandbox one? (Inherits #13 OQ3 for Mux.)
2. **Token permission.** Search needs the **Read all data** permission, which is broader than the "Read all folder and media data" that listing needs (both are read-only). Accept Read all data, or must the token be the narrower one (which would force the scan contingency in R2 and lose transcript search)? Do you want a token with "Act with a team member's permissions" instead (not planned)?
3. **Search availability.** Wistia does not state whether the Search endpoint is available on every plan and API token type. If the step-0 spike shows it is not for your account, do you approve the contingency (bounded worker-side scan over list pages, name/description substring match, like Mux in #13 d12-d14), accepting weaker search and no transcript matches?
4. **Who may list the Wistia library (R3).** An account-level token sees every folder, including private and personal ones. Is "any authenticated Adobe user passing #2's client-id allowlist can list the whole account" acceptable, or do you want `WISTIA_FOLDER_ID` (one folder) required from the start? Is one folder enough, or do you want a multi-folder include list or exclude list as Contentful's app offers? Or restrict by user/org (not designed)?
5. **What gets hidden.** v1 hides password-protected videos, audio, images/documents, archived and not-ready media. Is hiding **password-protected** videos right (they would play after a password prompt), and do you want audio later? Do you use Wistia Channels (not supported by Wistia's APIs for episodes)?
6. **Domain Restrictions (R1).** Does the Wistia account have Domain Restrictions on? If so, who edits the allow-list, and may it contain the shared `aem.page`/`aem.live` parent (authorises every site on that domain) or must it list each `{ref}--{site}--{org}` host (which a branch-per-test workflow makes impractical)? Which referrer policy do your pages send?
7. **Embed form.** v1 inserts the plain Wistia iframe URL (`https://fast.wistia.net/embed/iframe/{id}`) through the site's `embed` block, with no embed options (no `autoPlay`, `playerColor`, `videoFoam`, `seo`). Acceptable, or do you want the Wistia Aurora/async embed (needs a dedicated site block that loads Wistia's player script) or embed options carried in the URL?
8. **Dependencies on #13's build.** This spec assumes the shell implements: the provider switch when 2+ providers are registered (#13 PC6), a provider-declared embed host allowlist for the renderer, a conformance suite and contract-shape checker that accept per-provider shapes, and test globs that cover `providers/<vendor>/test`. If #13 ships without any of these, #14 would need a small additive change to shared test support or shell wiring; do you accept that as "registration plus support" rather than "shell change", or should #13's scope be widened instead?
9. **What counts as "registering".** Beyond the registry entry, #14 touches the worker route list, the worker's wrangler config (new secret and variables), `.dev.vars.example` and the extension README. Confirm this is within AC2's "no changes needed in the extension shell beyond registering the provider" (it follows from #2's "one worker per extension", so a vendor's secret must be declared in the shared worker's config).
10. **API version policy (R7).** The worker pins `X-Wistia-API-Version: 2026-09`, supported for about a year. Who owns the yearly bump, and do you want a scheduled reminder or a non-blocking canary job calling a documented version-check path?
11. **Search limits.** Search is unpaged and returns at most about 100 matches (plus transcript-only ones): is that enough for your library size, or do you need paging/an index in a follow-up? Is title-only display of transcript matches acceptable (no spoken-text snippet)?
12. **One shared worker.** Confirm one deployed worker serves both Mux and Wistia (secrets `MUX_BASIC_AUTH` and `WISTIA_API_TOKEN` side by side), per #2 d3, rather than one worker per vendor.
13. **README placement.** AC3 says the *extension* README documents the vendor setup. This spec puts the full Wistia setup in the provider folder's README and a summary section plus link in the extension README. Acceptable?
14. **Transcripts and credits.** Does searching spoken words depend on Wistia transcripts that cost credits on your plan? The Free plan has a lifetime credit allowance; I could not tell from the docs whether transcripts are credit-metered.
15. **Policy carry-over.** Confirm the open policy items from #1/#2/#13 (Adobe outside-activity/IP; a personal Cloudflare account holding a third-party vendor credential; no public marketplace process found) are accepted as-is for this extension, whose README must again state that it handles a third-party credential.
