# Spec: Video Picker: Mux (picker shell + first provider)

Ticket: jazhou-adobe/ew-extensions#13 (this spec: #51). Blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). #13 blocks #14 (Wistia provider) and #15 (Brightcove provider), which must be able to land as "new provider, no shell changes".
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from a vendor/Adobe.

Vocabulary follows #1 and #2: *extension* = one folder `apps/<name>/` (type decided by its EW config-sheet row; this one is a **library plugin**); *worker* = the per-extension backend; *template* = `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension. Added here: *shell* = the provider-agnostic picker UI and insertion logic; *provider* = one video vendor's module (browser part plus worker part); *library* = the vendor-side catalogue of videos (not the EW "library" panel, which is always called *editor library* below).

---

## Problem Statement

A content author in Experience Workspace (EW) who wants a video on a page has to leave the editor, find the video in the vendor's console (Mux), copy a playback ID or URL, work out what markup the site's embed block expects, and type it into the document by hand. Every step is error-prone: wrong ID, wrong URL form, wrong block name, a table built by hand. Content-platform marketplaces (Contentful lists Mux and Wistia, https://www.contentful.com/marketplace/apps/) solve this with a picker that browses the video library inside the editor.

For this repo there is a second problem: Mux, Wistia and Brightcove are three of several video vendors the maintainer wants to support, and the three tickets (#13, #14, #15) must not each invent their own picker UI. If the first ticket builds a Mux-only picker, every later vendor either forks it or forces a rewrite of the shell.

Finally, vendor listing APIs need credentials, and extension code is served publicly from the EDS code bus (#2): the Mux API key cannot live in the browser. The Mux API also sends no CORS headers [VERIFIED: https://www.mux.com/docs/core/make-api-requests, "CORS and client side API requests"; observed 2026-11-16: an `OPTIONS` preflight to `https://api.mux.com/video/v1/assets` from `Origin: https://da.live` returned `200` with no `Access-Control-Allow-Origin`], so a browser cannot call it at all.

## Solution

A **library plugin** called *Video Picker* appears in the EW editor library. The author opens it, sees a grid of videos from the connected Mux account (thumbnail, title, duration), can type in a search box to narrow the grid, loads more results page by page, and clicks a video. The plugin inserts an **embed block** at the cursor and closes the editor library. When the page is previewed, the block shows Mux's hosted player (an iframe of `https://player.mux.com/{playbackId}`, the embed snippet Mux documents [VERIFIED: https://www.mux.com/docs/guides/playback-videojs-with-mux]) and the video plays.

Under the hood the plugin is split into a **provider-agnostic shell** and **providers**:

- The shell owns the UI, the states (loading, empty, error, not-in-EW), search, paging, and the one place that turns a chosen video into EW document HTML.
- A provider is a small module that answers two questions: "give me a page of videos matching this query" and "what should be embedded for this video". Adding Wistia or Brightcove later means adding a provider folder and registering it; the shell does not change.
- The Mux provider's listing call goes to a **per-extension worker** (built from the #2 template). The worker holds the Mux access token, verifies the caller's IMS token before doing anything, calls the Mux API, and returns only the fields the picker needs (never the raw Mux asset JSON). The browser never sees a Mux credential.

Around it: unit tests for the logic, a contract fixture shared by browser and worker tests, a hermetic Playwright run against the real local worker with a fake Mux, a README with setup and the EW config-sheet row, a row in the repo README extensions table, and manual steps for verifying in real EW with `ref=local` and a branch ref.

## User Stories

Content author (EW end user):

1. As a content author, I want to find *Video Picker* in the editor library, so that I can add a video without leaving the editor.
2. As a content author, I want to see my Mux videos as a grid of thumbnails with title and duration, so that I can recognise the right video at a glance.
3. As a content author, I want the newest videos first without any setup, so that the video I just uploaded is easy to find.
4. As a content author, I want a search box that filters the videos by title, so that I can find one video in a large library.
5. As a content author, I want search to ignore upper/lower case and surrounding spaces, so that I do not have to guess how the title was typed.
6. As a content author, I want the results to update as I type (with a short pause), so that I do not have to press a button, and I do not want half-typed searches to cause a flicker of stale results.
7. As a content author, I want a "Load more" control when the library has more videos, so that large libraries are reachable without a huge first load.
8. As a content author, I want videos that are still processing, failed, or not playable publicly to be left out of the list, so that I cannot insert a video that will not play.
9. As a content author, I want a video without a title to still appear with a readable fallback label, so that untitled uploads are not invisible.
10. As a content author, I want durations shown as `m:ss` or `h:mm:ss`, so that I can tell a clip from a webinar.
11. As a content author, I want one click on a video to insert it at my cursor and close the editor library, so that I can carry on editing.
12. As a content author, I want the inserted content to be an embed block in the page, so that it behaves like any other block (move, delete, edit in the editor).
13. As a content author, I want the video to play when I preview the page, so that I know the insertion worked.
14. As a content author, I want a clear empty state ("No videos found") and a clear no-match state for a search, so that I know whether the library or my query is the issue.
15. As a content author, I want a short plain error message with a "Try again" action when the backend is slow, down or rate limited, so that I know whether to retry or to contact the maintainer.
16. As a content author, I want a visible "session expired, reload the editor" message when my login token is rejected, so that I know what to do instead of seeing a generic failure.
17. As a content author, I want the picker to stay responsive (a bounded wait with a visible "loading" state), so that the editor library never looks hung.
18. As a content author, I want the picker to work with the keyboard (tab to the search box and to each video, Enter to insert, visible focus), so that I am not forced to use a mouse.
19. As a content author using a narrow editor library panel, I want the grid to fit the panel width, so that nothing is cut off.
20. As a content author, I want titles shown as text exactly as written (never interpreted as markup), so that an odd title cannot break the picker or the page.

Extension author (maintainer or an agent working #14 / #15 / a later vendor):

21. As an extension author, I want a documented provider interface (list/search a page of videos; describe the embed for a video), so that a new vendor is one module.
22. As an extension author, I want to register a provider with one line in one place, so that the shell needs no other change.
23. As an extension author, I want a ready-made provider conformance test suite I can point at my provider, so that I know it satisfies the shell's expectations before I open a PR.
24. As an extension author, I want providers to return *data* (video fields and an embed descriptor), never HTML, so that the shell's single renderer guarantees safe, uniform markup.
25. As an extension author, I want vendor-specific worker routes to live next to the vendor's browser module, so that a vendor ticket touches one folder.
26. As an extension author, I want shared contract fixtures describing the worker's response, so that the browser tests and the worker tests cannot drift apart silently.
27. As an extension author, I want a fake Mux (a local server replaying scripted responses) in the test kit, so that I can test the Mux provider with no Mux account.
28. As an extension author, I want the README to explain how to run the picker locally against the local worker next to the `ref=local` dev server, so that I can iterate inside real EW.
29. As an extension author, I want the Mux provider's worker configuration (page size, scan budget, API origin override for tests) to be non-secret `vars`, so that tests and local runs can tune it without touching secrets.

Maintainer / operator:

30. As the maintainer, I want the Mux access token and secret stored only as a Cloudflare worker secret, so that nothing credential-like exists in the repo, the page, the network log or the logs.
31. As the maintainer, I want the Mux token to be read-only, so that a leak cannot create, modify or delete videos.
32. As the maintainer, I want unauthenticated calls to the worker rejected before any Mux call is made, so that the internet cannot spend my Mux rate limit or enumerate my library.
33. As the maintainer, I want the worker to return only a fixed projection of each asset (not raw Mux JSON), so that fields such as master-file URLs or passthrough data can never reach the browser.
34. As the maintainer, I want search work bounded (a maximum number of Mux calls per request), so that one search cannot exhaust Mux's rate-limit bucket or the Workers subrequest limit.
35. As the maintainer, I want the README row, the extension's README, and the config-sheet row documented, so that enabling the plugin on a site is copy-paste.
36. As the maintainer, I want CI (lint, unit, worker tests, convention check) to cover this extension on every push and PR, so that regressions cannot merge.
37. As the maintainer, I want signed or DRM-protected videos to be clearly out of scope for v1 and documented as such, so that nobody expects them to work.
38. As the maintainer, I want to know which site-level prerequisite makes the embed play on preview (the site must have an `embed`-capable block), so that "it inserted but does not play" has a documented cause.

Security reviewer:

39. As a security reviewer, I want a test proving the Mux credential (and its parts) never appears in any response body, header or log across success and every error path, so that "browser never receives it" is tested rather than promised.
40. As a security reviewer, I want a test proving the worker's Mux requests only go to the configured Mux API host and carry the credential only there, so that a bug cannot turn the worker into an open proxy.
41. As a security reviewer, I want user-supplied search text and cursors validated and length-capped before they reach the outbound URL, so that parameter injection is impossible.
42. As a security reviewer, I want the playback ID validated against a strict pattern before it is used to build an embed URL or a thumbnail URL, so that a malformed value cannot inject markup or redirect the iframe.

## Implementation Decisions

(No file paths or code, except the type-shape notes marked as such. Paths and layout are in the Build Analysis.)

**Shape of the extension**

1. **Type and registration.** One extension, one folder, registered as a **library plugin** (a row in the `library` tab of the site config). Not an app. Extensions table `type` = `library plugin`. Title in the sheet row: `Video Picker` (not one of the reserved first-party names `blocks`, `templates`, `icons`, `placeholders`, `aem-assets*`) [reserved names VERIFIED in source, see #1 spec 2.5].
2. **Shell and providers are separate modules.** The shell never mentions a vendor. A provider never touches the DOM or the SDK. The only thing that connects them is the provider contract (decision 6) and a static registry.
3. **Render/logic vs bootstrap split** as in #1: a side-effect-free logic module (state, filtering of view state, formatting, embed building) that tests import, and a thin bootstrap that awaits the SDK and wires it in.
4. **No build step, vanilla DOM, ES modules, SDK imported as `import DA_SDK from 'https://da.live/nx/utils/sdk.js'` and awaited** (#1 decision 5). The page also handles the standalone "not inside Experience Workspace" state the same way the hello plugin does (waiting, then standalone message after a timeout).

**Provider contract (AC2)**

5. **Registry.** A static list of providers in one module. Adding a provider = one new provider folder + one registration line in that list. This is exactly what #14 and #15 state ("no changes needed in the extension shell beyond registering the provider"); the shell is not auto-discovering (a browser cannot list a folder).
6. **Contract (behavioural; the type shapes below come from this spec's design, not a prototype):**
   - A provider has a stable `id` (lower-case, used in the registry and in logs), a human `label`, and two operations.
   - `list`: given `{ query, cursor, signal }` (query possibly empty, cursor possibly absent for the first page, an abort signal) returns a promise of `{ items, nextCursor }`. `nextCursor` is an opaque string or `null` when there is nothing more. `list` rejects with a **provider error** carrying one of a small fixed set of codes (`unauthorized`, `rate_limited`, `unavailable`, `timeout`, `bad_response`, `aborted`) and a plain message. The shell maps codes to user messages and never shows raw error text.
   - Each **item** is `{ id, title, durationSeconds, thumbnailUrl, ref }`: `id` unique within the provider; `title` plain text (already falling back to a label for untitled videos); `durationSeconds` a number or `null`; `thumbnailUrl` an `https` URL or `null`; `ref` an opaque provider-owned value that `getEmbed` understands (for Mux, the public playback ID).
   - `getEmbed(item)`: pure, synchronous, returns an **embed descriptor** `{ url, title }` (the page URL to embed as an `https` URL, and a plain-text label). A provider that cannot embed an item throws a provider error (`bad_response`).
   - Providers return data, never HTML. The shell is the only code that produces document HTML (decision 8).
7. **Search semantics belong to the provider, UX semantics to the shell.** The shell debounces typing, aborts a superseded `list` call, ignores a late response whose query/cursor is no longer current, and shows loading/empty/error states. How a provider implements "search" (server-side parameter, or the worker filtering) is the provider's business.

**Insertion (AC1)**

8. **One renderer produces the document HTML.** The shell turns an embed descriptor into the EW editor's block-table form and sends it with `actions.sendHTML` (insert at the cursor), then calls `actions.closeLibrary`. The default block name is `embed`, the first-party Block Collection embed block, whose default branch renders any link as a lazily loaded full-width iframe [VERIFIED: https://raw.githubusercontent.com/adobe/aem-block-collection/main/blocks/embed/embed.js (`getDefaultEmbed`, `loadEmbed`)]. The block table has a header row with the block name and one row with one cell containing one link whose `href` and visible text are the embed URL. Link text is the URL, not the title, so the block is meaningful when the site has no embed block. The renderer escapes everything and accepts only `https` URLs on the allowlist of hosts the active provider declares (Mux: `player.mux.com`).
   - Why a table: the DA editor's own block library builds exactly this form (`<table border="1">`, header cell with colspan, content rows) for block insertion [VERIFIED in source: https://raw.githubusercontent.com/adobe/da-live/main/blocks/canvas/ew-panel-extensions/helpers.js, `getBlockTableHtml`]. `sendHTML` without `replace` parses the string with the editor's ProseMirror schema and inserts it at the selection [VERIFIED: same file, `insertHTML`]. Whether this particular table is recognised as a block, and placed sensibly relative to the cursor, is not documented for `sendHTML`; it is verified manually (step V3) [ASSUMPTION].
   - Alternatives considered: `<div class="embed">` HTML (the form `replaceHTMLAtCursor` accepts, but that path needs the `sendHTMLReplace` capability and an existing selected node; rejected as less general); a bare link in a paragraph (does not play); the Block Collection `video` block (native `<video>` cannot play an HLS-only Mux stream in most browsers; Mux MP4 renditions are opt-in per asset [VERIFIED: https://www.mux.com/docs/api-reference/video/assets, `static_renditions`], so it cannot be assumed).
   - **Prerequisite for "plays on preview":** the target site must provide an `embed` block that renders unknown links as iframes (Block Collection's does). This repo's own site has no blocks (#1 makes it a code site for extensions). See Build Analysis R1 and open question 1. The picker ships **no** site blocks.
   - The block name is a constant in the extension (`embed`); changing it for a site with a differently named block is a one-line change, not configuration, in v1.
9. **`sendHTML` is fire-and-forget** (no return value, no error signal) [VERIFIED: `sendHTML` without `replace` posts a message and returns `undefined` in https://da.live/nx/utils/sdk.js]. The shell therefore cannot confirm insertion, only that it called the action. Consequently: the shell inserts, then closes the library; there is no "inserted" toast. Insertion success is proven manually (V3).
10. **Insert-and-close is the one interaction on a card.** Clicking (or Enter/Space on) a card inserts and closes. No selection step, no preview pane, no multi-insert in v1.

**Mux provider and worker (AC1, AC3, AC7)**

11. **Mux listing API.** The worker calls `GET https://api.mux.com/video/v1/assets` with `limit` and optional `cursor`, authenticated by HTTP Basic auth (access-token ID as username, secret as password) [VERIFIED: https://www.mux.com/docs/core/make-api-requests, "HTTP basic auth"; https://www.mux.com/docs/api-reference/video/assets/list-assets]. Response: `{ data: [asset...], next_cursor }`, `next_cursor` is `null` at the end [VERIFIED: same pagination section]. Fields used: `id`, `status`, `duration`, `created_at`, `meta.title`, `meta.external_id`, `playback_ids[].{id,policy}` [VERIFIED: https://www.mux.com/docs/api-reference/video/assets; `meta` schema {title (max 512), creator_id, external_id} in the OpenAPI spec https://www.mux.com/api-spec.json].
12. **There is no title search in the Mux list endpoint.** The only query parameters are `limit`, `page`, `cursor`, `live_stream_id`, `upload_id` [VERIFIED: https://www.mux.com/docs/api-reference/video/assets/list-assets and the OpenAPI spec's parameter list]. So search is done **in the worker**: it walks Mux pages and keeps assets whose title, external id or asset id contains the query (case-insensitive substring after trimming). This is a deliberate design and the largest limitation (decision 14).
13. **Filtering and projection in the worker.** Keep only assets with `status = ready` that have at least one **public** playback ID (the first public one is used). Everything else (preparing, errored, signed-only, DRM-only) is dropped [signed/DRM playback needs tokens or DRM config: https://www.mux.com/docs/guides/secure-video-playback; out of scope v1]. Each kept asset is projected to `{ id, title, durationSeconds, playbackId, createdAt }`. Title = `meta.title` when present, else a fixed fallback built from the asset ID's first 8 characters (for example `Untitled video (8jd7M77x)`). The raw Mux asset is never returned. In particular `master.url`, `passthrough`, tracks, errors, and static-rendition data never leave the worker.
14. **Bounded scan, no lost items.** The worker requests Mux pages of a configured size (default 50, always passed explicitly because the docs disagree on the default: the list reference says 25, the pagination guide says 10 [VERIFIED both, 2026-11-16]) and keeps scanning until it has at least a configured minimum of matches (default 24), the cursor is exhausted, or a maximum number of Mux calls (default 5) is reached. It returns **all** matches from every page it scanned (never a truncated part of a page, so the cursor it returns never skips an item) plus the Mux `next_cursor` of the last scanned page. A response may therefore hold more than the minimum, up to pages x page size. If the call budget ended the scan while the cursor is not exhausted, `nextCursor` is set and the shell shows "Load more" (the next request continues from that cursor). The cap keeps one request within Mux's rate limit (non-POST bucket of 100 requests refilling at 5/s [VERIFIED: https://www.mux.com/docs/core/make-api-requests, "API rate limits", high-priority token]) and far under the Workers Free plan's 50 subrequests per invocation (which also counts the IMS key fetch) [VERIFIED limit: https://developers.cloudflare.com/workers/platform/limits/].
15. **Ordering.** Results appear in the order Mux returns them. The documented sample is newest first (descending `created_at`) but ordering is not stated as a guarantee [ASSUMPTION; Mux sample response, https://www.mux.com/docs/api-reference/video/assets/list-assets]. The worker does not re-sort (re-sorting would be wrong across pages).
16. **Inputs are validated at the worker boundary.** `q`: at most 100 characters after trimming (longer gives `400 bad_request`); `cursor`: at most 512 characters of URL-safe base64 characters (`A-Z a-z 0-9 - _ =`) [Mux's sample cursors look like base64url; exact alphabet unspecified, ASSUMPTION; widen if a real cursor fails V4]; unknown parameters ignored. The Mux URL is built with URL encoding from the validated values; the host is fixed.
17. **Worker contract (the route the browser calls):** one route, `GET /mux/assets`, query `q`, `cursor`. Success: `200 { items: [{ id, title, durationSeconds, playbackId, createdAt }], nextCursor }`. Errors use the #2 error contract (`bad_request`, `unauthorized`, `forbidden_origin`, `rate_limited`, `upstream_unavailable`, `misconfigured`, `internal`, ...). Upstream Mux `429` after retries maps to `429 rate_limited` with `Retry-After`; upstream `401/403` from Mux (bad or revoked token) maps to `502 upstream_unavailable` (not `401`: the caller's IMS login is fine, so the browser must not tell the author to log in again) and logs a distinct outcome code for the operator; other upstream failures map to `502`. All of this is the #2 mapper plus one provider-specific mapping rule for Mux `401/403`.
18. **Credentials and the #2 contract.** The Mux credential is a Cloudflare Worker secret, declared in the wrangler `secrets.required` list so a deploy without it fails. The #2 `proxy` helper injects one secret by name with a scheme [per #2 spec, Build Analysis 4, "Proxy options contract"], and Mux needs `base64(tokenId:tokenSecret)`, so v1 uses **one secret, `MUX_BASIC_AUTH`, holding that precomputed base64 value**, injected with the `Basic` scheme; the README gives a command that builds the value and pipes it into `wrangler secret put` without it touching shell history or a file. Rationale: works with the contract as specified, no template change needed. The cost is that the author must base64-encode once; a template extension for native two-secret Basic auth is proposed in open question 4 (Brightcove, #15, needs the same for its OAuth client-credential exchange). The secret's two halves are also registered with the redaction step if the template exposes that; otherwise the redaction test (MW9) proves the decoded halves never appear either [ASSUMPTION about template redaction API].
19. **Token scope.** The Mux access token is created with **Read** permission only: the worker only does `GET` [VERIFIED: https://www.mux.com/docs/core/make-api-requests, "Access token permissions": "If your code is not creating anything and only doing `GET` requests then you can restrict the access token to Read only"]. Mux tokens are scoped to one environment (for example Development vs Production) [VERIFIED: same page]; the deployed worker uses the environment that holds the real library, the local worker uses a sandbox environment.
20. **One worker, one Mux account.** v1 is single-tenant: the deployed worker serves the one Mux environment its secret points to, to every authenticated EW caller that passes the #2 gates. Per-site or per-user Mux accounts are out of scope. This is a security-relevant policy (any allowed Adobe user can list this library, including unlisted-by-ID videos): R3 and open question 2.
21. **Browser-side Mux provider.** Calls the worker route with `Authorization: Bearer <IMS token from the SDK>`; maps the response to items (adding `thumbnailUrl` built from the playback ID) and implements `getEmbed`. It never calls Mux, never receives a Mux credential, and validates the playback ID against a strict pattern (letters and digits only) before building any URL. Thumbnail URL: `https://image.mux.com/{playbackId}/thumbnail.jpg?width=320`, a single fixed variant per video [thumbnail URL format and `width` parameter: VERIFIED https://www.mux.com/docs/guides/get-images-from-a-video; the guide notes a default limit of 1 distinct thumbnail per 10 s of duration per asset, so using one fixed variant avoids spending that limit; `image.mux.com` answered `200` with `access-control-allow-origin: *` for a public playback ID on 2026-11-16]. Embed URL: `https://player.mux.com/{playbackId}` (the iframe embed from the Mux docs; observed on 2026-11-16: no `X-Frame-Options` header and a CSP that does not restrict being framed). Mux Player (`<mux-player>`) is documented as a legacy component in maintenance mode, with Video.js recommended for new players [VERIFIED: https://www.mux.com/docs/guides/mux-player-web]; the hosted iframe sidesteps both choices, so the page needs no player script. [OPEN: whether `player.mux.com` is the long-term supported embed; the Video.js guide shows it as the "embed" snippet.]
22. **The worker origin is a constant in the extension, never taken from the URL** (#2 decision 13): the loopback worker origin when the page runs on `localhost` (that is, `ref=local`), a fixed deployed origin otherwise. A `?worker=` style parameter is ignored (tested).

**UX details**

23. **Search UX.** A search input with a visible label, 300 ms debounce [ASSUMPTION: value; tune in V2], minimum 0 characters (empty query = the unfiltered newest-first list), trimmed. Each new query starts at the first page and replaces the grid. "Load more" appends and de-duplicates by item `id`. A late response for a superseded query is dropped. Requests are aborted when superseded. A 15 s bound on each call with a visible timeout error. A "Try again" button repeats the last call.
24. **States.** loading (first page), loading-more, empty library, no matches for query, error (per code message), standalone (no EW). Messages are fixed strings. Error messages never contain upstream text.
25. **Accessibility baseline.** Search input has an accessible name; each video is a button whose accessible name contains title and duration; focus ring visible; status text in a polite live region; images have empty `alt` (the name is on the button). No full a11y audit (out of scope).
26. **Presentation.** A responsive grid (one or two columns in a narrow editor library panel), 16:9 thumbnail, title clamped to two lines, duration badge. Colours/spacing local to the extension's CSS; no dependency on the EW design system. Thumbnail load failure falls back to a neutral placeholder.
27. **No configuration read in v1.** The picker reads **no** DA site config, no query parameters and no cookies. Everything configurable (worker origin, block name, host allowlist) is a constant in the extension; worker tuning is wrangler `vars`. The README states this explicitly for AC4's "site config it reads". [OPEN: whether a future site-config sheet (for example enabled providers, block name per site) is wanted.]

**Repo conventions**

28. **Folder, README, table.** Everything for this extension lives under its own folder (entry page, JS, CSS, README, tests, the worker, the Mux provider). The repo README extensions table gets one row. The extension README covers setup, the `library` row, the Mux token creation, worker deploy/secrets, local dev, branch-ref testing, site prerequisite (`embed` block), and the provider-authoring guide (short, for #14/#15).
29. **Providers placement** follows #1/#2: browser provider code in `providers/<vendor>/`, vendor worker routes in `providers/<vendor>/worker/`, registered by the extension's own `worker/` entry (#2 decision 3, flagged there as [OPEN] for the owner; this spec depends on that refinement being accepted).
30. **No cross-extension imports.** The shell imports nothing from other extensions; the worker imports only the shared template core (a documented exception, #2 decision 2).

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: what the author sees and which SDK actions fire given a stubbed SDK and a fake worker (browser side); and which `Response` and which outbound Mux requests happen given a `Request` and a fake Mux (worker side). Never assert on internal helper names, module structure, CSS classes, or how many times an internal function ran. The two negative properties get the most weight: "no Mux credential appears anywhere" and "no Mux call happens before auth succeeds".

**Proposed seams** (recorded here instead of asked, per #51). Existing seams from #1 and #2 are reused; this spec adds one small shared contract fixture and one conformance suite, no new runtime boundary.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| S1 (primary, highest) | Entry HTML page + SDK module boundary, with the **real local worker** behind it | reused from #1, extended as in #2 E2E | Playwright e2e | #1's `page.route` SDK stub supplies a token signed by the test IMS key; the Mux worker runs under `wrangler dev` with `IMS_ORIGIN` and the Mux API origin pointing at throwaway local Node servers (fake IMS, fake Mux); the browser performs a real cross-origin request, preflight included |
| S2 | Shell and provider logic modules + SDK result | reused from #1 | WTR unit tests | injected `fetch`; hand-built SDK result with a recording `actions`; fake timers for debounce/timeouts |
| W1 | The Mux worker's HTTP boundary: `worker.fetch(request, env, ctx)` | reused from #2 | Node unit tests (`node:test`) | #2 test kit: `makeEnv`, `fakeIms`, canary secret; `fakeUpstream` configured as a fake Mux (path/query/Authorization aware, cursor-paged) |
| W2 | The same worker in the real workers runtime | reused from #2 | smoke tier | `wrangler dev`, no Cloudflare login |
| C1 (new, tiny) | **Shared contract fixtures** for the browser/worker JSON | new | W1 asserts its responses conform; S2 consumes the same fixtures as the fake worker's replies | static JSON files plus a small shape checker; no runtime boundary, just one source of truth |
| P1 (new, tiny) | **Provider conformance suite**: one function taking a provider and a fixture set and asserting the provider contract | new | S2 for the Mux provider now; #14 and #15 reuse it as is; also run against an in-test fake provider to prove the shell is provider-agnostic | provider gets an injected `fetch` |
| S3 | Repo convention check | reused from #1 | CI lint job | filesystem fixtures |

Why not fewer: the worker's filtering/paging/mapping matrix is large and quick to test at W1 but slow and noisy only through a browser; the e2e at S1 proves the pieces fit over a real socket. C1 and P1 are not boundaries; they are shared helpers that make "two sides agree" and "a new provider conforms" checkable by machine, which is what AC2 and the #14/#15 "no shell change" criteria need. The real EW boundary (real IMS login, real `sendHTML` into the editor, real preview) is verified manually only.

**Modules tested:** the embed renderer; the shell state machine (search, debounce, paging, de-duplication, stale-response handling, error mapping, standalone state); formatting (duration, fallback title); the registry; the Mux browser provider; the Mux worker route (validation, auth ordering, filtering, scan budget, projection, error mapping, secret hygiene); the contract fixtures; the conformance suite itself (it must fail for a deliberately broken provider); convention-check additions.

**Prior art:**
- #1 spec: S1/S2/S3 seams, SDK stub, WTR import-map remap, Playwright `page.route` stubbing, fetch guard.
- #2 spec: W1/W2 seams, test kit, UA*/UC*/UP*/US* template tests (not repeated here; this spec only adds Mux-route tests), E2E1-E2E4 pattern (browser to real local worker), manual steps W0-W6.
- Upstream `adobe-rnd/ew-extensions`: dependency-injection seams (`fetchImpl`, `storage`, `now`) in `tools/brand-visibility/session-auth.js` (https://github.com/adobe-rnd/ew-extensions/blob/main/tools/brand-visibility/session-auth.js); no worker or picker prior art there [VERIFIED by #2's tree check; not re-checked].

## Out of Scope

- Other providers (Wistia #14, Brightcove #15) and any other vendor. Only the contract and the conformance suite that make them cheap.
- Uploading, editing, deleting or tagging videos; creating assets or direct uploads; Mux webhooks.
- Signed (JWT-protected) and DRM playback IDs: needs a Mux signing key as a second secret and token minting in the worker; the picker simply hides such videos in v1.
- Per-site or per-user Mux accounts/credentials, org-level authorization ("only people with access to this site"), per-user quotas (template notes in #2).
- Server-side caching (Cache API/KV) and a title index for large libraries; true full-text/tag search; sorting options; folders/collections; multi-select/multi-insert; selecting start time, autoplay, captions or poster options.
- Inline video preview/playback inside the picker (thumbnails only).
- A poster placeholder image in the block (Block Collection's embed block supports a `picture` placeholder, but an external hotlinked image in the DA document may not survive the media pipeline: not researched).
- Shipping an `embed` block, any site code or site styling (the target site's responsibility; documented as a prerequisite).
- Mux Data/analytics metadata on the embed (for example `metadata-video-title` query parameters), custom player themes/accent colour.
- A full accessibility audit, internationalisation, dark-mode theming.
- Configurable block name, enabled providers or default provider via DA site config (a constant for now).
- Cross-browser e2e beyond Chromium; real-session e2e in CI; Cloudflare deployment from CI (#2 decisions).
- The Adobe outside-activity/IP policy question for running infrastructure and handling a third-party vendor credential under a personal Cloudflare account (owned by #1 R1 and #2 R1).

## Further Notes

- **Docs say nothing about plugin-initiated HTML insertion specifics.** The official page https://www.aem.live/docs/ew/developing/apps-plugins lists `sendHTML` among the actions (per the #1 spec's reading), but not the HTML shape DA expects for a block. All guidance on the table form comes from reading da-live source on 2026-11-16 and is therefore subject to drift.
- **Mux title coverage is unknown.** `meta.title` is optional; assets created without it have no human label, which makes search weak for such libraries. The fallback label and the asset-ID matching are a mitigation, not a fix.
- **Mux Player maintenance mode** (see decision 21) affects documentation you may find online: many Mux examples still use `<mux-player>`; this spec deliberately uses the hosted iframe.
- **Hotlinked thumbnails.** `image.mux.com` serves public-playback thumbnails with permissive CORS; the picker uses plain `<img>` loads, so CORS is irrelevant, and signed videos are excluded so no signed image URLs are needed.
- **Wistia/Brightcove readiness (for #14/#15).** Wistia's media list API and Brightcove's CMS API both have real server-side search/filter parameters (not verified here: [ASSUMPTION], to be researched in their own specs); the contract's `query` semantics ("provider decides how") deliberately allows both server-side search and worker-side filtering. Brightcove's OAuth client-credential exchange is why the template wishlist in open question 4 matters.
- **Current repo state:** `apps/video-picker/` contains only this file; #1 and #2 are specified but not implemented, so everything marked "reuse" presumes they have landed.

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)
 └─ editor library panel
     └─ iframe: Video Picker page   (origin: https://{ref}--{site}--{org}.aem.live | .preview.da.live | http://localhost:3000)
          │  SDK handshake gives { token (IMS), context, actions }
          │
          │  shell  ──list({query,cursor})──►  Mux provider (browser) ──fetch──┐
          │  shell  ◄──items / provider error──                               │  Authorization: Bearer <IMS token>
          │                                                                    ▼  (cross-origin, preflight first)
          │                                           Cloudflare Worker  (apps/video-picker/worker + providers/mux/worker; core from shared/worker-template)
          │                                              1 origin gate  2 IMS token check  3 GET /mux/assets
          │                                              4 proxy ──Basic auth (MUX_BASIC_AUTH)──► https://api.mux.com/video/v1/assets
          │
          │  click on a video:  getEmbed(item) → descriptor → renderer → block table HTML
          │       actions.sendHTML(html)  →  editor inserts at cursor
          │       actions.closeLibrary()
          ▼
 page preview: site's `embed` block renders  <iframe src="https://player.mux.com/{playbackId}">  → Mux hosted player
 thumbnails:   <img src="https://image.mux.com/{playbackId}/thumbnail.jpg?width=320">   (browser → Mux CDN, public, no credential)
```

Responsibility split:

| Concern | Browser extension (public static files) | Worker (private runtime, holds the secret) |
|---|---|---|
| Mux credential | never | only place; `MUX_BASIC_AUTH` secret |
| Identity | obtains IMS token from SDK, sends it as Bearer | verifies it (template), rejects before any Mux call |
| Mux API calls | none | all of them, through `proxy`, host-locked to the Mux API origin |
| Search/filter/paging | debounce, stale-response handling, "load more" | walks Mux pages, filters, projects, bounded budget |
| Which videos are shown | shows what the worker returned | drops non-ready and non-public assets |
| Thumbnails | builds the public `image.mux.com` URL from the playback ID | n/a |
| Embed markup | descriptor to block table (single renderer), `sendHTML`, close library | none |
| Retries/backoff, 429s | shows retry UI | #2 proxy helper retries `429`/`5xx`; maps exhausted retries |
| CORS | none | #2 origin gate (`da.live` + site origins) |

## 2. EW integration points

- **Library plugin, not an app.** Registered in the `library` tab of the site config (`https://da.live/config#/{org}/{site}/`), columns `title`, `path`, `format`, `ref`, `icon`, `experience` [VERIFIED columns: https://www.aem.live/docs/ew/administering/set-up-library; resolution behaviour from https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/helpers.js as summarised in the #1 spec 2.5]. Row for this extension: `title` = `Video Picker`; `path` = `/apps/video-picker/video-picker.html` (a leading `/` resolves to `http://localhost:3000{path}` when the editor URL has `?ref=local`, else to `https://{branch}--{site}--{org}.aem.live{path}`; #1 spec 2.5); `ref` blank (always shows; matches the #1 hello-plugin approach); `format`, `icon`, `experience` blank (inline default). [OPEN: whether a larger `experience` value suits a thumbnail grid; semantics beyond `inline` are undocumented, #1 R11.]
- **Repo README row:** name `Video Picker`, folder `apps/video-picker/`, entry point `apps/video-picker/video-picker.html`, type `library plugin`, description "Browse a video library (Mux first) and insert an embed block." The S3 convention check (#1) requires it.
- **SDK surface used:** `token` (IMS, for the worker), `context` (not required; may be shown in debug only if at all), `actions.sendHTML(html)` (insert at cursor), `actions.closeLibrary()`. `sendHTML` with `{ replace: true }` and the `sendHTMLReplace` capability are not used [VERIFIED surface: https://da.live/nx/utils/sdk.js; the library channel advertises capabilities `{ liveDocument, sendHTMLReplace, chatTurnCompleted, dragDrop }`, https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/iframe-protocol.js]. `makeDraggable` (drag a thumbnail into the document) exists and would be a nice later affordance; out of scope.
- **`ref=local`:** page on `http://localhost:3000` (port fixed by EW, #1 spec 2.3) calls the local worker on `http://localhost:8787` (wrangler default; #2 Build Analysis 2). The local worker uses sandbox Mux credentials from an untracked `.dev.vars` and real Adobe IMS keys, so a real EW login works end to end. The page-origin allowlist for localhost is the local wrangler env's `ALLOW_LOCALHOST` (#2 decision 5).
- **Branch ref:** `https://{branch}--ew-extensions--jazhou-adobe.aem.live/apps/video-picker/video-picker.html` (EW may route through `*.preview.da.live`, #2 decision 5) calls the **deployed** worker (production Mux environment, or a sandbox one if the owner deploys a second environment: open question 3).
- **Which page `Origin` the plugin actually sends** is the #2 R2 unknown; this extension inherits whatever #2's manual step W3 records.
- **Site prerequisite for playback:** an `embed` block on the target site (R1).

## 3. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| Mux Video `GET https://api.mux.com/video/v1/assets` | list assets; params `limit` (max 100), `cursor`, `page` | HTTP Basic: access-token ID : secret; Read permission suffices | https://www.mux.com/docs/api-reference/video/assets/list-assets ; https://www.mux.com/docs/core/make-api-requests |
| Mux pagination | `next_cursor` (null = end); `limit` max 100 | same | https://www.mux.com/docs/core/make-api-requests ("API pagination") |
| Mux rate limit | non-POST bucket 100 requests, refill 5/s (high-priority token); exceeding returns `429` with a JSON `errors` array; `x-ratelimit-limit` / `x-ratelimit-remaining` response headers | n/a | https://www.mux.com/docs/core/make-api-requests ("API rate limits") |
| Mux asset schema | `status`, `duration`, `playback_ids[].policy` (`public`/`signed`/`drm`), `meta.title`, `test` | n/a | https://www.mux.com/docs/api-reference/video/assets ; https://www.mux.com/api-spec.json |
| Mux thumbnails | `https://image.mux.com/{PLAYBACK_ID}/thumbnail.jpg?width=` | none for public playback IDs; signed IDs need a JWT | https://www.mux.com/docs/guides/get-images-from-a-video |
| Mux hosted player | `https://player.mux.com/{PLAYBACK_ID}` iframe | none for public playback IDs | https://www.mux.com/docs/guides/playback-videojs-with-mux ("embed" snippet) ; observed headers 2026-11-16 |
| Mux test assets | `test: true` assets: free, watermarked, 10 s max, deleted after 24 h | n/a | OpenAPI spec `test` description, https://www.mux.com/api-spec.json |
| Block Collection `embed` block | default branch renders any link as an iframe | n/a | https://raw.githubusercontent.com/adobe/aem-block-collection/main/blocks/embed/embed.js |
| DA App SDK `sendHTML`, `closeLibrary`, `token` | insert and close | IMS token from EW | https://da.live/nx/utils/sdk.js ; https://www.aem.live/docs/ew/developing/apps-plugins |
| #2 worker template | IMS check, CORS, secrets, proxy/retries, error contract | IMS Bearer | `shared/worker-template/SPEC.md` |

**Auth flows.** Browser to worker: SDK-supplied IMS access token as `Authorization: Bearer`; worker verifies offline against Adobe IMS keys (#2). Worker to Mux: HTTP Basic with the `MUX_BASIC_AUTH` secret injected by `proxy`; the caller's token is never forwarded (#2). Browser to Mux CDN (images, player iframe): no credential, public playback IDs only.

**Mux account facts for the sandbox:** the account has no platform fee and needs no credit card to start; Mux Video includes 100,000 free delivery minutes per month; 1080p basic input is free; storage is $0.003/min/month [VERIFIED: https://www.mux.com/pricing]. A small test library costs effectively nothing. [ASSUMPTION: the free signup is still available in the owner's region; sign-up not attempted.]

## 4. Data contracts

All are behaviour contracts, not code.

**Provider contract**: decision 6. **Embed descriptor**: `{ url, title }`. **Item**: `{ id, title, durationSeconds, thumbnailUrl, ref }`.

**Worker route `GET /mux/assets`**

| Aspect | Contract |
|---|---|
| Auth | `Authorization: Bearer <IMS token>`; per #2: missing/invalid gives `401`, disallowed origin `403`, preflight `204` |
| Query | `q` (optional, trimmed, max 100 chars), `cursor` (optional, max 512 chars, URL-safe base64 alphabet) |
| `200` body | `{ items: [{ id, title, durationSeconds, playbackId, createdAt }], nextCursor }`; `durationSeconds` number or `null`; `createdAt` Unix seconds as a number (Mux gives a string; projection converts, `null` if unparsable); `nextCursor` string or `null`; `Cache-Control: no-store` |
| Errors | #2 JSON `{ error: { code, message, requestId } }`; Mux `429` to `429 rate_limited` + `Retry-After`; Mux `401/403` and other upstream failures to `502 upstream_unavailable`; invalid `q`/`cursor` to `400 bad_request`; missing secret to `500 misconfigured` |
| Never present | any Mux field other than the projection above; the Mux credential in any form; upstream error text |

**Worker configuration (wrangler `vars`, non-secret)**, in addition to #2's `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS`:

| Name | Meaning | Production | Local/test env |
|---|---|---|---|
| `MUX_API_ORIGIN` | origin the worker calls and the only allowed outbound host | `https://api.mux.com` | a local fake in tests/e2e |
| `MUX_PAGE_SIZE` | Mux `limit` per call | `50` | small (for example `3`) in tests |
| `MUX_MIN_RESULTS` | stop scanning once this many matches collected | `24` | small in tests |
| `MUX_MAX_PAGES` | max Mux calls per request | `5` | small in tests |

**Secrets (`secrets.required`):** `MUX_BASIC_AUTH` (base64 of `tokenId:tokenSecret`). Listed in the worker's `.dev.vars.example` (S3/UR5 from #2). `MUX_API_ORIGIN` must not be set to anything but `https://api.mux.com` in the production wrangler config (checked by a repo-check rule, test UR-V1 below).

**Library row:** section 2. **Block markup contract:** header row = block name `embed`; one content row; one cell; one `<a href="https://player.mux.com/{playbackId}">` whose text equals the href.

## 5. Folder layout (proposed; fits #1/#2)

```
apps/video-picker/
├─ SPEC.md                         this file
├─ README.md                       setup, library-sheet row, Mux token, worker deploy/secrets, local dev, branch-ref testing, embed-block prerequisite, provider-authoring guide
├─ video-picker.html               entry page: SDK <script type=module> + bootstrap
├─ video-picker.js                 bootstrap (awaits SDK, wires shell)
├─ video-picker.css
├─ picker.js                       side-effect-free shell logic (state machine, formatting)       } naming is the
├─ embed.js                        descriptor → block-table HTML (the single renderer)             } implementer's call
├─ providers/
│   ├─ index.js                    registry: the one place a provider is registered
│   └─ mux/
│       ├─ mux.js                  browser provider (list via worker, thumbnail/embed URLs)
│       └─ worker/                 Mux routes (GET /mux/assets), registered by ../../worker/
├─ worker/                         copied #2 scaffold: wrangler config, entry listing routes, .dev.vars.example, README, test stub
└─ test/
    ├─ unit/                       WTR tests: shell, embed renderer, registry, mux provider, conformance run
    ├─ support/                    provider conformance suite, contract-fixture checker
    ├─ fixtures/                   shared contract fixtures (worker responses), fake Mux page fixtures
    └─ e2e/                        Playwright specs (+ fake Mux/IMS servers)
```

Worker tests live in `providers/mux/worker/test/` and `worker/test/` (per #2). The #1 `.hlxignore` hides `**/test/`, `**/worker/` and configs from the code bus; the README and SPEC.md follow the repo's decision on planning artefacts (#1 Further Notes).

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **"Plays on preview" depends on the target site having an `embed` block.** This repo's site has no blocks; #13 AC1 cannot be demonstrated on a page in this repo's own site unless a block exists there. Shipping a copy of Block Collection's `embed` would add site code outside `apps/<name>/`, contradicting the decided convention. | High (blocks AC1's "plays") | Insert the standard `embed` block (decision 8); README documents the prerequisite; manual V5 runs on a site that has the block. [OPEN] owner chooses: (a) verify against another real site, (b) add a minimal `blocks/embed` to this repo (convention exception), (c) a different block name already present. |
| R2 | **How `sendHTML` parses the table is undocumented**; the block may land as a plain table, in the wrong place relative to the cursor, or with stray empty paragraphs (the replace path strips such paragraphs, suggesting aem2doc adds them [source: `replaceHTMLAtCursor`]). | High (AC1) | Manual V3 inspects the result in the editor and the saved HTML; adapt table shape (colspan, wrapping `<main>`) until correct; record the shape in README. Renderer unit test pins the final shape. |
| R3 | **Any allowed Adobe user can enumerate the owner's Mux library** (titles, IDs) through the worker once #2's gates pass; public playback IDs are public by design but a library may contain unlisted videos. Inherits #2 R3. | High | Use #2's client-id allowlist; document; optional authorization hook per #2; owner decides policy (open question 2). Use a Mux environment that contains only intended content. |
| R4 | **No server-side title search in Mux**; worker-side scan is bounded (5 pages x 50 = 250 assets per request). A match deeper than that needs repeated "Load more" with no visible progress. | Medium | Document; return `nextCursor` so scanning continues; message "Showing matches so far; load more to keep searching" when the budget ended with cursor left [UX string is the implementer's call]; sized by AC1 (small libraries fine). Future: cache/index (out of scope). |
| R5 | **Mux rate limits** (100-bucket, 5/s refill) vs. repeated searches: 5 calls per keystroke-debounced search per user. | Medium | 300 ms debounce + abort; page budget; `429` maps to a friendly retry message; template retry/backoff; low-priority vs high-priority token choice documented (https://www.mux.com/docs/core/make-api-requests). Caching out of scope. |
| R6 | **Single secret holds `base64(id:secret)`**: awkward, and redaction of its halves relies on template behaviour. | Medium | MW9 canary test for both halves; README command; open question 4 (template extension). |
| R7 | **Mux `401/403` mapping to `502`**: operators need a signal that the token was revoked/mis-scoped. | Low-Med | Distinct log outcome code (no secret); manual V6 revokes the sandbox token and checks the author sees a generic retry message and the log shows the code. |
| R8 | **Mux list ordering/`limit` default/cursor alphabet not fully specified** (docs disagree on default `limit`; cursor alphabet unspecified; ordering not guaranteed). | Low-Med | Always pass `limit`; strict-but-wide cursor validation with a manual check (V4); do not re-sort; recorded as [ASSUMPTION]. |
| R9 | **Mux Player maintenance mode / `player.mux.com` embed longevity.** | Low | Hosted iframe chosen; only the URL builder depends on it (one function, one test); [OPEN] revisit if Mux deprecates it. |
| R10 | **`sendHTML` is fire-and-forget** (decision 9); no feedback for failed insertion (for example read-only document). | Low-Med | Documented; manual V3/V7 (read-only doc behaviour observed and recorded). |
| R11 | **Titles are untrusted text** (anyone who can write Mux metadata controls them; Mux warns `meta` may be public). | Medium | Titles are only ever set via `textContent`; the embed renderer never puts titles in markup other than escaped attribute/text if at all; test with `<img onerror>` payloads (SH-x, EM-x). |
| R12 | **Thumbnail request limits** (1 distinct thumbnail per 10 s of duration per asset by default). | Low | One fixed URL per video; documented. |
| R13 | **Dependency on #1/#2 landing**: toolchain, test kit, template contract (especially `proxy` `auth` shape and redaction API) are specified, not built. | Medium | Build plan step 0 re-checks the template's real API; any mismatch is raised to the template owner, not patched here. |
| R14 | **Library-panel width/UX** unknown (no design in the ticket). | Low | Responsive CSS; manual V2 at real panel width; `experience` open question. |
| R15 | Inherits #1/#2 policy risks: **Adobe outside-activity/IP**, personal Cloudflare account handling a third-party credential, Code Sync + DA org/site naming. | High for publishing | Owned by #1 R1/R3/R10 and #2 R1; this extension adds a vendor credential, which the README must call out. |

## 7. Ordered build plan (sized to #13's acceptance criteria)

0. **Prerequisites (owner / earlier tickets):** #1 merged (tooling, hello apps, CI, README table, `.hlxignore`); #2 merged (template, test kit, hello worker deployed and verified in EW per its W0-W6); Mux account with a sandbox environment and a Read-only access token; Cloudflare account working with `wrangler login`; a target site with an `embed` block (R1). Re-read the merged template's real API and compare with this spec's assumptions (R13).
1. **Contract first (AC2):** write contract fixtures (worker response shapes: normal page, empty, last page, untitled) and the provider conformance suite; write failing tests against a trivial in-test fake provider. Define the registry with zero real providers.
2. **Embed renderer, test-first (AC1):** descriptor to block-table HTML, host allowlist, escaping, rejecting non-`https`. Pin the table shape (R2) with unit tests; revise after V3.
3. **Shell state machine, test-first (AC1, AC2):** formatting helpers, debounce, abort/stale handling, paging with de-duplication, error/empty/standalone states, insert + close. Entry page + CSS + bootstrap. Passes the shell tests with the fake provider.
4. **Mux provider (browser), test-first (AC1, AC2, AC7):** worker call with Bearer token, item mapping, thumbnail/embed URL builders with strict playback-ID validation, error mapping, worker-origin constant (ignores `?worker=`). Registered in the registry; runs the conformance suite.
5. **Mux worker route, test-first at W1 (AC1, AC3, AC7):** copy the #2 scaffold into `worker/`; write the Mux route under `providers/mux/worker/`: input validation, bounded scan with filtering/projection, error mapping, secret by name. Tests MW1-MW16 against the fake Mux; contract fixtures verified (C1).
6. **Runtime smoke (W2):** SMV tests under `wrangler dev` with fake Mux/IMS; measure Mux calls and CPU for the worst-case scan (R4/R5, informational).
7. **E2E (S1):** Playwright against local page + real local worker + fake Mux/IMS: browse, search, load more, insert-and-close recorded as SDK calls; negative paths. Hermetic, runs in CI.
8. **Repo integration (AC4, AC5, AC8):** extension README (all required topics), repo README table row, S3 convention check passes (entry page named after folder, tests, README, table row, `library` registration documented), lint/Stylelint, CI jobs green (unit, e2e, worker-unit, worker-smoke), UR-V1 repo-check rule for `MUX_API_ORIGIN`.
9. **Deploy and manual verification in EW (AC1, AC3, AC5, AC6, AC7):** set `MUX_BASIC_AUTH`, deploy the worker, set the worker-origin constant (normal PR), add the `library` row, run V0-V8; record observed `Origin`, the table shape that worked, and screenshots in the PR and README.
10. **Hand-off notes for #14/#15:** provider-authoring section in the README (contract, registry line, conformance suite, worker placement), listing the template wishlist (open question 4).

---

# Testing Requirements

## 1. Test IDs and layers

IDs are local to this spec. Prefixes: **EM** embed renderer, **SH** shell, **PC** provider conformance, **MP** Mux browser provider, **CT** contract fixtures, **MW** Mux worker (W1), **SMV** smoke (W2), **EV** e2e (S1), **UR-V** repo checks, **V** manual verification in EW.

## 2. Unit tests: browser side (seam S2, `@web/test-runner`)

Fixtures/mocks: #1's SDK stub (records `sendHTML`, `closeLibrary`, `sendText`; token `stub-token`); a fake provider object in tests; an injected `fetch` that serves the contract fixtures; fake timers for debounce and timeouts.

### 2.1 Embed renderer (AC1)

| ID | Behaviour asserted |
|---|---|
| EM1 | A descriptor with a valid `https://player.mux.com/{id}` URL renders the block-table form: header row with block name `embed`, one content row, one cell, one link whose `href` and text equal the URL; parsing the result with `DOMParser` yields exactly one table |
| EM2 | Descriptors with a non-`https` URL (`http:`, `javascript:`, `data:`), a host not on the provider's allowlist, a URL with credentials, or a malformed URL throw and produce no HTML |
| EM3 | A title containing `<img src=x onerror=...>` or `"` or `&` never appears unescaped in the output (the title is either absent or escaped) |
| EM4 | Playback IDs outside letters/digits (`../`, spaces, `?x=1`, `"`) are rejected before any URL is built (shared with MP) |

### 2.2 Shell (AC1, AC2)

Uses a fake provider (list scripted per call).

| ID | Behaviour asserted |
|---|---|
| SH1 | Standalone (SDK never resolves): "waiting" then "not running inside Experience Workspace" after the (injectable) timeout; search and list are not shown or are disabled |
| SH2 | With the SDK resolved: first `list` is called with empty query and no cursor; each item renders its title as text, a thumbnail, and duration formatted `0:07`, `1:05`, `1:02:03`; `null` duration shows no badge; `null` thumbnail shows a placeholder |
| SH3 | A title like `<script>alert(1)</script>` renders as visible text and creates no script/img elements |
| SH4 | Typing in the search box calls `list` once after the debounce with the trimmed query (not per keystroke); clearing it returns to the empty query; whitespace-only is treated as empty |
| SH5 | A response for a superseded query that arrives late is ignored; the earlier request's abort signal was aborted |
| SH6 | "Load more" appears only when `nextCursor` is non-null; clicking calls `list` with the same query and that cursor and appends; items with an already-shown `id` are not duplicated; the button disappears when `nextCursor` is null |
| SH7 | Empty library vs no matches for a non-empty query show different messages |
| SH8 | Each provider error code (`unauthorized`, `rate_limited`, `unavailable`, `timeout`, `bad_response`) shows its fixed message (including "session expired, reload the editor" for `unauthorized`), never the raw error text; "Try again" repeats the last call |
| SH9 | Clicking a video calls `getEmbed(item)`, then the renderer, then `actions.sendHTML` exactly once with the rendered table, then `actions.closeLibrary` exactly once, in that order; `sendText` is not called |
| SH10 | Keyboard: each video is reachable by Tab and activates with Enter and Space; the search input has an accessible name; the status region is polite |
| SH11 | A `getEmbed` failure shows an error and calls neither `sendHTML` nor `closeLibrary` |
| SH12 | The IMS token never appears in the DOM, console output, or in any request except the `Authorization` header to the worker origin |

### 2.3 Registry and conformance (AC2)

| ID | Behaviour asserted |
|---|---|
| PC1 | The conformance suite run against the Mux provider passes: `list` resolves `{ items, nextCursor }`; every item has the documented fields and types; `id`s unique; thumbnail URLs are `https` or null; `nextCursor` string or null |
| PC2 | The suite rejects deliberately broken providers (missing `getEmbed`, `list` returning HTML strings, duplicate ids, non-`https` embed URL, throwing a generic `Error` instead of a provider error): one failing case per defect |
| PC3 | `getEmbed` is pure/synchronous (no network, same input gives same descriptor) |
| PC4 | `list` honours an abort signal (rejects with `aborted`) |
| PC5 | Provider-agnostic shell: the shell test suite (SH*) passes unchanged when the registry holds only the in-test fake provider (proves no Mux assumption in the shell) |
| PC6 | Registry with two providers shows a provider switch; with one it shows none; switching resets query/cursor/grid; registering a provider needs no other shell change (a second fake provider is registered by adding it to the list in the test) |

### 2.4 Mux browser provider (AC1, AC3, AC7)

| ID | Behaviour asserted |
|---|---|
| MP1 | `list` sends `Authorization: Bearer <sdk token>` to the worker origin's `/mux/assets` with `q` and `cursor` only when set; no other headers carrying credentials; no request goes to `api.mux.com` |
| MP2 | Worker `200` fixture maps to items: thumbnail URL is `https://image.mux.com/{playbackId}/thumbnail.jpg?width=320`; `ref` is the playback ID; `durationSeconds` carried through |
| MP3 | `getEmbed` returns `https://player.mux.com/{playbackId}` for a valid ID; invalid playback IDs (see EM4) throw `bad_response` |
| MP4 | Status/code mapping: worker `401` to `unauthorized`; `403 forbidden_origin` to `unavailable`; `429` to `rate_limited` (retry-after surfaced as data, not parsed from text); `5xx`/network failure to `unavailable`; fetch not resolved in time to `timeout`; non-JSON or wrong-shape body to `bad_response` |
| MP5 | A page URL with `?worker=https://evil.example` is ignored; on `localhost` the worker origin is the loopback worker, on any other host the fixed deployed origin (extends #2 HP5) |
| MP6 | The response is never rendered as HTML: a fixture with markup in a title is shown as text (covered end to end by SH3) |
| MP7 | No Mux credential-like value appears in any request the provider makes (inspects all headers/URLs of the injected `fetch` calls) |

## 3. Contract fixtures (seam C1, AC2, AC7)

| ID | Behaviour asserted |
|---|---|
| CT1 | Each fixture file (normal page, empty page, last page with `nextCursor: null`, untitled asset, long title) validates against the contract shape checker (types, required fields, no extra fields, `https`-safe playback ID pattern) |
| CT2 | Worker tests (MW*) feed fake-Mux input and assert the worker's response equals/conforms to the same fixtures, so a worker change that alters the shape fails the worker suite *and* the browser provider suite (MP2) |
| CT3 | The shape checker rejects a fixture containing any non-projected field (for example `master`, `passthrough`, `tracks`): this is the machine form of "raw Mux JSON never reaches the browser" |

## 4. Worker tests (seam W1, `node:test`, in `providers/mux/worker/test/` and `worker/test/`)

Fixtures/mocks from the #2 test kit: `makeEnv` (production-like, canary `MUX_BASIC_AUTH` value built from known canary id/secret halves), `fakeIms` (RSA key pair, `signToken`), `fakeUpstream` configured as a **fake Mux**: matches path `/video/v1/assets`, checks the `Authorization: Basic ...` header equals the canary-derived value, supports `limit` and `cursor`, replays scripted pages of assets (ready/preparing/errored, public/signed/drm playback IDs, with/without `meta.title`, with a `master` object and `passthrough` to prove projection), returns `next_cursor`. `sleep`, `random`, `now` injected. Template-level behaviour (UA*, UC*, UP*, US* in #2) is **not repeated**; these tests add the Mux route's own behaviour and pin the integration of the route with the template (auth first, secrets, errors).

| ID | Behaviour asserted | Proves |
|---|---|---|
| MW1 | No token: `401`; fake Mux received zero requests; fake IMS key fetch not required to decide | AC7 |
| MW2 | Valid token, allowed origin, no `q`: one Mux call with `limit=<MUX_PAGE_SIZE>`, `Authorization: Basic <canary-derived>`, no caller `Authorization`, host equals `MUX_API_ORIGIN`; response `200` conforming to the contract fixture | AC1, AC3, AC7 |
| MW3 | Projection: response items have exactly `{ id, title, durationSeconds, playbackId, createdAt }`; `master.url`, `passthrough`, `tracks`, `errors`, `static_renditions` never appear anywhere in the response body | AC7 |
| MW4 | Filtering: `preparing`/`errored` assets dropped; assets with only `signed` or `drm` playback IDs dropped; assets with both public and signed use the public ID; assets with no `playback_ids` dropped | AC1 |
| MW5 | Titles: `meta.title` used when present; missing/empty title gives the fixed fallback with the first 8 characters of the asset ID | AC1 |
| MW6 | Search: `q=" Launch "` (padding, mixed case) matches titles containing "launch" case-insensitively, also matches `meta.external_id` and asset ID substrings; non-matching assets dropped | AC1 |
| MW7 | Scan budget: with `MUX_PAGE_SIZE=3`, `MUX_MIN_RESULTS=4`, `MUX_MAX_PAGES=3` and scripted pages, the worker stops when at least 4 matches are collected, when `next_cursor` is `null`, or at 3 Mux calls, whichever comes first (three scenarios), never exceeding the call budget; in the budget-exhausted case `nextCursor` equals the last scanned page's `next_cursor` | AC1, R4/R5 |
| MW8 | No lost or duplicated items: following `nextCursor` repeatedly over a scripted library (with mixed filtered/unfiltered assets) yields every matching asset exactly once, in Mux order, for several page sizes | AC1 |
| MW9 | Canary property test: across success, empty, each error path (Mux `401`, `403`, `429` exhausted, `500` exhausted, network error, malformed Mux JSON, missing secret) and a fake Mux that echoes the `Authorization` header in its error body, neither the canary `MUX_BASIC_AUTH` value nor its decoded id/secret halves appear in any response body, response header or captured log line | AC3, AC7 |
| MW10 | Mux `429` then `200`: retried by the template proxy (injected `sleep`), final `200`; always `429`: `429 rate_limited` with `Retry-After`, no upstream text | AC1 (robustness) |
| MW11 | Mux `401` and `403`: response is `502 upstream_unavailable` (not `401`); log has a distinct outcome code; body contains no Mux text | R7 |
| MW12 | Mux `5xx`/network error exhausts retries: `502 upstream_unavailable` | AC1 |
| MW13 | Input validation: `q` over 100 chars, `cursor` over 512 chars or with characters outside the allowed alphabet (`&`, spaces, `%`, `/`), repeated parameters: `400 bad_request` (or the documented behaviour), and no Mux call is made; an `q` containing `&limit=100&x=` cannot alter the outbound query (outbound query has exactly the expected parameters) | AC7 |
| MW14 | Host safety: when `MUX_API_ORIGIN` points elsewhere or a redirect (`302`) is returned by fake Mux, the worker never sends the credential to another host and does not follow the redirect | AC7 |
| MW15 | Missing `MUX_BASIC_AUTH` secret: `500 misconfigured` generic; log names the secret but not any value; no Mux call | AC3 |
| MW16 | Disallowed origin with a valid token: `403`; handler and Mux not called; `OPTIONS` preflight from an allowed origin succeeds without a token and without calling Mux (template behaviours exercised through this worker's real config) | AC7 |
| MW17 | The worker's route list contains exactly one route (`GET /mux/assets`); any other method on it gives `405`; unknown routes give `404` with a token, `401` without (auth before routing, #2 UA12 through this worker) | AC7 |
| MW18 | Production wrangler config (parsed in a test) lists `MUX_BASIC_AUTH` in `secrets.required`, does not list it in `vars`, and has `MUX_API_ORIGIN` unset or exactly `https://api.mux.com`; `ALLOW_LOCALHOST` false | AC3, AC7 |

## 5. Runtime smoke (seam W2)

Starts the real Mux worker under `wrangler dev` (no Cloudflare login), `IMS_ORIGIN` and `MUX_API_ORIGIN` pointing to local Node servers (fake IMS, fake Mux), secret from a temp env file.

| ID | Behaviour asserted |
|---|---|
| SMV1 | The worker bundles (shared core and `jose` resolve) and starts; a bare request gets `401` |
| SMV2 | Valid test-signed token: `200`, contract-conforming body; preflight from an allowed origin and from `https://evil.example` behave per #2 over real HTTP |
| SMV3 | A multi-page scripted library returns the same results as W1 (MW7/MW8 scenarios repeated at least once in the real runtime) |
| SMV4 | The canary credential (and its halves) is absent from all responses (MW9 repeated over HTTP) |
| SMV5 | Records Mux subrequests, wall time and CPU for the worst-case scan (full `MUX_MAX_PAGES` budget); informational against the Free plan's 10 ms CPU / 50 subrequest limits (R4/R5); no hard threshold until a baseline exists |

## 6. End-to-end tests (seam S1, Playwright, Chromium, hermetic)

Config: the #1 static server serves the repo on `:3000`; Playwright's `webServer` also starts the Mux worker (wrangler, local env, `:8787`), the fake IMS server and the fake Mux server (a small Node server with a scripted library, including a library larger than one page, in global setup). The #1 SDK stub provides a token signed by the fake IMS key and records `sendHTML`/`closeLibrary` calls; every other external request (including `image.mux.com`, which is routed to a tiny local image) is aborted so the run proves the allowed hosts.

| ID | Behaviour asserted | Proves |
|---|---|---|
| EV1 | Open the plugin page in a library-panel-sized viewport: grid shows thumbnails, titles, durations from the fake Mux through the real worker (real cross-origin request, preflight included) | AC1, AC6 (local origins), AC7 |
| EV2 | Type a search term: grid narrows to matching titles; clearing restores; typing quickly shows only the final query's results | AC1 |
| EV3 | Library larger than one page: "Load more" appends the rest with no duplicates; button disappears at the end | AC1 |
| EV4 | Click a video: recorded SDK calls are `sendHTML` (one table containing `https://player.mux.com/{playbackId}` for exactly the clicked video) then `closeLibrary` | AC1 |
| EV5 | Videos that are not ready or have only signed playback never appear in the grid | AC1 |
| EV6 | Worker `401` (stub token signed by a different key) shows the "session expired" message and no grid; a page request with the token removed gets `401` from the worker through the full browser path, and the CORS headers let the page read it | AC7 |
| EV7 | Worker down or slow (fake Mux delayed beyond the bound): visible loading, then the timeout/unavailable message and "Try again"; no stack trace or upstream text | AC1 (robustness) |
| EV8 | Page HTML, DOM text and every network response/request body contain neither the IMS token nor the Mux credential (nor its halves) anywhere except the allowed `Authorization` header to the worker; only expected hosts were contacted (page, worker, SDK stub, local image) | AC3, AC7 |
| EV9 | Standalone (SDK route unfulfilled): standalone message shown, no worker call | AC1 (robustness), #1 parity |

## 7. Repo checks (seam S3, extended)

| ID | Behaviour asserted | Proves |
|---|---|---|
| UR-V1 | The #1 convention check passes for `apps/video-picker` (entry page named after folder, README, tests, table row, `library` registration documented in its README, `providers/` and `worker/` treated as sub-structure); fixture tests for the failure cases are #1's | AC4, AC5 |
| UR-V2 | The #2 worker checks pass: `apps/video-picker/worker` has wrangler config, README, test; no tracked `.dev.vars*`; `.dev.vars.example` lists `MUX_BASIC_AUTH`; no secret-looking key in `vars` | AC3, AC7 |
| UR-V3 | A rule or test fails when the production wrangler config sets `MUX_API_ORIGIN` to anything other than `https://api.mux.com` (MW18 may serve as the implementation) | AC7 |
| UR-V4 | Lint (ESLint 8 + helix, Stylelint 16) covers all new JS/CSS including tests and worker code (worker globals override from #2) | AC8 |

## 8. End-to-end checks inside real Experience Workspace (manual; needs interactive Adobe login)

Accounts and credentials needed (none can be provided by an agent):
- GitHub admin on `jazhou-adobe/ew-extensions` and Code Sync installed (#1 M0).
- An Adobe IMS identity with access to the DA org/site and permission to edit the site config (`https://da.live/config#/{org}/{site}/`); Chrome.
- A **Mux account** (free sign-up) with two environments if possible: *Development/sandbox* (used by the local worker) and the *Production/real library* (used by the deployed worker). In each: a **Read-only** access token (token ID + secret). Create the sandbox library via the dashboard or API using the sample input from Mux's docs (`https://muxed.s3.amazonaws.com/leds.mp4`) [VERIFIED as the doc example: https://www.mux.com/docs/core/make-api-requests] with `playback_policies: ['public']`, `video_quality: 'basic'`. Needed assets: 3 titled public videos (one title with an `&` and a quote), 1 untitled, 1 with a signed-only playback ID (must be hidden), 1 still preparing or errored (must be hidden, optional to arrange), and enough assets to need paging only if the page size is lowered via `MUX_PAGE_SIZE` for the test (recommended, no need for dozens of assets). `test: true` assets are free but deleted after 24 h; use a permanent small basic-quality clip for repeatable checks.
- A Cloudflare account with Wrangler login (from #2 W0).
- A site (or page) with an `embed` block (R1).
- Never paste a real IMS token, Mux token/secret, or `MUX_BASIC_AUTH` value into chat, issues, PR descriptions or logs.

Steps (numbered V to avoid collision with #1 M and #2 W):

- **V0 (prereq):** #1 M0 and #2 W0 done; `wrangler secret put MUX_BASIC_AUTH` for the production Mux environment; `wrangler deploy` from `apps/video-picker/worker/`; `curl -i <worker>/mux/assets` returns `401` (liveness + AC7 negative). Set the worker-origin constant in the extension (PR).
- **V1 (register):** add the `library` row (`Video Picker`, path `/apps/video-picker/video-picker.html`) in `https://da.live/config#/jazhou-adobe/ew-extensions/`. Open a document in the EW editor with `?ref=local`; the editor library lists *Video Picker*. Repeat with a branch ref. [AC5]
- **V2 (`ref=local`, browse/search):** terminal A `npm start` (port 3000), terminal B the worker dev script (port 8787, sandbox Mux creds in `.dev.vars`, `ALLOW_LOCALHOST` via the local env). Open the editor with `?ref=local`, open the library, choose *Video Picker* (trust prompt may appear once, #1 M1). Expected after about a second: the grid of sandbox videos with thumbnail, title, duration; at real panel width nothing is clipped. Type part of a title: narrows. Untitled video shows the fallback label; signed-only video is absent. DevTools Network: `OPTIONS` `204`, `GET /mux/assets` `200` with `Access-Control-Allow-Origin: http://localhost:3000`; no request to `api.mux.com`; no Mux credential in any response (search the Network panel for the token ID and secret). [AC1, AC3, AC6, AC7]
- **V3 (insert):** with the cursor in an empty paragraph, click a video. Expected: the library closes and an embed block (a table with `embed` header and the link) appears at the cursor. Inspect the saved/preview HTML (`.plain.html` of the page after save and preview) to confirm it is a block named `embed` with one link `https://player.mux.com/...`; record how `sendHTML` placed it (R2) and adapt the renderer/README if not. Also try: cursor mid-paragraph; cursor in an existing block; read-only document (R10). [AC1]
- **V4 (paging against real Mux):** with `MUX_PAGE_SIZE` lowered and several assets: "Load more" returns the rest without duplicates; confirm a real Mux `next_cursor` passes validation (R8). [AC1]
- **V5 (plays on preview):** preview the page on the site that has the `embed` block (`ref=local` code and again with a branch/main ref); the player loads and the video plays, including fullscreen. If the site lacks the block, record the result (R1 decision). [AC1]
- **V6 (failure modes):** (a) revoke the sandbox token in the Mux dashboard: the author sees a generic retry message (not "session expired") and the log shows the distinct outcome (R7); (b) stop the local worker: "unavailable"/timeout message and "Try again" recovers once restarted; (c) run the worker with an expired/other-key token path (EV6 equivalent) if feasible. [AC7]
- **V7 (branch ref, deployed worker):** push branch `video-picker-mux` (simple name), wait for code sync; open the editor with `?ref=video-picker-mux`, repeat V2-V5 against the deployed worker. In DevTools record the page's real `Origin` (aem.live or preview.da.live) and confirm CORS passes. Confirms AC6 with a branch ref and AC7 against the deployed worker. [AC6, AC7]
- **V8 (secret hygiene and negatives against the deployed worker):** `wrangler secret list` shows names only; `curl` with no token returns `401`; with `Origin: https://evil.example` and a valid token returns `403`; search the page source, Network responses and Application storage for the Mux token ID/secret and `MUX_BASIC_AUTH` value (none found). [AC3, AC7]

## 9. CI

No new job types; this extension's tests join #1/#2 jobs. No credentials, no Mux account, no Cloudflare login in CI.

| Job | Covers | Notes |
|---|---|---|
| `lint` | ESLint/Stylelint for all new code; S3 convention check (UR-V1..V3) | existing |
| `unit` | EM*, SH*, PC*, MP*, CT* (WTR) | existing |
| `worker-unit` | MW* (`node:test`) | existing from #2 |
| `worker-smoke` | SMV1-SMV5 | #2 R13 applies (flakiness policy) |
| `e2e` | EV1-EV9 (starts page server, worker, fake IMS, fake Mux) | existing job gains the extra servers |

## 10. Acceptance-criteria traceability (ticket #13)

| # | Acceptance criterion (#13) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Author can browse/search Mux assets with thumbnail, title and duration, and insert an embed block that plays on preview | SH2-SH9, SH11 (UI, search, paging, insert order); EM1-EM4 (embed markup); MP2-MP3 (item mapping, URLs); MW2-MW8, MW10-MW12 (listing, filtering, titles, search, scan budget, no lost items, upstream robustness); CT1-CT2; EV1-EV5, EV7 | **V2** (browse/search in real EW), **V3** (insertion lands as a block), **V4** (real-Mux paging), **V5** (plays on preview; depends on site `embed` block, R1) |
| AC2 | Provider interface (list/search, get embed markup) is defined so further providers only add a module | PC1-PC6 (conformance suite, broken-provider detection, provider-agnostic shell, registry with two providers); CT1; EM2 (renderer only accepts descriptor data) | Review: README provider-authoring section lists the contract and the one-line registration; reviewer follows it on a scratch fake provider and sees the shell unchanged; #14/#15 specs reference the conformance suite |
| AC3 | Mux API token is held by the worker | MW2 (credential only on the outbound Mux call), MW9 (canary never leaks, halves included), MW15 (missing secret generic), MW18 (`secrets.required`, not in `vars`); MP1, MP7 (browser never sends/holds one); EV8; UR-V2, UR-V3; SMV4 | **V8** (`wrangler secret list` names only; storage/network searched), **V2**, **V0** |
| AC4 | All code in its own self-contained `video-picker` folder, with a README covering setup, the EW config-sheet row, and any site config it reads | UR-V1 (folder structure, entry page, tests, README present, registration row documented), UR-V2 (worker structure), UR-V4 | Review: README has sections for setup, `library` row, Mux token creation, worker deploy/secrets, local dev, branch-ref testing, `embed`-block prerequisite, and an explicit "reads no site config / query parameters" statement (decision 27); folder contains no imports from other extensions (S3 or review) |
| AC5 | Listed in the repo README extensions table and reachable from the editor library | UR-V1 (table row exists for the folder and resolves to the entry page) | **V1** (the library lists *Video Picker* with `?ref=local` and with a branch ref); review of the table row's five columns |
| AC6 | Works in EW with `ref=local` and with a branch ref | EV1 (page at `localhost:3000` talking to a real local worker across origins); MP5 (origin selection by host) | **V2** (`ref=local`), **V7** (branch ref against the deployed worker, real `Origin` recorded) |
| AC7 | Vendor credentials only in this extension's worker (built from the shared template); browser never receives them; unauthenticated calls rejected | MW1, MW9, MW13, MW14, MW16, MW17 (auth first, no leakage, host-locked outbound, origin gate); CT3 (no raw Mux JSON); MP7; EV6 (unauthenticated path through the browser), EV8; SMV1, SMV2, SMV4; UR-V2/UR-V3 | **V0** (bare `curl` gives `401`), **V8** (deployed negatives and secret hygiene), **V2** (Network panel), **V6** |
| AC8 | Core logic covered by unit tests; lint and CI green | EM*, SH*, PC*, MP*, CT*, MW* run by the `unit` and `worker-unit` jobs; UR-V4 lint; `e2e`/`worker-smoke` jobs | Review: CI shows all jobs green on the PR; a deliberately broken provider or a loosened filter on a scratch branch turns PC2/MW4 red (not merged) |

Every acceptance criterion on #13 maps to at least one automated test or a numbered manual verification step above. Criteria on #51 itself: the folder exists with `SPEC.md` (this file); the file follows the to-spec template (Problem Statement through Further Notes) and adds Build Analysis and Testing Requirements; the traceability table above covers every #13 criterion; external API claims carry URLs, and unverified claims are tagged [ASSUMPTION] or [OPEN]; no implementation code is included (only behavioural descriptions).

## 11. Open questions for the owner

1. **"Plays on preview" and the `embed` block (R1).** This repo's site has no blocks. Which site/page will verify AC1's playback: another real site that already has Block Collection's `embed`, or do you want a minimal `blocks/embed` added to this repo as an explicit exception to the `apps/<name>/` convention? Is `embed` the right block name for your sites?
2. **Who may list the Mux library (R3).** Is "any authenticated Adobe user passing #2's client-id allowlist" acceptable for the deployed worker, given it lets them enumerate every video in that Mux environment (including videos not linked anywhere)? Or should the worker restrict by user/org from the start (and how would membership be decided)?
3. **Mux environments and accounts.** Which Mux environment does the deployed worker use (production with real content, or a sandbox with demo content)? Is a second deployed worker/environment wanted for branch-ref testing? Is it acceptable that a personal Cloudflare account holds a production Mux credential (inherits #1 R1/#2 R1)?
4. **Template extension for Basic auth.** This spec uses one precomputed secret `MUX_BASIC_AUTH` so it works with #2's single-secret `proxy` contract. Do you want #2 to add native two-secret Basic auth (and OAuth client-credential exchange for Brightcove #15) to the template, or keep the precomputed-secret convention?
5. **Insertion behaviour.** Insert-and-close on a single click, no confirmation, no preview. Acceptable, or do you want a "keep library open" option, drag-and-drop (`makeDraggable`), or a details/preview step?
6. **Signed playback.** Videos with only signed playback IDs are hidden in v1. Does your Mux library use signed playback? If yes, signed playback support (second secret: signing key; JWT minting in the worker) should be pulled in or scheduled.
7. **Search expectations.** Title/external-ID/asset-ID substring search over a bounded scan (up to 250 assets per request, with "Load more" to continue). Is that enough for your library size, or do you need an index/cache in a follow-up?
8. **Untitled videos.** Fallback label `Untitled video (<first 8 chars of id>)`. Do you want a different label, or should untitled videos be hidden?
9. **Panel size and layout.** Should the library row use a larger `experience` value (undocumented semantics, #1 R11) or stay inline? Is a one/two-column grid in the narrow panel acceptable without a design?
10. **Block name and per-site configuration.** Constant `embed` now; do you want a DA site-config sheet (enabled providers, block name per site) later, and should it be part of #14/#15's scope?
11. **Embed longevity.** The hosted `player.mux.com` iframe is used because Mux Player is in maintenance mode. Is relying on the hosted player OK, or do you prefer a self-hosted Video.js/HLS block?
12. **Poster/placeholder and title for accessibility.** The block has no poster image and the iframe title is whatever the site's `embed` block sets. Do you want a poster or a visible title/caption included in the block?
13. **Mux account and sandbox.** Can you provide a Mux account/environment and a Read-only token for local testing and CI-independent manual verification? (No credentials needed in CI; none requested here.)
14. **Worker naming/domain.** Deployed worker name (for example `ew-video-picker-worker`) and a `workers.dev` subdomain: confirm, or give the real values (same question as #2 open question 13).
15. **Policy carry-over.** Confirm that the open policy items from #1/#2 (Adobe outside-activity/IP; no public marketplace process found) are accepted as-is for this extension, whose README must also state that it handles a third-party vendor credential.
