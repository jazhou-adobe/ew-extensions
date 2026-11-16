# Spec: Multi-DAM Picker: Frontify (provider)

Ticket: jazhou-adobe/ew-extensions#24 (this spec: #62). Blocked by #22 (Multi-DAM Picker shell + Bynder; spec in `apps/multi-dam-picker/SPEC.md`), which itself is blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). #24 blocks nothing. Sibling provider specs: #23 Cloudinary (`apps/multi-dam-picker/providers/cloudinary/SPEC.md`), #25 Dropbox.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1, #2, #22 specs): **[VERIFIED]** = read in a primary source (URL given) or observed on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Frontify/Cloudflare. Frontify's developer portal (`developer.frontify.com`) is a JavaScript single-page app that plain HTTP fetches cannot read; I rendered each cited page in a headless browser on 2026-11-16 and read the text, so "[VERIFIED]" for a developer-portal URL means "read in the rendered page". Where a fact came only from the third-party aggregator https://damwiki.com/solutions/frontify/api (which itself cites Frontify's pages) it is tagged **[SECONDARY]** and treated as unverified for decisions that carry risk.

Vocabulary follows #1, #2 and #22 exactly: *extension* = one folder `apps/<name>/` (this one is the **library plugin** `multi-dam-picker`); *worker* = the per-extension backend in `apps/multi-dam-picker/worker/` built from `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension; *shell*, *provider*, *connection*, *normalised asset* as defined in #22. Added here: *Frontify domain* = the customer's Frontify host (a `*.frontify.com` subdomain or a custom domain; every Frontify instance is separate and has its own domain) [VERIFIED: https://frontify.github.io/graphql-api-reference/llms.txt, "Endpoint: POST https://<your-domain>/graphql"; https://developer.frontify.com/document/68#/get-started/authentication-1, "each instance is separated"]; *library* = a Frontify **media/document/icon/logo library** (a container of assets; **not** the EW editor library, which this spec calls the *editor library*); *Frontify access token* = the per-user OAuth token the worker holds for one author; *preview URL* = the CDN URL Frontify's API returns for an asset's rendered preview.

---

## Problem Statement

The Multi-DAM Picker (#22) lets an EW author pick an asset from Bynder and insert it with a sensible rendition URL and alt text. Many customers keep their brand assets in **Frontify**, not Bynder. Today a Frontify user who wants a Frontify image on an EW page leaves EW, finds the asset in Frontify, opens its share dialog to find a CDN link, copies it, comes back, pastes it into the document, and retypes alt text that Frontify already stores on the asset. The pasted link is often the wrong size (a full-resolution preview where a 1,200 px image would do), nobody checks whether the asset is still within its availability window or carries a licence, and the alt text is usually skipped.

The tool should do for Frontify exactly what it does for Bynder: browse and search in the editor library, choose a rendition, use the asset's own alt text, insert. It must do so **per user** (Frontify's own permissions decide what each author sees), keep the Frontify OAuth client secret and each author's tokens **in the worker only**, and plug into the existing shell as **one new provider module**. Frontify is a useful second OAuth provider because its API differs from Bynder's in ways that stress the interface: GraphQL instead of REST, a per-customer domain, single-use rotating refresh tokens, a search scoped to one library, URL-parameter renditions on a CDN, and a native alt-text field.

## Solution

An author with a Frontify account opens the **Multi-DAM Picker** in the editor library, picks **Frontify** (the provider switcher appears automatically once a second provider is configured), clicks **Connect to Frontify** once, signs in to Frontify in a pop-up (Frontify's own login, including SSO) and consents to read access. From then on the author can browse the site's configured Frontify library, search by keyword, filter by type (images, videos, documents, audio), open an asset to see a larger preview and its details, choose a **rendition width** (480, 800, 1200, 1600, 2400 px, or the full-size preview, default 1200 px), review alt text **prefilled from Frontify's own alternative-text field** (editable, or marked decorative, honouring Frontify's own "decorative" flag), see a warning when an asset is outside its availability window or carries a licence, and insert it with one click. Images are inserted as an `<img>` with a Frontify CDN URL and the alt text; non-image assets that have a public preview URL are inserted as a link.

