# Spec: Firefly Generate & Insert (library plugin, Adobe Firefly image generation)

Ticket: jazhou-adobe/ew-extensions#18 (this spec: #56). Blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe.

Vocabulary follows #1 and #2: *extension* = one folder `apps/<name>/`; *library plugin* = an extension registered in the `library` tab of the EW site config (this one; the ticket says "Plugin"); *worker* = the per-extension backend in `apps/<name>/worker/`; *template* = `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension; *Firefly credentials* = the Firefly Services OAuth Server-to-Server client id + client secret.

Primary sources read (all 2026-11-16):
- EW developing docs (SDK, `sendHTML`, plugins): https://www.aem.live/docs/ew/developing/apps-plugins
- EW library setup (config columns): https://www.aem.live/docs/ew/administering/set-up-library
- Firefly API OpenAPI document (3.0.0, production server `https://firefly-api.adobe.io`), read in full for the schemas cited: https://raw.githubusercontent.com/AdobeDocs/ffs-firefly-api/main/static/firefly-api.json (rendered at https://developer.adobe.com/firefly-services/docs/firefly-api/api)
- Firefly async guide: https://developer.adobe.com/firefly-services/docs/firefly-api/guides/how-tos/using-async-apis
- Firefly credentials and token guides: https://developer.adobe.com/firefly-services/docs/guides/get-started and https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/create-credentials/
- Firefly usage notes (rate limits, storage domains): https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/usage-notes/
- Firefly style presets: https://developer.adobe.com/firefly-services/docs/firefly-api/guides/concepts/style-presets/
- Firefly overview (Image Model 5, custom models): https://developer.adobe.com/firefly-services/docs/firefly-api/
- DA SDK source: https://da.live/nx/utils/sdk.js and https://da.live/nx/utils/daFetch.js
- EW library host (how a plugin is mounted and what the host does with `sendHTML`): https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/iframe-protocol.js and `.../helpers.js`
- How EW itself uploads images into a document: https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-editor-doc/prose-plugins/base64Uploader.js, `.../sourceUploadContext.js`, https://github.com/adobe/da-live/blob/main/blocks/canvas/utils/image-upload.js, https://github.com/adobe/da-nx/blob/main/nx2/utils/api.js (`source.uploadMedia`) and https://github.com/adobe/da-nx/blob/main/nx2/utils/api.md
- DA Source API: https://docs.da.live/developers/api/source
- AEM Assets repository config keys EW already reads: https://github.com/adobe/da-nx/blob/main/nx2/utils/aem-assets/repository-config.js and `.../README.md`
- Size limits for images: https://www.aem.live/docs/limits

---

## Problem Statement

A content author editing a page in Experience Workspace (EW) often needs an image that does not exist yet: a hero background, an illustration for a blog post, a mood image for a campaign. Today the author leaves the editor, generates something in another Adobe tool or a third-party generator, downloads it, uploads it to the site's media, copies it back into the document, and then remembers to write alt text. Each hop is friction, and the images that come from unmanaged generators carry no brand guardrails.

EW's own AI assistant may add image generation in future (ticket scoring: overlap risk 4/5), so a generic "type a prompt, get a picture" box is the part most likely to be superseded. What an extension can add that a general assistant will not is **tight control over Adobe Firefly's options** (aspect ratio, content class, style presets and style reference images) and **site-level brand-safe defaults** that every author on that site inherits.

Firefly Services needs server-to-server credentials. Extension code is static, public, and iframed into `da.live`, so those credentials cannot ship in it; and generation takes seconds to tens of seconds, so the author must see that something is happening.

## Solution

A **library plugin** called **Firefly Generate & Insert** opens from the editor library as a full-size dialog. The author:

1. types a prompt and optionally adjusts aspect ratio, content class (photo or art), style presets, a style reference image and strength, and a negative prompt. Defaults are brand-safe and come from the site's configuration;
2. presses Generate and watches a live progress state (queued, generating, elapsed time, cancel);
3. gets up to four variants in a grid, can regenerate with the same settings, or tweak and generate again;
4. selects one variant, edits the pre-filled alt text, and presses Insert. The image is stored in the site's media (DA by default; AEM Assets when the site is configured for it and that path passes the feasibility gate in the Build Analysis) and the library inserts an `<img>` with the alt text at the author's cursor.

All Firefly calls go through this extension's **own worker**, built from the shared worker template (ticket #2). The worker validates the author's IMS token on every request, holds the Firefly credentials as Cloudflare secrets, mints and caches the Firefly access token, and exposes a small route set: capabilities, start generation, poll status, cancel, fetch variant bytes, and upload a style reference. The browser never sees the Firefly client id, client secret, or Firefly access token, and unauthenticated calls are rejected by the template before any handler runs.

## User Stories

Content author (EW end user):

1. As a content author, I want to open "Firefly Generate & Insert" from the editor library, so that I can create an image without leaving the document.
2. As a content author, I want to type a prompt and press Generate, so that I get image candidates in seconds.
3. As a content author, I want to choose an aspect ratio (1:1, 4:3, 3:4, 16:9, 9:16), so that the image fits the block I am filling.
4. As a content author, I want to choose a content class (photo or art), so that Firefly leans photographic or illustrative.
5. As a content author, I want to pick from a short, curated list of style presets and set how strongly they apply, so that the result matches the look I need.
6. As a content author, I want to upload a style reference image and set how closely Firefly follows it, so that new images match an existing visual.
7. As a content author, I want to write a negative prompt (things to avoid), so that I can steer away from unwanted elements.
8. As a content author, I want to see several variants of one prompt side by side, so that I can choose the best one.
9. As a content author, I want a Regenerate button that reuses my prompt and options, so that I get a fresh set without retyping.
10. As a content author, I want to change one option and generate again without losing the others, so that I can iterate.
11. As a content author, I want to see that generation is running (status text, elapsed time, a visible activity indicator), so that I do not think the plugin froze.
12. As a content author, I want to cancel a running generation, so that I do not wait for a result I no longer want.
13. As a content author, I want to enlarge a variant before choosing, so that I can inspect details.
14. As a content author, I want to select exactly one variant, so that it is clear which image will be inserted.
15. As a content author, I want the alt text pre-filled from my prompt (or from Firefly when it provides one) and editable before I insert, so that every inserted image is accessible and I stay in control of the wording.
16. As a content author, I want to mark an image as decorative (empty alt) explicitly, so that I never ship an image with missing alt text by accident.
17. As a content author, I want Insert to save the chosen image to my site's media and put it at my cursor, so that I do not download and re-upload anything.
18. As a content author, I want the dialog to close after a successful insert (and tell me if it could not confirm the insert), so that I can continue editing.
19. As a content author, I want a plain-language message when my prompt is rejected by Firefly's content policy, so that I know to rephrase rather than retry.
20. As a content author, I want a clear "rate limited, try again in N seconds" message with a countdown, so that I know when I can retry.
21. As a content author, I want a clear message and a Retry button when the generation service is unavailable, so that a vendor outage does not look like my mistake.
22. As a content author, I want a notice that each generation consumes Firefly credits, so that I do not generate recklessly.
23. As a content author, I want my prompt and options kept if I close and reopen the dialog during the same editing session, so that an accidental close does not lose my work. [OPEN: nice-to-have, see Out of Scope]
24. As a content author using only a keyboard or screen reader, I want the variant grid to be a labelled radio group and status changes announced politely, so that I can use the plugin.
25. As a content author, I want the plugin to tell me when it is opened outside EW (standalone tab), so that I understand why nothing works.

Site administrator / brand owner:

26. As a site admin, I want to set site-wide defaults (aspect ratio, content class, style presets, negative prompt) in the site configuration, so that every author starts from on-brand settings.
27. As a site admin, I want the plugin to fall back to safe built-in defaults when I set nothing, so that enabling it is a one-row change.
28. As a site admin, I want to enable the plugin by adding one row to the `library` sheet, so that rollout needs no code change.
29. As a site admin, I want to choose whether images go to DA media or to AEM Assets (when my site uses AEM Assets), so that generated images follow my asset governance.
30. As a site admin, I want the worker to reject callers whose IMS client is not on an allowlist, and optionally restrict users, so that "any Adobe user" cannot spend my Firefly credits.
31. As a site admin, I want an unmistakable error when the worker is not deployed or not configured, so that I can fix setup quickly.

Maintainer / operator:

