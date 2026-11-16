# Spec: Multi-DAM Picker: Bynder (OAuth provider on #25's plumbing)

Ticket: jazhou-adobe/ew-extensions#22 (this spec: #60). Blocked by #25 (Dropbox: adds the provider-agnostic per-user OAuth plumbing; spec `apps/multi-dam-picker/providers/dropbox/SPEC.md`), which is blocked by #23 (Cloudinary: picker shell and provider interface; spec `apps/multi-dam-picker/SPEC.md`), which is blocked by #1 (repo scaffold; spec `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec `shared/worker-template/SPEC.md`). #22 blocks nothing; #24 (Frontify) is its sibling follow-up.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1, #2, #23 and #25 specs): **[VERIFIED]** = read in a primary source (URL given) on 2026-11-16; **[VERIFIED*]** = verified the same day in the earlier (Bynder-first) draft of this spec and carried over, not re-read in this respec; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe, Bynder or Cloudflare.

Vocabulary follows #23 and #25: *extension* = the folder `apps/multi-dam-picker/` (a **library plugin**; its type comes from its `library` config-sheet row); *worker* = the one per-extension backend in `apps/multi-dam-picker/worker/`, built from `shared/worker-template/`; *provider* = one DAM integration; *shell* = the provider-agnostic browser UI plus the provider-agnostic worker core; *credential kind* `user-oauth` = each author's own OAuth connection; *OAuth plumbing* = everything provider-agnostic that #25 builds (connect/disconnect routes, sealed state and binding cookie, encrypted token store, refresh orchestration, credential injection, per-user cache scope, connect panel); *IMS token* = the Adobe IMS access token the DA App SDK hands the extension. Added here: *portal* = one Bynder tenant (a host such as `{name}.bynder.com` or a custom domain) in which the OAuth app is registered; *derivative* = a Bynder pre-rendered or on-the-fly version of an image (standard names `mini`, `thul`, `webimage`, plus portal-specific custom ones).