Behind it, the same per-extension worker as Bynder does everything sensitive: it runs the Frontify OAuth authorization-code flow, stores each user's tokens encrypted and keyed by the author's IMS identity, refreshes tokens (taking care of Frontify's **single-use refresh tokens**), proxies every Frontify GraphQL call, and revokes the token at Frontify when the author disconnects. The browser holds only the author's IMS token and normalised asset data.

The Frontify provider is **one module**: a worker-side provider folder with its fixtures and tests, one registry line, and a README section. No browser-shell change and no worker-core change are made by this ticket; any interface gap found is listed as a prerequisite for #22's stream (FG1-FG5 and the carried SG3-SG5 from #23) rather than hidden in this ticket's pull request.

## User Stories

Content author (EW end user):

1. As a content author, I want Frontify to appear as a source in the Multi-DAM Picker, so that I can use my company's Frontify assets without leaving EW.
2. As a content author, I want a clear "Connect to Frontify" button the first time, so that I know I must sign in before I can see assets.
3. As a content author, I want to sign in with my own Frontify account (including my company's SSO) in a pop-up, so that the picker shows only what Frontify allows me to see.
4. As a content author, I want the picker to remember my Frontify connection across sessions and browsers, so that I am not asked to sign in every time I open the library.
5. As a content author, I want to see which Frontify account I am connected as, so that I notice when I connected the wrong one.
6. As a content author, I want a "Disconnect" action that also revokes the access at Frontify, so that handing over my EW account does not leave a live Frontify token behind.
7. As a content author, I want a plain message and a "Reconnect" action when my Frontify authorisation was revoked or expired for good, so that I am never stuck on a cryptic error.
8. As a content author, I want to search the configured Frontify library by keyword (title, description, tags, metadata), so that I can find an asset by what I remember about it.
9. As a content author, I want search to run after a short pause in typing (and at once on Enter), so that I do not need a Search button and do not trigger a request per keystroke.
10. As a content author, I want to filter by asset type (all, images, videos, documents, audio), so that I only see assets I can use at my cursor.
11. As a content author, I want to see the newest assets when I have not searched yet, so that the panel is useful immediately after connecting.
12. As a content author, I want a thumbnail grid with the asset title, so that I recognise assets at a glance.
13. As a content author, I want a "Load more" action, so that the panel stays fast on a library with tens of thousands of assets.
14. As a content author, I want a stale search never to overwrite a newer one, so that the grid always matches what I typed last.
15. As a content author, I want to open an asset to see a larger preview, its title, dimensions, file type and size, so that I can confirm it is the right one.
16. As a content author, I want to choose how wide the inserted image is (480 to 2400 px, or the full-size preview), with a sensible default of 1200 px, so that I do not publish a multi-megabyte image on a web page.
17. As a content author, I want widths larger than the asset's own width not to be offered, so that I never insert an upscaled, blurry image.
18. As a content author, I want the alt text prefilled from the alternative text stored on the asset in Frontify, so that accessible markup is the default and I do not retype what the brand team already wrote.
19. As a content author, I want a sensible fallback (the asset's description, then its title) when Frontify has no alternative text, with a label telling me where the text came from, so that I know how much to trust it.
20. As a content author, I want an image that Frontify marks decorative to arrive with empty alt text and the decorative option already ticked, so that screen readers skip it.
21. As a content author, I want to edit the alt text or mark any image decorative before inserting, so that I can adapt it to the page.
22. As a content author, I want a visible warning when an asset is outside its availability window (not yet available or expired) or carries a licence in Frontify, so that I do not publish something I should not.
23. As a content author, I want assets that Frontify is still processing, or that are download-protected for me, shown as not insertable with a one-line reason, so that I never insert a broken or off-limits link.
24. As a content author, I want to insert the chosen rendition at my cursor with one click and the library to close afterwards, so that I can keep editing.
25. As a content author, I want videos, documents and audio that have a public preview URL inserted as a link with the asset title as text, so that non-image assets are not a dead end.
26. As a content author, I want an understandable message when Frontify is rate-limiting me, with how long to wait, so that I know whether to retry now or later.
27. As a content author, I want a clear message when the Frontify library the site is configured for is not accessible to my account, so that I know to ask for access rather than retry.
28. As a content author, I want the picker to work with the keyboard and a screen reader, so that the tool is usable by everyone on the team.
29. As a content author with both Bynder and Frontify configured, I want to switch between them in the picker, so that I can use either.

Site administrator / maintainer:

30. As a site admin, I want to enable Frontify with worker configuration only (domain, OAuth client id/secret, library id), so that no code change is needed for my instance.
31. As a site admin, I want the README to list every Frontify-side setting (OAuth client type, redirect URL, scope, library id, alt-text practice) and every worker setting, so that I can set it up without reading code.
32. As a site admin, I want the extension to request only read access (`basic:read`), so that consenting authors, and I, can see it cannot change anything in Frontify.
33. As the maintainer, I want the Frontify OAuth client secret and every author's tokens to exist only in the worker (secret store and encrypted storage), so that nothing sensitive is in the public site.
34. As the maintainer, I want every call to the worker to be rejected without a valid IMS token, so that the endpoint is not an open door to a Frontify instance.
35. As the maintainer, I want one author's Frontify connection to be unusable by any other author, so that Frontify permissions stay per person.
36. As the maintainer, I want Frontify's single-use refresh tokens handled so that two simultaneous requests can never destroy a connection, so that authors are not forced to reconnect for no reason.
37. As the maintainer, I want the Frontify domain to be validated as a bare host and to be the only outbound destination of the provider, so that a configuration slip cannot turn the worker into an open proxy.
38. As the maintainer, I want every Frontify GraphQL query to be a fixed document with all user input in variables, so that search text can never alter a query.
39. As the maintainer, I want the query documents validated against Frontify's published schema in CI, so that a mistyped or beta-only field is caught before it reaches a real instance.
40. As the maintainer, I want the whole flow tested hermetically in CI against a fake Frontify (including its single-use refresh behaviour), so that no Frontify credentials are needed on every push.
41. As the maintainer, I want the Frontify module to pass the shared provider conformance suite with zero shell changes, so that "add a provider = add a module" is machine-proved.
42. As the maintainer, I want CI lint and tests green on every push and PR, so that regressions do not merge.

Provider author (later tickets, and this one as a worked example):

43. As a provider author, I want the Frontify module to show how a GraphQL, per-tenant-domain, rotating-refresh-token provider fits the interface, so that I can copy the pattern.
44. As a provider author, I want every place where Frontify does not fit the interface exactly (callback parameter name, result window, warnings vocabulary, decorative flag) written down with a proposed additive fix, so that the shell owner can decide once.

## Implementation Decisions

(No file paths or code, except type tables where they carry a decision. Layout is in the Build Analysis.)

1. **A worker-side provider module only.** Frontify is implemented as one provider (identity, capabilities, auth half, browse half, metadata mapping) in its own provider folder, registered by one registry entry, per #22 Decision 10 and #2 Decision 3. There is **no browser code** for Frontify: the shell's UI is capability-driven (#22 UI16). This ticket's pull request touches only the Frontify provider folder, the single registry line, the extension README's Frontify section, and the example env file/wrangler config entries for this provider (the "registration footprint"). If the owner's answer to the gaps below requires shell edits, those are made in #22's stream first (see Decision 3).
2. **Build against #22's interface exactly; do not redesign the shell.** The provider implements the members #22 Decision 10 lists: identity and capabilities; build the authorize URL from (state, redirect URI); exchange an authorization code; refresh a token; read the connected account's display name; optional revoke; `search`; `getAsset`; the normalised asset with `alt`, `renditions`, `insertable`, `warnings`. (Member identifiers are not fixed in #22's spec; this spec uses those descriptive names and #22's build decides the exact names.)
3. **Interface gaps found by mapping Frontify onto #22 (FG1-FG5), plus the three gaps #23 raised that also apply (SG3, SG4, SG5).** Each is additive and none changes the shell's design. They are prerequisites to settle in #22's stream, not part of this ticket's pull request, so that #24's own PR touches only the provider folder plus the registration footprint (AC3). Each has a fallback that keeps AC3 true. [OPEN: Question 1.]
   - **FG1 (callback parameter name).** #22's callback route reads `code`. Frontify's OAuth page describes the redirect as carrying `authorization_code` and `state` in its worked example, while the standard is `code` [VERIFIED page text: https://developer.frontify.com/document/68#/get-started/authentication-1, "The URL contains 2 GET parameters: authorization_code and ... state"; the same page's token example names the field `code`]. Which one a live instance sends is not established. Proposal: the shell's callback accepts the code under either name (`code` or `authorization_code`) and passes the one it got to the provider; manual probe MF-P1 decides whether this is even needed. Fallback if Frontify sends standard `code`: no change.
   - **FG2 (rotating, single-use refresh tokens).** Frontify's refresh returns a **new access token and a new refresh token, invalidates the old access token, and a refresh token can be used only once** [VERIFIED: same page, "3 - Refresh Token": "New access token is returned and the original access token gets invalidated. Refresh token can be used only once."]. #22 Decision 9 already replaces the stored refresh token when one is returned, single-flights in one isolate, and re-reads storage before deleting on `invalid_grant` (RF8), which is exactly what a rotating-token provider needs. Required clarification: the shell treats a returned refresh token as always replacing the old one for Frontify (no "keep the old one" path), and the conformance suite gains a *rotating* scenario (FK6-FK7) so this behaviour is proven for Frontify, not assumed. Also: on a reactive `401` the shell must first re-read storage and retry with a newer record if one exists before forcing a refresh, because another isolate's refresh invalidates our access token and our refresh token. Fallback: Durable Objects (the #22 upgrade path) if races prove real; access tokens last a week or more (Decision 11), so refresh races are rare.
   - **FG3 (provider-defined result window).** #22's BR4 caps `page * pageSize` at Bynder's 100,000 window. Frontify caps a searched result set at **10,000 assets** [VERIFIED: https://developer.frontify.com/document/31#/guides/assets-search-and-filters, "Search results are limited to a maximum of 10,000 assets"]. Default (no shell change): the provider rejects a page that starts beyond 10,000 when a keyword is present with the shell's existing `bad_request` mapping, and `hasMore` is false at the window edge (Decision 9). Upgrade: an optional `maxResultWindow` capability the shell enforces generically.
   - **FG4 (vocabulary fit: warnings, alt source, decorative).** #22's `warnings` are `limited-use`, `archived`, `watermarked` and its `alt.source` is `property | description | name | none`; both are Bynder-shaped. Frontify has an availability window, an expiry date, licences and copyright status, a native alternative-text field, and an `isDecorative` flag. Default (no shell change): map into the existing vocabulary (Decisions 14-15) and represent "decorative" as empty alt text with `source = property`. Upgrade if the owner wants fidelity: an optional `alt.decorative` flag and more warning values (`expired`, `not-yet-available`).
   - **FG5 (outbound call shape).** The provider needs from the shell's outbound helper: JSON request bodies on `POST`; a per-provider `allowedHosts` computed at start from configuration (the Frontify domain), not a static list; and the template's explicit "safe to retry" opt-in for `POST` GraphQL **queries** (they are read-only; #2 Decision 8 retries `POST` only on `429` otherwise). Fallback: none needed if the helper already supports these; confirmed by contract tests FK8-FK9.
   - **SG3 (carried from #23): id pattern and optional thumbnail.** The asset id validation pattern is a provider member (Frontify ids are Base64 strings that start with `ey`; Decision 10), and `thumbnailUrl` may be absent (Frontify returns a null `thumbnailUrl` for some non-image assets).
   - **SG4 (carried from #23): per-provider secrets.** #22's RC4 puts provider secrets under `secrets.required`, which fails deploy when one is missing, while PC6 says a provider with missing secrets is omitted. Frontify adds a second OAuth secret to the same worker. Also, per #2 Decision 7, once `secrets` is declared only the listed keys are read from `.dev.vars`, so an optional provider secret cannot be loaded locally unless it is listed. Owner decision needed (Question 2); this spec follows whatever #22/#23 settle.
   - **SG5 (carried from #23): URL construction rule.** #22 Decision 11 says providers never construct DAM URLs. This provider obtains every rendition URL from Frontify's API (Decision 12) and so complies as written; the fallback in Decision 12 would not.
4. **Auth model: per-user OAuth 2.0 authorization-code grant, confidential client, executed by the worker.** One Frontify OAuth client per Frontify instance, created by a Frontify **account admin** in the instance's application settings with: *Support Authenticator* OFF, *Confidential* ON, a redirect URL, and the `basic:read` scope enabled [VERIFIED: https://developer.frontify.com/document/68#/get-started/oauth-2-client-service-apps, "You need to have a Frontify Account Admin permission to create a OAuth 2 Client", steps 1-3]. Each author connects their own Frontify account; "All access tokens in Frontify are issued in the name of a user and give you access to at most the permissions assigned to that specific user" [VERIFIED: authentication page]. Public-client PKCE is not used: Frontify requires PKCE only for public clients (those not entrusted with a secret) [VERIFIED: "Public clients MUST additionally use the Proof Key Code Exchange (PKCE)"]. Whether a confidential client may or must also send PKCE is not documented [OPEN: MF-P4].
5. **Rejected alternatives, and why.**
   - *Frontify Service App (client-credentials, shared identity).* Frontify recommends it for non-OAuth machine-to-machine integrations [VERIFIED: authentication page, "Service Apps – default for machine-to-machine and non-OAuth integrations"], but it runs as one owning user, so every EW author would see one identity's permissions, defeating per-user permissions and contradicting AC2 ("per-user OAuth"). Same reasoning as #22 Decision 3 for Bynder.
   - *Frontify Finder (the vendor's ready-made picker).* "Frontify handles authorization and provides a ready-to-use ... user interface" [VERIFIED: https://developer.frontify.com/document/8#/-/about-frontify-finder] and is "tightly coupled" to the Frontify Authenticator, a browser-side OAuth library [VERIFIED: https://github.com/Frontify/frontify-finder README]. That puts a Frontify token in the browser, contradicting AC2, and it is single-vendor, so it cannot be the provider-agnostic shell. Same reasoning as #22 Decision 2 for Bynder's UCV. (Contentful's Frontify app is Finder-based: https://github.com/contentful/marketplace-partner-apps/tree/main/apps/frontify.)
   - *Developer tokens.* "testing only", not production [VERIFIED: authentication page].
6. **Scope: `basic:read` only, not configurable.** Frontify scopes are `basic:read`, `basic:write`, `account:read`, `webhook:read`, `webhook:write`; `basic:read` is "basic read access to all brands, projects and assets", and a scope only caps what a token could do while the user's real permissions decide what it may do [VERIFIED: https://developer.frontify.com/document/68#/reference/scopes]. The preview-URL, asset and search queries all list `basic:read` as the required scope [VERIFIED: https://developer.frontify.com/document/31#/guides/assets-preview-and-download, "Required scopes: basic:read"; search guide likewise]. Hard-coding the single scope (no `FRONTIFY_SCOPES` knob, unlike Bynder's) removes a least-privilege foot-gun and a separator question (how several scopes are joined is not shown consistently in the sources I could read [SECONDARY: damwiki says `+`-separated in the token call]; one scope needs no separator). Whether `currentUser { name }` also needs `account:read` is not documented; the docs say `account:read` is for "account data, including users" and requires an admin for other users' data, so own-user data should not need it [ASSUMPTION: MF-P2]. If it does, the display name is dropped ("Connected to {domain}") rather than widening the scope.
7. **One Frontify instance and one library per worker deployment.** A worker serves one EW site (#2: `ORG`/`SITE`) and one Frontify domain (an OAuth client "is only valid for the Account where you have created it" [VERIFIED: OAuth client page]). Search is scoped to **one configured library**, because Frontify search is per library or per workspace project, with a brand-level search that is beta [VERIFIED: https://developer.frontify.com/document/31#/guides/assets-search-and-filters, "On Workspace/Library Level / On Brand Level (... in beta)"]. Merging several libraries would break pagination and ordering. The library id is non-secret worker configuration. Several libraries, a library picker, or beta brand-level search are follow-ups. [OPEN: Question 4.]
8. **Per-tenant domain handling.** The Frontify domain is non-secret configuration and the provider's **only** outbound host. It must be a bare hostname (lower-cased DNS name; no scheme, port, path, query, userinfo or IP literal); anything else makes the provider unconfigured (omitted from the list, PC6). It may be a custom domain, not only `*.frontify.com` [VERIFIED: authentication page and llms.txt]. Redirects from Frontify are not followed (template behaviour, #2 Decision 8), so a vendor 3xx cannot bounce the bearer token elsewhere.
9. **Browse and search: one GraphQL query against the configured library, offset-paged.** Search uses the library's `assets` field with `page`, `limit` and a query object carrying the search term, the asset-type list and a sort option [VERIFIED reference: https://frontify.github.io/graphql-api-reference/interface/Library.md.txt and https://frontify.github.io/graphql-api-reference/input/AssetQueryInput.md.txt: `search`, `types`, `sortBy`; results `total`, `page`, `limit`, `hasNextPage`, `items`]. Page size is capped at Frontify's maximum of 100 (shell default 24, cap 50, so never binding) [VERIFIED: https://developer.frontify.com/document/31#/guides/basics-pagination, "limit (how many assets) ... max 100"]. Capabilities: `assetTypes = image, video, document, audio` (Frontify's `FILE` fallback type appears only under "all"); `paging = page`; sorts = relevance (only meaningful with a keyword), newest, oldest, title A-Z, title Z-A [VERIFIED enum: https://frontify.github.io/graphql-api-reference/enum/AssetQueryFilterSortType.md.txt]. The default with no keyword is *newest*. "Newest" is not defined further by Frontify (creation vs modification) [ASSUMPTION: creation; the label says "Newest" and not "Recently modified"; #22 story 11's "recently modified" wording is relaxed for this provider]. Newer `searchAssets` (cursor-paged, typed filters, `LAST_MODIFIED` sort) is **not** used: it is documented as eventually consistent ("up to around 10" minutes) and cursor-only [VERIFIED: Library.md.txt, `searchAssets`], which would add an emulation layer for little benefit now. [OPEN: Question 5.] A searched result set is capped at 10,000 assets (FG3).
   - Search text is passed as a GraphQL **variable**, never interpolated. Frontify interprets quotes and `AND`/`OR`/`NOT` inside the term [VERIFIED: search guide, "Exact match search", "Boolean Logic"]; this is documented as a feature (README) and a malformed term that Frontify rejects maps to `bad_request`.
10. **Asset identity and detail.** The shell id is Frontify's global asset id: an opaque Base64 string that decodes to a small JSON object with an integer identifier and a type, and starts with `ey` [VERIFIED: naming-conventions page, https://developer.frontify.com/document/31 (Reference: Naming conventions): "All Frontify IDs start with ey..."]. Detail is a single `node(id)` query with an inline fragment per concrete asset type (`Image`, `Video`, `Audio`, `Document`, `File`, `EmbeddedContent`). The provider validates the id (charset, length, `ey` prefix) before any call. Because ids travel as GraphQL variables and never in a URL path, there is no path-injection surface; validation is defence in depth and a clean `400`. A `node` result that is null or not an asset is `404 not_found`. The provider does **not** additionally pin detail lookups to the configured library: Frontify's own permissions decide visibility, and the library is a browsing scope, not a security boundary [OPEN: Question 4].
11. **Token lifecycle.** Access tokens are "short-lived (between one week and three months, depending on configuration)", configurable per instance, the sample response shows `expires_in` of about 2.59 million seconds (30 days), and the response carries both `access_token` and `refresh_token` [VERIFIED: authentication page]. Refresh is a `POST` to the instance's refresh endpoint and is single-use (Decision 3, FG2). The provider returns the shell's token record fields from the response: access token, `expires_at = now + expires_in`, refresh token, and the **requested** scope (the token response documents no `scope` field). A response without a numeric `expires_in` or without a refresh token fails the connection attempt closed (generic failure page), because a silently short-lived or non-refreshable connection would mislead the author. Exchange and refresh request bodies are **JSON** (the token endpoint accepts "JSON or multipart form request"; urlencoded is not documented) [VERIFIED: authentication page, "Access Token endpoint is a POST request requiring the following parameters in either JSON or multipart form request"]. The refresh endpoint's exact parameter list is not in the rendered page text; it follows the token endpoint's (`grant_type=refresh_token`, `refresh_token`, `client_id`, plus `scope` and `client_secret` for a confidential client) [SECONDARY: https://damwiki.com/solutions/frontify/api, Authorization-code flow step 4] [OPEN: MF-P3].
12. **Rendition policy: API-returned preview URLs at fixed widths; never the original, never download URLs.** Frontify has no rendition list. Previews are fields on the asset: for images, `previewUrl` takes optional `width` and `height` arguments and returns a CDN URL; with no arguments it returns the plain preview URL [VERIFIED: https://frontify.github.io/graphql-api-reference/type/Image.md.txt, "Preview Url which has optional width and height URL parameters"]. A preview URL "never expires" and is for a **specific revision** (a static link), served from Frontify's CDN with automatic WebP/next-gen negotiation and a 4096 px output cap; "the original image cannot be retrieved via the URL" [VERIFIED: https://developer.frontify.com/document/20#/introduction/media-processing; getting-started page; https://developer.frontify.com/document/31#/guides/assets-preview-and-download, "PreviewUrl: Embedding on Website / Application / Email-Newsletter"]. The provider asks the API for one preview URL **per preset width** using aliases (a few GraphQL fields per detail call, no URL construction): `w480`, `w800`, `w1200` (default), `w1600`, `w2400`, plus `full` (no arguments: "Full-size preview (processed)"). Widths greater than or equal to the asset's own pixel width are dropped (no upscaling) except `full`. All are `kind: derivative`. There is **no** `original` rendition: the original is not retrievable from the CDN, and `downloadUrl` is a signed URL that expires within seven days by default and is `null` for download-protected assets (a permanent variant exists but is a download, not an embeddable image) [VERIFIED: assets-preview-and-download page, "Download URL"]; embedding it is unsafe by the same logic as #22's exclusion of Bynder's temporary download URL. The default width is configurable (`FRONTIFY_DEFAULT_WIDTH`, default 1200) and must be one of the presets.
    - **Documented fallback (needs owner approval under SG5, not the default):** if sized `previewUrl(width)` turns out not to return a resized image (the schema describes "URL parameters" without naming them; MF-R1 tests this), append the documented Media Processing parameters (`?mod=v1/resize=<width>`) to the unsized preview URL inside one provider function [VERIFIED grammar: https://developer.frontify.com/document/20#/introduction/getting-started-1]. That is URL construction from a documented grammar; #22 Decision 11 currently forbids it for providers; SG5 would amend the wording. Until MF-R1, **both paths exist only as spec**; implementation starts with the API-returned path.
    - **Static, not dynamic, links.** A *dynamic* preview URL (always the latest revision, stable URL) exists but is **beta**, needs `X-Frontify-Beta: enabled` and a development-flag header, and is absent from the published schema [VERIFIED: assets-preview-and-download page, "Dynamic Preview URL ... still in Beta and requires multiple HTTP headers"; SECONDARY: not in the published SDL]. v1 inserts static revision-pinned links, so an inserted image does **not** follow later edits of the asset in Frontify; the README says so. [OPEN: Question 6.]
13. **Non-image assets.** Per concrete type: `Video` `previewUrl` is the converted mp4; `Document` `previewUrl` is a preview (PDFs link whole when linked directly, as an image when used in `<img>`) [VERIFIED: Video/Document type pages https://frontify.github.io/graphql-api-reference/type/Video.md.txt, `.../Document.md.txt`; media-processing page "Smart PDF rendering"]; `Audio` has `previewUrl`. Such an asset is insertable as a link: `linkUrl` = its preview URL, text = the asset title. `File` assets (Frontify's catch-all; its `previewUrl` is only an icon, "Limited. SVG icon available as previewUrl" [VERIFIED: assets-preview-and-download page, table]) and `EmbeddedContent` are **not insertable** in v1 ("no public file URL"). Classification uses the concrete `__typename`, not file extensions.
14. **Alt text policy.** Frontify stores a native **alternative text** and a **decorative flag** per asset [VERIFIED: https://frontify.github.io/graphql-api-reference/type/Image.md.txt, `alternativeText` "Used by screen readers when the asset is not decorative", `isDecorative` "If true, alternative text is ignored"; `isDecorative` left beta in 2026-09 per SECONDARY changelog]. Ranked fallback, returned with its source: (1) `isDecorative = true` -> empty value, `source = property`, and the shell pre-ticks decorative only if FG4's optional flag exists, else the empty value shows as "decorative (from Frontify)"; (2) non-empty `alternativeText` -> `source = property`; (3) non-empty `description` -> `source = description`; (4) the asset title with separators turned to spaces -> `source = name` (else the filename stem); (5) empty with a "needs alt text" flag. All candidates are stripped to plain text (no markup, no control characters), whitespace-collapsed, and length-capped (Decision 17). The author may always edit it or mark the image decorative. No AI-generated tags or custom metadata field is consulted in v1 (no configurable metaproperty, unlike Bynder).
15. **Warnings, insertability, and the download-protection stance.** Mapped into #22's vocabulary (FG4):
    - `archived`: the asset's availability window is not currently open (before `from` or after `to`) or its `expiresAt` is in the past [VERIFIED fields: Asset interface page, `availability`, `expiresAt`].
    - `limited-use`: the asset has at least one attached licence [VERIFIED field `licenses`; the semantic fit is an ASSUMPTION: Question 7].
    - `watermarked`: never emitted.
    - **Copyright status** is not a warning (it would flag most brand assets); the copyright notice, if any, is returned as the `copyright` text.
    - **Not insertable, with a reason:** conversion status other than finished ("still being processed in Frontify"); the current user cannot download the asset (`currentUserPermissions.canDownload = false`, "Download-protected in Frontify": embedding publishes the preview to anyone, which a download-protection setting is meant to prevent [ASSUMPTION about intent; VERIFIED field: https://developer.frontify.com/document/68#/reference/user-permissions, "currentUserPermissions.canDownload"]; the conservative default is to block, Question 8); no usable https preview URL; `File`/`EmbeddedContent` types (Decision 13).
    - Warn-only (insertable) for availability and licence, consistent with #22's open question 15.
16. **Error mapping.** Frontify returns GraphQL errors as an `errors` array, sometimes with HTTP `200`, sometimes `422`, and authentication failures as `401`, rate limiting as `429` [VERIFIED: https://developer.frontify.com/document/68#/reference/rate-limiting-and-limitations: "GraphQL errors will result in HTTP status code HTTP 422 Unprocessable Entity" and `429` for exceeding the limit; SECONDARY (error-handling page not read): `200` with `errors[]` and categories `graphql`, `validation`, `permission`, `internal`]. The provider therefore inspects the body for `errors` regardless of status and maps: `401` or an expired/invalid-token error -> `provider_reauth_required` (after the shell's refresh attempt); permission-category error or a null library -> `forbidden`; validation-category error on a search -> `bad_request`; `429` -> `rate_limited` with `Retry-After` (a fixed delay when the header is absent, since the 429 body and headers are not documented); `5xx`, network failure, or an unparseable body -> `upstream_unavailable`. No upstream message text is ever returned. The provider adheres to the vendor's warning that repeated erroneous requests "may flag as suspicious activity": it never retries `4xx`/GraphQL-error results (the template already retries only `429`/`5xx`).
17. **Input and output hygiene.** Query documents are constant strings with **operation names** (so fixtures and logs are deterministic) and typed variables; no template string ever contains user input. Search text is trimmed and capped at 200 characters; asset ids are validated (Decision 10); page and page size are integers within range; the `type`, `sort` values are allow-listed. From Frontify's response only allow-listed fields are mapped; every URL passes the shell's https-only filter and additionally must be on `https:` with a non-empty host; alt, title, description and tag strings are length-capped (title 200, description 1,000, alt 500, tags max 20 items of 60 characters).
18. **Disconnect revokes upstream.** Frontify has a revoke endpoint: `POST` with the token (and an optional `token_type_hint`) returns `200` on success [VERIFIED: authentication page, "4 - Revoke Token"]. The provider implements the optional revoke member: on `disconnect` the shell calls it best-effort (a failure never blocks deleting the stored record and is never surfaced as an error). Whether revoking the access token also kills the refresh token, and whether the call needs client credentials, are undocumented [OPEN: MF-P5]; to be safe the provider revokes the access token and README states the behaviour once observed. This is better than Bynder (no per-token revoke found, #22 Decision 9 / Question 9).
19. **Rate limit.** 2,500 requests per 5-minute rolling window; over the limit Frontify returns `429` and "might" block longer if the client keeps sending [VERIFIED: rate-limiting page]. Whether the window is per token, per user or per account is not public (SECONDARY) [OPEN]. Costs per author action are one GraphQL call per search page and one per detail view; thumbnails and previews load from the CDN, not the API, so Frontify's limit is far less likely to bind than Bynder's per-IP limit. The provider does no extra throttling; the shell's debounce and page-size cap apply.
20. **Configuration split (this provider).** Non-secret vars: Frontify domain, OAuth client id (public by nature: it is in the authorize URL), library id, default rendition width. Secret: the OAuth client secret. The shell-wide `PUBLIC_WORKER_ORIGIN`, `TOKEN_ENC_KEY`(+previous) and `OAUTH_STATE_KEY` are reused unchanged. The provider is "configured" when all four of its values are present and valid; otherwise it is omitted from `/dam/providers` and its routes are `404 provider_not_configured` (#22 PC6). The extension still reads **no site config** except its own `library` row. Redirect URI = `PUBLIC_WORKER_ORIGIN` + `/oauth/frontify/callback` (the #22 route pattern); it must be registered on the Frontify OAuth client. Whether Frontify allows more than one redirect URL on a client is not documented ("you must add one") [OPEN: MF-P6]; fallback is one OAuth client for the local worker and one for the deployed worker (two sets of client id/secret via `.dev.vars` vs deployed secrets).
21. **Docs ship with the code (AC4).** The extension README (`apps/multi-dam-picker/README.md`) gains a **Frontify section**: what it does; Frontify-side setup (admin creates an OAuth client: Confidential ON, Support Authenticator OFF, redirect URL, `basic:read`; find the library id; set alt text in Frontify; know that search is per library and capped at 10,000 results for a keyword; Boolean/quote search syntax; static-link behaviour; download-protection and availability behaviour); worker setup (vars, secret, deploy; the exact names in Build Analysis section 4); local dev (`ref=local`, redirect URI note); privacy and retention (tokens up to three months old are stored encrypted until disconnected; revoke upstream on disconnect); troubleshooting (library not accessible, wrong domain, redirect URI mismatch). RC2/RC5 check its presence.
22. **Tooling and conventions** follow #1/#2/#22 unchanged: ESLint 8 + helix config, Stylelint 16, `@web/test-runner`, Node `node:test` for worker tests, Playwright (Chromium), Node 22 (>= 22.12 for wrangler 4), husky; tests live inside the extension folder. One test-only addition is proposed (Decision in Testing Decisions): the `graphql` package as a devDependency to validate query documents against a vendored schema snapshot [OPEN: Question 9].

## Testing Decisions

**What makes a good test here.** Assert external behaviour only. At the worker boundary (seam W1): given an HTTP request with a valid IMS token to the real worker with the Frontify provider registered, assert the response, redirects, cookies, the stored (encrypted) bytes, and the outbound requests the **fake Frontify** received (path, headers, body, operation name, variables). At the provider contract (seam P1): given recorded Frontify responses, assert the normalised outputs. Never assert on internal helper names or call counts of internal functions. Two properties are asserted as negatives across every path: **no secret or token ever reaches a response, redirect, log line or the browser**, and **nothing runs before authentication succeeds (except the two sealed OAuth routes, which have their own gate)**. Two Frontify-specific negatives are added: **no user input ever appears in a GraphQL document** (it is variables only) and **no outbound request goes to a host other than the configured Frontify domain**.

**Proposed seams** (recorded here instead of asked, per #62). **No new seam is introduced.** Frontify reuses #22's seams.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| P1 (primary) | The provider interface: shell registry + shared conformance suite | reused from #22 | Provider contract tests run once more for Frontify; proves "add a module only" (FK*) | Recorded/synthetic Frontify GraphQL responses replayed by `fakeUpstream`; the existing stub provider and Bynder stay registered to prove coexistence |
| W1 | The worker's HTTP boundary: `worker.fetch(request, env, ctx)` | reused from #2/#22 | Node tests for OAuth begin/callback, exchange, refresh, revoke, browse, detail, errors, security with the Frontify provider on | #2 test kit (`makeEnv`, `fakeIms`, `signToken`, `fakeUpstream`, canaries) and #22's in-memory KV, plus a new **scripted fake Frontify** (below) |
| S2 | Browser render/logic module + SDK result | reused from #1/#22 | A handful of capability-driven UI checks (FU*) against Frontify-shaped worker responses | injected `fetch` returning Frontify-shaped normalised data |
| S1 | Entry HTML page + SDK stub against a real local worker | reused from #1/#2/#22 | Playwright e2e of the full pop-up OAuth flow with Frontify | #1 SDK stub; real worker under `wrangler dev` with local KV; fake IMS; **fake Frontify** as a throwaway Node server |
| W2 | Worker in the real workers runtime | reused from #2 | Smoke | `wrangler dev`, no Cloudflare login |
| S3 | Repo convention check | reused from #1/#2/#22 (RC1-RC5), extended | CI lint | Filesystem fixtures in a temp dir |

The **scripted fake Frontify** is test-kit code owned by this provider's folder: it serves `/api/oauth/authorize` (auto-approves and redirects to the worker callback; configurable to send the code as `code` or as `authorization_code`), `/api/oauth/accesstoken` (accepts **JSON and multipart only**, answers `415`/`400` to urlencoded to catch a regression to the Bynder format; returns the documented response shape), `/api/oauth/refresh` (**enforces single use and invalidates the previous access token**, the behaviour that makes Frontify different), `/api/oauth/revoke`, and `/graphql` (routes by operation name and variables to fixtures; understands `errors[]` variants; counts requests). It is the thing that lets a hermetic test prove Frontify's rotation semantics.

The real boundaries (a real Frontify instance, real Adobe IMS login, the real EW library iframe, real editor insertion) are covered only by numbered manual verification steps (MF-*) and a manual **API probe** (MF-P*) that settles the vendor questions this spec could not.

**Fixture provenance rule.** Fixtures live in two folders: `recorded/` (sanitised from a real Frontify instance; domains, ids, tokens and user names replaced) and `synthetic/` (hand-authored from the published schema before a real instance is available). A CI check requires every fixture to be in one of them and rejects any fixture containing a real-looking token, a non-example domain, or a `Bearer` value. #62's review treats synthetic fixtures as provisional until the same cases exist as recorded ones.

**Schema validation test.** Because Frontify's own guidance is "never invent GraphQL fields ... verify against the schema" [VERIFIED: https://raw.githubusercontent.com/Frontify/buildforfrontify/refs/heads/main/frontify-graphql/SKILL.md, non-negotiable rule 1-2], every query document the provider sends is validated in CI against a **vendored snapshot of Frontify's published SDL** (assembled from https://frontify.github.io/graphql-api-reference/llms.txt, which links raw SDL per schema member) using graphql-js validation, and a second check fails if the document uses a field the SDL marks beta (no beta header is ever sent). The snapshot carries its fetch date and a refresh script (documented, not run in CI). [OPEN: Question 9; fallback if the owner declines the dependency/fixture size: golden-string tests of the documents plus MF-Q1 against a real instance.]

**Modules tested:** Frontify provider (authorize URL, exchange, refresh, display name, revoke, search mapping and parameters, detail mapping, renditions, alt text, warnings and insertability, error mapping), the provider's config validation, the fake-Frontify itself (self-check), conformance registration, and the interplay with the shell's refresh orchestration (rotation, races). The browser shell is not modified, so only capability-driven UI checks are added.

**Prior art:**
- `apps/multi-dam-picker/SPEC.md` (#22): P1 conformance suite PC1-PC6, OA*/TS*/RF*/BR*/RD*/AT*/SC* IDs, E2E1-E2E9, M0-M10. This spec extends, does not repeat, them; the shell's tests run against Frontify automatically once it is registered.
- `apps/multi-dam-picker/providers/cloudinary/SPEC.md` (#23): the second-provider pattern (provider-local fixtures, SG* gaps, provider test ID blocks).
- `shared/worker-template/SPEC.md` (#2): test kit and UA/UC/UP/US IDs.
- `apps/hello-world/SPEC.md` (#1): SDK stub, S1/S2 patterns.
- Upstream `adobe-rnd/ew-extensions` has no worker, no OAuth and no DAM code (tree read via the GitHub API 2026-11-16: `blocks/skills`, `tools/{block-editor,brand-visibility,ew-setup}` only; no path contains `frontify`, `worker`, `wrangler` or `oauth`), so there is no upstream prior art for this ticket. External prior art: Frontify's own AEM connector (authors search Frontify from AEM pages; assets are "linked to the Frontify CDN", the same embed-by-CDN model chosen here) https://github.com/Frontify/frontify-aem-connector, and Contentful's Frontify app (Finder-based, browser tokens, rejected above).

## Out of Scope

- Bynder (#22), Cloudinary (#23), Dropbox (#25); any change to the browser shell, the token store, the OAuth routes, KV, or the template beyond FG1-FG5/SG3-SG5 as settled in #22's stream.
- Frontify **Service Apps** (client credentials), developer tokens, org-wide connections, SCIM/admin provisioning.
- Frontify **Finder** and **Authenticator** (browser-side), the Frontify MCP server, the Frontify Brand SDK (apps/blocks/themes **inside** Frontify).
- Multiple Frontify instances or multiple libraries per site, workspace projects, brand-level (beta) search, a library/folder picker, collections, folder browsing, tag or custom-metadata filters, the newer `searchAssets` cursor API.
- **Dynamic** (latest-revision, beta) preview URLs, the original file or any download URL, arbitrary Media Processing transformations (crop, focus, background removal, format forcing), `srcset`/`<picture>` output.
- Writing to Frontify (upload, metadata, usage tracking back to Frontify, webhooks).
- Multi-select, saved searches, AI/auto tags in the alt text, a configurable alt-text custom-metadata property, OCR search tuning.
- CI-driven deployment, a custom worker domain, Durable Objects (the documented upgrade path, FG2), per-user quota enforcement.
- The Adobe outside-activity/IP policy and data-protection review for storing third-party OAuth tokens (flagged, owned by #1 R1 and #22 R4).

## Further Notes

- **Docs say nothing about third-party pickers or OAuth in EW.** The EW developer doc cited by the ticket (https://www.aem.live/docs/ew/developing/apps-plugins) documents the SDK, `sendText`, `sendHTML`, `closeLibrary` and the config rows only [VERIFIED by #22, 2026-11-16]. Everything here derives from #22's source reading and Frontify's docs. The SDK action semantics (`sendHTML` then `closeLibrary`, fire-and-forget) and the library iframe/pop-up behaviour are #22's and unchanged.
- **Frontify prerequisites an agent cannot satisfy.** An **account admin** must create the OAuth client and give the instance's domain, library id, client id and secret; the secret is a vendor-generated value. Frontify's developer sandbox is "granted selectively" on request and not automatic; Frontify says most integrations can be built safely in production against a **dedicated test library** with limited access [VERIFIED: https://developer.frontify.com/document/162#/-/request-developer-sandbox]. Until an instance exists, real verification (AC1, AC2, AC5, AC6 against real Frontify) is blocked and the fake-Frontify tiers are the only automated proof. [OPEN: Question 3.]
- **API plan gating.** "Some API features may be restricted based on your current Frontify plan" (SECONDARY, citing the GraphQL "Our GraphQL API" page); confirm the customer's plan includes API/OAuth access [OPEN: Question 3].
- **Embedded-URL longevity.** Static preview URLs "never expire" and stay valid "even if the asset is later changed or deleted" per Frontify (the "stays valid even if the asset is later changed or deleted" wording is SECONDARY, from the aggregator's summary of the getting-started page; the rendered media-processing page I read states only that a static link "always point[s] to a specific revision" and "URL never changes, even if the asset is updated" [VERIFIED: https://developer.frontify.com/document/20#/introduction/media-processing], and that the dynamic link stops only when the asset is deleted [VERIFIED: assets-preview-and-download page]). So an inserted image outlives the asset's removal and ignores its replacement; the README says "pickers insert references, not copies, and these references are pinned to a revision".
- **Public reachability of preview URLs.** Frontify positions preview URLs for "Embedding on Website / Application / Email-Newsletter", which implies anonymous reachability, but a statement that they load **without any Frontify session, for assets in non-public libraries**, was not found. Manual step MF-R2 tests this anonymously and is the gate for AC1's "appropriate rendition URL" [OPEN: Question 10]. [ASSUMPTION: the CDN URL is an unguessable capability link.]
- **EDS and external images.** Whether Edge Delivery Services keeps an external `<img src>` in a DA document on publish is #22's [ASSUMPTION it is kept]; checked in MF6 (same as #22 M6).
- **Template and shell are not built yet.** `shared/worker-template/` and `apps/multi-dam-picker/` hold only their specs. "The shell provides" presumes #22 landed as specified plus the gaps listed here.
- **Frontify API drift.** The API is unversioned; breaking changes roll out on 1 January and 1 July with at least six months' notice, and beta members are exempt (SECONDARY: https://damwiki.com/solutions/frontify/api). The schema-validation test (above) and a changelog watch are the controls; no beta field is used.

---

# Build Analysis

## 1. Architecture and responsibilities

```
EW editor (da.live)                                          Frontify instance  https://{FRONTIFY_DOMAIN}/
 └─ library iframe: apps/multi-dam-picker (static, public;     ▲ ▲  ▲
    generic shell, NO Frontify code)                           │ │  │ POST /graphql  (Bearer = the author's own Frontify token)
      │ SDK handshake -> { token (IMS), context, actions }     │ │  │ GET  /api/oauth/authorize  (pop-up, user login/consent)
      │ fetch(worker, Authorization: Bearer <IMS>)             │ │  │ POST /api/oauth/{accesstoken|refresh|revoke}
      ▼                                                        │ │  │
 Cloudflare Worker (apps/multi-dam-picker/worker, core from shared/worker-template, #22 shell)
   1 origin gate -> 2 IMS check -> 3 router -> 4 shell routes -> 5 Frontify provider module -> 6 proxy(retries) ──┘
        │                                         └─ KV (encrypted token records), secrets (FRONTIFY_CLIENT_SECRET + shell keys)
        └─ public sealed routes: GET /oauth/frontify/begin, GET /oauth/frontify/callback   (pop-up navigation)
 Frontify CDN (media.ffycdn.net, per Frontify docs) <── the author's browser and every site visitor load preview URLs directly; the worker never sees image bytes
```

| Concern | Browser extension (static, public) | Worker (private runtime) |
|---|---|---|
| Frontify OAuth client secret, access/refresh tokens | never | only place (secret store, encrypted KV) |
| Author identity | gets IMS token from the SDK, sends it | verifies it; `userId` keys every connection |
| OAuth dance | opens pop-up, polls `session` (shell, generic) | shell: ticket/state/cookie/storage; **Frontify module: authorize URL, JSON code exchange, JSON refresh, revoke, display name** |
| Frontify API calls | none | all, GraphQL over the template `proxy` with the user's bearer token |
| Search/filter/pagination UI, rendition and alt editing, insertion | all (generic, driven by capabilities and normalised data) | maps filters to GraphQL variables, normalises results |
| Frontify knowledge | none (a provider id and capability flags) | the Frontify module only |
| Image bytes | loads preview URLs from Frontify's CDN | none |

## 2. EW integration points

- **Library plugin vs app:** library plugin, unchanged from #22: no new `library` row, no new `apps` row, no new SDK action. The existing row (`Multi-DAM Picker`, `/apps/multi-dam-picker/multi-dam-picker.html`, `experience` per #22 Question 5) is all an admin needs; Frontify appears when the worker has it configured.
- **SDK actions used:** `actions.sendHTML` and `actions.closeLibrary` (image or link insertion), `token` (IMS, as the worker bearer), all through the unchanged shell.
- **Config-sheet rows:** none new. Site config read: **none** (stated explicitly in the README; AC4/AC5 of #22 carry over).
- **`ref=local`:** page at `http://localhost:3000`, worker at `http://localhost:8787`, local KV. The Frontify OAuth client must list `http://localhost:8787/oauth/frontify/callback` as a redirect URL, or a second OAuth client is used for local work (MF-P6, Decision 20).
- **Branch ref / main:** pages on `*.aem.live` / `*.preview.da.live` call the deployed worker; its callback URL is the other redirect URI.

## 3. External APIs and auth flows

All Frontify calls go to the configured Frontify domain. Primary sources are Frontify's developer portal (a single-page app, read rendered 2026-11-16) and Frontify's published GraphQL reference (https://frontify.github.io/graphql-api-reference/llms.txt; per-member Markdown at `.../<kind>/<Name>.md.txt`).

| API | Use | Auth | Source / status |
|---|---|---|---|
| `GET https://{domain}/api/oauth/authorize` params `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state` | start the authorization-code grant; consent page lists the scope | none (user logs in, SSO supported by the instance) | [VERIFIED] https://developer.frontify.com/document/68#/get-started/authentication-1 ("Example authorization (Private app)") |
| `POST https://{domain}/api/oauth/accesstoken` `grant_type=authorization_code`, `code`, `client_id`, `redirect_uri`, `scope` (+ `client_secret` for a confidential client), **JSON or multipart body** | exchange the code; response `token_type`, `expires_in`, `access_token`, `refresh_token` | client credentials in body | [VERIFIED] same page; the `client_secret` parameter for confidential clients is [SECONDARY] and the page's parameter table did not render as text [OPEN: MF-P3] |
| `POST https://{domain}/api/oauth/refresh` | new access + refresh token; old access token invalidated; **refresh token single-use** | refresh token (+ client credentials) | [VERIFIED behaviour] same page "3 - Refresh Token"; parameter list [SECONDARY] [OPEN: MF-P3] |
| `POST https://{domain}/api/oauth/revoke` `token`, optional `token_type_hint` (the sample uses `access_token`) | revoke on disconnect; `200` = success | none shown in the sample | [VERIFIED] same page "4 - Revoke Token"; whether it kills the refresh token and whether auth is needed [OPEN: MF-P5] |
| `POST https://{domain}/graphql`, `Authorization: Bearer`, `Content-Type: application/json`, body `{ operationName, query, variables }` | all data access | Bearer (the author's token) | [VERIFIED] https://frontify.github.io/graphql-api-reference/llms.txt ("Endpoint: `POST https://<your-domain>/graphql` (Bearer token)") |
| Query `currentUser` (`id`, `name`) | "Connected as ..." | `basic:read` [ASSUMPTION] | [VERIFIED exists] https://frontify.github.io/graphql-api-reference/query/currentUser.md.txt ("Get the current `User`"); scope [OPEN: MF-P2] |
| `library(id)` -> `assets(page, limit, query: {search, types, sortBy})` -> `{ total, page, limit, hasNextPage, items }` | browse and search | `basic:read` | [VERIFIED] Library.md.txt, AssetQueryInput.md.txt, AssetItems (`total`, `page`, `limit`, `hasNextPage`, `items`); https://developer.frontify.com/document/31#/guides/assets-search-and-filters |
| `node(id)` with per-type fragments | asset detail | `basic:read` | [VERIFIED] preview-and-download guide uses `node(id: "ey...")` with `... on Image`; Asset/Image/Video/Document/Audio/File type pages |
| Asset fields used | `title`, `description`, `alternativeText`, `isDecorative` (Image/Video/Document/Audio/File), `tags { value }`, `copyright { notice status }`, `availability { from to }`, `expiresAt`, `status`, `licenses { id }`, `currentUserPermissions { canDownload }`, `modifiedAt`, `createdAt`, `__typename`; Image/Video/Document: `width`, `height`, `extension`, `size`, `filename`, `previewUrl`, `thumbnailUrl` | | [VERIFIED] https://frontify.github.io/graphql-api-reference/type/Image.md.txt (and Video, Document); `Asset` interface page; `AssetStatusType` = `FINISHED`/`PROCESSING`/`PROCESSING_FAILED` |
| Preview CDN `https://media.ffycdn.net/...?mod=v1/...` | viewing the inserted image (visitors) | none shown | [VERIFIED grammar] https://developer.frontify.com/document/20#/introduction/getting-started-1; public reachability [OPEN: MF-R2] |

Limits: 2,500 requests per 5-minute rolling window, `429` over it; GraphQL errors may be `422` [VERIFIED: rate-limiting page]. Page `limit` max 100 [VERIFIED: pagination page]; searched results capped at 10,000 [VERIFIED: search guide].

**Auth flow (Frontify connection), numbered (the shell's #22 flow with Frontify specifics in bold):**
1. Extension `POST /dam/frontify/connect` (Bearer IMS) -> `{ beginUrl }` (sealed ~60 s ticket).
2. Click handler opens a blank pop-up synchronously, then navigates it to `beginUrl`.
3. `GET /oauth/frontify/begin?ticket=`: verify ticket, set binding cookie, 302 to **`https://{FRONTIFY_DOMAIN}/api/oauth/authorize?response_type=code&client_id=...&redirect_uri=...&scope=basic:read&state=<sealed>`** (built by the Frontify module).
4. The author logs in to Frontify (SSO if configured) and consents to `basic:read`.
5. Frontify 302s to `GET /oauth/frontify/callback?<code or authorization_code>&state=` (FG1): the shell unseals state, checks cookie, hands the code to the Frontify module, which **POSTs JSON to `/api/oauth/accesstoken` with the client secret from the secret store**, then calls `currentUser { name }` (or skips it, Decision 6); the shell stores the encrypted record and returns the static result page.
6. The polling `session` flips to `connected`.

**Auth flow (per call):** read record -> decrypt -> refresh if `expires_at` is near (single-flight; **new refresh token replaces the old; old access token is now invalid**) -> GraphQL call with the author's access token -> map -> respond. On `401`: re-read storage; if a newer record exists use it, else force one refresh and retry once (FG2).

## 4. Data contracts

**Provider capabilities (declared):** `id = frontify`, `label = Frontify`; `assetTypes = [image, video, document, audio]`; `sorts = [relevance, newest, oldest, title-asc, title-desc]`; `paging = page`; `auth = oauth-user` (SG1 default).

**Search parameter mapping (shell -> GraphQL variables):**

| Shell parameter | Frontify variable | Notes |
|---|---|---|
| `q` | `query.search` | omitted when empty; trimmed; max 200 characters; boolean/quote syntax passes through |
| `type` | `query.types` | `image`->`IMAGE`, `video`->`VIDEO`, `document`->`DOCUMENT`, `audio`->`AUDIO`; absent = all types |
| `sort` | `query.sortBy` | `relevance`->`RELEVANCE` (only allowed with a non-empty `q`; otherwise coerced to newest), `newest`->`NEWEST`, `oldest`->`OLDEST`, `title-asc`->`TITLE_ASCENDING`, `title-desc`->`TITLE_DESCENDING`; default `newest` |
| `page`, `pageSize` | `page`, `limit` | 1-based; `limit` = pageSize (<= 50 by the shell, <= 100 by Frontify); a page whose first item is beyond 10,000 with a non-empty `q` is a `bad_request` (FG3) |
| (config) | `libraryId` | `FRONTIFY_LIBRARY_ID` |

**Normalised summary mapping:**

| Normalised field | Frontify source |
|---|---|
| `id` | asset `id` (global id) |
| `provider` | `frontify` |
| `name` | `title` |
| `type` | by `__typename`: `Image`->`image`, `Video`->`video`, `Document`->`document`, `Audio`->`audio`, `File`/`EmbeddedContent`->`other` |
| `thumbnailUrl` | images: sized `previewUrl` (320 px wide, API-returned); others: `thumbnailUrl`; absent if null (SG3) |
| `width`, `height` | `width`, `height` where the type has them |
| `extension`, `fileSize`, `dateModified` | `extension`, `size` (BigInt, coerced to a safe integer or dropped), `modifiedAt` (fallback `createdAt`) |
| `warnings[]` | Decision 15 |

**Normalised detail mapping (adds to the summary):**

| Normalised field | Frontify source |
|---|---|
| `description` | `description` (plain text, capped) |
| `tags[]` | `tags[].value`, deduplicated, capped |
| `copyright` | `copyright.notice` |
| `alt { value, source }` | Decision 14 |
| `renditions[]` | Decision 12: `{ id: w480|w800|w1200|w1600|w2400|full, label, url, kind: derivative, width? }`; `width` is the preset width (for `full`, the asset's width) |
| `defaultRenditionId` | `w{FRONTIFY_DEFAULT_WIDTH}` when present after upscale filtering, else the largest remaining `w*`, else `full` |
| `insertable { ok, reason? }` | Decision 15 |
| `linkUrl` | non-image with a usable preview URL: its `previewUrl` |

**Provider-specific configuration:**

| Name | Kind | Meaning |
|---|---|---|
| `FRONTIFY_DOMAIN` | var | bare host of the instance; the provider's only outbound allow-list entry |
| `FRONTIFY_CLIENT_ID` | var | OAuth client id (public) |
| `FRONTIFY_LIBRARY_ID` | var | the library whose assets are browsable (Frontify global id or numeric id) |
| `FRONTIFY_DEFAULT_WIDTH` | var (optional) | default rendition width, one of 480, 800, 1200, 1600, 2400; default 1200 |
| `FRONTIFY_CLIENT_SECRET` | **secret** | OAuth client secret (confidential client) |
| `PUBLIC_WORKER_ORIGIN`, `TOKEN_ENC_KEY`, `TOKEN_ENC_KEY_PREVIOUS`, `OAUTH_STATE_KEY`, `DAM_TOKENS`, `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS` | from #22/#2 | unchanged |

**Stored connection record:** #22's record; `scope` holds the requested `basic:read`; `account.displayName` from `currentUser` when available; the record's refresh token is replaced on every refresh.

**Error mapping:** Decision 16, using #22's codes (`provider_reauth_required`, `provider_not_connected`, `rate_limited`, `upstream_unavailable`, `bad_request`, `not_found`, `forbidden`). Fixed messages; no upstream text.

## 5. Folder layout (proposed; fits #1/#2/#22)

```
apps/multi-dam-picker/
├─ README.md                       gains the "Frontify" section (AC4)
└─ providers/
   └─ frontify/
      ├─ SPEC.md                   this file
      └─ worker/                   the Frontify provider module (#2 Decision 3)
         ├─ provider.js            identity, capabilities, auth half, browse half, mapping
         ├─ queries/               constant GraphQL documents (search, asset, current user), named operations
         ├─ test/
         │   ├─ *.test.js          FA, FT, FB, FD, FL, FE, FS, FK (Node test runner)
         │   ├─ fake-frontify.js   scripted fake Frontify (OAuth + GraphQL), with self-check test
         │   ├─ schema/            vendored SDL snapshot + refresh note (Testing Decisions)
         │   └─ fixtures/
         │       ├─ recorded/      sanitised from a real instance
         │       └─ synthetic/     hand-authored from the published schema until recorded ones exist
         └─ (no browser files)
apps/multi-dam-picker/worker/      gains: one registry line; wrangler `vars` placeholders for the four Frontify vars; `FRONTIFY_CLIENT_SECRET` in the secrets declaration and .dev.vars.example (SG4 decides required vs optional)
```

Registration footprint (what #24's PR may touch outside the provider folder): the registry line, wrangler config entries, `.dev.vars.example`, the extension README section. A review checklist item confirms the shell, token store, OAuth routes and browser files are untouched.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **No Frontify instance with an admin-created OAuth client.** Sandbox is selective; a test library in a customer's instance needs their admin. Without it AC1/AC2/AC5/AC6 cannot be verified against real Frontify. | High, blocks manual verification | Owner action first; fake-Frontify tiers prove behaviour meanwhile; fixtures stay `synthetic/` until recorded [OPEN Q3] |
| R2 | **Shell interface gaps FG1-FG5, SG3-SG5.** Without them AC3 ("no changes beyond registering") fails or Frontify needs workarounds. | High for scheduling | Settle in #22's stream before building #24; fallbacks keep AC3 true [OPEN Q1, Q2] |
| R3 | **Single-use refresh tokens + KV eventual consistency** (Cloudflare KV propagation can take 60 s+; https://developers.cloudflare.com/kv/concepts/how-kv-works/ per #22 R5). A lost race invalidates the connection; our access token is also invalidated by another isolate's refresh. | Medium (access tokens last one week or more, so refreshes are rare) | Re-read before forced refresh and before delete (RF8 behaviour), single-flight, rotating-scenario tests FT4-FT7, FK6-FK7; Durable Objects as upgrade [OPEN Q1] |
| R4 | **OAuth parameter/behaviour unknowns:** callback param name (`code` vs `authorization_code`); whether `client_secret` is accepted/required in the exchange; refresh parameter list; whether PKCE is also accepted/required for confidential clients; whether multiple/localhost redirect URLs are allowed; revoke semantics; `expires_in` shape; granted-scope reporting. | Medium-High | Manual API probe MF-P1..MF-P7 **before** writing the exchange/refresh fixtures; fake-Frontify has switches for the plausible variants |
| R5 | **Rendition URL reality:** whether `previewUrl(width)` returns a resized URL; whether widths above the source are upscaled; whether the CDN URL is anonymously reachable for assets in non-public libraries; whether the preview URL for download-protected assets is intended to be embeddable. | High for AC1 | MF-R1..R3; fallback grammar (Decision 12, needs SG5); block download-protected by default (Decision 15) |
| R6 | **GraphQL specifics:** error status/shape contradictions (`200` with `errors[]` vs `422`); `BigInt` serialisation; alias conflicts when the same field has different arguments across type fragments; query complexity. | Medium | Provider inspects body regardless of status; aliases for every sized `previewUrl`; schema-validation test; MF-Q1 runs the real documents against a real instance |
| R7 | **Schema drift / beta fields.** Unversioned API; `isDecorative` only recently GA (SECONDARY); `Library.searchAssets` new. | Low-Med | No beta fields; schema snapshot test; changelog watch; `alias` for renamed fields |
| R8 | **Tenant scoping:** single library; searched results capped at 10,000; search index vs `assets` consistency; users without access to the configured library see an error. | Medium (product) | README; clean messages (`forbidden`); Question 4 for multi-library |
| R9 | **Token retention.** Frontify tokens may be valid up to three months, are tied to Adobe user ids and stored in a Cloudflare account. | High (policy) | Encryption (shell), revoke on disconnect (Decision 18), privacy note; carries #22 R4 / #1 R1 |
| R10 | **Client-secret exposure surface:** the exchange uses a JSON body with the secret; logs/redaction must cover the body. | Medium | Secret registered for redaction (#2 Decision 7); FS tests with canaries; never logged |
| R11 | **Rate limit scope unknown** (per token/user/account) and 429 body/headers undocumented. | Low-Med | Fixed back-off delay when `Retry-After` is absent; UI honours it |
| R12 | **Editor schema / EDS behaviours** (`sendHTML` of an `<img>`, external image kept on publish) are #22's R11/R12. | Medium | MF1/MF6 observe |
| R13 | **Vocabulary mismatch** (warnings, alt source, decorative) hides semantics from authors. | Low | Documented mapping; FG4 upgrade path |
| R14 | **Frontify plan gating** of API/OAuth. | Low-Med | Confirm plan with the customer [OPEN Q3] |

## 7. Ordered build plan (sized to #24's acceptance criteria)

0. **Prerequisites (owner):** #1, #2, #22 landed (including #22's conformance suite and test kit); decisions on Open Questions 1-4 and 8; a Frontify instance with an admin who creates the OAuth client (Confidential ON, Support Authenticator OFF, redirect URL(s), `basic:read`) and a **dedicated test library** with the assets listed in Testing Requirements section 6; Cloudflare KV already provisioned by #22. Without the instance, steps 1-7 proceed against fakes.
1. **Manual API probe (MF-P1..MF-P7)** against the real instance with `curl` and a throwaway OAuth client, before writing exchange/refresh code: resolves R4/R5 unknowns; record observed responses (sanitised) as `recorded/` fixtures.
2. **Settle FG1-FG5/SG3-SG5** in #22's stream (or confirm fallbacks). Verify #22's refresh orchestration handles rotation (FK6-FK7 will prove it once Frontify is registered).
3. **Fake-Frontify and schema snapshot** (test kit): OAuth endpoints with single-use refresh, GraphQL by operation name, request log; vendored SDL and the validation helper; self-check tests (FK-SELF).
4. **Config validation + registration** test-first (FK1-FK5, FS1): provider omitted when misconfigured; domain validation.
5. **Auth half** test-first (AC2): FA*, FT*, FS*.
6. **Browse half** test-first (AC1): FB*, then **detail + renditions + alt + warnings** (FD*, FL*), error mapping (FE*).
7. **Conformance registration** (FK6-FK10) and the interplay tests with the shell (rotation, coexistence with Bynder and the stub).
8. **README Frontify section** (AC4) and the registry/wrangler/`.dev.vars.example` entries; RC checks.
9. **Playwright e2e** (FX1-FX7) and **runtime smoke** (SM-F1-SM-F3).
10. **CI** (AC7): add the Frontify tests to the existing jobs; no secrets in CI.
11. **Deploy, set `FRONTIFY_CLIENT_SECRET`, register redirect URI(s), manual verification MF0-MF9** (AC1, AC2, AC5, AC6); record observed behaviour (callback parameter, scope, rendition checks) in the PR and README.
12. **Hand-off note** in the README: what Frontify taught the interface (GraphQL provider, rotating tokens, per-tenant domain) for #25.

---

# Testing Requirements

Template-provided tests (UA authentication matrix, UC CORS matrix, UP proxy/retry matrix, US secret hygiene) and #22's shell tests (OA, TS, RF, BR, RD, AT, PC, SC, UI, E2E1-E2E9, SM-MD1-3, RC1-RC5) run unchanged and now also run with the Frontify provider registered. The IDs below are **additional**, Frontify-specific. Prefixes: FA = authorize/exchange, FT = token/refresh/revoke, FB = browse, FD = detail/renditions, FL = alt text and legal/availability metadata, FE = errors, FS = security, FK = provider contract, FU = UI, FX = e2e, SM-F = smoke, FRC = repo check, MF = manual (MF-P = API probe, MF-R = rendition checks).

## 1. Provider unit tests (seams W1 and P1; Node built-in runner)

Fixtures/mocks: #2 test kit; #22 in-memory KV and canaries; the **scripted fake Frontify** (Testing Decisions) recording every request (method, path, query, headers, body, operation name, variables); fixtures (`recorded/` and `synthetic/`) covering: library page of mixed types; image with alt text; image with `isDecorative` true; image with no alt and no description; image with description only; image smaller than 480 px; image 3000 px wide; video; document (PDF); audio; `File` (SVG-icon preview); `EmbeddedContent`; asset in `PROCESSING`; asset outside availability window (future and past) and with `expiresAt` in the past; asset with a licence; asset with `canDownload` false; asset with a null `thumbnailUrl`; `node` returning null; GraphQL `errors[]` variants (permission, validation, internal) with status `200` and `422`; `401`; `429` (with and without `Retry-After`); token responses (normal, missing `expires_in`, missing `refresh_token`); canaries for the client secret, the access token and the refresh token.

### 1.1 Authorize URL and code exchange (AC2)

| ID | Behaviour asserted |
|---|---|
| FA1 | `begin` redirects to `https://{FRONTIFY_DOMAIN}/api/oauth/authorize` with `response_type=code`, the configured `client_id`, `redirect_uri` equal to the deployed callback, `scope=basic:read` and the sealed `state`; the Location contains no client secret; the host is the configured domain, never taken from the request |
| FA2 | Happy callback (code via `code`): the fake receives exactly one POST to `/api/oauth/accesstoken` with a **JSON** body (`grant_type=authorization_code`, `code`, `client_id`, `redirect_uri` identical to the authorize request, `scope`, the client secret); one `currentUser` GraphQL call; an encrypted record is stored for the calling user |
| FA3 | The code arrives as `authorization_code` instead (FG1): accepted when the shell supports the alias, or the test is marked expected-skip with the FG1 reference when it does not (the fake's switch makes the difference visible) |
| FA4 | The exchange never uses a urlencoded body (the fake answers `415`/`400` to urlencoded; the flow still succeeds) |
| FA5 | Token response without a numeric `expires_in`, or without `refresh_token`: generic failure page, nothing stored, upstream body not echoed |
| FA6 | `currentUser` fails (`errors[]`, `401` or scope error): the connection is still stored, `account.displayName` is absent and `session` reports `connected` without a name (no failure page) |
| FA7 | Exchange answers `400 invalid_grant`, `5xx` or a network error: generic failure page, nothing stored, an existing record for the user untouched |
| FA8 | The client secret appears nowhere in any response, header, `Location`, log line or the stored KV bytes (canary; extends TS6/US1) |

### 1.2 Tokens, refresh, rotation, revoke (AC2)

| ID | Behaviour asserted |
|---|---|
| FT1 | Stored `accessExpiresAt` equals injected `now + expires_in`; a token with more than 60 s left triggers no refresh (RF1 with Frontify's long lifetime, e.g. 2,591,998 s) |
| FT2 | Expired or near-expiry token: exactly one POST to `/api/oauth/refresh` with a JSON body (`grant_type=refresh_token`, the stored refresh token, `client_id`, client secret, `scope`); the following search carries the **new** access token |
| FT3 | The refresh response's new refresh token **replaces** the old one in the encrypted record; the old refresh token is not reused (fake rejects reuse) |
| FT4 | **Rotation race:** two concurrent requests with an expired token produce one refresh (single-flight) and both succeed |
| FT5 | **Cross-isolate race:** a second worker instance refreshed first (fake storage already holds a newer record, the fake has consumed the old refresh token): the first instance's refresh fails `invalid_grant`, it re-reads, finds the newer record and succeeds without deleting the connection (RF8 for rotating tokens) |
| FT6 | **Stale access token after another refresh:** a search with the invalidated old access token gets `401`; the worker re-reads, uses the newer record and succeeds without a second refresh; with no newer record it forces exactly one refresh and retries once; a second `401` -> `409 provider_reauth_required` and the record is deleted |
| FT7 | Refresh answers `invalid_grant` with no newer record -> record deleted, `409 provider_reauth_required`, no retry loop; refresh `5xx`/network failure -> `502`, record **kept** |
| FT8 | `disconnect` calls the fake's `/api/oauth/revoke` (token in the body, hint `access_token`) and deletes the record; a revoke failure (`5xx`, network, `400`) still deletes the record and returns `204`; the token never appears in logs |
| FT9 | The access token and refresh token are never present in any response, header, `Location`, log line (canary matrix over connect, search, detail, refresh, revoke, every error) |

### 1.3 Browse and search (AC1)

| ID | Behaviour asserted |
|---|---|
| FB1 | `q`, `type`, `sort`, `page`, `pageSize` map to the library `assets` variables exactly as in the Build Analysis mapping table; outbound `Authorization: Bearer <the user's Frontify token>`, never the IMS token; no inbound `Authorization` forwarded; the host is the Frontify domain only |
| FB2 | Every request is a `POST` to `/graphql` with `Content-Type: application/json` and a body `{ operationName, query, variables }`; the `query` text is identical for any two different search strings (**user input never in the document**), e.g. `q` = a string containing quotes, braces, `}) { __typename`, backslashes, unicode, 300 characters (capped to 200) |
| FB3 | `type=image` sends `types: [IMAGE]`; each of `video`, `document`, `audio` likewise; absent `type` sends no `types`; an unknown `type` or `sort` -> `400 bad_request` with zero upstream calls |
| FB4 | Empty `q`: no `search` variable and default sort `NEWEST`; `sort=relevance` with empty `q` is coerced to `NEWEST`; with `q` it sends `RELEVANCE` |
| FB5 | Items normalise from fixtures: id, title, type from `__typename` (`File`/`EmbeddedContent` -> `other`), `thumbnailUrl`, dimensions, extension, `fileSize`, `dateModified`, warnings; unlisted upstream fields never appear in the response |
| FB6 | `hasMore` equals `hasNextPage`; `total` passes through; an empty library page -> `200` with empty items |
| FB7 | With a non-empty `q`, a page whose first item would be beyond 10,000 -> clean `400 bad_request` with zero upstream calls (FG3); with an empty `q` there is no such window and the request goes upstream; `hasMore` is false at the window edge |
| FB8 | `pageSize` is passed as `limit` and never exceeds 100 even if the shell cap changes (provider clamps) |
| FB9 | Search with a user who has no access to the library (null library / permission error) -> `403`-class `forbidden` with a fixed message, not a 500 |
| FB10 | `thumbnailUrl`: images use the 320 px API-returned sized preview alias, others the API `thumbnailUrl`; a null `thumbnailUrl` leaves the field absent (SG3); non-`https` values are dropped |

### 1.4 Detail and renditions (AC1)

| ID | Behaviour asserted |
|---|---|
| FD1 | `GET /dam/frontify/assets/{id}` sends a `node(id)` query with the id as a variable; the id never appears in a URL path; the document is the same constant text for any id |
| FD2 | Id validation: empty, too long, no `ey` prefix, characters outside the Base64 set, `..`, `%2f`, spaces, a numeric-only id -> `400 bad_request`, zero upstream calls; a valid `ey...` id passes |
| FD3 | `node` returns null, or a node that is not an asset -> `404 not_found` |
| FD4 | An image 3000 px wide yields renditions `w480`, `w800`, `w1200`, `w1600`, `w2400` and `full`, each with an https URL taken **verbatim** from the aliased API fields (no string building: a fixture with sentinel URLs proves URLs are passed through unchanged); every `kind` is `derivative`; no `original` rendition exists for any asset |
| FD5 | An image 1000 px wide: widths >= 1000 are dropped (no upscaling) but `full` stays; an image narrower than 480 px has only `full` |
| FD6 | Default rendition is `w1200` (or `FRONTIFY_DEFAULT_WIDTH`); if the default was dropped as an upscale, the largest remaining `w*` is used, else `full`; an invalid `FRONTIFY_DEFAULT_WIDTH` leaves the provider unconfigured (FK3) |
| FD7 | Only `https:` URLs survive; `http:`, `javascript:`, `data:`, empty and relative URLs are dropped; if no rendition remains -> `insertable: false` with a reason |
| FD8 | `downloadUrl` is never requested by any query document (the schema-validation tests and a fixture request log assert the field name is absent) |
| FD9 | Video, document, audio with a preview URL -> `linkUrl` = that URL and `insertable: true`; the asset has no image `renditions` |
| FD10 | `File` (icon-only preview) and `EmbeddedContent` -> `insertable: false`, reason "no public file URL" |
| FD11 | `PROCESSING` or `PROCESSING_FAILED` status -> `insertable: false`, reason "still being processed in Frontify" (or "processing failed") |
| FD12 | `currentUserPermissions.canDownload = false` -> `insertable: false`, reason "Download-protected in Frontify" (default stance, Question 8) |
| FD13 | All preset-width aliases and the unsized alias coexist in one document without GraphQL alias conflicts (verified by the schema validation test FK11) |

### 1.5 Alt text, warnings, metadata (AC1)

| ID | Behaviour asserted |
|---|---|
| FL1 | `alternativeText` present -> `alt.value` is it, `source: property` |
| FL2 | `isDecorative` true -> `alt.value` is empty, `source: property`, regardless of any `alternativeText`; (with FG4's flag if present: `decorative: true`) |
| FL3 | No alt text, description present -> `source: description`; neither -> title with `_`/`-` turned to spaces and the extension removed (`Hero_Banner-2024.jpg` -> `Hero Banner 2024`), `source: name`; nothing usable -> empty, `source: none` |
| FL4 | HTML tags, entities, control characters are stripped to plain text, whitespace collapsed, alt capped at 500 characters; `"><script>` stays text |
| FL5 | Availability window not yet open, window closed, or `expiresAt` in the past -> warning `archived`; inside the window -> no warning; null window -> no warning |
| FL6 | An asset with at least one licence -> warning `limited-use`; no licences -> none; `watermarked` is never emitted; `copyright.status` alone never produces a warning |
| FL7 | `copyright.notice` is returned as `copyright` (plain text, capped); tags are deduplicated, capped at 20 items of 60 characters |
| FL8 | Warnings never make an otherwise insertable asset non-insertable (warn-only) |

### 1.6 Errors (AC1, AC2)

| ID | Behaviour asserted |
|---|---|
| FE1 | GraphQL `errors[]` with HTTP `200` and with HTTP `422` are both detected; permission category -> `forbidden`; validation category on search -> `bad_request`; internal category or unparseable body -> `502 upstream_unavailable`; no upstream message text in any response |
| FE2 | Upstream `429` -> `429 rate_limited` with `Retry-After` (the upstream value, or a fixed default when absent); no retry beyond the template cap; `5xx` and network errors -> `502`; `401` -> reauth path (FT6) |
| FE3 | A `4xx` or GraphQL-error result is never retried (one upstream call), while `429`/`5xx` follow the template's retry rules; a `POST` GraphQL **query** is retried on `5xx` only because the provider sets the safe-to-retry opt-in (FG5; asserted over a scripted `503, 200` sequence) |
| FE4 | Partial data with errors: a search whose `data.library` is null is an error; a detail whose node is present but with a null optional field maps without an error |

### 1.7 Security (AC2, AC6)

| ID | Behaviour asserted |
|---|---|
| FS1 | `FRONTIFY_DOMAIN` validation: valid host accepted; with a scheme, port, path, query, fragment, userinfo, spaces, an IP literal, an empty value, or a trailing dot (an upper-case host is accepted and normalised to lower case) -> the provider is omitted (PC6), the worker still starts, other providers work |
| FS2 | Host safety: no outbound request ever leaves for a host other than the configured domain, including when Frontify answers a `302` to another host (not followed; the bearer token is never sent there) and when an id or search text contains a URL |
| FS3 | One author's connection cannot be used by another (extends TS4 with the Frontify provider on): B's search -> `409 provider_not_connected`; no Frontify call carries A's token |
| FS4 | Provider namespace isolation: a Bynder record is invisible to Frontify and vice versa (same user); `/dam/providers` lists each independently |
| FS5 | The Frontify client secret, the access and refresh tokens, `code`, `state` and cookies never appear in any log line (extends SC3 with GraphQL request logging: only provider id, operation name, outcome, upstream status, retry count) |
| FS6 | Unauthenticated calls to every `/dam/frontify/*` route -> `401` before any provider code runs; `begin`/`callback` are the only public routes (extends OA11 with the Frontify paths) |
| FS7 | Callback replay, forged/expired state, missing/foreign cookie, `error=access_denied`: same results as OA3-OA10 with the Frontify provider (zero token calls, nothing stored, no input echo) |

### 1.8 Provider contract (AC3; seam P1)

Run the #22 conformance suite once more with Frontify registered (PC1-PC6 apply automatically), plus:

| ID | Behaviour asserted |
|---|---|
| FK1 | PC1: the Frontify module registers (all required members present); removing a member from a copy fails registration at start with a clear error |
| FK2 | PC2/PC3: `search` and `getAsset` outputs validate against the normalised schemas (required keys, no extra keys, https URLs, type enum, `warnings` values from the allowed set) for every fixture |
| FK3 | PC6: each missing/invalid of `FRONTIFY_DOMAIN`, `FRONTIFY_CLIENT_ID`, `FRONTIFY_LIBRARY_ID`, `FRONTIFY_CLIENT_SECRET`, or an invalid `FRONTIFY_DEFAULT_WIDTH` -> provider omitted from `/dam/providers` and `404 provider_not_configured`; Bynder and the stub keep working |
| FK4 | PC4: the authorize URL returns the supplied `state` and `redirect_uri` verbatim; no auth method returns or logs a secret |
| FK5 | **Add-a-module proof (PC5 with the real second vendor):** the real registry gains Frontify by **one registry entry** with no other change to shell code; Bynder, Frontify and the stub coexist; `/dam/providers` shows all configured providers with their own capabilities |
| FK6 | **Rotating-token conformance scenario** (new shared scenario Frontify adds to the suite): a provider whose fake invalidates the old refresh token and old access token on every refresh passes FT3-FT6 through the shell; the same scenario also runs against Bynder's non-rotating fake to prove it is provider-agnostic |
| FK7 | A provider returning a new refresh token on every refresh never leaves the stored record with a stale one, even when a write races a read (in-memory KV with injected delay) |
| FK8 | The outbound helper accepts JSON bodies on `POST` and a provider-computed `allowedHosts` (FG5); a configuration missing either fails FK8 with a pointer to FG5 |
| FK9 | The explicit safe-to-retry opt-in on a `POST` is honoured for `5xx` (FE3) and not honoured for the OAuth token `POST`s (an exchange or refresh is never blindly retried on `5xx`, so a code or refresh token is never replayed after an ambiguous failure) |
| FK10 | `thumbnailUrl` may be absent for a non-image summary (SG3) and still validates |
| FK11 | **Schema validation:** every query document the provider sends validates against the vendored Frontify SDL snapshot (graphql-js `validate`), uses no field the SDL marks beta, uses only operations (queries) and never a mutation, and declares `operationName` |
| FK12 | **Fake self-check (FK-SELF):** the fake enforces single-use refresh and old-token invalidation, rejects urlencoded token bodies, routes by operation name, and its recorded request log matches what the tests expect; a deliberately wrong provider (reuses the old refresh token) makes FT3/FT5 fail |
| FK13 | Fixture hygiene: every fixture is under `recorded/` or `synthetic/`; none contains a token-like string, a non-example domain or a `Bearer` value |

## 2. Browser tests (seam S2; `@web/test-runner`)

No Frontify browser code exists, so these are capability-driven checks of the unchanged shell against Frontify-shaped worker responses (injected `fetch`; SDK stub).

| ID | Behaviour asserted |
|---|---|
| FU1 | Provider list with Bynder and Frontify shows the switcher; with Frontify alone, none (extends UI16); the type filter shows exactly Frontify's four asset types plus "all"; sort options are Frontify's five |
| FU2 | Frontify detail with the rendition list `w480..w2400, full`: selector defaults to `defaultRenditionId`; an asset with only `full` shows one choice |
| FU3 | `alt.source = property` shows the "from Frontify alt text" label; an empty alt with `source = property` shows the "decorative (from Frontify)" state; `source = none` shows "needs alt text" |
| FU4 | `insertable: false` with a reason disables Insert and shows the reason; warnings `archived` and `limited-use` are visible and do not disable Insert |
| FU5 | A summary with no `thumbnailUrl` renders a placeholder with the asset name (no broken image, no exception) |
| FU6 | Insert of an image -> `sendHTML` once with one `<img>` (`src` = chosen rendition, `alt` = field), then `closeLibrary`; a non-image with `linkUrl` -> one `<a>` (extends UI10/UI11 with Frontify-shaped data) |
| FU7 | `provider_reauth_required` for Frontify shows "Reconnect to Frontify"; `forbidden` shows the "no access to the configured library" message |

## 3. End-to-end tests (S1; Playwright, Chromium, hermetic, no credentials)

Servers: static server `:3000`; real worker under `wrangler dev` `:8787` with local KV, `ALLOW_LOCALHOST=true`, Frontify configured (domain = the fake's loopback host, test client id/secret from a temp env file); fake IMS; **fake Frontify** (login page auto-approves and redirects to the worker callback; token, refresh with single-use, revoke, GraphQL; serves 1x1 PNGs for preview/thumbnail URLs; request log exposed). The #1 SDK stub supplies a token signed by the fake IMS key.

| ID | Behaviour asserted |
|---|---|
| FX1 | Full pop-up OAuth with Frontify: Connect -> real pop-up -> fake Frontify login/consent -> worker callback page -> the panel shows "Connected as <name>" and the newest assets |
| FX2 | Search and type filter: the fake's request log shows the `assets` operation with the expected `search`, `types`, `sortBy`, `page`, `limit` variables; thumbnails render |
| FX3 | Select an image -> choose width -> edit alt -> Insert: stub call log is `sendHTML` (exact `<img src alt>` with the chosen rendition URL) then `closeLibrary`; the decorative case inserts `alt=""` |
| FX4 | Token hygiene: page HTML, DOM text, `localStorage`/`sessionStorage`, cookies readable by script, and all network responses contain none of the Frontify access/refresh tokens or the client secret; the binding cookie is HttpOnly |
| FX5 | **Silent refresh with rotation:** the fake issues a 2-second access token; a search after 3 s triggers one refresh (the fake invalidates the old tokens) and succeeds with no prompt; two simultaneous panel actions after expiry cause one refresh |
| FX6 | Revoked connection: the fake answers `invalid_grant` on refresh -> "Reconnect"; disconnect calls the fake's revoke endpoint and the panel returns to the Connect state |
| FX7 | Per-user and provider coexistence: identities A and B (two tokens) see their own Frontify connection state; with Bynder also configured (fake Bynder), connecting one provider does not change the other's state; only expected hosts are contacted |

## 4. Runtime smoke (W2; Node test driving `wrangler dev`, no Cloudflare login)

| ID | Behaviour asserted |
|---|---|
| SM-F1 | The worker bundles and starts with the Frontify provider configured and unconfigured; `/dam/providers` without a token -> `401` |
| SM-F2 | `begin` over real HTTP -> `302` to the (fake) Frontify authorize endpoint with the documented parameters and cookie attributes; `callback` end to end against the fake in workerd: record present in local KV and encrypted |
| SM-F3 | Refresh with rotation in the real runtime: the second refresh with the consumed token fails and the connection survives via re-read; per-request CPU/wall time recorded (informational) |

## 5. Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| FRC1 | #22's RC1 passes with Frontify: the word `frontify` appears in shell/browser/core code only in the single registry entry; vendor files live under `providers/frontify/` (fixture tree with a leak fails) |
| FRC2 | RC2: `providers/frontify/` has a worker module, fixtures (`recorded/` or `synthetic/`), conformance registration and a README section in `apps/multi-dam-picker/README.md` |
| FRC3 | RC4 extended: `FRONTIFY_CLIENT_SECRET` is declared per the SG4 outcome, present in `.dev.vars.example`, absent from `vars`; no tracked `.dev.vars*`; no secret-looking `vars` key |
| FRC4 | RC5 extended: the README Frontify section contains Frontify-side setup, worker config names, redirect URI note, `library` row reference, site config read (none), privacy/retention, troubleshooting |
| FRC5 | The README documents every `FRONTIFY_*` name the worker reads (parsed from the provider's required-config list), and every documented name exists there |
| FRC6 | Registration-footprint check (CI on the PR): changed paths outside `providers/frontify/` are limited to the registry file, wrangler config, `.dev.vars.example` and the extension README; any other changed path (shell, token store, OAuth routes, browser files, `shared/`) fails with a pointer to FG1-FG5/SG* (**machine proof of AC3's "no changes beyond registering the provider"**; runs on pull requests only) |

## 6. Manual verification in EW and against real Frontify (needs interactive logins and an instance; cannot run in CI)

**Accounts and credentials needed:** GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, per #1); two Adobe IMS identities with access to the DA org/site (one with config-edit rights) and Chrome; a **Frontify instance** with API/OAuth access on its plan, a Frontify **account admin** to create an OAuth client (Confidential ON, Support Authenticator OFF, redirect URL(s) for the deployed and, if permitted, the local callback, scope `basic:read`) and to give the domain, client id, client secret and library id; two Frontify users with different permissions on the test library (one without access to it, to exercise `forbidden`); a **dedicated test library** containing: an image with alternative text; an image with no alt text and a description; an image with no alt and no description; an image flagged decorative; an image smaller than 480 px and one larger than 2400 px; a video; a PDF; an audio file; an SVG icon-library or File-type asset; an asset with an availability window in the past; an asset with a licence; a download-protected asset (as the test user); an asset in a non-public library if the instance has one (for MF-R2); Cloudflare account with Wrangler login, the KV namespace from #22, and `FRONTIFY_CLIENT_SECRET` set as a worker secret. Never paste a real access/refresh token or the client secret into chat, issue comments or logs.

**API probe (do first; settles the vendor unknowns; use a throwaway OAuth client and `curl`; record sanitised responses as `recorded/` fixtures):**

- **MF-P1:** run the authorize step in a browser and watch the redirect: which parameter carries the code (`code` or `authorization_code`)? Resolves FG1.
- **MF-P2:** with the new access token, `POST /graphql` for `currentUser { id name }`; note the HTTP status, the `x-oauth-scopes` header and whether `basic:read` suffices (Decision 6).
- **MF-P3:** exchange the code with a JSON body (with and without `client_secret`; once urlencoded; once multipart) and record which work and the response fields (`expires_in`, `scope`, `refresh_token`, `name`); call `/api/oauth/refresh` with the documented parameters; record the working parameter list.
- **MF-P4:** repeat the authorize step with a PKCE challenge on the confidential client: accepted, ignored or required?
- **MF-P5:** refresh once, then (a) reuse the consumed refresh token (expect failure), (b) use the old access token (expect `401`); call `/api/oauth/revoke` on an access token, then try the refresh token from the same grant.
- **MF-P6:** can the OAuth client hold two redirect URLs (deployed and `http://localhost:8787/...`)? If not, create the second client for local work.
- **MF-P7:** record the real `429` and GraphQL-error responses (status, headers, body category) by sending a deliberately invalid query and, carefully, a few rapid requests; do not trigger a block.

**EW verification:**

- **MF0 (prereq/liveness):** `wrangler deploy`; `curl -i <worker>/dam/providers` -> `401`; `wrangler secret list` shows `FRONTIFY_CLIENT_SECRET` by name only; vars set. Proves AC6 (unauthenticated rejected on the deployed worker).
- **MF1 (`ref=local`):** terminal A `npm start` (3000), terminal B worker dev (8787). Open a document in the EW editor with `?ref=local`; open **Multi-DAM Picker**; choose **Frontify**; Connect -> Frontify login/consent (scope listed: read) -> pop-up reports success -> panel shows "Connected as <you>" and the newest assets; search a keyword; filter to Images; open an image with alt text: alt prefilled from Frontify with its source label; pick 800 px; insert; inspect the document source: one `<img>` with the chosen `src` and the alt; the library closes. Proves AC1, AC2, AC5 (local), AC3 in practice.
- **MF2 (branch ref):** push branch `multi-dam-picker-frontify` (simple name), wait for code sync, open the editor with `?ref=<branch>`, repeat MF1 against the deployed worker. Proves AC5 (branch ref).
- **MF3 (per user and identity):** the second Adobe user connects with the second Frontify user: sees only what that Frontify user may see; the first user's connection is unaffected; the user without library access sees the "no access to the configured library" message; Disconnect then Reconnect; verify upstream revoke: the access token captured in MF-P5-style probing no longer works after Disconnect (record which token types are dead). Proves AC2 (per-user), isolation.
- **MF4 (refresh and revocation):** access tokens last at least a week (a customer can configure the lifetime, authentication page), so a real wait is impractical: if the admin can set the shortest lifetime, wait for expiry and search again (silent success); otherwise rely on FX5/FT* and verify revocation: in Frontify, revoke the author's authorisation (or the OAuth client's tokens), search again: panel shows Reconnect, no error loop. Proves AC2 (refreshed server-side, revoked handled).
- **MF5 (secret hygiene):** search DevTools Network responses, page source and Application storage for the client secret and tokens (none; binding cookie HttpOnly); `wrangler kv key get` of a Frontify record shows ciphertext only; rotate `TOKEN_ENC_KEY` with `TOKEN_ENC_KEY_PREVIOUS` set and confirm no reconnect is needed. Proves AC2, AC6.
- **MF6 (publish round trip):** preview and publish a page containing an inserted Frontify image; open the published page in a private window (no Frontify or Adobe session): the image loads (also a MF-R2 data point). Record whether EDS kept the external URL (#22 M6/R12).
- **MF7 (negative checks on the deployed worker):** `Origin: https://evil.example` with a valid token -> `403`; no token -> `401`; `GET /oauth/frontify/callback?code=x&state=y` with no cookie -> generic failure and no new KV record. Proves AC6.
- **MF8 (metadata cases):** for each seeded asset confirm: alt source labels (property / description / name / none), decorative handling, availability and licence warnings, download-protected and processing assets not insertable with reasons, File/SVG-icon asset not insertable, video/PDF inserted as a link that opens; a Boolean search (`logo AND guidelines`, a quoted phrase) behaves as documented.
- **MF9 (README walk-through):** a reviewer follows the Frontify README section from a clean clone to a working local picker (admin steps included); any missing step is fixed in the PR. Proves AC4.
- **MF-R1 (rendition parameters):** for one 3000 px image, request the aliased `previewUrl(width: N)` for each preset in the Explorer or by `curl`, fetch each URL and check the downloaded width and bytes: do widths resize as named, is anything upscaled, does `full` exceed 4096 px, what format is served; if sized URLs do not resize, decide the documented-grammar fallback (Decision 12).
- **MF-R2 (anonymous reachability):** `curl -I` each rendition URL with no cookies or token (also from a different network and in a private window): expect `200` and an image content type, for assets in the configured library and, if available, in a non-public library; record. This is the gate for AC1's "appropriate rendition URL".
- **MF-R3 (link longevity):** edit the asset in Frontify (new revision) and revoke the user's token: the previously fetched static URL still loads the old revision.
- **MF-Q1 (real query check):** run each of the provider's three query documents against the real instance in the GraphQL Explorer or `curl` with the probe token; confirm no `errors`, every field populated as the fixtures assume (`BigInt` `size`, null `thumbnailUrl`, `tags`, `licenses`, `availability`).

Record results and screenshots in the PR (the PR template asks for the branch-ref test URL).

## 7. CI additions (no credentials, no Cloudflare login)

| Job | Steps | Notes |
|---|---|---|
| `lint` (existing) | ESLint + Stylelint over the provider; `npm run check` runs FRC1-FRC5 (and FRC6 on pull requests) | |
| `unit` (existing) | WTR runs FU1-FU7 with the shell's UI tests | |
| `worker-unit` (existing) | Node tests: FA, FT, FB, FD, FL, FE, FS, FK (including FK11 schema validation and FK12 fake self-check) with #22's OA/TS/RF/BR/RD/AT/PC/SC and the template's UA/UC/UP/US | one job; the conformance suite now runs with Bynder, Frontify and the stub |
| `worker-smoke` (existing) | SM-F1-SM-F3 | advisory vs required per #2 Question 11 |
| `e2e` (existing) | static server + worker + fake IMS + fake Frontify (and fake Bynder for FX7); FX1-FX7 | Chromium only; upload traces on failure |

All run on every push and PR (#1 decision). Branch protection requiring them is an owner repo-setting.

## 8. Acceptance-criteria traceability (ticket #24)

| # | Acceptance criterion (#24) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Author can browse and search Frontify, filter by type, and insert an image with an appropriate rendition URL and alt text from DAM metadata | FB1-FB10 (search/filter/sort/paging mapping, injection safety, window, access), FD1-FD13 (detail, id validation, preset-width renditions taken verbatim from the API, no upscaling, https-only, no original/download URL, non-image links, insertability), FL1-FL8 (native alt text, decorative, fallback chain, sanitising, warnings), FE1-FE4, FK2, FK11 (queries valid against the published schema); FU1-FU7; FX2, FX3 | **MF1** (browse, search, filter, insert, inspect `<img>` and alt in the document), **MF8** (metadata cases), **MF6**, **MF-R1/R2/R3** (renditions are right-sized, publicly reachable, stable), **MF-Q1** (real documents work) |
| AC2 | Per-user OAuth with Frontify goes through the worker; tokens are stored and refreshed server-side | FA1-FA8 (authorize URL, JSON exchange, client secret server-side, failure paths), FT1-FT9 (expiry, refresh, **single-use rotation, races, stale token, revoke**), FS3-FS4, FS7 (per-user, provider isolation, sealed callback), FK6-FK7 (rotating-token conformance); FX1, FX4-FX7; SM-F2, SM-F3 | **MF-P1-P7** (real OAuth behaviour), **MF1** (connect), **MF3** (per-user, revoke upstream), **MF4** (revocation), **MF5** (ciphertext in KV) |
| AC3 | Added inside the existing `multi-dam-picker` folder as a new provider; no changes needed in the extension shell beyond registering the provider | FK1-FK5, FK10 (interface enforced, add-a-module with the real second vendor, isolation, coexistence), FRC1, FRC2 (no vendor leakage, folder completeness), **FRC6 (changed paths limited to the provider folder plus the registration footprint)**, FK8-FK9 (shell helpers sufficient); FU1 (capability-driven UI) | Review: PR diff stat shows no shell/browser/core change; FG1-FG5/SG3-SG5 resolved in #22's stream (or fallbacks applied) before this PR; **MF1** (Frontify appears and works with no shell edit) |
| AC4 | Extension README documents this vendor's setup (credentials, site config keys) | FRC4, FRC5 (README section present and in sync with the worker's `FRONTIFY_*` names; site config read stated as none), FRC2 | **MF9** (clean-clone walk-through incl. the Frontify admin steps); review: OAuth client settings, redirect URLs, scope, library id, static-link and download-protection behaviour are stated |
| AC5 | Works in EW with `ref=local` and with a branch ref | FX1-FX7 prove the page + worker + Frontify contract on `localhost:3000`/`localhost:8787` against the fake | **MF1** (`ref=local`), **MF2** (branch ref against the deployed worker, real `Origin`), **MF6** |
| AC6 | Vendor credentials live only in this extension's worker (from the shared template); the browser never receives them; unauthenticated calls to the worker are rejected | FS6, FS5, FA8, FT9 (no secret/token leakage), FS1-FS2 (only the configured host), FRC3 (secret declared, none in vars/git), template UA1-UA14 and #22 OA11, SC1-SC5, TS6 on these routes; FX4, FX7; SM-F1 | **MF0** (bare `curl` -> 401), **MF5** (secret hygiene), **MF7** (negative checks on the deployed worker) |
| AC7 | Core logic covered by unit tests; lint and CI green | All of sections 1, 2, 5 run in `worker-unit`, `unit`, `lint`; e2e and smoke jobs green; FK11 and FK13 guard schema and fixture quality | Review: CI shows all jobs green on the PR; deliberately break a rule on a scratch branch (e.g. send the refresh as urlencoded, or reuse the old refresh token) and see FA4 / FT3 fail |

Every acceptance criterion on #24 maps to at least one automated test and one numbered manual or review step above. (AC3's "no shell changes" is machine-proved on PRs by FRC6 and by the conformance suite; its dependence on FG1-FG5/SG3-SG5 being settled first is a scheduling prerequisite, not a test. AC1's "appropriate rendition URL" and AC2's real-Frontify behaviour are irreducibly manual until a Frontify instance exists, because the fakes encode what the docs say, not what the CDN does.)

## 9. Open questions for the owner

1. **Interface gaps FG1-FG5 (and the #23 gaps SG3-SG5).** May #22's shell be amended additively, in #22's stream and before #24 builds, with: **FG1** accept the OAuth code under `code` or `authorization_code` (only if probe MF-P1 shows Frontify uses the latter); **FG2** rotating refresh-token semantics made explicit (a returned refresh token always replaces the old one; re-read storage before a forced refresh and before delete) plus a shared rotating conformance scenario; **FG3** an optional provider `maxResultWindow` capability (default: the provider rejects an over-window page itself); **FG4** optional `alt.decorative` and more warning values (default: map into the existing vocabulary); **FG5** outbound helper supports JSON `POST` bodies, a provider-computed `allowedHosts`, and the safe-to-retry opt-in for read-only `POST` queries? If declined, the provider falls back as described and AC3 still holds, at the cost of vocabulary fidelity (FG4) and of races being possible until Durable Objects (FG2).
2. **Per-provider secrets (SG4).** `secrets.required` fails deploy when a secret is missing but is also the only way a secret is read from `.dev.vars` locally (#2 Decision 7). With Bynder, Cloudinary and Frontify in one worker, must a site that only uses Frontify set Bynder's and Cloudinary's secrets to dummies, or does #22 move provider secrets to "optional, validated per provider at start"? This spec follows #22/#23's outcome.
3. **Frontify instance and plan (R1, R14).** Is there a Frontify instance (or an approved sandbox via https://developer.frontify.com/document/162#/-/request-developer-sandbox) with an admin who can create the OAuth client and seed a test library, and does the plan include API/OAuth access? Who owns it? Without it, real verification of AC1/AC2/AC5/AC6 and every MF step is blocked and fixtures remain synthetic.
4. **One instance, one library per site.** Is a single configured library per EW site enough? (Multiple libraries need a library selector or Frontify's beta brand-level search; workspace projects and folders are not browsable.) Should detail lookups be pinned to the configured library, or is "Frontify permissions are the boundary; the library is only a browsing scope" acceptable?
5. **Search API choice.** Use the GA offset-paged library `assets` field (this spec: total/page counts, 10,000-result window for keyword searches, "newest" sort of unspecified meaning) rather than the new cursor-paged `searchAssets` (typed filters, `LAST_MODIFIED` sort, no cap without a keyword, but index lag of up to about 10 minutes and a cursor-only upstream)? Is "Newest" acceptable in place of #22's "recently modified" default?
6. **Static vs dynamic CDN links.** Insert revision-pinned static preview URLs (this spec: stable, GA, never follow edits) or the beta dynamic URL (always the latest revision; needs beta and development-flag headers and is not in the published schema)? Authors replacing a brand asset in Frontify will not see the change on pages built with static links.
7. **Warnings mapping.** Is `limited-use` = "has a licence attached" and `archived` = "outside its availability window or past `expiresAt`" acceptable, with copyright status shown as text only? Or do you want new generic warning values (`expired`, `not-yet-available`, `copyrighted`) added to the shared vocabulary?
8. **Download-protected assets.** Block insertion when the current user cannot download the asset (this spec, conservative: publishing a preview contradicts a download restriction), or warn only? Block assets that are still processing (this spec) or allow?
9. **Test dependency and fixture size.** May the repo add `graphql` as a devDependency and a vendored (about 300 KB) Frontify SDL snapshot with a documented refresh script, so CI can validate every query document against the published schema (FK11)? If not, the fallback is golden-string tests plus MF-Q1 only.
10. **Public reachability of previews.** Do you know whether a Frontify preview (CDN) URL loads for an anonymous visitor for assets in a non-public library, and whether the customer's Frontify policy allows embedding such URLs on a public site? MF-R2 will observe it; tell me earlier if you know. If Frontify previews require a session for some libraries, "insert a preview URL" is not viable for those libraries.
11. **Width presets.** Are 480 / 800 / 1200 / 1600 / 2400 / full and a 1200 default right for your pages, and should `FRONTIFY_DEFAULT_WIDTH` stay the only knob?
12. **Names and values.** The configuration names (`FRONTIFY_DOMAIN`, `FRONTIFY_CLIENT_ID`, `FRONTIFY_LIBRARY_ID`, `FRONTIFY_DEFAULT_WIDTH`, `FRONTIFY_CLIENT_SECRET`), the worker redirect path `/oauth/frontify/callback`, and the `ORG`/`SITE` assumption (`jazhou-adobe`/`ew-extensions`, #1 R10) are proposals; confirm or give the real values.
13. **Policy and privacy (carried from #22 Question 13).** Frontify access tokens may be valid for up to three months and refresh tokens are long-lived; they are stored against Adobe user ids in a Cloudflare account. Which account, who signs off, and should the README ship a retention/deletion statement (purge command, revoke on disconnect) before real user data is stored?