32. As the maintainer, I want the Firefly client id, client secret and any minted access token to exist only in the worker, so that a public repo and public static files cannot leak them.
33. As the maintainer, I want unauthenticated and wrong-origin calls to the worker rejected, so that nobody can use my Firefly quota by finding the URL.
34. As the maintainer, I want job handles to be bound to the user who started the job, so that one author cannot poll, cancel, or download another author's job.
35. As the maintainer, I want the worker to validate every option against an allowlist before calling Firefly, so that the worker cannot be used to send arbitrary parameters or hosts to the vendor.
36. As the maintainer, I want the worker not to blindly retry a generation POST on 5xx, so that a retry never double-spends credits (per #2 Decision 8).
37. As the maintainer, I want rate-limit (429) responses to reach the author with `Retry-After`, so that the UI can count down instead of failing opaquely.
38. As the maintainer, I want the Firefly access token cached per worker isolate and refreshed before its 24 h expiry or on a 401, so that one token mint serves many requests.
39. As the maintainer, I want CI to run unit and hermetic end-to-end tests with a fake Firefly and no credentials, so that regressions are caught without spending credits.
40. As the maintainer, I want a recorded real-response fixture set and a non-blocking drift check against Adobe's published OpenAPI document, so that API changes surface before authors hit them.
41. As the maintainer, I want the extension folder, worker, tests and README self-contained, so that it can be moved upstream or deleted without breaking other extensions.
42. As the maintainer, I want the README table row and the library registration documented, so that an enabled-but-undiscoverable plugin cannot ship.

Security reviewer:

43. As a security reviewer, I want a canary test proving the Firefly secrets and the minted token never appear in any response, header, or log across success and error paths, so that "never echoed" is tested rather than promised.
44. As a security reviewer, I want proof that the worker's origin cannot be redirected by a URL parameter, so that a crafted link cannot send an author's IMS token elsewhere.
45. As a security reviewer, I want proof that author-controlled text (prompt, alt text, error messages) is only ever rendered as text, so that prompts cannot inject markup into the plugin or the document.

## Implementation Decisions

(No file paths or code, except where noted; layout is in the Build Analysis.)

**Extension shape**

1. **Type and registration.** Library plugin in its own folder `apps/firefly-generate/` (owner convention). Registered by one row in the `library` tab of the site (or org) config; `experience` is `fullsize-dialog`. Rationale: the host mounts a `fullsize-dialog` plugin in a modal iframe and wires the same SDK channel as the inline panel (`setupIframeChannel` is called in `loadModal`) [VERIFIED: `helpers.js` `extensionToPanelView`, https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/helpers.js]. A four-variant grid does not fit an inline side panel. The `window` experience is not usable (it opens a new tab; the SDK channel and `sendHTML` do not apply) [VERIFIED: same file, comment "Window extensions open in a new tab"]. Whether the narrow `inline` layout should also be supported as a degraded mode is [OPEN, low stakes]; the page must at least remain usable at panel width because a site admin may leave `experience` blank (`inline` is the default) [VERIFIED default: `experience: row.experience || 'inline'`].
2. **Two small modules, as in #1:** side-effect-free logic and render modules exported for tests, plus a thin bootstrap that awaits the SDK and wires `actions`. SDK is imported from `https://da.live/nx/utils/sdk.js` and awaited (not the bare global), per the #1 spec.
3. **Option set is capability-driven.** The page asks the worker for a *capabilities descriptor* on load (supported aspect ratios, content classes, variant count bounds, curated style presets, style-reference support and limits, maximum prompt length, and the site-agnostic defaults). The form renders only what the descriptor allows. This keeps the browser and the configured Firefly model in agreement and makes a later model switch additive (see Decision 8).
4. **Variant flow state machine (behavioural).** `idle -> submitting -> generating (polling) -> ready (variants shown) -> saving -> inserted`, with `failed`, `cancelled`, and `rate-limited(retryAt)` side states reachable from submitting/generating, and `ready -> submitting` for Regenerate or edited options. Only one job is active per dialog; Generate is disabled while one runs. Closing the dialog cancels a running job best-effort.
5. **Progress.** Firefly's status endpoint returns a status enum (`pending`, `running`, `succeeded`, `failed`, `cancelled`, `cancel_pending`, `timeout`) and the schema for non-terminal responses has **no percentage field** [VERIFIED: `JobPollPayload` and `JobResponse` in the OpenAPI document; only the Image 5 accept response carries a `progress` number]. So "progress" in this extension means *status text + elapsed time + indeterminate activity indicator + cancel*, not a percentage bar. If a percentage appears in real responses (spike S0), the UI uses it when present. The browser polls the worker (not Firefly) every ~2 s, backing off and honouring `Retry-After` on `429`; Firefly's own example polls once per second [VERIFIED: async guide] but whether status polls count against the 4 requests-per-minute organisation rate limit is undocumented (R3), so the default is conservative.
6. **Brand-safe defaults.** Built-in defaults (used when the site sets nothing): 4 variants, the form always has an explicit content class (pre-selected `photo`), aspect ratio 4:3, no style presets, empty negative prompt, notice about credit use. [ASSUMPTION: these specific defaults; owner may change.] The site config can override defaults (Decision 12). All inputs are validated against allowlists in the worker (Decision 14), and Firefly content-policy outcomes (HTTP 451 codes `prompt_unsafe`, `prompt_entity_denied`, `image_unsafe`, `reference_image_unsafe_error`, `input_media_unsafe`, and `legal_error` [VERIFIED: `ContentPolicyErrorCode451`]) map to a dedicated, friendly "content policy" message that never echoes the prompt back as markup. The `promptHasBlockedArtists` response flag, when present, shows a notice that the prompt named blocked artists [VERIFIED field exists in `GenerateImagesResponseV3`; exact semantics [ASSUMPTION]].
7. **Variant selection and alt text.** Exactly one variant is selected (radio group). The alt text field is pre-filled with the Firefly-provided `altText` when non-empty, otherwise the prompt trimmed to a short length at a word boundary [ASSUMPTION: 125 characters], is editable, and Insert is blocked while the field is empty unless the author ticks "Decorative image" (which inserts `alt=""`). Editing alt text *after* insertion is the editor's job; the SDK has no "update image" action. [VERIFIED: SDK `sendHTML` without `replace` is insert-only.]

**Firefly model and options**

8. **One model per deployment, default Image 4 Standard on the v3 endpoint.** The worker is configured with one Firefly model (`FIREFLY_MODEL`, a non-secret var). Rationale from the OpenAPI document: the `POST /v3/images/generate-async` endpoint takes the `x-model-version` header (`image3`, `image3_custom`, `image4_standard`, `image4_ultra`, `image4_custom`) and supports `numVariations` 1-4, `contentClass` (`photo`|`art`), `style.presets`, `style.strength` (1-100), `style.imageReference`, `negativePrompt` (<=1024), `size` (pixel pairs; Image 4 supports 1:1 2048x2048, 4:3 2304x1792, 3:4 1792x2304, 16:9 2688x1536, 9:16 1440x2560), `seeds`, `visualIntensity` [VERIFIED]. In contrast, the **Image 5** endpoint `POST /v4/images/generate-async` (`x-model-version: image5`) accepts only `prompt` (<=1500), `aspectRatio` (`1:1,4:3,3:4,16:9,9:16,auto`), `resolutionLevel` (`1MP|2.4MP|4MP`), `modelSpecificPayload` (`localeCode`, `prompt_reasoner`), `referenceBlobs` (max 1, general usage), `seeds`, and **`numVariations` maximum 1**; it has no `contentClass`, no style presets, and "for multiple variations, send separate requests" [VERIFIED: `ImageGenerateRequestV3`]. Because the ticket asks for content class, style presets and several variants, v1 targets the v3 endpoint with Image 4 Standard; Image 5 is a documented follow-up (it would need fan-out requests that collide with the 4 RPM limit, R3). Whether Image 4 Standard accepts the style/contentClass fields exactly as Image 3 does is not stated in the schema [ASSUMPTION]; spike S0 verifies and the fallback is `image3`. `FIREFLY_MODEL` stays a config value so the owner can change it without code. [OPEN: owner confirmation of Image 4 vs Image 5.]
9. **Aspect ratio mapping** from the five UI ratios to the exact pixel `size` pairs Image 4 supports (table in Data Contracts). Ratios outside the supported set are not offered.
10. **Regenerate** sends a new generation request with the same options and **no seeds** so Firefly returns fresh random seeds [ASSUMPTION: omitting `seeds` yields random seeds; the response always returns the `seed` used, VERIFIED `OutputImageV3.seed`]. The author can optionally lock a seed later (Out of Scope).
11. **Style reference.** The author may upload one local image (JPEG, PNG, WEBP) as a style reference with a strength slider. The browser sends the bytes to the worker; the worker uploads them to Firefly's storage endpoint (`POST /v2/storage/image`, accepts `image/jpeg`, `image/jxl`, `image/png`, `image/tiff`, `image/webp`) and returns an opaque reference id (the Firefly `uploadId`, valid 7 days) [VERIFIED: OpenAPI `StorageImage.id` description "valid for 7 days"]. The generation request then references it as `style.imageReference.source.uploadId`. The alternative (a pre-signed URL on an allowed storage domain) is not used because the author's reference image lives in DA, not on those domains [VERIFIED allowed list: usage notes].
12. **Site configuration the plugin reads** (key/value rows in the first sheet of the DA site config, site overriding org, the same mechanism EW uses for `aem.repositoryId` [VERIFIED: `repository-config.js`, `getConfigValue`]). Proposed keys: `firefly.aspectRatio`, `firefly.contentClass`, `firefly.stylePresets` (comma list), `firefly.negativePrompt`, `firefly.destination` (`da` or `aem-assets`), and for AEM Assets the existing `aem.repositoryId` plus `firefly.aem.folder`. The plugin reads them with the SDK's `actions.daFetch`. Missing keys, unreadable config (an author may lack config read permission) and invalid values fall back to built-in defaults silently for defaults, and loudly for `firefly.destination` (Decision 17). The exact config-read URL and permission behaviour for ordinary authors are [OPEN] until verified in manual step F2.

**Worker (built from the template; reuses its contract unchanged)**

13. **One worker, Firefly code directly in it.** `apps/firefly-generate/worker/` holds the worker; because Firefly is *the* vendor of this extension (not a follow-up vendor), its routes live in that worker, and `apps/firefly-generate/providers/<vendor>/` is reserved for alternative image generators added by later tickets. [OPEN: confirm this reading of the #1/#2 placement rule.] The worker imports the template core by relative path, per #2 Decision 2.
14. **Routes (all behind the template pipeline: origin gate -> auth -> router).**
    - `GET /firefly/capabilities`: static descriptor for the configured model plus built-in defaults.
    - `POST /firefly/generations`: validates the body against an allowlist schema, builds the Firefly request, calls the async generate endpoint, returns `202 { jobHandle, pollAfterMs }`.
    - `GET /firefly/generations/{jobHandle}`: unseals the handle, polls Firefly status, returns a normalised status and, on success, the variants' metadata and preview URLs.
    - `DELETE /firefly/generations/{jobHandle}`: cancels the Firefly job (`PUT /v3/cancel/{jobId}`) [VERIFIED method and path].
    - `GET /firefly/generations/{jobHandle}/outputs/{index}/content`: streams the variant bytes (Decision 18).
    - `POST /firefly/references`: uploads a style reference to Firefly storage; returns `{ referenceId }`.
    Every other path is `404` after auth (template Decision 4). The worker validates and *rebuilds* the Firefly request from a fixed set of fields; unknown body fields are rejected, never forwarded.
15. **Firefly S2S authentication is worker-internal.** Credentials are created in the Adobe Developer Console as an OAuth Server-to-Server credential on a Firefly Services project [VERIFIED: https://developer.adobe.com/firefly-services/docs/guides/get-started]. The worker exchanges the client id + secret for an access token with `POST https://ims-na1.adobelogin.com/ims/token/v3` (`grant_type=client_credentials`, scopes `openid,AdobeID,read_organizations,firefly_api,ff_apis`) [VERIFIED: async guide sample uses `openid,AdobeID,read_organizations,firefly_enterprise,firefly_api,ff_apis`; the credentials guide uses `openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis`; the minimum working scope set is [ASSUMPTION], settled by spike S0]. The token lasts 24 h [VERIFIED: create-credentials page]. It is cached in isolate memory with a safety margin, concurrent mints are de-duplicated, and a Firefly `401` triggers exactly one forced refresh and one replay of an idempotent call. Each Firefly call carries `x-api-key: <client id>` and `Authorization: Bearer <minted token>` [VERIFIED: OpenAPI `X-Api-Key` and `AccessToken` security schemes].
16. **Job handles are sealed and user-bound.** The worker never gives the browser a raw Firefly job id. The handle is an opaque string containing the Firefly job id, the verified IMS user id, and an expiry, authenticated with a worker-held secret (HMAC). Every job route unseals it, checks the user matches the verified caller and the handle is unexpired, and only then builds the Firefly URL (so a caller can never inject a path into the vendor URL). This gives job isolation between users without any storage (KV/D1 are out of scope per #2). [Design choice; not from a source.]
17. **Destination adapters (browser).** Saving the chosen image is a browser-side step through a small adapter interface: `save(bytes, mime, name, context) -> { src }`.
    - **DA media (default).** Upload with `actions.daFetch` to the DA source store next to the current document, following EW's own paste convention: a hidden folder `.{docname}` beside the document, file `firefly-{seed}.{ext}`, `POST` of multipart form field `data` [VERIFIED convention: `base64Uploader.js` uses `{parent}/.{name}/wp{hash}.{ext}`; VERIFIED API: DA Source API accepts image POSTs as `multipart/form-data` with a `data` field, https://docs.da.live/developers/api/source]. The response's `source.contentUrl` becomes the `<img src>`. For sites upgraded to the newer ("hlx6") source bus, EW uses a different `/media` endpoint with different response shape [VERIFIED: `api.js` `uploadMedia`]; detection is by `GET /ping/{org}/{site}` on the helix admin looking for the `x-api-upgrade-available` header [VERIFIED in `api.md`]. Whether the SDK's `daFetch` can reach those endpoints from the extension is [OPEN], settled by spike S-DA; if it cannot, v1 supports legacy DA sites only and says so plainly. Size guard before upload: EW caps images at 4.5 MB on hlx6 sites and 20 MB on legacy sites [VERIFIED: `image-upload.js`, https://www.aem.live/docs/limits]; Firefly outputs observed in docs are JPEG, typically well below both [ASSUMPTION: size and format, spike S0 records real sizes].
    - **AEM Assets (when configured).** Applies only when the site sets `firefly.destination=aem-assets` and has `aem.repositoryId`. Upload goes to the configured DAM folder via the AEM Assets Author API / direct binary upload [VERIFIED to exist: https://developer.adobe.com/experience-cloud/experience-manager-apis/api/stable/assets/author, https://experienceleague.adobe.com/en/docs/experience-manager-learn/assets/developer/programmatic-asset-upload]. Three facts make this a gated piece of work, not a given: (a) whether the EW user's IMS token is authorised for *writes* on the AEM author tier is unverified (EW passes it to the asset selector, which reads) [ASSUMPTION]; (b) EW's own selector only accepts assets that are *published* (author+publish mode) or *approved* (Dynamic Media), so a freshly uploaded generated asset will not yield a deliverable URL until publication [VERIFIED: aem-assets README]; (c) it needs an AEM Assets API entitlement on the environment [VERIFIED: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/assets/admin/developer-reference-material-apis]. Therefore it is built last, behind spike S-AEM, and if the spike fails the plugin tells the author "AEM Assets destination is not available; saved to DA media instead" rather than silently ignoring the config. [OPEN: owner decision on AC2 "or AEM Assets if configured" if S-AEM fails.]
18. **Variant bytes go through the worker for saving; previews do not.** Previews are plain `<img>` elements pointing at Firefly's pre-signed output URLs (they expire in one hour [VERIFIED: `PublicBinaryOutputV3.url` "expires in one hour"]); `<img>` needs no CORS. Saving needs the bytes, and CORS on Firefly's storage host for a browser `fetch` is undocumented, so the worker streams the chosen variant (`.../outputs/{index}/content`) after re-checking the job and validating that the output URL is `https` on an allowed host suffix (config var, default `.amazonaws.com` [ASSUMPTION: derived from the example URL `pre-signed-firefly-prod.s3-accelerate.amazonaws.com` in the async guide; the real host list is recorded by spike S0]). If S0 proves the output host allows CORS `GET`, the byte proxy can be dropped (simplification, not a requirement).
19. **Error contract.** Template error codes are used unchanged (`bad_request`, `unauthorized`, `forbidden_origin`, `forbidden`, `not_found`, `method_not_allowed`, `payload_too_large`, `rate_limited`, `misconfigured`, `internal`, `upstream_unavailable`, `auth_unavailable`). Firefly-specific outcomes are carried as a stable `reason` field inside job status/err bodies (not new template codes): `content_policy`, `generation_failed`, `generation_timeout`, `cancelled`, `reference_rejected`. Vendor error text is never forwarded.
20. **Retries.** Per #2 Decision 8: `POST /v3/images/generate-async` (credit-spending, non-idempotent) is retried on `429` only; status GET and token mint are retried on `429`/`5xx`; cancel (PUT) is idempotent. Firefly `429` surfaces to the author with `Retry-After` (Firefly sends `retry-after` and `x-access-rate-limit-level` of `org` or `account` [VERIFIED: OpenAPI 429 response headers]). The default org rate limit is **4 requests per minute and 9,000 per day** [VERIFIED: usage notes], so backoff of 250 ms-2 s inside the worker will not clear it; the UI countdown is the real handling.
21. **Who may call.** Template defaults (any authenticated Adobe user on an allowlisted IMS client id) are not enough for a credit-spending vendor (template R3). This worker sets `ALLOWED_IMS_CLIENT_IDS`, supports an optional user allowlist through the template `authorize` hook, and validates request size and prompt length so a single call cannot spend unbounded credits. A per-user request throttle using Cloudflare's rate-limiting binding is recommended; the template documents it but does not build it [per #2 Out of Scope; https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/]. [OPEN: owner decision, see Open Questions.]
22. **Worker origin is a constant.** The page never reads the worker origin from the URL (#2 Decision 13): loopback worker on `localhost`, a fixed deployed origin otherwise.
23. **Dependencies on the template contract** that the template spec does not yet cover and this ticket needs (raised to the owner/Main, not decided here):
    - G1: vendor **token exchange with the secret in the form body** (the template `proxy` injects secrets into a header or query only);
    - G2: registering a **runtime-minted value** (the Firefly access token) for the template's redaction pass;
    - G3: **suffix/wildcard host allowlist** for the content-stream route (output host is not a fixed hostname);
    - G4: **binary streaming** of an upstream response with a size cap through the template pipeline;
    - G5: `Access-Control-Allow-Methods` covering `DELETE` for this worker's routes.
    Until G1-G5 are settled, the build plan step that needs each is marked in the Build Analysis.

**Repo integration**

24. **README and table.** The extension README covers setup, the exact `library` sheet row, the site config keys read, worker secrets and deploy, and local development. The repo README extensions table gains one row (`type`: library plugin) which the #1 convention check (S3) enforces.
25. **No new tooling.** ESLint 8 + helix, Stylelint 16, `@web/test-runner`, Playwright, Node `node:test` for the worker, wrangler 4 (from #2), Node >= 22.12 for the worker jobs. No bundler, no framework: vanilla DOM like the hello extensions. [OPEN: Lit is available from `da.live` and upstream uses it for some tools; vanilla chosen for consistency with #1.]

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: what the author sees given an SDK result and a worker response; which SDK actions and DA writes happen; for the worker, which `Response` comes back for a given `Request` and which outbound Firefly requests were made. Never assert on internal helper names or CSS classes. Two negative properties are tested across every path: "no Firefly credential, minted token or handle secret appears anywhere in a response, header or log" and "no handler or outbound call runs before authentication succeeds". No test spends Firefly credits; all automated tests run against a fake Firefly.

**Proposed seams** (recorded here instead of asked, per #56). Every seam below already exists in the #1 and #2 specs; this ticket adds fixtures, not seams.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| S1 (primary, highest) | Entry HTML page + SDK module boundary, with a real worker behind it | reused (#1, extended by #2) | Playwright e2e | #1's `page.route` SDK stub supplies `context`, a test-signed IMS-shaped token, and a recording `actions` (`sendHTML`, `closeLibrary`, `daFetch`, `subscribeLiveDocument`); `daFetch` is backed by an in-memory fake DA store. The worker under test is the real Firefly worker run with wrangler in local env, pointed at a fake Firefly origin and fake IMS (#2 test kit) |
| S2 | Render/logic modules + SDK result | reused (#1) | WTR unit tests | injected `fetch` for the worker and for DA; hand-built SDK result; fake timers for polling |
| W1 | The worker's HTTP boundary (`worker.fetch(request, env, ctx)`) | reused (#2) | Node unit tests for the Firefly worker | #2 test kit (`makeEnv`, `fakeIms`, `signToken`, canary) plus a new **fake Firefly** scripted-upstream fixture local to this extension; injected `fetch`, `sleep`, `random`, `now` |
| W2 | The same worker in the real workers runtime | reused (#2) | Smoke tier | `wrangler dev` with `IMS_ORIGIN` and `FIREFLY_API_ORIGIN` pointing at throwaway local Node servers |
| S3 | Repo convention check | reused (#1, extended by #2) | CI lint job | filesystem fixtures: folder/README row/worker completeness |

The real boundaries (Adobe IMS login in EW, the Firefly service, DA's real source store, the EW editor accepting `sendHTML`) are covered only by the spike (S0, S-DA, S-AEM) and manual steps F0-F10, because they need credentials or an interactive login.

**Modules tested:** option-to-request mapping and validation; capability descriptor; token minting/caching/refresh; job-handle sealing; status normalisation and error mapping; content stream; reference upload; polling/state machine; alt-text rules; destination adapters (DA path/name/size guard, AEM stub); site-config parsing; render (variant grid, form, a11y roles, error states); bootstrap/standalone state; convention check additions.

**Prior art.**
- Worker tests: the #2 test kit and test-ID scheme (`UA/UC/UP/US`) and `HW1-HW6` hello-worker tests in `shared/worker-template/SPEC.md`; upstream has no worker code, so this is pattern reuse, not upstream reuse.
- Browser unit and e2e: #1's `S1/S2` and upstream's import-map SDK fixture (`test/unit/block-editor/fixtures/utils/sdk.js`: `export default Promise.resolve(window.blockEditorTestSdk)`) and `test/e2e/utils/da-api-stubs.js` (https://github.com/adobe-rnd/ew-extensions).
- Upstream `tools/block-editor` is the closest prior art for a library plugin that manipulates images in the canvas (README: https://github.com/adobe-rnd/ew-extensions/blob/main/tools/block-editor/README.md); it does not generate images, and no Firefly or image-generation extension exists upstream (searched the repo tree and PR titles 2026-11-16, none found) [VERIFIED by absence in those lists].

## Out of Scope

- Firefly features beyond text-to-image: generative fill, expand, object composite, upscale, custom models, video, audio, translation (all exist in the API [VERIFIED OpenAPI paths]).
- Image 5 (`/v4`) as a selectable runtime option; `FIREFLY_MODEL` stays config so it can be added later without breaking the contract.
- A percentage progress bar when Firefly does not provide one.
- Multi-select insert, inserting more than one variant, and drag-and-drop of variants into the canvas (the SDK `makeDraggable` exists; not used).
- Seed locking, prompt history, saved prompt libraries, favourites, and persistence of dialog state across sessions (story 23 is a nice-to-have; not required by #18).
- Content Credentials / provenance handling beyond *not re-encoding* the Firefly bytes (the plugin uploads the original bytes unchanged) [OPEN: whether Firefly outputs carry Content Credentials and whether DA preserves them].
- Editing alt text after insertion; replacing an existing image (SDK `sendHTML({replace:true})` exists but is block-scoped).
- Org-wide usage dashboards, budgets, per-user quotas beyond the optional rate-limit binding.
- Online token revocation checks and CI-driven deploys (#2 Out of Scope).
- A Firefly Services account/entitlement procurement process (owner action).
- The Adobe outside-activity/IP policy decision (#1 R1).
- Marketplace publishing.

## Further Notes

- **Docs nuance.** The EW docs list `actions.sendText`, `actions.sendHTML` and `actions.closeLibrary` for plugins (https://www.aem.live/docs/ew/developing/apps-plugins) and say nothing about backends or images. Everything about uploads comes from reading the host source, which may change; the extension must treat the insert as best-effort and re-verify behaviour in manual step F2.
- **`sendHTML` is fire-and-forget.** Without `replace`, `sendHTML` posts a message and returns `undefined`: no ack, no error [VERIFIED: `sdk.js`]. The host inserts at the *current ProseMirror selection* (`insertHTML` -> `replaceRange(from, to, slice)`) and silently does nothing without an editor view [VERIFIED: `iframe-protocol.js`, `helpers.js`]. The plugin therefore uses the `liveDocument` capability (advertised `liveDocument: 1`) to *advise* whether the image landed: it subscribes to live HTML after sending and, if the new `src` is seen within a few seconds, closes the dialog; otherwise it shows "Inserted but not confirmed" with the saved image URL and keeps the dialog open. Whether the live HTML keeps the same `src` (the host serialises with preview-origin rewrites via `getInstrumentedHTMLForSDK`) is [ASSUMPTION], settled in manual step F2; the check is advisory and must never block.
- **Image source of truth for pasted images in EW** is the DA hidden folder next to the document; EW publishes those through the media bus on preview, and the same path convention gives this plugin the same publish behaviour [VERIFIED convention; publish behaviour [ASSUMPTION], confirmed in F2].
- **Entitlement is the biggest external dependency.** Firefly Services API access requires an Enterprise-type entitlement; an organisation without it sees "Incompatible API - This API cannot be used in your organization" in the Developer Console [secondary source: Adobe Community answer by a community expert, 2026-08, https://community.adobe.com/questions-624/what-license-do-i-need-to-get-access-to-firefly-apis-1636207; the Adobe docs themselves say enterprise customers need the System Administrator or Developer role and the *Firefly - Firefly Services* product assigned, https://developer.adobe.com/firefly-services/docs/guides/get-started]. No free tier or trial for the Firefly *Services* API was found in the docs read [OPEN]. This ticket cannot be integration-verified without credentials from an entitled org (Open Question 1).
- **Current repo state:** `apps/firefly-generate/` contains only this file; `shared/worker-template/` and `apps/hello-world/` contain only their specs. Everything here that says "reuses" presumes #1 and #2 have landed.

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace editor (da.live)
  └─ library dialog (experience=fullsize-dialog) iframe: Firefly Generate & Insert
       origin: https://{ref}--{site}--{org}.aem.live | .preview.da.live | http://localhost:3000
       │  SDK handshake: { token (IMS), context{org,site,repo,ref,path,branch,view,hash}, capabilities, actions }
       │
       ├── fetch(worker, Authorization: Bearer <IMS token>)   ── CORS preflight first
       │        ▼
       │   Cloudflare Worker (apps/firefly-generate/worker; core imported from shared/worker-template)
       │     origin gate -> IMS verify (JWKS) -> router
       │        ├─ token mint ──► https://ims-na1.adobelogin.com/ims/token/v3   (client id + secret from secret store)
       │        ├─ generate ────► POST https://firefly-api.adobe.io/v3/images/generate-async
       │        ├─ status ──────► GET  https://firefly-api.adobe.io/v3/status/{jobId}
       │        ├─ cancel ──────► PUT  https://firefly-api.adobe.io/v3/cancel/{jobId}
       │        ├─ reference ───► POST https://firefly-api.adobe.io/v2/storage/image
       │        └─ content ─────► GET  <pre-signed Firefly output URL>  (host-suffix allowlisted)
       │
       ├── <img src=pre-signed output URL>   (previews; no CORS needed, not a credential)
       ├── actions.daFetch ──► DA source store  (save chosen bytes; or AEM Assets Author API, gated)
       └── actions.sendHTML / closeLibrary / subscribeLiveDocument  (insert, confirm, close)
```

Responsibility split:

| Concern | Browser extension (static, public) | Worker (private runtime, holds secrets) |
|---|---|---|
| Firefly client id, secret, minted token | never sees them | only place; secrets in the platform store, token in isolate memory |
| Identity | gets IMS token from SDK, sends it | verifies it (template), binds job handles to the user |
| Option validation | UI constraints (convenience) | authoritative allowlist validation; rebuilds the vendor request |
| Vendor calls and retries | shows states | all of them via the template `proxy` (retry rules per #2) |
| Progress | polls worker, shows status, elapsed, cancel | polls Firefly per request, normalises status |
| Saving the image | uploads bytes to DA/AEM with the *author's* rights via `daFetch` | provides the bytes (it never writes to DA or AEM) |
| Inserting the image | `actions.sendHTML`, confirm via live document, `closeLibrary` | none |
| Site defaults | reads site config, merges with built-in defaults | provides model capabilities and built-in defaults only |

Why the browser, not the worker, writes to DA: the write must happen with the author's own DA permissions; the worker would need the author's IMS token forwarded to DA, which the template forbids forwarding off-worker (#2 Decision 6 and Decision 8 header hygiene).

## 2. EW integration points

- **Library plugin, not an app.** Registered in the `library` tab, columns `title`, `path`, `format`, `ref`, `icon`, `experience` [VERIFIED columns: https://www.aem.live/docs/ew/administering/set-up-library; behaviour of `path`, `ref`, de-duplication per the #1 spec section 2.5]. Proposed row:

  | title | path | format | ref | icon | experience |
  |---|---|---|---|---|---|
  | Firefly Generate | /apps/firefly-generate/firefly-generate.html | | | (optional) | fullsize-dialog |

  Do not use a reserved title (`blocks`, `templates`, `icons`, `placeholders`, `aem-assets*`). During development use `ref=local` in the editor URL; for branch testing leave the row `ref` blank or equal to the branch.
- **`fullsize-dialog` mechanics** [VERIFIED: `helpers.js` `extensionToPanelView`]: the host builds an iframe with `allow="clipboard-write *"`, applies `toPreviewProxyUrl` to the source, calls `ensurePreviewProxySession`, and wires the same `setupIframeChannel`, with `onClose` mapped to `closeLibrary`. Posts the init message (`ready`, `project`, `context`, `token`, capabilities `{liveDocument, sendHTMLReplace, chatTurnCompleted, dragDrop}`) ~750 ms after iframe `load`, so a visible "connecting" state is normal (#1 spec 2.1).
- **SDK actions used:** `daFetch` (DA writes and site-config read), `sendHTML` (insert), `closeLibrary`, `subscribeLiveDocument` (advisory insert confirmation; needs capability `liveDocument === 1`) [VERIFIED: `sdk.js` and `iframe-protocol.js`]. `sendText` is not used. All `actions` calls tolerate absence (standalone state).
- **Context used:** `context.org`, `context.site`/`repo`, `context.path` (current document, e.g. `/folder/page`), `context.ref`/`branch`. `context.path` determines the DA upload folder. If `path` is empty or `/`, uploads go beside the site root with a `.index` folder [ASSUMPTION; spike S-DA].
- **Config-sheet rows:** the one `library` row above, plus optional site-config key/value rows `firefly.*` and the existing `aem.repositoryId` (first sheet of the site or org config at `https://da.live/config#/{org}/{site}/`; site overrides org [VERIFIED: `getConfigValue` in `daConfig.js`]).
- **`ref=local`:** page served from `http://localhost:3000` (#1), worker via `wrangler dev` on `http://localhost:8787` (#2), both started by the documented scripts. The deployed worker is used for branch refs and `main`.
- **Which `Origin` the page sends** to the worker (aem.live vs preview.da.live vs localhost) is #2's open integration unknown (#2 R2); this extension inherits the resolved value from #2's manual step W3 and re-verifies it in F2/F3 for the `fullsize-dialog` path, which goes through `ensurePreviewProxySession` [VERIFIED code path; effect on `Origin` [ASSUMPTION]].

## 3. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| Adobe IMS `POST {IMS_ORIGIN}/ims/token/v3` | mint a Firefly access token (client credentials) | `client_id` + `client_secret` in the form body | https://developer.adobe.com/firefly-services/docs/guides/get-started (curl sample); async guide `getAccessToken` |
| Firefly `POST /v3/images/generate-async` | start a generation; `202` returns `{jobId, statusUrl, cancelUrl}` | `x-api-key` + `Authorization: Bearer`; header `x-model-version` | OpenAPI document above; async guide |
| Firefly `GET /v3/status/{jobId}` | poll; `status` in `pending, running, succeeded, failed, cancelled, cancel_pending, timeout`; success carries `result.outputs[{seed, image{url}}]`, `size`, `contentClass`, optional `altText`, `promptHasBlockedArtists` | same | OpenAPI `JobResponse`, `JobSucceededPayload`, `JobPollPayload`, `GenerateImagesResponseV3` |
| Firefly `PUT /v3/cancel/{jobId}` | cancel | same | OpenAPI (`/v3/cancel/{jobId}` has only `put`) |
| Firefly `POST /v2/storage/image` | upload a style reference; returns `{images:[{id}]}`, id valid 7 days | same; body is the raw image, `Content-Type` one of jpeg/jxl/png/tiff/webp | OpenAPI `/v2/storage/image` |
| Firefly output URL (pre-signed) | preview (`<img>`) and bytes (worker) | none (pre-signed, expires in 1 h) | OpenAPI `PublicBinaryOutputV3` |
| DA Source API (`https://admin.da.live/source/{org}/{repo}/{path}`) | store the chosen image; POST multipart `data`; returns `{source:{contentUrl,...}}` | IMS bearer via `actions.daFetch` | https://docs.da.live/developers/api/source |
| DA Config API (`GET .../config/{org}/{site}`) | read `firefly.*` and `aem.repositoryId` | IMS bearer via `actions.daFetch` | URL shape from `nx2/utils/api.js` and `daConfig.js` [exact URL for the extension [OPEN]] |
| AEM Assets Author API / direct binary upload (gated) | store in the DAM folder | AEM author-tier IMS token | https://developer.adobe.com/experience-cloud/experience-manager-apis/api/stable/assets/author ; https://experienceleague.adobe.com/en/docs/experience-manager-learn/assets/developer/programmatic-asset-upload |
| Helix admin `GET /ping/{org}/{site}` | detect hlx6 (header `x-api-upgrade-available`) | IMS bearer via `daFetch` | https://github.com/adobe/da-nx/blob/main/nx2/utils/api.md [use from the extension [OPEN]] |

**Auth flows.**
1. Author to worker: the SDK hands the page the user's IMS token; page sends `Authorization: Bearer`; the template verifies it (RS256 against `{IMS_ORIGIN}/ims/keys`, `type=access_token`, expiry, optional client-id allowlist) before any route code (#2 Decision 6).
2. Worker to Firefly: client credentials -> `ims/token/v3` -> cached 24 h token -> Firefly calls with `x-api-key` + Bearer. The author's token is never forwarded (#2 Decision 8).
3. Author to DA/AEM: `actions.daFetch` attaches the author's token (DA: `Authorization: Bearer`; helix/AEM origins also get `x-content-source-authorization`) [VERIFIED: `daFetch.js`].

**Facts I could not verify** [OPEN]: whether status polls count against the 4 RPM organisation limit; the output image host list and whether it sends CORS headers; the real output format/size at 2048-2688 px; whether Image 4 Standard accepts `contentClass`, `style.presets` and `style.imageReference` as Image 3 does; whether `altText` is returned on the v3 endpoint (the field exists on `GenerateImagesResponseV3`, but the request schema that enables it, `prompt_reasoner`, is only on the v4 request); the minimum scope string; whether a style-reference upload consumes credits; the IMS `client_id` claim of EW tokens (#2 W2).

## 4. Data contracts

All contracts are behavioural.

**UI option set and Firefly mapping (model `image4_standard`, v3 endpoint)**

| UI option | Allowed values | Firefly request field | Notes |
|---|---|---|---|
| Prompt | 1-1024 chars | `prompt` | v3 limit 1024 [VERIFIED `GenerateImagesRequestV3`]; trimmed; text only |
| Variants | 1-4 (default 4) | `numVariations` | max 4 [VERIFIED] |
| Aspect ratio | `1:1`, `4:3`, `3:4`, `16:9`, `9:16` | `size {width,height}` = 2048x2048, 2304x1792, 1792x2304, 2688x1536, 1440x2560 | exact pairs Image 4 supports [VERIFIED `size` description]; Image 3 pairs differ for 9:16 [VERIFIED], so the mapping is per model |
| Content class | `photo`, `art` | `contentClass` | [VERIFIED `ContentClassV3`] |
| Style presets | subset of Firefly preset ids (snake_case) | `style.presets[]` | curated list shown in UI, worker validates against the full documented id set [VERIFIED ids list in the style presets guide, e.g. `bw`, `fantasy`, `dramatic_light`, `golden_hour`, `watercolor`] |
| Style strength | 1-100 | `style.strength` | `exclusiveMinimum 0`, max 100 [VERIFIED `StylesV3`] |
| Style reference | one image: jpeg/png/webp, size cap (e.g. 8 MB [ASSUMPTION]) | `style.imageReference.source.uploadId` | via `/firefly/references` [VERIFIED field `StylesImageReferenceV3.source.uploadId`] |
| Negative prompt | <= 1024 chars | `negativePrompt` | [VERIFIED `maxLength 1024`]; not supported for custom models |
| (none) | | `x-model-version` = `FIREFLY_MODEL` | worker config |
| (none) | | `seeds` | omitted by default; response seed is shown/recorded in the file name |

**Worker API (browser-facing; all JSON unless stated; all require `Authorization`).**

- `GET /firefly/capabilities` -> `200 { model, maxPromptLength, aspectRatios[], contentClasses[], variants{min,max}, stylePresets[], styleReference{supported,types[],maxBytes}, negativePrompt{supported,maxLength}, defaults{aspectRatio,contentClass,variants,stylePresets,negativePrompt} }`.
- `POST /firefly/generations` body `{ prompt, variants, aspectRatio, contentClass?, style?{presets[],strength?,referenceId?}, negativePrompt? }` -> `202 { jobHandle, pollAfterMs }`; `400 bad_request` on any validation failure; `429 rate_limited` with `Retry-After` passthrough; `502 upstream_unavailable`; `500 misconfigured` if a secret is missing.
- `GET /firefly/generations/{jobHandle}` -> `200 { status: "pending"|"running"|"succeeded"|"failed"|"cancelled"|"timeout", elapsedMs, result?{ size{width,height}, contentClass, promptHasBlockedArtists?, outputs[{index, seed, previewUrl, altText?}] }, reason? }` where `reason` in `content_policy | generation_failed | generation_timeout | cancelled`; unknown/tampered/other-user/expired handle -> `404 not_found`.
- `DELETE /firefly/generations/{jobHandle}` -> `200 { status: "cancelled" | "cancel_pending" | "completed" }` (idempotent; a finished job is reported, not an error).
- `GET /firefly/generations/{jobHandle}/outputs/{index}/content` -> `200` image bytes with the upstream `Content-Type` (must be `image/*`), `Cache-Control: private, no-store`, size-capped; `index` out of range -> `404`; non-image or wrong host -> `502 upstream_unavailable`.
- `POST /firefly/references` (raw image body, `Content-Type` jpeg/png/webp) -> `201 { referenceId }`; `413`/`400` per template and content-type allowlist.
- Template error JSON shape and `x-request-id` on every response (#2 Decision 9); CORS headers on every response to an allowed origin.

**Worker configuration (#2 contract).** Secrets (`secrets.required`): `FIREFLY_CLIENT_ID`, `FIREFLY_CLIENT_SECRET`, `FIREFLY_HANDLE_SECRET`. (`FIREFLY_CLIENT_ID` is not confidential in itself, but is held with the secrets for uniform injection and because the template's `vars` check rejects key-like names.) Vars: `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS`, `FIREFLY_API_ORIGIN` (`https://firefly-api.adobe.io`), `FIREFLY_MODEL` (`image4_standard`), `FIREFLY_OUTPUT_HOST_SUFFIXES` (default `.amazonaws.com`), optional `ALLOWED_USER_IDS`.

**Job handle.** Opaque, URL-safe, authenticated; carries Firefly job id, IMS user id, expiry (a few hours). Verification failure is indistinguishable from "not found".

**Site config keys (key/value rows, first sheet).** `firefly.aspectRatio`, `firefly.contentClass`, `firefly.stylePresets`, `firefly.negativePrompt`, `firefly.destination` (`da`|`aem-assets`), `firefly.aem.folder`, plus existing `aem.repositoryId`. Invalid or unknown values are ignored for defaults and reported once in the dialog for `firefly.destination`.

**DA media write.** Path `{dir of context.path}/.{docname}/firefly-{seed}.{ext}`, multipart `data`, `ext` from the content type (`jpg` for JPEG). `source.contentUrl` from the response is the `<img src>`; on failure nothing is inserted and the error is shown with Retry (the image bytes stay in memory so Retry does not re-download).

**Inserted HTML.** A single paragraph containing one `<img src=... alt=...>` (alt may be empty only when "Decorative" is ticked). Whether the host wants `<p><img></p>` or a bare `<img>` is [ASSUMPTION], decided in F2.

## 5. Folder layout (proposed; fits #1 and #2)

```
apps/firefly-generate/
├─ SPEC.md                         this file
├─ README.md                       setup, library row, site config keys, worker secrets/deploy, local dev
├─ firefly-generate.html           entry page: SDK <script type=module> + extension script
├─ firefly-generate.js             bootstrap (awaits SDK, wires actions, instantiates modules)
├─ firefly-generate.css
├─ lib/                            side-effect-free modules (names are the implementer's call):
│   ├─ options.js                  option model, defaults merge, validation (mirrors worker allowlists)
│   ├─ job.js                      polling state machine
│   ├─ alt-text.js                 alt prefill/validation
│   ├─ destination/                da.js (DA media adapter), aem-assets.js (gated adapter)
│   └─ render.js                   form, variant grid, error states (text-only rendering)
├─ test/unit/*.test.js             WTR (S2)
├─ test/e2e/*.spec.js              Playwright (S1)
├─ test/fixtures/firefly/*.json    sanitised recorded real responses (from spike S0)
├─ worker/                         per-extension worker from shared/worker-template/scaffold
│   ├─ wrangler.* , .dev.vars.example, README.md
│   ├─ src/                        routes, firefly client (token mint/cache), handle sealing, validation
│   └─ test/                       node:test (W1) + smoke (W2) + fake-firefly fixture server
└─ providers/<vendor>/             reserved for future alternative image generators (not created now)
```

`.hlxignore` (from #1/#2) must hide `**/test/`, `**/worker/`, `SPEC.md` and `test/fixtures/` from the code bus; the plugin page itself and `lib/` must stay served.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **No Firefly Services entitlement/credentials** for the personal org; API access is an Enterprise entitlement (see Further Notes). Nothing can be verified against the real service without it. | High, blocks F-steps and spike S0 | Owner action (Open Question 1). All automated work proceeds against the fake Firefly; the spike and manual steps wait for credentials. |
| R2 | **Adobe outside-activity/IP policy** and whose Firefly entitlement/credits are used by a personal repo; Cloudflare account hosting the worker (#1 R1, #2 R1). | High for publishing | README note; owner decision. |
| R3 | **4 requests/minute per organisation** (and 9,000/day) by default [VERIFIED]. Several authors, polling, or Regenerate bursts will hit `429`. Unknown whether status/cancel/storage calls count. | High | One request returns up to 4 variants (v3) instead of 4 requests; conservative poll interval with backoff; countdown UI; optional per-user throttle (Open Question 7); spike S0 measures what counts; owner may ask Adobe for higher limits (usage-notes page says contact the account manager). |
| R4 | **Credits are spent per generation**; any authenticated Adobe user passing the client-id allowlist can spend them (#2 R3). | High | Allowlist, optional user allowlist, prompt/body caps, no POST 5xx retries, notice in UI, optional rate-limit binding; owner policy decision. |
| R5 | **Model-option compatibility** (Image 4 Standard with `contentClass`, presets, reference image) undocumented. | Medium | Spike S0; capability descriptor lets the form degrade honestly; fallback `image3`. |
| R6 | **Image 5 gap.** The better model has no content class, no presets, one variation per call. The ticket's "lean into Firefly options" favours v3 today, but v3 models may be superseded. | Medium | Config-driven model; Image 5 documented as follow-up; watch changelog (https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/changelog/ returned 404 on 2026-11-16; the earlier Oct 2025 note says old non-async endpoints were removed, https://developer.adobe.com/firefly-services/docs/firefly-api/guides/changelog/). |
| R7 | **Progress is not a percentage** in the documented status payload. | Medium (AC wording "show progress") | Status + elapsed + activity + cancel; spike S0 checks real payloads for a progress field. Owner confirms this satisfies AC3 (Open Question 8). |
| R8 | **Template gaps G1-G5** (body-secret token exchange, dynamic redaction, suffix host allowlist, binary streaming, DELETE CORS). | Medium | Raise with the #2 owner; until resolved the worker uses the narrowest local workaround behind the same tests; blocks build plan steps 3-6 only in their final form. |
| R9 | **Image bytes through the worker** (up to 4 x a few MB per generate if previews were proxied, 1 x per save as designed). Free plan CPU 10 ms; streaming pass-through should not use CPU but is unmeasured [ASSUMPTION; smoke SM5-style measurement]. | Low-Med | Previews go direct; only the chosen image streams; measure in smoke tier. |
| R10 | **Pre-signed URL exposure.** Preview URLs are bearer links valid 1 h. | Low | Acceptable (they are images the author generated, not credentials); never logged by the worker; documented. |
| R11 | **DA write path variance** (legacy vs hlx6; `daFetch` reaching helix admin and `api.aem.live`; size cap 4.5 MB on hlx6). | Medium | Spike S-DA; legacy-DA-only fallback with a clear message. |
| R12 | **AEM Assets destination feasibility** (write rights, publish/approval gating, entitlement). | Medium-High | Spike S-AEM gates the work; honest fallback; owner decision on the AC wording. |
| R13 | **`sendHTML` is fire-and-forget**; silent failure when no editor view or a different cursor; `fullsize-dialog` may not preserve the editor selection. | Medium | Advisory live-document confirmation; manual F2 verifies cursor placement from a dialog; if the selection is lost, document "click in the document first". |
| R14 | **Overlap with EW's own AI assistant** (ticket overlap risk 4). | Strategic | Differentiate on option control and site defaults; keep the extension small; owner may re-rank. |
| R15 | **Prompt content and PII** sent to Adobe's generative service; also logged? | Medium | Worker logs never contain prompts (template log contract); README states that prompts leave the site to Firefly; owner/legal check [OPEN]. |
| R16 | **Firefly API drift** (new models, endpoint removals). | Low-Med | Fixtures from real responses, scheduled non-blocking OpenAPI drift check (CI addition), config-driven model. |
| R17 | **Cross-user job access** if handles were guessable. | Medium | Sealed, user-bound, expiring handles (Decision 16); tested (FW5). |
| R18 | **Worker origin / local-network access** when a deployed page calls a worker (inherits #2 R11). | Low | Constant worker origin; loopback only with `ref=local`. |

## 7. Ordered build plan (sized to #18's acceptance criteria)

0. **Owner prerequisites:** #1 and #2 landed; Firefly Services credentials (OAuth Server-to-Server) from an entitled org; Cloudflare account; DA org/site and a test document; decide Open Questions 1-4 (credentials, model, placement of Firefly code, AEM fallback). **Settle template gaps G1-G5** with the #2 owner (R8).
1. **Spike S0 (needs credentials; throwaway script, not committed code beyond sanitised fixtures).** Mint a token; call generate/status/cancel/storage; record: working scope string, Image 4 Standard option compatibility, real response payloads (success, 429, 451, failure), polling cadence vs rate limit, output host and CORS, format/size, `altText`/`progress` presence. Commit only sanitised fixtures and update this spec's [OPEN] items. (AC3, AC1)
2. **Spike S-DA:** from an extension page in EW, verify `daFetch` upload to the DA source store (legacy), hlx6 detection and `/media`, the exact site-config read URL and permissions for an ordinary author, and the resulting `contentUrl` rendering after preview. (AC2)
3. **Fake Firefly + worker test fixtures**, then **option validation and request mapping** test-first (FW1-FW3, FW12). (AC1, AC7)
4. **Token mint/cache/refresh** (FW4) and **job-handle sealing** (FW5), **status normalisation and error mapping** (FW6-FW8). (AC3, AC7)
5. **Content stream and reference upload** (FW9-FW10), **canary/log hygiene across every route** (FW11), **who may call** (FW14, FW15). (AC3, AC7)
6. **Worker scaffold, README, wrangler config** (secrets list, vars); runtime smoke (SM-F1..SM-F4). (AC4, AC7)
7. **Browser logic modules test-first:** options/defaults merge and site-config parsing, polling state machine, alt-text rules (BU1-BU9). (AC1, AC2)
8. **Render + bootstrap + entry page + CSS**, test-first (BU10-BU20): form, progress, variant grid, error states, standalone state. (AC1, AC3)
9. **DA destination adapter and insert flow** (BU21-BU27, E2E3). (AC2)
10. **Hermetic e2e** against the real worker + fake Firefly/IMS/DA (E2E1-E2E8). (AC1, AC2, AC3, AC7)
11. **AEM Assets adapter behind spike S-AEM**; ships only if S-AEM passes, otherwise the honest-fallback behaviour and the owner's decision are recorded (BU28-BU30). (AC2)
12. **Repo integration:** README table row, convention check additions (S3), CI jobs, `.hlxignore` entries. (AC4, AC5, AC8)
13. **Deploy and manual verification F0-F10** with real credentials; record observed `Origin` values and insert behaviour; update README caveats. (AC6, AC7)
14. **Hand-off:** note remaining owner decisions and any template changes made for G1-G5.

---

# Testing Requirements

## 1. Worker tests (seam W1; Node built-in runner; fake Firefly + #2 test kit)

Fixtures/mocks: `makeEnv()` with canary values for `FIREFLY_CLIENT_ID`, `FIREFLY_CLIENT_SECRET`, `FIREFLY_HANDLE_SECRET` (and the minted-token canary) from the #2 test kit; `fakeIms` (RSA key, JWKS, `signToken`); a **fake Firefly** scripted-upstream fixture that implements the five endpoints plus the IMS token endpoint, records every request (method, URL, headers, body), and replays scripted status sequences (`pending -> running -> succeeded`, `429` with `retry-after`, `451` with `prompt_unsafe`, `500`, `failed`, `timeout`); a fake output-image host serving tiny JPEG/PNG bytes; injected `fetch`, `sleep`, `random`, `now`. Sanitised **recorded real responses** (from spike S0) are used to seed the fake so it cannot drift from reality; until S0 runs the fake follows the OpenAPI examples and is flagged as unverified. Every test calls `worker.fetch(...)`.

| ID | Behaviour asserted |
|---|---|
| FW1 | Every route (all six, all methods, plus an unknown path) without `Authorization`, with a bad token, with a token from another key -> `401` (or `404` only after a valid token for an unknown path, per #2 UA12); fake Firefly and fake IMS-token endpoint received **zero** requests |
| FW2 | `POST /firefly/generations` with a full valid body -> `202 {jobHandle, pollAfterMs}`; the outbound request to `/v3/images/generate-async` has: header `x-model-version` = configured model, `x-api-key` = client id, `Authorization: Bearer <minted>`; body fields mapped exactly per the contract table (e.g. `16:9` -> `size {2688,1536}`, `numVariations`, `contentClass`, `style.presets`, `style.strength`, `style.imageReference.source.uploadId`, `negativePrompt`); no extra fields |
| FW3 | Validation matrix -> `400 bad_request` and **no** upstream call: empty/whitespace/over-1024 prompt, variants 0/5/non-integer, aspect ratio outside the five, content class outside `photo\|art`, unknown preset id, strength 0/101, malformed `referenceId`, unknown extra field, non-JSON body, oversized body (`413`); a prompt containing HTML/script is accepted as plain text and forwarded unchanged (no sanitising that alters meaning) |
| FW4 | Token mint: form body contains `grant_type=client_credentials`, client id, client secret, the scope string; N sequential requests -> exactly one mint; concurrent first requests -> one mint (de-dup); token refreshed after expiry (injected `now`) with margin; a Firefly `401` -> one forced re-mint and one replay of an idempotent call, none for the generate POST (returns `502`); mint failure/`5xx` -> `502 upstream_unavailable` (not `401`), generic message |
| FW5 | Handle security: tampered, truncated, wrong-secret, expired, and **another user's** handle on status/cancel/content -> `404 not_found`, no Firefly call; a handle from user A works only for user A; the Firefly job id never appears in any browser-facing response |
| FW6 | Status mapping: scripted `pending`/`running` -> same status plus `elapsedMs` from injected `now`; `succeeded` -> `outputs[{index, seed, previewUrl, altText?}]`, `size`, `contentClass`; `failed`/`timeout`/`cancelled`/`cancel_pending` -> mapped status and `reason`; response never contains upstream error text or `stack_trace`; unknown upstream status -> treated as running with a log line, not a crash |
| FW7 | Errors: generate -> Firefly `451` with each code in `{prompt_unsafe, prompt_entity_denied, image_unsafe, reference_image_unsafe_error, input_media_unsafe, legal_error}` -> a `content_policy` reason with a fixed message; `429` -> `429 rate_limited` with `Retry-After` passed through (seconds), retried only within template bounds; generate `5xx` -> not retried (one upstream call) -> `502`; status `5xx` -> retried per template then `502`; `promptHasBlockedArtists: true` surfaced as a boolean flag only |
| FW8 | `DELETE` -> `PUT /v3/cancel/{jobId}` called with the unsealed id; already-finished job -> `200 {status:"completed"}`, not an error; second cancel idempotent |
| FW9 | Content route: valid handle + index -> streams the fake output bytes with `image/*` content type, `Cache-Control: private, no-store`; index out of range -> `404`; output URL on a non-allowlisted host, `http`, with credentials, or redirecting (`302`) -> `502`, **no** second request made; non-image content type -> `502`; body over the size cap -> `502`/`413` and truncated stream never delivered as success; the output URL (pre-signed query) never appears in logs |
| FW10 | Reference upload: allowed types accepted and forwarded to `/v2/storage/image` with the same content type, returns `{referenceId}` equal to the fake's id; disallowed type (gif, svg, pdf) -> `400`; over cap -> `413`; body without a valid image magic number -> `400` [ASSUMPTION: magic-number check]; Firefly `451` (`input_media_unsafe`) -> `reference_rejected` |
| FW11 | **Canary property test**: across success, each error, upstream echoing the secret/token in an error body, a missing-secret path, and a thrown error containing the minted token, none of the canaries (client id, client secret, handle secret, minted access token) appears in any response body, header, or captured log line on any of the six routes |
| FW12 | `GET /firefly/capabilities` -> shape per contract; values equal the configured model's option set; contains no secret or vendor URL; changing `FIREFLY_MODEL` to an unsupported value -> `500 misconfigured` generic |
| FW13 | CORS on this worker: `Access-Control-Allow-Methods` includes `GET, POST, DELETE`; allowed origins per #2 UC1-UC3 (the template tests stay the authority; this asserts the route set's methods and that `4xx/5xx` responses from every route carry ACAO) |
| FW14 | `ALLOWED_IMS_CLIENT_IDS` enforced (wrong client id -> `401`); `ALLOWED_USER_IDS` set and caller not listed -> `403 forbidden` on every route; unset -> all authenticated users allowed |
| FW15 | If the per-user rate-limit binding is adopted (Open Question 7): over-limit calls -> `429 rate_limited` with `Retry-After`, no Firefly call; otherwise this test is omitted and the gap is recorded in the README |
| FW16 | Secrets hygiene: a `wrangler` config lists exactly the three secrets in `secrets.required`; `.dev.vars.example` lists them; no secret-like key in `vars` (extends #2 UR2/UR3/UR5) |

## 2. Browser unit tests (seam S2; WTR + Mocha/chai; injected `fetch`, fake timers, SDK stub from `test/support`)

| ID | Behaviour asserted |
|---|---|
| BU1 | Defaults merge: no site config -> built-in defaults; site config rows override aspect ratio, content class, presets, negative prompt; invalid values ignored; `firefly.destination` invalid -> reported |
| BU2 | Site-config read failure (`403`/`404`/network error) -> built-in defaults, no thrown error, no user-facing error |
| BU3 | Capabilities drive the form: only listed aspect ratios/classes/presets render; style-reference control absent when `styleReference.supported=false` |
| BU4 | Generate sends exactly the selected options to the worker with `Authorization: Bearer <sdk token>` to the configured worker origin; prompt trimmed; button disabled when prompt is empty or a job is active |
| BU5 | `?worker=https://evil.example` in the page URL is ignored; origin is the loopback worker on `localhost` and the fixed deployed origin elsewhere |
| BU6 | Polling: status `pending -> running -> succeeded` drives the state machine and stops polling on a terminal state; poll interval honours `pollAfterMs` and backs off; a poll `429` with `Retry-After: 7` pauses polling for 7 s and keeps the job; an unbounded wait is capped by a UI timeout with a plain message |
| BU7 | Progress UI: status text and elapsed time update with fake timers; an `aria-live` region announces state changes; a percentage is shown only if the status payload carries one |
| BU8 | Cancel: pressing Cancel calls `DELETE`, returns to a usable idle state, and ignores a late `succeeded` for the cancelled job; closing the dialog (SDK/unload hook) cancels best-effort |
| BU9 | Regenerate re-sends the same options with no seed, is disabled while a job is active, and replaces (does not append to) the grid on success |
| BU10 | Variants grid: N variants render as a radio group with accessible names; exactly one selectable; selection updates the alt prefill and enables Insert; keyboard (arrows, space) works |
| BU11 | Alt text: prefilled from `altText` when present, else from the prompt (trimmed at a word boundary to the configured length); editable; empty alt blocks Insert unless "Decorative" is ticked, which yields `alt=""` |
| BU12 | Text-only rendering: prompt, alt text, reason messages, and any server string containing `<img src=x onerror=...>` or `<script>` render as literal text and create no elements |
| BU13 | Error states: `content_policy` -> friendly policy message (no echo as markup); `rate_limited` -> countdown from `Retry-After` then re-enables Generate; `upstream_unavailable`/network -> Retry; `unauthorized` -> "sign in again/ reopen" message; worker unreachable (not deployed) -> setup hint; none shows a stack trace or secret |
| BU14 | Preview URLs: only `https` (or loopback `http` on `localhost`) preview URLs are assigned to `<img>`; any other scheme is dropped |
| BU15 | Style reference: file type/size are validated client-side; upload calls `/firefly/references`; `referenceId` is sent in the next generation; removing the file clears it; strength slider range 1-100 |
| BU16 | Standalone state: SDK never resolves -> waiting then "not running inside Experience Workspace"; Generate disabled; no network calls |
| BU17 | The token never appears in the DOM, console output, or error text (extends hello-world's rule) |
| BU18 | Credit-use notice is visible before the first generation |
| BU19 | Narrow viewport (library panel width) renders the form and grid without horizontal scroll (layout assertion at a fixed width) |
| BU20 | Content-class default is explicit: the form always has a content class selected (never "unset"), taken from site config or the built-in `photo`; the generation request always carries it |
| BU21 | DA adapter path/name: for `context.path=/a/b/page` the upload URL is the DA source path `/{org}/{site}/a/b/.page/firefly-{seed}.jpg` with multipart `data`; extension taken from the content type; root-level path handled |
| BU22 | Insert flow order: worker content fetch -> size guard -> DA upload -> `sendHTML` -> advisory confirmation -> `closeLibrary`; `sendHTML` payload contains exactly one `<img>` with the returned `contentUrl` and the edited alt |
| BU23 | Failure handling: worker content `5xx`, DA `4xx/5xx`, DA `401` (daFetch's sign-in redirect behaviour is stubbed) -> nothing inserted, error shown, Retry reuses bytes, no duplicate upload on double-click (button disabled while saving) |
| BU24 | Size guard: image over the limit (4.5 MB hlx6 / 20 MB legacy) is refused before upload with a clear message; at the limit is accepted |
| BU25 | Advisory confirmation: with `liveDocument` capability, an incoming live HTML containing the new `src` -> dialog closes; none within the timeout -> "inserted but not confirmed" state, dialog stays open, URL shown; capability absent -> trust and close |
| BU26 | `sendHTML` or `subscribeLiveDocument` throwing (`TypeError`) does not leave the dialog in a stuck "saving" state |
| BU27 | hlx6 vs legacy: detection result selects the upload endpoint and response parsing; detection failure -> legacy path assumed with a console-free fallback |
| BU28 | AEM destination selection: `firefly.destination=aem-assets` without `aem.repositoryId` -> message and DA fallback; with both and S-AEM supported -> AEM adapter used |
| BU29 | AEM adapter contract (against a stubbed Assets Author API): initiate upload -> binary PUT -> complete -> returns a deliverable URL or the "uploaded, pending publish" result; failure -> clear message |
| BU30 | AEM unsupported -> explicit "AEM Assets destination is not available; saved to DA media instead", never silent |
| BU31 | SDK-stub contract test: the shared stub has the same top-level shape as the real SDK result for the actions this plugin uses (`daFetch`, `sendHTML`, `closeLibrary`, `subscribeLiveDocument`, `capabilities`) |

## 3. Hermetic end-to-end (seam S1; Playwright, Chromium only; no credentials)

Setup: Playwright starts the #1 static server on `:3000`, the real Firefly worker via wrangler on `:8787` (local env; `IMS_ORIGIN`, `FIREFLY_API_ORIGIN` and output host pointing at throwaway Node servers started in global setup; secrets from a temp env file), and the SDK stub (token signed by the test IMS key; `actions.daFetch` backed by an in-memory fake DA; recording `sendHTML`/`closeLibrary`). Any other external request is aborted.

| ID | Behaviour asserted |
|---|---|
| E2E1 | Prompt + options -> Generate -> progress state visible -> four variants appear; the fake Firefly saw the mapped request |
| E2E2 | Regenerate produces a second, different set; previous selection is cleared; fake Firefly saw two generate calls with no seeds |
| E2E3 | Select a variant, edit alt text, Insert -> fake DA store received the image bytes at the expected hidden-folder path; recorded `sendHTML` payload has the returned `contentUrl` and the edited alt; `closeLibrary` called after confirmation |
| E2E4 | Cancel during generation -> fake Firefly received a cancel; UI returns to idle |
| E2E5 | Fake Firefly returns `429 retry-after` -> countdown shown, no further generate call until it elapses |
| E2E6 | Fake Firefly returns `451 prompt_unsafe` -> content-policy message, no variants |
| E2E7 | Real cross-origin path: a request with a token signed by a *different* key -> UI shows the sign-in/unauthorized message; the worker log shows `401` and the fake Firefly received nothing; a no-token request (issued by the test directly) -> `401` readable thanks to CORS headers |
| E2E8 | Secrets: page HTML, DOM text, storage, and all network responses contain none of the client id, client secret, handle secret or minted token (searched by value); only expected hosts were contacted (page, worker, SDK stub, fake output host) |

## 4. Contract and drift checks

- **Fixtures from reality (spike S0):** sanitised recorded responses (generate `202`, status running/succeeded/failed/timeout, `429`, `451`, storage upload, token response shape without the token) checked into the extension's fixtures; FW6/FW7 run against them.
- **OpenAPI drift check (non-blocking, scheduled in CI):** fetch https://raw.githubusercontent.com/AdobeDocs/ffs-firefly-api/main/static/firefly-api.json and assert that the fields and enums this worker depends on still exist (`generate-async` params and enums, `ContentClassV3`, `StylesV3`, `JobResponse` status values, `/v3/cancel/{jobId}` method, `/v2/storage/image` content types, `ContentPolicyErrorCode451`). Fails visibly but does not block merges (like #1's optional SDK canary). [OPEN: include?]
- **SDK canary (optional, from #1 R4):** assert the live `https://da.live/nx/utils/sdk.js` still exposes `sendHTML`, `closeLibrary`, `daFetch`, `subscribeLiveDocument`.

## 5. End-to-end checks inside real Experience Workspace (manual; need interactive Adobe login, entitled Firefly credentials, Cloudflare login)

Accounts/credentials needed: GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, #1); Adobe IMS identity with access to the DA org/site and config edit permission; Chrome; **Firefly Services OAuth Server-to-Server credential (client id + secret) from an entitled Adobe org** (see R1); Cloudflare account with Wrangler login; a throwaway test document. Never paste a real IMS token or Firefly secret into chat, issues, or logs. Generations spend real credits; keep test prompts few.

- **F0 (prereq, deploy):** `wrangler secret put` for `FIREFLY_CLIENT_ID`, `FIREFLY_CLIENT_SECRET`, `FIREFLY_HANDLE_SECRET`; `wrangler deploy` from `apps/firefly-generate/worker/`; set the deployed worker origin constant (a normal PR). `curl -i <worker>/firefly/capabilities` -> `401` (liveness + unauthenticated rejection). With a real token (obtained as in #2 W2): `200` and no secret visible. Proves AC7.
- **F1 (spike S0 results):** run the S0 script with real credentials; record and commit sanitised fixtures; update every [OPEN] it resolves in this spec.
- **F2 (`ref=local`, editor):** `npm start` (port 3000) and the worker local script (port 8787). Add the `library` row (`path=/apps/firefly-generate/firefly-generate.html`, `experience=fullsize-dialog`); open a document with `?ref=local`; open the library, pick **Firefly Generate**. Expect the dialog (after ~1 s connecting). Enter a prompt; confirm progress shows; four variants appear; Regenerate returns a new set; choose one, edit alt; Insert. Expect: the image at the cursor, `<img>` has the edited alt, the file exists in DA at `.{docname}/firefly-{seed}.jpg`, and after Preview the image renders on the `aem.page` URL. Also check: cursor position preserved from a dialog; whether `<p><img>` vs `<img>` matters; whether the live-document confirmation fires; whether the Firefly output host allows CORS (Network panel); `Origin` actually sent to the worker. Proves AC1, AC2, AC3, AC6.
- **F3 (branch ref):** push branch `firefly-generate` (simple name), wait for code sync, repeat F2 with `?ref=firefly-generate` against the **deployed** worker; the `library` row `ref` blank or equal to the branch. Record the page's real `Origin` (aem.live vs preview.da.live) and confirm CORS passes. Proves AC6, AC7.
- **F4 (progress and cancel):** start a generation and cancel mid-way; confirm the UI is idle and no variants appear; start another and close the dialog mid-way; confirm no error toast and (via worker logs) a cancel call.
- **F5 (credential hygiene):** in DevTools Network/Application search all responses, page source and storage for the client id and secret values (none); `wrangler secret list` shows names only; unauthenticated `curl` of every route -> `401`; `curl -H "Origin: https://evil.example"` -> `403` with a valid token and no ACAO. Proves AC7.
- **F6 (content policy):** submit a prompt expected to be rejected by Firefly policy; expect the friendly message, no variants, no stack trace.
- **F7 (rate limit):** issue several quick generations (more than the org limit allows); expect the countdown UI; confirm polling does not worsen it (note whether status polls count toward the limit; update R3).
- **F8 (site config):** add `firefly.*` rows to the site config; confirm defaults change for an ordinary author; confirm behaviour for an author without config read permission.
- **F9 (hlx6 vs legacy):** repeat the insert on a legacy DA site and, if available, an upgraded site; record behaviour and size-limit messages.
- **F10 (AEM Assets, only if S-AEM passes):** configure `aem.repositoryId` and `firefly.destination=aem-assets`; generate and insert; record whether the asset is uploaded, whether the inserted URL is deliverable, and the published/approved state needed.
- **F11 (failure modes):** worker stopped (not deployed) -> setup hint; revoke/rotate the Firefly secret with `wrangler secret put` -> next generation works without a code change (rotation).

Record screenshots/notes in the PR (the PR template asks for the test URLs).

## 6. CI additions (no credentials, no Cloudflare login, no Firefly)

| Job | Steps | Notes |
|---|---|---|
| `lint` (existing) | ESLint + Stylelint cover the extension and its worker (worker globals override from #2); S3 convention check covers the new folder, README row and worker completeness | AC4, AC5, AC8 |
| `unit` (existing) | WTR runs BU1-BU31 | AC8 |
| `worker-unit` (from #2) | `npm run test:worker` includes FW1-FW16 | runs on every push and PR |
| `worker-smoke` (from #2) | wrangler smoke: **SM-F1** worker starts and a bare request gets `401`; **SM-F2** token mint + generate + poll + content against the fake Firefly over real HTTP (real timers, tiny delays); **SM-F3** canary absent from all responses; **SM-F4** CORS preflight allowed/denied over real HTTP | advisory or required per #2 Open Question 11 |
| `e2e` (existing) | Playwright runs E2E1-E2E8 with worker + fakes as `webServer` | Chromium only |
| `contract-drift` (new, scheduled, non-blocking) | OpenAPI drift check (and optional SDK canary) | [OPEN: include?] |

## 7. Acceptance-criteria traceability (ticket #18)

| # | Acceptance criterion (#18) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Author enters a prompt and options (aspect ratio, content class, style), sees several variants, and can regenerate | FW2, FW3, FW12 (request mapping, validation, capabilities); BU3, BU4, BU9, BU10, BU15; E2E1, E2E2 | **F2** (real generation, variants, regenerate), **F1** (option compatibility with Image 4 Standard), F8 (site defaults) |
| AC2 | Chosen image is saved to the site's media in DA (or AEM Assets if configured) and inserted with alt text the author can edit | BU11, BU21-BU27 (DA path, insert order, alt rules, size guard, failures, confirmation); BU28-BU30 (AEM selection, adapter, honest fallback); E2E3 | **F2** (file in DA hidden folder, image at cursor, edited alt, renders after preview), **F9** (legacy vs hlx6), **F10** (AEM Assets, gated by S-AEM), S-DA spike results |
| AC3 | Firefly S2S credentials held by the worker; long-running generations show progress | FW4 (S2S token mint/cache/refresh), FW6 (status mapping), FW7 (rate limit/policy), FW8; BU6, BU7, BU8 (polling, progress, cancel); E2E1, E2E4, E2E5; SM-F2 | **F0** (secrets in the platform store), **F4** (progress, cancel), **F7** (rate limit), **F1** (real payloads: does a progress field exist?); review: progress is status+elapsed+indeterminate (Open Question 8) |
| AC4 | All code in its own self-contained `firefly-generate` folder, with a README covering setup, the EW config-sheet row, and any site config it reads | S3 convention check (folder has entry page, README, tests, worker with config/README/test; no cross-extension imports); UR1/UR4 (worker completeness/location) | **Review checklist:** README sections for setup, the `library` row (table above), site-config keys read, worker secrets/deploy, local dev; a reviewer follows it on a clean clone |
| AC5 | Listed in the repo README extensions table and reachable from the editor library | S3 (table row <-> folder/entry page integrity, `type` = library plugin matches the documented `library` row) | **F2** (appears in the library, opens, closes), review of the README row |
| AC6 | Works in EW with `ref=local` and with a branch ref | E2E1-E2E8 (page at `localhost:3000` + worker at `:8787`, the exact `ref=local` topology); SM-F4 | **F2** (`ref=local`), **F3** (branch ref against the deployed worker; observed `Origin` recorded) |
| AC7 | Vendor credentials live only in this extension's worker (from the template); the browser never receives them; unauthenticated calls are rejected | FW1 (401 on every route, zero upstream calls), FW5 (handle isolation), FW11 (canary), FW14, FW16; BU5, BU17; E2E7, E2E8; SM-F1, SM-F3 | **F0** (bare `curl` -> 401), **F3**, **F5** (search for secrets; unauthenticated and wrong-origin probes), F11 (rotation) |
| AC8 | Core logic covered by unit tests; lint and CI green | FW1-FW16, BU1-BU31 run by `npm run test:worker`, `npm test`; E2E1-E2E8 by `npm run test:e2e`; lint | CI shows `lint`, `unit`, `worker-unit`, `e2e` green on a PR; break a rule on a scratch branch (e.g. loosen the host-suffix check) and see FW9 fail |

Every acceptance criterion on #18 maps to at least one automated test or a numbered manual verification step above.

## 8. Open questions for the owner

1. **Firefly credentials (R1).** Firefly Services API access appears to require an Enterprise entitlement. Do you have, or can you obtain, an OAuth Server-to-Server credential (client id + secret) from an entitled Adobe org for development and testing? Whose credits are used? Without this, the spike (S0), F0-F11 and the AC3/AC7 production checks cannot run; automated tests against the fake still can.
2. **Model choice.** Confirm Image 4 Standard on the v3 endpoint (up to 4 variants, content class, style presets, style reference) over Image 5 (newer, 1 variation per call, no content class/presets). Is a later Image 5 follow-up acceptable?
3. **Firefly code placement.** Confirm Firefly routes live directly in `apps/firefly-generate/worker/`, and `providers/<vendor>/` is reserved for alternative generators (vs the #2 refinement `providers/<vendor>/worker/` applied here).
4. **AEM Assets (AC2 "or AEM Assets if configured").** If spike S-AEM shows AEM Assets writes are infeasible with the author's IMS token, or generated assets cannot be delivered until published, do you accept shipping DA media only, with AEM Assets as an explicit "not available, saved to DA" fallback and a follow-up ticket? Or is AEM Assets mandatory for this ticket?
5. **Progress (AC3).** The documented status payload has no percentage. Is "status text + elapsed time + activity indicator + cancel" acceptable for "show progress"?
6. **Template gaps G1-G5.** Can the #2 owner extend the template (body-secret injection for the token exchange, runtime-minted value redaction, suffix host allowlist, binary streaming, DELETE in CORS), or should this worker carry local workarounds (direct `fetch` for the token mint and content stream, guarded by tests) and tell #2 later?
7. **Who may spend credits (R3/R4).** Set `ALLOWED_IMS_CLIENT_IDS` (decided after #2 W2 inspects a real token) and an optional user allowlist? Adopt Cloudflare's rate-limiting binding for a per-user request throttle (approximate per location)? Is the org-wide 4 requests/minute default acceptable or should higher limits be requested from your Adobe contact?
8. **Defaults and brand safety.** Are the proposed built-in defaults (4 variants, `photo`, 4:3, no presets, empty negative prompt, credit notice, alt prefilled from the prompt) right? Should a site-level "required negative prompt" or "prompt suffix" be part of v1? Should generated images carry a visible AI-generated marker in alt text by default?
9. **Content provenance.** Do you want the plugin to preserve any Content Credentials metadata (never re-encode: current design) and note AI generation anywhere (alt/title/metadata)? This is a policy call, not verified API behaviour.
10. **Prompt privacy.** Prompts go from the author's session to Adobe's service via the worker. Is that acceptable for your sites/orgs; should the README carry a data-handling notice?
11. **Site config keys.** Accept the proposed `firefly.*` key names and reading them via the SDK's `daFetch`? Is "authors without config read permission fall back to built-in defaults" acceptable?
12. **Dialog vs inline.** Is `experience=fullsize-dialog` the intended registration, and should a degraded `inline` layout be supported?
13. **hlx6 / DA store.** Is your DA org a legacy DA site or upgraded to the new source bus? v1 may support legacy only if the SDK's `daFetch` cannot reach the newer endpoints (S-DA).
14. **Drift checks.** Include the scheduled non-blocking OpenAPI drift check and the optional SDK canary in CI?
15. **Overlap.** The ticket flags EW's own assistant adding image generation (overlap 4/5). Proceed anyway, or keep this extension minimal until that is clearer?
16. **Naming and repo values.** `ew-firefly-generate-worker` as the worker name and `jazhou-adobe`/`ew-extensions` as `ORG`/`SITE` (same assumption as #1 R10/#2 Q13); confirm.
