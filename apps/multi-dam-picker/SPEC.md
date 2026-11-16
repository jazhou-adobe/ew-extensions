# Spec: Multi-DAM Picker: Bynder (picker shell + first DAM)

Ticket: jazhou-adobe/ew-extensions#22 (this spec: #60). Blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). #22 blocks #23 (Cloudinary), #24 (Frontify), #25 (Dropbox), which "only add a module" to the shell built here.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) or observed on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Bynder/Cloudflare.

Vocabulary follows #1 and #2: *extension* = one folder `apps/<name>/` (type comes from its EW config-sheet row; this one is a **library plugin**); *worker* = the per-extension backend in `apps/<name>/worker/` built from `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension. New terms: *provider* = one DAM integration (Bynder first); *shell* = the provider-agnostic browser UI plus provider-agnostic worker core; *connection* = one EW user's authorisation of the extension against one provider.

---

## Problem Statement

Content authors in Experience Workspace (EW) can insert images from AEM Assets (first-party), but many customers keep their brand assets in a third-party DAM. Only AEM Assets is documented in EW. Today an author who wants a Bynder image has to leave EW, find the asset in Bynder, work out which public rendition URL is safe to use, copy it, come back, paste it into the document, and then retype alt text from the asset's metadata. The URL they copy is often wrong (a private or expiring link, an oversized original, a limited-use asset), nobody checks it, and the alt text is usually skipped.

