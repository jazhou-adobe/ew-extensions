# Spec: Figma-to-Page (fullscreen app + per-extension worker)

Ticket: jazhou-adobe/ew-extensions#38 (this spec: #76). Blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). Neither is built yet; everything here that "reuses" them presumes their specs as written.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1, #2 and Migration Assistant specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe, Figma or Cloudflare.

Primary sources read (all 2026-11-16):
- Figma REST API: files endpoints https://developers.figma.com/docs/rest-api/file-endpoints/ ; node types https://developers.figma.com/docs/rest-api/file-node-types/ ; property types https://developers.figma.com/docs/rest-api/file-property-types/ ; authentication https://developers.figma.com/docs/rest-api/authentication/ ; personal access tokens https://developers.figma.com/docs/rest-api/personal-access-tokens/ ; plan access tokens https://developers.figma.com/docs/rest-api/plan-access-tokens/ ; scopes https://developers.figma.com/docs/rest-api/scopes/ ; rate limits https://developers.figma.com/docs/rest-api/rate-limits/ ; OpenAPI spec https://github.com/figma/rest-api-spec/blob/main/openapi/openapi.yaml (downloaded and grepped).
- EW App SDK docs https://www.aem.live/docs/ew/developing/apps-plugins ; SDK source https://da.live/nx/utils/sdk.js and `daFetch` https://da.live/nx/utils/daFetch.js.
- DA Source API https://docs.da.live/developers/api/source, List API https://docs.da.live/developers/api/list; DA Admin source https://github.com/adobe/da-admin/blob/main/src/index.js (`PUT` and `POST` both go to the same write handler; the `.da-versions` folder is reserved) and https://github.com/adobe/da-admin/blob/main/src/helpers/source.js (response carries `source.contentUrl`).
- DA/EDS content rules (document skeleton, block markup, media lifecycle, limits): Adobe's `da-content` skill, https://github.com/adobe/skills/tree/main/plugins/aem/edge-delivery-services/skills/da-content (SKILL.md read through the mirror https://skillmd.com/skills/adobe/da-content, `references/media.md` read at https://raw.githubusercontent.com/adobe/skills/main/plugins/aem/edge-delivery-services/skills/da-content/references/media.md). Its claims are tagged `[verified]`/`[assumed]` by its authors; I did not re-verify them empirically. EW media doc https://www.aem.live/docs/ew/authoring/adding-media (dot-folder convention).
- Overlap evidence: EW assistant panel https://www.aem.live/docs/ew/authoring/assistant ; Adobe's "Figma to Visual Content Fragments" skill https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/ai-in-aem/agentic-capabilities/brand-experience/experience-production/figma-to-visual-content-fragments .
- Upstream `adobe-rnd/ew-extensions` tree (GitHub tree API, 137 paths): **no Figma, design-import, importer or worker code exists**, so there is no upstream prior art for this extension, only for repo conventions.
- Cloudflare limits are taken from the #2 spec (which read https://developers.cloudflare.com/workers/platform/limits/); I did not re-read them.

