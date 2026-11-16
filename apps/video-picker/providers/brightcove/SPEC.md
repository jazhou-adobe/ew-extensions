# Spec: Video Picker: Brightcove (provider)

Ticket: jazhou-adobe/ew-extensions#15 (this spec: #53). Blocked by #13 (Video Picker shell + Mux provider; spec in `apps/video-picker/SPEC.md`), which itself is blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). #15 blocks nothing.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1, #2 and #13 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from a vendor/Adobe.

Vocabulary follows #1, #2 and #13: *extension* = one folder `apps/<name>/` (this one is the **library plugin** `video-picker`); *worker* = the per-extension backend (`apps/video-picker/worker/`, built from `shared/worker-template/`); *template* = `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension; *shell*, *provider*, *library* (vendor catalogue; the EW panel is the *editor library*) as defined in #13. Added here: *Brightcove access token* = the short-lived OAuth token the worker obtains from Brightcove and uses against the CMS API (never an IMS token, never sent to the browser); *client credentials* = the Brightcove client ID + client secret pair created in Studio; *CMS API* = Brightcove's Video Cloud CMS REST API; *Player* = a Brightcove Player configuration identified by a player ID.

**Interface assumptions about #13.** `apps/video-picker/` contains only #13's SPEC.md today (checked 2026-11-16, directory listing; no code exists). This spec therefore implements against the provider contract *as specified in #13* (Implementation Decisions 5-10, 17-18, 21-22, Testing Decisions seams S1/S2/W1/W2/C1/P1/S3) and states every point where it relies on something #13 leaves implicit. The one real gap is the embed-host allowlist (see Implementation Decision 4 and Open Question 9). If the implemented #13 interface differs from the spec, Build Plan step 0 reconciles it before any code is written; this spec does not redesign the shell.

---

## Problem Statement

A content author in Experience Workspace (EW) whose organisation hosts video in **Brightcove** has to leave the editor, open Brightcove Studio, find the video, copy a video ID and the player's embed code, work out what markup the site's embed block expects, and type it into the document by hand. Each step is error-prone: wrong video ID, wrong player, a code snippet with a script tag the editor strips, a hand-built table that is not a block. #13 solves exactly this for Mux through a provider-agnostic picker shell; Brightcove is the second vendor (ticket text: "Brightcove needs OAuth client-credential API auth through the worker").

Brightcove makes it harder than Mux in three ways, each of which shapes this spec:

1. **Two-hop authentication.** The CMS API needs a `Bearer` access token that lives only 300 seconds and is obtained by exchanging a client ID and secret at a separate OAuth service [VERIFIED: https://apis.support.brightcove.com/oauth/getting-started/overview-oauth-api-v4.html, "Client credential flow", `expires_in: 300`]. The client secret must never reach the browser, and the OAuth service refuses browser origins anyway [VERIFIED by observation: an `OPTIONS` preflight to `https://oauth.brightcove.com/v4/access_token` with `Origin: https://da.live` returned `403 Invalid CORS request` on 2026-11-16]. Brightcove's own docs also warn that credentials "are not advisable to expose ... to browsers" (Python sample comment at https://apis.support.brightcove.com/oauth/guides/getting-access-tokens.html).
2. **Different listing and search model.** There is no cursor, only `limit`/`offset`; search is a relevance-oriented, stemmed, whole-word query language, not a substring filter; there is no total in a search response; and paging is only stable if `sort` is always sent [VERIFIED: https://apis.support.brightcove.com/cms/searching/cms-and-playback-apis-video-search-v2.html, "Known issues"].
3. **Embed constraints.** The iframe embed is the only form that fits #13's "embed block with one link" renderer, but Brightcove states that on players with *domain restrictions* the iframe embed "cannot ... function properly" [VERIFIED: https://player.support.brightcove.com/content-protection/overview-content-protection.html, "Domain restrictions"]. Videos with Playback Rights need a JWT the iframe link cannot carry [ASSUMPTION; see R5].

The maintainer needs Brightcove added as **a new provider inside the existing `video-picker` extension**, with the vendor credentials only in the extension's worker, and with no change to the shell beyond registering the provider (#15 acceptance criterion 3).

## Solution

From the author's point of view nothing new appears in the editor library: *Video Picker* (the #13 library plugin, same `library` row) now offers **Brightcove** as a provider. With more than one provider registered, #13's shell shows its provider switch; the author picks Brightcove and sees a grid of videos from the connected Brightcove account (thumbnail, title, duration), newest first, with the same search box, "Load more", empty/error/expired-session states and one-click insert-and-close as for Mux. Search finds videos by whole words in name, description, tags, reference ID, ID and similar fields (Brightcove's search, not a substring match). On insert the shell puts an `embed` block with one link into the document; previewed on a site with an `embed` block the link renders as an iframe of the Brightcove player (`https://players.brightcove.net/{account}/{player}_default/index.html?videoId={id}`, the iframe form Brightcove documents) and the video plays.

Under the hood this is a **provider module** (browser part plus worker part) that plugs into the #13 contract:

- The **browser provider** answers the shell's two questions. `list` calls one route on the extension's existing worker with the SDK's IMS token as `Bearer`; `getEmbed` is a pure function that builds the player URL from validated IDs. It never talks to Brightcove, never sees a credential, and never receives a Brightcove access token.
- The **worker route** (`GET /brightcove/videos`, added to the worker that #13 already deploys) holds the Brightcove client credentials as a Cloudflare secret, exchanges them for a short-lived access token **inside the worker**, caches that token in memory for its lifetime, calls the CMS API with it, drops everything that cannot be embedded safely, and returns a fixed projection of each video. Authentication, CORS, retries, secret redaction and the error contract are the #2 template's; this ticket adds the OAuth exchange, the token cache, the search translation, the paging rule and the projection.
- Adding Brightcove touches the shell **not at all**: one provider-registry line, one worker-entry registration, configuration entries (worker `vars` and the secret name), and README text. The conformance suite from #13 is run against the new provider unchanged.

## User Stories

Content author (EW end user):

1. As a content author, I want to choose Brightcove in Video Picker, so that I can add a Brightcove video without leaving the editor.
2. As a content author, I want to see my Brightcove videos as a grid of thumbnails with title and duration, so that I can recognise the right one at a glance.
3. As a content author, I want the newest videos first without any setup, so that the video I just published is easy to find.
4. As a content author, I want a search box that finds videos by words in their name, so that I can find one video in a large library.
5. As a content author, I want search to ignore upper/lower case and surrounding spaces, so that I do not have to guess how the title was typed.
6. As a content author, I want to search by a pasted video ID or reference ID, so that I can find the exact video a colleague named.
7. As a content author, I want punctuation or search-language characters in my text (quotes, colons, `*`, `AND`, `NOT`) never to break the search or produce an error, so that odd input cannot lock me out.
8. As a content author, I want the results to update as I type (with the same short pause as for Mux), so that I do not have to press a button and do not see flicker from stale responses.
9. As a content author, I want a "Load more" control when the library has more videos, so that large libraries are reachable without a huge first load.
10. As a content author, I want videos that are inactive, still processing, not yet published, expired, or protected by playback rights to be left out of the list, so that I cannot insert a video that will not play.
11. As a content author, I want a video without a usable name to still appear with a readable fallback label, so that unnamed items are not invisible.
12. As a content author, I want durations shown as `m:ss` or `h:mm:ss`, so that I can tell a clip from a webinar.
13. As a content author, I want one click on a video to insert an embed block at my cursor and close the editor library, so that I can carry on editing.
14. As a content author, I want the inserted content to be a normal block in the page (move, delete, edit), so that it behaves like any other block.
15. As a content author, I want the video to play when I preview the page, so that I know the insertion worked.
16. As a content author, I want a clear empty state and a clear no-match state for a search, so that I know whether the library or my query is the issue.
17. As a content author, I want a short plain error with "Try again" when Brightcove or the backend is slow, down or rate limited, so that I know whether to retry or contact the maintainer.
18. As a content author, I want a visible "session expired, reload the editor" message only when my own EW login is rejected, and not when the *vendor* credential is the problem, so that I am not told to log in again for something I cannot fix.
19. As a content author, I want the picker never to hang (bounded wait with a visible loading state), so that the editor library never looks frozen.
20. As a content author, I want to use the picker by keyboard with a visible focus, so that I do not need a mouse.
21. As a content author, I want titles shown exactly as written, as text and never as markup, so that an odd video name cannot break the picker or the page.
22. As a content author, I want the switch between Mux and Brightcove to reset the grid and search, so that I never see one vendor's results labelled as the other's.

Extension author (maintainer or an agent working #14 or a later vendor):

23. As an extension author, I want Brightcove added as one provider folder plus one registration line, so that #15 proves the #13 contract really lets a vendor land without shell changes.
24. As an extension author, I want the Brightcove provider to pass the #13 conformance suite unchanged, so that "conforms to the contract" is machine-checked, not argued.
25. As an extension author, I want Brightcove's worker code next to Brightcove's browser code, so that a vendor ticket touches one folder (plus the registered entries).
26. As an extension author, I want a fake Brightcove (an OAuth service and a CMS API that replay scripted responses and understand the small query grammar the worker emits) in the test kit, so that I can test everything without a Brightcove account.
27. As an extension author, I want shared contract fixtures for the Brightcove worker response, so that browser and worker tests cannot drift apart.
28. As an extension author, I want Brightcove's non-secret settings (account ID, player ID, page size, scan budget, vendor origins for tests) to be worker `vars`, so that tests and local runs can tune them without touching secrets.
29. As an extension author, I want a README section that walks me through creating Brightcove credentials, finding the account and player IDs, and setting the secret, so that enabling Brightcove is copy-paste.

Maintainer / operator:

30. As the maintainer, I want the Brightcove client credentials stored only as a Cloudflare worker secret, so that nothing credential-like exists in the repo, the page, the network log or the logs.
31. As the maintainer, I want the Brightcove credentials to carry the read-only video permission for exactly one account, so that a leak cannot create, change or delete videos or touch other accounts.
32. As the maintainer, I want unauthenticated calls to the worker rejected before any Brightcove call (including the token exchange) is made, so that the internet cannot spend my Brightcove rate limit or enumerate my library.
33. As the maintainer, I want the worker to return only a fixed projection of each video (not raw CMS JSON), so that fields such as the digital-master flag, custom fields, creator e-mails or playback-rights IDs can never reach the browser.
34. As the maintainer, I want the access token cached for its lifetime and refreshed on expiry or on a `401`, so that typical use costs one CMS call per search and an expired token never surfaces as an error.
35. As the maintainer, I want a distinct log outcome when Brightcove rejects the credentials (bad secret, revoked client, wrong scope, wrong account ID), so that I can tell "fix the secret" from "Brightcove is down".
36. As the maintainer, I want the amount of Brightcove work per request bounded (calls per request), so that one search cannot exceed Brightcove's per-account limits (under 10 requests/second, 20 concurrent) or the Workers subrequest budget.
37. As the maintainer, I want the production worker pinned to the real Brightcove hosts by a machine check, so that a configuration slip cannot send the credential elsewhere.
38. As the maintainer, I want CI (lint, unit, worker tests, convention check) to cover Brightcove on every push and PR, so that regressions cannot merge.
39. As the maintainer, I want the prerequisites that make an embed play (site `embed` block; player without domain restrictions) documented, so that "it inserted but does not play" has a documented cause.

Security reviewer:

40. As a security reviewer, I want a test proving that none of the client ID, the client secret, the combined secret, or an issued access token appears in any response body, header or log across success and every error path, so that "the browser never receives them" is tested rather than promised.
41. As a security reviewer, I want a test proving the credential is sent only to the configured Brightcove OAuth host and the access token only to the configured CMS host, and that redirects are not followed, so that the worker cannot become an open proxy.
42. As a security reviewer, I want user search text and cursors validated, length-capped and *translated* (not concatenated) into Brightcove's query language with a fuzz test, so that query-language injection (operators, extra fields, parameter smuggling) is impossible.
43. As a security reviewer, I want video, account and player IDs validated against strict patterns before they build an embed URL, so that a malformed value cannot inject markup or redirect the iframe.

## Implementation Decisions

(No file paths or code, except the type-shape notes marked as such. Paths and layout are in the Build Analysis.)

**Placement and registration (AC3)**

1. **One provider, no shell change.** Brightcove is one new provider: id `brightcove` (lower-case, used in the registry and logs), label `Brightcove`. It is registered with the single registration line in the #13 provider registry. The shell, the embed renderer, the conformance suite, the contract-fixture checker and the shell tests are not modified. The only edits outside the provider's own folder are: the registry line; the worker entry's route registration; the worker's configuration (non-secret `vars` and the secret *name* in `secrets.required`) and its `.dev.vars.example`; the extension README (a Brightcove section); test-kit additions (a fake Brightcove) that live with the provider's tests. A review checklist (Testing Requirements §7, BR5) enforces this list.
2. **No new EW registration.** The extension is already registered by #13's single `library` row. Brightcove adds no row, no config-sheet key, and no DA site-config key is read (inherits #13 decision 27: the picker reads no site config, query parameters or cookies). "Site config keys" in the README (#15 AC4) therefore means: the unchanged `library` row, the worker's non-secret `vars`, and the one secret.
3. **Provider contract as #13 specifies it.** `list({query, cursor, signal})` resolves `{ items, nextCursor }` with items `{ id, title, durationSeconds, thumbnailUrl, ref }`; `getEmbed(item)` is pure and synchronous and returns `{ url, title }`; errors are provider errors with one of `unauthorized`, `rate_limited`, `unavailable`, `timeout`, `bad_response`, `aborted`. Providers return data, never HTML.
4. **Embed-host declaration (the one contract gap).** #13 decision 8 says the renderer accepts only `https` URLs "on the allowlist of hosts the active provider declares (Mux: `player.mux.com`)", but decision 6 lists the contract as id, label, `list`, `getEmbed` and does not name a field for the host list. This spec assumes the provider declares its embed hosts as part of the provider object (Brightcove: `players.brightcove.net`) and that the conformance suite checks `getEmbed` URLs against it [ASSUMPTION; Open Question 9]. If the implemented #13 has no such field, the correct fix is a #13 contract amendment (data, not shell behaviour), raised by the #13 owner; #15 must not patch the shell.
5. **Item `ref` is opaque and provider-private.** The Brightcove provider packs the validated account ID, player ID and video ID into `ref`; the format is the implementer's choice but `getEmbed` must parse it with the same strict patterns it used to build it (decision 18) and throw `bad_response` otherwise.

**Worker route and credentials (AC2, AC6)**

6. **One route added to the existing worker:** `GET /brightcove/videos` with query `q` (optional) and `cursor` (optional). It lives in the Brightcove provider's `worker/` folder and is registered by the extension's worker entry, exactly as #2 decision 3 and #13 decision 29 prescribe [placement refinement is [OPEN] in #2 and #13]. Pipeline order, CORS, IMS verification, error contract, redaction and logging are the #2 template's and are not re-implemented. No Brightcove call (including the token exchange) happens before the caller is authenticated (#2 decision 4).
7. **Credentials: one secret, `BRIGHTCOVE_BASIC_AUTH`, holding `base64(clientId:clientSecret)`.** This is the same convention #13 decision 18 chose for Mux, for the same reason: it fits #2's single-secret `proxy` contract with no template change. The Brightcove token endpoint needs exactly this value as an HTTP Basic `Authorization` header [VERIFIED: https://apis.support.brightcove.com/oauth/getting-started/overview-oauth-api-v4.html, "The entire `{client_id}:{client_secret}` string must be Base64 encoded"]. The secret is declared in `secrets.required` (a deploy without it fails), is read only through the template's accessor, and is injected by `proxy` with the `Basic` scheme. The README gives a command that builds the value from two prompts and pipes it into `wrangler secret put` without it touching history or a file. [ASSUMPTION about the template: `proxy` accepts `auth: { secret, header, scheme }` as in #2's "Proxy options contract"; native two-secret / OAuth support in the template is #13 Open Question 4 and is **not** required by this spec.]
8. **Token exchange happens only in the worker.** On demand, the worker POSTs to `https://oauth.brightcove.com/v4/access_token` with `Content-Type: application/x-www-form-urlencoded`, the Basic header from decision 7 and body `grant_type=client_credentials` [VERIFIED: same OAuth overview and https://apis.support.brightcove.com/oauth/guides/getting-access-tokens.html]. A valid response is `{ access_token, token_type: "Bearer", expires_in: <seconds> }` (`expires_in` was 300 in every documented sample) [VERIFIED]. The worker validates the shape (non-empty string token, `token_type` equals `Bearer` case-insensitively, `expires_in` a positive finite number) and treats anything else as an upstream failure. The exchange is a `POST`, which #2's proxy retries on `429` only unless the caller opts in; issuing another token is side-effect free, so this route **opts in to retrying `5xx`/network failures** for the exchange (the explicit "safe to retry" flag from #2 decision 8).
9. **Token cache, single-flight, one refresh.** The worker keeps the issued access token in module memory with its expiry, reusing it for later requests in the same isolate. A token is considered expired `TOKEN_SAFETY_MARGIN` before `expires_in` elapses (default 30 s) [ASSUMPTION: value]. Concurrent requests that need a token share one in-flight exchange. A failed exchange is never cached. If the CMS answers `401` the cached token is discarded, one new exchange is made and the CMS call is retried **once** (Brightcove's own "try, and on `UNAUTHORIZED` fetch a new token" strategy [VERIFIED: https://apis.support.brightcove.com/oauth/guides/getting-access-tokens.html, "Implementation Strategies"]); a second `401` is a credentials/scope problem (decision 13). The token is account-scoped, not user-scoped, so sharing it across callers is safe; it never appears in a response, header, log line or error. In-memory state is an optimisation only (isolates can be evicted); correctness never depends on it. `now` is injectable for tests.
10. **Token scope.** The client credentials are created in Studio (Admin, API Authentication, New) for **one account** with only **CMS - Video Read** (`video-cloud/video/read`) [VERIFIED: https://studio.support.brightcove.com/admin/managing-api-authentication-credentials.html and https://apis.support.brightcove.com/oauth/guides/api-operations-client-credentials-requests.html]. Brightcove recommends the smallest set of accounts and operations [VERIFIED: same Studio page, step 8]. The worker only issues `GET` calls. Playlist, player or analytics permissions are not requested.
11. **Single tenant.** One worker, one Brightcove account (`BRIGHTCOVE_ACCOUNT_ID`), every authenticated EW caller who passes the #2 gates sees that account's playable library. Per-site or per-user accounts are out of scope. Same security-relevant policy as #13 decision 20 (R3 there; Open Question 10 here).

**CMS listing, search, paging (AC1)**

12. **Listing call.** `GET https://cms.api.brightcove.com/v1/accounts/{accountId}/videos` with `Authorization: Bearer <access token>` and query parameters `limit`, `offset`, `sort` and `query` [VERIFIED: https://apis.support.brightcove.com/cms/getting-started/overview-cms-api.html "Parameters" and the OpenAPI operation `GetVideos` at https://apis.support.brightcove.com/cms/references/openapi.yaml]. `limit` is 1 to 100, default 20 [VERIFIED]; the worker always passes it explicitly (default `BRIGHTCOVE_PAGE_SIZE` = 25, because Brightcove advises batches of 25 or fewer to limit timeouts [VERIFIED: CMS overview, "All videos and large data sets"]). The response is a JSON **array** of video objects with no total and no `next` token [VERIFIED: OpenAPI `GetVideos` response schema `array` of `Video`; Search v2 "A search response does not carry a total"].
13. **Always sort; newest first.** The worker always sends `sort=-created_at`. Brightcove documents that without a `sort` the order is by relevance (search) or `updated_at` (list), that relevance order is "not stable enough to page through", and that `created_at` is the order that tolerates videos changing during paging [VERIFIED: Search v2 "Known issues"; CMS overview "Sorting video results"]. So even for searches the order is newest-first, not by relevance (a deliberate trade for correct paging; Open Question 5).
14. **Search is Brightcove's v2 `query` language, translated defensively.** The v2 parameter is `query`; `q` is the older v1 syntax [VERIFIED: Search v2, "Introduction"]. The worker always builds `query` itself as `+playable:true` (hard filter to videos that are `complete`, `ACTIVE`, and inside their schedule window [VERIFIED: Search v2, "Playable videos"]) followed by one `+"word"` term per word of the author's text. Words are produced by splitting the trimmed text on anything that is not a letter or digit (Unicode letters and digits), keeping at most 6 words of at most 50 characters each; every word is double-quoted. Quoting every word makes search operators (`AND`, `OR`, `NOT`), field prefixes (`name:`), wildcards (`*`, which Brightcove rejects with HTTP 400) and colons inert, because per the docs any value with characters other than letters, digits, underscores and periods must be quoted and operators are only recognised unquoted [VERIFIED: Search v2, "Quoting values", "Wildcards are not supported", "When a query cannot be parsed"; `+"word"` as plus-modifier on a quoted term is implied by "Phrase search" and "Search Modifiers" but not shown in an example: [ASSUMPTION], first manual check BV1]. Text that yields no words (for example only punctuation) returns an empty result without calling Brightcove. The user text is never concatenated into the query; an automated fuzz test (BW12) pins the output grammar.
15. **What search matches (and does not).** With no field prefix, Brightcove searches eight fields at once: `id`, `name`, `description`, `long_description`, `tags`, `reference_id`, `custom_fields`, `variants` [VERIFIED: Search v2, "Basics"]. Matching on name, description, long description and custom fields is stemmed whole-word ("running" finds "run"; "vid" does not find "video") [VERIFIED: Search v2, "What is stemming?"]. Ignored words ("the", "a", "of" ...) are dropped from the text fields [VERIFIED: "Ignored words"]. Consequences stated as product behaviour: search is not a substring or prefix search, it can match descriptions and tags (not only titles), and a query made only of ignored words may return everything or nothing [ASSUMPTION about the exact effect; BV1 records it]. This differs from the Mux provider's title-substring search; the contract allows it (#13 decision 7: "how a provider implements search is the provider's business"). Open Question 5 asks whether title-only (`+name:"word"`) is preferred.
16. **Offset cursor.** `nextCursor` is the next `offset` as a decimal string (opaque to the shell). The worker validates an incoming cursor as 1 to 6 ASCII digits without sign, exponent or leading zeros (except `0`); anything else is `400 bad_request`. The first page has no cursor (offset 0). The maximum usable offset is not documented [OPEN: BV5 probes it; library sizes in the hundreds are expected].
17. **Bounded scan and end-of-list rule.** One CMS call normally suffices. Because the worker drops videos after fetching (decision 19), a page can shrink below the minimum; the worker therefore continues with the next offset while (a) it holds fewer than `BRIGHTCOVE_MIN_RESULTS` (default 10) kept items, (b) the last page was full (returned `limit` videos), and (c) fewer than `BRIGHTCOVE_MAX_PAGES` (default 3) CMS calls were made. It returns **all** kept items from every scanned page (never a truncated page, so the cursor never skips an item) and a `nextCursor` equal to the offset after the last scanned page when the last page was full, else `null`. "A page shorter than `limit` means the end" is the rule; Brightcove's own paging guidance warns pages may have fewer than the requested count under concurrent modification and recommends a count request [VERIFIED: CMS overview, "Paging best practice"], so this rule is an [ASSUMPTION] checked in BV5; the documented fallback is to treat only an *empty* page as the end (one extra empty "Load more" at most). The shell already de-duplicates by `id` (#13 decision 23), which absorbs the documented repeated-item case while paging a changing library [VERIFIED: CMS overview, "All videos and large data sets" item 2].
18. **Inputs are validated at the worker boundary** (as #13 decision 16): `q` at most 100 characters after trimming, else `400 bad_request`; `cursor` per decision 16; unknown or repeated parameters ignored or rejected as the template does. Configuration is validated at request time: `BRIGHTCOVE_ACCOUNT_ID` must be digits only (Brightcove account IDs are numeric, for example `57838016001` in the docs [VERIFIED samples]); `BRIGHTCOVE_PLAYER_ID` must match letters/digits only (default `default`) [ASSUMPTION: pattern and the default player's ID are confirmed in BV0 from a real embed code]; otherwise `500 misconfigured` with a generic message.

**Filtering and projection (AC1, AC2)**

19. **Filtering.** Beyond `+playable:true` the worker drops any video that (a) has a non-null `playback_rights_id` (Playback Rights require a token the plain iframe link cannot supply [VERIFIED mechanism: https://apis.support.brightcove.com/playback-restrictions/getting-started/implementing-playback-rights.html, "Playback Rights" - the player calls an auth endpoint when there is no policy key; whether a given account's player works with a plain link is [ASSUMPTION], R5]); (b) fails a defensive recheck of `complete === true` and `state === 'ACTIVE'`; or (c) has an `id` that is not 1 to 20 digits. Geo-restricted videos are **kept** (they play for viewers in allowed countries; Open Question 4).
20. **Projection (fixed; never raw CMS JSON).** Each kept video becomes `{ id, title, durationSeconds, thumbnailUrl, createdAt }`:
    - `title` = `name` when it is a non-empty string, else a fixed fallback built from the last 6 characters of the id (for example `Untitled video (…779877)`); the CMS declares `name` required with `minLength: 1` [VERIFIED: OpenAPI `Video.name`], so the fallback is defensive and fixture-tested only.
    - `durationSeconds` = `duration` (milliseconds [VERIFIED: https://apis.support.brightcove.com/cms/references/cms-api-video-fields-reference.html, "duration ... Number, milliseconds"]) divided by 1000 and rounded; `null` when missing, not finite, or not positive.
    - `thumbnailUrl` = `images.thumbnail.src` when it is an absolute `https` URL, else `null` (the CMS reference lists the thumbnail's `src`; the sample host is `cf-images.us-east-1.prod.boltdns.net` over `https` [VERIFIED: OpenAPI examples, https://apis.support.brightcove.com/cms/references/openapi.yaml]; the earlier-doc host `brightcove.vo.llnwd.net` and `http` URLs exist in older samples, hence the `https`-only rule).
    - `createdAt` = Unix seconds as a number, `null` when unparsable. The docs disagree on the wire format (a milliseconds number in the Video Fields Reference, an ISO-8601 string in the OpenAPI example [VERIFIED both]), so the projection accepts both: ISO string parsed as a date; a number above 1e11 treated as milliseconds.
    - Never projected: description, long description, tags, custom fields, sources/renditions, text tracks, cue points, `playback_rights_id`, `created_by`/`updated_by` (contain e-mails), `sharing`, `geo`, `economics`, `schedule`, `original_filename`, digital-master and manifest IDs, and every other field. Brightcove-supplied strings are untrusted text (R11).
21. **Response contract.** `200 { player: { accountId, playerId }, items: [{ id, title, durationSeconds, thumbnailUrl, createdAt }], nextCursor }`, `Cache-Control: no-store`. `player` comes from the non-secret `vars` (decision 18) so account and player configuration lives in exactly one place (the worker) and the browser holds none. (This departs from #13's "everything configurable is a constant in the extension" only in that these two public, non-secret IDs are server-supplied; Open Question 8.) The browser re-validates every value before use (decision 23).

**Error mapping (AC2)**

22. **Worker errors** use the #2 contract and codes. Brightcove-side outcomes map as follows; **every Brightcove-originated failure is a fixed generic message with no upstream text**, and credential problems carry a distinct operator-only log outcome code (never a secret):
    - OAuth exchange `400`/`401` (`invalid_client`, `invalid_scope`; both statuses observed 2026-11-16: `401 invalid_client` with no credentials, `400 invalid_scope` for a malformed client ID; the docs list `400 invalid_client` [VERIFIED: https://apis.support.brightcove.com/oauth/references/openapi.yaml]) -> `502 upstream_unavailable`, outcome `brightcove_credentials_rejected`. Not `401`: the caller's EW login is fine, so the author must not be told to log in again (#13 decision 17 rule, extended).
    - CMS `401` after the single refresh (decision 9) -> `502 upstream_unavailable`, outcome `brightcove_credentials_rejected`.
    - CMS `404` (wrong or inaccessible account ID) or `403` (`NOT_AVAILABLE`) -> `502`, outcome `brightcove_account_or_scope` [documented status meanings: OpenAPI `GetVideos` responses].
    - CMS `400` (`ILLEGAL_QUERY`) -> `502`, outcome `brightcove_query_rejected` (our translation should make it impossible; it is a bug signal).
    - `429` from either host, after the template's retries -> `429 rate_limited` with `Retry-After` when present (the CMS rate limit is "less than 10 requests per second" and "no more than 20 concurrent calls per account"; `429 TOO_MANY_REQUESTS` [VERIFIED: CMS overview, "Rate limiting"]).
    - `5xx`, timeouts, network errors, malformed JSON, a non-array CMS body, a malformed token response -> `502 upstream_unavailable` (outcomes `brightcove_bad_response` for the malformed cases).
    - Missing `BRIGHTCOVE_BASIC_AUTH` or invalid `BRIGHTCOVE_ACCOUNT_ID`/`BRIGHTCOVE_PLAYER_ID` -> `500 misconfigured`, generic; the log names the variable but never a value.
23. **Browser-side provider.** Calls the route with `Authorization: Bearer <IMS token from the SDK>` to the worker origin constant already defined by #13 (loopback on `localhost`, fixed deployed origin otherwise; a `?worker=` parameter is ignored); sends `q` and `cursor` only when set; maps the response to items (`ref` carries the validated IDs; `thumbnailUrl` is used only if it is `https`); maps worker statuses to provider error codes exactly as the Mux provider does (`401` -> `unauthorized`; `403 forbidden_origin` -> `unavailable`; `429` -> `rate_limited`; `5xx`/network -> `unavailable`; slow -> `timeout`; wrong shape -> `bad_response`). It never calls Brightcove hosts and never holds a credential or access token.

**Embed (AC1)**

24. **Embed URL.** `getEmbed(item)` returns `{ url, title }` with `url = https://players.brightcove.net/{accountId}/{playerId}_default/index.html?videoId={videoId}` [VERIFIED: the iframe form in Brightcove's CMS-integration guide, https://player.support.brightcove.com/general/embedding-brightcove-players-cms.html ("iFrame video player embed": `//players.brightcove.net/%ACCOUNTID%/%PLAYERID%_default/index.html?videoId=%VIDEOID%`) and the iframe options page https://player.support.brightcove.com/publish/available-options-standard-iframe-embed-code.html (`videoId` accepts an ID or reference ID)]. Only `videoId` is added: no autoplay, no `usage` tracking parameter, no other query parameters, so the link text equals the href and contains no `&` that the document pipeline could mangle. IDs are validated against strict patterns (digits for account and video, letters/digits for the player) before the URL is built; anything else throws `bad_response`.
25. **Why the existing renderer works unchanged.** #13's renderer inserts an `embed` block table with one link whose text equals the URL (#13 decision 8). Block Collection's `embed` block renders any link on a non-YouTube/Vimeo/Twitter host through its default branch as a full-width lazy iframe with `allowfullscreen` and `allow="encrypted-media"` [VERIFIED: https://raw.githubusercontent.com/adobe/aem-block-collection/main/blocks/embed/embed.js, `getDefaultEmbed`, `loadEmbed`], which is the markup Brightcove's iframe embed guide shows. So Brightcove needs no renderer change: the new host is only a provider-declared allowlist entry (decision 4).
26. **Prerequisites for "plays on preview" (documented, not shipped):** (a) the target site has an `embed` block (inherits #13 R1; this spec ships no site block); (b) **the Brightcove player used must not have domain restrictions**: Brightcove states that iframe embeds do not work on domain-restricted players ("Publishers cannot use the iframe embed code on an allowed domain (or any other domain) and expect playback to function properly"; the in-page embed is required) [VERIFIED: https://player.support.brightcove.com/content-protection/overview-content-protection.html, "Domain restrictions"]. An in-page `video-js` embed would need a renderer variant and is out of scope (Out of Scope; Open Question 2); (c) the player ID in `BRIGHTCOVE_PLAYER_ID` exists and is published; (d) the video is not geo- or schedule-blocked for the viewer.
27. **Observed (not proof of playback):** `players.brightcove.net/{account}/default_default/index.html?videoId=...` returned `200 text/html` with no `X-Frame-Options` and no `Content-Security-Policy` frame headers on 2026-11-16 (HEAD request for an arbitrary account ID taken from memory, so it shows only that the player page is not header-blocked from framing, nothing about any real account's playback).

**Tooling and conventions**

28. **Folder, README, convention check, lint.** Everything for Brightcove lives under the provider's folder inside the extension, plus the registered entries listed in decision 1. The extension README gains a Brightcove section (#15 AC4) covering: creating the client credentials (Studio path, **only** CMS - Video Read, one account), where to find the account ID and the player ID, setting `BRIGHTCOVE_BASIC_AUTH` safely, the non-secret vars, local development with `wrangler dev` including per-developer account IDs passed with the `--var` flag (so a contributor's account ID never needs to be committed; [VERIFIED flag exists: https://developers.cloudflare.com/workers/wrangler/commands/workers/, cited in #2]), branch-ref testing, the prerequisites of decision 26, the search-behaviour note of decision 15, and an explicit statement that no DA site-config key is read. The #1 convention check and ESLint 8 + helix / Stylelint 16 apply unchanged; tests live inside the extension folder (owner-approved).
29. **No new tooling or services.** No new dependency, runner or build step. Node 22; worker tests use `node:test`; browser tests use `@web/test-runner`; e2e uses Playwright; all as #13/#2.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: which SDK actions fire and what the author sees for a stubbed SDK and a fake worker (browser side); which `Response` is returned and which outbound requests to the Brightcove OAuth and CMS hosts are made for a given `Request` and a fake Brightcove (worker side). Never assert on internal helper names, module layout, CSS classes, how many times an internal function ran or the name of the in-memory cache. The negative properties carry the most weight: **no Brightcove credential or access token appears anywhere**, **no Brightcove call (token exchange included) happens before auth succeeds**, and **no user text can alter the outbound query beyond its own quoted words**.

**Proposed seams** (recorded here instead of asked, per #53). Every seam is reused from #13/#2; this ticket adds **no new seam and no new runtime boundary**, only a fake and fixtures for the new vendor.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| S1 (primary, highest) | Entry page + SDK module boundary, with the **real local worker** behind it | reused (#1, #2, #13) | Playwright e2e | #1's `page.route` SDK stub supplies a token signed by the test IMS key; the worker runs under `wrangler dev` with `IMS_ORIGIN`, `BRIGHTCOVE_OAUTH_ORIGIN` and `BRIGHTCOVE_CMS_ORIGIN` pointing at throwaway local Node servers (fake IMS, **fake Brightcove**); the browser performs a real cross-origin request, preflight included |
| S2 | Provider logic module + SDK result | reused (#1, #13) | WTR unit tests | injected `fetch` serving the contract fixtures; fake timers |
| W1 | The worker's HTTP boundary `worker.fetch(request, env, ctx)` | reused (#2, #13) | Node unit tests | #2 test kit (`makeEnv`, `fakeIms`, canary secret, injected `sleep`/`random`/`now`); `fakeUpstream` configured as a **fake Brightcove** with two origins (OAuth, CMS) |
| W2 | Same worker in the real runtime | reused (#2, #13) | smoke tier | `wrangler dev`, no Cloudflare login |
| C1 | Shared contract fixtures | reused (#13), new Brightcove files | browser and worker tests | static JSON plus the #13 shape checker |
| P1 | Provider conformance suite | reused (#13), run unchanged | S2 | provider gets an injected `fetch` |
| S3 | Repo convention check | reused | CI lint | filesystem fixtures |

Why no new seam: the worker's token lifecycle, search translation and paging matrix are large and fast at W1 (injected clock, scripted upstream) and slow and noisy anywhere higher; S1 proves the pieces fit over a real socket; P1 proves the provider fits the shell. The real EW boundary and a **real Brightcove account** are covered only by manual steps (Testing Requirements §8), because no sandbox credentials can live in CI.

**The one new test double:** a *fake Brightcove* with two roles. The **OAuth role** checks the `Authorization: Basic` value against the canary-derived value, requires the urlencoded `grant_type=client_credentials` body, issues a distinct canary access token per exchange with a scripted `expires_in`, and can script `400`/`401`/`429`/`5xx`/malformed answers. The **CMS role** requires `Authorization: Bearer <the last issued token>` (`401` for an expired or unknown one), supports `limit`, `offset`, `sort=-created_at` and a **small interpreter for exactly the `query` grammar the worker emits** (`+playable:true` plus quoted words matched case-insensitively against name, description, tags, id, reference id, with a deliberately simple stemming rule), returns a bare array, and can script `400 ILLEGAL_QUERY`, `403`, `404`, `429`, `5xx`, short pages and malformed bodies. Honest limitation: the interpreter models Brightcove's search only as far as the worker uses it; real search behaviour (stemming, ignored words, `+"word"` parsing) is pinned by the manual step BV1, not by the fake.

**Modules tested:** the Brightcove browser provider (list mapping, embed URL, ID validation, error mapping, worker-origin constant); the contract fixtures; the conformance suite run against it (and still failing for broken providers); the Brightcove worker route (auth ordering, token exchange, cache, refresh, single-flight, query translation, validation, filtering, projection, paging/scan budget, error mapping, secret hygiene, host safety, configuration); the registry with two real providers; convention-check and config rules.

**Prior art:**
- #13 spec: all seams, test IDs MW1-MW18, SMV, EV, PC, MP, CT patterns that this spec mirrors with `B`-prefixed IDs; this spec does not repeat tests that exercise only template or shell behaviour.
- #2 spec: UA/UC/UP/US template tests (auth, CORS, retry, redaction), test kit.
- #1 spec: SDK stub, WTR, Playwright `page.route`, S3.
- Upstream `adobe-rnd/ew-extensions`: no Brightcove, video-picker or worker code (GitHub tree listing checked 2026-11-16: the only match for `video|brightcove|picker|worker` is a unit-test fixture `test/unit/block-editor/fixtures/blocks/shared/picker/picker.js`; `gh search code brightcove` returned nothing). Dependency-injection seams in `tools/brand-visibility/session-auth.js` remain the style reference.

## Out of Scope

- Wistia (#14) and any other vendor; any shell, renderer, registry mechanism, conformance-suite or contract change (needed changes are raised on #13).
- In-page (`video-js` + script) Brightcove embeds, which are required for domain-restricted players; autoplay, muted, start-time (`t`), `usage` or `applicationId` embed parameters; playlist embeds.
- Choosing a player per insert, listing players (Player Management API needs a different permission, `video-cloud/player/read` [VERIFIED operations table]); one configured player ID only.
- Playback Rights / JWT-protected playback, DRM and HLS-encryption-specific handling, signed or policy-key flows; geo-restriction awareness in the UI (geo-restricted videos are listed and play where allowed).
- Uploading, editing, deleting or tagging videos; folders, labels, playlists, sharing relationships; custom-field or tag filters; sort options; multi-select; Studio-style advanced search syntax for authors.
- Title-only or substring search, an index or cache of the library, server-side caching (Cache API/KV), and any count (`/counts/videos`) request.
- Multiple Brightcove accounts, per-site or per-user credentials, org-level authorisation of who may browse the library (template notes in #2/#13).
- Poster images, hotlinked-image hosting rules beyond `https`, thumbnail resolution selection, inline preview inside the picker.
- Sandbox provisioning of a Brightcove account (needs the owner; Open Question 1).
- A DA site-config sheet (enabled providers, default player), cross-browser e2e, real-session e2e in CI, Cloudflare deployment from CI (#2/#13 decisions).
- Adobe outside-activity/IP policy and the personal-Cloudflare-account question for a third-party credential (owned by #1 R1, #2 R1, #13 R15).

## Further Notes

- **Trial accounts cannot create credentials.** Brightcove's trial documentation lists "No access to API management" and a five-video upload cap [VERIFIED: https://studio.support.brightcove.com/get-started/getting-started-your-video-cloud-trial.html]. So the free route to a sandbox that #13 had for Mux does not exist here; verification needs an account where the owner (or a partner contact: the same page points partner integrations to Brightcove's technical-partner inquiry) can create API credentials. Until then all automated tests run against the fake, and every claim about real Brightcove behaviour not marked VERIFIED stays [ASSUMPTION] or [OPEN] (R1).
- **Brightcove's docs say the access token "can be exposed to the browser"** (limited permissions and lifetime) [VERIFIED: Python sample comment at https://apis.support.brightcove.com/oauth/guides/getting-access-tokens.html]. This spec deliberately does not: the ticket requires the exchange in the worker, and a 300-second read-everything token in the browser network log would still let anyone who opens DevTools list the whole library without the EW gates.
- **CMS API suitability.** Brightcove says the CMS API "is not appropriate for high scale runtime usage" (public pages) [VERIFIED: CMS overview, "Rate limiting"]. An author-time picker behind authentication is the intended kind of use; the embedded player itself uses Brightcove's cached delivery, not the CMS.
- **Open policy items carry over** from #1/#2/#13 (Adobe outside-activity/IP; personal Cloudflare account handling a third-party credential). The README must say that Brightcove adds a vendor credential.
- **Docs inconsistencies found (recorded so nobody re-discovers them):** `created_at` is a milliseconds number in one reference and an ISO string in another; the CMS Get Video Count operation lists only the `q` parameter while the v2 search page uses `query` on counts; the Brightcove Player docs show `default_default` in some samples and per-player IDs in others [VERIFIED reads; not resolved without a real account].
- **Current repo state:** `apps/video-picker/` contains only #13's SPEC.md plus this folder; #1, #2, #13 are specified, not implemented, so everything marked "reuse" presumes they have landed.

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)
 └─ editor library panel
     └─ iframe: Video Picker page   (origin: https://{ref}--{site}--{org}.aem.live | .preview.da.live | http://localhost:3000)   [#13, unchanged]
          │  shell ──list({query,cursor})──► Brightcove provider (browser)
          │                                      │ Authorization: Bearer <IMS token>   (cross-origin; preflight first)
          │                                      ▼
          │              Cloudflare Worker  (apps/video-picker/worker + providers/*/worker; core from shared/worker-template)
          │                 1 origin gate  2 IMS token check  3 GET /brightcove/videos
          │                 4a (if no valid cached token) POST https://oauth.brightcove.com/v4/access_token
          │                      Basic <BRIGHTCOVE_BASIC_AUTH secret>, grant_type=client_credentials  ──► { access_token, expires_in: 300 }
          │                 4b GET https://cms.api.brightcove.com/v1/accounts/{id}/videos
          │                      Bearer <access token>, limit, offset, sort=-created_at, query=+playable:true +"word"...
          │                 5 filter + project  ──► { player:{accountId,playerId}, items:[...], nextCursor }
          │
          │  click on a video:  getEmbed(item) → descriptor → #13 renderer → block-table HTML (link text = URL)
          │       actions.sendHTML(html);  actions.closeLibrary()
          ▼
 page preview: site's `embed` block renders
     <iframe src="https://players.brightcove.net/{account}/{player}_default/index.html?videoId={id}">  → Brightcove Player
 thumbnails: <img src="https://…boltdns.net/…/image.jpg">  (browser → Brightcove image CDN, no credential)
```

| Concern | Browser extension (public static files) | Worker (private runtime, holds the secret) |
|---|---|---|
| Brightcove client credentials | never | only place; `BRIGHTCOVE_BASIC_AUTH` secret |
| Brightcove access token | never | obtains, caches in memory, refreshes; never returned or logged |
| Identity | gets IMS token from the SDK, sends as Bearer | verifies it (template) before any Brightcove call |
| Brightcove API calls | none | OAuth exchange + CMS list through `proxy`, host-locked |
| Search / paging | debounce, stale handling, "Load more", de-dup (shell) | translates text to a safe `query`, offsets, bounded scan, projection |
| Which videos are shown | shows what the worker returned | drops non-playable, protected, malformed items |
| Account / player IDs | receives them from the worker, validates, builds the embed URL | holds them as non-secret `vars` |
| Embed markup | descriptor → block table via #13 renderer; `sendHTML`; close | none |
| Retries / 429 | retry UI | template retries; token-exchange `POST` retries opted in |

## 2. EW integration points

- **Library plugin, not an app; no new registration.** The extension is the one `library` row from #13 (`title` = `Video Picker`, `path` = `/apps/video-picker/video-picker.html`; columns `title`, `path`, `format`, `ref`, `icon`, `experience` [VERIFIED: https://www.aem.live/docs/ew/administering/set-up-library; resolution per #1 spec 2.5]). Brightcove adds no row, no config-sheet key and no DA site-config read.
- **Repo README table:** no new row (same extension). The existing row's description may be reworded to list providers only if #13's wording enumerates them; coordinate with #14 (R12).
- **SDK surface:** unchanged from #13: `token`, `actions.sendHTML`, `actions.closeLibrary` [VERIFIED surface: https://da.live/nx/utils/sdk.js].
- **`ref=local`:** page at `http://localhost:3000` calls the local worker at `http://localhost:8787` (#13/#2). The local worker reads `BRIGHTCOVE_BASIC_AUTH` from untracked `.dev.vars`; non-secret `vars` come from the wrangler local environment, because declaring `secrets.required` makes wrangler read only the listed keys from `.dev.vars` (#2 decision 7 [VERIFIED: https://developers.cloudflare.com/workers/wrangler/configuration/]). A contributor with a different Brightcove account overrides `BRIGHTCOVE_ACCOUNT_ID`/`BRIGHTCOVE_PLAYER_ID` with `wrangler dev --var` instead of editing tracked config.
- **Branch ref:** the branch page calls the *deployed* worker, which holds the production Brightcove secret (or a sandbox one if the owner deploys a second environment; #13 Open Question 3).
- **Page `Origin` unknowns** are #2 R2; this provider inherits whatever #13/#2 manual steps record.
- **Site prerequisites:** an `embed` block (#13 R1) and a Brightcove player without domain restrictions (R2 here).

## 3. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| Brightcove OAuth `POST https://oauth.brightcove.com/v4/access_token` | exchange client credentials for a Bearer token (`expires_in` 300 in docs) | HTTP Basic `base64(client_id:client_secret)`; `Content-Type: application/x-www-form-urlencoded`; body or query `grant_type=client_credentials` | https://apis.support.brightcove.com/oauth/getting-started/overview-oauth-api-v4.html ; https://apis.support.brightcove.com/oauth/guides/getting-access-tokens.html ; OpenAPI https://apis.support.brightcove.com/oauth/references/openapi.yaml |
| Brightcove CMS `GET https://cms.api.brightcove.com/v1/accounts/{account_id}/videos` | list/search videos; params `limit` 1-100 (default 20), `offset`, `sort`, `q` (v1 search), `query` (v2 search) | `Authorization: Bearer <access token>` with `video-cloud/video/read` | https://apis.support.brightcove.com/cms/getting-started/overview-cms-api.html ; https://apis.support.brightcove.com/cms/references/openapi.yaml (`GetVideos`) |
| CMS search v2 | `query` grammar: fields, `+`/`-` modifiers, quoting, ignored words, stemming, `playable:true`, known paging issue | n/a | https://apis.support.brightcove.com/cms/searching/cms-and-playback-apis-video-search-v2.html |
| CMS video fields | `id`, `name`, `duration` (ms), `images.thumbnail.src`, `state`, `complete`, `playback_rights_id`, `geo`, `created_at` | n/a | https://apis.support.brightcove.com/cms/references/cms-api-video-fields-reference.html ; https://apis.support.brightcove.com/cms/references/openapi.yaml (`Video`) |
| CMS rate limits | less than 10 requests/second and at most 20 concurrent calls per account; `429 TOO_MANY_REQUESTS` | n/a | https://apis.support.brightcove.com/cms/getting-started/overview-cms-api.html ("Rate limiting") |
| Client credentials in Studio | Admin, API Authentication, New; choose accounts and operations; `CMS -> Video Read` = `video-cloud/video/read`; at most 30 accounts per credential | n/a | https://studio.support.brightcove.com/admin/managing-api-authentication-credentials.html ; https://apis.support.brightcove.com/oauth/guides/api-operations-client-credentials-requests.html |
| Brightcove Player iframe embed | `https://players.brightcove.net/{account}/{player}_default/index.html?videoId={id}`; query parameters table | none for unrestricted players | https://player.support.brightcove.com/general/embedding-brightcove-players-cms.html ; https://player.support.brightcove.com/publish/available-options-standard-iframe-embed-code.html |
| Player domain restrictions | iframe embed does not work on domain-restricted players | n/a | https://player.support.brightcove.com/content-protection/overview-content-protection.html |
| Playback Rights | `playback_rights_id` videos need an auth flow without policy key | JWT (not used) | https://apis.support.brightcove.com/playback-restrictions/getting-started/implementing-playback-rights.html |
| Player Management API (not used) | would list players; limits 600 reads/min | `video-cloud/player/read` | https://apis.support.brightcove.com/player-management/getting-started/overview-player-management-api.html |
| Block Collection `embed` block | default branch renders any link as an iframe | n/a | https://raw.githubusercontent.com/adobe/aem-block-collection/main/blocks/embed/embed.js |
| Video Cloud trial limits | no API management in trial; max 5 uploads | n/a | https://studio.support.brightcove.com/get-started/getting-started-your-video-cloud-trial.html |
| #13 provider contract / #2 template | provider interface, IMS check, CORS, secrets, proxy, error contract | IMS Bearer | `apps/video-picker/SPEC.md`, `shared/worker-template/SPEC.md` |

**Auth flows.** Browser to worker: SDK IMS token as `Authorization: Bearer`, verified offline by the template (#2). Worker to Brightcove: (1) once per token lifetime, Basic with the `BRIGHTCOVE_BASIC_AUTH` secret to the OAuth host; (2) per request, `Bearer <issued token>` to the CMS host. The caller's IMS token is never forwarded; the Brightcove token never leaves the worker. Browser to Brightcove image/player hosts: no credential.

**Observed 2026-11-16 (commands, no credentials used):** OAuth `POST` without credentials -> `401 {"error":"invalid_client"}`; OAuth `POST` with a syntactically valid Basic header whose client ID is not a UUID -> `400 {"error":"invalid_scope","error_description":"Invalid UUID string: x"}`; OAuth preflight from `Origin: https://da.live` -> `403 Invalid CORS request`; CMS `GET .../videos` without a token -> `401 [{"error_code":"UNAUTHORIZED","message":"Permission denied."}]` with `Access-Control-Allow-Origin: *`; player URL framing headers as in decision 27; the OpenAPI documents download at the URLs above (CMS spec 295 KB). Everything about a real account's responses is **not** observed (no credentials).

## 4. Data contracts

All are behaviour contracts, not code.

**Provider (browser) contract:** #13 decision 6, unchanged. **Item:** `{ id, title, durationSeconds, thumbnailUrl, ref }`. **Embed descriptor:** `{ url, title }`, url as decision 24. **Declared embed host:** `players.brightcove.net` [ASSUMPTION; decision 4].

**Worker route `GET /brightcove/videos`**

| Aspect | Contract |
|---|---|
| Auth | `Authorization: Bearer <IMS token>`; per #2: missing/invalid `401`, disallowed origin `403`, preflight `204`; no Brightcove call before auth |
| Query | `q` optional, trimmed, max 100 chars; `cursor` optional, 1-6 digits, no leading zeros except `0` |
| `200` body | `{ player: { accountId, playerId }, items: [{ id, title, durationSeconds, thumbnailUrl, createdAt }], nextCursor }`; `id` string of 1-20 digits; `durationSeconds` number or `null`; `thumbnailUrl` `https` string or `null`; `createdAt` Unix seconds number or `null`; `nextCursor` digit string or `null`; `Cache-Control: no-store` |
| Errors | #2 JSON `{ error: { code, message, requestId } }`; mapping per decision 22; never upstream text |
| Never present | any CMS field outside the projection; any Brightcove credential, secret half or access token |

**Outbound OAuth request (worker to Brightcove):** `POST {BRIGHTCOVE_OAUTH_ORIGIN}/v4/access_token`, headers `Authorization: Basic <secret>`, `Content-Type: application/x-www-form-urlencoded`, body `grant_type=client_credentials`; no other headers from the caller. **Outbound CMS request:** `GET {BRIGHTCOVE_CMS_ORIGIN}/v1/accounts/{BRIGHTCOVE_ACCOUNT_ID}/videos?limit=&offset=&sort=-created_at&query=`; exactly those four parameters.

**Query grammar the worker may emit (pinned by BW12):** `+playable:true` followed by zero to six space-separated terms of the form `+"<1-50 letters/digits>"`. Nothing else.

**Worker configuration (wrangler `vars`, non-secret)**, in addition to #2's and #13's:

| Name | Meaning | Production | Local/test |
|---|---|---|---|
| `BRIGHTCOVE_ACCOUNT_ID` | numeric Video Cloud account ID | the owner's account [OPEN, Open Question 1/8] | per-developer via `--var`; fake value in tests |
| `BRIGHTCOVE_PLAYER_ID` | player ID used in the embed URL | `default` unless the owner names another [ASSUMPTION; confirm BV0] | same / test value |
| `BRIGHTCOVE_OAUTH_ORIGIN` | only allowed OAuth host | unset or exactly `https://oauth.brightcove.com` | local fake |
| `BRIGHTCOVE_CMS_ORIGIN` | only allowed CMS host | unset or exactly `https://cms.api.brightcove.com` | local fake |
| `BRIGHTCOVE_PAGE_SIZE` | CMS `limit` per call | `25` | small in tests |
| `BRIGHTCOVE_MIN_RESULTS` | keep scanning while fewer kept items | `10` | small in tests |
| `BRIGHTCOVE_MAX_PAGES` | max CMS calls per request | `3` | small in tests |
| `BRIGHTCOVE_TOKEN_SAFETY_MARGIN_S` | seconds before expiry to refresh | `30` | small in tests |

**Secrets (`secrets.required`):** `BRIGHTCOVE_BASIC_AUTH` (base64 of `clientId:clientSecret`), listed in `.dev.vars.example` (#2 UR5). No secret-like name appears in `vars`.

## 5. Folder layout (proposed; fits #1/#2/#13)

New files are under `apps/video-picker/providers/brightcove/` unless marked **edit** (one small change to an existing #13/#2 file).

```
apps/video-picker/
├─ SPEC.md                                   #13 spec (unchanged)
├─ README.md                    **edit**     + "Brightcove" section (credentials, IDs, secret, vars, local dev, branch ref, prerequisites, search note, "reads no site config")
├─ providers/
│   ├─ index.js                 **edit**     + one registration line (the only provider-registry change)
│   └─ brightcove/
│       ├─ SPEC.md                           this file
│       ├─ brightcove.js                     browser provider (list via worker, embed URL, ID validation, error mapping)
│       └─ worker/
│           ├─ videos.js                     route: GET /brightcove/videos (validation, query translation, scan, filter, projection, error mapping)
│           ├─ oauth.js                      token exchange + in-memory cache (single-flight, margin, one refresh)
│           └─ test/                         W1 tests, fake-Brightcove support, fixtures                     } naming is the
├─ worker/
│   ├─ index.js (route list)    **edit**     + one registration of the Brightcove route                        } implementer's call
│   ├─ wrangler.jsonc (or .toml) **edit**    + BRIGHTCOVE_* vars; BRIGHTCOVE_BASIC_AUTH in secrets.required; local env vars
│   └─ .dev.vars.example        **edit**     + BRIGHTCOVE_BASIC_AUTH=
└─ test/
    ├─ unit/brightcove.*.test.js             WTR: provider, conformance run, registry-with-two-providers
    ├─ fixtures/brightcove-*.json            contract fixtures (normal, empty, last page, untitled, long title, protected-dropped)
    └─ e2e/brightcove.*.spec.js              Playwright + fake Brightcove/IMS servers
```

Paths are proposals; the #13 implementation decides the real names. Worker tests live next to the worker code (#2). The #1 `.hlxignore` already hides `**/test/` and `**/worker/` from the code bus.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **No sandbox credentials available.** Brightcove trial accounts have "No access to API management" [VERIFIED], so client credentials cannot be created on a free trial. All real-API facts (search grammar edge cases, paging end rule, `created_at` format, thumbnail host/size, token TTL, offset ceiling) stay unverified until the owner supplies a suitable account. | High (blocks AC1/AC2 real-world proof, not the build) | Automated work proceeds against the fake; manual BV0-BV9 are gated on an account; every unverified behaviour is tagged [ASSUMPTION] and listed in BV1's checklist. [OPEN] Open Question 1. |
| R2 | **Domain-restricted players break iframe embeds** [VERIFIED statement, Brightcove docs]. If the owner's player is domain-restricted, AC1's "plays on preview" fails with the #13 renderer. | High (AC1) | Document as prerequisite; BV4 tests an unrestricted player and records the restricted-player failure; an in-page embed would be a renderer/contract change owned by #13 (Open Question 2). |
| R3 | **Search semantics differ from Mux:** whole-word, stemmed, multi-field, no substring; `+"word"` and ignored-word handling unverified; newest-first order overrides relevance. | Medium | README note; fuzz-pinned translation (BW12); BV1 records real behaviour; Open Question 5 (title-only alternative). |
| R4 | **Paging correctness:** offset paging over a changing library can repeat or skip; short pages may occur before the end [VERIFIED caveats]; no total. | Medium | Always `sort=-created_at`; shell de-dup; end rule is an [ASSUMPTION] with a documented fallback; BV5 checks against a real library; property test BW13 for no lost/duplicated items in the fake. |
| R5 | **Playback Rights / geo / DRM videos** may be unplayable via a plain iframe link; whether a given player works with them is unverified. | Medium | Hide `playback_rights_id` videos in v1 (conservative), keep geo-restricted; Open Question 4; BV9-like check if the account has Playback Rights (feature needs the CSM to enable it [VERIFIED]). |
| R6 | **Two-hop token handling:** a bug can leak the secret or the access token, loop on `401`, stampede the OAuth endpoint, or serve an expired token. | High if wrong | Single-flight + margin + one refresh bound; injected clock; canary covers secret halves and issued tokens (BW3); call-count assertions (BW4, BW5); no cache of failures. |
| R7 | **Template gaps (the template is specified, not built).** (a) Does `proxy` allow route code to set an outbound `Authorization: Bearer <derived token>` while stripping only the *caller's* header? (b) Will redaction know a derived token (not in `env`)? (c) Is the POST-retry opt-in available per call? | Medium | Build step 0 re-reads the real template API (as #13 R13). Even if (b) is unsupported, the access token is never copied into any response or log by this route, and BW3 proves it; if (a) fails, raise a template change request, do not patch locally. [ASSUMPTION] on all three. |
| R8 | **CMS rate limits** (under 10 requests/second, 20 concurrent per account [VERIFIED]) with several authors searching; each debounced search costs at least one CMS call (up to 3 in the scan). | Medium | Page size 25, scan budget 3, debounce + abort (shell), template retry/backoff, `429` maps to a friendly retry; caching is out of scope. |
| R9 | **Single secret holds `base64(id:secret)`.** Awkward and relies on template redaction of its decoded halves. | Medium | BW3 canary tests both halves; README command; Open Question 6. |
| R10 | **Shared-file merge conflicts with #14 (Wistia)**: registry line, worker entry, wrangler config, `.dev.vars.example`, README. | Low-Med | Each vendor adds its own lines (names are vendor-prefixed); land sequentially; rebase; Open Question 12. |
| R11 | **Untrusted text.** Video names/IDs/URLs come from Brightcove metadata that any Studio user can edit. | Medium | Titles only via `textContent`; thumbnails `https`-only; IDs validated by strict patterns; fixture with `<img onerror>` titles; renderer only gets validated URLs. |
| R12 | **Embed-host allowlist gap in #13's contract** (decision 4 here). | Medium | Step 0 reconciles with the implemented #13; if missing, #13 owner amends the contract; no shell patch from #15. |
| R13 | **Brightcove IDs/patterns assumed:** account IDs digits; video IDs digits; player IDs letters/digits; default player ID `default`. | Low-Med | Validation is strict and fails closed; BV0 reads a real embed code to confirm. |
| R14 | **Thumbnail size and host:** the CMS default thumbnail may be small (sample variants 160x90 [VERIFIED sample]); host variety (`boltdns.net`, legacy hosts). | Low | `https`-only plain `<img>`; placeholder on failure; choosing a larger variant is out of scope (Open Question 11). |
| R15 | **Docs inconsistencies** (`created_at` format; counts parameter; default player ID). | Low | Tolerant projection (both formats); no count calls; BV0/BV1 record reality. |
| R16 | **Library visibility:** every authenticated EW user passing #2's gates can list the account's playable videos (policy inherited from #13 R3). | High | #2 client-id allowlist and optional `authorize` hook; use an account whose playable library is intended to be public; Open Question 10. |
| R17 | **Inherited policy risks** (Adobe IP, personal Cloudflare account, Code Sync, DA org/site naming). | High for publishing | Owned by #1/#2/#13; README states that a third-party credential is handled. |

## 7. Ordered build plan (sized to #15's acceptance criteria)

0. **Prerequisites and reconciliation.** #1, #2 and #13 merged (toolchain, template + test kit, picker shell + Mux provider + conformance suite + registry). Re-read the *real* #13 interface and #2 template API and compare with this spec's assumptions: embed-host declaration (R12), `ref` handling, error codes, provider-registration line, route registration, `proxy` auth options, POST-retry opt-in, redaction API, per-call outbound headers (R7). Mismatches go to the #13/#2 owners; nothing is patched locally. Confirm with the owner: a Brightcove account with API management, the account and player IDs, the Open Questions that block design (2, 4, 5, 9).
1. **Contract first (AC1, AC3).** Brightcove contract fixtures (normal page, empty, last page, untitled, long title, protected-videos-dropped) and the fake Brightcove (OAuth and CMS roles). Add failing provider-conformance and fixture-shape tests. Nothing in the shell changes.
2. **Browser provider, test-first (AC1, AC3, AC6).** List via worker with IMS Bearer, item mapping, strict ID validation, embed URL builder, error-code mapping, worker-origin constant reuse. Register it (one line). Run the unchanged conformance suite and the shell's provider-agnostic/two-provider tests.
3. **Worker: validation and query translation, test-first (AC1, AC2).** `q`/`cursor` validation, the translator and its fuzz test, configuration validation, projection and filtering. No network yet (pure functions behind the route).
4. **Worker: token exchange and cache, test-first (AC2, AC6).** Exchange via `proxy` (Basic, urlencoded body, POST retry opt-in), response validation, single-flight cache with injected clock, one refresh on `401`, distinct outcomes. Canary tests including the issued token.
5. **Worker: CMS listing, scan budget, error mapping (AC1, AC2, AC6).** Offset cursor, `sort`, bounded scan, end rule, status mapping, host pinning; full BW suite against the fake; template integration (origin gate, auth-first, routes) through this worker's real config.
6. **Runtime smoke (W2).** `wrangler dev` with fake IMS and fake Brightcove (two origins): bundles, auth-first `401`, contract-conforming `200`, canary absence over HTTP, token reuse across two requests in one runtime, measured subrequests and CPU for the worst-case scan (informational).
7. **E2E (S1).** Playwright against the local page + real local worker + fake Brightcove/IMS: browse, search, load more, insert-and-close recorded as SDK calls, protected videos hidden, error states, no credential/token anywhere, provider switch with Mux.
8. **Repo integration (AC3, AC4, AC7).** README Brightcove section (all required topics), `.dev.vars.example`, wrangler vars and secret name, repo rule that production Brightcove origins are the real hosts, review-checklist for "no shell change", lint/Stylelint, convention check, CI green (`lint`, `unit`, `worker-unit`, `worker-smoke`, `e2e`).
9. **Deploy and manual verification in EW (AC1, AC2, AC5, AC6).** Create the read-only credentials, set `BRIGHTCOVE_BASIC_AUTH`, deploy the worker, set vars, run BV0-BV9 (real `created_at` format, search behaviour, paging end rule, thumbnail host, player embed plays, domain-restriction behaviour); record observations in the PR and README and convert resolved [ASSUMPTION]s.
10. **Hand-off notes.** Add to the README provider-authoring section what #15 learned from adding a second real provider (contract gaps hit, e.g. the embed-host declaration), for #14 and later vendors.

---

# Testing Requirements

## 1. Test IDs and layers

IDs are local to this spec and `B`-prefixed to avoid collision with #13's. **BP** Brightcove browser provider; **BC** contract fixtures; **BW** Brightcove worker (W1); **BS** smoke (W2); **BE** e2e (S1); **BR** repo checks; **BV** manual verification in EW/Brightcove. Tests that exercise only template or shell behaviour (UA*/UC*/UP*/US*, SH*, EM*, PC*, #13's MW* for Mux) are **not repeated**; they must keep passing unchanged, which is itself an assertion of AC3 (BR1, BP9).

## 2. Unit tests: browser side (seam S2, `@web/test-runner`)

Fixtures/mocks: #1's SDK stub (records `sendHTML`, `closeLibrary`; token `stub-token`); an injected `fetch` serving the Brightcove contract fixtures; fake timers; a fake second provider.

| ID | Behaviour asserted | Proves |
|---|---|---|
| BP1 | The #13 conformance suite run against the Brightcove provider passes unchanged: `list` resolves `{ items, nextCursor }`, documented fields/types, unique ids, `https`-or-null thumbnails, `nextCursor` string or null; `getEmbed` pure and synchronous; `list` honours an abort signal; the suite still fails for the deliberately broken providers (re-run once to prove the suite was not weakened) | AC3, AC7 |
| BP2 | `list` sends `Authorization: Bearer <sdk token>` to the worker origin's `/brightcove/videos` with `q` and `cursor` only when set; no other credential-bearing headers; no request goes to any `brightcove.com` or `boltdns.net` host | AC2, AC6 |
| BP3 | A worker `200` fixture maps to items: `id`, `title`, `durationSeconds` carried through; `thumbnailUrl` used only when `https` (a fixture with an `http` or `javascript:` thumbnail yields no thumbnail); `ref` encodes the validated account, player and video IDs; `nextCursor` carried through | AC1 |
| BP4 | `getEmbed` returns exactly `https://players.brightcove.net/{account}/{player}_default/index.html?videoId={id}` for valid IDs; the URL has only the `videoId` query parameter; IDs that are non-numeric (account/video), contain `../`, spaces, `?`, `&`, `"`, `#` or are empty/over-long, or a player ID outside letters/digits throw `bad_response` and produce no URL; a tampered `ref` throws | AC1, AC7 (injection) |
| BP5 | Status/code mapping identical to Mux's: worker `401` to `unauthorized`; `403 forbidden_origin` to `unavailable`; `429` to `rate_limited`; `502`/`5xx`/network failure to `unavailable`; unresolved in time to `timeout`; non-JSON or wrong-shape body (including an extra raw-CMS field such as `playback_rights_id` or a missing `player`) to `bad_response`; a worker `502` never surfaces as `unauthorized` | AC1 (robustness), AC2 |
| BP6 | A page URL with `?worker=https://evil.example` is ignored; `localhost` selects the loopback worker, any other host the fixed deployed origin (the #13 MP5 behaviour holds for this provider) | AC5, AC6 |
| BP7 | A response with markup in a title (`<img src=x onerror=...>`, `"`, `&`) is shown as text by the shell (end to end through SH3) and never reaches `getEmbed`'s output | AC1 |
| BP8 | No credential-like value (the test's canary secret, client ID, or access-token canary) appears in any request header, URL or body the provider makes | AC2, AC6 |
| BP9 | Registry with Mux and Brightcove registered: the provider switch appears; switching resets query, cursor and grid; the #13 shell suite (SH*, PC5, PC6) passes unchanged with the Brightcove provider registered (and with only the in-test fake provider); registering Brightcove required exactly one registry line (asserted by the registry test, not by diff) | AC3 |
| BP10 | The #13 embed renderer accepts a Brightcove descriptor (host on the provider's declared list) and renders the block table with one link whose `href` and text equal the URL including `?videoId=`; descriptors with another host, `http`, credentials, an extra `&` parameter smuggled in `ref`, or a malformed URL are rejected | AC1, AC3 |

## 3. Contract fixtures (seam C1)

| ID | Behaviour asserted | Proves |
|---|---|---|
| BC1 | Each Brightcove fixture (normal page, empty, last page with `nextCursor: null`, untitled/fallback title, long title, page after protected videos were dropped) validates against the contract shape checker (types, required fields, no extra fields, ID patterns, `https` thumbnails, digit-string cursor) | AC1, AC3 |
| BC2 | The worker tests (BW2, BW8, BW13) feed the fake Brightcove and assert the worker's response conforms to the same fixtures, so a worker change that alters the shape fails the worker suite and BP3 | AC1, AC2 |
| BC3 | The shape checker rejects a fixture containing any non-projected CMS field (`description`, `tags`, `custom_fields`, `images`, `playback_rights_id`, `created_by`, `sources`, `geo`, `schedule`, `digital_master_id`...) and any extra top-level key besides `player`, `items`, `nextCursor`: the machine form of "raw CMS JSON never reaches the browser" | AC2 |

## 4. Worker tests (seam W1, `node:test`, in the provider's `worker/test/` and `worker/test/`)

Fixtures/mocks from the #2 test kit: `makeEnv` (production-like; canary `BRIGHTCOVE_BASIC_AUTH` built from known canary client-id and secret halves; vars set to test values), `fakeIms`, injected `sleep`/`random`/`now`, plus the **fake Brightcove** described in Testing Decisions (OAuth role and CMS role on two origins, recording every request with method, path, headers, body; scriptable per call; canary access tokens that are distinct per issuance).

| ID | Behaviour asserted | Proves |
|---|---|---|
| BW1 | No token: `401`; the fake OAuth and fake CMS received **zero** requests (no token exchange either) | AC2, AC6 |
| BW2 | Valid token, allowed origin, no `q`, cold cache: exactly one OAuth `POST` (Basic equals the canary-derived value, `Content-Type` urlencoded, body exactly `grant_type=client_credentials`, host equals `BRIGHTCOVE_OAUTH_ORIGIN`, no caller `Authorization`), then one CMS `GET` to `/v1/accounts/{BRIGHTCOVE_ACCOUNT_ID}/videos` with `Bearer <issued canary token>` and exactly the parameters `limit=<PAGE_SIZE>`, `offset=0`, `sort=-created_at`, `query=+playable:true`; response `200` conforming to the fixture | AC1, AC2, AC6 |
| BW3 | **Canary property test.** Across success, empty, and every error path below (OAuth `400`/`401`/`429`/`5xx`/malformed, CMS `400`/`401`/`403`/`404`/`429`/`5xx`/malformed, network errors, missing secret) and with a fake that **echoes the `Authorization` header in its error bodies**, none of the following appears in any response body, response header or captured log line: the combined canary secret, its decoded client-id half, its decoded client-secret half, or any issued canary access token | AC2, AC6 |
| BW4 | Token lifecycle: two requests within the token lifetime produce **one** OAuth call; a request after `expires_in` minus the safety margin (injected clock) triggers a new exchange; ten concurrent cold requests (`Promise.all`) produce **one** exchange (single-flight); a failed exchange is not cached (the next request exchanges again); the safety margin is honoured at its boundary | AC2 |
| BW5 | CMS `401` with a cached token: the token is discarded, exactly one new exchange happens, the CMS call is retried once and succeeds; CMS `401` twice: `502 upstream_unavailable` with outcome `brightcove_credentials_rejected` in the log, no more than two OAuth calls and two CMS calls in total, body contains no Brightcove text | AC2 |
| BW6 | OAuth failures: `400 invalid_client`, `400 invalid_scope`, `401 invalid_client` -> `502 upstream_unavailable` (not `401`) with outcome `brightcove_credentials_rejected` and no upstream text; `429` always -> `429 rate_limited` with `Retry-After` when supplied; `5xx` then `200` -> retried (proves the POST safe-to-retry opt-in is set for the exchange) and succeeds; always `5xx` or network error -> `502`; malformed JSON, missing/empty `access_token`, `token_type` not `Bearer`, `expires_in` missing/zero/negative/non-number -> `502` with outcome `brightcove_bad_response` and no CMS call | AC2 |
| BW7 | Host and redirect safety: the credential is sent only to `BRIGHTCOVE_OAUTH_ORIGIN`'s host and the access token only to `BRIGHTCOVE_CMS_ORIGIN`'s host; if the fake OAuth or CMS answers `302` to another host, the redirect is not followed and nothing is sent there; a route that tries to call a host outside its declared allowlist throws before any fetch | AC2, AC6 |
| BW8 | Projection: every returned item has exactly `{ id, title, durationSeconds, thumbnailUrl, createdAt }`; description, long description, tags, custom fields, sources, text tracks, cue points, `playback_rights_id`, `created_by`/`updated_by` e-mails, `sharing`, `geo`, `economics`, `schedule`, `original_filename`, manifest and master IDs never appear anywhere in the response body (the fake CMS videos carry canary values in all of them) | AC2 |
| BW9 | Filtering: a video with a non-null `playback_rights_id` is dropped; `complete: false` or `state` other than `ACTIVE` is dropped even if the fake wrongly returns it (defensive); a non-digit or over-long `id` is dropped; a geo-restricted video is kept; a video with an `http` or non-URL thumbnail is kept with `thumbnailUrl: null` | AC1 |
| BW10 | Titles: `name` used verbatim when non-empty (including `&`, quotes, `<img onerror>`); missing/empty/non-string name yields the fixed fallback built from the last 6 id characters | AC1 |
| BW11 | Conversions: `duration` 7000 -> `7`, 7499 -> `7`, 7500 -> `8`; missing, `0`, negative, non-number -> `null`; `created_at` as an ISO string and as epoch milliseconds both yield the same Unix seconds; unparsable -> `null` | AC1 |
| BW12 | **Query translation.** Table: empty and whitespace -> `+playable:true`; ` Launch ` -> `+playable:true +"Launch"`; `blue heron` -> two terms; `foo-bar_baz` -> three words; non-ASCII letters kept; more than 6 words truncated to 6; a word over 50 characters truncated. **Fuzz/property:** for a large set of adversarial inputs (`NOT`, `AND`, `OR`, `name:x`, `tags:"a b"`, `*`, `x*`, `(`, `)`, `"`, `\`, `+`, `-`, `:`, `..`, `[a TO b]`, `%00`, newlines, emoji, 100-character strings, `&limit=100&x=`) the outbound `query` always matches the grammar `+playable:true( +"[letters/digits]{1,50}"){0,6}`, and the set of outbound parameter names is exactly `limit`, `offset`, `sort`, `query`; text with no letters/digits (for example `!!!`) returns `200 {items: [], nextCursor: null}` with **zero** Brightcove calls | AC2, AC7 (injection), AC1 |
| BW13 | Paging and scan: `cursor=25` -> CMS `offset=25`; a returned page of fewer than `limit` videos -> `nextCursor: null`; a full page -> `nextCursor` = offset+limit; with `PAGE_SIZE=3`, `MIN_RESULTS=4`, `MAX_PAGES=3` and a library where some videos are protected: the scan stops when 4 kept items are collected, when the last page is short, or after 3 CMS calls, whichever first (three scenarios), returns **all** kept items of every scanned page, and sets `nextCursor` to the offset after the last scanned page; following `nextCursor` repeatedly over a scripted mixed library yields every kept video exactly once in CMS order, for several page sizes; the call budget is never exceeded; with the fallback end rule (documented) a trailing empty page ends the list | AC1 |
| BW14 | Input validation: `q` over 100 characters; `cursor` of `-1`, `abc`, `1e3`, `01`, `1.5`, 7 digits, empty-string-with-equals, repeated parameters -> `400 bad_request`, **no** Brightcove call (not even the exchange); an unknown parameter does not reach the outbound request | AC2, AC7 |
| BW15 | CMS errors: `400 ILLEGAL_QUERY` -> `502` with outcome `brightcove_query_rejected`; `404` and `403` -> `502` with outcome `brightcove_account_or_scope`; `429` then `200` -> retried (injected `sleep`) and `200`; always `429` -> `429 rate_limited` + `Retry-After`; `5xx`/network error exhausts retries -> `502`; non-array or non-JSON body -> `502` outcome `brightcove_bad_response`; in every case the body has no Brightcove text | AC1 (robustness), AC2 |
| BW16 | Configuration: missing `BRIGHTCOVE_BASIC_AUTH` -> `500 misconfigured` (generic; log names the secret, never a value; no Brightcove call); `BRIGHTCOVE_ACCOUNT_ID` missing/non-digit and `BRIGHTCOVE_PLAYER_ID` empty or with `/`, `?`, `.` -> `500 misconfigured`; valid values appear in the response's `player` object exactly as configured | AC2, AC6 |
| BW17 | Template integration through this worker's real config: disallowed `Origin` with a valid token -> `403`, handler and Brightcove not called; allowed-origin preflight `204` without a token and without any Brightcove call; the route list contains `GET /brightcove/videos` once; other methods on it -> `405`; unknown routes -> `404` with a token and `401` without (auth before routing); adding Brightcove did not change the Mux route's responses (the #13 MW suite passes unchanged against the same worker) | AC3, AC6 |
| BW18 | Production wrangler config (parsed in a test): `BRIGHTCOVE_BASIC_AUTH` is in `secrets.required` and not in `vars`; `BRIGHTCOVE_OAUTH_ORIGIN` and `BRIGHTCOVE_CMS_ORIGIN` are unset or exactly the real hosts; `ALLOW_LOCALHOST` false; no `vars` key matches a secret-looking pattern | AC2, AC6 |

## 5. Runtime smoke (seam W2)

Starts the real worker under `wrangler dev` (no Cloudflare login) with `IMS_ORIGIN`, `BRIGHTCOVE_OAUTH_ORIGIN` and `BRIGHTCOVE_CMS_ORIGIN` pointing to local Node servers, secret from a temp env file.

| ID | Behaviour asserted | Proves |
|---|---|---|
| BS1 | The worker with the Brightcove route bundles and starts; a bare request gets `401`; the fake Brightcove saw nothing | AC2, AC6 |
| BS2 | Valid test-signed token: `200`, contract-conforming body; a second request within the token lifetime causes no second OAuth call in the real runtime; preflight behaviour per #2 over real HTTP | AC1, AC2 |
| BS3 | The BW13 multi-page scenario returns the same results in the real runtime | AC1 |
| BS4 | The canary secret, its halves and the issued access token are absent from all responses (BW3 repeated over HTTP) | AC2, AC6 |
| BS5 | Records Brightcove subrequests, wall time and CPU for the worst-case scan (full `MAX_PAGES` plus a cold token): informational against Free-plan 10 ms CPU / 50 subrequest limits (#2 R7); no hard threshold until a baseline exists | AC2 |

## 6. End-to-end tests (seam S1, Playwright, Chromium, hermetic)

Config: as #13 §6 plus the fake Brightcove server (two ports or one server routing `/v4/access_token` and `/v1/accounts/{id}/videos`) with a scripted library larger than one page including protected, inactive and not-yet-published videos; the worker started via `wrangler`; the #1 SDK stub with a token signed by the fake IMS key. Every other external request, including thumbnail hosts (routed to a tiny local image), is aborted.

| ID | Behaviour asserted | Proves |
|---|---|---|
| BE1 | Choose the Brightcove provider (both Mux and Brightcove registered): grid shows thumbnails, titles and durations from the fake Brightcove through the real worker (real cross-origin request, preflight included) | AC1, AC5 (local origins), AC6 |
| BE2 | Type a search term: grid narrows to matching videos; clearing restores; typing quickly shows only the final query's results; text such as `NOT "x" name:*` neither errors nor changes the result set unexpectedly | AC1 |
| BE3 | Library larger than one page: "Load more" appends the rest without duplicates; the button disappears at the end | AC1 |
| BE4 | Click a video: recorded SDK calls are `sendHTML` (one table whose link is exactly `https://players.brightcove.net/{account}/{player}_default/index.html?videoId={clicked id}`) then `closeLibrary` | AC1 |
| BE5 | Inactive, not-yet-published, processing and playback-rights videos never appear in the grid | AC1 |
| BE6 | Worker `401` (stub token signed by a different key) shows "session expired"; the fake Brightcove rejecting the credential (script `invalid_client`) shows the generic retry message, **not** "session expired", and no stack trace/upstream text; a request without a token gets `401` through the full browser path and the CORS headers let the page read it | AC2, AC6 |
| BE7 | Brightcove slow or `429`: visible loading, then timeout/rate-limited message and "Try again"; recovery after the fake recovers | AC1 (robustness) |
| BE8 | Page HTML, DOM text and every network request/response contain none of: the IMS token (except the `Authorization` header to the worker origin), the Brightcove client ID, client secret, combined secret, or the issued access token; only the page, worker, SDK stub and local-image hosts were contacted | AC2, AC6 |
| BE9 | Switching provider Brightcove -> Mux -> Brightcove resets search and grid each time | AC3 |

## 7. Repo checks and review (seam S3, extended)

| ID | Behaviour asserted | Proves |
|---|---|---|
| BR1 | The #1 convention check passes for `apps/video-picker` unchanged (entry page, README, tests, table row, `library` registration documented); no new table row is required | AC3, AC4 |
| BR2 | The #2 worker checks pass: `.dev.vars.example` lists `BRIGHTCOVE_BASIC_AUTH`; no tracked `.dev.vars*`; no secret-looking key in `vars`; wrangler config only in allowed locations | AC2, AC6 |
| BR3 | A rule/test fails when the production config sets either Brightcove origin to anything but the real host (BW18 may serve as the implementation) | AC6 |
| BR4 | ESLint 8 + helix and Stylelint 16 cover all new JS/CSS including tests and worker code | AC7 |
| BR5 | **Review checklist** (the PR description answers each): (a) the diff outside `providers/brightcove/**` is limited to the registry line, the worker-entry registration, wrangler vars and secret name, `.dev.vars.example`, the README Brightcove section and test-kit additions; (b) shell, renderer, conformance suite and shared checker files are untouched; (c) no import from another extension | AC3 |
| BR6 | The README Brightcove section contains every required topic (§ below) and an explicit "reads no site config / query parameters" statement | AC4 |

README required topics (checked by BR6 review): Studio credential creation (Admin, API Authentication, one account, **only** CMS - Video Read); finding the account ID; finding or choosing the player ID and the no-domain-restriction requirement; building and setting `BRIGHTCOVE_BASIC_AUTH` without shell history/file; the non-secret `vars` table; local dev with `wrangler dev --var`; branch-ref testing; site prerequisite (`embed` block); search behaviour (whole-word, multi-field, newest-first); hidden-video rules (inactive, unpublished, playback rights); credential rotation (`wrangler secret put`); the unchanged `library` row; "reads no site config".

## 8. End-to-end checks inside real EW and real Brightcove (manual; needs interactive Adobe login and a Brightcove account)

Accounts and credentials needed (none can be provided by an agent):

- Everything listed in #13 §8 (GitHub admin and Code Sync; Adobe IMS identity with DA org/site access and config permission; Chrome; Cloudflare account with Wrangler login; a site with an `embed` block).
- A **Brightcove Video Cloud account where API Authentication is available**. A trial account does not qualify ("No access to API management", five-upload cap [VERIFIED: https://studio.support.brightcove.com/get-started/getting-started-your-video-cloud-trial.html]); a paid or partner/sandbox account is needed (Open Question 1). In it: the account ID; one client credential created for that account with **only** CMS - Video Read; at least three titled videos (one title containing `&` and a quote), at least 30 videos in total for paging (or `BRIGHTCOVE_PAGE_SIZE` lowered), one `INACTIVE` video, one video scheduled to start in the future, and (optional, only if the account has Playback Rights enabled by the CSM) one video with a playback-rights ID. An **unrestricted** published player (the default player, or a named one), and optionally a second **domain-restricted** player to document the failure (R2).
- Never paste the client ID/secret, `BRIGHTCOVE_BASIC_AUTH`, an access token or an IMS token into chat, issues, PR descriptions or logs. For the curl checks below, read the credentials from prompts or environment variables that are unset afterwards.

Steps (BV numbering avoids collision with #1 M, #2 W, #13 V):

- **BV0 (prereq):** #13 V0 done (worker deployed, bare request `401`). Create the client credential in Studio (Admin, API Authentication, New: one account, CMS - Video Read only). Open the Studio embed code for a published video and record the account ID, the player ID as it appears in `players.brightcove.net/{account}/{player}_default/...` (resolves R13 and the `default` assumption). `wrangler secret put BRIGHTCOVE_BASIC_AUTH` using the README's no-history command; set `BRIGHTCOVE_ACCOUNT_ID` and `BRIGHTCOVE_PLAYER_ID` vars; deploy; `curl -i <worker>/brightcove/videos` returns `401`. [AC2, AC6]
- **BV1 (raw API facts, curl against Brightcove, no worker):** (a) token exchange with `curl --user` prompting for the credentials; record `expires_in` and that a call with a deliberately wrong secret returns `400`/`401` as mapped; (b) `GET .../videos?limit=3&sort=-created_at&query=%2Bplayable:true` with the token: record the `created_at` wire format (number vs ISO string), `duration` units, the `images.thumbnail.src` host and URL scheme, the absence of a total, the response when the credential lacks the read scope (`403`/`401`); (c) search checks: `%2Bplayable:true%20%2B%22<word of a known title>%22`; a quoted ignored word (`%2B%22the%22`); a quoted operator (`%2B%22NOT%22`); a pasted video ID; a pasted reference ID; stemming (`running` vs `run`) and the non-match of a partial word (`vid`); record whether `+"word"` parses as assumed and whether `playable:true` excludes the INACTIVE and future-scheduled videos; (d) the response when `sort` is omitted vs `sort=-created_at` for a paged search (the documented instability). These outcomes convert the [ASSUMPTION]s in decisions 14, 15 and 17 into recorded facts or trigger spec changes. [AC1]
- **BV2 (`ref=local`, browse/search):** two terminals (`npm start`; worker dev script with sandbox credentials in `.dev.vars`, vars via `--var`). Open the editor with `?ref=local`, open the library, choose *Video Picker*, switch to *Brightcove*. Expect the grid (thumbnail, title, duration) within about a second after the SDK handshake; at real panel width nothing is clipped; inactive/future videos absent. Type a word from a title: narrows; paste an ID: that video. DevTools Network: `OPTIONS 204`, `GET /brightcove/videos 200` with `Access-Control-Allow-Origin: http://localhost:3000`; **no request to `oauth.brightcove.com` or `cms.api.brightcove.com` from the browser**; search every response for the client ID, secret, combined secret and an access token: none. [AC1, AC2, AC5, AC6]
- **BV3 (insert):** with the cursor in an empty paragraph click a video: the library closes and an `embed` block with one link `https://players.brightcove.net/.../index.html?videoId=...` appears at the cursor; confirm in the saved/preview `.plain.html` (the placement caveats are #13 V3 and R2 there; record the Brightcove-specific result, in particular that the `?videoId=` query survives the editor and the document pipeline). [AC1]
- **BV4 (plays on preview):** preview on a site with an `embed` block, with `ref=local` code and again with a branch/main ref: the Brightcove player loads and the video plays, including fullscreen. Repeat with a video from the domain-restricted player (if available) and record that the iframe embed fails there (R2). Test a geo-restricted or scheduled video only if the account offers one. [AC1]
- **BV5 (paging against the real account):** lower `BRIGHTCOVE_PAGE_SIZE` (for example 5) and page through the whole library with "Load more": every video exactly once, in newest-first order; record whether a short page ever appears before the true end (the end-rule assumption, decision 17) and the largest offset the CMS accepts (probe a high offset, record the error). If a short page appears early, switch to the documented fallback end rule and update the spec. [AC1]
- **BV6 (failure modes):** (a) revoke the client credential in Studio: the author sees the generic retry message (not "session expired") and the worker log shows `brightcove_credentials_rejected`; restore with a new credential and `wrangler secret put`; (b) set a wrong account ID: generic message and `brightcove_account_or_scope`; (c) token expiry: search, wait more than five minutes, search again: it works with no visible error and the log shows a fresh exchange (cannot force an isolate, so this confirms behaviour, not the cache hit); (d) stop the local worker: "unavailable"/timeout and "Try again". [AC2, AC6]
- **BV7 (branch ref, deployed worker):** push branch `video-picker-brightcove`; open the editor with `?ref=video-picker-brightcove`; repeat BV2-BV4 against the deployed worker. Record the page's real `Origin` and that CORS passes. [AC5]
- **BV8 (secret hygiene and negatives, deployed):** `wrangler secret list` shows names only; bare `curl` returns `401`; `Origin: https://evil.example` with a valid token returns `403`; search page source, Network responses and Application storage for the client ID, secret, combined secret and an access token (none found); confirm the credential in Studio has exactly one account and only CMS - Video Read. [AC2, AC6]
- **BV9 (coexistence and no-shell-change):** with Mux and Brightcove both configured, switch providers repeatedly; confirm the PR's diff against the checklist in BR5 and that the #13 shell/test files are unchanged. If the account has Playback Rights enabled, confirm a video with a `playback_rights_id` is hidden and record whether a plain iframe link to it would have played (R5). [AC3]

## 9. CI

No new job types; Brightcove's tests join the #1/#2/#13 jobs. No credentials, no Brightcove account, no Cloudflare login in CI.

| Job | Covers | Notes |
|---|---|---|
| `lint` | ESLint/Stylelint for all new code; S3 convention check (BR1-BR3) | existing |
| `unit` | BP*, BC* (WTR), plus #13's shell/provider suites unchanged | existing |
| `worker-unit` | BW* (`node:test`), plus #13's MW* unchanged | existing |
| `worker-smoke` | BS1-BS5 | #2 R13 flakiness policy applies |
| `e2e` | BE1-BE9 (starts page server, worker, fake IMS, fake Brightcove) | existing job gains one more fake server |

## 10. Acceptance-criteria traceability (ticket #15)

| # | Acceptance criterion (#15) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Author can browse/search the Brightcove video library and insert a player embed that plays on preview | BP1, BP3, BP4, BP7, BP10 (provider, embed URL, renderer); BC1, BC2; BW2, BW8-BW13, BW15 (listing, projection, filtering, titles, conversions, query translation, paging, error robustness); BS2, BS3; BE1-BE5, BE7 | **BV1** (real API facts), **BV2** (browse/search in real EW), **BV3** (insertion), **BV4** (plays on preview; depends on site `embed` block and an unrestricted player, R2), **BV5** (real paging) |
| AC2 | Brightcove client credentials are exchanged for tokens in the worker | BW2 (exchange request shape, host, Basic, body), BW4 (cache, single-flight, expiry), BW5 (refresh on `401`), BW6 (exchange failure mapping), BW3 (secret, halves and issued token never leak), BW7, BW16, BW18; BP2, BP8 (browser never calls Brightcove, holds nothing); BS2, BS4; BE6, BE8; BR2, BR3 | **BV0** (secret set, bare `401`), **BV1(a)** (real exchange, `expires_in`), **BV2** (Network panel shows no Brightcove host calls), **BV6** (revoked credential, expiry), **BV8** |
| AC3 | Added inside the existing `video-picker` folder as a new provider; no changes needed in the extension shell beyond registering the provider | BP1 (conformance suite unchanged), BP9 (shell suite and registry with two providers, one registration line), BP10 (renderer unchanged), BW17 (Mux route unchanged), BC1; BE9; BR1 (convention check unchanged, no table row) | **BR5** (diff-scope checklist: only registry line, worker-entry registration, config names, README, test-kit additions; shell/renderer/suite untouched), **BV9** |
| AC4 | Extension README documents this vendor's setup (credentials, site config keys) | BR1 (README present, `library` registration documented) | **BR6** (review against the required-topics list: credentials, IDs, secret, vars, local dev, branch ref, prerequisites, search note, explicit "reads no site config"); a reviewer follows the README on a scratch worker to BV0 |
| AC5 | Works in EW with `ref=local` and with a branch ref | BP6 (origin selection by host), BE1 (page at `localhost:3000` talking to a real local worker across origins) | **BV2** (`ref=local`), **BV7** (branch ref against the deployed worker, real `Origin` recorded) |
| AC6 | Vendor credentials live only in this extension's worker (built from the shared template); the browser never receives them; unauthenticated calls are rejected | BW1 (auth before any Brightcove call, exchange included), BW3, BW7, BW14, BW16-BW18 (leak canaries, host-locked egress, origin gate, config pinned, route list); BC3 (no raw CMS JSON); BP2, BP8; BS1, BS4; BE6 (unauthenticated path through the browser), BE8; BR2, BR3 | **BV0** (bare `curl` `401`), **BV8** (deployed negatives and secret hygiene), **BV2** (Network panel), **BV6** |
| AC7 | Core logic covered by unit tests; lint and CI green | BP*, BC*, BW* via the `unit` and `worker-unit` jobs; BR4 lint; `e2e` and `worker-smoke` jobs | Review: CI shows all jobs green on the PR; a deliberately loosened filter (BW9) or a query translator that concatenates user text (BW12) on a scratch branch turns the suite red (not merged) |

Every acceptance criterion on #15 maps to at least one automated test or a numbered manual verification step above. Criteria on #53 itself: `apps/video-picker/providers/brightcove/` exists and contains this `SPEC.md`; it follows the to-spec template (Problem Statement through Further Notes) and adds Build Analysis and Testing Requirements; the traceability table above covers every #15 criterion; external API claims carry primary-source URLs and unverified claims are tagged [ASSUMPTION] or [OPEN]; no implementation code is included (only behavioural descriptions and the query-grammar description).

## 11. Open questions for the owner

1. **Brightcove account and credentials (R1).** Which Video Cloud account will the deployed worker use, and can you provide a non-trial account (or a partner/sandbox account) where you can create API credentials with CMS - Video Read? Brightcove's trial has no API management [VERIFIED]. Is production content acceptable for the deployed worker, and is a separate sandbox wanted for branch-ref testing (inherits #13 Open Question 3)? Until then every real-API behaviour stays [ASSUMPTION].
2. **Domain-restricted players (R2).** Does the player you will use have domain restrictions? If yes, the iframe embed cannot play and an in-page `video-js` embed (a renderer/contract change owned by #13) is required. Is an unrestricted player acceptable, and is the iframe-only v1 enough?
3. **Which player ID.** Use the account's default player (`default`, assumed), a specific named player, or should authors eventually choose a player (needs player-read permission and a UI)?
4. **Hidden and shown videos (R5).** Confirm v1 hides videos with Playback Rights (`playback_rights_id`), keeps geo-restricted ones, and relies on `+playable:true` for inactive, processing, unscheduled and expired videos. Does your account use Playback Rights, DRM, HLS encryption or geo-filtering?
5. **Search semantics (R3).** Brightcove search is whole-word, stemmed and multi-field (name, description, tags, IDs...) and the list is newest-first even when searching (needed for stable paging). Acceptable, or do you want title-only (`+name:"word"`) matching and/or relevance order at the cost of unstable paging?
6. **Credential convention.** One precomputed secret `BRIGHTCOVE_BASIC_AUTH` (this spec, same as Mux, no template change), or do you want #2 to gain native two-secret Basic auth / OAuth client-credential exchange first (#13 Open Question 4) so this route delegates instead of owning the exchange and cache?
7. **Template API assumptions (R7).** Is it acceptable that the route sets the outbound `Bearer <derived token>` itself and opts in to retrying the token-exchange `POST`, relying on #2's behaviour to strip only the caller's inbound `Authorization`? If #2's real API forbids this, who raises the template change?
8. **Account and player IDs in the repo.** Are committing the production account ID and player ID (non-secret, but identifying) in the public repo's wrangler config acceptable, or should they also be set out-of-band? And is it acceptable that the worker, not an extension constant, supplies them to the browser (a small departure from #13 decision 27)?
9. **Provider contract: embed hosts (R12).** #13 says the renderer allowlists "hosts the active provider declares" but its contract list has no such field. Confirm the provider object declares `embedHosts` (this spec's assumption), or amend #13.
10. **Who may list the Brightcove library (R16).** Is "any authenticated Adobe user passing #2's client-id allowlist" acceptable for this account's playable videos, or should the worker restrict by user/org (inherits #13 Open Question 2)?
11. **Thumbnail quality.** The default thumbnail may be small (160x90 in docs samples). Acceptable for a 1-2 column grid, or should a larger image variant be chosen (needs the `sources` list and a size rule)?
12. **Sequencing with #14.** #14 (Wistia) and #15 both edit the registry, worker entry, wrangler config, `.dev.vars.example` and README. Land them strictly one after the other (and in which order), or accept rebases? Should the README table row for the extension list the providers?
13. **Live and clip videos.** Should live streams (`delivery_type: live_origin`) and clips be listed? v1 lists whatever `playable:true` returns.
14. **Documentation placement.** The Brightcove setup lives as a section of the extension README (this spec, per #15 AC4); do you prefer a separate per-provider README in the provider folder as well?
15. **Library size and offsets.** How large is the Brightcove library? The maximum usable `offset` is undocumented [OPEN]; if the library is far larger than a few thousand videos, a different paging strategy (for example `created_at` range windows) would be needed.
16. **Policy carry-over.** Confirm the open policy items from #1/#2/#13 (Adobe outside-activity/IP; personal Cloudflare account handling a third-party credential; no public marketplace process found) are accepted as-is for this provider, whose README must state that it handles a third-party vendor credential.