Integrating a DAM properly is also hard for the maintainer. Each DAM needs OAuth on behalf of the individual author (so Bynder's own permissions decide what each person may see), a server-side holder for the OAuth client secret and the long-lived refresh tokens (the browser must never see them; extension code is public), and a proxy because the DAM APIs are not browser-callable with those credentials. If each of four DAMs (Bynder, Cloudinary, Frontify, Dropbox; the Contentful marketplace carries apps for all four) were built as an independent extension, the OAuth/token/proxy plumbing would be written four times and would drift.

The maintainer needs one picker shell with a small provider interface, and Bynder as the first provider, so that later DAMs add one module each.

## Solution

A **Multi-DAM Picker** library plugin, listed in the EW editor library. An author opens it, clicks **Connect to Bynder** once, signs in to Bynder in a pop-up (Bynder's own login, including SSO), and from then on can browse and search the Bynder asset bank inside the library panel, filter by asset type (images, videos, documents, audio), pick an asset, choose among its public renditions (default: Bynder's `webimage`), review an alt text prefilled from the asset's metadata (editable, or marked decorative), and insert it at the cursor. Images are inserted as an `<img>` with the chosen rendition URL and the alt text; non-image assets with a public URL are inserted as a link.

Behind it, a per-extension **worker** (built from the #2 template, IMS-token-authenticated, CORS-restricted) owns everything sensitive: it starts and completes the Bynder OAuth authorization-code flow, stores each user's tokens encrypted at rest and keyed by the author's IMS identity, refreshes access tokens silently, and proxies every Bynder API call. The browser only ever holds the author's own IMS token (from the SDK) and normalised asset data; it never receives the Bynder client secret, access token or refresh token.

The shell is provider-agnostic. A **provider interface** (auth, browse/search, rendition URLs, metadata, plus capability flags) is defined in this ticket and enforced by a shared contract-test suite. A later DAM adds one worker-side provider module, its recorded fixtures and one registry entry; no change to the browser shell or the worker core.

## User Stories

Content author (EW end user):

1. As a content author, I want the Multi-DAM Picker to appear in my editor library, so that I can find it where I already insert content.
2. As a content author, I want a clear "Connect to Bynder" button the first time, so that I know I have to sign in before I can see assets.
3. As a content author, I want to sign in with my own Bynder account (including my company's SSO) in a pop-up, so that what I see in the picker is exactly what Bynder allows me to see.
4. As a content author, I want the picker to remember my Bynder connection across sessions and browsers, so that I am not asked to sign in every time I open the library.
5. As a content author, I want to see which Bynder account I am connected as, so that I can tell when I connected the wrong account.
6. As a content author, I want a "Disconnect" action, so that I can remove my Bynder connection (for example before handing my EW account to a colleague).
7. As a content author, I want the picker to tell me plainly when my Bynder connection was revoked or expired for good and offer "Reconnect", so that I am never stuck on a cryptic error.
8. As a content author, I want to search the Bynder asset bank by keyword, so that I can find an asset by name, tag or filename.
9. As a content author, I want typing to search automatically after a short pause (and Enter to search at once), so that I do not need a Search button but also do not trigger a request per keystroke.
10. As a content author, I want to filter by asset type (all, images, videos, documents, audio), so that I only see assets I can use at this cursor position.
11. As a content author, I want to see recently modified assets when I have not searched yet, so that the panel is useful immediately after connecting.
12. As a content author, I want results shown as a thumbnail grid with the asset name, so that I can recognise assets at a glance.
13. As a content author, I want a "Load more" action instead of an unbounded list, so that the panel stays fast on a portal with tens of thousands of assets.
14. As a content author, I want a stale search never to overwrite a newer one, so that the grid always matches what I typed last.
15. As a content author, I want to open an asset to see a larger preview, its name, dimensions and file type, so that I can confirm it is the right one.
16. As a content author, I want to choose which public rendition (derivative) to insert, with a sensible default (`webimage`), so that I do not publish a multi-megabyte original on a web page.
17. As a content author, I want the original file offered only when it is public, so that I never insert a URL that visitors cannot load.
18. As a content author, I want the alt text prefilled from the asset's metadata (a configured metaproperty, else description, else a cleaned-up filename) and told where it came from, so that accessible markup is the default.
19. As a content author, I want to edit the alt text before inserting, so that I can adapt it to the page context.
20. As a content author, I want a "decorative image" option that inserts empty alt text, so that purely decorative images do not clutter screen-reader output.
21. As a content author, I want a visible warning when an asset is flagged limited-use, archived or watermarked in Bynder, so that I do not publish something I should not.
22. As a content author, I want to insert the chosen rendition at my cursor with one click, so that the image lands where I am working.
23. As a content author, I want the library to close after inserting (as the AEM Assets picker does), so that I can keep editing.
24. As a content author, I want videos, documents and audio that have a public URL inserted as a link with the asset name as text, so that non-image assets are not a dead end.
25. As a content author, I want assets with no public URL shown as not insertable with a one-line reason, so that I do not get a broken link.
26. As a content author, I want an understandable message when Bynder is rate-limiting or down, with how long to wait, so that I know whether to retry now or later.
27. As a content author, I want the picker to work with the keyboard and with a screen reader (labelled search field, filter, buttons for grid items), so that the tool is usable by everyone on the team.
28. As a content author, I want a clear "not running inside Experience Workspace" message if I open the page directly, so that a mis-opened URL is self-explanatory.
29. As a content author on a second DAM later, I want a provider switcher that only appears when more than one DAM is configured, so that the UI stays simple for single-DAM sites.

Site administrator / maintainer:

30. As a site admin, I want to enable the picker with one `library` config-sheet row, so that adoption is copy-paste.
31. As a site admin, I want the README to list every setting the extension reads (worker-side config, the config-sheet row) and the Bynder-side setup (OAuth app, scopes, redirect URI, public derivatives, alt-text metaproperty), so that I can set it up without reading code.
32. As a site admin, I want to point the Bynder integration at my portal and my alt-text metaproperty by configuration, so that no code change is needed for my tenant.
33. As the maintainer, I want the Bynder OAuth client secret and every user's tokens to exist only in the worker (secret store and encrypted storage), so that nothing sensitive is ever in the public site.
34. As the maintainer, I want every call to the worker to be rejected without a valid IMS token, so that the endpoint is not an open door to a Bynder portal.
35. As the maintainer, I want one author's Bynder connection to be unusable by any other author, so that Bynder permissions stay per person.
36. As the maintainer, I want the OAuth callback protected against forged or replayed requests and against "link my account to someone else's session" attacks, so that the one unauthenticated route cannot be abused.
37. As the maintainer, I want to rotate the token-encryption key and the Bynder client secret without a code change, so that a leak is a short fix.
38. As the maintainer, I want to purge a user's stored tokens with one documented command, so that I can honour a deletion request.
39. As the maintainer, I want the provider interface documented and enforced by a shared contract-test suite, so that adding Cloudinary, Frontify or Dropbox means writing one module and passing the suite.
40. As the maintainer, I want a repo check that fails when vendor-specific code leaks outside a provider's own folder, so that the shell cannot quietly become Bynder-only.
41. As the maintainer, I want the whole flow (including the OAuth pop-up dance) tested hermetically in CI against fake IMS and fake Bynder servers, so that no credentials are needed on every push.
42. As the maintainer, I want unit tests for the core logic and CI lint and tests green on every push and PR, so that regressions do not merge.
43. As the maintainer, I want the extension listed in the root README extensions table, so that the repo stays a catalogue of what exists.

Provider author (later tickets #23-#25):

44. As a provider author, I want one documented interface to implement (authorize URL, code exchange, refresh, search, get asset), so that I know exactly what a DAM module must do.
45. As a provider author, I want the shell to own state sealing, cookies, token encryption, storage, refresh orchestration, error mapping and the browser UI, so that I never touch security-critical plumbing.
46. As a provider author, I want capability flags (supported asset types, sort options) that drive the UI, so that a DAM with fewer features does not need browser changes.
47. As a provider author, I want recorded-response fixtures and a conformance suite that runs against my module automatically, so that I can prove compatibility before manual testing.

## Implementation Decisions

(No file paths or code here, except type tables where they carry a decision. Layout is in the Build Analysis.)

1. **Surface: library plugin only.** Registered via a row in the site's `library` config tab, per the #1 convention (type comes from the sheet row, folder is `apps/multi-dam-picker/`). No fullscreen app in this ticket. The ticket's "Type: Plugin" matches this.
2. **Build our own picker UI; do not embed Bynder's Universal Compact View (UCV).** UCV (https://developers.bynder.com/universal-compact-view) is a ready-made picker, but (a) its authentication contract hands the *browser* an access token (`authentication.getAccessToken`) or runs its own browser-side login, which contradicts AC2 (tokens held and refreshed server-side, browser never receives them); (b) it is Bynder-only, so it cannot be the provider-agnostic shell AC3 requires; (c) Bynder's portal needs extra Customer Support setup to use it (https://support.bynder.com/hc/en-us/articles/360013871360-Integrate-Universal-Compact-View). Contentful's marketplace Bynder app uses UCV (https://github.com/contentful/marketplace-partner-apps/tree/main/apps/bynder, README) and is therefore prior art for the *insertion semantics* (default `webimage` derivative), not for the architecture. [VERIFIED sources; the decision is the spec author's, flagged for owner confirmation in Open Question 16.]
3. **Per-user OAuth 2.0 authorization-code grant with the `offline` scope, executed by the worker.** One Bynder OAuth app per Bynder portal, registered by a portal admin; its client id/secret and the portal address are worker configuration. Each author connects their own Bynder account; Bynder only grants scopes matching the user's own permissions. Scopes requested: `offline` (to obtain a non-expiring refresh token), `asset:read`, `current.user:read` (to show "Connected as ..."). Client-credentials (a shared service account) is explicitly not used: it would give every EW author one identity and defeat per-user permissions. [Facts: https://support.bynder.com/hc/en-us/articles/360013875180-How-To-Create-And-Manage-OAuth-2-0-Apps-to-Provide-Access-to-Bynder-API, https://developers.bynder.com/integrate.]
4. **One portal per worker deployment.** A worker serves one EW site (#2: `ORG`/`SITE` vars) and therefore one Bynder portal (OAuth app credentials are created inside a portal). Multi-portal per site is out of scope. [OPEN: Question 12.]
5. **Identity = the verified IMS user id.** Connections are keyed by the `userId` the #2 template produces from the validated IMS token, never by anything the client sends. Different EW users never share a connection; the same EW user shares one connection across browsers and sessions. [ASSUMPTION: the IMS `user_id` claim is stable per person across the shell and library tokens; to be confirmed in manual step M3. Open Question 14.]
6. **The OAuth callback is the single unauthenticated-by-IMS route, protected by sealed state plus a browser-binding cookie.** The browser redirect from Bynder cannot carry an `Authorization` header, so this one route cannot use the #2 IMS check. It is made safe as follows: (a) an authenticated call (`connect`) returns a short-lived (about 60 s), single-purpose *ticket* sealed with a worker secret and bound to the IMS user and provider; (b) the pop-up navigates to a worker `begin` route that verifies the ticket, sets an HttpOnly, SameSite=Lax, path-scoped **binding cookie** holding a random nonce, and redirects to Bynder's authorize endpoint with a sealed `state` containing {user, provider, nonce hash, expiry}; (c) the callback accepts only if the `state` unseals, is unexpired, and its nonce hash matches the cookie. Rationale for the cookie: without it an attacker could start a flow with their own IMS token and trick a victim into completing it with the victim's Bynder account, silently linking the victim's Bynder access to the attacker's EW user (login-CSRF / account-linking attack). With it, only the browser that began the flow can finish it. Other than the callback and `begin`, every route requires the IMS token. [Design reasoning, no primary source; Bynder's authorize endpoint accepts an optional `state` parameter, https://api.bynder.com/reference/get_v6-authentication-oauth2-auth. PKCE is not documented by Bynder's OAuth reference; this design does not rely on it. Open Question 8.]
7. **No browser-side channel from the pop-up.** The pop-up may lose `window.opener` (cross-origin opener policies), so completion is detected by the extension **polling an authenticated `session` endpoint** (and noting pop-up close), not by `postMessage`. The callback page is a static, script-free HTML page ("You are connected. You can close this window." or a generic failure message), served with no-store, no-referrer and a restrictive CSP, reflecting no request input.
8. **Token storage: encrypted at rest in Workers KV, behind a small storage interface.** Records (access token, access expiry, refresh token, granted scopes, Bynder account display name) are sealed with AES-256-GCM under a worker secret; the record key is a hash of (IMS user id, provider id) and is also bound into the ciphertext as authenticated data, so a record copied to another key fails to decrypt. A previous-key secret may be configured so rotation does not force every user to reconnect. KV is chosen because it is the simplest store the platform offers and fits a low-write workload; Durable Objects (strongly consistent, single-writer per user) are the documented upgrade path if refresh races turn out to matter. KV is outside the #2 template's listed scope (it lists KV/D1/R2/DO as out of scope for the template), so this ticket adds a storage binding in this extension's worker only. KV limits on the Free plan (1,000 writes/day to different keys; 1 write/second to one key) are fine for a pilot and likely need the Paid plan for a large author base. [VERIFIED limits: https://developers.cloudflare.com/kv/platform/limits/. Open Question 3.]
9. **Refresh policy.** Access tokens last about one hour (the OAuth reference example returns `expires_in: 3600`; Bynder's support article on Postman tokens states a one-hour validity window). The worker refreshes proactively when fewer than 60 s remain, and reactively once on an upstream 401. Refresh calls in the same isolate are single-flighted. If a refresh returns a new refresh token it replaces the old one; if not, the old one is kept (the response schema lists `refresh_token` as optional). A definitive refresh failure (`invalid_grant`) deletes the connection and surfaces `reauth required`; a transient failure (5xx/network) never deletes it. If a refresh fails but storage now holds a newer record (another isolate won the race), the newer record is used. [VERIFIED schema: https://api.bynder.com/reference/post_v6-authentication-oauth2-token-authorization; whether Bynder rotates refresh tokens is undocumented, Open Question 9.]
10. **Provider interface (the AC3 deliverable).** A provider is a self-describing module with two halves, both owned by its own folder, registered by one registry entry:
    - **Identity and capabilities:** `id`, `label`, supported asset types, supported sort orders, whether it supports pagination by page or by cursor.
    - **Auth half (pure HTTP mapping; the shell owns state, cookies, storage, refresh orchestration):** build the authorize URL from (state, redirect URI); exchange an authorization code; refresh a token; read the connected account's display name; (optional) revoke.
    - **Browse half:** `search(query, type, sort, page)` returning normalised summaries; `getAsset(id)` returning a normalised detail.
    - **Metadata half:** inside the normalised asset (below): name, description, tags, copyright, dimensions, type, warnings, an *alt candidate* with its source, and renditions.
    The shell does everything else: authentication (#2), routing, state and ticket sealing, cookies, token encryption and storage, refresh and single-flight, outbound retry/backoff (template proxy), error mapping to the template's error contract, logging/redaction, input validation, and all UI. A provider never receives the IMS token and never reads raw storage; it is handed a validated per-call context (user's provider tokens, an outbound-call helper pinned to its allowed hosts, config, secret accessor). Registration fails fast at worker start if a required member is missing. A provider whose required config or secrets are absent is omitted from the provider list (and its routes return not found) instead of crashing the worker.
11. **Normalised asset contract (what crosses the worker/browser boundary).** Provider-specific raw payloads are never passed through; only allow-listed fields are mapped (see Data contracts in the Build Analysis). Renditions are opaque URLs exactly as the DAM's API returned them; the shell and providers **never construct or parse DAM URLs** (Bynder is migrating public link formats, `/m/...` to `/asset/...`, and says to treat API-returned links as-is: https://support.bynder.com/hc/en-us/articles/360013870200-Understanding-And-Enabling-Public-Assets).
12. **Rendition policy for Bynder.** Candidate renditions come from the API response: the three standard derivatives (`mini`, `thul`, `webimage`, from `thumbnails`; "thumbnails are public by default"), the public custom derivatives returned in `mediaItems` (detail call only), and the original only when the asset is marked public (the API returns `original` only then, and only if the portal's `seoBaseUrl` is configured). The default is `webimage` (the same default Bynder's UCV integration documents). A configurable default derivative name lets a site prefer one of its own public derivatives. If an asset has no usable rendition it is shown as not insertable with a reason. Dynamic asset transformation (on-the-fly crop/scale URLs) is out of scope for this ticket. [VERIFIED: https://api.bynder.com/reference/get_api-v4-media, https://support.bynder.com/hc/en-us/articles/360013871360-Integrate-Universal-Compact-View, public-assets article above.]
13. **Alt text policy.** Computed by the worker's provider module as a ranked fallback and returned with its source: (1) the value of a configurable Bynder metaproperty (site-chosen, e.g. one named for alt text), (2) the asset `description`, (3) the asset name without extension with separators turned into spaces, (4) empty with a "needs alt text" flag. All candidates are stripped to plain text (no markup, no control characters). The author always sees and may edit it, or mark the image decorative (empty alt). Bynder's media response has no dedicated alt-text field in the documented schema (documented fields include name, description, copyright, tags, `propertyOptions`, and `property_<name>` metaproperty fields), hence the configurable metaproperty. [VERIFIED schema; exact JSON shape of `property_<name>` values is ASSUMPTION to be settled against a real portal fixture, Open Question 7.]
14. **Insertion semantics.** Images: the browser builds one `<img>` element with only `src` (the chosen rendition URL) and `alt`, serialises it with DOM APIs (never string concatenation), and sends it with `actions.sendHTML`, then `actions.closeLibrary`. Non-image assets with a public URL: a single `<a>` whose text is the asset name. Only `https:` URLs are ever inserted. The SDK actions are fire-and-forget with no acknowledgement (verified in the SDK source), so "inserted" is shown optimistically and verified only in EW manually. [VERIFIED: https://da.live/nx/utils/sdk.js and https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/iframe-protocol.js read 2026-11-16; the host parses the HTML with `DOMParser` and inserts at the selection. That the editor schema keeps `src` and `alt` and wraps a bare inline `<img>` correctly is ASSUMPTION, manual step M1.]
15. **Experience.** Default registration recommendation is `experience = fullsize-dialog` (a large grid and detail pane need space); the narrow inline panel layout must also work (single-column responsive grid) and is the fallback. `fullsize-dialog` is seen in the da-live source (it routes to `loadModal`, which iframes the plugin and runs the same SDK channel) but is **not in the public docs**. [VERIFIED in source: https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/helpers.js; undocumented, Open Question 5.]
16. **Browser <-> worker authentication and origin.** Every worker call carries `Authorization: Bearer <IMS token from the SDK>` (the #2 contract). The worker origin is a constant in the extension, never taken from the URL (the #2 Decision 13 rule; a test proves a `?worker=` parameter is ignored).
17. **API surface is provider-namespaced and small.** One list endpoint (providers and connection state), per-provider connect/session/disconnect, search, and asset detail; plus the two OAuth browser routes (`begin`, `callback`). Full table in the Build Analysis. Errors reuse the #2 error contract and add provider-specific codes (not-connected, reauth-required, not-configured) as an extension of it.
18. **Template contract gaps this ticket depends on** (gathered here so the owner can approve them as #2 changes, or accept this ticket carrying a thin wrapper): G1 a route option for explicitly public routes with a custom authenticator (needed for `begin` and `callback`; #2 Decision 4 currently says no unauthenticated routes except preflight); G2 an optional storage binding in the scaffold; G3 per-request dynamic redaction values (the user's Bynder access/refresh tokens are not in the env, so the #2 redaction pass cannot know them); G4 the ability for a route to return HTML with a custom security-header set and to define extra error codes through the template's error helper. [OPEN: Question 2. The spec treats G1-G4 as prerequisites to schedule; none is a reason to change the architecture.]
19. **Secrets and configuration split.** Secrets (secret store only): the Bynder client secret, the token-encryption key (and optional previous key), the state/ticket sealing key. Non-secret vars: the Bynder portal domain, the Bynder client id (public by nature: it appears in the authorize URL), the public worker origin used to build the redirect URI (fixed in config; never derived from the request `Host`), scopes, alt-text metaproperty name, default derivative name. The extension reads **no site config** except its own `library` row. [Secret/var classification follows #2 Decision 7 and its UR3 check.]
20. **Rate limiting reality.** Bynder allows 4,500 requests per five minutes per source IP and blocks the IP for five minutes when exceeded (https://developers.bynder.com/integrate, https://api.bynder.com/docs/getting-started). All worker egress shares the platform's outbound IPs [ASSUMPTION: Cloudflare Workers subrequests egress from shared Cloudflare IPs, not a dedicated one; Open Question 11]. The shell therefore keeps page sizes modest (default 24, max 50), debounces searches, and maps a Bynder 429 to a `rate limited` response with a retry delay the UI honours instead of hammering. The template's short retry window (cap 2 s, deadline 8 s) cannot outwait a five-minute block, by design.
21. **Tooling and conventions** follow #1/#2 unchanged: ESLint 8 + helix config, Stylelint 16, `@web/test-runner` for browser unit tests, Node `node:test` for worker tests, Playwright (Chromium) for e2e, Node 22 (>= 22.12 for wrangler 4), husky. Tests live inside the extension folder.
22. **Docs ship with the code.** The extension README covers: what it does, Bynder-side setup (OAuth app, scopes, redirect URIs, public derivatives, alt-text metaproperty, Customer Support enablement), worker setup (vars, secrets, KV namespace, deploy), the exact `library` config-sheet row, the site config it reads (none besides the row; stated explicitly), local dev, privacy/retention note for stored tokens, and the "add a provider" checklist. The root README gets one extensions-table row.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given an HTTP request to the worker (with a fake IMS, a fake Bynder, a fake KV), assert the response, the redirects, cookies, the stored (encrypted) bytes, and the outbound calls the fake Bynder received; given an SDK result and a worker stub, assert what the DOM shows and which SDK actions fire. Never assert on internal helper names or call counts of internal functions. Two properties are asserted as negatives across every path: **no secret or token ever reaches a response, redirect, log line or the browser**, and **nothing runs before authentication succeeds (except the two sealed OAuth routes, which have their own gate)**.

**Proposed seams** (recorded here instead of asked, per #60). Existing seams from #1/#2 are reused; one new seam is added because AC3 is otherwise unverifiable.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 (primary) | The worker's HTTP boundary: `worker.fetch(request, env, ctx)` | reused from #2 | Node unit tests for routes, OAuth, storage, refresh, errors, security | Constructed `Request`s; #2 test kit (`makeEnv`, `fakeIms`, `signToken`, `fakeUpstream`, canaries) extended with an in-memory KV and a scripted fake Bynder (authorize/token/media/currentUser) |
| P1 (new, the only new seam) | The provider interface: the shell's registry + a shared conformance suite | new | Contract tests run once per registered provider; later vendors get them for free | Recorded Bynder responses as fixtures (sanitised from a real portal), replayed by `fakeUpstream`; a stub second provider proves "add a module only" |
| S2 | Browser render/logic module + SDK result | reused from #1 | `@web/test-runner` tests for the picker UI | Hand-built SDK result; injected `fetch` standing in for the worker; fake timers; spy `window.open` |
| S1 | Entry HTML page + SDK module boundary, against a real local worker | reused from #1/#2 | Playwright e2e | #1 SDK stub (`sendHTML`/`closeLibrary` call log); real worker under `wrangler dev` with local KV; fake IMS and fake Bynder as throwaway Node servers; the pop-up flow runs for real in Chromium |
| W2 | Same worker in the real workers runtime over HTTP | reused from #2 | Smoke tier | `wrangler dev` local, no Cloudflare login |
| S3 | Repo convention check | reused from #1/#2, extended | CI lint job | Filesystem fixtures in a temp dir |

The real EW boundary (real Adobe IMS login, real Bynder portal, real library iframe, real editor insertion) is covered only by numbered manual verification steps.

**Modules tested:** OAuth begin/callback and sealing, token store and encryption, refresh orchestration, Bynder provider (mapping, rendition and alt-text logic), provider registry and conformance suite, browse API (validation, pagination, error mapping), browser picker (connect, search, filter, detail, insert, states), insertion builder, convention-check additions.

**Prior art:**
- `shared/worker-template/SPEC.md` (#2) test kit and UA/UC/UP/US IDs, which this spec extends rather than repeats (UA/UC/UP/US tests apply to this worker automatically through the template).
- `apps/hello-world/SPEC.md` (#1) SDK stub, S1/S2 patterns, HP1-HP6 worker-call tests.
- Upstream `adobe-rnd/ew-extensions` has no worker, no OAuth and no DAM picker (tree checked via GitHub API 2026-11-16: only `blocks/skills`, `tools/{block-editor,brand-visibility,ew-setup}`), so there is no upstream prior art for this ticket beyond injection-style tests (`session-auth.js`). The closest external prior art is Contentful's Bynder app (UCV-based) and Adobe's own AEM Assets picker in da-live (`blocks/canvas/ew-panel-extensions/aem-assets.js`, which uses Adobe's asset selector and the user's IMS token directly rather than a worker).

## Out of Scope

- Cloudinary, Frontify, Dropbox providers (tickets #23, #24, #25). Only the interface, the contract suite and the stub provider in tests are built here.
- Upload to Bynder, asset-usage tracking back to Bynder (Contentful's app syncs usage; here it is a possible follow-up), editing metadata, collections browsing, metaproperty/tag/smartfilter facets, multi-select, saved searches.
- Dynamic Asset Transformations (custom crop/resize URLs), adaptive video streaming embeds, video players. Videos and documents are inserted as plain links.
- A shared-service-account (client-credentials) mode, org-wide connections, SCIM/admin provisioning.
- More than one Bynder portal per site.
- CI-driven deployment, custom worker domain, Durable Objects (documented as an upgrade path), per-user quota enforcement.
- Bynder's Universal Compact View and the Bynder MCP server.
- AEM Assets (first-party), the EW trust-prompt flow, marketplace publishing, i18n of the UI, offline use.
- The Adobe outside-activity/IP policy decision and data-protection review for storing third-party OAuth tokens (flagged, owned by #1 R1).

## Further Notes

- **Docs say nothing about third-party pickers or OAuth in EW.** The official EW developer doc cited by the ticket (https://www.aem.live/docs/ew/developing/apps-plugins) documents the SDK, `sendText`, `sendHTML`, `closeLibrary` and the config rows; nothing on backends, OAuth pop-ups or DAMs [VERIFIED 2026-11-16, read in full]. All design here derives from the SDK/library source and vendor docs.
- **Library iframe and pop-ups.** In the two da-live code paths that create plugin iframes (`ew-panel-extensions.js` inline panel, `helpers.js` `loadModal`), the iframe is created with `allow="clipboard-write *"` and **no `sandbox` attribute** (grep for `sandbox` finds nothing) [VERIFIED 2026-11-16]. So `window.open` from the plugin is not blocked by a sandbox; it is still subject to browser pop-up rules (needs a user click), which is why the connect click opens the pop-up synchronously and a visible fallback link exists.
- **Bynder portal prerequisites an agent cannot satisfy.** OAuth Apps must be enabled for the portal by Bynder Customer Support, and the registering admin needs "Manage portal settings" plus "Manage OAuth apps" permissions; the client secret is shown once (https://support.bynder.com/hc/en-us/articles/360013875180-How-To-Create-And-Manage-OAuth-2-0-Apps-to-Provide-Access-to-Bynder-API). Whether a free developer/sandbox portal exists could not be established from public docs [OPEN: Question 1]. Until one exists, real-Bynder verification is blocked and the fake-Bynder tier is the only automated proof.
- **Embedded-URL longevity.** Public rendition URLs end up in the document. Bynder says a public URL stops working when the asset is deleted (after CDN cache expiry, default 24 h on its CloudFront CDN) and can be configured to stop working on archive/limit (public-assets article above). That is a content-lifecycle fact worth one sentence in the README: pickers insert references, not copies.
- **EDS and external images.** Whether Edge Delivery Services keeps an external `<img src>` in a DA document as-is on publish (rather than importing it to the media bus) was not verified [ASSUMPTION it is kept]; checked in manual step M6.
- **Template is not built yet.** `shared/worker-template/` currently holds only its SPEC.md. Everything here that says "the template provides" presumes #2 has landed with the contract in its spec plus gaps G1-G4.

---

# Build Analysis

## 1. Architecture and responsibilities

```
EW editor (da.live)                                         Bynder portal  https://{portal}/
 └─ library iframe: apps/multi-dam-picker (static, public)     ▲  ▲
      │ SDK handshake -> { token (IMS), context, actions }     │  │ OAuth authorize / token / API (Bearer = the author's own token)
      │ fetch(worker, Authorization: Bearer <IMS>)             │  │
      ▼                                                        │  │
 Cloudflare Worker (apps/multi-dam-picker/worker, core from shared/worker-template)
   1 origin gate -> 2 IMS token check -> 3 router -> 4 shell routes -> 5 provider module -> 6 proxy(retries) ───┘
        │                                  └─ KV (encrypted token records), secrets (client secret, enc/sealing keys)
        └─ public, sealed routes: GET /oauth/bynder/begin, GET /oauth/bynder/callback   <-- reached by top-level navigation in a pop-up
```

| Concern | Browser extension (static, public) | Worker (private runtime) |
|---|---|---|
| Bynder client secret, refresh/access tokens | never | only place (secret store, encrypted KV) |
| Author identity | gets IMS token from the SDK and sends it | verifies it; derives `userId` for every connection |
| OAuth dance | opens pop-up, polls `session` | builds authorize URL, seals state/ticket, sets binding cookie, exchanges code, stores tokens |
| Bynder API calls | none (CORS and credentials make it impossible by design) | all, via the template `proxy` with the user's bearer token |
| Search/filter/pagination UI, selection, rendition & alt-text editing | all | maps filters to Bynder queries, normalises results |
| Insertion into the document | all (`sendHTML`, `closeLibrary`) | none |
| Provider knowledge | generic; driven by `providers` list and capability flags | provider modules (Bynder first) |

## 2. EW integration points

- **Library plugin vs app:** library plugin. The `library` config tab row (per the #1 spec section 2.5 and https://www.aem.live/docs/ew/administering/set-up-library for the columns):

  | `title` | `path` | `format` | `ref` | `icon` | `experience` |
  |---|---|---|---|---|---|
  | `Multi-DAM Picker` | `/apps/multi-dam-picker/multi-dam-picker.html` | (blank) | (blank for main; a branch name for branch testing) | (optional) | `fullsize-dialog` (recommended, [OPEN]) or blank (`inline`) |

  Behaviours from source (https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/helpers.js, per #1): `path` starting with `/` resolves to `http://localhost:3000{path}` when the editor URL has `?ref=local`, else to `https://{branch}--{site}--{org}.aem.live{path}`; the `ref` column filters; `experience` defaults to `inline`. Do not use a reserved library title (`blocks`, `templates`, `icons`, `placeholders`, `aem-assets*`). The plugin title becomes the identifier (lower-cased, spaces to hyphens), so `Multi-DAM Picker` -> `multi-dam-picker`.
- **SDK actions used:** `actions.sendHTML(html)` (insert an `<img>` or `<a>`), `actions.closeLibrary()`; `token` (IMS, as the worker bearer); `context` (not required; shown nowhere). No `daFetch`.
- **Pop-up for OAuth:** `window.open` from the plugin iframe; no sandbox attribute on the host iframe (see Further Notes).
- **`ref=local`:** page at `http://localhost:3000` (#1 server) + local worker at `http://localhost:8787` (wrangler dev) + local KV (wrangler simulates it) [ASSUMPTION: local KV persists in wrangler's local state, https://developers.cloudflare.com/workers/development-testing/]. The Bynder OAuth app must allow the local callback URL `http://localhost:8787/oauth/bynder/callback` as a redirect URI [OPEN: Question 8].
- **Branch ref / main:** pages on `*.aem.live` (or `*.preview.da.live`) call the *deployed* worker (`workers.dev` URL, constant in the extension). The deployed callback URL is the only other redirect URI.
- **Site config read:** none beyond the library row. State this explicitly in the README (AC4).

## 3. External APIs and auth flows

All Bynder endpoints are on the portal host (`https://{portal-domain}`). Primary sources: Bynder API reference (https://api.bynder.com/llms.txt is the index), new developer portal https://developers.bynder.com.

| API | Use | Auth | Source / status |
|---|---|---|---|
| `GET /v6/authentication/oauth2/auth` | start the authorization-code grant; params `client_id`, `scope`, `redirect_uri`, `response_type=code`, optional `state`; 302 to the portal login | none (user logs in) | [VERIFIED] https://api.bynder.com/reference/get_v6-authentication-oauth2-auth |
| `POST /v6/authentication/oauth2/token` (`grant_type=authorization_code`) | exchange `code` (+ `redirect_uri` that must equal the authorize request) for `access_token`, `refresh_token` (with `offline`), `expires_in`, `scope` | client id/secret "either in the body or by sending the Authorization header"; form-encoded | [VERIFIED] https://api.bynder.com/reference/post_v6-authentication-oauth2-token-authorization |
| same endpoint (`grant_type=refresh_token`) | new access token; response may include a new `refresh_token` | same | [VERIFIED] https://developers.bynder.com/apis/o-auth-20-1/docs (OpenAPI for refresh) |
| `GET /v6/authentication/oauth2/scopes` | what scope needs what user permission | none | [VERIFIED listed]; used only in docs/diagnostics |
| `GET /api/v4/media/` | search/list assets. Params used: `keyword`, `type` (`image`, `document`, `audio`, `video`, `3d`), `orderBy` (e.g. `dateModified desc`, `name asc`), `limit` (default 50, max 1000), `page` (`page*limit` must be <= 100,000, else 400 `RESULT_WINDOW_TOO_LARGE`), `total=1`, `includeMediaItems`. Response fields documented: `id`, `name`, `description`, `copyright`, `type`, `extension`, `width`, `height`, `fileSize`, `orientation`, `tags`, `propertyOptions`, `property_<name>`, `isPublic`, `limited`, `archive`, `watermarked`, `thumbnails{mini,thul,webimage}`, `original` (public assets only), `mediaItems[{name,type,publicUrl}]`, `transformBaseUrl`, `videoPreviewURLs`, `dateModified`; cursor pagination via `X-Bynder-NextCursor` | Bearer, scope `asset:read` | [VERIFIED] https://api.bynder.com/reference/get_api-v4-media ; scope map https://api.bynder.com/docs/getting-started |
| `GET /api/v4/media/{id}/` | asset detail (`versions`, `stats` optional) | Bearer | [VERIFIED] https://api.bynder.com/reference/get_api-v4-media-id |
| `GET /api/v4/account/derivatives` | names/dimensions of derivatives and which are public | Bearer | [VERIFIED endpoint exists]; scope required not documented [OPEN]; optional enrichment, v1 does not depend on it |
| `GET /api/v4/currentUser/` | account display name for "Connected as ..." | Bearer, `current.user:read` | [VERIFIED] https://api.bynder.com/reference/get_api-v4-currentuser |
| `GET /api/v4/media/{id}/download` | temporary S3 download URL | Bearer, needs the MEDIAHIGHRES role | **not used**: a temporary URL must not be embedded in content [VERIFIED temporary: https://api.bynder.com/reference/get_api-v4-media-id-download] |
| Refresh-token revocation by the app | disconnect cannot revoke upstream | n/a | No public per-token revoke endpoint found; admins can revoke all refresh tokens of an OAuth app in portal settings [VERIFIED: support article] [OPEN: Question 9] |

Limits: 4,500 requests per 5 minutes per IP, 5-minute block on excess [VERIFIED: https://developers.bynder.com/integrate]. IDs on `/api/v4` use the 8-4-4-16 "ColdFusion" hex format (same page); the worker validates asset ids against that pattern before building a URL.

**Auth flow (author to worker):** SDK token -> `Authorization: Bearer` -> #2 verification -> `identity.userId`.

**Auth flow (Bynder connection), numbered:**
1. Extension `POST connect` (Bearer) -> worker returns `{ beginUrl }` containing a ~60 s ticket sealed to (userId, provider).
2. Click handler opens a blank pop-up *synchronously*, then sets its location to `beginUrl`.
3. `GET begin?ticket=` (public): verify ticket; generate nonce; `Set-Cookie` binding cookie (HttpOnly, SameSite=Lax, Secure except in the local env, path-scoped, max-age <= 10 min); 302 to Bynder authorize with `state = seal({user, provider, sha256(nonce), exp})`, `redirect_uri` = configured callback.
4. User logs into Bynder (possibly SSO), consents to the listed scopes.
5. Bynder 302 -> `GET callback?code&state` (public): unseal state, check expiry, compare `sha256(cookie nonce)`; exchange code (client secret from the secret store); fetch current user; store encrypted record; return the static result page; clear the binding cookie.
6. The extension's polling `GET session` (Bearer) flips to `connected`; the grid loads.

**Auth flow (per call):** read record by hash(userId, provider) -> decrypt -> refresh if needed (single-flight) -> outbound call with `Authorization: Bearer <user's Bynder access token>` (never the IMS token; never forwarded back) -> normalise -> respond.

## 4. Data contracts

Behaviour contracts, not code. Shapes shown as tables because they are the AC3 interface.

**Worker API (all `Authorization: Bearer <IMS>` unless noted; JSON; CORS and errors per #2):**

| Method + path | Purpose | Success | Notable errors |
|---|---|---|---|
| `GET /dam/providers` | configured providers, each with connection state and capabilities | `200 { providers: [{ id, label, connected, capabilities }] }` | |
| `POST /dam/{provider}/connect` | issue the begin URL | `200 { beginUrl }` | `404 provider_not_configured` |
| `GET /dam/{provider}/session` | connection state | `200 { connected, account? : { displayName } }` | |
| `POST /dam/{provider}/disconnect` | delete the stored connection (idempotent) | `204` | |
| `GET /dam/{provider}/assets?q&type&sort&page&pageSize` | search | `200 { items, page, pageSize, total?, hasMore }` | `409 provider_not_connected`, `409 provider_reauth_required`, `400 bad_request`, `429 rate_limited` (+ `Retry-After`), `502 upstream_unavailable` |
| `GET /dam/{provider}/assets/{id}` | detail with renditions and alt candidate | `200 { asset }` | as above plus `404 not_found` |
| `GET /oauth/{provider}/begin?ticket` | **public, sealed ticket**; sets cookie, 302 to the DAM | `302` | `400` generic page |
| `GET /oauth/{provider}/callback?code&state` | **public, sealed state + cookie**; static result page | `200` HTML | `400`/`200` generic failure page (no input echo) |

**Normalised asset summary** (search items): `id`, `provider`, `name`, `type` (`image`, `video`, `document`, `audio`, `other`), `thumbnailUrl` (https), `width?`, `height?`, `extension?`, `fileSize?`, `dateModified?`, `warnings[]` (`limited-use`, `archived`, `watermarked`).
**Normalised asset detail:** the summary plus `description?`, `tags[]`, `copyright?`, `alt { value, source: property|description|name|none }`, `renditions[] { id, label, url, kind: derivative|original, width?, height? }`, `defaultRenditionId?`, `insertable { ok, reason? }`, `linkUrl?` (non-image public URL).
**Provider capabilities:** `assetTypes[]`, `sorts[]`, `paging: page|cursor`.
**Error contract:** the #2 shape `{ error: { code, message, requestId } }` with extra codes `provider_not_configured` (404), `provider_not_connected` (409), `provider_reauth_required` (409). [OPEN: Question 2/G4 whether #2 allows extension-defined codes.] Messages are fixed strings; no upstream text.

**Stored connection record (encrypted):** `{ v, accessToken, accessExpiresAt, refreshToken, scope, account: { displayName }, connectedAt }`; KV key = `conn:v1:` + hash(userId, provider); AES-256-GCM, fresh random IV per write, key id in the envelope, authenticated data = the KV key.

**Worker configuration.**

| Name | Kind | Meaning |
|---|---|---|
| `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS` | var (from #2) | origin gate and IMS verification |
| `PUBLIC_WORKER_ORIGIN` | var | base of redirect URIs and `beginUrl`; never from `Host` |
| `BYNDER_PORTAL_DOMAIN` | var | portal host; also the outbound allow-list |
| `BYNDER_CLIENT_ID` | var | public OAuth client id |
| `BYNDER_SCOPES` | var | default `offline asset:read current.user:read` |
| `BYNDER_ALT_PROPERTY` | var (optional) | name of the alt-text metaproperty |
| `BYNDER_DEFAULT_DERIVATIVE` | var (optional) | default `webimage` |
| `BYNDER_CLIENT_SECRET` | **secret** | OAuth client secret |
| `TOKEN_ENC_KEY` (+ optional `TOKEN_ENC_KEY_PREVIOUS`) | **secret** | encrypts stored records |
| `OAUTH_STATE_KEY` | **secret** | seals tickets and state |
| `DAM_TOKENS` | KV binding | token records |

A provider is "configured" when all of its vars/secrets are present; the list in `/dam/providers` is built from that.

## 5. Folder layout (proposed; fits #1/#2)

```
apps/multi-dam-picker/
├─ SPEC.md                      this file
├─ README.md                    setup, Bynder-side setup, config-sheet row, site config read (none), local dev, privacy, add-a-provider
├─ multi-dam-picker.html        entry page (SDK script tag + extension script)
├─ multi-dam-picker.js          bootstrap: await SDK, wire the render/logic modules
├─ picker/                      side-effect-free logic + render (state machine, api client, insertion builder)   <- S2 seam
├─ multi-dam-picker.css
├─ config.js                    constant worker origin(s): loopback on localhost, deployed origin otherwise (#2 Decision 13)
├─ test/unit/*.test.js          WTR tests (S2); test/e2e/*.spec.js Playwright (S1)
├─ worker/                      from shared/worker-template scaffold; extension worker entry
│   ├─ src/shell/               provider registry + interface checks, routes, OAuth begin/callback, sealing, token store, refresh
│   ├─ wrangler config, .dev.vars.example, README, test/ (W1 and P1 conformance suite)
│   └─ test/fixtures/           recorded provider responses (shared by conformance suite)
└─ providers/
    └─ bynder/                  vendor code (#1: providers/<vendor>/)
        └─ worker/              Bynder provider module (#2 Decision 3: providers/<vendor>/worker/), its fixtures, README section
```
Later DAMs add `providers/<vendor>/worker/` plus one registry line. [OPEN, carried from #2 Question 3: owner confirmation of the `providers/<vendor>/worker/` refinement.]

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **No Bynder sandbox/OAuth-enabled portal.** OAuth Apps need Customer Support enablement; no public self-serve developer portal found. Without it AC1/AC2/AC6 cannot be verified against real Bynder. | High, blocks manual verification | Owner action first; meanwhile the fake-Bynder tiers prove behaviour; fixtures must be sanitised from a real portal before #23-#25 rely on them [OPEN Q1] |
| R2 | **Template gaps G1-G4** (public routes, storage binding, dynamic redaction, HTML/extra error codes). | High for scheduling | Approve as #2 additions or carry a thin wrapper in this worker that reuses the template's exported auth/CORS/redaction/log helpers [OPEN Q2] |
| R3 | **OAuth callback is a public route.** Login-CSRF/account-linking, forged/replayed state, open redirect, reflected input. | High | Sealed ticket + sealed state + binding cookie, fixed redirect URI, no input echo, static no-script page; tests OA1-OA11, SC6 |
| R4 | **Token storage at rest and retention.** Third-party refresh tokens (non-expiring) tied to Adobe user ids in a personal Cloudflare account. | High (policy) | Encryption + key separation + purge command + disconnect; privacy note; owner decision on account (carries #2 Q1, #1 R1) [OPEN Q13] |
| R5 | **Refresh races** across isolates and KV eventual consistency (a write can take 60 s+ to be visible in other locations; https://developers.cloudflare.com/kv/concepts/how-kv-works/). If Bynder rotates refresh tokens, a lost race can invalidate the connection. | Medium | Single-flight in isolate; on `invalid_grant` re-read before deleting; reconnect is cheap; DO upgrade path; RF4/RF8 [OPEN Q9] |
| R6 | **Bynder rate limit shared by egress IP** (4,500/5 min, 5-min block). | Medium | Page size cap, debounce, 429 mapping with UI back-off; RD/BR6 [ASSUMPTION on IP sharing, OPEN Q11] |
| R7 | **KV Free-plan limits** (1,000 writes/day to different keys). Every hourly refresh is a write. | Low-Med | Fine for a pilot; Paid plan decision [OPEN Q3] |
| R8 | **Redirect URI registration**: whether `http://localhost:8787/...` and several URIs are allowed per Bynder OAuth app is undocumented; Bynder's own example uses `https://localhost/callback`. | Medium | Verify in R1 portal; fallback: tunnel/https local worker via `wrangler dev --local-protocol https` [ASSUMPTION flag exists] [OPEN Q8] |
| R9 | **PKCE/`state` semantics** not documented by Bynder beyond optional `state`. | Low | Confidential client (secret held server-side) + sealed state + cookie; no PKCE assumed |
| R10 | **Public-ness of renditions.** Only public/standard derivatives are safe to embed; limited-use/archived assets may stop resolving; DAT URLs need enablement. | Medium | Use only API-returned public URLs, warn on `limited`/`archive`/`watermarked`, never download URLs; M6 checks anonymously |
| R11 | **Editor schema behaviour** for `sendHTML('<img src alt>')` (kept attributes, wrapping, `style`; AEM Assets path uses `insertImage` with `width: 180px`, a different code path). | Medium | Manual M1 inspects the document source; fall back to `<p><img></p>` if needed |
| R12 | **External image URLs on publish** may be rewritten or dropped by EDS. | Medium | M6 publish round trip [ASSUMPTION kept] |
| R13 | **`fullsize-dialog` undocumented** and may change. | Low-Med | Layout works inline too; README documents both rows [OPEN Q5] |
| R14 | **IMS `user_id` stability** across shell/library tokens and token types (carries #2 R4). | Medium | M3 compares two tokens; tests key by `identity.userId` only |
| R15 | **Bynder API drift** (docs moved to a new portal in Nov 2026; link format migration `/m/` -> `/asset/`). | Low-Med | Fixtures + conformance suite; never parse URLs; changelog watch https://developers.bynder.com/changelog |
| R16 | **Metaproperty alt-text field shape** unknown (string vs array; naming). | Low-Med | Handle both; real fixture in R1 portal [OPEN Q7] |
| R17 | **Safari/Brave pop-up and cookie behaviour**, `localhost` cookies and Secure flag. | Low | Chrome-first like #1; fallback link; local env drops `Secure` only |
| R18 | **Workers CPU on Free plan** with AES-GCM + JWKS verify + JSON normalisation of 50 items. | Low | SM measure; Paid plan fallback |

## 7. Ordered build plan (sized to #22's acceptance criteria)

0. **Prerequisites (owner):** #1 and #2 landed; decisions on Open Questions 1-4 and 13; Bynder portal with OAuth Apps enabled and an OAuth app registered (redirect URIs for local and deployed worker); Cloudflare account with a KV namespace; test assets in Bynder (public image, private image, limited-use, archived, video, PDF). Without the portal, steps 1-11 still proceed against fakes.
1. **Template gaps G1-G4** landed in #2's template (or a thin wrapper agreed). Verify with the template's own tests plus one new test per gap.
2. **Test kit extensions** (the seam): in-memory KV, scripted fake Bynder server (authorize auto-approve, token, refresh, media, currentUser, thumbnails), fixture loader; stub second provider for the conformance suite. Self-check tests.
3. **Provider interface + registry + conformance suite (P1), test-first** (AC3): PC1-PC6 against a stub provider first.
4. **Sealing, token store, encryption, refresh orchestration, test-first** (AC2): TS*, RF*.
5. **OAuth begin/callback, test-first** (AC2, AC7): OA*, SC6.
6. **Bynder provider, test-first** (AC1): mapping, renditions, alt text (BR*, RD*, AT*), recorded fixtures sanitised from the real portal when available.
7. **Browse/detail API wiring** with validation and error mapping: BR*.
8. **Browser picker, test-first** (AC1, AC7 browser half): UI1-UI16 (connect, search, filter, detail, alt, insert, states, a11y).
9. **Entry page, CSS (inline + dialog layouts), config constant, README** (AC4); root README row (AC5).
10. **Playwright e2e** (E2E1-E2E9) with fake IMS, fake Bynder, real local worker; **runtime smoke** (SM-MD1-SM-MD3).
11. **Repo checks and CI** (AC8): RC1-RC5; add jobs/steps to #1/#2 workflow; no secrets in CI.
12. **Deploy worker, set secrets, create KV, register OAuth app redirect URIs, add library row; manual verification M0-M10** (AC5, AC6, AC7); record observed `Origin`, real alt-text field shape, rendition behaviour, EDS publish result in the PR and README.
13. **Hand-off note** for #23-#25 in the README ("add a provider" checklist: implement interface, add fixtures, add registry line, pass suite, add README section, add manual steps).

---

# Testing Requirements

Template-provided tests (UA authentication matrix, UC CORS matrix, UP proxy/retry matrix, US secret hygiene, UK kit self-check) run unchanged for this worker; the table IDs below are additional. ID prefixes: OA = OAuth, TS = token store, RF = refresh, BR = browse API, RD = renditions, AT = alt text, PC = provider contract, SC = security, UI = picker UI, E2E, SM = smoke, RC = repo check, M = manual.

## 1. Worker unit tests (seam W1; Node built-in runner)

Fixtures/mocks: #2 test kit; `fakeIms`/`signToken` for callers (tokens for users A and B); in-memory KV with write log and raw dump; `fakeBynder(script)` scripted server recording every request (method, path, query, headers, form body); recorded Bynder JSON fixtures (list, detail, currentUser, token, refresh; public image, private image, limited, archived, video, PDF, no-thumbnail, property-array and property-string variants); canaries for every secret (`BYNDER_CLIENT_SECRET`, `TOKEN_ENC_KEY`, `OAUTH_STATE_KEY`) and for the Bynder access/refresh tokens the fake issues; injected `now`, `sleep`, `random`.

### 1.1 OAuth (AC2, AC7)

| ID | Behaviour asserted |
|---|---|
| OA1 | `POST /dam/bynder/connect` without a token -> `401` (template); with a valid token -> `200 { beginUrl }` whose origin is `PUBLIC_WORKER_ORIGIN` (a spoofed `Host`/`X-Forwarded-Host` has no effect); response contains no secret or Bynder data |
| OA2 | `GET begin` with a valid ticket -> `302` to `https://{portal}/v6/authentication/oauth2/auth` with `client_id`, `response_type=code`, `scope`, `redirect_uri` equal to the configured callback, a `state`; `Set-Cookie` is HttpOnly, SameSite=Lax, path-scoped, Secure (except local env), max-age <= 600; the `Location` contains no client secret |
| OA3 | `begin` with an expired, tampered, truncated, other-provider, or wrong-key ticket -> `400` generic page, no cookie, no redirect |
| OA4 | Happy callback (valid state, matching cookie, code): fake Bynder receives exactly one token POST (`grant_type=authorization_code`, same `redirect_uri`, `code`, client authentication present) and one `currentUser` call; a record is stored for user A; response is the static `200` page; headers `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, restrictive CSP; body has no tokens, no input echo; binding cookie cleared |
| OA5 | **Login-CSRF:** state sealed for user A but no cookie, or a cookie from another flow -> rejected; zero token calls; nothing stored |
| OA6 | State expired (injected `now` +11 min), tampered, or sealed under a different key -> rejected; zero token calls; nothing stored |
| OA7 | `error=access_denied` (and any `error`) -> generic failure page; nothing stored; no token call; `error_description` is not reflected |
| OA8 | Token endpoint answers `400 invalid_grant`, `5xx`, or network failure -> generic failure page; nothing stored; upstream body not echoed; any existing record for the user is untouched |
| OA9 | Callback replay (same URL twice): second exchange fails upstream; the record from the first stays intact |
| OA10 | `<script>`/quotes in `code`, `state`, `error` are never present in any response body or header |
| OA11 | Public-route inventory: only `GET begin` and `GET callback` answer without `Authorization`; `POST` to them -> `405`; every `/dam/*` path without a token -> `401` (including unknown paths) |

### 1.2 Token store and isolation (AC2, AC7)

| ID | Behaviour asserted |
|---|---|
| TS1 | The raw KV dump (keys and values) contains none of: access token, refresh token, IMS user id, Bynder account name; values are `v`/key-id/iv/ciphertext envelopes |
| TS2 | A record copied to another user's key fails authenticated decryption -> treated as not connected, logged by outcome only, no exception to the caller |
| TS3 | Record written under the previous key is readable when `TOKEN_ENC_KEY_PREVIOUS` is set and is re-encrypted under the current key on next write; with neither key it reads as not connected |
| TS4 | User A connected; user B's `session` is `connected:false`; B's search -> `409 provider_not_connected`; B's request never causes a Bynder call with A's token |
| TS5 | `disconnect` deletes the record; repeat is `204`; subsequent search -> `409 provider_not_connected` |
| TS6 | Across a scenario matrix (connect, search, detail, refresh, every error) the Bynder tokens and the three secrets never appear in any response, header, `Location`, or log line (extends US1) |

### 1.3 Refresh (AC2)

| ID | Behaviour asserted |
|---|---|
| RF1 | Token with > 60 s remaining -> no refresh call |
| RF2 | Expired or < 60 s remaining -> exactly one refresh call (`grant_type=refresh_token`), record updated, the search carries the new token |
| RF3 | Refresh response without `refresh_token` keeps the old one; with a new one replaces it |
| RF4 | Two concurrent requests, expired token -> one refresh call (single-flight) |
| RF5 | Upstream `401` on search with a nominally valid token -> one forced refresh and one retry; a second `401` -> `409 provider_reauth_required` and the record is deleted |
| RF6 | Refresh `invalid_grant` -> record deleted, `409 provider_reauth_required`, no retry loop |
| RF7 | Refresh `5xx`/network failure -> retried per the template proxy, exhausted -> `502`; the record is **kept** |
| RF8 | Refresh fails `invalid_grant` but storage now holds a newer record (simulated other isolate) -> newer record used, not deleted |

### 1.4 Browse and renditions (AC1)

| ID | Behaviour asserted |
|---|---|
| BR1 | `q` -> `keyword`, `type` -> `type`, `sort` -> `orderBy` (allow-listed), `page`/`pageSize` -> `page`/`limit`, `total=1`; outbound `Authorization: Bearer <user's Bynder token>`, never the IMS token; no inbound `Authorization` forwarded; host is the portal only |
| BR2 | Unknown `type`/`sort`, non-numeric or negative paging, oversize `q` -> `400 bad_request`, zero upstream calls; `pageSize` capped at 50 |
| BR3 | Items are normalised from the recorded fixture: id, name, type mapping, `thumbnailUrl`, dimensions, extension, warnings; unlisted upstream fields never appear in the response |
| BR4 | `page * pageSize > 100000` -> clean `400` (not passed upstream); `hasMore` correct from `total`; empty result -> `200` with empty items |
| BR5 | Upstream `429` -> `429 rate_limited` with `Retry-After` (not retried beyond the template cap); `5xx` -> `502 upstream_unavailable`; `403` -> a forbidden mapping; no upstream body text |
| BR6 | Asset id must match the Bynder id pattern; `..`, `%2f`, extra segments, wrong format -> `400`, zero upstream calls |
| BR7 | Special characters in `q` (`&`, `#`, `+`, unicode) arrive upstream correctly encoded and cannot add parameters |
| BR8 | Archived assets are excluded from results [verification of the exact Bynder parameter against a real portal, OPEN] |
| RD1 | Detail: default rendition is `webimage` (or `BYNDER_DEFAULT_DERIVATIVE` when present); `original` offered only when `isPublic` and the field is returned |
| RD2 | Only `https:` URLs survive; `http:`, `javascript:`, empty -> dropped; a rendition list that ends empty -> `insertable:false` with a reason |
| RD3 | `mediaItems` entries with `publicUrl` become named renditions; entries without are dropped |
| RD4 | `limited`, `archive`, `watermarked` -> `warnings`; asset remains listed |
| RD5 | URLs are opaque: a fixture with `idHash` but no URL never yields a synthesised URL |
| RD6 | Non-image with a public URL -> `linkUrl` and `insertable:true`; non-image without one -> `insertable:false` with reason |
| AT1 | Alt metaproperty configured and present (string or array) -> `source: property` |
| AT2 | Property absent -> `description`; AT3: both absent -> filename without extension, separators to spaces (`Hero_Banner-2024.jpg` -> `Hero Banner 2024`) |
| AT4 | HTML tags, entities, control characters stripped to plain text; whitespace collapsed |
| AT5 | Nothing usable -> `alt` empty, `source: none` |

### 1.5 Provider contract (AC3; seam P1)

Run once per registered provider (Bynder, plus a stub provider in the test registry):

| ID | Behaviour asserted |
|---|---|
| PC1 | A provider missing any required member fails registration at worker start with a clear error (fail fast); a complete one registers |
| PC2 | `search` output validates against the normalised-summary schema (required keys, no extra keys, https URLs, type enum) |
| PC3 | `getAsset` output validates against the normalised-detail schema (renditions, alt with source, insertable, warnings) |
| PC4 | `buildAuthorizeUrl` returns the supplied `state` and `redirect_uri` verbatim; no auth method logs or returns a secret |
| PC5 | **Add-a-module proof:** registering the stub provider with *no change to shell code* makes it appear in `/dam/providers`, routable under its own id, with its own isolated token namespace (a Bynder record is invisible to it) |
| PC6 | Missing required config/secret -> provider omitted from the list; its routes `404 provider_not_configured`; the worker still starts and other providers work |

### 1.6 Security (AC7)

| ID | Behaviour asserted |
|---|---|
| SC1 | The `userId` for every connection operation comes from the verified identity only; `userId`/`user` in query, headers or body is ignored (spoof attempt returns the caller's own data) |
| SC2 | `{provider}` path segment validated against the registry (`__proto__`, `constructor`, encoded variants -> `404`) |
| SC3 | Log lines: provider id, outcome, upstream status, retry count only; never tokens, `code`, `state`, cookie values, `Authorization` |
| SC4 | Callback result page has no script, no inline event handlers, the documented headers, and the same body for every failure cause (no oracle) |
| SC5 | Disallowed `Origin` with a valid token on `/dam/*` -> `403` (template UC7, re-asserted on these routes); `begin`/`callback` are top-level navigations and are not CORS endpoints (no `Access-Control-Allow-Origin` on them) |

## 2. Browser unit tests (seam S2; `@web/test-runner`, injected `fetch` standing in for the worker)

Fixtures: #1 SDK stub with `sendHTML`/`closeLibrary` recorded; worker-API fake returning the normalised contracts; spy `window.open` returning a fake pop-up with a `closed` flag; fake timers.

| ID | Behaviour asserted |
|---|---|
| UI1 | Page awaits the SDK; fetches the provider list with `Authorization: Bearer <sdk token>`; not-connected state shows "Connect to Bynder"; the token never appears in DOM or console |
| UI2 | Connect: `window.open` is called **within the click handler before any `await`**; the pop-up is navigated to `beginUrl`; `session` is polled until `connected`, then the grid loads; pop-up closed without connection -> message with retry; overall timeout -> message |
| UI3 | `window.open` returns `null` (blocked) -> visible instruction and a real link fallback; no exception |
| UI4 | Typing debounces (single request after the pause); Enter searches immediately; empty query lists by most recently modified |
| UI5 | Changing the type filter resets to page 1 and sends `type` |
| UI6 | Out-of-order responses: the response for the latest query always wins (earlier request is aborted/ignored) |
| UI7 | "Load more" appends the next page, no duplicates, disappears when `hasMore` is false |
| UI8 | States: loading, empty, generic error with retry, rate-limited message with the `Retry-After` honoured (search disabled until then), `provider_reauth_required` -> "Reconnect" prompt, `provider_not_connected` -> connect prompt |
| UI9 | Select asset -> detail fetched; rendition selector defaults to `defaultRenditionId`; alt prefilled with its source label; editable; "decorative" sets alt to empty and disables the field; limited/archived/watermarked warning visible |
| UI10 | Insert image: `sendHTML` called once with HTML that parses to exactly one `<img>` whose `src` equals the selected rendition URL and `alt` equals the field; then `closeLibrary` once, **in that order**; alt text containing `"><script>` stays attribute text (no extra elements) |
| UI11 | Non-image with `linkUrl` -> one `<a href>` with the asset name as text; `insertable:false` -> Insert disabled with the reason shown |
| UI12 | Every worker call carries the bearer token; no call and disabled UI when the SDK never resolves (standalone message); `?worker=https://evil.example` ignored (origin constant; loopback on `localhost`, deployed origin elsewhere) |
| UI13 | A worker-supplied non-`https:` URL is neither rendered as an image nor insertable |
| UI14 | Grid items are buttons with accessible names; search and filter labelled; focus moves to the detail pane on select and back on close |
| UI15 | Disconnect calls `POST disconnect` then shows the Connect state |
| UI16 | One provider -> no switcher; two (stub) -> switcher; type-filter options come from `capabilities.assetTypes` |

## 3. End-to-end tests (S1; Playwright, Chromium, hermetic, no credentials)

Servers started by Playwright config/global setup: static server `:3000`; real worker under `wrangler dev` `:8787` with local KV, `ALLOW_LOCALHOST=true`, test secrets from a temp env file; fake IMS key server; fake Bynder (login page auto-approves and redirects to the worker callback; token/refresh/media/currentUser; serves a 1x1 PNG for thumbnails; request log exposed to the test). The #1 SDK stub supplies a token signed by the fake IMS key.

| ID | Behaviour asserted |
|---|---|
| E2E1 | Full pop-up OAuth: not connected -> Connect -> real pop-up -> fake Bynder login -> worker callback page -> the panel detects the connection and shows results |
| E2E2 | Search and type filter: the fake Bynder request log shows the expected `keyword`, `type`, `orderBy`, `limit`/`page`; thumbnails render |
| E2E3 | Select -> change rendition -> edit alt -> Insert: stub call log is `sendHTML` (exact `<img src alt>`) then `closeLibrary` |
| E2E4 | Token hygiene: page HTML, DOM text, `localStorage`/`sessionStorage`, cookies visible to script, and all network responses contain none of the Bynder access/refresh tokens or the client secret; the binding cookie is HttpOnly |
| E2E5 | Silent refresh: fake Bynder issues a 2-second access token; a search after 3 s triggers a refresh call and succeeds with no UI prompt |
| E2E6 | Revoked connection: fake returns `invalid_grant` on refresh -> UI shows "Reconnect" |
| E2E7 | Auth: direct `fetch` to `/dam/bynder/assets` with no token -> `401` (page can read it: CORS headers); with a token signed by another key -> `401`; `?worker=` ignored |
| E2E8 | Per-user: identities A and B (two tokens): after A connects, B shows the Connect state |
| E2E9 | Only expected hosts contacted (page, worker, SDK stub, fake Bynder, fake IMS) |

## 4. Runtime smoke (W2; Node test driving `wrangler dev`, no Cloudflare login)

| ID | Behaviour asserted |
|---|---|
| SM-MD1 | The worker with the KV binding bundles and starts; bare `/dam/providers` -> `401` (liveness) |
| SM-MD2 | `begin` over real HTTP: `302` with the cookie attributes of OA2; `crypto.subtle` AES-GCM/HMAC seal/unseal works in workerd |
| SM-MD3 | Callback end-to-end against the fake Bynder in workerd; KV record present and encrypted; refresh in the real runtime; CPU/wall time per request recorded (informational, R18) |

## 5. Repo checks (S3, extended)

| ID | Behaviour asserted |
|---|---|
| RC1 | Vendor names (`bynder`, and later `cloudinary`, `frontify`, `dropbox`) do not appear in shell/browser/core code outside `providers/<vendor>/`, tests, fixtures, docs, and the single registry line; a fixture tree with a leak fails (**machine proof of AC3**) |
| RC2 | Every `providers/<vendor>/` has a worker module, fixtures, a conformance-suite registration and a README section; missing any fails |
| RC3 | Root README extensions table has the `multi-dam-picker` row (name, folder, entry point, type `library plugin`, description) and the type matches the `library` registration row documented in the extension README (existing S3 rules) |
| RC4 | This worker's wrangler config declares `BYNDER_CLIENT_SECRET`, `TOKEN_ENC_KEY`, `OAUTH_STATE_KEY` under `secrets.required`, has the KV binding, has no secret-looking `vars`; every required secret is in `.dev.vars.example`; no tracked `.dev.vars*` (extends UR1-UR5) |
| RC5 | The extension README contains the required sections (setup, Bynder-side setup, `library` row, site config read, local dev, privacy/retention, add-a-provider checklist) |

## 6. Manual end-to-end verification in EW (needs interactive logins; cannot run in CI)

**Accounts and credentials needed:** GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, per #1); two Adobe IMS identities with access to the DA org/site (one with config-edit rights) and Chrome; a **Bynder portal with OAuth Apps enabled** (Customer Support) and a Bynder admin to register an OAuth app (scopes `offline asset:read current.user:read`; redirect URIs: deployed callback and, if permitted, the local callback) and to enable public derivatives; two Bynder users (different permission profiles); test assets: public image, non-public image, limited-use asset, archived asset, video, PDF; custom public derivative; an alt-text metaproperty with a value on at least one asset; Cloudflare account with Wrangler login, a KV namespace, and the three worker secrets (a throwaway `OAUTH_STATE_KEY`/`TOKEN_ENC_KEY` from a random generator). Never paste IMS or Bynder tokens or the client secret into chat, issues or logs.

- **M0 (prereq/liveness):** `wrangler deploy`; `curl -i <worker>/dam/providers` -> `401`; secrets listed by name only (`wrangler secret list`); KV namespace bound. Add the `library` row. Proves AC7 (unauthenticated rejected on the deployed worker).
- **M1 (`ref=local`):** terminal A `npm start` (3000), terminal B worker dev (8787). Open a document in the EW editor with `?ref=local`; open the library: **Multi-DAM Picker** present. Connect -> Bynder login/consent (scopes listed) -> pop-up reports success -> panel shows "Connected as <you>" and recent assets. Search a known keyword; filter type to Images; open an asset; confirm the default `webimage` rendition, alt prefill and its source; insert. Inspect the document source: one `<img>` with the chosen `src` and the alt; library closes. Proves AC1, AC2, AC5, AC6 (local).
- **M2 (branch ref):** push `multi-dam-picker-bynder` (simple name), wait for code sync, set a library row `ref` to that branch (or use main row), open the editor with `?ref=<branch>`; repeat M1 against the deployed worker. Record the page's real `Origin` and any CORS or local-network prompts (resolves #2 R2/R11 for this worker). Proves AC6 (branch ref).
- **M3 (per-user and identity):** second Adobe user connects with the second Bynder user and sees only what that Bynder user may see; first user's connection unaffected; confirm the IMS user id is stable across two sessions/tokens (Open Question 14); Disconnect then Reconnect. Proves AC2 (per-user), AC7 (isolation).
- **M4 (refresh and revocation):** wait > 1 h (or shorten via a test portal setting if available) and search again: silent success. In Bynder portal settings revoke the OAuth app's refresh tokens; search again: panel shows Reconnect, no error loop. Proves AC2 (stored and refreshed server-side).
- **M5 (secret hygiene):** search DevTools Network responses, page source and Application storage for the client secret and tokens (none; binding cookie HttpOnly); `wrangler kv key get` of a record shows ciphertext only; rotate `TOKEN_ENC_KEY` with `TOKEN_ENC_KEY_PREVIOUS` set and confirm no reconnect is needed. Proves AC7.
- **M6 (rendition and publish round trip):** preview and publish a page containing an inserted public rendition; open the published page in a private window (no Bynder/Adobe session): image loads. Insert a limited-use asset: warning shown. Record whether EDS kept the external URL, and what happens to a non-public asset (R10, R12). Proves "appropriate rendition URL".
- **M7 (negative checks on the deployed worker):** `Origin: https://evil.example` with a valid token -> `403`; no token -> `401`; `GET /oauth/bynder/callback?code=x&state=y` with no cookie -> generic failure, and no new KV record.
- **M8 (experience):** compare `experience = fullsize-dialog` and blank (`inline`); record which the owner prefers and whether `fullsize-dialog` behaves in the current EW build (Open Question 5).
- **M9 (reachability):** the plugin appears with the main-branch row (blank `ref`) for editors opening a document without `?ref`; root README extensions table row present and accurate. Proves AC5.
- **M10 (README walk-through):** a reviewer follows the extension README from a clean clone to a working local picker; any missing step is fixed in the PR. Proves AC4.

Record results and screenshots in the PR (the PR template asks for the branch-ref test URL).

## 7. CI additions (no credentials, no Cloudflare login)

| Job | Steps | Notes |
|---|---|---|
| `lint` (existing) | ESLint + Stylelint over the extension and worker; `npm run check` runs RC1-RC5 | |
| `unit` (existing) | WTR runs UI1-UI16 | |
| `worker-unit` (from #2) | Node tests: OA, TS, RF, BR/RD/AT, PC, SC plus the template's UA/UC/UP/US | one job; provider conformance suite included |
| `worker-smoke` (from #2) | SM-MD1-SM-MD3 | advisory vs required per #2 Open Question 11 |
| `e2e` (existing) | starts static server + worker + fake IMS + fake Bynder; E2E1-E2E9 | Chromium only; upload traces on failure |

All run on every push and PR (#1 decision). Branch protection requiring them is an owner repo-setting.

## 8. Acceptance-criteria traceability (ticket #22)

| # | Acceptance criterion (#22) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Author can browse and search the DAM, filter by type, and insert an image with an appropriate rendition URL and alt text from DAM metadata | BR1-BR8 (search/filter/paging mapping and validation), RD1-RD6 (rendition policy, public-only, https-only), AT1-AT5 (alt fallback chain); UI4-UI11 (search, filter, load more, detail, rendition choice, alt editing, `sendHTML` then `closeLibrary`); E2E2, E2E3 | **M1** (browse, search, filter, insert, inspect `<img>` and alt in the document), **M6** (rendition loads anonymously after publish) |
| AC2 | Per-user OAuth with the DAM goes through the worker; tokens are stored and refreshed server-side | OA1-OA10 (flow, state/cookie binding), TS1-TS6 (encrypted at rest, per-user isolation, no leakage), RF1-RF8 (proactive/reactive refresh, revocation, races); UI2, UI3; E2E1, E2E4-E2E6, E2E8; SM-MD2, SM-MD3 | **M1** (connect), **M3** (per-user), **M4** (refresh and revocation), **M5** (ciphertext in KV) |
| AC3 | Provider interface (auth, browse/search, rendition URL, metadata) is defined so later DAMs only add a module | PC1-PC6 (interface enforced, schema-validated outputs, stub provider added with zero shell change, isolation), RC1, RC2 (no vendor leakage, provider folder completeness); UI16 (capability-driven UI, switcher) | Review: README "add a provider" checklist exists and the contract table in the README matches this spec; #23-#25 as the real-world check |
| AC4 | All code in its own self-contained `multi-dam-picker` folder, with a README covering setup, the EW config-sheet row that enables it, and any site config it reads | RC3-RC5 (S3 convention: entry page, README, tests, required README sections, worker placement) | **M10** (clean-clone walk-through); review: README states the `library` row verbatim and states that no other site config is read |
| AC5 | Listed in the repo README extensions table and reachable from the editor library | RC3 (table row and type consistency) | **M0/M1** (plugin present in the library), **M9** (main-branch row, README table) |
| AC6 | Works in EW with `ref=local` and with a branch ref | E2E1-E2E9 prove the page + worker contract on `localhost:3000`/`localhost:8787` | **M1** (`ref=local`), **M2** (branch ref against the deployed worker, real `Origin`) |
| AC7 | Vendor credentials live only in this extension's worker (from the shared template); the browser never receives them; unauthenticated calls to the worker are rejected | OA11, SC1-SC5 and template UA1-UA14 (401 matrix, auth before routing), TS6/SC3 (no leakage), RC4 (secrets declared, none in vars/git); UI12 (worker origin constant, bearer on every call); E2E4, E2E7; SM-MD1 | **M0** (bare `curl` -> 401), **M5** (secret hygiene), **M7** (negative checks on the deployed worker) |
| AC8 | Core logic covered by unit tests; lint and CI green | All of sections 1, 2, 5 run in `worker-unit`, `unit`, `lint`; e2e and smoke jobs green | Review: CI shows all jobs green on the PR; deliberately break a rule on a scratch branch (e.g. let `begin` skip the cookie check) and see OA5 fail |

Every acceptance criterion on #22 maps to at least one automated test and one numbered manual or review step above. (AC3 and AC8 are largely machine-proved; AC4's README quality is irreducibly a human review.)

## 9. Open questions for the owner

1. **Bynder sandbox (R1).** Is there a Bynder portal with OAuth Apps enabled (Customer Support must enable them) and an admin who can register the app, enable public derivatives and load test assets? Who owns it? Is there a free developer/partner portal I could not find in public docs? Without it, real verification (AC1/AC2/AC6, manual M1-M7) is blocked and fixtures cannot be sanitised from a real portal.
2. **Template gaps G1-G4 (R2).** Approve extending #2's template with (G1) explicit public routes with a custom authenticator, (G2) an optional storage binding in the scaffold, (G3) per-request dynamic redaction values, (G4) HTML responses with custom headers and extension-defined error codes? Or should #22 carry a thin wrapper that reuses the template's exported helpers? This changes #2's Decision 4 ("no unauthenticated routes except preflight").
3. **Token storage (R5, R7).** Accept Workers KV (encrypted records, simplest) with Durable Objects as the upgrade path? Is the Paid plan acceptable (Free plan allows 1,000 writes/day to different keys)?
4. **Provider placement.** Confirm `apps/multi-dam-picker/providers/<vendor>/worker/` (carried from #2 Q3), and that the **browser shell is generic** (no per-provider browser code; a future DAM that needs custom UI would add a hook later).
5. **Plugin `experience`.** Recommend `fullsize-dialog` (seen in da-live source, undocumented) vs the documented default `inline`. Which should the README lead with? Can you ask the EW team whether `fullsize-dialog` is supported for third-party plugins?
6. **Non-image assets.** Insert videos/documents/audio as a link when a public URL exists (this spec) or restrict v1 to images only?
7. **Alt text policy and Bynder metadata.** Which Bynder metaproperty holds alt text in your target portal (so `BYNDER_ALT_PROPERTY` can be set)? Is the fallback chain (property, description, cleaned filename, then empty and flagged) acceptable, including pre-filling a filename-derived alt rather than leaving it empty?
8. **Redirect URIs and PKCE.** Does your Bynder OAuth app allow several redirect URIs and an `http://localhost:8787/...` one? (Bynder's docs show `https://localhost/callback` as an example only.) Does Bynder support PKCE? (Not documented; this design does not need it.)
9. **Refresh-token behaviour and revocation.** Does Bynder rotate refresh tokens on refresh? Is there a per-token revoke endpoint for "Disconnect" (none found; admins can revoke all tokens of an app)? Until answered, Disconnect only deletes our stored copy.
10. **External image URLs on publish (R12).** Do you know whether EDS keeps an external `<img src>` from a DA document untouched? M6 will observe it; tell me earlier if you know.
11. **Rate-limit exposure (R6).** Can you confirm whether Workers subrequests share egress IPs (Bynder limits per source IP: 4,500 per 5 min, then a 5-minute block)? If it matters in practice, is a per-user request limit in the worker wanted as a follow-up?
12. **One portal per deployment.** Is one Bynder portal per EW site (one worker deployment) enough, or do you need several portals per site (would need a portal selector and per-portal OAuth credentials)?
13. **Policy and privacy (R4).** Storing third-party OAuth refresh tokens linked to Adobe user ids in a Cloudflare account under a personal name raises the #1 R1 outside-activity/IP question and a data-protection question. Which Cloudflare account, and who signs off? Should the README ship a retention/deletion statement (purge command) before any real user data is stored?
14. **IMS `user_id` stability (R14).** Do you know whether the IMS `user_id` claim is identical for the shell token and the library token for the same person? M3 will check; otherwise connections would be per token type.
15. **Public vs limited-use/archived assets.** Warn only (this spec) or block insertion of limited-use/archived assets?
16. **Build vs embed (Decision 2).** This spec builds its own UI and rejects Bynder's Universal Compact View because UCV puts a Bynder token in the browser and is single-vendor. Confirm, or accept a UCV-based Bynder-only v1 that would not satisfy AC2/AC3 as written.
17. **Names.** Worker name (`ew-multi-dam-picker-worker`), KV namespace name, and the library row `title` (`Multi-DAM Picker`) are proposals; plus the `ORG`/`SITE` assumption (`jazhou-adobe`/`ew-extensions`, #1 R10).