Delivery order (owner decision, carried from #23 and #25): #23 Cloudinary builds the shell and the provider interface; #25 Dropbox builds the per-user OAuth plumbing; **#22 Bynder (this ticket) adds one provider module and nothing else**: provider configuration plus HTTP mappings, no token-storage code, no shell change beyond one registry line. This spec therefore describes the Bynder **mapping** (what each plumbing hook and each browse hook does for Bynder) and the **evidence** that the mapping fits #25's interface exactly. Where Bynder exposes a gap in #25's plumbing, the gap is recorded as an **amendment request to ticket #25** in section 9 (A1 to A7) with a fallback, not redesigned here.

Primary sources read on 2026-11-16 (all re-read for this respec unless marked): Bynder authorize endpoint (https://api.bynder.com/reference/get_v6-authentication-oauth2-auth), token endpoint with authorization code (https://api.bynder.com/reference/post_v6-authentication-oauth2-token-authorization) and with refresh token (https://api.bynder.com/reference/post_v6-authentication-oauth2-token-refresh), "Integrating with Bynder" (scopes, rate limit, identifier formats: https://developers.bynder.com/integrate), Getting started (https://developers.bynder.com/getting-started), "How to create and manage OAuth 2.0 apps" (https://support.bynder.com/hc/en-us/articles/360013875180-How-To-Create-And-Manage-OAuth-2-0-Apps-to-Provide-Access-to-Bynder-API), "Understanding and enabling public assets" (https://support.bynder.com/hc/en-us/articles/360013870200-Understanding-And-Enabling-Public-Assets), Retrieve assets (https://api.bynder.com/reference/get_api-v4-media), Retrieve specific asset (https://api.bynder.com/reference/get_api-v4-media-id), Retrieve current user (https://api.bynder.com/reference/get_api-v4-currentuser), Retrieve derivatives (https://api.bynder.com/reference/get_api-v4-account-derivatives), Universal Compact View (https://developers.bynder.com/universal-compact-view), the Bynder API index (https://api.bynder.com/llms.txt), and, for the rotation inference only, the Ory Hydra debugging page snippet (https://www.ory.com/docs/hydra/debug). Carried [VERIFIED*]: the Contentful Bynder app (https://github.com/contentful/marketplace-partner-apps/tree/main/apps/bynder), Cloudflare KV limits and consistency, the da-live iframe and SDK sources (through #1, #2, #23 and #25).

---

## Problem Statement

Content authors in Experience Workspace (EW) can insert images from AEM Assets (first-party) and, after #23 and #25, from Cloudinary and Dropbox. Many brands keep their governed brand assets in **Bynder**. Today an author who wants a Bynder image leaves EW, finds the asset in the portal, works out which public URL is safe to use (a private or expiring link, an oversized original, a limited-use asset), copies it, pastes it and retypes alt text from the asset's description. Nobody checks that the URL works for a visitor or that the alt text exists.

Bynder is a **per-user OAuth DAM**: what an author may see depends on their own Bynder permissions (brand, category and metaproperty access), and Bynder says a token never exceeds what its user could already do [VERIFIED: https://developers.bynder.com/integrate, "We only grant scopes that match the user's underlying permissions"]. A shared service account would flatten every EW author into one identity, so the picker needs each author to connect their own Bynder account. That machinery (connect and disconnect from the library iframe, a public callback made safe without an `Authorization` header, an encrypted server-side token store, silent refresh) is exactly what #25 builds once, provider-agnostically. This ticket must **use** it, not rebuild it.

Bynder differs from Dropbox in ways that decide the provider half:

1. **Per-portal hosts.** Every Bynder call, including the OAuth authorize and token endpoints, goes to the customer's own portal host, so the hosts the shell pins (authorize, outbound, delivery) are a function of configuration, not constants [VERIFIED: the token endpoint reference says the endpoint is `https://example.com/v6/authentication/oauth2/token` with the placeholder replaced; Getting started shows `https://{portal-domain}.bynder.com/v6/...`].
2. **Rendition URLs exist, and they are opaque.** Unlike Dropbox, Bynder's API returns ready-made public URLs (`thumbnails.mini|thul|webimage`, a public `original`, public custom derivatives in `mediaItems`), and Bynder is migrating its public link format (`/m/...` to `/asset/...`) and says integrations that consume URLs as returned need no change [VERIFIED: public assets article]. The module must never build or parse them.
3. **Real DAM metadata.** Bynder has `name`, `description`, `copyright`, `tags` and site-defined metaproperties (`property_<name>`), so alt text can come from real metadata, but there is no dedicated alt-text field, so the metaproperty must be configurable [VERIFIED: media schemas list no alt field].
4. **Refresh tokens that probably rotate and cannot be revoked per token.** The refresh response schema returns a `refresh_token` whose example differs from the one sent [VERIFIED: refresh reference, request example `c11e...b5bc`, response example `c12e...b5dc`; weak evidence], the authorize redirect uses a `login_challenge` (the Ory Hydra login-provider vocabulary, [ASSUMPTION] Bynder uses it) and Hydra's refresh tokens are single-use [VERIFIED: snippet of https://www.ory.com/docs/hydra/debug]. Bynder publishes no per-token revoke endpoint; a portal admin can revoke all refresh tokens of an OAuth app [VERIFIED: support article]. Both facts stress parts of #25's plumbing that Dropbox does not (rotation races, retry safety, "Disconnect").
5. **A portal that has to be enabled by a vendor.** OAuth Apps must be enabled by Bynder Customer Support, the registering admin needs "Manage portal settings" and "Manage OAuth apps", the client secret is shown once, and an OAuth app's scopes cannot be edited later (a new app is needed) [VERIFIED: support article]. No self-serve sandbox was found. This is why Bynder comes after Dropbox, and why real verification is an owner prerequisite.

## Solution

**Bynder** appears in the existing Multi-DAM Picker as a source next to Cloudinary and Dropbox when its worker configuration is present. An author chooses *Bynder*, sees the shell's **Connect to Bynder** panel (built in #25), signs in to the portal in a pop-up with their own Bynder account (including company SSO) and consents to read access. The panel then shows "Connected as <name>" with **Disconnect** and the author's own view of the asset bank: the most recently modified assets first, a thumbnail grid with names, keyword search (debounced), a type filter (images, videos, documents, audio), sorting (recently modified, recently created, name) and "Load more". Opening an asset shows a larger preview, name, dimensions, type, size and any limited-use, archived or watermarked warning. The author picks a **rendition** (default Bynder's `webimage`; the other standard derivatives, the portal's public custom derivatives and, when Bynder returns it, the public original), reviews alt text prefilled from a configurable Bynder metaproperty (else the asset description, else a cleaned-up name; editable, or marked decorative) and inserts it at the cursor as an `<img>` with the exact URL Bynder returned. Videos, documents and audio with a public URL are inserted as a link.

Behind it nothing new is built on the security side. The Bynder **provider module** supplies pure HTTP mappings to #25's `user-oauth` interface: the authorize URL on the portal host, the code exchange and refresh calls (form-encoded, client credentials in the body), the current-user lookup for the account label, the failure classification, and the browse mappings (`/api/v4/media/` with `keyword`, `type`, `orderBy`, `page`, `limit`). The plumbing owns state sealing, the binding cookie, token encryption and storage, refresh orchestration (including single-use rotation), credential injection and per-user caching. The Bynder client secret exists only in the worker's secret store; every Bynder token exists only in the worker and in encrypted KV; the browser holds only its own IMS token and normalised asset data.

The ticket's acceptance criterion "no changes needed in the shell beyond registering the provider" is made **machine-checkable**: the diff that adds Bynder touches only the provider's own folder, one registry line, wrangler `vars`, `.dev.vars.example` and the README section, and a repo check proves nothing else mentions the vendor and that the provider folder contains no token-storage, encryption or cookie code.

## User Stories

Content author (EW end user):

1. As a content author, I want Bynder to appear as a source in the Multi-DAM Picker, so that I can use the assets my brand team governs there.
2. As a content author, I want a clear "Connect to Bynder" button the first time, so that I know I must sign in before I can see assets.
3. As a content author, I want to sign in with my own Bynder account (including my company's SSO) in a pop-up, so that the picker shows exactly what Bynder allows me to see.
4. As a content author, I want the sign-in to finish by itself and the panel to show my assets without a reload, so that connecting is one smooth step.
5. As a content author, I want the picker to remember my Bynder connection across sessions and browsers, so that I am not asked to sign in every time.
6. As a content author, I want to see which Bynder account I am connected as, so that I notice when I connected the wrong user.
7. As a content author, I want a "Disconnect" action, and an honest note that it removes the picker's stored access but that a portal administrator controls revocation inside Bynder, so that I am not told something is revoked when it is not.
8. As a content author, I want a plain "Reconnect" prompt when my Bynder access was revoked or expired for good, so that I am never stuck on a cryptic error.
9. As a content author, I want a generic "ask your administrator" message, with no Reconnect loop, when the portal's OAuth app is misconfigured, so that I do not keep retrying something I cannot fix.
10. As a content author, I want a clear message when my Bynder account does not have the permissions the picker needs (so that Bynder granted fewer scopes), instead of a silent failure, so that I know to ask a Bynder admin [see amendment A5].
11. As a content author, I want to cancel Bynder's consent screen and be returned to the picker in a plain "not connected" state, so that cancelling is harmless.
12. As a content author, I want to browse and search the asset bank by keyword (file name, tag, extension), so that I can find an asset without knowing where it lives.
13. As a content author, I want typing to search after a short pause (Enter searches at once), so that I need no Search button and trigger no request per keystroke.
14. As a content author, I want to filter by type (all, images, videos, documents, audio), so that I only see assets I can use at the cursor.
15. As a content author, I want the most recently modified assets before I search, so that the panel is useful right after connecting.
16. As a content author, I want to sort by recently modified, recently created or name, so that I can order the list the way I think about it.
17. As a content author, I want a thumbnail grid with the asset name, so that I can recognise assets at a glance.
18. As a content author, I want "Load more" instead of an endless list, so that the panel stays fast on a portal with tens of thousands of assets.
19. As a content author, I want a stale search never to overwrite a newer one, so that the grid always matches what I typed last.
20. As a content author, I want a larger preview with name, dimensions, type and size, so that I can confirm it is the right asset.
21. As a content author, I want to choose a rendition (default `webimage`; the other standard derivatives, public custom derivatives and, when public, the original), so that I never publish a multi-megabyte original by accident.
22. As a content author, I want the original offered only when Bynder actually returns a public original and the format displays in a browser, so that I never insert a URL visitors cannot load.
23. As a content author, I want the inserted URL to be exactly what Bynder returned, so that Bynder's link-format changes and custom CDN domains keep working.
24. As a content author, I want alt text prefilled from my portal's alt-text metaproperty, else the asset description, else a cleaned-up name, and to see which source was used, so that accessible markup is the default.
25. As a content author, I want to edit the alt text or mark the image decorative (empty alt), so that I can adapt it to the page.
26. As a content author, I want a visible warning when an asset is limited-use, archived or watermarked in Bynder, so that I do not publish something I should not.
27. As a content author, I want one click to insert the chosen rendition at my cursor and the library to close, so that I keep editing.
28. As a content author, I want videos, documents and audio with a public URL inserted as a link with the asset name as text, so that non-image assets are not a dead end.
29. As a content author, I want assets with no public rendition or link marked not insertable with a one-line reason, so that I never publish a broken link.
30. As a content author, I want an understandable message with the wait time when Bynder is rate-limiting me or is down, so that I know whether to retry now or later.
31. As a content author, I want the connect panel, switcher and grid usable with the keyboard and a screen reader, so that the tool works for everyone on the team.
32. As a content author, I want my Bynder view never visible to another EW author using the same picker, so that Bynder permissions stay personal.

Site administrator / maintainer:

33. As a site admin, I want to enable Bynder with worker configuration only (no new config-sheet row, no browser change), so that adoption is a deploy step.
34. As a site admin, I want the README to list every Bynder-side step (ask Customer Support to enable OAuth Apps, the permissions needed, creating the app, the scopes, both redirect URIs, that the secret is shown once and scopes cannot be edited later) and every worker var and secret, so that I can set it up without reading code.
35. As a site admin, I want to point the picker at my portal with one setting, so that no code change is needed for my tenant.
36. As a site admin, I want to name the metaproperty that carries alt text, so that a portal with a real alt-text property gets it used.
37. As a site admin, I want to choose the default derivative, so that a portal with a preferred public derivative gets it as the default.
38. As a site admin on a custom CDN or SEO base URL, I want to list my delivery hosts, so that the picker accepts my public URLs and still rejects any other host.
39. As a site admin, I want an optional switch that limits the picker to assets marked public in Bynder, so that authors cannot hotlink assets I did not publish.
40. As a site admin, I want a Cloudinary-only or Dropbox-only site to keep deploying without Bynder settings, so that adding Bynder to the codebase forces nothing.
41. As a site admin, I want a start-up error that names missing items when Bynder is configured but the OAuth plumbing is not, so that I never debug a silently missing provider.
42. As a site admin, I want the README to say plainly what Disconnect does and does not remove in Bynder and how to revoke all tokens of the app, so that I can offboard someone properly.
43. As a site admin, I want the README to say that replacing the OAuth app (for example to change scopes) makes existing connections reconnect, so that I am not surprised.
44. As the maintainer, I want the Bynder client secret, every access token and every refresh token to exist only in the worker, so that nothing sensitive is in the public site.
45. As the maintainer, I want every worker call rejected without a valid IMS token (the two sealed OAuth routes excepted, as in #25), so that the worker is not an open door to a portal.
46. As the maintainer, I want refresh of a rotating token never to be retried blindly and a lost rotation to end in a clean "Reconnect", so that a network blip cannot silently burn a connection or loop.
47. As the maintainer, I want the whole flow (pop-up OAuth, search, detail, rotating refresh, revoked grant) tested in CI against a fake Bynder with no credentials, plus recorded fixtures from a real portal, so that no secrets are needed on every push.
48. As the maintainer, I want unit tests for the core logic and lint and CI green on every push and PR, so that regressions do not merge.

Provider author (#24 Frontify) and the reviewer of this ticket:

49. As the author of #24, I want to see what Bynder needed on top of Dropbox and what it did not (nothing in the shell), so that Frontify can be estimated honestly.
50. As the reviewer, I want the Bynder diff to touch only its own folder, the registry line, wrangler vars, `.dev.vars.example` and the README section, so that "no changes needed in the shell beyond registering the provider" is checkable.
51. As the reviewer, I want a check that the provider folder contains no storage, encryption or cookie code, so that "uses the existing OAuth plumbing; no new token-storage code" is checkable.
52. As the reviewer, I want every gap in #25's plumbing that Bynder exposed written down as an amendment request with a fallback, so that #25 can absorb it before Bynder is built.

## Implementation Decisions

(No file paths or code, except endpoint names, parameter names and wire contracts, which are API contracts. Layout is in the Build Analysis.)

**D1. Scope: one provider module on #25's plumbing; no shell change.** The ticket delivers the Bynder module (its mappings, fixtures, tests and README section) and exactly four touch points outside its folder: the registry entry, the worker's wrangler `vars`, `.dev.vars.example` and the extension README. The shell, the OAuth plumbing, the browser code and the template are not changed. If #25's plumbing needs a change for Bynder, it is made **in #25** (amendments A1 to A7, section 9); this ticket does not carry shell work. The module is a `user-oauth` provider in the sense of #23 D3 and #25 D5.

**D2. Surface and registration unchanged.** Library plugin only; the one `library` row from #23 is unchanged; **no new config-sheet row and no new entry page; site config read: none** (README states it). Bynder appears in the panel when its worker configuration is present and the OAuth plumbing is enabled (#25 D4); a Bynder-configured deployment without the plumbing fails to start naming the missing items (#25 D4).

**D3. Build our own UI on the HTTP API; do not embed Bynder's Universal Compact View (UCV).** UCV is Bynder's ready-made picker but it authenticates in the browser ("Pass an existing access token to skip the login screen entirely"; it works with every portal login method [VERIFIED: https://developers.bynder.com/universal-compact-view]); that contradicts the criterion that tokens are stored and refreshed server-side and never reach the browser, and it is single-vendor, which cannot be the capability-driven shell. Contentful's Bynder app uses UCV (https://github.com/contentful/marketplace-partner-apps/tree/main/apps/bynder [VERIFIED*]) and is prior art for insertion semantics (default `webimage`) only. The decision mirrors #23 D2 and #25 D3.

**D4. Provider identity, kind and config-derived hosts.** `id` = `bynder`, `label` = `Bynder`, `credentialKind` = `user-oauth`. The provider is *configured* when `BYNDER_PORTAL_DOMAIN`, `BYNDER_CLIENT_ID` and `BYNDER_CLIENT_SECRET` are all present (#23 D5, #25 D16). **The portal host drives three of the interface's host lists**, all derived from the one validated setting: `authorizeHosts` = the portal host, `outboundHosts` = the portal host (the authorize redirect, the token endpoint and the API are all on it [VERIFIED: authorize reference redirects to `https://your-bynder-domain/v6/login-provider/login...`; token reference; the account and media references list `https://{your-bynder-domain}/`]), `deliveryHosts` = the portal host plus the administrator's optional list (D10). `BYNDER_PORTAL_DOMAIN` is a bare DNS host name: no scheme, path, port, userinfo or IP literal, lower-cased, validated at registration naming the setting and never echoing its value. [Needs amendment A1 to be confirmed in #25: `authorizeHosts` and `scopes` may be functions of validated configuration, as `deliveryHosts` and Cloudinary's `outboundHosts` already are.] A test-only `BYNDER_TEST_ORIGIN` redirects the portal host to a loopback fake and is honoured only when the template's local flag is on, exactly as `DROPBOX_TEST_ORIGIN` (#25 D16).

**D5. Per-user OAuth: authorization code with the `offline` scope, confidential client, executed by the plumbing; Bynder supplies the mappings.** Client credentials (a service account) are rejected for the reason in the Problem Statement [VERIFIED: the OAuth app article says client-credentials tokens "will still be linked to the configured assigned user"]. The mapping onto #25's members:

| #25 member | Bynder mapping | Source |
|---|---|---|
| `scopes` | `offline asset:read current.user:read` by default (config-derived, D9) | scope names [VERIFIED: https://developers.bynder.com/integrate]; `offline` yields a non-expiring refresh token [VERIFIED: OAuth app article] |
| `buildAuthorizeUrl(state, redirectUri)` | `GET https://{portal}/v6/authentication/oauth2/auth` with `client_id`, `scope`, `redirect_uri`, `response_type=code`, `state` (all five are the documented parameters) | [VERIFIED: authorize reference] |
| `authorizeHosts` | the portal host (D4) | |
| `callbackCodeParam` | default `code` | the reference says Bynder redirects "with an authorization code" without naming the parameter [ASSUMPTION `code`; confirmed in MB3] |
| `maxStateBytes` | default 2,000 | no limit documented [ASSUMPTION; probed in MB3] |
| `requiresRefreshToken` | default `true` | the `offline` scope returns a refresh token |
| `exchangeCode(code, redirectUri)` | `POST https://{portal}/v6/authentication/oauth2/token`, `application/x-www-form-urlencoded`, `grant_type=authorization_code`, `code`, `redirect_uri` (must equal the authorize request), `client_id` and `client_secret` **in the body**; result `access_token`, `expires_in`, `refresh_token`, `scope` | [VERIFIED: token reference; credentials "either in the body or by sending the Authorization header"]. The body form is chosen so no composed `Basic` header (and no redaction gap like #23 TG1) exists |
| `refresh(refreshToken)` | the same endpoint with `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret`; the response schema may carry a new `refresh_token` | [VERIFIED: refresh reference] |
| token result | `accessToken`, `expiresInSeconds` (schema example 3600; absent means the shell default of 3600 s, #25 D5), optional `refreshToken`, optional `scope`; no account id in the token response | [VERIFIED: schema] |
| `accountName(credentials)` | `GET /api/v4/currentUser/` with the author's bearer token; display name = `firstname`, `infix`, `lastname` joined by single spaces, else `username`; **never the email address** | [VERIFIED: currentUser reference lists those fields; scope `current.user:read`] |
| `revoke(credentials)` | **not implemented**: Bynder publishes no per-token revoke endpoint (D12) | [VERIFIED: none in https://api.bynder.com/llms.txt; the OAuth app article offers only admin "Revoke all refresh tokens" and "Delete application"] |

PKCE is **not** used: the authorize reference documents no `code_challenge` parameters and the client is confidential [VERIFIED: parameter list]. If Bynder's authorize endpoint turns out to require PKCE, that is amendment A6 (an optional member in #25), not a change here.

**D6. Failure classification of the OAuth calls (the vocabulary #25 D5 defines).** Classification is by documented HTTP status and by the JSON `error` string only; a non-JSON body (Bynder is not documented to return HTML, but proxies do) is never parsed and is *misconfigured*. Bynder's token-error body shape is **not documented** [OPEN: recorded in MB3 and MB4 with a real revoked grant]; the provisional table assumes RFC 6749 error codes, which an Ory Hydra-style flow would use [ASSUMPTION]:

| Token endpoint outcome | Class |
|---|---|
| `invalid_grant` (revoked, expired or already-used code or refresh token) | **reauth** |
| `invalid_client`, `unauthorized_client`, `invalid_scope`, `invalid_request`, `redirect_uri` mismatch, any `401` | **misconfigured** |
| `5xx`, timeout, network failure | **transient** |
| anything unclassifiable (unknown JSON, empty body, other `4xx`) | **misconfigured**, never reauth (#25 D5: a vocabulary surprise must never delete a working connection) |

The honest cost of that safety rule is that a real revoked-grant response in an unexpected shape would show "ask your administrator" instead of "Reconnect" until the table is corrected from MB4 (risk R10); amendment A4 keeps "Disconnect" reachable in that state so an author is never stuck.

**D7. Refresh of a single-use rotating token must not be retried blindly.** Bynder's refresh probably rotates the refresh token (D5 evidence); a refresh request that times out after Bynder has already rotated would be burned by a blind retry. The module declares its refresh call **not safe to retry** (only the template's idempotent GETs are retried). Consequence: a transient refresh failure answers `502 upstream_unavailable` with the record kept, and the author retries; if the lost response had in fact rotated the token, the next attempt gets `invalid_grant` and the author reconnects (documented residual risk R2, the same one #25 D9 step 6 and RF9/RF10 prove ends cleanly). #25's D9 currently treats "the refresh grant" as safe to retry for every provider; making that a **provider declaration** (default as today, Bynder sets it off) is amendment A2. The plumbing already replaces the stored refresh token when a refresh result carries one and keeps it otherwise (#25 D5), so no storage code is involved either way; the decision gate on KV vs a Durable Object store (#25 Question 3) **applies to Bynder as soon as rotation is confirmed** (amendment A7).

**D8. No token-storage code in this ticket (AC3).** The module never reads or writes storage, never encrypts, never sets or reads cookies, never seals state, never refreshes on its own (it reports *reauth required* from a browse call and the shell forces one refresh and one retry, #25 D5) and never sees the IMS token, the inbound `Authorization` or cookies (#25 PO7). It applies the author's access token as `Authorization: Bearer` to its own outbound calls through the pinned outbound helper. A repo check (BYN-RC3) makes this a CI failure rather than a review comment.

**D9. Configuration (provider config on top of #25's shared items).** Shared items from #25 are reused unchanged and add nothing here: `PUBLIC_WORKER_ORIGIN`, `CONNECTION_TTL_DAYS`, secrets `TOKEN_ENC_KEY`, `TOKEN_ENC_KEY_PREVIOUS`, `OAUTH_STATE_KEY`, KV binding `DAM_TOKENS`, `ALLOW_LOCALHOST`. Bynder's own items: vars `BYNDER_PORTAL_DOMAIN` (required), `BYNDER_CLIENT_ID` (required; public by nature, it is in the authorize URL), `BYNDER_SCOPES` (optional; default D5; must contain `offline`, `asset:read` and `current.user:read` or registration fails naming the setting), `BYNDER_ALT_PROPERTY` (optional; the metaproperty system name, validated as letters, digits and underscore), `BYNDER_DEFAULT_DERIVATIVE` (optional; default `webimage`), `BYNDER_DELIVERY_HOSTS` (optional; bare host names), `BYNDER_PUBLIC_ONLY` (optional boolean, default off), `BYNDER_CACHE_SECONDS` (optional, default 30, `0` disables), test-only `BYNDER_TEST_ORIGIN`; **secret** `BYNDER_CLIENT_SECRET` (required for the provider; optional at deploy time, so it is **not** under `secrets.required`, #25 D4). Invalid optional values fail registration naming the setting and never its value (#23 D5). **OAuth scopes are frozen at app creation in Bynder** [VERIFIED: "All OAuth App specifications can be changed except the OAuth scopes"], so changing `BYNDER_SCOPES` requires a new OAuth app and new connections; the README says so.

**D10. Browse mapping: `GET /api/v4/media/` (the AC1 filter logic).** Parameters sent, all from the documented list [VERIFIED: https://api.bynder.com/reference/get_api-v4-media]: `keyword` (only when the author typed one; the reference says it searches file names, tags, extensions and more), `type` (one of `image`, `video`, `audio`, `document`; omitted for "all", so 3D assets appear only there), `orderBy` (from the enum, D11), `limit` (the shell page size, 24 default, 50 cap; Bynder allows up to 1000) and `page` (1-based), `total=1`, and `isPublic=true` only when `BYNDER_PUBLIC_ONLY` is on. User text travels only as the `keyword` value through URL-parameter encoding; Bynder documents no query language for `keyword`, so the injection boundary is parameter encoding alone [ASSUMPTION no special syntax; probed in MB3]. `includeMediaItems` is **not** sent on search (summaries need only `thumbnails`). The author's token is the only credential. The list reference has no `fields` parameter, so each result carries every asset field; the page-size cap bounds the payload (risk R15).

**D11. Sorts, types, window and paging.** Declared capabilities: `assetTypes` image, video, document, audio; `sorts` **`modified`** (default; `dateModified desc`), **`created`** (`dateCreated desc`) and **`name`** (`name asc`), all from the documented `orderBy` enum [VERIFIED]; **no `relevance` sort** (the enum has no score; the order of keyword results is unspecified [OPEN: MB3]); `window` **100,000** (`page` times `limit` must not exceed it [VERIFIED]; the shell never asks beyond it, so Bynder's cursor paging is not used); `assetIdPattern` the **8-4-4-16** hexadecimal form of `/api/v4` identifiers, case-insensitive (the 8-4-4-4-12 form belongs to other endpoints and is rejected before any call) [VERIFIED: https://developers.bynder.com/integrate]; `outboundHosts`, `authorizeHosts`, `deliveryHosts` per D4; `cacheSeconds` default 30. `hasMore` comes from the response total when present; the documented success schema of the list is a bare array and the shape produced by `total=1` is **not documented** [OPEN: MB3], so the mapper accepts both a bare array and an object carrying the assets and a total, and falls back to "the page was full" when no total is present (the cost is at most one empty last page, which the shell already tolerates).

**D12. Asset identity, detail and the fixed call budget.** The shell id is Bynder's `id` exactly as returned. Detail is `GET /api/v4/media/` with `id=<id>` and `includeMediaItems=1`: both parameters are on the list reference [VERIFIED], and `mediaItems` (public custom derivatives with `publicUrl`) exists only on the list schema, not on the single-asset schema [VERIFIED: https://api.bynder.com/reference/get_api-v4-media-id lists no `mediaItems`]. An empty result is `404 not_found`. That the combination returns populated `mediaItems` is [ASSUMPTION; MB3]; the fallback is `GET /api/v4/media/{id}/` with `versions=1`. The module **never** calls the download endpoint (its URL is temporary and needs a high-resolution role [VERIFIED*: https://api.bynder.com/reference/get_api-v4-media-id-download]), the derivatives endpoint, or any write endpoint (BYN-RD1). Detail has no side effect (unlike Dropbox's link creation). Per author action the worker makes at most one Bynder call plus, rarely, one refresh and a few KV operations, far inside the Free plan's 50 subrequests.

**D13. Normalised asset mapping (the AC1 insertion contract).** Summary: `id`; `provider` `bynder`; `name`; `type` from Bynder's `type` (`image`, `video`, `audio`, `document`; `3d` becomes `other`); `extension` the first entry of the `extension` array; `fileSize`; `width`, `height`; `dateModified`; `warnings[]` from `limited`, `archive`, `watermarked` (`limited-use`, `archived`, `watermarked`); `thumbnailUrl` the first of `thumbnails.thul`, `thumbnails.webimage`, `thumbnails.mini` that passes the shell's output URL policy (https and a delivery host), else absent (the browser shows a file-type placeholder). Thumbnails are public URLs, so **no inline `data:` thumbnail is needed** (unlike Dropbox) [VERIFIED: "Thumbnails are public by default"; ASSUMPTION they load without a session for non-public assets, MB5]. Detail adds `description`, `tags[]`, `copyright`, `alt` (D15), `renditions[]`, `defaultRenditionId`, `insertable`, `linkUrl`. Only allow-listed fields are mapped; Bynder fields such as `userCreated`, `property_*` values (other than the alt property), `propertyOptions`, `videoPreviewURLs`, `idHash`, `transformBaseUrl` never cross the boundary.

**D14. Renditions: opaque, API-returned, public-only.** Candidates, in order: (1) the standard derivatives from `thumbnails`, ids `webimage`, `thul`, `mini`, labelled by name; (2) for images, each `mediaItems` entry that has a `publicUrl`, id `custom:<name>`, labelled by name, `kind: derivative`; (3) `original` only when Bynder returns it (the reference: `original` is returned only for assets marked public and only when the portal has the `seoBaseUrl` setting [VERIFIED]) and its extension is browser-displayable (jpg, jpeg, png, gif, webp, avif, svg), `kind: original`. The default is `BYNDER_DEFAULT_DERIVATIVE` when that rendition exists, else `webimage`, else the first available. Every URL is passed through byte-for-byte; the module **never constructs, rewrites or parses** a Bynder URL (the `/m/` to `/asset/` migration is Bynder's, and "if your integrations consume URLs as-is, no action is required" [VERIFIED: public assets article]); it never appends `?format=` even though API thumbnails carry no file extension [VERIFIED: same article, FAQ], because that would be URL construction (MB5 records the delivered content type). Each URL must pass the shell's output policy (https, host in `deliveryHosts`); a failing rendition is dropped; an image with none left is `insertable.ok=false` with the fixed reason "No public rendition is available for this asset". Dimensions: only the asset's own width and height, attached to `original`; derivative dimensions are not reported by the documented API [ASSUMPTION; MB3] and are omitted. Non-image assets: `linkUrl` is the returned `original` when present, `renditions` is empty; with no public original the asset is not insertable ("This asset has no public link"). Dynamic asset transformations (`transformBaseUrl`) are out of scope.

**D15. Alt text policy (AC1 "alt text from DAM metadata").** A ranked fallback returned with its source, mapped to the shell enum: (1) `property`: the value of `property_<BYNDER_ALT_PROPERTY>` when configured (a string, or an array of strings, whichever Bynder returns; the first non-empty entry is used; the documented schema shows `property_*` as arrays of option names for option-type metaproperties [VERIFIED: https://api.bynder.com/reference/get_api-v4-media-id, `property_assettype`], the free-text shape is [ASSUMPTION; MB3]); (2) `description`: the asset `description`; (3) `name`: the asset name without extension, separators turned into spaces; (4) `none`. Every candidate is reduced to plain text (no markup, entities, control characters; whitespace collapsed). The author always sees and may edit it or mark the image decorative. Whether the `asset:read` scope suffices to read `property_*` values, or whether `meta.assetbank:read` is also required, is [OPEN: MB3]; because scopes cannot be edited later (D9) this must be settled before the OAuth app is created in the real portal.

**D16. Errors and limits (all mapped to the #2 error contract; fixed messages; no upstream text).** Browse and detail calls: `401` is reported as **reauth required** (the shell then forces one refresh and retries once, #25 D5/D9); `403` forbidden (the author's Bynder role lacks access); `404` on detail not found; `400` bad request (the provider validates the window and the id before calling, so this is rare); `429` rate limited with a retry delay (Bynder allows 4,500 requests per five minutes per source IP and pauses that IP for five minutes [VERIFIED: https://developers.bynder.com/integrate]; the module uses `Retry-After` when present, else 300 s, clamped by the shell; whether Bynder sends the header is [OPEN: MB3]); `5xx` and network failures upstream unavailable. Cloudflare Workers subrequests probably share egress IPs, so the limit may be shared with other tenants of the platform [ASSUMPTION]. The template's short retry window (cap 2 s) cannot outwait a five-minute pause, by design; the browser honours the delay.

**D17. Quota protection.** The shell's controls apply unchanged (debounce, page size 24 default and 50 cap, per-author result cache `BYNDER_CACHE_SECONDS` default 30 s keyed by the connection and a configuration fingerprint of portal, client id, public-only flag; detail and errors never cached; #25 D14). Search and detail each cost one Bynder request.

**D18. Disconnect semantics (the honest version).** Without a `revoke` member, the plumbing's Disconnect makes no upstream call and only deletes the stored record and the author's cache entries (#25 D11, test CN4). The Bynder grant therefore remains valid at Bynder until a portal admin uses "Revoke all refresh tokens" or deletes the OAuth app [VERIFIED: support article]; a Bynder refresh token "will not expire", so a leaked stored token is a standing credential [VERIFIED: same article]. That is why encryption at rest, the retention TTL and the purge procedure in #25 matter more here than for Dropbox. The README states the semantics and the offboarding procedure; the panel should say it too (amendment A4, a capability flag derived from the absence of `revoke`).

**D19. Replacing the OAuth app invalidates stored connections (scope immutability).** Because Bynder scopes cannot be edited, changing scopes (or losing the client secret, which is shown once) means creating a new app with a new client id. Stored refresh tokens belong to the old app and will fail at the token endpoint (probably `invalid_client` or `invalid_grant`), and under D6 an `invalid_client` is *misconfigured*: the author would see "ask your administrator" and no Reconnect until their record expires. Amendment A3 asks #25 to bind a **configuration fingerprint** (client id and tenant host, never a secret) into the stored record and to read a mismatch as `reauth_required`, so a deliberate app replacement turns into a clean Reconnect for everyone. Fallback if A3 is declined: the README documents the purge procedure and the retention TTL as the recovery path.

**D20. Insertion and experience.** Unchanged: the shell serialises one `<img src alt>` with DOM APIs and sends it with `sendHTML` then `closeLibrary`; non-images are one `<a>`; only `https:` URLs are inserted (#23 D18). Bynder public URLs end up in the document; deleting an asset breaks them after CDN cache expiry (default 24 h on Bynder's CDN), and archiving or limiting an asset does not invalidate cached URLs and, by default, does not break them at all unless Customer Support enables that [VERIFIED: public assets article]. One README sentence: pickers insert references, not copies.

**D21. Tooling and conventions** follow #1, #2, #23 and #25 unchanged and are pinned to upstream: ESLint 8 + helix config, Stylelint 16, `@web/test-runner` for browser unit tests, Node `node:test` for worker tests, Playwright (Chromium) for e2e, Node 22 (>= 22.12 for wrangler 4), husky. Tests live inside the extension folder; the Bynder tests live under the provider folder. No new runner.

**D22. Docs ship with the code (AC5).** The extension README gains a **Bynder section**: what the provider does and its limits; Bynder-side setup (Customer Support enablement, required admin permissions, registering the OAuth app, scopes and that they are immutable, both redirect URIs, that the secret is shown once, enabling public derivatives and the SEO base URL so `original` is returned, an alt-text metaproperty, custom CDN hosts); the exact vars and secret table with `wrangler secret put` command; the exact `library` row (unchanged); "site config keys read: none; no new config-sheet row"; Disconnect and offboarding semantics (D18); the replacement-of-app procedure (D19); rate limits; the per-user permission model; the public-link longevity sentence (D20); and the troubleshooting entries (OAuth Apps not enabled, scopes narrower than requested, delivery host not listed, redirect URI mismatch).

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given an HTTP request to the worker (fake IMS, fake Bynder, in-memory KV), assert the response, redirects, cookies, the stored (encrypted) bytes and the requests the fake Bynder received (method, host class, path, query, headers, form body); given an SDK result and a worker stub, assert the DOM and the SDK actions. Never assert on internal helper names or internal call counts. Properties asserted as negatives across every path: **no Bynder client secret, access token, refresh token, sealed ticket or state, binding nonce or encryption key ever reaches a response, header, redirect, log line or the browser**; **nothing runs before authentication succeeds, except the two sealed public OAuth routes**; **no URL Bynder returned is ever altered, and no URL is built from an id or a name**; **the Bynder folder contains no token-storage, encryption or cookie code**.

**Proposed seams** (recorded here instead of asked, per #60). The seams are #23's and #25's; **this ticket adds no seam**. The one seam #23 introduced for this purpose, the provider interface with its shared conformance suite (P1), is what proves "Bynder only adds a module".

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 (primary) | The worker's HTTP boundary: `worker.fetch(request, env, ctx)` | reused (#2, #23, #25) | Node unit tests of the Bynder module, and the plumbing suites re-run with Bynder registered | Constructed `Request`s; the #2 test kit; #25's in-memory KV (stale-read double); **new double `fakeBynder(script)`** built on #25's `fakeOAuthDam` engine |
| P1 | The provider interface: registry plus the shared conformance suite | reused (#23, #25) | Contract tests run for Bynder as a fourth provider and the third `user-oauth` kind member | Docs-derived then recorded Bynder fixtures |
| S2 | Browser render/logic module + SDK result | reused (#1, #23, #25) | `@web/test-runner` tests with Bynder-shaped worker data | Hand-built SDK result; injected `fetch`; fake timers; spy `window.open` |
| S1 | Entry HTML page + SDK module boundary, against a real local worker | reused (#1, #2, #23, #25) | Playwright e2e of the pop-up OAuth, rotation and search | #1 SDK stub; real worker under `wrangler dev` with local KV; fake IMS and `fakeBynder` as throwaway Node servers |
| W2 | The same worker in the real workers runtime over HTTP | reused | Smoke tier (form-encoded token calls and rotation in workerd) | `wrangler dev` local |
| S3 | Repo convention check | reused, extended | CI lint job | Filesystem fixtures in a temp dir |

The one new test asset, **`fakeBynder`**, is a fixture and not a seam. It reuses `fakeOAuthDam`'s rotating-token engine and differs from the Dropbox fake exactly where Bynder differs: form-only token endpoint (rejects JSON; accepts credentials in the body or as Basic), `code` on the callback, single-use rotating refresh tokens (reuse answers `invalid_grant`, with an option to burn the family), per-portal host, a login hop (`/v6/login-provider/login?login_challenge=...`) before the callback, an option that grants **fewer scopes** than requested, `currentUser`, list responses in both the bare-array and the object shape, list-by-id, thumbnails and originals in both `/m/` and `/asset/` URL shapes on the portal host or a second CDN host, `429` with and without `Retry-After`, and HTML error pages. The real EW and real Bynder boundary (real sign-in and consent, real tokens, real assets and URLs, the real library iframe, real insertion and publish) is covered only by numbered manual steps.

**Modules tested:** the Bynder provider (config and host derivation, authorize URL, code exchange and refresh mappings and failure classes, account name, search and detail mappings, type and rendition and alt-text logic, error mapping, retry declarations); the plumbing suites of #25 **re-run unchanged with Bynder registered** (their purpose here is to prove "no shell change", not to retest the plumbing); the browser picker with Bynder-shaped data; repo checks. The #23 and #25 modules for Cloudinary and Dropbox are re-run to prove Bynder leaves them untouched.

**Prior art:**
- `apps/multi-dam-picker/providers/dropbox/SPEC.md` (#25): the plumbing test families OA, TS, RF, CN, SC, PO, UO, EO, SO, RO, the `fakeOAuthDam` stub and the DBX-AU/SE/ER mapping tests that this spec mirrors for Bynder (IDs prefixed `BYN-`).
- `apps/multi-dam-picker/SPEC.md` (#23): the SH, PC, UI, E2E, SM, RC families and the output URL policy tests.
- `shared/worker-template/SPEC.md` (#2): the UA/UC/UP/US/UK matrices, which apply automatically.
- `apps/hello-world/SPEC.md` (#1): the SDK stub, S1/S2 patterns and the convention check.
- The earlier Bynder-first draft of this spec (git history): its OA/TS/RF/BR/RD/AT families became #25's plumbing suites and the `BYN-` mapping tests here.
- Upstream `adobe-rnd/ew-extensions` has no worker, OAuth or DAM code (checked in #1/#2), so there is no upstream test prior art; Contentful's Bynder app (UCV-based) has no reusable tests.

## Out of Scope

- The OAuth plumbing itself (connect and disconnect routes, sealing, token store, refresh orchestration, connect panel, per-user cache scope): #25. This ticket only proposes amendments to it (section 9).
- Cloudinary (#23), Dropbox (#25) and Frontify (#24) providers.
- Upload to Bynder, asset-usage tracking back to Bynder (Contentful's app syncs usage; a possible follow-up), editing assets or metadata, collections, brands and categories navigation, metaproperty, tag, orientation and smartfilter facets, multi-select, saved searches, similar-asset search.
- Dynamic Asset Transformations (`transformBaseUrl`, custom crop or resize URLs), adaptive video streaming and players (`videoPreviewURLs`), 3D previews. Videos and documents are inserted as plain links; 3D assets appear only under "all".
- Client-credentials (service-account) mode, org-wide connections, SCIM or admin provisioning, more than one Bynder portal per site (D4).
- Bynder's Universal Compact View and the Bynder MCP server (D3).
- Cursor (`X-Bynder-NextCursor`) paging beyond the 100,000-result window, relevance ranking, `3d` as a filter type.
- Token-based public link access (Bynder's "Token Based Public Link Access" feature): URLs that need a token are treated as unsupported, flagged in R6.
- A Durable Object token store, per-user request quotas, CI deployment of the worker (#25 and #2 own these).
- The Adobe outside-activity/IP policy decision and the data-protection review for storing third-party refresh tokens (owned by #1 R1, #2 R1 and #25 Question 4).

## Further Notes

- **What Bynder asks of the plumbing, in one table.**

  | Concern | Dropbox (#25, built first) | Bynder (this ticket) |
  |---|---|---|
  | Hosts | fixed (`www.dropbox.com`, `api.dropboxapi.com`, `content.dropboxapi.com`) | one per-portal host for authorize, token, API and delivery; plus optional CDN hosts |
  | Token endpoint | form body, app key and secret | form body, client id and secret in the body (or Basic) |
  | Refresh token | never rotates, never expires | probably rotates (single-use), "will not expire" otherwise [OPEN] |
  | Retry of refresh | safe | **not safe** (D7, A2) |
  | Revoke upstream | `token/revoke` | none (D18, A4) |
  | PKCE | not used | not used (A6) |
  | Callback code parameter | `code` | `code` [ASSUMPTION] |
  | Scopes | five, editable in the console | three, frozen per OAuth app (D19, A3) |
  | Renditions | none (a shared link, `raw=1`) | API-returned public URLs, opaque |
  | Thumbnails | binary, inlined as `data:` | public URLs |
  | Alt text | file property, else file name | metaproperty, else description, else name |
  | Detail side effects | creates a public link | none |
  | Sandbox | self-serve | needs Bynder Customer Support |

- **Docs say nothing about third-party pickers or OAuth in EW.** The cited EW developer doc (https://www.aem.live/docs/ew/developing/apps-plugins) documents the SDK, `sendText`, `sendHTML`, `closeLibrary` and the config rows only; all EW-side design derives from the SDK and library source [VERIFIED in #1/#2].
- **Bynder is migrating public link formats.** Starting the week of 2026-03-30 the `/asset/` structure is the default format returned by the API, `/m/` links keep working, and there is no formula to convert one to the other [VERIFIED: public assets article]. Today is after that date, so fixtures must be recorded from the real portal and the mapper must accept both shapes (BYN-RD6). Custom-domain and CDN setups must route `/asset/` or new links 404 [VERIFIED: same article], which is the likeliest real-world cause of "my image is broken" and is in the README troubleshooting list.
- **The Bynder docs moved** to https://developers.bynder.com (https://api.bynder.com/llms.txt is the index of the old reference, which says it "will not be updated moving forward"); every API claim cites the stable reference page it was read on.
- **EDS and external images.** Whether Edge Delivery Services keeps an external `<img src>` from a DA document untouched on publish is [ASSUMPTION it is kept] (carries #23 R13 and #25 R20); observed in MB8.
- **#25, #23 and #2 are not built yet** (specs only). Everything here that says "the plumbing provides" presumes #25 landed with its contract and with the amendments of section 9 either accepted or covered by the stated fallbacks.

---

# Build Analysis

## 1. Architecture and responsibilities

```
EW editor (da.live)                                             Bynder portal  https://{portal}/
 └─ library iframe: apps/multi-dam-picker (static, public)        /v6/authentication/oauth2/auth      (authorize: top-level navigation in a pop-up)
      │ SDK -> { token (IMS), context, actions }                  /v6/authentication/oauth2/token     (code exchange, refresh; form body)
      │ fetch(worker, Authorization: Bearer <IMS>)                /api/v4/currentUser/  /api/v4/media/ (Bearer = the AUTHOR's own token)
      │ window.open(pop-up) -> worker /oauth/bynder/begin         ▲ ▲
      ▼                                                           │ │
 Cloudflare Worker (apps/multi-dam-picker/worker; core from shared/worker-template; ONE worker for all providers)
   1 origin gate -> 2 IMS check -> 3 router -> 4 shell routes -> 5 connection layer (decrypt, refresh, inject)
        -> 6 provider module [bynder: mappings only] -> 7 proxy (retries) ──┘ -> output URL policy -> normalised JSON
        │                                       └─ KV DAM_TOKENS (AES-GCM records), secrets (TOKEN_ENC_KEY, OAUTH_STATE_KEY, BYNDER_CLIENT_SECRET)
        └─ public, sealed routes (top-level navigation in the pop-up): GET /oauth/bynder/begin   GET /oauth/bynder/callback

 Everything in boxes 1-5, 7 and the KV/secret plumbing is #23/#25. This ticket is box 6 plus one registry line.
 The browser never calls a Bynder API host. The only Bynder-origin requests from the browser are
 (1) the pop-up's top-level navigation to the portal and (2) anonymous <img> GETs of public thumbnail and rendition URLs.
```

| Concern | Browser extension (static, public) | Worker (private runtime) |
|---|---|---|
| Bynder client secret, access and refresh tokens, encryption and state keys | never | only place (secret store, encrypted KV) |
| Author identity | IMS token from the SDK, sent as bearer | verifies it; the verified `userId` keys the connection (#25 D6) |
| Connect / disconnect / reconnect | the #25 panel: pop-up, polling, state display | all of #25's routes and storage; **no Bynder code in them** |
| Bynder authorize, token, refresh, account | none | the **Bynder module's mappings**, called by the plumbing |
| Bynder API calls | none | the module, through the pinned outbound helper with the author's token |
| Search, filter, paging, selection, alt editing | all (shell, unchanged) | maps filter, sort and page to `/api/v4/media/`, normalises |
| Rendition and thumbnail URLs | shows them, inserts the chosen one | passes Bynder's URLs through the output URL policy, unmodified |
| Insertion | `sendHTML` then `closeLibrary` (shell) | none |
| Provider knowledge | none (label, state, capabilities only) | the Bynder module |

## 2. EW integration points

- **Library plugin vs app:** the existing library plugin (#23). The `library` row is unchanged: `Multi-DAM Picker`, `/apps/multi-dam-picker/multi-dam-picker.html`, blank `format`, blank `ref` for main (a branch name for branch testing), optional `icon`, `experience` `fullsize-dialog` (recommended, undocumented, #23 Question 4) or blank (`inline`). **Site config read: none.**
- **SDK actions used:** the shell's `sendHTML`, `closeLibrary` and the SDK `token`; `window.open` for the pop-up (the library iframe has no `sandbox` attribute [VERIFIED: da-live `helpers.js`, #1/#2/#25]). Nothing new.
- **`ref=local`:** page `http://localhost:3000` (#1 server) + worker `http://localhost:8787` (`wrangler dev`) with local KV and `PUBLIC_WORKER_ORIGIN=http://localhost:8787`. The Bynder OAuth app must list `http://localhost:8787/oauth/bynder/callback` as a redirect URI; Bynder's examples use `https://localhost/callback` and whether an `http` loopback URI and several URIs are accepted is not documented [OPEN: Question 4, MB1]. Fallback: an `https` local worker (`wrangler dev --local-protocol https` [ASSUMPTION flag]) or a tunnel with `PUBLIC_WORKER_ORIGIN` set to it; the plumbing derives the redirect URI only from `PUBLIC_WORKER_ORIGIN` (#25 D7), so no code differs.
- **Branch ref / main:** pages on `*.aem.live` or `*.preview.da.live` call the deployed worker; `PUBLIC_WORKER_ORIGIN` is that origin and the deployed callback is the second registered redirect URI.
- **Touch points of this ticket outside `providers/bynder/` (all of them, so AC4 is checkable):** (1) one registry entry; (2) the worker's wrangler config gains the Bynder `vars` (and no `secrets.required` entry); (3) `.dev.vars.example` gains `BYNDER_CLIENT_SECRET`; (4) the extension README gains the Bynder section; (5) the conformance-suite registration line. No shell, plumbing, browser or template source file changes.

## 3. External APIs and auth flows

All Bynder endpoints are on the portal host. Index: https://api.bynder.com/llms.txt (old reference) and https://developers.bynder.com (new portal).

| API | Use | Auth / scope | Source / status |
|---|---|---|---|
| `GET /v6/authentication/oauth2/auth` | start the code flow: `client_id`, `scope`, `redirect_uri`, `response_type=code`, optional `state`; `302` to `/v6/login-provider/login?login_challenge=...` | user signs in | [VERIFIED] https://api.bynder.com/reference/get_v6-authentication-oauth2-auth; no PKCE parameters documented |
| `POST /v6/authentication/oauth2/token` (`authorization_code`) | form body: `grant_type`, `code`, `redirect_uri`, `client_id`, `client_secret`, optional `scope` (a subset of the requested ones); returns `access_token`, `refresh_token` (with `offline`), `expires_in` (example 3600), `scope`, `token_type` | client credentials "either in the body or by sending the Authorization header" | [VERIFIED] https://api.bynder.com/reference/post_v6-authentication-oauth2-token-authorization; error body shape [OPEN] |
| same (`refresh_token`) | form body `grant_type`, `refresh_token`, `client_id`, `client_secret`; response may carry a new `refresh_token` | same | [VERIFIED] https://api.bynder.com/reference/post_v6-authentication-oauth2-token-refresh; rotation [OPEN] |
| `GET /api/v4/currentUser/` | "Connected as": `firstname`, `infix`, `lastname`, `username` (also `email`, not used) | Bearer, `current.user:read` | [VERIFIED] https://api.bynder.com/reference/get_api-v4-currentuser |
| `GET /api/v4/media/` | browse and search: `keyword`, `type`, `orderBy`, `limit` (1..1000, default 50), `page` (`page` times `limit` at most 100,000), `total`, `id`, `includeMediaItems`, `isPublic`, `archive`, `limited`; items: `id`, `name`, `description`, `copyright`, `type`, `extension[]`, `width`, `height`, `fileSize`, `tags[]`, `propertyOptions`, `property_<name>`, `isPublic`, `limited`, `archive`, `watermarked`, `thumbnails{mini,thul,webimage}`, `original` (public assets with `seoBaseUrl` only), `mediaItems[{name,type,publicUrl}]`, `transformBaseUrl`, `videoPreviewURLs`, `dateModified`; header `X-Bynder-NextCursor` | Bearer, `asset:read` | [VERIFIED] https://api.bynder.com/reference/get_api-v4-media; `total=1` response shape [OPEN] |
| `GET /api/v4/media/{id}/` | not used by default (D12): its schema has no `mediaItems` | Bearer | [VERIFIED] https://api.bynder.com/reference/get_api-v4-media-id; fallback with `versions=1` |
| `GET /api/v4/account/derivatives` | names, sizes and `isPublic` of derivatives | Bearer | [VERIFIED endpoint] https://api.bynder.com/reference/get_api-v4-account-derivatives; required scope undocumented [OPEN]; **not used** (labels come from the names) |
| `GET /api/v4/media/{id}/download` | temporary download location | Bearer, high-resolution role | **not used**: temporary, must not be embedded [VERIFIED*] |
| Refresh-token revocation by the app | none per token; admin "Revoke all refresh tokens" and "Delete application" | portal admin UI | [VERIFIED] the OAuth app article |
| Public delivery (portal, custom domain or CDN) | rendition and thumbnail display by browsers and visitors | none | [VERIFIED] public assets article (`/asset/...` and `/m/...`, thumbnails public by default); the hosts the API actually returns [OPEN: MB3] |

Limits [VERIFIED: https://developers.bynder.com/integrate]: 4,500 requests per five minutes per source IP; `HTTP 429` pauses that IP for a five-minute cooldown; 29 granular scopes; `/api/v4` identifiers are 8-4-4-16, other endpoints 8-4-4-4-12.

**Auth flow (author to worker):** SDK token -> `Authorization: Bearer` -> #2 verification -> `identity.userId` -> record key `hash(userId, "bynder")` (#25 D6).

**Auth flow (Bynder connection)** is #25 D7's six steps with Bynder values: (1) `POST connect` returns `{ beginUrl }`; (2) the click handler opens the pop-up synchronously and navigates to it; (3) `begin` verifies the ticket, sets the binding cookie and `302`s to `https://{portal}/v6/authentication/oauth2/auth` with the sealed `state`; (4) the author signs in to the portal (possibly SSO) and approves the listed scopes; (5) Bynder `302`s to the worker callback with `code` and `state`; the worker verifies state and cookie, exchanges the code (form body, same `redirect_uri`), requires a refresh token and the full requested scope, calls `currentUser`, stores the encrypted record, returns the static page; (6) the extension's `session` poll flips to connected. The stored access expiry is `now + expires_in` (about 3,600 s).

**Auth flow (per call):** read and decrypt the record -> refresh if under 60 s remain (single-flight; **rotation-aware, no blind retry**, D7) -> call Bynder with `Authorization: Bearer <author's token>`, never the IMS token -> on `401` the shell forces one refresh and retries once; a second rejection destroys the tokens, writes the reauth marker and answers `409 provider_reauth_required` -> normalise -> output URL policy -> respond.

**Disconnect flow:** `POST disconnect` -> (no `revoke` member, so no upstream call) -> delete the record -> purge the author's cache entries -> `204`.

## 4. Data contracts

Behaviour contracts, not code. The worker API, provider-list item, stored record, sealed values and error codes are #25's (D8, D12) and unchanged.

**Bynder capabilities:** `assetTypes: [image, video, document, audio]`; `sorts: modified (default), created, name`; `window: 100000`; `assetIdPattern`: 8-4-4-16 hexadecimal, case-insensitive; `outboundHosts: [portal host]`; `authorizeHosts: [portal host]`; `deliveryHosts: [portal host] + BYNDER_DELIVERY_HOSTS`; `cacheSeconds: 30`; `scopes: offline asset:read current.user:read` (config-derived); `callbackCodeParam: code`; `maxStateBytes: 2000`; `requiresRefreshToken: true`; refresh declared not retry-safe (D7); no `revoke`.

**Shell filter to Bynder query:**

| Shell | Bynder parameter |
|---|---|
| `q` (trimmed, at most 200 characters) | `keyword` (omitted when empty) |
| `type` image, video, audio, document | `type=image`, `video`, `audio`, `document`; `all` omits the parameter |
| `sort` modified, created, name | `orderBy=dateModified desc`, `dateCreated desc`, `name asc` |
| `page`, `pageSize` | `page`, `limit`; `total=1` always |
| `BYNDER_PUBLIC_ONLY` on | `isPublic=true` on every search; a detail of a non-public asset is `404 not_found` |

**Summary and detail mapping:** D13 (fields), D14 (renditions), D15 (alt). Rendition table:

| id | label | source | kind | offered when |
|---|---|---|---|---|
| `webimage` (default) | Web image | `thumbnails.webimage` | derivative | URL present and passes the policy |
| `thul` | Thumbnail | `thumbnails.thul` | derivative | same |
| `mini` | Mini | `thumbnails.mini` | derivative | same |
| `custom:<name>` | the derivative name | `mediaItems[].publicUrl` | derivative | image asset, `publicUrl` present and passes the policy |
| `original` | Original (size) | `original` | original | Bynder returned it and the extension displays in a browser |

**`insertable.reason` (fixed strings, never upstream text):** "No public rendition is available for this asset"; "This asset has no public link"; "This file cannot be shown as an image in a browser". Warnings: `limited-use`, `archived`, `watermarked` (the assets stay insertable; Question 6).

**Bynder-to-shell error map** (D6, D16):

| Bynder | Shell outcome |
|---|---|
| browse or detail `401` | *reauth required*: the shell refreshes once and retries; a second rejection -> marker, `409 provider_reauth_required` |
| `403` | forbidden mapping |
| detail empty result or `404` | `404 not_found` |
| `400` | `400 bad_request` |
| `429` | `429 rate_limited` + `Retry-After` (header or 300 s) |
| `5xx`, network | `502 upstream_unavailable` |
| token endpoint `invalid_grant` | *reauth*: tokens destroyed after the re-read (#25 D9), marker, `409 provider_reauth_required` |
| token endpoint `invalid_client`, `unauthorized_client`, `invalid_scope`, `invalid_request`, any `401`, unclassifiable | *misconfigured*: `500 misconfigured`, record kept |
| token endpoint `5xx`, network | *transient*: `502`, **not retried**, record kept |

**Worker configuration (Bynder additions to #25's table):**

| Name | Kind | Meaning |
|---|---|---|
| `BYNDER_PORTAL_DOMAIN` | var, required | bare portal host; drives the authorize, token, API and delivery hosts |
| `BYNDER_CLIENT_ID` | var, required | OAuth app client id (public) |
| `BYNDER_CLIENT_SECRET` | **secret**, required for the provider | OAuth app client secret; not under `secrets.required` (#25 D4) |
| `BYNDER_SCOPES` | var, optional | default `offline asset:read current.user:read`; must contain all three |
| `BYNDER_ALT_PROPERTY` | var, optional | metaproperty system name for alt text |
| `BYNDER_DEFAULT_DERIVATIVE` | var, optional | default `webimage` |
| `BYNDER_DELIVERY_HOSTS` | var, optional | extra bare hosts allowed in returned URLs (custom CDN, SEO base URL) |
| `BYNDER_PUBLIC_ONLY` | var, optional | `true` restricts search to `isPublic=true` assets |
| `BYNDER_CACHE_SECONDS` | var, optional (default 30) | result cache lifetime, `0` disables |
| `BYNDER_TEST_ORIGIN` | var (**local/test only**) | redirects the portal host to a loopback fake; ignored unless the local flag is on; never in the production config |

A provider is "configured" when the first three are present **and** the plumbing is enabled (#25 D4).

## 5. Folder layout (proposed; fits #1, #2, #23, #25)

```
apps/multi-dam-picker/providers/bynder/
├─ SPEC.md                         this file
└─ worker/                         the Bynder provider module (#2 Decision 3: providers/<vendor>/worker/)
    ├─ (provider module: config and host derivation, authorize URL, exchange, refresh, failure classes, account name, search + detail mappings, type table, renditions, alt text, error map)
    └─ test/ + fixtures/           unit tests, `fakeBynder`, Bynder fixtures (docs-derived first, recorded later, each with a provenance note)
```

No other file under `apps/multi-dam-picker/` changes except the five touch points of section 2. `.hlxignore` already hides `**/worker/` and `**/test/` from the code bus (#1/#2). The provider has no browser code, no `package.json` and no wrangler config of its own (it is a module of the extension's worker).

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **No Bynder sandbox.** OAuth Apps need Customer Support enablement, the registering admin needs two permissions, no self-serve portal was found. Without it AC1, AC2 and AC6 cannot be verified against real Bynder and fixtures stay docs-derived. | High, blocks manual verification | Owner action first (Q1); the fake tiers are the only automated proof; MB3 records real fixtures; step 0 of the build plan is a gate |
| R2 | **Rotating single-use refresh tokens on eventually consistent KV.** If Bynder rotates (probable, D5), two isolates racing, a lost response or a failed write after rotation burns the connection; the author must reconnect. | High if rotating | No blind refresh retry (D7/A2); #25's re-read, retry-write and in-isolate keep (RF8-RF10); **owner decision gate on a Durable Object store before Bynder is enabled** (A7, #25 Q3); MB4 measures rotation for real |
| R3 | **Scopes are frozen per OAuth app; app replacement strands connections.** Changing scopes, or recovering a lost secret by recreating, gives a new client id; old refresh tokens fail and may classify as *misconfigured* (no Reconnect). | Medium-High | Settle scopes (incl. whether `property_*` needs `meta.assetbank:read`) before creating the real app (D15); A3 (config fingerprint) or the README purge procedure (D19) |
| R4 | **Delivery hosts unknown.** The hosts of API-returned thumbnail and rendition URLs (portal, custom domain, CDN) are not documented; the output URL policy fails closed, so an unlisted host makes every rendition "not insertable". | Medium | `BYNDER_DELIVERY_HOSTS`; MB3 records the real hosts; README troubleshooting entry; BYN-RD5/RD6 |
| R5 | **Link format migration.** `/asset/` is now the default; legacy `/m/` links persist; custom-domain routing must forward `/asset/`; "no conversion formula". | Medium | URLs are opaque and never parsed (D14); both shapes in fixtures; README note |
| R6 | **Public-ness of what we insert.** Thumbnails are "public by default" but originals need "Mark as public" (and `seoBaseUrl`), custom derivatives may not be public, portals can enable token-based public links or make archive/limit kill public URLs; an inserted URL may be broken for visitors. | Medium-High (content correctness) | Only API-returned public URLs; `original` only when returned; `BYNDER_PUBLIC_ONLY`; warnings for limited, archived, watermarked; MB5 loads each case anonymously |
| R7 | **Per-user scope narrowing.** Bynder grants only the scopes the user's own permissions allow; a user without `asset:read` completes consent but the plumbing refuses the connection with the generic failure page (no hint). | Medium | Required-scope check (#25 D5) is correct and safe; message trade-off is A5; README troubleshooting |
| R8 | **Alt metaproperty shape and scope** unknown (free-text value shape; naming; whether `asset:read` suffices). | Low-Medium | Handles string and array; MB3 records; D15 gate before app creation |
| R9 | **`total=1` response shape, list-by-id with `includeMediaItems`, `keyword` special characters, archived-by-default, sort with keyword, 429 header, thumbnail sizes** are undocumented or unverified. | Medium | Tolerant mapper (both shapes), documented fallbacks (D11, D12), MB3 closes each |
| R10 | **Token-error body unverified** (revoked refresh token, wrong client). A wrong classification either strands an author on "ask your administrator" or deletes a good connection. | Medium | Classify by documented status and `error` string; unknown is *misconfigured* and keeps the record (D6); A4 keeps Disconnect reachable; MB4 confirms with a real revoked grant |
| R11 | **Redirect URI registration:** whether `http://localhost:8787/...` and several URIs are allowed per app is undocumented (Bynder's example is `https://localhost/callback`). | Medium | Q4; fallback `https` loopback or tunnel via `PUBLIC_WORKER_ORIGIN` (section 2) |
| R12 | **Bynder rate limit shared by egress IP** (4,500 per five minutes, five-minute pause). | Medium | Page-size cap, debounce, per-author cache, 429 mapping with the shell's UI back-off (D16); [ASSUMPTION on shared IPs, Q9] |
| R13 | **Amendments A1 to A7 not accepted by #25.** Bynder then needs shell changes or workarounds. | Medium (scheduling) | Each amendment lists a fallback; A1 is likely already covered by #25's per-tenant stub; A2 and A3 have module-level or docs-level fallbacks; A7 is a decision gate, not code |
| R14 | **Policy and privacy:** third-party refresh tokens that "will not expire" and cannot be revoked per token, tied to Adobe user ids in a Cloudflare account that may be personal (carries #1 R1, #2 R1, #25 R4). | High (policy) | Encryption, key separation, TTL and purge (#25); D18 states Disconnect honestly; owner decides the account (#25 Q4) |
| R15 | **Payload size:** the list returns every asset field (no `fields` parameter) and `property_*` values; at the page cap of 50 this is modest but unmeasured; Free-plan CPU is 10 ms. | Low | Page cap; BYN-SO records size and CPU (informational); Paid plan fallback (shared with #23 R16) |
| R16 | **Hydra inference.** "Probably rotates" rests on a `login_challenge` and a schema example; Bynder may not use Hydra. | Low (it only affects planning) | Treated as [ASSUMPTION]; MB4 settles it; the code handles both |
| R17 | **IMS `user_id` stability** across shell and library tokens (carries #2 R4, #25 R16). | Medium | MB7 compares two tokens; tests key by `identity.userId` only |
| R18 | **External image URLs on publish** may be rewritten or dropped by EDS; API thumbnails have no file extension. | Medium | MB8 observes [ASSUMPTION kept]; URLs stay opaque |
| R19 | **Pop-up and cookie behaviour** in Safari and Brave, `localhost` cookies (carries #25 R17). | Low-Medium | #25's fallbacks; Chrome-first |

## 7. Ordered build plan (sized to #22's acceptance criteria)

0. **Prerequisites and decision gates (owner):** #25 landed with its plumbing verified against its two stub OAuth providers and Dropbox (Phase A checkpoint); amendments A1 to A4 accepted or their fallbacks chosen; the Durable Object decision (A7) taken if rotation is likely; a Bynder portal with OAuth Apps enabled, an admin able to register the app (scopes settled per D15, redirect URIs for local and deployed worker, secret captured once) and to enable public derivatives and the SEO base URL, two Bynder users with different permission profiles and the test assets of section 6; a Cloudflare account with the KV namespace #25 created. Without the portal, steps 1 to 8 proceed against the fakes.
1. **Fixtures and the double first (no seam):** docs-derived Bynder fixtures with provenance notes; `fakeBynder` on top of `fakeOAuthDam` (rotation, form-only token, `code`, login hop, scope narrowing, both list shapes, both URL shapes, 429 variants); self-check tests. (AC2, AC7)
2. **Config and host derivation, test-first:** BYN-CF1 to CF8. (AC4, AC7)
3. **Auth mappings, test-first:** BYN-AU1 to AU9 (authorize URL, exchange, refresh, classification, account name, no revoke, no refresh retry). Then **run the plumbing suites (OA, TS, RF, CN, SC, PO) with Bynder registered**, including the rotation cases against the rotating fake. **Phase checkpoint: green with zero shell change** (machine proof of AC2, AC3, AC4). Stop and review here.
4. **Browse mappings, test-first:** BYN-SE1 to SE8, BYN-TY1 to TY2, BYN-TH1 to TH3. (AC1)
5. **Detail, renditions, alt text, test-first:** BYN-RD1 to RD10, BYN-AL1 to AL7. (AC1)
6. **Errors and limits, test-first:** BYN-ER1 to ER8. (AC2, AC7)
7. **Registry entry, wrangler vars, `.dev.vars.example`, conformance registration, README section;** repo checks BYN-RC1 to RC6. (AC3, AC4, AC5)
8. **Browser tests with Bynder-shaped worker data** (BYN-UI), **Playwright e2e** (BYN-E1 to E10), **runtime smoke** (BYN-SO1 to SO3). (AC1, AC2, AC6, AC7)
9. **CI:** add the suites to the existing jobs; no secrets in CI. (AC8)
10. **Deploy and verify:** add the Bynder vars and `BYNDER_CLIENT_SECRET` to the deployed worker (KV and shared secrets exist from #25), register the deployed redirect URI, run manual MB1 to MB11; record real responses as fixtures and replace the docs-derived ones; record the observed facts (authorize and callback parameters, state limit, rotation, revoked-grant body, `total=1` shape, list-by-id `mediaItems`, delivery hosts and URL shapes, `property_*` shape and scope, 429 headers, keyword special characters, localhost redirect acceptance) in the PR and README. (AC1, AC2, AC6, AC7)
11. **Hand-off to #24:** list any friction Bynder found in the plumbing, the amendments that were accepted, and the Durable Object decision outcome.

---

# Testing Requirements

Template-provided tests (UA/UC/UP/US/UK), #23's suites (SH, PC, CQ-CX, UI, E2E, SM, RC) and #25's plumbing suites (OA, TS, RF, CN, SC, PO, UO, EO, SO, RO) run unchanged for this worker. The IDs below are **additional**, prefixed `BYN-`: CF = configuration and hosts, AU = auth mappings, SE = search, TY = types, TH = thumbnails, RD = renditions and detail, AL = alt text, ER = errors, PC = conformance extras, UI = browser, E = end-to-end, SO = smoke, RC = repo checks; **MB** = manual. The plumbing suites are not repeated here; **BYN-AU9 re-runs them with Bynder registered**, which is the machine proof that Bynder adds only a module.

## 1. Worker unit tests (seams W1, P1; Node built-in runner)

Fixtures and mocks: the #2 test kit (`makeEnv`, `fakeIms`, `signToken` for users A and B, `fakeUpstream`, canaries); #25's in-memory KV (write log, raw dump, failing `put`, stale-read mode); **`fakeBynder(script)`** (above) recording every request (method, host class, path, query, headers, form body); Bynder fixtures, **docs-derived first and replaced by recordings in MB3**, each with a provenance note: list pages in the bare-array shape and in an object shape with a total (public image with `original`; non-public image; limited; archived; watermarked; video; PDF; 3D; asset with no thumbnails; `extension` as a one-entry array; `property_<alt>` as a string, as an array and absent; `/m/` and `/asset/` URL shapes; URLs on the portal host and on a second CDN host); a list-by-id result with `mediaItems` (some without `publicUrl`); `currentUser` (first, infix, last name; username only; with email); token and refresh JSON (with and without `refresh_token`, a narrowed `scope`, no `expires_in`); error bodies (RFC 6749 codes, empty, HTML, unknown JSON); `429` with and without `Retry-After`. Canaries for `BYNDER_CLIENT_SECRET`, `TOKEN_ENC_KEY`, `OAUTH_STATE_KEY`, the access and refresh tokens the fake issues, the sealed ticket and state and the binding nonce. Injected `now`, `sleep`, `random`.

### 1.1 Configuration and host derivation (AC4, AC7)

| ID | Behaviour asserted |
|---|---|
| BYN-CF1 | Bynder is *configured* only when `BYNDER_PORTAL_DOMAIN`, `BYNDER_CLIENT_ID` and `BYNDER_CLIENT_SECRET` are all present: otherwise it is omitted from `/dam/providers`, its routes answer `404 not_found`, the worker starts and Cloudinary and Dropbox keep working |
| BYN-CF2 | `BYNDER_PORTAL_DOMAIN` validation: a bare lower-cased host passes; a scheme, path, port, userinfo, query, IP literal, empty label, trailing dot or whitespace fails registration naming the setting and never its value; upper case is normalised |
| BYN-CF3 | Derived hosts: `authorizeHosts` and `outboundHosts` are exactly `[portal]`; `deliveryHosts` is `[portal]` plus the valid entries of `BYNDER_DELIVERY_HOSTS` (an entry with a scheme, path or wildcard fails registration); changing the portal changes all three |
| BYN-CF4 | `BYNDER_SCOPES` must contain `offline`, `asset:read` and `current.user:read` (extras allowed, tokens validated as scope names); otherwise registration fails naming the setting; the default is exact; the authorize URL carries the configured list space-separated |
| BYN-CF5 | `BYNDER_ALT_PROPERTY` (letters, digits, underscore) and `BYNDER_DEFAULT_DERIVATIVE` (a derivative-name charset) and `BYNDER_CACHE_SECONDS` and `BYNDER_PUBLIC_ONLY` validate; invalid values fail registration naming the setting |
| BYN-CF6 | `BYNDER_TEST_ORIGIN` is honoured only when the template's local flag is on; with the flag off the real portal host is used and the fake receives nothing |
| BYN-CF7 | Bynder fully configured with any single plumbing item missing (KV binding, `TOKEN_ENC_KEY`, `OAUTH_STATE_KEY`, `PUBLIC_WORKER_ORIGIN`) fails the start naming the item (#25 CN6 with Bynder); a deployment with no Bynder settings starts exactly as before |
| BYN-CF8 | `BYNDER_CLIENT_SECRET` is not required at deploy time (absent: provider omitted) and, when present, never appears in any response, header, redirect or log line (canary) |

### 1.2 Auth mappings (AC2, AC3, AC7)

| ID | Behaviour asserted |
|---|---|
| BYN-AU1 | `begin` -> `302` to `https://{portal}/v6/authentication/oauth2/auth` with exactly `client_id`, `scope`, `redirect_uri` equal to the configured callback, `response_type=code` and the sealed `state`; no `client_secret`, no `code_challenge`, no extra parameter anywhere in the URL |
| BYN-AU2 | For the longest allowed IMS user id the sealed state fits Bynder's `maxStateBytes`; a longer one is refused at `connect` (#25 OA1) |
| BYN-AU3 | Callback: exactly one `POST https://{portal}/v6/authentication/oauth2/token`, `application/x-www-form-urlencoded`, `grant_type=authorization_code`, `code`, the same `redirect_uri`, `client_id` and `client_secret` in the body and **no `Authorization` header**; a JSON body is never sent; then one `currentUser` call with the new access token as bearer |
| BYN-AU4 | Token result mapping: `access_token`, `expires_in`, `refresh_token`, `scope` become the normalised result; an absent `expires_in` becomes 3,600 s; a response without `refresh_token` is refused and nothing is stored; a granted `scope` that lacks any configured scope is refused (the narrowed-scope case) and nothing is stored; a superset passes |
| BYN-AU5 | Account name: `firstname`, `infix`, `lastname` joined by single spaces; else `username`; the email address never appears in the label, the provider list or any log; a `currentUser` failure after a successful exchange fails the callback, stores nothing and makes **no revoke call** (none exists) |
| BYN-AU6 | Refresh: an expired token -> exactly one `POST` with `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret` in a form body; a response **with** a new `refresh_token` replaces the stored one (single-use rotation), one **without** keeps the stored one byte-identical |
| BYN-AU7 | Failure classification table of D6, row by row: `invalid_grant` -> reauth; `invalid_client`, `unauthorized_client`, `invalid_scope`, `invalid_request`, any `401`, a non-JSON body, an empty body, unknown JSON, other `4xx` -> misconfigured (record kept); `5xx` and network -> transient; for each of exchange and refresh |
| BYN-AU8 | **No blind refresh retry:** a refresh answering `5xx` or timing out is attempted exactly once, answers `502 upstream_unavailable` and keeps the record; the code exchange is never retried either; read-only GETs are retried per the template [needs A2; with A2 declined this test is replaced by the documented fallback in section 9] |
| BYN-AU9 | **Plumbing re-run:** the OA, TS, RF, CN, SC and PO suites run with `provider: bynder` registered and the rotating `fakeBynder`; in particular RF3 (rotation replaces the refresh token), RF4 (single-flight), RF8 to RF10 (re-read before destroying, stale-read rotation race ends in a clean marker and a working reconnect, write failure after rotation) and CN4 (Disconnect makes **no upstream call** for a provider without `revoke`) pass with no shell change |
| BYN-AU10 | Config fingerprint (if A3 is accepted): a stored record created under one `(BYNDER_CLIENT_ID, portal)` reads as `reauth_required` after either changes, the author reconnects and the record is replaced; no secret is part of the fingerprint |

### 1.3 Search, types, thumbnails (AC1)

| ID | Behaviour asserted |
|---|---|
| BYN-SE1 | One `GET /api/v4/media/` per search on the portal host only, with `keyword`, `type`, `orderBy`, `limit`, `page`, `total=1`; `Authorization: Bearer <author's Bynder token>` and never the IMS token; no inbound `Authorization` or cookie forwarded; no `includeMediaItems` |
| BYN-SE2 | Empty `q` -> no `keyword`, default sort `dateModified desc`; `type=all` -> no `type`; each type maps to its Bynder value |
| BYN-SE3 | Sorts: `modified` -> `dateModified desc`, `created` -> `dateCreated desc`, `name` -> `name asc`; an unknown sort or `relevance` -> `400` with zero upstream calls |
| BYN-SE4 | Window and paging: `page` and `pageSize` become `page` and `limit`; `page x pageSize` above 100,000 -> `400` with zero upstream calls (shell, SH5 with Bynder's window); the last allowed page is passed through |
| BYN-SE5 | `hasMore` and `total`: from the object shape's total when present; from a bare array the rule "page full means more"; an empty page -> `200` with no items and `hasMore` false; the mapper accepts both response shapes without error |
| BYN-SE6 | Special characters in `q` (`&`, `#`, `+`, `=`, `%`, quotes, `*`, `:`, newline, unicode) arrive upstream only as the encoded `keyword` value and cannot add, replace or remove any parameter (`&limit=1000`, `&isPublic=false`, `&id=...`) |
| BYN-SE7 | Asset-id validation: 8-4-4-16 hexadecimal accepted case-insensitively; the 8-4-4-4-12 form, `..`, `%2f`, `/path`, extra segments, over-long and empty ids -> `400` with zero upstream calls; a valid id is sent only as the `id` query value |
| BYN-SE8 | `BYNDER_PUBLIC_ONLY=true` adds `isPublic=true` to every search and makes a detail of a non-public asset `404 not_found`; unset, neither happens |
| BYN-TY1 | Type mapping from the fixtures: `image`, `video`, `audio`, `document` as is; `3d` -> `other`; `extension` array -> first entry; unknown -> `other` |
| BYN-TY2 | Original displayability: jpg, jpeg, png, gif, webp, avif, svg offer `original`; tif, psd, raw and the like do not (fixed reason when it is the only candidate) |
| BYN-TH1 | `thumbnailUrl` is the first of `thul`, `webimage`, `mini` that passes the output policy; one on a host outside `deliveryHosts`, `http:` or empty is skipped; none left -> absent |
| BYN-TH2 | An asset with no `thumbnails` gets no `thumbnailUrl` and the page stays intact |
| BYN-TH3 | The worker makes **no** call to fetch thumbnail bytes and never produces a `data:` URL; the only outbound calls per search are the Bynder list (and a refresh when due) |

### 1.4 Detail, renditions, alt text (AC1)

| ID | Behaviour asserted |
|---|---|
| BYN-RD1 | Detail = one `GET /api/v4/media/` with `id` and `includeMediaItems=1` (empty result -> `404 not_found`); across the whole request log of the full matrix the module never calls the download endpoint, the derivatives endpoint, `GET /api/v4/media/{id}/download`, any `POST`, `PUT`, `PATCH` or `DELETE` to the API, or any host other than the portal |
| BYN-RD2 | Renditions are offered in the order `webimage`, `thul`, `mini`, custom derivatives, `original`; the default is `BYNDER_DEFAULT_DERIVATIVE` when present, else `webimage`, else the first available; each carries a label and kind; `defaultRenditionId` points at an offered rendition |
| BYN-RD3 | `original` is offered only when Bynder returned it **and** its extension displays in a browser; an asset marked non-public (no `original` in the response) never offers it |
| BYN-RD4 | `mediaItems`: entries with a `publicUrl` on an image asset become `custom:<name>` renditions; entries without are dropped; non-image assets get none |
| BYN-RD5 | Output policy for Bynder URLs: `http:`, `javascript:`, `data:`, credentials in the URL, a host outside `deliveryHosts` or an empty string drop that rendition; an image whose renditions all drop is `insertable.ok=false`, reason "No public rendition is available for this asset", status `200` |
| BYN-RD6 | **URLs are opaque:** every returned rendition and link URL is byte-identical to the fixture string (query strings, `/m/` and `/asset/` shapes, unusual encodings, no appended `format`); a fixture with `idHash` and `transformBaseUrl` but no URL yields no URL; no URL is ever built from an id, a name or a hash |
| BYN-RD7 | Non-image asset: `linkUrl` is the returned `original`, `renditions` is empty, `insertable.ok=true`; with no `original` the asset is `insertable.ok=false`, reason "This asset has no public link" |
| BYN-RD8 | Warnings: `limited`, `archive`, `watermarked` -> `limited-use`, `archived`, `watermarked`; the asset stays insertable |
| BYN-RD9 | Dimensions: the asset's own `width` and `height` attach to `original` only; derivatives report none; nothing is invented |
| BYN-RD10 | Allow-list mapping: `description`, `tags`, `copyright` are mapped and reduced to plain text; `userCreated`, `propertyOptions`, other `property_*` values, `videoPreviewURLs`, `idHash`, `transformBaseUrl` and any unknown field never appear in a response, including a field named like a secret |
| BYN-AL1 | `BYNDER_ALT_PROPERTY` configured and the property present as a string or as an array (first non-empty entry) -> `alt.source=property`; neither configured nor present -> no property is read |
| BYN-AL2 | Property absent or empty -> `description` (`source=description`) |
| BYN-AL3 | Description absent -> the name without extension, separators to spaces (`Hero_Banner-2024.jpg` -> `Hero Banner 2024`), `source=name`; nothing usable -> empty, `source=none` |
| BYN-AL4 | Markup, entities, control characters and excess whitespace are stripped from every candidate |
| BYN-AL5 | An array of several option names takes the first non-empty entry only (no joining) |
| BYN-AL6 | The alt property name is applied as the `property_` field name only after validation; a name that would address another field (`../`, whitespace, an existing core field name) fails registration |
| BYN-AL7 | A configured property that is absent in the response falls through to the next source without error |

### 1.5 Errors and limits (AC2, AC7)

| ID | Behaviour asserted |
|---|---|
| BYN-ER1 | Browse or detail `401` -> the provider reports *reauth required* (the shell's refresh-and-retry is RF5); `403` -> forbidden; detail `404` or an empty result -> not found; `400` -> bad request; none surfaces upstream text |
| BYN-ER2 | `429` -> *rate limited* with `Retry-After` when present, else 300 s (the shell clamps); the request is not retried beyond the template cap; `5xx` and network -> *upstream unavailable* |
| BYN-ER3 | A non-JSON or HTML body on any status is never parsed and is treated as upstream failure (or misconfigured on the token endpoint) |
| BYN-ER4 | Retry declarations: GETs retried on `5xx` per the template; the token exchange and the refresh are never retried (BYN-AU8) |
| BYN-ER5 | **Canary scan** across a scenario matrix (connect, search, detail, refresh, rotation, every error class): the client secret, access and refresh tokens, sealed values, nonce and encryption keys appear in no response body, header, `Location` or log line (SC5 with Bynder canaries) |
| BYN-ER6 | Dynamic redaction: an upstream error body echoing the author's access or refresh token is redacted in the response and the logs (SC6 with Bynder) |
| BYN-ER7 | Outbound allow-list: only the portal host is contacted (plus the loopback fake when the local flag is on); a `3xx` from the token endpoint is not followed |
| BYN-ER8 | A malformed list or `currentUser` payload (wrong types, missing arrays) maps to `502 upstream_unavailable`, never an uncaught exception or a partial normalised asset |

### 1.6 Conformance extras (AC3, AC4)

| ID | Behaviour asserted |
|---|---|
| BYN-PC1 | #25's PO1 to PO10 and #23's PC1 to PC4 and PC6 to PC8 pass with Bynder registered and **no shell source change** after #25; Bynder appears in `/dam/providers` as `not_connected` with its capabilities |
| BYN-PC2 | Bynder's records, cookies' provider binding and result caches are isolated from Dropbox's and the stubs' |
| BYN-PC3 | The Bynder module imports nothing from the shell except the documented interface helpers (no deep imports) |
| BYN-PC4 | Three `user-oauth` providers (Dropbox, Bynder, one stub) registered together run the plumbing suites once each with no cross-talk; Cloudinary's #23 suites pass unchanged (CN8) |

## 2. Browser unit tests (seam S2; `@web/test-runner`, injected `fetch` standing in for the worker)

The browser code is vendor-agnostic and #25's UO1 to UO12 and #23's UI suites run unchanged. The Bynder-specific tests only prove that Bynder-shaped worker data renders:

| ID | Behaviour asserted |
|---|---|
| BYN-UI1 | A detail with five renditions (`webimage` default, `thul`, `mini`, a custom derivative, `original`) and two warnings renders the rendition chooser with the default selected, the warnings visible, the alt source label ("Bynder property", "description" or "name") shown and Insert enabled |
| BYN-UI2 | Thumbnails are `https:` URLs from the delivery host and render; a summary without `thumbnailUrl` shows the file-type placeholder; a `data:` URL in any field is neither rendered nor insertable |
| BYN-UI3 | A detail with `insertable.ok=false` disables Insert and shows the fixed reason; a non-image with `linkUrl` inserts one `<a>` |
| BYN-UI4 | Insert of the chosen rendition: `sendHTML` once with exactly one `<img>` whose `src` equals the chosen rendition URL **byte for byte** and whose `alt` equals the field, then `closeLibrary` (#23 UI9 with a Bynder URL carrying `?format=` and `&` characters) |
| BYN-UI5 | Capabilities with three sorts and no relevance render no relevance control; the Disconnect note for a provider without upstream revoke renders when the provider list carries the flag (if A4 is accepted) |
| BYN-UI6 | Browser code contains no `bynder` string (extends UO12) |

## 3. End-to-end tests (S1; Playwright, Chromium, hermetic, no credentials)

Servers started by the Playwright config: static server `:3000`; the real worker under `wrangler dev` `:8787` with local KV, `ALLOW_LOCALHOST=true`, test secrets from a temp env file, `PUBLIC_WORKER_ORIGIN=http://localhost:8787` and `BYNDER_TEST_ORIGIN` pointing at the fake; a fake IMS key server; `fakeBynder` on one loopback origin (the authorize endpoint redirects through a login hop that auto-approves and returns to the worker callback; the request log is exposed); `fakeOAuthDam` and `fakeCloudinary` for the switcher. The #1 SDK stub supplies a token signed by the fake IMS key.

| ID | Behaviour asserted |
|---|---|
| BYN-E1 | **Full pop-up OAuth:** Connect -> a real pop-up -> fake Bynder login hop and consent -> worker callback page -> the panel detects the connection without a reload, shows "Connected as <fake name>" and the recent assets with thumbnails |
| BYN-E2 | Search, type filter and sort: the fake's request log shows the exact `keyword`, `type`, `orderBy`, `limit`, `page`, `total`; Load more appends without duplicates |
| BYN-E3 | Select -> detail -> change rendition -> alt from the metaproperty, edit -> Insert: the stub log is `sendHTML` with exactly one `<img src alt>` whose `src` equals the URL the fake returned, then `closeLibrary` |
| BYN-E4 | Token hygiene: page HTML, DOM, `localStorage`/`sessionStorage`, script-visible cookies and all network responses contain none of the client secret, access token, refresh token, sealed values or nonce; the binding cookie is HttpOnly |
| BYN-E5 | **Rotation:** the fake issues a 2-second access token and single-use refresh tokens; a search after 3 s refreshes silently, the stored (encrypted) record changes, the previous refresh token is now rejected by the fake, and the search succeeds with no prompt |
| BYN-E6 | **Lost rotation:** the fake rotates and drops the response; the next search answers a clean failure, then `invalid_grant` leads to "Reconnect" (no loop), and Connect works again |
| BYN-E7 | Revoked grant (`invalid_grant` on refresh) -> "Reconnect"; `invalid_client` -> "ask your administrator" and no Reconnect |
| BYN-E8 | Disconnect: the fake receives **no** call; the panel returns to Connect; a later search needs a new connection |
| BYN-E9 | **The page never calls a Bynder API host:** hosts contacted by the page are the page, the worker, the SDK stub, the fake IMS and only anonymous image GETs for thumbnail and rendition URLs; any page request to an `/api/` or `/v6/` path of the fake fails the test |
| BYN-E10 | Per-user and switcher: users A and B (two tokens): after A connects, B shows Connect; with Cloudinary, Dropbox and Bynder configured the switcher offers all three and keeps each state; a Bynder-only-unconfigured deployment shows no Bynder entry |

## 4. Runtime smoke (W2; Node test driving `wrangler dev`, no Cloudflare login)

| ID | Behaviour asserted |
|---|---|
| BYN-SO1 | The worker with Bynder configured and the plumbing enabled bundles and starts; a bare `/dam/providers` -> `401`; with a valid token the list includes Bynder as `not_connected`; a Cloudinary-only configuration still starts |
| BYN-SO2 | The callback end to end against `fakeBynder` in workerd: the form-encoded token request is correct over real HTTP, the KV record is present, encrypted and carries an expiry |
| BYN-SO3 | Rotating refresh in workerd; a 50-item search: response size, CPU and wall time recorded (informational against R15); the subrequest count for a search and a detail stays within the Free-plan 50 |

## 5. Repo checks (S3, extended)

| ID | Behaviour asserted |
|---|---|
| BYN-RC1 | #25's RO1 extended: the vendor name `bynder` (any case, and `getbynder`) does not appear in the OAuth plumbing, the shell, the browser code or the template additions outside `providers/bynder/`, tests, fixtures, docs, the single registry line, wrangler config and `.dev.vars.example`; a fixture tree with a leak fails (**machine proof of AC4 for the shell**) |
| BYN-RC2 | The set of files outside `providers/bynder/` that mention `bynder` is exactly the allow-list of section 2 (registry, wrangler config, `.dev.vars.example`, README, conformance registration); a fixture tree with an extra file fails (**machine proof of AC4**); #25's RC2 and RO3 (one registry line per provider) pass |
| BYN-RC3 | **No token-storage code in the provider:** no file under `providers/bynder/worker/` (outside `test/` and `fixtures/`) references storage bindings (`DAM_TOKENS`, `KVNamespace`), the sealing or encryption keys (`TOKEN_ENC_KEY`, `OAUTH_STATE_KEY`), `crypto.subtle`, `Set-Cookie` or `cookie`, or defines its own `fetch` outside the outbound helper; a fixture tree with a violation fails (**machine proof of AC3**) |
| BYN-RC4 | The production wrangler config has the Bynder vars, **no** `BYNDER_TEST_ORIGIN`, no secret-looking `vars`; `BYNDER_CLIENT_SECRET` appears in `.dev.vars.example` and is not under `secrets.required`; no tracked `.dev.vars*` (extends #25 RO4 and #2 UR1 to UR5) |
| BYN-RC5 | The extension README contains the Bynder section (D22), documents exactly the vars and secret the worker declares for Bynder, and states "site config keys read: none; no new config-sheet row" (extends #25 RO5) |
| BYN-RC6 | The provider folder is complete: worker module, fixtures each with a provenance note, a conformance-suite registration, no browser code and no `package.json` or wrangler config of its own (#23 RC2 and RC6) |

## 6. Manual end-to-end verification in EW and against real Bynder (needs interactive logins; cannot run in CI)

**Accounts and credentials needed:** everything #25's manual steps need (GitHub admin on `jazhou-adobe/ew-extensions` for Code Sync; two Adobe IMS identities with DA org/site access, one with config-edit rights; Chrome; a Cloudflare account with Wrangler login, the KV namespace and the shared secrets from #25) plus: a **Bynder portal with OAuth Apps enabled by Bynder Customer Support**; a Bynder admin with "Manage portal settings" and "Manage OAuth apps" to register the app (scopes `offline asset:read current.user:read` unless MB3 shows more are needed, redirect URIs for the deployed callback and, if permitted, `http://localhost:8787/oauth/bynder/callback`; **the client secret is shown once**) and to enable public derivatives and the SEO base URL; **two Bynder users with different permission profiles** (one restricted by brand or category, ideally one lacking `asset:read`); test assets: a public image with an `original`, a non-public image, a limited-use asset, an archived asset, a watermarked asset, a video, a PDF, a 3D asset, an asset with a public custom derivative, an asset with a value in a free-text alt metaproperty, an asset with only a description. Never paste tokens or the client secret into chat, issues or logs.

- **MB1 (`ref=local`, connect and browse):** terminals A (`npm start`, 3000) and B (worker dev, 8787, real portal, `BYNDER_TEST_ORIGIN` unset, local KV). Open a document with `?ref=local`, open the library, choose Bynder, Connect -> Bynder sign-in and consent (the scope list is shown) -> the pop-up reports success -> "Connected as <you>" without a reload. Search a known keyword; filter to Images; sort; open an asset; confirm `webimage` is the default rendition, the alt prefill and its source; Insert; inspect the document source: one `<img>` with the exact API-returned URL and the alt text; the library closes. Record whether the local redirect URI was accepted (Q4). Proves AC1, AC2, AC6 (local).
- **MB2 (branch ref, deployed worker, pop-up in the real iframe):** push `multi-dam-picker-bynder` (simple name), wait for code sync, open the editor with `?ref=<branch>`, repeat MB1 against the deployed worker. Record the page's real `Origin`, whether the pop-up opens from the library iframe and that the `SameSite=Lax` binding cookie survives the cross-site return from the portal. Proves AC6 (branch ref), AC7.
- **MB3 (unverified API facts; record sanitised fixtures of every call):** close each [OPEN] and [ASSUMPTION] of this spec: (a) the callback parameter name (`code`?) and that `state` is echoed unchanged; (b) the longest `state` the authorize endpoint accepts (probe 500, 2,000 and 4,000 bytes); (c) the token and refresh response fields, `expires_in`, and the exact error body for a reused authorization code and for a wrong client secret; (d) **whether the refresh token rotates** (compare before and after; reuse the old one and record the answer; test a grace period); (e) the shape of the list response with `total=1` and the field carrying the total; (f) that list-by-`id` with `includeMediaItems=1` returns populated `mediaItems` (else the `versions=1` fallback, D12); (g) the hosts and URL shapes of `thumbnails.*`, `original` and `mediaItems[].publicUrl`, whether thumbnail URLs carry a file extension and what content type they deliver; (h) the shape of a free-text `property_<name>` and whether `asset:read` alone returns it; (i) the `429` response headers; (j) how `keyword` treats quotes, `*`, `-`, `:` and `&`; (k) whether archived assets appear by default and the order of keyword results; (l) the sizes of `mini`, `thul`, `webimage`; (m) what a user lacking `asset:read` is granted; (n) the `currentUser` fields. Update fixtures, D6, D11 to D15 and the README, and revise the scopes **before** the OAuth app is finalised.
- **MB4 (refresh, rotation, revocation, app replacement):** wait over an hour (the documented example lifetime is 3,600 s) and search again: silent success; confirm from the KV record's ciphertext change that the refresh token rotated (or did not). In the portal use "Revoke refresh tokens" for the app and search again: the panel shows Reconnect with no error loop; record the exact token-endpoint error body (R10). Connect, then Disconnect from the panel: confirm the grant is still active in Bynder (no upstream revoke) and that Connect again works. **Replace the OAuth app** (new client id, same worker) and confirm the stranded connections end in Reconnect (with A3) or follow the README purge procedure (without it). Proves AC2.
- **MB5 (renditions and public-ness, anonymous):** in a private window with no Bynder or Adobe session, load the inserted `webimage` of a **non-public** asset, the `original` of a public asset, a custom derivative, and a thumbnail; record which load and the content types; check an asset with a limited-use flag and an archived one (public URLs stay cached for up to 24 h, public assets article); check that a custom domain routes `/asset/`. Proves AC1 ("appropriate rendition URL"), R4 to R6.
- **MB6 (credentials and unauthenticated calls):** `curl -i <worker>/dam/providers` and `curl -i <worker>/dam/bynder/assets` without a token -> `401`; `Origin: https://evil.example` with a valid token -> `403`; `GET /oauth/bynder/callback?code=x&state=y` with no cookie -> the generic failure page and no new KV record; search DevTools Network, page source and Application storage for the client secret and any Bynder token (none; the binding cookie is HttpOnly); `wrangler kv key get` of a record shows ciphertext only; `wrangler secret list` shows `BYNDER_CLIENT_SECRET` by name only. **Login-CSRF by hand** (copy the pop-up's Bynder URL into another browser profile and approve: the callback must fail and store nothing). Proves AC7, AC2.
- **MB7 (per-user and scopes):** the second Adobe user connects with the second Bynder user and sees only what that Bynder user may see; the first user is unaffected; the Bynder user lacking `asset:read` completes consent and gets the generic failure (A5), and the README troubleshooting entry resolves it; confirm the IMS `user_id` is stable across two sessions and tokens (R17). Proves AC2 (per-user).
- **MB8 (EDS round trip):** preview and publish a page with an inserted `webimage` and an `original`; record whether EDS keeps the external URL, rewrites it or re-hosts it, and how a deleted asset renders afterwards (R18, D20).
- **MB9 (README walk-through):** a reviewer follows the Bynder section of the README, including the Customer Support request, from a clean clone to a working local connection and fixes any missing step. Proves AC5.
- **MB10 (review: the diff, AC3 and AC4):** the PR diff touches only `providers/bynder/`, the registry line, wrangler vars, `.dev.vars.example`, the README section and the conformance line; BYN-RC1 to RC3 are green; record any plumbing friction for #24.
- **MB11 (regression):** deploy with Bynder unset: Cloudinary and Dropbox work exactly as under #23 and #25 and no Bynder entry or connect panel appears; deploy with Bynder set and the plumbing item `DAM_TOKENS` removed: the start fails naming the item.

Record results and screenshots in the PR (the PR template asks for the branch-ref test URL).

## 7. CI additions (no credentials, no Cloudflare login)

| Job | Steps | Notes |
|---|---|---|
| `lint` (existing) | ESLint + Stylelint over the extension, worker and providers; `npm run check` runs #23's RC and #25's RO checks plus BYN-RC1 to BYN-RC6 | |
| `unit` (existing) | WTR runs #23's UI and #25's UO suites plus BYN-UI1 to BYN-UI6 | |
| `worker-unit` (existing) | Node tests: #23's and #25's suites with Bynder registered, plus BYN-CF, AU, SE, TY, TH, RD, AL, ER, PC, and the template's UA/UC/UP/US/UK | one job; the conformance suite includes Bynder |
| `worker-smoke` (existing) | #23's SM and #25's SO suites plus BYN-SO1 to SO3 | advisory vs required per #2 Question 11 |
| `e2e` (existing) | starts the static server, the worker (local KV), fake IMS, `fakeBynder`, `fakeOAuthDam`, `fakeCloudinary`; #23 and #25 e2e plus BYN-E1 to BYN-E10 | Chromium only; traces on failure |

All run on every push and PR (#1 decision). Real-Bynder checks (MB*) are manual; no Bynder, Cloudflare or Adobe credential is stored in CI. Branch protection requiring the jobs is an owner repo setting.

## 8. Acceptance-criteria traceability (ticket #22)

| # | Acceptance criterion (#22, in the order of its checkboxes) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Author can browse and search Bynder, filter by type, and insert an image with an appropriate rendition URL and alt text from DAM metadata | BYN-SE1 to SE8 (search, filter, sort, paging, validation), BYN-TY1 and TY2, BYN-TH1 to TH3, BYN-RD1 to RD10 (renditions, public-only, opaque URLs, insertability), BYN-AL1 to AL7 (alt chain); #23 UI3 to UI13 re-run with BYN-UI1 to UI4; BYN-E2, E3 | **MB1** (browse, search, filter, insert, inspect `<img>` and alt), **MB3** (real response shapes), **MB5** (anonymous render of each rendition kind), **MB8** (publish round trip) |
| AC2 | Per-user OAuth with Bynder goes through the worker; tokens are stored and refreshed server-side | BYN-AU1 to AU9 (authorize URL, exchange, refresh with rotation, scope and refresh-token checks, classification, no blind retry, plumbing re-run), BYN-CF7, BYN-ER1 to ER8; #25 OA, TS, RF, CN, SC re-run with Bynder (BYN-AU9); BYN-E1, E4 to E8, E10; BYN-SO2, SO3 | **MB1** (connect), **MB4** (refresh, rotation, revocation, app replacement), **MB6** (ciphertext only, login-CSRF), **MB7** (per-user) |
| AC3 | Uses the picker's existing OAuth plumbing; no new token-storage code | **BYN-RC3** (no storage, key, crypto or cookie references in the provider), BYN-AU9 and BYN-PC1 (the plumbing suites pass with Bynder registered and no shell change), BYN-PC3 (no deep imports), BYN-RC1 | **MB10** (diff review: only the allow-listed files, no storage code); BYN-AU10 only if A3 is accepted |
| AC4 | Added inside the existing `multi-dam-picker` extension folder as a new provider; no changes needed in the shell beyond registering the provider | **BYN-RC2** (exact allow-list of files outside `providers/bynder/`), BYN-RC1, BYN-PC1 to PC4 (conformance, isolation, three OAuth providers together), BYN-CF1 and CF7 (omission and fail-fast without shell edits), BYN-E10 | **MB10** (diff), **MB11** (Cloudinary and Dropbox regression, unconfigured Bynder) |
| AC5 | Extension README documents this vendor's setup (credentials, site config keys) | BYN-RC5 (required README items, exact var and secret names, "site config keys read: none"), BYN-RC2 | **MB9** (clean-clone walk-through including the Customer Support request); review: Bynder-side steps, scopes immutability, redirect URIs, secret shown once, delivery hosts, Disconnect semantics and troubleshooting entries present |
| AC6 | Works in EW with `ref=local` and with a branch ref | BYN-E1 to BYN-E10 prove the page + worker contract on `localhost:3000`/`:8787` against the fake Bynder; BYN-SO1 to SO3 in the real runtime | **MB1** (`ref=local`, real Bynder), **MB2** (branch ref against the deployed worker, real `Origin`, pop-up from the real iframe) |
| AC7 | Vendor credentials live only in this extension's worker (from the shared template); the browser never receives them; unauthenticated calls to the worker are rejected | BYN-CF6, CF8, BYN-ER5 to ER7 (canary scans, dynamic redaction, outbound allow-list), BYN-RC4; #25 SC1 to SC8 and OA11 re-run (BYN-AU9); template UA1 to UA15 and UC7; BYN-UI6; BYN-E4, E9, E10; BYN-SO1 | **MB6** (bare `curl` -> `401`, evil origin -> `403`, secret hygiene, login-CSRF), **MB2** |
| AC8 | Core logic covered by unit tests; lint and CI green | All of sections 1, 2 and 5 run in `worker-unit`, `unit` and `lint`; e2e and smoke jobs green | Review: CI green on the PR; deliberately break a rule on a scratch branch (put a cookie write in the provider; append `?format=` to a rendition URL; send the client secret in a query string; retry the refresh) and see BYN-RC3, BYN-RD6, BYN-AU3/ER5 and BYN-AU8 fail |

Every acceptance criterion on #22 maps to at least one automated test and at least one numbered manual or review step above. (AC3, AC4 and AC8 are largely machine-proved; AC5's README quality is irreducibly a human review; real-Bynder behaviour in AC1 and AC2 is only provable against a real OAuth-enabled portal, MB1 to MB8; AC3's "existing OAuth plumbing" presumes #25 landed with the amendments of section 9 accepted or their fallbacks adopted.)

## 9. Open questions for the owner

### Amendments requested to ticket #25 (OAuth plumbing gaps this vendor exposes; each has a fallback so #22 is never blocked on a redesign)

- **A1. Config-derived hosts and scopes (confirm).** Bynder's authorize, token, API and delivery hosts are one per-portal host and its scopes are configurable. Please confirm that `authorizeHosts` and `scopes` (like `deliveryHosts` and Cloudinary's `outboundHosts`) may be functions of validated configuration and that registration validates them after config validation (#25 PO2). This is probably already covered by #25's per-tenant-host stub (#25 Further Notes, PO4); the ask is an explicit conformance assertion. *Fallback:* none at module level (a static host list cannot express a tenant host); treat as a blocker if declined.
- **A2. Refresh retry safety must be a provider declaration (change).** #25 D9 step 5 and RF7 say the refresh grant is safe to retry for every provider. For a single-use rotating refresh token (Bynder probably, Frontify verified) a blind retry after a timeout can burn the connection. Please make "refresh is retry-safe" a provider-declared flag (default true as today), set false by Bynder and Frontify, and parametrise RF7. *Fallback:* the module reports a transient failure itself without letting the proxy retry (a thin wrapper around its own refresh call; no storage code), which weakens the "provider only" claim and needs one extra check in BYN-RC3.
- **A3. Bind a configuration fingerprint into the stored record (change).** Bynder scopes are frozen per OAuth app (and the client secret is shown once), so replacing the app is a normal operation; stored refresh tokens then fail at the token endpoint with a class that #25 D5/D9 treats as *misconfigured* (record kept, no Reconnect) and every author is stranded until the record expires. Please store a non-secret fingerprint (client id and tenant host) with each record and read a mismatch as `reauth_required` (also helpful for Dropbox scope changes). *Fallback:* the README purge procedure plus the 180-day TTL, and a loud README warning; authors are stranded in the meantime.
- **A4. Honest Disconnect and never-stuck panel (clarify).** Bynder has no per-token revoke (D18). Please (a) expose a provider-list capability derived from the absence of `revoke` so the connect panel can show a fixed note ("This removes the picker's access; a Bynder admin controls revocation in Bynder") and (b) confirm that "Disconnect" stays reachable while a browse call fails as *misconfigured* (#25 D13 shows no Reconnect there), so a misclassified token error is never a dead end (R10). *Fallback:* README only.
- **A5. A distinguishable message for narrowed scopes (decision).** Bynder grants only the scopes the user's own permissions allow, so a user without `asset:read` completes consent and then gets #25's single generic failure page (no oracle by design, OA13). Is a fixed second sentence ("your Bynder account does not have the permissions this picker needs") acceptable, given the page is shown only to the person who just consented and reveals nothing an attacker can use? *Fallback:* README troubleshooting only.
- **A6. PKCE (watch item, no change now).** Bynder's authorize reference documents no PKCE parameters and the client is confidential, so no change is requested. If MB3 or Bynder's newer docs show PKCE is required, an optional `pkce` member (a sealed code verifier inside the state or cookie) would be added to #25 additively.
- **A7. Durable Object decision gate (timing).** #25 Question 3 defers the KV vs Durable Object store decision until a rotating provider is to be enabled. Bynder is likely that provider (D7, R2). Please decide before Bynder is enabled in production, or accept KV with #25's documented residual risk (a lost rotation ends in a clean Reconnect). The decision should be taken once for #22 and #24 together.

### Questions for the owner

1. **Bynder sandbox (R1, blocking verification).** Is there a Bynder portal with OAuth Apps enabled (Customer Support must enable them), an admin who can register the app, enable public derivatives and the SEO base URL, and load the test assets of section 6, plus two users with different permission profiles? Who owns it? Is there a partner or developer portal I could not find in public docs? Without it MB1 to MB8 are blocked and fixtures stay docs-derived.
2. **Do Bynder refresh tokens rotate? (R2, R16).** Do you know, or can Bynder confirm? It decides whether A7 is a hard gate. MB3 and MB4 will observe it.
3. **Scopes before the app is created (R3, D15).** Do you know whether free-text metaproperty values come back with `asset:read` alone? Because scopes cannot be edited, I recommend the first real OAuth app be a throwaway used in MB3, then recreated with the final scopes.
4. **Redirect URIs (R11).** Does your Bynder OAuth app allow several redirect URIs and an `http://localhost:8787/...` one (Bynder's examples show `https://localhost/callback`)? If not, accept an `https` local worker or a tunnel for `ref=local`?
5. **Alt text.** Which metaproperty holds alt text in your portal (`BYNDER_ALT_PROPERTY`), and is it a free-text type? Is the chain (property, description, cleaned name, then empty and flagged), including a name-derived prefill, acceptable?
6. **Public-ness policy (R6).** Warn only for limited-use, archived and watermarked assets (this spec) or block them? Should `BYNDER_PUBLIC_ONLY` default to on? Accept inserting `webimage` of a non-public asset (thumbnails are "public by default") or require "Mark as public" for every insert?
7. **Delivery hosts and link format (R4, R5).** Does your portal use a custom domain, SEO base URL or CDN, and is token-based public link access enabled? Have custom routes been updated for `/asset/`?
8. **One portal per deployment (D4).** Is one Bynder portal per EW site (one worker deployment) enough, or do you need several portals per site (a portal selector and per-portal credentials)?
9. **Rate-limit exposure (R12).** Can you confirm whether Workers subrequests share egress IPs (Bynder limits per source IP: 4,500 per five minutes, then a five-minute pause)? If it matters in practice, is a per-user request limit wanted as a follow-up?
10. **Disconnect and standing credentials (D18, R14).** Is "Disconnect removes only our stored copy; a portal admin revokes all tokens of the app" acceptable for a non-expiring refresh token, together with #25's encryption, 180-day retention and purge procedure? Who signs off the policy and the Cloudflare account (#25 Question 4)?
11. **Build vs Universal Compact View (D3).** Confirm building our own UI (UCV puts a Bynder token in the browser and is single-vendor), or accept a UCV-based Bynder-only variant that would not satisfy AC2 and AC3 as written.
12. **IMS `user_id` stability (R17).** Do you know whether the IMS `user_id` is identical for the shell and library tokens of the same person? MB7 will check.
13. **Names.** The `BYNDER_*` var names, the sort ids `modified`, `created`, `name`, the rendition ids `webimage`, `thul`, `mini`, `custom:<name>`, `original`, the provider label `Bynder`, the branch name `multi-dam-picker-bynder` and the `ORG`/`SITE` assumption (`jazhou-adobe`/`ew-extensions`, #1 R10) are proposals; the `providers/<vendor>/worker/` placement is carried from #2 Question 3.