Vocabulary (follows #1/#2/Migration Assistant): *extension* = one folder `apps/<name>/`; *worker* = the per-extension backend in `apps/<name>/worker/`; *template* = `shared/worker-template/`; *IMS token* = the token the DA App SDK hands the extension. New terms: **frame** (the Figma node the user links to), **frame URL** (a figma.com link with a `node-id`), **file key** (the id in the URL path), **node tree** (the frame and its descendants as Figma's REST API returns them), **component instance** (a Figma `INSTANCE` node, linked to a main component via `componentId`), **mapping profile** (the saved rules for one site), **rule** (one entry of the profile), **block rule** (turns a matched node into one EW block), **disposition** (what the engine decided for one node, see Decision 14), **unmapped** (a visible node with content that no rule or default-content path placed), **conversion** (the engine's result for one frame: document model, HTML, asset plan, coverage report), **asset** (an image the document needs: a *fill* = original image bytes referenced by `imageRef`, or a *render* = Figma's rasterisation of a node), **target path** (the DA document path chosen for Create).

---

## Problem Statement

A designer hands a Figma frame to a site builder or content author: "build this page". On an Edge Delivery Services (EDS) site in Experience Workspace (EW) the page is a document of **blocks** (hero, cards, columns, ...) plus default content. Turning the frame into that document today is manual: open Figma, decide which part of the frame is which block, retype or copy text, export images one by one, upload them, rebuild the document. Three things make this slow and error-prone:

- **Mapping is judgement.** Figma has no notion of "block". A frame is layers; the site's blocks are code. Someone has to decide "this instance of the `Hero` component is the hero block, its title text is cell 1, its photo is cell 2". The same decision is repeated for every page built from the same design system.
- **Nothing is remembered.** The mapping lives in the builder's head. A second page from the same Figma library repeats all of it.
- **Content gets lost silently.** When someone rebuilds a page by hand, a label, a caption or a small image is easy to forget, and nobody can tell afterwards what was left out.

Browsers also cannot read Figma directly: the Figma REST API needs an access token (which must never ship in browser code, and the extension's static files are public), and the exported image files live on a different host.

## Solution

A fullscreen EW app, **Figma-to-Page**, reachable from the EW Apps menu, backed by a small per-extension worker that holds the Figma token. A site admin works through four steps on one page:

1. **Frame.** Paste a Figma frame URL. The worker fetches the node tree with its server-held Figma token (the browser never sees the token) and the app shows an outline of the frame and a reference picture of it.
2. **Rules.** Edit the **mapping profile**: which Figma components (or layers) become which site blocks, which layers fill which cells, how text styles become headings, how sections are formed. The app lists every component it found in the frame with a one-click "add a rule". The profile is **saved per site** in the site's DA content and shared by everyone who opens the app on that site.
3. **Preview.** See the generated document immediately (blocks drawn as labelled boxes with their cells, default content in plain styles, the exact EW HTML on a second tab) next to Figma's own picture of the frame with the unmapped layers outlined. A **coverage report** lists every layer that no rule placed, with its text or image, so nothing is dropped silently.
4. **Create.** Choose a DA path. The app fetches the images through the worker, uploads them next to the document with the user's own DA rights, writes the document, and links to it in the EW editor. Nothing is written to DA before this step except an explicit profile Save.

The mapping engine is a pure browser module (so editing a rule updates the preview instantly); the worker is a thin, authenticated, allowlisted Figma reader built from the shared worker template. The app converts **structure and content** (blocks, cells, text, links, images), not visual styling: colours, fonts and spacing stay the job of the site's block CSS.

## User Stories

Site admin / builder (primary actor):

1. As a site admin, I want to paste a Figma frame URL and see the frame, so that I know the app found the right design.
2. As a site admin, I want the app to accept the URL forms Figma gives out (`design`, legacy `file`, branch URLs, `node-id` with a hyphen), so that I can paste whatever "Copy link to selection" produced.
3. As a site admin, I want a clear message when the URL has no `node-id`, is a FigJam board, a prototype-only link or a Slides/Make file, so that I know what to copy instead.
4. As a site admin, I want never to type, see or paste a Figma token, so that I cannot leak it and the token is not tied to my own Figma account.
5. As a site admin, I want a plain message when Figma refuses the request (file not shared with the extension's account, token expired, file not on the allowlist), so that I know whom to ask.
6. As a site admin, I want to see Figma's rate-limit state ("retry in N seconds" or "monthly limit reached") instead of a generic failure, so that I know whether to wait or to ask for a better seat.
7. As a site admin, I want an outline of the frame (layers, components, text, images) with each layer labelled by what the app will do with it, so that I can see how the design is read.
8. As a site admin, I want Figma's own rendering of the frame beside the outline, so that I can compare the generated document with the design.
9. As a site admin, I want the app to list every component used in the frame with instance counts and a one-click "create a rule for this component", so that I start from what is actually there.
10. As a site admin, I want to map a Figma component (matched by name, component-set name or layer-name pattern) to a site block name, so that "Hero" becomes the `hero` block.
11. As a site admin, I want block names validated against EDS naming rules (lower-case alphanumerics and single hyphens), so that I cannot create a block that silently renders as plain HTML.
12. As a site admin, I want to choose which layers fill which cells of a block (by layer name, path or type), and whether each cell is plain text, rich text, an image or a link, so that the block's content lands in the right place.
13. As a site admin, I want a repeated child (for example a row of cards) to become one block with one row per child, so that a card list is one `cards` block rather than many blocks.
14. As a site admin, I want a Figma component property (for example `Theme = Dark`) to become a block variant (`hero dark`), so that design variants survive.
15. As a site admin, I want the first matching rule to win in a defined order that I can rearrange, so that results are predictable.
16. As a site admin, I want text styles or font sizes mapped to heading levels and paragraphs, so that headings come out as `h1`..`h6` without hand edits.
17. As a site admin, I want bulleted and numbered lines in a Figma text layer to become real lists, so that lists are not flattened.
18. As a site admin, I want bold, italic and hyperlinks inside text kept, so that emphasis and links are not lost.
19. As a site admin, I want a layer's link (text hyperlink or a prototype "open URL" action) to become a link in the document, so that buttons keep their destination.
20. As a site admin, I want to decide how top-level parts of the frame become sections (one section per top-level layer, one section total, or split at layers I name), so that section styling on my site works.
21. As a site admin, I want the page title taken from the frame name (editable), so that the document has metadata.
22. As a site admin, I want layers I never want imported (annotations, redlines, device chrome) matched by name and ignored explicitly, so that ignoring is a deliberate, visible rule and not an accident.
23. As a site admin, I want the mapping rules saved for my site, so that the next page from the same design system needs no setup.
24. As a site admin, I want to save, reload, duplicate, rename and delete named profiles, so that one site can hold different mappings (for example marketing and product pages).
25. As a site admin, I want the app to start with a sensible built-in starter profile when the site has none, so that the first preview is useful before I configure anything.
26. As a site admin, I want to export and import a profile as a file, so that I can review or share rules outside EW.
27. As a site admin, I want a raw JSON view of the profile with validation errors, so that I can fix a rule quickly or paste one in.
28. As a site admin, I want a visible "unsaved changes" indicator and explicit Save, so that I do not overwrite the team's rules by accident.
29. As a site admin, I want every layer that has content but was not placed (text, image, vector, unsupported type, unmapped component instance) listed in a coverage report, with its text or a thumbnail and its path in the frame, so that nothing is silently dropped.
30. As a site admin, I want unmapped layers outlined on the Figma reference picture, so that I see where on the page they are.
31. As a site admin, I want content inside a matched block that no cell picked up reported as "unmapped inside block", so that an incomplete cell definition is visible.
32. As a site admin, I want a count of each disposition (block, cell, default content, ignored, hidden, decorative, unmapped), so that I can judge conversion quality at a glance.
33. As a site admin, I want to be asked to confirm before creating a page that still has unmapped layers, so that incomplete pages are a decision, not a surprise.
34. As a site admin, I want to export the coverage report (copy or download), so that I can hand the list to the designer.
35. As a site admin, I want the preview to update instantly when I change a rule, so that I can iterate on the mapping.
36. As a site admin, I want to see the exact EW HTML the app will write, so that I can verify block markup before creating anything.
37. As a site admin, I want the generated document shown as labelled blocks with their cell grid, so that structure problems are obvious.
38. As a site admin, I want to choose the DA path for the new document, with a sensible default derived from the frame name, so that drafts land in my drafts area.
39. As a site admin, I want the path validated (lower-case, allowed characters, length) and a warning when the page already exists, so that I do not fail on write or overwrite someone's page.
40. As a site admin, I want overwriting an existing page to require an explicit confirmation, so that Create is safe by default.
41. As a site admin, I want images exported from Figma and uploaded into DA next to the document, so that the page does not depend on Figma-hosted links.
42. As a site admin, I want original uploaded pictures (image fills) to be used at original quality, and designed graphics (vectors, composed layers) rendered at a scale I choose, so that quality and file size are sensible.
43. As a site admin, I want an SVG that is over the EDS 40 KB cap replaced by a PNG render automatically and reported, so that preview does not fail later.
44. As a site admin, I want progress and per-image results during Create, and a retry for failed images, so that one bad image does not waste the run.
45. As a site admin, I want Create to stop before writing the document if a required image failed (unless I explicitly choose to continue without it), so that I never publish a page with broken images by accident.
46. As a site admin, I want a link to the new document in the EW editor when Create finishes, so that I can continue editing.
47. As a site admin, I want the app to say clearly that preview/publish is a separate step, so that I do not expect the page on `aem.page` yet.
48. As a site admin, I want to cancel at any time, so that I am never trapped in a long export.
49. As a site admin, I want a reminder of what the converter does not do (styling, responsive variants, animation, forms), so that I do not expect a pixel-perfect page.

Content author (secondary actor):

50. As a content author, I want the app reachable from the EW Apps page, so that I can find it like other EW apps.
51. As a content author, I want the generated page to open in the normal EW editor, so that I can polish it with the tools I know.
52. As a content author, I want image alt text filled from the layer name where that name looks meaningful and left empty (and reported) otherwise, so that I know which images still need alt text.

Extension author / maintainer:

53. As the maintainer, I want all code in one self-contained `figma-to-page` folder with its own README, tests, entry page and `worker/`, so that it can be moved upstream or deleted without breakage.
54. As the maintainer, I want the conversion engine, profile store and Create executor to be pure logic behind two injected ports (Figma client, DA fetch), so that they are fully unit-testable with no network, EW or Figma account.
55. As the maintainer, I want a fake Figma API that reproduces the real API's behaviours (null node entries, null renders, 403/404/429 with headers, expiring image links), so that tests catch production behaviours.
56. As the maintainer, I want the Figma token only in the worker's secret store, with unauthenticated calls rejected on every route, so that the token cannot be read from the browser and the worker is not an open Figma proxy.
57. As the maintainer, I want an explicit allowlist of Figma files the worker may read, so that "any Adobe user" cannot read every file the token's owner can see.
58. As the maintainer, I want the worker to relay image bytes only from a fixed, allowlisted image host, so that it cannot be used as a general downloader.
59. As the maintainer, I want the README to name the config-sheet row that enables the app and every site config it reads, so that enabling it is copy-paste.
60. As the maintainer, I want the root README extensions table to list the app, so that it is discoverable.
61. As the maintainer, I want rate-limit usage per conversion documented and minimal, so that Figma's tight Tier-1 limits are not exhausted by normal use.
62. As the maintainer, I want the token's required Figma scope, seat type and expiry policy documented, so that rotation is routine.

Reviewer / security reviewer:

63. As a reviewer, I want manual verification steps for `ref=local` and a branch ref that run in EW in minutes, so that I can approve a PR with evidence.
64. As a security reviewer, I want proof that the Figma token and the IMS token never appear in the DOM, logs, responses, saved profiles or reports, so that the template is safe to copy.
65. As a security reviewer, I want proof that all text, names and URLs coming from Figma are rendered as text (never HTML) and that generated HTML contains no script, event handlers or `javascript:` links, so that a hostile or sloppy design cannot plant markup in a site.
66. As a stakeholder, I want the README to position the tool against the EW assistant and Adobe's Figma-to-Content-Fragment skill, so that nobody uses the wrong one.

## Implementation Decisions

Decision-level only; paths and file names appear in the Build Analysis.

### Shape and platform

1. **Type and location.** Fullscreen app (registered as a row in the EW `apps` sheet), in its own folder `figma-to-page` under `apps/` per the owner-approved convention (every extension is `apps/<name>/`; type comes from the config-sheet row). Entry page named after the folder. Vanilla DOM and browser-native ES modules, no bundler (decision in #1). Its worker lives in `worker/` inside the folder, built from `shared/worker-template/`. No vendor sub-folders are needed in v1 (`providers/<vendor>/` stays unused; Figma is the one design source and is part of the extension itself).
2. **Responsibility split (the central decision).** The **browser does the thinking**: URL parsing, node-tree normalisation, mapping, coverage, preview, profile editing, DA writes. The **worker does only what a browser must not or cannot**: hold the Figma token, call the Figma REST API, enforce which files and hosts are reachable, and relay image bytes. Reasons: (a) the credential must never reach the browser (AC7); (b) the whole UX is "edit a rule, see the result now", which needs the engine next to the UI; (c) Cloudflare Workers Free allows 10 ms CPU and 50 subrequests per invocation [VERIFIED second-hand via the #2 spec], so the worker must not parse or transform large node trees; it relays them.
3. **Stateless worker.** No KV, no Durable Objects, no job state (out of scope in #2). The browser holds the conversion state in memory; re-fetching is an explicit "Refresh from Figma". The only persisted artefact is the mapping profile, in DA.
4. **Reuse the worker contract unchanged where possible.** Auth (IMS offline verification, `401` before anything else), CORS (da.live and the site's own origins), secret accessor and redaction, request ids, logging, error contract, outbound `proxy` retry helper and the test kit all come from the template (`shared/worker-template/SPEC.md`). Five needs the template spec does not cover are listed as template questions in Open Questions 14 to 18; this spec does not fork the template.
5. **DA boundary is `daFetch` only; never for the worker.** All reads and writes to DA use `actions.daFetch` against `context.daOrigin` (fallback `https://admin.da.live`), as in Migration Assistant and Deep Clone [VERIFIED: sdk.js exposes `daFetch`; daFetch sets the bearer header on whatever URL it is given, wraps thrown network errors into a synthetic `500`, and on a `401` triggers the SDK sign-in redirect: https://da.live/nx/utils/daFetch.js]. Worker calls use a plain `fetch` with the SDK token so that a worker `401` never bounces the user to IMS sign-in.
6. **Token holder for long sessions.** A conversion plus Create can outlast the token snapshot. The app keeps its own tiny token holder: initialised from the SDK result, refreshed from later parent `message` events carrying a `token`, never rendered or logged; a worker `401` pauses the run with "sign in again" instead of looping. [ASSUMPTION: refresh message shape taken from sdk.js source only; observed in manual step MF9.]

### Figma access (worker)

7. **One static credential: `FIGMA_TOKEN`.** A Figma personal access token (PAT) or, if the owner has an Organization/Enterprise plan, a plan access token, held as a Cloudflare Worker secret and sent as the `X-Figma-Token` header [VERIFIED: both token kinds use that header: https://developers.figma.com/docs/rest-api/personal-access-tokens/ and https://developers.figma.com/docs/rest-api/plan-access-tokens/]. Required scope: `file_content:read` only (all three endpoints used require it) [VERIFIED: https://developers.figma.com/docs/rest-api/file-endpoints/, https://developers.figma.com/docs/rest-api/scopes/]. PATs expire after at most 90 days; plan access tokens after at most 1 year, can be restricted to selected files/folders/teams, and are not tied to a person [VERIFIED: plan-access-tokens page comparison table]. Recommendation: plan access token if available, else a PAT from a dedicated Figma account, with rotation by `wrangler secret put` and no code change. Per-user OAuth is rejected (needs a callback route, token storage and refresh, i.e. KV and encryption; and "server-held Figma token" is the acceptance criterion). Having each user paste their own PAT into the browser is rejected by AC7.
8. **The token's seat decides the rate limit.** Figma applies limits per seat type, endpoint tier and plan: Tier 1 endpoints (file, file nodes, image render) allow only **up to 20 requests per month** for View/Collab seats and 10/15/20 per minute for Dev/Full seats on Professional/Organization/Enterprise plans; Tier 2 (image fills) allows 5/min (View/Collab) and 25/50/100 per minute (Dev/Full) [VERIFIED: https://developers.figma.com/docs/rest-api/rate-limits/, table as of the Nov 17 2025 update]. The same page's worked example says a Starter-plan file is limited to 6 requests per month, while its table says 20/month: an internal inconsistency [OPEN: observe in the sandbox]. Consequence: the token must belong to a **Full or Dev seat on a paid plan**; a View/Collab or Starter token gives roughly 6 to 20 conversions a month. This is the single most important operational requirement and goes in the README.
9. **The worker is an allowlisted Figma reader, not a Figma proxy.** Four routes (conceptual): `frame`, `renders`, `fills`, `asset`. The Figma host is fixed (`api.figma.com`, a variable only so tests and the local environment can point at a fake). Every request names a `fileKey` that must be on a configured `ALLOWED_FILES` list (a non-secret variable); an empty list means "nothing is reachable", never "everything". Reason: a static token can read everything its owner can; without an allowlist every authenticated Adobe user (any IMS login passes offline verification, #2 R3) could read all of the token owner's designs, including unreleased work. Plan access tokens add a second, Figma-side restriction.
10. **Frame route: raw relay, no transformation.** Input is a frame URL (or file key and node id). The worker parses and validates it (host `figma.com`; path kind `design`, `file`, or `proto`; file key `[A-Za-z0-9]+`; node id `digits:digits` after converting the URL's hyphen form), then calls the file-nodes endpoint for that single node and relays Figma's JSON body unchanged, with a byte cap (default 25 MB) enforced while streaming. The worker never parses the tree. Branch URLs use the branch key as the file key [VERIFIED: the endpoint docs say `key` "can be a file key or branch key": https://developers.figma.com/docs/rest-api/file-endpoints/; URL form for branches is [ASSUMPTION], observed in manual step MF2]. The response's `version` is what the app pins on later render calls so the tree and the images always describe the same state of the file.
11. **Renders route.** Input: file key, optional version, node ids (capped per call), format (`png`, `jpg`, `svg`), scale (0.01 to 4). The worker calls the image-render endpoint once per request (Figma batches ids) and relays `{images: {id: url|null}}`. Figma's `null` for a node that cannot be rendered (invisible, 0% opacity, nothing renderable) is passed through and reported by the app, never retried as an error [VERIFIED: https://developers.figma.com/docs/rest-api/file-endpoints/ "GET image"]. Renders are 32 megapixel-capped and the returned links expire after 30 days [VERIFIED: same]. Because format and scale are per call, the engine groups assets by (format, scale), so a conversion costs 2 Tier-1 calls (frame, renders for one group; a second group costs one more) plus 1 Tier-2 call (fills).
12. **Fills route.** Input: file key. The worker calls the image-fills endpoint and relays the mapping `imageRef -> url`. Links expire after at most 14 days [VERIFIED: same page]. The official OpenAPI schema wraps this response as `{error, status, meta: {images}}` while the prose docs show `{images}`; the app accepts both shapes [VERIFIED discrepancy: https://github.com/figma/rest-api-spec/blob/main/openapi/openapi.yaml `GetImageFillsResponse` vs the docs page].
13. **Asset route (byte relay).** Input: one image URL returned by renders or fills. The worker fetches it **without** the Figma token and relays the bytes with the upstream content type, only if: scheme `https`; host is in a configured asset-host allowlist (default the host Figma has used for image links, `figma-alpha-api.s3.us-west-2.amazonaws.com` [VERIFIED only as an observation in a 2023 Figma forum post, https://forum.figma.com/ask-the-community-7/get-image-filesecurity-34120; current hosts [ASSUMPTION], so the allowlist is configuration, and an unexpected host is reported as a clear error]); no redirects; content type in an image allowlist (PNG, JPEG, GIF, WEBP, AVIF, SVG); bytes capped (default 20 MB, the EDS cap for raster images per the `da-content` skill). Why through the worker and not the browser: whether Figma's image host sends CORS headers is unknown [OPEN, tested in MF3], and a worker relay removes the dependency. The links are public to anyone holding them (per the forum post) and contain no credential; the app never stores them.
14. **Disposition of Figma errors.** Figma `400` -> `bad_request`; `403` ("token invalid or expired") -> a distinct worker code (for example `figma_forbidden`, HTTP 502) with an operator log line, because it is the operator's problem and not the user's; `404` -> `figma_not_found` (file missing or not shared with the token's account); `429` -> the template's `rate_limited` with Figma's `Retry-After` **uncapped** and the plan-tier and rate-limit-type hints, so the UI can say "monthly limit, ask for a Full/Dev seat" [VERIFIED headers: `Retry-After`, `X-Figma-Plan-Tier`, `X-Figma-Rate-Limit-Type`, `X-Figma-Upgrade-Link`: https://developers.figma.com/docs/rest-api/rate-limits/]; `5xx`/network -> the template's `upstream_unavailable` after its bounded retries. The template's backoff (cap about 2 s) is **useless against Figma's per-minute buckets and harmful for monthly ones**; the route therefore retries `5xx` only and never waits out a `429` (template question 15).
15. **No server caching.** Rate limits are tight (Tier 1: 10 to 20 per minute at best), so the browser caches the frame, renders and fills in memory for the session and only refetches on "Refresh from Figma". Worker-side caching (Cache API, KV) is out of scope (it would also keep design data at rest).

### Conversion engine (the core IP)

16. **Pure, deterministic, browser-side.** One conversion takes `(node tree, components/componentSets/styles maps, profile)` and returns the document model, the HTML, the asset plan, and the coverage report. Same input, same bytes out (needed for tests and for stable asset names). No DOM, no network, no clock inside the engine.
17. **Normalisation.** Invisible nodes (`visible: false`) and invisible paints are removed first and counted. Children order is reading order: for auto-layout frames the array order is the layout order; for free-position frames (and groups) Figma's array is back-to-front z-order, so the engine sorts by top then left of the bounding box with a row tolerance [ASSUMPTION: z-order behaviour is Figma's, not stated on the pages I read; verified in manual step MF4]. Instances are resolved to their component through `componentId` into the `components` map (name, `componentSetId`, `remote`) and component sets through `componentSets` [VERIFIED shapes: https://developers.figma.com/docs/rest-api/file-property-types/ Component, ComponentSet]. Instances of **remote** (library) components may lack local metadata [ASSUMPTION: the maps include them since the type has a `remote` flag; verified in MF5]; an instance with no resolvable metadata is matchable by layer name only and reported.
18. **Rule vocabulary (the mapping profile).** An ordered list of **block rules** plus profile-wide settings. A block rule has: a **match** (any of: main-component name glob, component-set name glob, layer-name glob, node type, ancestor path glob; conditions inside one rule are AND), a **block** (name, and variants taken from component properties or fixed), a **content model** (either fixed rows of cells, or a **repeat** selector with one cell template producing one row per repeated child), and per-cell **extraction** (text, rich text, image, link, fixed text). The first rule that matches a node (rules are evaluated in listed order at each level of the tree, top-down, in reading order) claims the node and its whole subtree. Data-shape tables are in the Build Analysis.
19. **Section rules.** Modes: `per-top-level-child` (default: each direct child of the frame becomes one section), `single`, or `split-at` (a layer-name glob marks a section break). Blocks and default content inside a top-level child stay in its section. [OPEN: default; Open Question 5.]
20. **Default content (for nodes no block rule claims).** Text layers become paragraphs or headings by **text rules**: an ordered list of matches on the Figma text-style name (through the node's `styles` mapping into the `styles` map [VERIFIED: file-node-types "styles"; Style has `styleType: TEXT` and a `name`]), font size, or font weight, each giving `h1` to `h6` or `p`; the fallback is `p`. Lines marked `ORDERED`/`UNORDERED` in the layer's `lineTypes` become `ol`/`ul` with nesting from `lineIndentations` (to three levels) [VERIFIED fields: file-node-types TEXT]. Image-bearing layers become images (Decision 23). Structural containers (frames, groups, sections, instances without a rule) are recursed into, not emitted.
21. **Rich text subset.** Inside text layers the engine keeps bold, italic, and hyperlinks from `characterStyleOverrides` and `styleOverrideTable` (`fontWeight`, `italic`, `hyperlink`, and the semantic overrides `semanticWeight`/`semanticItalic`) [VERIFIED fields: file-property-types TypeStyle]. Everything else (colour, size, case, underline, letter spacing) is **not** converted and is counted as an info-level "formatting not converted" finding, not an error.
22. **Links.** A link comes, in order, from a text hyperlink of type `URL`, or the first prototype interaction on the layer or its nearest ancestor within the block whose action type is `URL` (open URL) [VERIFIED fields: file-property-types Hyperlink, OpenURLAction]. `NODE` hyperlinks (to another frame) cannot be resolved to a site path and are reported. Only `http`, `https`, `mailto`, `tel` and root-relative targets are written; any other scheme is dropped and reported.
23. **Images in the document.** Two asset kinds. A node whose visible paint is an `IMAGE` fill defaults to the **fill** (original bytes, via `imageRef`), because EDS re-processes the original into responsive variants and the author keeps full quality; the profile can force a **render** (what Figma draws, including crop, corner radius and effects) per rule. Vector/composed layers selected by an image rule, by a layer-name glob such as `icon/*`, or carrying Figma export settings are **rendered**: SVG by default, replaced by PNG at 2x when the SVG would exceed the EDS 40 KB cap (known only after download), and PNG/JPG scale configurable (default 2, Figma allows 0.01 to 4) [VERIFIED: https://developers.figma.com/docs/rest-api/file-endpoints/; caps from the `da-content` media reference]. Alt text defaults to the layer name unless it looks auto-generated (`Rectangle 12`, `Image`, `Frame 3`), in which case it is empty and reported; the profile can force empty alt.
24. **Disposition accounting (AC2 core).** Every node of the tree ends in exactly one disposition: `hidden`, `ignored-by-rule`, `block` (claimed), `cell` (consumed by a cell), `default-content`, `structural` (container with no content of its own, recursed), `decorative` (shapes with only solid/gradient paint and no text or image, listed in aggregate), `unmapped-in-block` (content inside a claimed block that no cell picked up), or `unmapped` (content-bearing but unplaced: text the text rules could not place because it is in an unsupported container, a `VIDEO` or pattern paint, a vector with no image rule, an instance that matched no rule when the profile is configured to flag them, unsupported node types). The counts must sum to the number of nodes in the tree (an invariant the tests check on every fixture). Each unmapped item reports node id, path in the frame, kind, its text (truncated) or a placeholder, and a suggested fix ("add an image rule for `icon/*`"). Create is **gated**: the user must acknowledge the unmapped count (AC2 "reported, not silently dropped"); the report can be copied or downloaded.
25. **Hotspots the engine must not hide.** Unmapped and unmapped-in-block items, `NODE` links, dropped link schemes, unresolved component metadata, `null` renders, over-cap SVG fallbacks, images with empty alt, formatting not converted, and name collisions between block rules are first-class findings in preview and report.
26. **Serialisation.** Output is a DA body fragment (`<body><header></header><main>sections</main><footer></footer></body>`, one `div` per section, no head, no script, no style, no inline style) with blocks in canonical **div form** (`<div class="name variant"><div><div>cell</div></div></div>`), plus an optional `metadata` block last [VERIFIED rules: `da-content` skill SKILL.md rules 1 to 4]. Block-cell content uses only the inline tags the skill's preserve list allows (`strong`, `em`, `a`, `code`, `br`) since the pipeline rewrites others [VERIFIED rule 11 of the skill]. All text is escaped; attribute values are escaped; there is no `class`/`id` on default content. The serialiser sanitises by allowlist, so a hostile or odd design cannot plant markup in a site.

### Profile storage ("saved per site", AC2)

27. **Where.** In the **target site's DA content**, in a dedicated hidden-by-convention dot-folder (`.figma-to-page`), one JSON file per named profile, written through the normal Source API. Rationale (as for Migration Assistant, whose Decision 27 this mirrors): per site by construction, shared by everyone with DA write access to the site, versioned by DA, no new backend, travels with the site. [ASSUMPTIONS to verify in the sandbox before the store is built, same list as Migration Assistant: (a) the Source API stores arbitrary JSON verbatim; (b) a top-level dot-folder is writable by users who can write the site and is not published by EDS; (c) its contents are listable with the List API. Do not use the reserved `.da-versions` name: da-admin blocks it [VERIFIED: https://github.com/adobe/da-admin/blob/main/src/index.js].] The folder name is shared infrastructure with Migration Assistant's convention; keep each extension in its own subfolder [OPEN: Open Question 3].
28. **Shape and lifecycle.** A versioned JSON document (`version` field; a newer version than the app understands is refused with a message, an older one is migrated in memory). List, create, duplicate, rename and delete named profiles; the default name is `default`. A profile never contains credentials, tokens, Figma URLs with tokens, or frame content, only rules and settings. Explicit Save only, with an unsaved indicator; last-write-wins (DA offers no conditional writes). The saved file records author email (from the SDK `context` if present) and timestamp.
29. **First run.** When the site has no profile the app shows a built-in **starter profile** (section per top-level child, text rules by font size, image fills, no component rules) marked "not saved". Component rules come from the "Detected components" panel.
30. **Editing UX.** A rules panel with: rule list (reorder, enable/disable, duplicate, delete); a rule editor (match, block name with live validation, variants, content model, per-cell select/extract); a "Detected components" list with instance counts and one-click rule creation; per-selector live match counts over the current frame; raw JSON tab with schema validation; import/export. Block names are free text in v1 (validated against EDS naming); suggestions from the site's block library are out of scope (Open Question 6).

### Preview and Create (AC3)

31. **Preview.** Built from the document model with DOM APIs (`textContent`, never HTML strings), so there is no iframe and no script risk. Panes: structure view (blocks as labelled boxes with the cell grid, default content in plain styles); the raw EW HTML as text; the coverage report; and a **reference render** of the frame (one PNG render at scale 1) with unmapped nodes outlined using their bounding boxes. Images in the structure view are shown from in-memory object URLs of the fetched bytes. The preview deliberately does not run the target site's block code (that would need the page to exist on `aem.page`).
32. **Target path.** A DA path the user chooses; default `/drafts/figma/<slug of frame name>`; validated lower-case with `a-z0-9-` segments, no `.html` suffix, not empty, not `/`, no dot-segments, within the 900-character path limit the Migration Assistant spec cites from https://www.aem.live/docs/limits (not re-read here). Existence is checked with a `GET` on the `.html` source; an existing page requires an explicit overwrite confirmation (DA versions overwritten documents, per the Deep Clone spec).
33. **Create order and writes.** (1) Fetch every asset the document references through the worker (bounded concurrency, default 3, one in memory at a time per slot); (2) upload each to the document's **dot-folder**, the folder named `.<document name>` next to the document, which is EW's own convention for per-document uploads [VERIFIED: https://www.aem.live/docs/ew/authoring/adding-media]; (3) write the document last, referencing each image by the **absolute `contentUrl` returned by the upload response** (host-less and relative paths render as `about:error` at preview, absolute DA content URLs are re-hosted into the media bus [VERIFIED by the `da-content` skill; empirical claims not re-verified; `contentUrl` present in the Source API response: https://docs.da.live/developers/api/source and da-admin `sourceRespObject`]). Writes are `POST` multipart with field `data`, as the docs show; da-admin routes `PUT` and `POST` to the same handler [VERIFIED], and `daFetch`'s own helper uses `PUT`. Success is judged from the response status (never assumed) and the `data` field name is mandatory (other names return `200` and write nothing, per the skill). Asset names are deterministic (frame slug plus node id, or `imageRef` hash prefix, extension from the sniffed content type) so a re-run overwrites the same files.
34. **Failure policy.** Each asset is an independent unit with up to 3 attempts for `429`/`5xx`/synthetic `500`; a `401` pauses the run for re-sign-in. If any required asset fails, the document is **not** written; the report lists the failures with Retry; the user may explicitly choose "continue without these images" (the `img` is omitted and reported). A cancelled run reports what was written (images only) and never leaves a document referencing missing images.
35. **After Create.** Show the DA editor link (`editUrl`) from the Source API response and state that preview and publish are separate author steps (the pipeline ingests images at preview). The app does not call the Admin preview/publish APIs.
36. **Limits and guards.** Raster over 20 MB and SVG over 40 KB are handled per Decision 23 or reported; the DA editor upload cap (reported second-hand as 4.5 MB on Helix 6 sites, 20 MB legacy, per the Deep Clone spec) is treated as a possible ceiling for the Source API and surfaces as a per-asset failure with the status, not a pre-emptive refusal [ASSUMPTION]. Whether `admin.da.live` remains the right write origin for Helix 6 sites is open (carried over from Deep Clone) and isolated to one constant.

### UI, security, tooling, docs

37. **UI.** One page, four steps (Frame, Rules, Preview, Create) with a persistent summary bar; a side-effect-free render layer takes state and returns DOM (the testable seam, S2). Standard hello-world "waiting for / not running inside Experience Workspace" states. All Figma-derived and API-derived strings (names, text, URLs, errors) are rendered as text.
38. **Secrets and privacy.** No credential in the browser or in any saved artefact (profile, report, export). The IMS token goes only to the constant worker origin and (via `daFetch`) the DA origin. Design content (frame text and images) passes through the worker in memory and is not stored or logged by it (logs carry file key, node id, status, bytes, never content). The README states that designs flow through a Cloudflare account and the Figma token's owner's access.
39. **Tooling.** As decided in #1/#2: ESLint 8 + helix config, Stylelint 16, `@web/test-runner` for browser unit tests, `node:test` for worker tests, Playwright, Node 22 (>=22.12 for Wrangler 4), husky. Tests live in the extension folder. No new runner or framework.
40. **Docs.** The extension README covers: purpose and positioning (Decision 41), what is and is not converted, setup (create the Figma token with `file_content:read`, seat and expiry guidance, set `FIGMA_TOKEN` and `ALLOWED_FILES`, deploy), the EW `apps` sheet row (title `Figma-to-Page`, path `https://da.live/app/{org}/{site}/apps/figma-to-page/figma-to-page`, `ref` blank, optional description and image), the site config it reads (**none**; it writes only `.figma-to-page/` profile files and the created page and images, and reads the worker origin from a constant), worker variables and secrets, profile format reference, rate-limit budget, `ref=local`/branch-ref instructions, the trust prompt. The root README extensions table gets one row (name, folder, entry point, `app`, description).
41. **Positioning.** The EW assistant panel is Coworker's natural-language interface; its page lists file attachments, prompts and commands and **does not mention design import** [VERIFIED: https://www.aem.live/docs/ew/authoring/assistant]. Adobe separately ships a Coworker skill "Figma to Visual Content Fragments" for AEM as a Cloud Service: it needs a Figma personal token stored at `experience.adobe.com`, and creates Content Fragment models, fragments and HTML templates, not EDS/EW documents [VERIFIED: the skill page above]. Figma's own MCP server exists but access is limited to catalogued clients [VERIFIED: https://developers.figma.com/docs/rest-api/scopes/ "Figma MCP Server"]. So there is overlap risk but no shipped equivalent for "Figma frame to EW page with saved block mapping". The differentiator to protect: **deterministic, repeatable, per-site saved rules with a coverage report**, versus an assistant's one-off generation. [OPEN: Open Question 7.]

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given a (fake) Figma file, a profile and a (fake) DA site, what document HTML is produced, which layers are reported unmapped, what exists in DA afterwards, and (for the worker) what `Request` gets what `Response`. Never assert on internal function names, DOM structure beyond accessible roles and text, CSS classes or call order (except where order is the behaviour: assets before document; auth before anything). Tests need no network, IMS, EW, Cloudflare login, Figma account or token.

**Proposed seams** (recorded here instead of asked, per #76). One engine boundary with two injected ports, one worker boundary, and the scaffold seams, reused wherever they exist:

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| F1 (primary, new, highest) | **Figma-to-Page engine boundary**: inputs = frame URL + profile + two injected ports (`figma`: the worker client with `frame`, `renders`, `fills`, `asset`; `daFetch`: the SDK function); outputs = conversion (document model, HTML, asset plan, coverage report), the Create result and the resulting DA state | new | WTR unit/integration tests of URL parsing, normalisation, rule matching, default content, coverage, serialisation, profile store, asset pipeline, Create executor, preview view-model | A **fake Figma** (in-memory files built with a fixture builder, behind the `figma` port, reproducing the real API's behaviours: null node entries, null renders, `403`/`404`/`429` with headers, expiring image links) and a **fake DA Admin** (in-memory tree with source/list semantics, `401`/`403`/`5xx` injection, `.da-versions` 404) behind `daFetch`; injected `now`/`sleep`/`random` |
| W1 (reused from #2, extended) | Worker HTTP boundary: `worker.fetch(request, env, ctx)` | from #2 | `node:test` tests for the four Figma routes: input validation, file allowlist, asset-host allowlist, error mapping, caps, secret hygiene | #2 test kit (`makeEnv`, `fakeIms`, `fakeUpstream`) plus a scripted fake Figma API and fake image host behind the injected outbound `fetch` |
| W2 (reused from #2) | Same worker in real workerd over HTTP | from #2 | Smoke tier | `wrangler dev` with `IMS_ORIGIN`, `FIGMA_API_ORIGIN` and the asset host pointing at throwaway local servers (loopback `http` allowed in the local env only, per #2 UP11) |
| S1 (reused from #1/#2) | Entry HTML page + SDK module boundary | from #1 | Playwright e2e | #1 SDK stub (token signed by the test key per #2); fake DA Admin through route interception of the DA origin; real local worker with the fake Figma for the browser-to-worker path |
| S2 (reused from #1) | Render/logic module + SDK result | from #1 | WTR tests for UI render and bootstrap | hand-built SDK result, injected ports |
| S3 (reused from #1/#2, extended) | Repo convention check | from #1/#2 | CI lint job | filesystem fixtures |

Why F1 has two ports but is still one seam: every behaviour of the engine is observable at the two ports (what it asked Figma for, what it wrote to DA), so the whole pipeline is tested at the highest point with no module-internal assertions. Why the worker boundary is separate: a different deployable in a different runtime.

**Modules tested** (all through those seams): URL parser; tree normaliser and reading order; rule matcher; block/cell/repeat extraction; text, list, rich-text and link mapping; image asset planning; coverage accounting; serialiser and sanitiser; profile schema, migration, store; Create executor (asset pipeline, write order, failure policy, overwrite handling); preview/report view-model; worker routes; convention-check additions.

**Prior art.**
- Upstream `adobe-rnd/ew-extensions`: unit tests inject `fetchImpl`/`storage`/`now` (`tools/brand-visibility/session-auth.js`) and import-map the SDK to a fixture; e2e stubs network before `page.goto()` (see #1 spec). No Figma or importer tests exist upstream.
- In this repo: Migration Assistant's **M1 engine boundary with injected ports and a fake source site + fake DA Admin** (`apps/migration-assistant/SPEC.md`) is the direct model; its profile-store tests, hotspot report and plan/execute split are reused in spirit. The fake DA Admin should be the **same shared test support** if Migration Assistant and Deep Clone build one first [OPEN: coordinate so there is one fake, not three].
- Template: the #2 test kit and the UA/UC/UP/US matrices cover auth, CORS, retry and secret hygiene; this extension's worker tests only add the Figma-specific behaviour.

## Out of Scope

- Visual fidelity: colours, fonts, spacing, border radius, shadows, gradients, animations, responsive/constraint behaviour, auto-layout to CSS. The converter produces **content and block structure**, not styles. Interactive prototypes, variables, annotations, comments and Dev Mode data are not read.
- Multiple frames per run, whole-file import, multi-breakpoint frames (mobile and desktop of the same page), and frame pickers from a file URL without `node-id` (v1 asks for a frame link) [OPEN: Open Question 8].
- Blocks that need code or data the design cannot express: forms, embeds, video, carousels' behaviour, personalisation, fragments and header/footer documents.
- FigJam boards, Figma Slides, Figma Make, Sketch, Adobe XD and other design sources.
- AI-assisted mapping (suggesting rules from names or images with a model). The engine is deterministic; an assistant-driven variant would be a separate Coworker skill.
- Suggesting block names from the site's block library, and reading any DA site config sheet (v1 reads none) [OPEN: Open Question 6].
- Calling Admin preview/publish, creating redirects, writing page metadata beyond the title, or bulk creation.
- Per-user Figma OAuth, multiple Figma accounts per site, and worker-side caching or storage of designs.
- Live sync (re-import on Figma change) and diffing a Figma frame against an existing page.
- Persisting anything except the mapping profile (no run history, manifest, or saved reports).
- Cloudflare account/policy decisions and Adobe outside-activity/IP policy (carried from #1 R1 and #2 R1); marketplace publishing.
- Full cross-browser e2e and Tier-2 real-session e2e in CI.

## Further Notes

- **The hard part is fidelity of the mapping, not plumbing.** Figma does not mark blocks; results are only as good as the design system's naming. Designs with consistent component names (Hero, Cards, Columns) convert well; ad-hoc frames of loose layers convert into default content plus an honest unmapped report. The coverage report and the reference-render overlay are therefore core features, not polish.
- **Rate limits are the second hard part.** A View/Collab or Starter token allows on the order of 6 to 20 conversions a month; a paid Full/Dev seat allows 10 to 20 Tier-1 calls a minute [VERIFIED: https://developers.figma.com/docs/rest-api/rate-limits/]. Figma "reserves the right to change rate limits"; the budget (2 Tier-1 + 1 Tier-2 calls per conversion, plus one more Tier-1 per extra format/scale group) is documented so it can be re-checked.
- **Figma's own docs conflict** in two places the code must tolerate: the image-fills response wrapper (Decision 12) and the Starter-plan monthly figure (Decision 8). Both are handled as data, not hard-coded.
- **Image links are public.** Figma image links work for anyone holding the URL (forum evidence, Decision 13). The worker never logs them and the app never persists them; they are an unavoidable part of the Figma API.
- **Unreleased design IP flows through the worker.** The README must say so, and `ALLOWED_FILES` exists so only designated files are readable.
- **Dot-folders and the unreleased Helix 6 source bus** (Decisions 27 and 36) are the main DA-side unknowns; both are shared with Migration Assistant and should be resolved once.
- **Do not reuse `KEY` in variable names** the #2 repo check flags as secret-like (`*KEY*`): hence `ALLOWED_FILES`, not `ALLOWED_FILE_KEYS` (the check, UR3, would fail the config).
- The `SPEC.md` in `apps/figma-to-page/` is a planning artefact; when the app is built, decide whether to keep it or delete it (as in the hello-world spec).

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)                                   Figma (api.figma.com)        Figma image host (S3)
 └─ iframe: Figma-to-Page   (origin: https://{ref}--{site}--{org}.aem.live | .preview.da.live | http://localhost:3000)
      │ SDK handshake: { token (IMS), context, actions{daFetch,...} }
      │
      ├─ fetch(worker, Authorization: Bearer <IMS>) ─► Cloudflare Worker (apps/figma-to-page/worker, core from shared/worker-template)
      │                                                  1 origin gate  2 IMS check  3 route: frame | renders | fills | asset
      │                                                  4 ALLOWED_FILES / asset-host allowlist
      │                                                  5 proxy(api.figma.com, X-Figma-Token from secret) ─────────► Figma
      │                                                  5b asset: GET image url (no token) ───────────────────────► image host
      │
      └─ actions.daFetch ──► admin.da.live
            GET/POST /source/{org}/{site}/.figma-to-page/profiles/<name>.json     (profile store)
            GET      /list/{org}/{site}/.figma-to-page/profiles                   (list profiles)
            GET      /source/{org}/{site}/{path}.html                              (exists check)
            POST     /source/{org}/{site}/{parent}/.{doc}/<asset>                  (images)
            POST     /source/{org}/{site}/{path}.html                              (document, written last)
```

| Concern | Browser (static files, public) | Worker (private runtime, holds the token) |
|---|---|---|
| Figma credential | never | only place; Cloudflare secret `FIGMA_TOKEN` |
| Which files are readable | shows errors | enforces `ALLOWED_FILES` |
| Reading the design | URL parsing, normalisation, mapping, coverage | relays Figma's JSON unchanged (size-capped) |
| Images | plans, fetches via worker, uploads to DA | resolves nothing itself; relays bytes from an allowlisted host |
| Rules | edit, validate, persist in DA | none (never sees rules) |
| DA | all reads and writes, with the user's rights | none |
| Rate limits | one-conversion budget, user-facing messages | maps Figma `429`/`403`/`404` to documented codes |

## 2. EW integration points

- **App vs library plugin:** fullscreen **app** (an `apps` sheet row, `https://da.live/apps#/{org}/{site}` card, direct URL `https://da.live/app/{org}/{site}/apps/figma-to-page/figma-to-page`) [VERIFIED mechanism: https://www.aem.live/docs/ew/developing/apps-plugins]. A library plugin is the wrong surface: the app needs a full-screen stepper, not a palette. The generated page is opened in the normal editor afterwards, so no `sendHTML`/`sendText` SDK actions are used.
- **Config-sheet rows:** one `apps` row (title `Figma-to-Page`, description, optional image, path as above, `ref` blank; what the `ref` column does for apps is undocumented, #1 R11). No `library` row. The **site config it reads: none.** It writes only `.figma-to-page/` profile files, the created page and its images. (A `library`-sheet read for block-name suggestions is a possible v2, Open Question 6.)
- **SDK surface used:** `context` (`org`, `repo`/`site`, `ref`, `daOrigin`, `email`; shell shapes observed in source per #1 section 2.2, not a documented contract), `token`, `actions.daFetch`. Not used: `sendText`, `sendHTML`, `closeLibrary`, `saveDocument`, live-document actions. `context.repo` is the DA repo name used in DA paths.
- **`ref=local`:** page at `http://localhost:3000` (#1 dev server) + local worker at `http://localhost:8787` (wrangler dev, per #2) with `FIGMA_API_ORIGIN` pointing at either the real Figma (token in `.dev.vars`, local only) or the local fake. **Branch ref:** page on `*.aem.live`/`*.preview.da.live` calling the **deployed** worker (worker origin is a constant, #2 Decision 13).
- **Trust prompt:** first open per `org/repo/ref` shows the standard third-party-app warning (#1 section 2.4); documented in the README. The app can act with the user's DA rights, so the README says it writes only under the chosen path and `.figma-to-page/`.

## 3. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| Figma `GET /v1/files/:key/nodes?ids=` (Tier 1) | the frame subtree, plus `components`, `componentSets`, `styles` maps; `nodes[id]` may be `null`; `version` for pinning | `X-Figma-Token` (PAT or plan token), scope `file_content:read` | https://developers.figma.com/docs/rest-api/file-endpoints/ [VERIFIED] |
| Figma `GET /v1/images/:key?ids=&format=&scale=&version=` (Tier 1) | node renders; `images[id]` URL or `null`; formats `jpg`/`png`/`svg`/`pdf`; scale 0.01 to 4; 32 MP cap; 30-day links; errors 400/403/404/500 | same | same [VERIFIED] |
| Figma `GET /v1/files/:key/images` (Tier 2) | image-fill `imageRef -> url`; links up to 14 days; response wrapper differs between docs and OpenAPI | same | same; https://github.com/figma/rest-api-spec/blob/main/openapi/openapi.yaml [VERIFIED] |
| Figma image host (S3) | download bytes of a render or fill | none (public link) | observed host in a 2023 forum post [VERIFIED observation; current host ASSUMPTION] |
| Figma auth model | PAT: max 90-day expiry, acts as the user; plan token: org/enterprise only, resource allowlist, max 1 year; OAuth: per-user, rejected here | n/a | https://developers.figma.com/docs/rest-api/authentication/ , .../personal-access-tokens/ , .../plan-access-tokens/ [VERIFIED] |
| Figma rate limits | leaky bucket; `429` with `Retry-After`, `X-Figma-Plan-Tier`, `X-Figma-Rate-Limit-Type`, `X-Figma-Upgrade-Link` | n/a | https://developers.figma.com/docs/rest-api/rate-limits/ [VERIFIED] |
| DA Source API | `GET`, `POST` (multipart field `data`; folder = no extension, no body), `DELETE`; `201` with `source.editUrl`/`contentUrl` and `aem.previewUrl`/`liveUrl` | IMS bearer via `daFetch` | https://docs.da.live/developers/api/source [VERIFIED]; `PUT` = `POST` in https://github.com/adobe/da-admin/blob/main/src/index.js [VERIFIED] |
| DA List API | list `.figma-to-page/profiles`; files have `ext`, folders do not | IMS bearer via `daFetch` | https://docs.da.live/developers/api/list [VERIFIED] |
| Adobe IMS | worker verifies caller token offline (JWKS) | n/a | #2 spec section 3 |

**Auth flow (caller to worker):** SDK token -> `Authorization: Bearer` -> template verifies (signature, type, expiry, optional client-id allowlist) -> route handler -> `ALLOWED_FILES`/asset-host checks -> outbound call. **Auth flow (worker to Figma):** `X-Figma-Token` injected by the `proxy` helper from the secret; the caller's IMS token is never forwarded; the Figma token is never returned, logged or sent to the image host.

**Figma-specific unknowns** [OPEN, resolved in the sandbox, manual steps MF2 to MF6]: whether `components` includes metadata for remote library components; the exact branch-URL form; z-order of `children` in free-position frames; whether the image host sends CORS headers (decides nothing, the worker relays anyway); the exact current image host(s); the real Starter-plan limit; response size and latency of the nodes endpoint for large frames; whether `node-id` hyphens are always converted to colons for the API (the REST docs show colon ids, e.g. `ids=1:2`; the browser URL uses `node-id=1-2`) [ASSUMPTION: the hyphen-to-colon rule is common practice and not stated on the pages I read].

## 4. Data contracts

All contracts are behaviour contracts, not code.

### 4.1 Worker routes (all behind the template pipeline; no unauthenticated route except the `OPTIONS` preflight, so a bare request returns `401`, which is also the deployed liveness check)

| Route (conceptual) | Request | Success | Errors (beyond the template's) |
|---|---|---|---|
| `POST /figma/frame` | `{ url }` or `{ fileKey, nodeId, version? }` | `200`, Figma's file-nodes JSON **unchanged**; response headers `x-figma-file-key`, `x-figma-node-id` echo the parsed ids | `400 bad_request` (bad URL, wrong host/path kind, FigJam/Slides/Make, missing `node-id`); `403 forbidden` (file not on `ALLOWED_FILES`); `404 figma_not_found`; `502 figma_forbidden`; `413 payload_too_large` (body over cap); `429 rate_limited` |
| `POST /figma/renders` | `{ fileKey, version?, ids[], format, scale }` | `200 { images: { id: url or null } }` | same plus `400` for ids over cap, bad format/scale |
| `POST /figma/fills` | `{ fileKey }` | `200 { images: { imageRef: url } }` (normalised from either Figma wrapper) | same |
| `POST /figma/asset` | `{ url }` | `200` bytes, `Content-Type` from upstream, `Cache-Control: no-store` | `400` (non-https, host not allowlisted, redirect), `413` (over cap), `415`-style `bad_request` (type not allowed), `502 upstream_unavailable` (expired link or upstream error) |

Rate-limit errors carry `Retry-After` (uncapped) and a small `details` object `{ planTier, limitType }` so the UI can explain monthly vs per-minute limits (template question 15, 17).

**Worker configuration (non-secret `vars`):** `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS` (as #2); `FIGMA_API_ORIGIN` (default `https://api.figma.com`; local/test override); `ALLOWED_FILES` (comma list of file keys; empty = deny all); `FIGMA_ASSET_HOSTS` (default the S3 host above); `MAX_FRAME_BYTES` (default 25 MB), `MAX_ASSET_BYTES` (default 20 MB), `MAX_RENDER_IDS` (default 50) [ASSUMPTION: defaults]. **Secret (`secrets.required`):** `FIGMA_TOKEN`.

### 4.2 Mapping profile (saved JSON in DA; versioned)

| Field | Meaning |
|---|---|
| `version`, `name`, `author`, `updated` | schema version (integer), profile name, last saver email, ISO time |
| `sections` | `{ mode: per-top-level-child | single | split-at, splitAt?: layer glob }` |
| `rules[]` (ordered) | block rules, below |
| `text` | `{ rules: [{ match: { styleName?: glob, fontSizeMin?, fontWeightMin? }, tag: h1..h6|p }], fallbackTag }`, `{ lists: bool, richText: bool }` |
| `images` | `{ fillSource: fill|render, vectorFormat: svg|png, scale, alt: layer-name|empty }` |
| `ignore[]` | layer-name globs ignored explicitly (counted as `ignored-by-rule`) |
| `flagUnmatchedInstances` | bool: report instances that matched no rule as `unmapped` even when their text was placed as default content |
| `metadata` | `{ title: frame-name|fixed value|none, extra?: [{key, value}] }` |
| `target` | `{ defaultFolder }` (default `/drafts/figma`) |

**Block rule:** `id`, `enabled`, `match` { `component` glob, `componentSet` glob, `layer` glob, `nodeType`, `within` glob }, `block` { `name`, `variants`: fixed list and/or `[{ property, map }]` from component properties }, `content`: either `rows` (`[[cell,...],...]`) or `repeat` { `select`, `columns: [cell,...]` }, optional `required` flags per cell.
**Cell:** `select` { `layer` glob, `within` glob, `type`, `component`, `nth`, `all` }, `extract` ∈ `text` | `richText` | `image` | `link` | `fixed`, plus `value` for fixed and `join` for multiple matches.

### 4.3 Engine in/out

- **In:** `{ frame: Figma file-nodes response, nodeId }`, `profile`, optional `assets` (resolved bytes/URLs by asset key).
- **Out:** `model` (sections -> items: `block{name,variants,rows}` | `heading` | `paragraph` | `list` | `image` | `metadata`), `html` (DA body fragment, with asset placeholders until Create), `assetPlan[]` (`{key, kind: fill|render, nodeId|imageRef, format, scale, name}`), `coverage` (`dispositions` counts, `items[]` of unmapped and info findings with node id, path, kind, text/thumbnail ref, suggested fix), `warnings[]`.
- **Invariant:** sum of disposition counts equals the number of nodes in the tree.

### 4.4 Document written to DA

Body fragment as in Decision 26; assets in `{parent}/.{docname}/<deterministic name>.<ext>`; image `src` = the upload response's absolute `contentUrl`; `metadata` block last.

## 5. Folder layout (proposed; fits the #1/#2 convention)

```
apps/figma-to-page/
├─ SPEC.md                         this file
├─ README.md                       positioning, setup, apps-sheet row, site config read (none), worker vars/secret, token/seat guidance, limits
├─ figma-to-page.html              entry page: SDK <script type=module> + app script
├─ figma-to-page.js                bootstrap (awaits SDK, wires ports into the UI)
├─ figma-to-page.css
├─ lib/                            side-effect-free modules: figma-url, normalise, rules (match/extract), text, images, coverage, serialise, profile (schema/migrate), create (executor), ports (worker client, DA client)
├─ ui/                             render layer(s): stepper, rules editor, preview, report (state in, DOM out)
├─ test/unit/  test/e2e/  test/fixtures/   (fixture builder, recorded frames, fake Figma, fake image host, fake DA support)
└─ worker/                         wrangler config, entry (routes), .dev.vars.example, README, test/ ; imports the core from shared/worker-template
```
Names are the implementer's call; the split (pure logic vs UI render vs bootstrap) is the point.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Mapping fidelity is the product.** Loose designs without component discipline convert poorly. Block rules cover the common design-system case; everything else becomes default content plus an honest report. Rank 18 of 18, effort 5/5, overlap 4/5 per the ticket. | High (product risk) | Coverage report, overlay and detected-components list are v1 features; README sets expectations; sandbox file includes a "loose frame" fixture to measure; owner go/no-go on scope (Open Question 7). |
| R2 | **Figma rate limits** (20/month for View/Collab, per-minute caps otherwise; Starter ambiguity). | High operational | Full/Dev seat requirement in README; 2+1 call budget; no polling; session caching; `429` UX with `Retry-After`; confirm limits in sandbox (MF6). |
| R3 | **Shared static token reads every file its owner can see.** Any Adobe user passes IMS offline verification (#2 R3). | High | Mandatory `ALLOWED_FILES`; plan access token with a resource allowlist if available; client-id allowlist from the template; optional DA-permission gate is Open Question 2. |
| R4 | **Adobe outside-activity / IP policy** and Figma Developer Terms for an Adobe-adjacent personal project reading designs through a personal Cloudflare account. Carried from #1 R1 and #2 R1. | High for publishing | [OPEN] README note only; owner decides token owner and accounts; the spec makes no legal claim. |
| R5 | **Figma image host and link behaviour** (current host, public links, expiry, CORS). | Medium | Host allowlist is configuration; worker relay; test the real host in MF3; fake host in tests; links never stored. |
| R6 | **Large frames:** response size/latency of the nodes endpoint and Workers Free 10 ms CPU for relay + redaction scan of multi-MB bodies. | Medium | Byte cap and `413` with "select a smaller frame"; template redaction exemption for relayed bodies (template question 14); measure in SM tier; Paid plan is an owner decision. |
| R7 | **Reading order and component-metadata unknowns** (z-order, remote components, instance-swap, slots). | Medium | Reading-order rule + fixtures; matchable by layer name when metadata is missing; sandbox file exercises remote library components (MF4, MF5). |
| R8 | **Figma API drift** (docs vs OpenAPI wrapper; beta node types like `TRANSFORM_GROUP`, `TEXT_PATH`). | Medium | Engine treats unknown node types as `unmapped` with their type, not an error; fills wrapper accepted in both shapes; recorded real-response fixture refreshed manually. |
| R9 | **DA unknowns shared with Migration Assistant:** dot-folder semantics, JSON storage, write origin for Helix 6, upload size ceilings. | Medium | Sandbox verification before building the profile store; one shared decision. |
| R10 | **Image markup rules** (absolute `contentUrl`, dot-folder, silent failure of non-`data` form field, SVG 40 KB cap, GIF no variants) from the `da-content` skill not independently re-verified. | Medium | Manual M-step creates a page with each asset kind and previews it in EW (MF8); keep decisions overridable in the profile (`images`). |
| R11 | **Alt text and accessibility:** Figma has no alt text. | Low-Med | Layer-name heuristic, empty when auto-generated, always reported (story 52). |
| R12 | **Doc-only formatting loss** (colour, case, underline) and `NODE` hyperlinks. | Low | Info-level findings; README lists what is not converted. |
| R13 | **Template gaps** (Retry-After cap, body-redaction exemption, error codes, per-route timeout, optional secrets). | Medium | Five template questions (14 to 18); if refused, the extension implements them locally in its worker. |
| R14 | **Overlap with the EW assistant / Adobe's Figma skill.** | Medium | Differentiate (Decision 41); owner decides whether to proceed or to deliver a thinner "Figma frame to profile-driven draft" slice. |

## 7. Ordered build plan (sized to #38's acceptance criteria)

Sizes: S = under a day, M = a day or two, L = several days.

0. **Prerequisites (owner), all blocking:** #1 and #2 merged (hello-world pattern, worker template, CI); Cloudflare account and `wrangler login`; a **Figma sandbox**: an account on a paid plan with a Full or Dev seat (or an Organization plan for a plan access token), a test file with the fixture frames listed in the Testing Requirements, the token with `file_content:read` only; decisions on Open Questions 1 to 4. (S, owner)
1. **Sandbox recording and DA verification (S).** Record real Figma responses (scrubbed) for the fixture frames; run the shared-with-Migration-Assistant DA checks (dot-folder JSON store, list, upload of each image type, contentUrl form). Settles R5, R7, R9, R10. No product code. AC1, AC2, AC3 de-risked.
2. **Fixture builder and fakes (M):** Figma fixture builder, fake Figma API, fake image host, fake DA Admin support (shared if one exists). First test: the builder's output satisfies the shape guards.
3. **URL parser and worker routes, test-first (M).** `figma-url` parsing (FU*), then worker `frame`/`renders`/`fills`/`asset` (WF*): validation, allowlists, error mapping, caps, secret hygiene. Scaffold `worker/` from the template. AC1, AC7.
4. **Normaliser and rule matcher, test-first (M).** Visible-only tree, reading order, component identity, block rules with cells and repeat, first-match-wins, variants (FN*, FM*). AC2 (half).
5. **Default content, rich text, links, images plan, serialiser, test-first (M).** (FT*, FI*, FS*). AC3 (document generation).
6. **Coverage accounting and Create gate (M).** Dispositions, invariant, unmapped report, suggestions (FC*). AC2 (other half).
7. **Profile schema, migration and store (M).** Starter profile, list/save/duplicate/rename/delete/export/import, error paths (FR*). AC2 ("saved per site").
8. **Create executor (M).** Asset pipeline through the worker client, upload to dot-folder, document last, failure policy, overwrite confirm, cancel (FX*). AC3.
9. **UI render layers and bootstrap (L).** Stepper, frame outline, rules editor with detected components and live counts, preview panes, reference render overlay, report, Create panel; standard EW states (FV*). AC1, AC2, AC3.
10. **Worker deploy wiring, README, apps-sheet row, root README row (S).** AC4, AC5, AC7.
11. **Playwright e2e against the real local worker with the fake Figma (M)** (E2E*). AC1, AC3, AC6, AC7.
12. **Repo checks and CI (S):** S3 additions, `worker-unit`/`worker-smoke`/`e2e` coverage for this extension (UR*). AC4, AC5, AC8.
13. **Deploy and manual verification in real EW (M, owner login needed):** MF0 to MF13. AC1, AC3, AC5, AC6, AC7.
14. **Hand-off:** record observed Figma facts (image hosts, limits, remote components, branch URLs) in the README; list template change requests for the template owner.

---

# Testing Requirements

## 1. Engine and app unit tests (seam F1, WTR; S2 for UI)

**Fixtures/mocks (shared by every test below).**
- **Fixture builder:** `frame(...)`-style helper that produces Figma-shaped node trees with only documented properties (types `FRAME`, `GROUP`, `SECTION`, `INSTANCE`, `COMPONENT`, `TEXT`, `RECTANGLE`, `VECTOR`, `BOOLEAN_OPERATION`, ...), the `components`, `componentSets` and `styles` maps, `visible`, `fills` with `IMAGE` paints and `imageRef`, `lineTypes`, `characterStyleOverrides`/`styleOverrideTable`, `hyperlink`, `interactions`, `layoutMode`, `absoluteBoundingBox`.
- **Named fixture frames:** `designSystemPage` (Header, Hero with variant `Theme=Dark`, three Cards, Columns, Footer instances: the happy path); `looseFrame` (ungrouped layers, no components: stresses default content); `hiddenAndIgnored` (invisible layers, `ignore`-pattern layers, redline annotations); `textHeavy` (heading/paragraph styles, ordered and unordered lists with nesting, bold/italic/hyperlink overrides, `NODE` hyperlink, `javascript:` link); `imagesMixed` (image fill, cropped fill, vector icon set, over-cap-SVG case, `VIDEO` paint, node that renders `null`); `remoteComponents` (instances whose component is `remote: true`, one with no metadata); `freePosition` (non-auto-layout frame whose array is z-order, out of reading order); `nullNode` (response where `nodes[id]` is `null`); `unknownTypes` (`TEXT_PATH`, `TRANSFORM_GROUP`); a **scrubbed real recording** of at least `designSystemPage` and `remoteComponents` from the sandbox (contract test, see FN9).
- **Fake Figma** (behind the `figma` port): serves nodes/renders/fills from fixtures, pins `version`, enforces the canary token header, returns `403`, `404`, `429` (with `Retry-After`, `X-Figma-Plan-Tier`, `X-Figma-Rate-Limit-Type`), `400` for bad ids, `null` for unrenderable nodes, 500 on demand, and expiring image links.
- **Fake image host:** serves tiny valid PNG/JPEG/GIF/SVG bytes generated in the test (an over-40 KB SVG too), `403`/XML error body for an expired link, wrong content type, redirect, oversize.
- **Fake DA Admin** (behind `daFetch`): in-memory tree with source/list semantics, `201` responses with `editUrl`/`contentUrl`, existence checks, multipart `data` field requirement (other field names write nothing and return `200`), `.da-versions` -> `404`, `401`/`403`/`5xx` injection, per-file size cap.
- Injected `now`, `sleep`, `random`; console captured.

### 1.1 Frame URL parsing (AC1)

| ID | Behaviour asserted |
|---|---|
| FU1 | `https://www.figma.com/design/<key>/<name>?node-id=12-34` parses to file key `<key>` and node id `12:34`; also `figma.com` without `www`, `/file/` legacy path, `node-id=12%3A34`, extra query params (`t=`, `m=dev`), and a trailing fragment |
| FU2 | Branch form `.../design/<fileKey>/branch/<branchKey>/<name>` uses `<branchKey>` as the key to fetch [ASSUMPTION on URL form, VERIFIED on API accepting branch keys] |
| FU3 | Missing `node-id` -> "link to a frame, not the file" guidance (no network call) |
| FU4 | FigJam `/board/`, `/slides/`, `/make/` and unknown paths -> specific unsupported-type messages |
| FU5 | Non-figma hosts, `figma.com.evil.com`, `http://`, userinfo URLs, non-URLs -> rejected without a request |
| FU6 | File key or node id containing path or query characters is rejected (no injection into the API URL) |

### 1.2 Normalisation and component identity

| ID | Behaviour asserted |
|---|---|
| FN1 | `visible: false` nodes are removed with their subtree and counted as `hidden`; invisible paints do not make a node an image |
| FN2 | Auto-layout frame children keep array order; `freePosition` children are ordered top-to-bottom, left-to-right with the row tolerance [ASSUMPTION on Figma z-order, confirmed by MF4] |
| FN3 | An instance resolves to its component name and set name through `components`/`componentSets`; the `remote` flag is carried |
| FN4 | An instance with no metadata is still matchable by layer name and is reported (info) |
| FN5 | `nodes[id] === null` -> "frame not found in file" (not an exception) |
| FN6 | Unknown node types (`TEXT_PATH`, `TRANSFORM_GROUP`, future types) never throw; their content is `unmapped` with the type |
| FN7 | Deeply nested and very wide trees (10,000 nodes) normalise within a documented time/stack budget (no recursion overflow) |
| FN8 | Same input twice produces identical output (determinism) |
| FN9 | **Contract test:** the scrubbed real recordings normalise with zero `unknown`/shape warnings; the test fails loudly when a Figma response gains a shape the engine does not understand (guards R8) |

### 1.3 Rule matching and cells (AC2)

| ID | Behaviour asserted |
|---|---|
| FM1 | A rule matching component name `Hero` turns each Hero instance into one block named per the rule and claims its subtree (descendants are not emitted as default content) |
| FM2 | Matching by component-set name, layer-name glob, node type and ancestor path glob each work; AND within a rule |
| FM3 | First matching rule wins in listed order; reordering changes the result; a disabled rule never matches |
| FM4 | Fixed `rows` of cells: each cell selects a descendant by layer name/type/nth and extracts text, rich text, image, link or fixed text |
| FM5 | `repeat`: three Card instances under a `Cards` frame become one `cards` block with three rows built from one column template |
| FM6 | Variants from component properties (`Theme=Dark` -> `hero dark`) via the map; unmapped property values are reported; fixed variants always apply |
| FM7 | A required cell with no match is reported; the block is still emitted with an empty cell |
| FM8 | Block names are normalised/validated (lower-case alphanumerics, single hyphens, no leading digit); invalid names are refused in the profile, not emitted |
| FM9 | Two rules claiming the same node: only the first claims it; the second's zero-match is reported |
| FM10 | A cell selector matching nothing across the whole frame is flagged in the rule's live match counts |
| FM11 | Nested blocks (a matched instance inside a matched instance) follow the documented rule (outer claims) and are reported |
| FM12 | Sections: `per-top-level-child`, `single` and `split-at` produce the expected section boundaries; blocks stay in their top-level child's section |
| FM13 | `metadata` block: title from the frame name or fixed value; omitted when set to none |

### 1.4 Default content: text, lists, rich text, links

| ID | Behaviour asserted |
|---|---|
| FT1 | Text rules by style name, font size and weight map to `h1`..`h6`; unmatched text is `p`; first rule wins |
| FT2 | `ORDERED`/`UNORDERED` lines become `ol`/`ul` with nesting from `lineIndentations`; mixed lines split into separate lists |
| FT3 | Overrides produce `strong`/`em`/`a`; adjacent identical runs merge; formatting not converted (colour, case, underline) yields one info finding per node, not per character |
| FT4 | Link precedence: text hyperlink `URL`, then first `OpenURLAction` on the layer or nearest ancestor inside the block; `NODE` hyperlinks are reported |
| FT5 | Link schemes: `http`, `https`, `mailto`, `tel`, root-relative are kept; `javascript:`, `data:`, `vbscript:` and others are dropped and reported |
| FT6 | Text containing `<script>`, `&`, quotes and emoji is escaped/preserved correctly in the serialised output |
| FT7 | Empty text layers produce nothing and are `decorative`/structural, not `unmapped` |
| FT8 | Multi-paragraph text (newlines vs paragraph separators) maps to paragraphs inside default content and to `br` inside a block cell |

### 1.5 Images and asset plan

| ID | Behaviour asserted |
|---|---|
| FI1 | A node with a visible `IMAGE` fill plans a **fill** asset by default; with `fillSource: render` plans a render; invisible image paints plan nothing |
| FI2 | Vector/composed layers matched by an image rule, an `icon/*` glob or export settings plan **render** assets; others are `unmapped` with a suggested image rule |
| FI3 | Assets are grouped by (format, scale) so the worker client sees one renders call per group and ids are chunked at the cap |
| FI4 | Asset names are deterministic and unique (frame slug + node id; fills by `imageRef` prefix); extension comes from the sniffed content type, not the requested format |
| FI5 | A `null` render is reported per node and the image is omitted; it is never retried as an error |
| FI6 | SVG over the 40 KB cap triggers a PNG @2x fallback and a finding; PNG/JPG over 20 MB is reported as a failure for that asset |
| FI7 | Alt text: meaningful layer name kept; auto-generated names (`Rectangle 12`, `Image`) give empty alt plus a finding; `alt: empty` forces empty |
| FI8 | Two nodes sharing one `imageRef` share one downloaded asset and one DA file |
| FI9 | `VIDEO`/`PATTERN` paints are `unmapped` with kind, not silently dropped |

### 1.6 Coverage accounting (AC2 core)

| ID | Behaviour asserted |
|---|---|
| FC1 | **Invariant:** on every fixture, the disposition counts sum to the node count of the tree |
| FC2 | `looseFrame`: all text lands as default content; vectors and unsupported nodes are `unmapped` with path, kind and a suggested fix |
| FC3 | Text inside a matched block that no cell picked up is `unmapped-in-block` with its text (truncated) and the rule id |
| FC4 | `ignore` globs yield `ignored-by-rule`, counted and listed; ignoring is visible, never silent |
| FC5 | Decorative shapes (solid/gradient, no content) are counted in aggregate, not listed one by one |
| FC6 | `flagUnmatchedInstances: true` reports instances that matched no rule even if their text was placed |
| FC7 | The report can be exported (copy/download) and contains node ids, paths and no tokens |
| FC8 | Create gate: with unmapped items the executor refuses to write until the acknowledgement flag is passed; with zero unmapped it does not ask |
| FC9 | Changing a rule changes the coverage deterministically and instantly (no network) |

### 1.7 Serialisation and sanitising

| ID | Behaviour asserted |
|---|---|
| FS1 | Output is a body fragment with `header`, `main`, `footer`; no `<html>`, `<head>`, `<script>`, `<style>`, inline `style=`, event-handler attributes, or `class`/`id` on default content |
| FS2 | Blocks are canonical div form: first class token is the block name, further tokens are variants; one `div` per row, one per cell |
| FS3 | Block cells contain only the allowed inline tags (`strong`, `em`, `a`, `code`, `br`); disallowed ones are normalised |
| FS4 | `metadata` block is exactly named `metadata` and last |
| FS5 | Hostile strings (`<img src=x onerror=...>`, `"><script>`, attribute-breaking quotes) in text, layer names and URLs come out escaped or dropped; a DOM parse of the output contains no script elements or event attributes |
| FS6 | Image elements carry only the final absolute DA content URL (or the preview placeholder before Create) and escaped alt |
| FS7 | Output is byte-identical across runs and independent of rule object key order |
| FS8 | A section with no content is omitted; a frame with no content produces a clear "nothing to convert" result |

### 1.8 Profile schema and store (AC2 "saved per site")

| ID | Behaviour asserted |
|---|---|
| FR1 | Starter profile is used (and marked unsaved) when the site has none; Save writes `.figma-to-page/profiles/<name>.json` via the DA port and reload returns an identical profile |
| FR2 | Two named profiles coexist; list/duplicate/rename/delete behave; a name with path characters is refused |
| FR3 | Schema validation reports precise paths for bad rules (invalid block name, unknown extract, bad glob) and refuses to save; raw-JSON edits round-trip |
| FR4 | Newer `version` -> refused with a message; older -> migrated in memory, saved as current only on explicit Save |
| FR5 | The saved file contains rules and settings only: no token, no Figma URL, no frame content (asserted by scanning for the canary token and the frame text) |
| FR6 | Save errors (`401`, `403`, `5xx`, synthetic `500`) surface in the UI with the profile kept dirty; no silent loss |
| FR7 | Last-write-wins is explicit: the saved file records author and timestamp; the UI warns when the stored `updated` is newer than the loaded one |
| FR8 | Export/import: exported file re-imports identically; importing a profile with a bad schema is refused with the validation paths |
| FR9 | The store never writes outside `.figma-to-page/`; the reserved `.da-versions` name is refused |

### 1.9 Create executor (AC3)

| ID | Behaviour asserted |
|---|---|
| FX1 | Happy path: assets fetched through the Figma port, uploaded to `{parent}/.{doc}/...`, then the document written **last**, referencing each image by the upload response's `contentUrl`; DA state matches |
| FX2 | Order: no document write before every required asset upload has succeeded |
| FX3 | A failing asset (`5xx`, expired link, wrong type, over cap) stops the document write, lists the failure and offers Retry; retrying only the failed asset succeeds without re-uploading the others |
| FX4 | "Continue without these images" writes the document with those `img` elements omitted and reports them |
| FX5 | Target path validation: uppercase, spaces, `..`, trailing `.html`, empty, `/`, over 900 characters are refused before any request |
| FX6 | Existing page: Create refuses until overwrite is confirmed; with confirmation it writes; the fake DA records the overwrite |
| FX7 | Unmapped items present: Create requires the acknowledgement (FC8) |
| FX8 | `401` mid-run pauses with "sign in again" and no retry loop; `429`/`5xx`/synthetic `500` retry up to 3 times with injected `sleep` |
| FX9 | Cancel mid-run reports what was written (images only) and writes no document |
| FX10 | Re-running Create to the same path overwrites the same asset names (no duplicates) |
| FX11 | The upload uses the multipart field name `data` and POST; a fake DA that ignores other field names proves it |
| FX12 | Concurrency cap respected (default 3) and one asset body in memory per slot |
| FX13 | The result exposes the editor link from the response (`editUrl`) and a note that preview/publish is separate |
| FX14 | The worker client sends `Authorization: Bearer <IMS token>` and never routes through `daFetch`; `daFetch` is used only for DA origin URLs |

### 1.10 UI render layer (seam S2)

| ID | Behaviour asserted |
|---|---|
| FV1 | Standalone state ("waiting for", then "not running inside Experience Workspace") as in hello-world; buttons disabled |
| FV2 | Frame step: URL error messages (FU3 to FU5) and Figma error messages per worker code (`figma_not_found`, `figma_forbidden`, `forbidden`, `rate_limited` with `Retry-After` and monthly-limit hint, `payload_too_large`, `upstream_unavailable`) are plain text with no stack trace |
| FV3 | Detected-components panel lists each component with instance count; "add rule" creates a pre-filled valid rule |
| FV4 | Rules editor: block-name validation message; reordering updates the preview; per-selector match counts; raw JSON tab errors |
| FV5 | Preview structure view shows blocks as labelled boxes with cells; the HTML tab shows the exact serialised output as text |
| FV6 | All Figma-derived strings (names, text, URLs, error text) render as text; `<img onerror>` in a layer name creates no element |
| FV7 | Coverage panel lists unmapped items with path, kind, text and fix; counts match the model; overlay boxes exist for unmapped nodes |
| FV8 | Create panel shows path validation, overwrite warning, unmapped acknowledgement, per-asset progress and results, retry, editor link |
| FV9 | The IMS token and the Figma token never appear in the DOM or console output (extends hello-world's rule) |
| FV10 | The worker origin is a constant: `?worker=https://evil.example` in the page URL is ignored (#2 HP5 behaviour) |

## 2. Worker tests (seam W1, `node:test`; template kit)

Template matrices UA/UC/UP/US (auth, CORS, retry, secrets) already run for the template; these add behaviour specific to this worker. Env factory: production-like `ALLOW_LOCALHOST=false`, `ALLOWED_FILES=file1,file2`, canary `FIGMA_TOKEN`.

| ID | Behaviour asserted |
|---|---|
| WF1 | No `Authorization` -> `401` on each of the four routes; the fake Figma and image host receive zero requests |
| WF2 | Valid token, file key not on `ALLOWED_FILES` -> `403 forbidden` and no outbound call; empty `ALLOWED_FILES` denies everything |
| WF3 | `frame`: valid URL -> exactly one Figma file-nodes call with `X-Figma-Token` = the canary, `ids` = the converted node id, no other headers from the caller; response body is Figma's JSON **byte-for-byte** |
| WF4 | `frame` with `{fileKey,nodeId,version}` pins `version` on the outbound call; bad node id/key characters -> `400` without any outbound call |
| WF5 | Bad URLs: non-figma host, `figma.com.evil.com`, FigJam/Slides/Make, missing `node-id` -> `400` with distinct messages; the worker never fetches a caller-supplied URL for these routes |
| WF6 | Figma `403` -> `502 figma_forbidden` generic message, operator log line without the token; Figma `404` -> `404 figma_not_found`; Figma `400` -> `400 bad_request` |
| WF7 | Figma `429` -> `429 rate_limited` with Figma's `Retry-After` **uncapped** (e.g. 86400) and `details` `{planTier,limitType}`; no worker-side wait; ACAO present so the browser can read it |
| WF8 | Figma `5xx` retried per template backoff then `502 upstream_unavailable` with no upstream text; `4xx` not retried |
| WF9 | Response over `MAX_FRAME_BYTES` -> `413 payload_too_large` while streaming (no full buffering); a normal large body streams through |
| WF10 | `renders`: ids chunk cap, format/scale validation (`0.01..4`; `png|jpg|svg`), one outbound call, `null` entries passed through, ids with path characters refused |
| WF11 | `fills`: both response wrappers (`{images}` and `{error,status,meta:{images}}`) normalise to the same output |
| WF12 | `asset`: allowed host -> bytes relayed with upstream content type and `no-store`; **no** `X-Figma-Token` sent to the image host; response is not redacted/corrupted (binary passthrough) |
| WF13 | `asset` refusals: `http`, non-allowlisted host, look-alike host (`figma-alpha-api.s3.us-west-2.amazonaws.com.evil.com`), IP literal, userinfo, port, redirect (`302` not followed), disallowed content type, over `MAX_ASSET_BYTES` -> clear errors, no second request |
| WF14 | Expired image link (`403`/XML) -> `502 upstream_unavailable` with a generic message |
| WF15 | Canary matrix: with the Figma fake echoing the canary in its error body/headers, the canary never appears in any response, header or log line across success and every error path (extends US1) |
| WF16 | Caller's IMS token never appears in outbound requests, responses or logs |
| WF17 | Disallowed origin with a valid token -> `403` before the route runs (extends UC7); allowed origins get ACAO on `200`, `400`, `401`, `403`, `404`, `413`, `429`, `502` |
| WF18 | Missing `FIGMA_TOKEN` -> `500 misconfigured` generic; deploy guard via `secrets.required` listing it |
| WF19 | `OPTIONS` preflight for each route from an allowed origin: `204`, no token needed, `Authorization, Content-Type` allowed, `Retry-After` and `x-request-id` exposed |
| WF20 | One structured log line per request: file key, node id, status, bytes, duration; never token, URL query, or content |
| WF21 | Local env (`ALLOW_LOCALHOST=true`, `FIGMA_API_ORIGIN=http://127.0.0.1:<port>`) works; production env refuses a non-https `FIGMA_API_ORIGIN` |
| WF22 | Config check: wrangler `vars` contain no secret-like names (`ALLOWED_FILES` passes UR3; `FIGMA_TOKEN` is only under `secrets.required`) |

## 3. End-to-end tests (seams S1 + real worker; Playwright, Chromium, hermetic)

Playwright starts the #1 static server on `:3000` and this extension's worker via wrangler on `:8787` (local env, `IMS_ORIGIN` to a throwaway fake-IMS key server, `FIGMA_API_ORIGIN` and the asset host to throwaway local fakes serving the fixture frames, secrets from a temp env file). The #1 SDK stub supplies a token signed by the test key. DA Admin is a fake served through `page.route` on the DA origin.

| ID | Behaviour asserted |
|---|---|
| E2E1 | Paste `designSystemPage` URL -> outline and reference render appear; network log shows only the page, SDK stub, worker, and fake DA (hermetic guard); preflight `204` then `200` (real cross-origin `localhost:3000 -> localhost:8787`) |
| E2E2 | Rules: add a rule from "Detected components", reorder, preview updates; Save writes the profile into the fake DA; reload restores it (AC2) |
| E2E3 | `looseFrame`: unmapped list visible, overlay boxes drawn; Create prompts for acknowledgement (AC2) |
| E2E4 | Create to `/drafts/figma/design-system-page`: fake DA contains the document and the images in the dot-folder; document references `contentUrl`s; image bytes equal the fixture bytes (AC3) |
| E2E5 | Existing page -> overwrite confirmation required; cancelling leaves DA unchanged |
| E2E6 | Token hygiene: neither the IMS token nor the Figma canary appears in page HTML, DOM text, storage, console or any network response; the same worker call without a token is `401` with CORS headers (AC7) |
| E2E7 | Figma `429` from the fake -> UI shows `Retry-After`/limit message and no retry loop; `403` -> operator-facing message; file not on `ALLOWED_FILES` -> plain refusal |
| E2E8 | Standalone (SDK never resolves): "not running inside Experience Workspace" and disabled controls |

## 4. Runtime smoke tier (seam W2, driving `wrangler dev` locally, no Cloudflare login)

| ID | Behaviour asserted |
|---|---|
| SMF1 | The worker bundles (shared core resolves) and starts; a bare request gets `401` |
| SMF2 | `frame` with a valid test token against the fake Figma: relayed body identical; wrong-key token -> `401` |
| SMF3 | `asset` streams a multi-MB fixture image through workerd without buffering errors; allowlist/redirect refusals hold over real HTTP |
| SMF4 | Canary secret absent from all responses (WF15 over real HTTP) |
| SMF5 | Records CPU/wall time and subrequest counts for `frame` with a 1 MB, 10 MB and 25 MB body against the 10 ms Free-plan CPU budget (informational; informs R6 and the Paid-plan decision) |

## 5. Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| UR-F1 | `apps/figma-to-page/` has an entry page named after the folder, a README, tests, and a `worker/` with wrangler config, README and test (#1 AC1/#2 UR1 rules apply) |
| UR-F2 | The root README extensions table has a `figma-to-page` row (`app`, folder, entry point, description) and the row resolves to the folder and entry page |
| UR-F3 | The folder's README documents the `apps` sheet row, states the site config read (none), and documents `FIGMA_TOKEN` (secret) and `ALLOWED_FILES` (var) |
| UR-F4 | No tracked `.dev.vars*`/`.env*`; no wrangler `vars` key that looks like a secret (`ALLOWED_FILES` allowed); `FIGMA_TOKEN` only under `secrets.required` and present in `.dev.vars.example` |
| UR-F5 | The extension imports nothing from other extensions; worker imports only from `shared/worker-template/` |

## 6. End-to-end checks inside real Experience Workspace (manual; needs interactive Adobe login, a Cloudflare account and a Figma sandbox)

**Accounts and credentials needed** (the owner provides; never paste a real token into chat, issues or logs; an IMS token and a Figma token are live credentials):
- GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, per #1) and the DA org/site with config-sheet access (#1 M0).
- Adobe IMS identity with write access to the DA site; Chrome.
- Cloudflare account with `wrangler login` (#2 W0).
- **Figma:** an account on a **paid plan with a Full or Dev seat** (Professional minimum; a seat cost) or, better, an Organization/Enterprise plan for a **plan access token** restricted to the test file; the token created with **only `file_content:read`**; a **test file** containing the fixture frames (design-system page with Hero/Cards/Columns components in a **published library** and a consuming file to exercise remote components, a loose frame, an images frame with a fill, a cropped fill and vector icons, a hidden-layer frame, a text/list/link frame). Do **not** use real Adobe/customer designs for the sandbox [OPEN: Open Question 1 on whose Figma account].
- Test values: `FIGMA_TOKEN` (secret), `ALLOWED_FILES` = the sandbox file key(s).

**Manual steps** (numbered like #1 M* and #2 W*; each records evidence in the PR):

- **MF0 (prerequisites):** #1 M0 passes; worker deployed from `apps/figma-to-page/worker/` with `wrangler secret put FIGMA_TOKEN` and `ALLOWED_FILES` set; `curl -i <worker>/figma/frame` returns `401` (liveness + AC7 negative). Note the `workers.dev` URL and set it as the extension's deployed-worker constant (normal PR).
- **MF1 (`ref=local`, AC1, AC6):** terminal A `npm start` (port 3000); terminal B worker dev (8787) with `FIGMA_API_ORIGIN` at the real Figma and the token in `.dev.vars`. Open `https://da.live/app/jazhou-adobe/ew-extensions/apps/figma-to-page/figma-to-page?ref=local`; accept the trust prompt; paste the design-system frame URL ("Copy link to selection" in Figma); outline and reference render appear.
- **MF2 (URL forms):** repeat with the legacy `/file/` link, a branch link (create a Figma branch), and a URL without `node-id` (expect guidance). Confirms FU1 to FU4 and the hyphen-to-colon conversion (R7 unknown).
- **MF3 (images, R5):** run Create on the images frame; in DevTools Network confirm the browser calls only the worker for image bytes; record the actual image host(s) Figma returned and update the default allowlist if it differs; note whether the host sends CORS headers.
- **MF4 (reading order, R7):** convert the free-position frame; verify the generated order matches the visual order; record Figma's `children` order behaviour in the README.
- **MF5 (components, R7):** convert the consuming file with remote library components; record whether `components` carries their names; verify rules by component name and by layer name both work.
- **MF6 (rate limits, R2):** with a Full/Dev seat run five conversions in a minute and observe `429` headers (`Retry-After`, `X-Figma-Plan-Tier`, `X-Figma-Rate-Limit-Type`) and the UI message; if a Starter-plan file is available, measure its real limit (resolves the docs inconsistency); verify the "one conversion costs 2 Tier-1 + 1 Tier-2" budget in the Figma usage view.
- **MF7 (mapping and coverage, AC2):** in Rules, add rules from "Detected components", save the profile, reload the page and confirm the rules persist; open the same site as a second user and confirm they load; convert the loose frame and verify the unmapped list and overlay; confirm Create requires the acknowledgement.
- **MF8 (create, AC3):** Create `/drafts/figma/test-page`; open the returned editor link in EW; check blocks render as expected in the editor, the images are in the `.test-page` dot-folder in the content browser, and **preview** the page (Preview in EW) to confirm images are ingested (no `about:error`); check one SVG, one PNG and one JPG, and the SVG-over-40 KB fallback. Resolves R10.
- **MF9 (token refresh, Decision 6):** keep the app open past the IMS token lifetime and start Create; observe the pause-and-sign-in behaviour and that no token is rendered.
- **MF10 (branch ref, AC6):** push branch `figma-to-page` (simple name), wait for code sync, open the same URL with `?ref=figma-to-page`; the page now calls the **deployed** worker; run MF1's flow; in DevTools record the page's actual `Origin` (answers #2 R2 for this extension).
- **MF11 (Apps menu, AC5):** add the `apps` sheet row in `https://da.live/config#/jazhou-adobe/ew-extensions/`; confirm the card appears at `https://da.live/apps#/jazhou-adobe/ew-extensions` and opens the app.
- **MF12 (security, AC7):** search Network responses, page source and DevTools Application storage for the Figma token value (none); `wrangler secret list` shows names only; `curl` with `Origin: https://evil.example` -> `403`; a request for a file key not on `ALLOWED_FILES` -> `403`; rotate the token with `wrangler secret put` and confirm the app keeps working without a code change.
- **MF13 (profile storage, R9):** in the DA content browser confirm `.figma-to-page/profiles/default.json` exists and is not reachable at `https://main--ew-extensions--jazhou-adobe.aem.live/.figma-to-page/...` (not published).

Record screenshots and notes in the PR description (the PR template asks for test URLs).

## 7. CI additions (no credentials, no Cloudflare login, no Figma token)

| Job | Steps | Notes |
|---|---|---|
| `unit` (existing) | WTR runs this extension's `test/unit` (FU, FN, FM, FT, FI, FC, FS, FR, FX, FV) | fetch guard blocks external URLs |
| `worker-unit` (from #2) | `node:test` runs `apps/figma-to-page/worker/test` (WF*) | every push and PR |
| `worker-smoke` (from #2) | SMF1 to SMF5 | may be advisory if flaky (#2 Open Question 11) |
| `e2e` (existing) | E2E1 to E2E8; starts the worker with fakes | Chromium only |
| `lint` (existing) | ESLint + Stylelint over the extension and worker; S3 UR-F1 to UR-F5 | |

No Figma credential anywhere in CI; the scrubbed real recordings are committed fixtures. A nightly "live Figma canary" job is possible later (needs a repo secret and a rate-limit budget) and is deliberately not built [OPEN, Open Question 13].

## 8. Acceptance-criteria traceability (ticket #38)

| # | Acceptance criterion (#38) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Admin pastes a Figma frame URL; the worker fetches the node tree and image exports with a server-held Figma token | FU1 to FU6 (URL forms); WF3, WF4, WF10 to WF12 (frame, renders, fills with the secret injected server-side); FN5; FX1 (assets fetched through the worker); E2E1, E2E4; SMF2, SMF3 | **MF1** (real frame in EW), **MF2** (URL forms), **MF3** (images via worker), **MF6** (limits), MF0 |
| AC2 | Mapping rules are editable and saved per site; unmapped layers are reported, not silently dropped | FM1 to FM13 (rules, cells, repeat, variants, validation); FR1 to FR9 (store per site, lifecycle, no secrets in file); FC1 to FC9 (disposition invariant, unmapped and unmapped-in-block reports, ignore visibility, Create gate); FV3 to FV7; E2E2, E2E3 | **MF7** (persist, share across users, unmapped overlay, acknowledgement), **MF13** (profile file location and non-publication) |
| AC3 | Preview shows the generated document; Create writes it and its images into DA at a chosen path | FS1 to FS8 (document markup); FV5 (preview); FI1 to FI9 (asset plan); FX1 to FX14 (assets then document, failure policy, overwrite, path validation, cancel); E2E4, E2E5 | **MF8** (document and images in EW, editor link, preview ingests images, SVG/PNG/JPG, fallback), MF9 |
| AC4 | All code in its own self-contained `figma-to-page` folder with a README covering setup, the config-sheet row and site config read | UR-F1, UR-F3, UR-F5 (structure, README sections, no cross-extension imports) | **Review:** README sections (setup incl. Figma token/seat/expiry, `apps` row, site config read = none, worker vars/secrets, limits, positioning); walk the README on a clean clone once |
| AC5 | Listed in the repo README extensions table and reachable from the EW Apps menu | UR-F2 (row resolves to folder and entry page) | **MF11** (card on `https://da.live/apps#/{org}/{site}` opens the app) |
| AC6 | Works in EW with `ref=local` and with a branch ref | S1/e2e prove the page and worker flow under the stub; WF21, WF17 (local vs production origin rules) | **MF1** (`ref=local`), **MF10** (branch ref against the deployed worker; observed `Origin` recorded) |
| AC7 | Vendor credentials only in this extension's worker (from the shared template); the browser never receives them; unauthenticated calls are rejected | WF1 (401 on all routes), WF15, WF16 (canary and IMS token never leak), WF17, WF18, WF22; FR5, FV9; E2E6; SMF1, SMF4; UR-F4 | **MF0** (bare `curl` -> `401`), **MF12** (token not in responses/source/storage, `Origin` and allowlist negatives, rotation) |
| AC8 | Core logic covered by unit tests; lint and CI green | Sections 1 and 2 (engine, store, executor, worker) run by `npm test`/`test:worker`; CI jobs in section 7 | **Review:** CI shows the jobs green on the PR; deliberately break a rule on a scratch branch (for example loosen the file allowlist, or make the engine drop an unmapped node) and see WF2/FC1 fail |

Every acceptance criterion on #38 maps to at least one automated test or a numbered manual verification step above.

## 9. Open questions for the owner

1. **Figma account, token and seat (R2, R4).** Whose Figma account owns the token: a dedicated personal account on a paid plan with a Full/Dev seat, or an Adobe-provided Organization/Enterprise plan (plan access token, resource allowlist)? Using an Adobe Figma plan or Adobe design files for a personal-account project is an Adobe outside-activity/IP question and a Figma Developer Terms question (not reviewed here: https://www.figma.com/developer-terms/ [OPEN]). Is a paid seat acceptable for the sandbox?
2. **Who may read which designs (R3).** Is a mandatory `ALLOWED_FILES` allowlist (deny-all by default) acceptable? Should the worker additionally require DA write permission on the site (a call to DA with the caller's token, like the Chat Approvals spec) so only admins can convert, at the cost of forwarding the token to the DA host?
3. **Profile storage (R9).** Confirm the profile lives in `.figma-to-page/profiles/` under the site's DA content, shares the dot-folder convention with Migration Assistant, and that the sandbox verification (JSON stored verbatim, not published, listable) is done once for both.
4. **Image placement and policy (R10).** Per-document dot-folder (`.docname/`) as EW does, or a shared `/media/figma/` folder? Fill (original bytes) vs render (what Figma draws) as the default for image layers? Alt text from layer names acceptable?
5. **Section default.** Is "one section per top-level child" the right default, or one section with all blocks?
6. **Block-name source.** Free-text block names validated by EDS naming rules in v1 (this spec), or read the site's block library for suggestions now? (The latter makes the app read a site config.)
7. **Go/no-go and scope (R1, R14).** The ticket scores this 18 of 18 with effort 5/5 and overlap 4/5. Proceed with the full scope (rules editor + coverage + overlay), or build a thinner slice first (default profile, preview, coverage report, Create; rule editing as raw JSON)? Does the overlap with the EW assistant and Adobe's Figma-to-Content-Fragment skill change the decision?
8. **One frame per run.** Confirm multiple frames, whole-file import and multi-breakpoint pairs are out of scope, and that a URL without `node-id` is simply rejected with guidance (no frame picker).
9. **Image delivery path (R5).** Confirm the worker relays image bytes (this spec) rather than the browser fetching Figma's image links directly (depends on the unverified CORS behaviour, MF3), and that public image links never leaving memory is acceptable.
10. **Cloudflare plan (R6).** Is the Workers Free plan (10 ms CPU) acceptable for relaying multi-MB node trees, or should this worker run on Paid (decided after SMF5)?
11. **Frame size cap.** Is rejecting frames over about 25 MB of JSON ("select a smaller frame") acceptable for v1?
12. **Overwrite behaviour.** Confirm Create must never overwrite silently (explicit confirm), with DA versioning relied on for recovery.
13. **Live Figma canary.** Do you want a later nightly job with a real read-only token to detect Figma API drift (needs a GitHub secret and a rate-limit budget)?
14. **Template request: body-redaction exemption.** The template redacts secrets in every response body; relayed node trees (multi-MB) and image bytes need a documented exemption (or a streaming-safe redaction) for passthrough routes. Accept, or implement locally in this worker?
15. **Template request: `Retry-After` for `429`.** The template caps `Retry-After` for its own wait (UP5); this extension needs the upstream value passed to the caller **uncapped**, and a way to attach `{planTier, limitType}`. Accept as a template feature?
16. **Template request: extra error codes.** `figma_forbidden` (502) and `figma_not_found` (404) extend the closed set in #2 Decision 9. Accept a documented extension point?
17. **Template request: per-route retry/timeout overrides.** The Figma routes need "retry `5xx` only, never wait out `429`, per-attempt timeout 30 s, body cap 25 MB". Confirm these are per-route options of `proxy`.
18. **Template request: optional/loopback upstream origin.** `FIGMA_API_ORIGIN` as a variable (https only in production, loopback `http` in the local env) matches #2 UP11; confirm it is acceptable as a per-extension variable and does not need a template feature.
19. **Shared fake DA Admin.** Migration Assistant and Deep Clone will also need a fake DA Admin. Should one shared test-support implementation be built first and reused, so the three extensions do not diverge?
20. **Licence and publishing.** Inherited from #1 (licence choice, outside-activity policy, no known third-party marketplace): no decision needed here beyond those tickets.
