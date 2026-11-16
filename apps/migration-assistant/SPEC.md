# Spec: Migration Assistant (fullscreen app + per-extension worker)

Ticket: jazhou-adobe/ew-extensions#12 (this spec: #50). Blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). Neither is built yet; everything here that "reuses" them presumes their specs as written.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Cloudflare.

Primary sources read (all 2026-11-16):
- EW app SDK docs: https://www.aem.live/docs/ew/developing/apps-plugins. SDK source: https://da.live/nx/utils/sdk.js and https://github.com/adobe/da-nx/blob/main/nx/utils/daFetch.js.
- DA Admin API docs: https://docs.da.live/developers/api/source and https://docs.da.live/developers/api/list. DA Admin behaviour that docs omit (paging, silent success, lower-casing, size caps) is taken from the Deep Clone spec `apps/deep-clone/SPEC.md`, which read `adobe/da-admin` source; I did **not** re-read `da-admin` for this spec [VERIFIED second-hand].
- Existing import tooling (the overlap the ticket flags): AEM Importer https://www.aem.live/developer/importer and https://github.com/adobe/helix-importer-ui/blob/main/importer-guidelines.md; EW's first-party import app https://www.aem.live/docs/ew/administering/import, https://www.aem.live/docs/ew/administering/restore-from-aem, and its source https://github.com/adobe/da-nx/blob/main/nx/blocks/importer/index.js.
- DA/EDS content rules (document skeleton, block markup, media, silent failures): Adobe's `da-content` skill, https://github.com/adobe/skills/tree/main/plugins/aem/edge-delivery-services/skills/da-content (read through the SkillHub mirror https://www.skillhub.club/skills/adobe-skills-da-content; its claims are tagged `[verified]`/`[assumed]` by its authors, I did not re-verify them empirically). Block/section model: https://www.aem.live/developer/markup-sections-blocks.
- Limits: https://www.aem.live/docs/limits (path chars, 900-char path, per-file caps, 200 req/s per IP per host); Cloudflare https://developers.cloudflare.com/workers/platform/limits/ (Free: 10 ms CPU, 50 subrequests; Paid: 5 min CPU, 10,000 subrequests).
- Sitemap format: https://www.sitemaps.org/protocol.html (50,000 URLs / 50 MB per file; index files; gzip). Robots: https://www.rfc-editor.org/rfc/rfc9309.html.
- Upstream conventions: https://github.com/adobe-rnd/ew-extensions. The upstream tree has no importer, migration or worker code (GitHub tree API, 2026-11-16), so there is no upstream prior art for this extension, only for conventions.

Vocabulary (follows #1/#2/Deep Clone): *extension* = one folder `apps/<name>/`; *worker* = the per-extension backend in `apps/<name>/worker/`; *template* = `shared/worker-template/`; *IMS token* = the token the DA App SDK hands the extension. New terms: **source site** (the site being migrated), **source page** (one fetched URL), **crawl set** (the URLs selected to migrate), **profile** (the saved mapping rules for one source site into one target site), **page type** (a rule group that recognises a kind of source page), **block rule** (turns source elements into one EW block), **target root** (the DA folder chosen for the import), **import manifest** (record of what an import wrote, used for idempotency), **run** (one execution of an import), **relay** (the worker's fetch-on-behalf-of-the-browser routes).

---

## Problem Statement

A presales engineer, solution consultant or site-migration lead is asked to show, or actually perform, "move this existing website into Experience Workspace". The source is usually not an Adobe site and could be any CMS. Today the options are:

- **Copy/paste page by page** into DA. Accurate but unscalable, and every page re-decides which block a piece of content becomes.
- **The AEM Importer** (`aem import`, https://www.aem.live/developer/importer): powerful, but it is a developer tool. It needs a local checkout of a code project, a hand-written `import.js` transformation file, a Chrome-only local proxy UI, and it saves files to a local disk folder that must then be uploaded to DA. Its mapping logic is code, not something a non-developer can adjust while looking at the result. [VERIFIED from the importer docs.]
- **EW's own Import app** (https://da.live/apps/import): it moves content that is already on Edge Delivery Services (query index or URL list) into DA and has no concept of mapping a foreign page structure to blocks. Its source shows it fetches `.md` renditions of `aem.live` pages through a CORS proxy, converts them and saves them to DA. [VERIFIED: docs and `nx/blocks/importer/index.js`.]

The hard and valuable part of any migration is the **content-model-to-block mapping**: "this `div.hero` is the Hero block, its `h1` and `img` are cell 1 and cell 2, `.article-body` is default content, `.related` becomes a Cards block, and the `<title>` and `og:image` become page metadata". That mapping is per source site and has to be iterated with the result in front of you. Nothing available lets an author iterate on it inside EW. Browsers also cannot fetch arbitrary source pages themselves (CORS), and a source site may sit behind a credential that must not reach the browser.

## Solution

A fullscreen EW app, **Migration Assistant**, reachable from the EW Apps menu, backed by a small per-extension worker. The admin works through six stages on one page:

1. **Source.** Enter a sitemap URL, a site origin (the app finds `robots.txt` sitemaps), or paste a list of URLs. Apply include/exclude filters and a page cap.
2. **Crawl.** The worker fetches the pages on the browser's behalf (no CORS limits). The app shows live progress and lists every failure (404, redirect off-site, timeout, too large, blocked) with its reason.
3. **Rules.** Edit the **mapping profile**: page types, CSS-selector and field-to-cell rules that turn source markup into EW blocks, default content, sections and page metadata, plus path and link rules. The profile is **saved per site** in the target site's DA content, so it is shared by everyone who can open the app on that site, and can be exported and imported as a file.
4. **Preview.** For any crawled page, see the source page and the mapped EW document side by side, before anything is imported, with selector match counts and a list of source text that the rules dropped.
5. **Import.** Choose a target folder in DA and run. Media and documents are written to DA with the user's own rights. Re-running is **idempotent**: unchanged pages are reported unchanged, changed rules update pages, and pages an author edited in DA since the last import are not overwritten unless asked.
6. **Report.** A per-page and per-media result list that can be exported (including a source-URL to target-path CSV usable for redirects), with retry-failed.

The first source adapter is generic HTML, so it works for any CMS. The mapping engine is a pure browser module (the worker never maps HTML), so preview is instant while editing rules. The worker is a thin, authenticated, SSRF-hardened fetch relay built from the shared worker template; it is also the only place a credential for a protected source site can live.

## User Stories

Migration lead / presales engineer (primary actor):

1. As a migration lead, I want to paste a sitemap URL, so that the app lists every page of the source site without me typing URLs.
2. As a migration lead, I want to enter just the site origin and have the app find the sitemaps from `robots.txt`, so that I do not need to know where the sitemap lives.
3. As a migration lead, I want sitemap indexes (a sitemap of sitemaps) and gzipped sitemaps followed automatically, so that large sites work.
4. As a migration lead, I want to paste a plain list of URLs (one per line), so that I can migrate sites that have no sitemap or only a subset of pages.
5. As a migration lead, I want include and exclude path patterns and a maximum page count, so that I migrate a section first and never accidentally crawl 50,000 pages.
6. As a migration lead, I want URLs from other hosts rejected or flagged, so that a stray sitemap entry does not make the app fetch third-party sites.
7. As a migration lead, I want the app to deduplicate and normalise URLs (fragment dropped, trailing slash, default ports, tracking parameters optionally stripped), so that one page is not imported twice.
8. As a migration lead, I want to see crawl progress (fetched / total, failures so far, current rate) while it runs, so that I know the tool is alive.
9. As a migration lead, I want every failed URL listed with a plain reason (404, 5xx, timeout, redirect to another host, not HTML, too large, blocked by the worker), so that I know what to fix or exclude.
10. As a migration lead, I want to cancel a crawl and keep the pages already fetched, so that a slow site does not trap me.
11. As a migration lead, I want redirects followed and the final URL recorded, so that renamed pages are imported once under their real address and I can generate redirects later.
12. As a migration lead, I want to attest that I am allowed to copy this content before the first fetch, so that the tool is not used blindly as a scraper.
13. As a migration lead, I want to import from a source site that sits behind basic or header-token protection without ever seeing or typing the credential into the browser, so that staging sources can be migrated safely.
14. As a migration lead, I want to define page types ("Article", "Product", "Landing") by URL pattern, by the presence of a CSS selector, or by a `<meta>` value, so that different page layouts get different mappings.
15. As a migration lead, I want the first matching page type to win and a default type to catch the rest, so that every page maps deterministically.
16. As a migration lead, I want to say which element is the main content root and which elements to remove (header, footer, cookie banners, nav), so that only the real content migrates.
17. As a migration lead, I want to turn source elements into a named block by CSS selector (for example `.hero` becomes `Hero`), with optional variants (`Hero (dark)`), so that blocks come out the way my target site's block library expects.
18. As a migration lead, I want to say whether a block rule creates one block per matching element or one block with a row per matching element (a card list), so that repeating content maps to Cards-like blocks.
19. As a migration lead, I want to define each cell of a block by a selector relative to the matched element and an extraction kind (text, HTML, image, link, attribute), so that fields map to cells exactly.
20. As a migration lead, I want to mark a block rule or field as required and be warned on pages where it matched nothing, so that I find pages the rules do not fit.
21. As a migration lead, I want to define where section breaks fall (before elements matching a selector) and set section styles, so that layout sections match the source.
22. As a migration lead, I want page metadata (title, description, image, any custom key) mapped from selectors, meta tags or fixed values into the page's metadata block, so that SEO data survives.
23. As a migration lead, I want content that no rule claims to stay as default content (headings, paragraphs, lists, links, images) with markup cleaned up, so that I do not have to map every paragraph.
24. As a migration lead, I want rules evaluated in a visible, reorderable order with "first rule to claim an element wins", so that overlapping rules behave predictably.
25. As a migration lead, I want invalid selectors flagged immediately with a message, so that I do not wonder why nothing matched.
26. As a migration lead, I want a live match count next to every selector (on the page being previewed and across the whole crawl set), so that I can tell if a rule is too narrow or too broad.
27. As a migration lead, I want to see which crawled pages a page type matches and which match nothing, so that unmapped pages are never a surprise.
28. As a migration lead, I want to define how source URLs become target paths (strip a prefix, regex replace, lowercase, hyphenate, drop extension, `/` becomes `index`), so that the new site's URL structure is what I intend.
29. As a migration lead, I want two source URLs that map to the same target path reported as a collision before import, so that one page never silently replaces another.
30. As a migration lead, I want internal links between migrated pages rewritten to the new paths, so that the migrated section is self-consistent.
31. As a migration lead, I want internal links to pages outside the crawl set kept pointing at the source and counted in the report, so that I know which links will leak the old site after cutover.
32. As a migration lead, I want images and linked files (PDF, video, SVG) downloaded and uploaded into DA under the target root, and the document references rewritten, so that the migrated content does not depend on the old site.
33. As a migration lead, I want a side-by-side preview (source page on the left, mapped EW document on the right) for any crawled page before import, so that I can iterate on rules with the result in front of me.
34. As a migration lead, I want the mapped side to show block boundaries and cell structure, and to switch to the raw EW HTML, so that I can see what will actually be written.
35. As a migration lead, I want the preview to list source text that did not make it into the mapped document, so that I notice content loss.
36. As a migration lead, I want the preview to warn about things DA/EDS will reject or mangle (over-cap SVG, unsupported media type, over-long path, unknown block name pattern), so that I fix them before import.
37. As a migration lead, I want the profile saved in the target site and shared with my team, so that a colleague can continue the migration setup.
38. As a migration lead, I want to export and import a profile as a JSON file and to keep several profiles per target site, so that I can reuse a mapping for a similar site or back it up.
39. As a migration lead, I want a clear unsaved-changes indicator and an explicit Save, so that rules are never half-saved by accident.
40. As a migration lead, I want to choose a target root in DA (default a drafts folder) and see that the app refuses unsafe targets, so that a first import cannot overwrite live content by accident.
41. As a migration lead, I want a dry-run plan listing every document and media file with what the import would do (create, update, unchanged, skip), so that I know the blast radius before writing.
42. As a migration lead, I want re-running the import to be safe: unchanged pages stay unchanged, changed rules update pages, and nothing is duplicated, so that I can iterate.
43. As a migration lead, I want pages that an author has edited in DA since the last import to be skipped by default and reported as "edited in DA", so that a re-import never destroys editorial work, with an explicit overwrite option.
44. As a migration lead, I want per-page and per-media results with reasons, exportable as JSON/CSV, so that I can audit the migration and attach it to a ticket.
45. As a migration lead, I want to retry only the failed items, so that one transient 5xx does not force a full re-run.
46. As a migration lead, I want to cancel a running import and still get an accurate report, so that I can recover from a mistake.
47. As a migration lead, I want links from the report to open any imported page in the EW editor, so that I can review the result immediately.
48. As a migration lead, I want a source-URL to target-path CSV export, so that I can build redirects after cutover.
49. As a migration lead, I want a long import to survive my IMS token being refreshed and to pause cleanly (not loop) if sign-in is needed, so that a thousand-page run does not die halfway.

Extension author / maintainer:

50. As the maintainer, I want all code in one self-contained `migration-assistant` folder with its own README, tests, entry page and `worker/`, so that it can be moved upstream or deleted without breakage.
51. As the maintainer, I want the mapping engine, discovery, planner and importer to be pure logic behind two injected ports (source fetch, DA fetch), so that they are fully unit-testable with no network, EW or Cloudflare.
52. As the maintainer, I want a fake source site and a fake DA Admin with the real API's quirks, so that tests catch production behaviours.
53. As the maintainer, I want the worker to reject unauthenticated callers on every route and never return a credential, so that the browser never holds a source credential and the worker is not an open proxy.
54. As the maintainer, I want the worker to refuse private, loopback and non-standard targets and cap sizes, so that it cannot be used for server-side request forgery or as a bandwidth proxy.
55. As the maintainer, I want the README to say which config-sheet row enables the app and which site config it reads, so that enabling it is copy-paste.
56. As the maintainer, I want a source-adapter seam, so that vendor-specific adapters (AEM, WordPress, Sitecore, ...) can later live in `providers/<vendor>/` without touching the generic engine.

Reviewer / stakeholder:

57. As a reviewer, I want the README to position the tool against the AEM Importer and EW's Import app, so that nobody uses the wrong one.
58. As a reviewer, I want manual verification steps for `ref=local` and a branch ref that run in EW in minutes, so that I can approve a PR with evidence.
59. As a security reviewer, I want proof that the token and any source credential never appear in the DOM, logs, responses, saved profiles or reports, so that the template is safe to copy.

## Implementation Decisions

Decision-level only; paths and file names appear in the Build Analysis.

### Shape and platform

1. **Type and location.** Fullscreen app (registered in the EW `apps` sheet), in its own folder `migration-assistant` under `apps/` per the owner-approved convention (every extension is `apps/<name>/`; type comes from the config-sheet row). Entry page named after the folder. Vanilla DOM and browser-native ES modules, no bundler (decision in #1). Its worker lives in `worker/` inside the folder, built from `shared/worker-template/`. Vendor source adapters live under `providers/<vendor>/` (none in v1).
2. **Responsibility split (the central decision).** The **browser does the thinking**: discovery parsing, crawl scheduling, mapping, link/path rewriting, preview, planning, DA writes. The **worker does only what a browser cannot or must not**: fetch third-party URLs without CORS limits, hold an optional source-site credential, enforce SSRF and size rules, and return results. Reasons: (a) a DOM exists in the browser (`DOMParser`, `querySelectorAll`) and the whole mapping UX is "edit selector, see result now", so the engine must run where a DOM is; (b) Cloudflare Workers Free allows 10 ms CPU and 50 subrequests per invocation [VERIFIED: https://developers.cloudflare.com/workers/platform/limits/], so crawling or transforming many pages inside one worker invocation is not viable, while a stateless one-URL-per-call relay is; (c) DA writes then happen under the signed-in user's own rights via the SDK's `daFetch`, so the worker never needs, and must never be given, the user's DA authority (the template forbids forwarding the inbound token anyway).
3. **Stateless worker, browser-driven crawl.** The worker keeps no job state. The browser holds the queue and calls the relay for one URL at a time with bounded concurrency. Consequences: crawl survives worker isolate churn; no KV/Durable Objects (out of scope in #2); progress is naturally visible in the browser; closing the tab ends the run (recovery is re-run, which is idempotent).
4. **Source adapter seam.** An adapter turns an input (sitemap, origin, URL list) into crawl-set candidates and turns a fetched source page into a normalised source page (URL, final URL, HTML, metadata). v1 ships exactly one adapter, **generic HTML**. Mapping rules operate on the normalised page, so a future vendor adapter only changes how pages are discovered/fetched or pre-normalised, not the rule engine.
5. **Reuse the worker contract unchanged where possible.** Auth (IMS offline verification, 401 before anything else), CORS (da.live + the site's own origins), secrets handling and redaction, request ids, logging, error contract, outbound `proxy` retry helper, test kit: all from the template. Four needs the template spec does not cover are recorded as template questions in the Open Questions (dynamic public source hosts, optional secret, extra error code, body-redaction exemption for binary passthrough). This spec does not fork the template.
6. **DA boundary is `daFetch` only.** All reads and writes to DA use `actions.daFetch` against `context.daOrigin` (fallback `https://admin.da.live`), same as Deep Clone [VERIFIED: sdk.js exposes `daFetch`; shell context carries `daOrigin`, per the Deep Clone spec]. The `daFetch` implementation sets the bearer header itself on whatever URL it is given, wraps thrown network errors into a synthetic `500` response, and on a `401` triggers the SDK sign-in redirect [VERIFIED: daFetch.js]. Therefore `daFetch` is used **only for DA calls, never for the worker** (a worker `401` must not bounce the user to IMS sign-in).
7. **Token for the worker.** The SDK result carries a token snapshot; later parent messages carrying a `token` only update `daFetch`'s internal copy [VERIFIED: sdk.js `setImsDetails` on subsequent messages]. For a long migration the app therefore keeps its own tiny token holder: initialised from the SDK result, updated by later `message` events from the parent window that carry a `token`, never rendered or logged. A worker `401` pauses the run ("needs sign-in/refresh") instead of retrying in a loop. [ASSUMPTION: EW sends refreshes in that message shape; verified only by reading the SDK code, to be observed in manual step MA9. Token lifetime is unknown, #2 R4.]

### Discovery and crawl

8. **Inputs.** (a) sitemap URL; (b) site origin, from which `robots.txt` is fetched for `Sitemap:` lines and `/sitemap.xml` is the fallback (same behaviour as the AEM Importer crawl tool: https://www.aem.live/developer/importer, "Get from robots.txt or sitemap"); (c) pasted or uploaded URL list. Link-following crawl (spidering by `<a>` links) is out of scope for v1.
9. **Sitemap handling.** The worker relays the raw sitemap bytes as text; the browser parses XML (`DOMParser` with an XML MIME type) so worker CPU stays tiny. `sitemapindex` entries are followed with a depth cap (default 3) and a total-sitemap cap; a `urlset` over the spec limits (50,000 URLs / 50 MB, https://www.sitemaps.org/protocol.html) is not rejected but the page cap applies. `.xml.gz` sitemaps are decompressed in the worker before relay [ASSUMPTION: `DecompressionStream` is available in Workers; Cloudflare's docs page for it was not found at the URL I tried, so verify in SM-tier tests]. `xhtml:link` alternates are ignored in v1.
10. **Scope rules.** Default: only URLs on the same origin as the first input (scheme+host, `www` treated as distinct) are admitted; others are listed as "off-origin, excluded" with a switch to admit named extra hosts. Include/exclude are path glob patterns evaluated on the normalised path; a page cap (default 500, hard maximum 2,000 in v1) applies after filtering. [ASSUMPTION: numbers; the AEM Importer docs say a browser-based importer degrades around 60-100 heavy pages and that 10k+ URL migrations should go to the AEM team (https://www.aem.live/developer/importer); our relay does not run source JS, so heavier-than-importer is plausible but unmeasured.]
11. **URL normalisation.** Lower-case scheme and host, drop fragments, drop default ports, resolve dot segments, optionally strip an editable list of tracking parameters, keep other query strings (pages whose identity is a query string are rare; they are crawled but their default target path drops the query and collisions are reported).
12. **Crawl execution.** Per-host concurrency default 4 (max 8), each call = one relay request, with the template's retry for 429/5xx on the worker's outbound side and one browser-side retry on worker `5xx`/network errors. Redirects are followed by the worker up to 5 hops (each hop re-validated), recording the chain; an off-origin final URL is a failure ("redirect off-site") unless that host was admitted. **Source-side failures are data, not worker errors**: the relay returns HTTP 200 with a per-URL result envelope (status, final URL, content type, size, error code). Worker-level errors (401, 403 origin, 429, 5xx) use the template's error contract.
13. **Politeness and attestation.** Relay requests send a fixed identifying `User-Agent`; `Retry-After` from the source is honoured; the first crawl requires the user to confirm they are authorised to copy the content. `robots.txt` `Disallow` rules are **not enforced** in v1 (the tool migrates content the user is entitled to copy, and the AEM Importer's proxy does not enforce them either [ASSUMPTION: not verified in importer source]); `robots.txt` is only used for sitemap discovery. [OPEN: owner policy.]
14. **Content accepted.** Pages: `text/html` (and `application/xhtml+xml`) up to 5 MB, decoded to UTF-8 in the worker using the HTTP charset, else a `<meta charset>` sniff of the first 1 KiB, else UTF-8 [ASSUMPTION: defaults]. Sitemaps/robots: text/XML up to 50 MB uncompressed. Assets: an allowlist of deliverable types (PNG, JPEG, GIF, WEBP, AVIF, SVG, MP4, PDF, JSON, ICO, WOFF2 per https://www.aem.live/docs/limits and the `da-content` skill) up to 20 MB (36 MB for MP4); anything else is skipped with a reason, not relayed. JavaScript-rendered pages (content absent from the raw HTML) are not supported (no headless rendering in v1).

### Worker relay and security

15. **Routes (conceptual):** fetch-text (page / sitemap / robots), probe (metadata only), fetch-binary (asset bytes). All `POST` with a JSON body naming the target URL; all behind the template pipeline (CORS gate, IMS token, then handler); there is **no unauthenticated route** other than the template's `OPTIONS` preflight, so a bare request returns `401` (this is also the deployed liveness check, as in #2).
16. **SSRF and open-proxy defence (the worker accepts arbitrary URLs from any authenticated Adobe user, which is more dangerous than a vendor quota).** The relay: allows only `http`/`https`, ports 80/443, no URL credentials, no IP-literal hosts, no `localhost`/`.local`/`.internal`-style names, no hosts resolving to private/loopback/link-local ranges where the runtime exposes that (it does not expose DNS results, so the name and IP-literal rules are the enforceable layer [ASSUMPTION]), re-validates every redirect hop, follows at most 5 hops, uses GET only (HEAD for probe with GET fallback), forwards no inbound headers, applies per-response byte caps while streaming, and enforces the content-type allowlists above. An optional worker variable `ALLOWED_SOURCE_HOSTS` (empty = any public host) lets the owner lock the relay to named hosts. The IMS client-id allowlist and the optional `authorize` hook from #2 are the other controls. [OPEN: owner decides whether "any public host" is acceptable (R3).]
17. **Source credential (the only secret in v1).** One optional secret holds a host-to-credential map for protected source sites (basic auth or a fixed header). It is injected by the worker only on requests whose host (including every redirect hop) equals the credential's host, never forwarded to another host, never returned, never logged, and redacted from any response. It is set by the owner with the platform secret store, never typed into the browser. Without it the relay works for public sources only. [OPEN: whether v1 should ship this or leave protected sources to a follow-up; kept in scope because AC8 has no meaning with zero secrets. See Open Question 8.]
18. **Worker origin is a constant in the extension** (never from the URL), per #2 Decision 13; `ref=local` pages use the local worker, other refs the deployed worker.

### Mapping engine (the core IP)

19. **Profile model.** A versioned JSON document with: source identity (origin), target basics (default target root, media root), an ordered list of **page types**, each with a **match** (URL path glob, selector-present, meta name/property equals-or-contains; all conditions in a type are AND, first matching type wins, a final default type has no match), and for each type: `root` selector, `remove` selectors, `sections` rules, ordered `blocks` rules, `metadata` mappings, default-content cleanup options; plus profile-wide `paths` rules (URL-to-path), `links` rules and `media` rules. Data-shape tables are in the Build Analysis. The schema carries `version`; a profile with a newer version than the app understands is refused with a message, an older one is migrated in memory.
20. **Evaluation order (documented and deterministic).** For one page: parse → choose page type → apply `remove` → pick `root` → mark section boundaries → run block rules in listed order, each claiming the elements it matches (a claimed element and its descendants are not available to later rules; a rule whose match is inside an already-claimed element yields zero matches and is reported) → remaining content in `root` becomes **default content**, cleaned → append the page `metadata` block → serialise. The same input and profile always produce byte-identical output (needed for idempotency and tests).
21. **Block rule.** `name` and `variants` produce the block class (name normalised to lowercase alphanumerics and single hyphens as EDS requires, per the `da-content` skill); `match` is a CSS selector against the page root; `mode` is **one-block-per-match** (each match becomes a block; its cells come from the cell definitions) or **rows-per-match** (all matches become rows of a single block, e.g. a card list); `cells` is a list of rows, each row a list of cells, each cell `{selector (relative to the matched element, or empty = the element itself), extract, join}`; `extract` ∈ {text, inner HTML, image, link, attribute:name, fixed text}; `required` flags. Output uses the canonical div form (`<div class="block variant"><div><div>cell</div></div></div>`), not the table alternate, because the `da-content` skill documents it as DA's canonical form (the table form is an accepted alternate that the pipeline normalises) [VERIFIED second-hand from that skill; not re-verified against `da-live` source]. [OPEN, small: confirm the div form round-trips in the DA editor in the sandbox spike 0b.]
22. **Default content and cleanup.** What remains in the root is reduced to the EW default content vocabulary (headings, paragraphs, lists, links, images, blockquote, code, tables-as-content only where a rule asks for them). The serialiser **sanitises by allowlist**: no `script`, `style`, `iframe`, inline `style`, event handlers, or `class`/`id` on default content (DA/EDS strip or ignore them anyway; we never emit them, so stored content is clean and a hostile source cannot plant markup). Block-cell content follows the stricter normalisation rules from the `da-content` skill (semantic inline tags only). Output is a body fragment: `<body><header></header><main>sections</main><footer></footer></body>`, one `div` per section [VERIFIED: `da-content` skill; `da-nx` `replaceHtml` emits the same skeleton].
23. **Path rules.** Source URL to target path: strip a configurable prefix, apply an ordered list of regex replacements, lower-case, replace non `a-z0-9-` runs with `-`, drop the extension (`.html`, `.htm`, `.php`, `.aspx`), map a trailing `/` or empty path to `index`, cap at 900 characters (https://www.aem.live/docs/limits; same sanitisation idea as helix-importer's `sanitizePath`, https://github.com/adobe/helix-importer-ui/blob/main/importer-guidelines.md "Note on generated paths"). Collisions (two sources, one target) are errors in the plan and resolved only by an explicit rule or an automatic numeric suffix the user opts into.
24. **Link rules.** Within a mapped page: `a[href]` pointing at a source URL **in the crawl set** is rewritten to the root-relative target path (keeping hash and, optionally, query); pointing at a source-origin URL **not** in the set is left as the absolute source URL and counted as "unmapped internal link"; `mailto:`, `tel:`, `#anchor` and other hosts are untouched. Relative hrefs are resolved against the page's **final** URL first.
25. **Media rules.** `img[src]`, `source[srcset]` and `poster`/`video source` on the source origin (or an admitted CDN host) are downloaded through the relay, uploaded to the **media root** (default: `{target root}/media`, so media is "under the chosen path" per AC4), and the document reference is rewritten to the absolute `https://content.da.live/{org}/{repo}/{path}` form, because host-less paths render as `about:error` at preview while absolute DA content URLs are re-hosted into the media bus at preview [VERIFIED by the `da-content` skill; empirical claims there not re-verified]. Linked files (`a[href]` to PDF and other deliverable types on the source origin) are handled the same way and the link is rewritten. Media target names are derived deterministically from the source URL path (sanitised; a short hash of the full source URL is appended only on collision) so re-runs hit the same keys. Per-file caps and the SVG 40 KB preview cap are surfaced as warnings in preview and as `skipped` reasons in the run.
26. **Hotspots the engine must not hide.** Dropped source text, unmatched required rules, unmapped internal links, off-origin images left in place, oversized/unsupported media, and path collisions are first-class warnings in preview and report, never silent.

### Profile storage ("saved per site")

27. **Where.** In the **target site's DA content**, in a dedicated hidden-by-convention folder (dot-prefixed), one JSON file per profile, written with the normal Source API as an ordinary `.json` file. Rationale: it is per site by construction, shared by every user with DA access to that site, versioned by DA, needs no new backend or KV, and travels with the site. [ASSUMPTIONS to verify in the sandbox before building the store: (a) the DA Source API stores arbitrary JSON (not only sheet-shaped JSON) verbatim; (b) a dot-prefixed top-level folder is writable by users who can write the target site and is not published by EDS (a dot folder `/.da/config.json` exists per https://www.aem.live/docs/ew/administering/restore-from-aem, and dot-folders exist for per-document uploads per the `da-content` skill, but neither proves a custom one works).] If saving to DA fails (no write permission or rejected), the app keeps the profile in memory and offers a JSON download so no work is lost; it never silently falls back to browser storage.
28. **Save semantics.** Explicit Save only; unsaved indicator; last-write-wins (DA gives no conditional writes, per Deep Clone R4); the saved file records the author (email from SDK context if present) and timestamp, but no token.
29. **Profile lifecycle.** List profiles for the target site, create from scratch or from an exported file, duplicate, rename, delete. A profile is keyed by name; its source origin is a field, so one target site can hold many profiles.

### Preview

30. **Side by side, no script execution.** Left: the source page (as fetched, scripts, handlers and `<base>` rewriting applied by the app, shown in a sandboxed iframe with `sandbox=""` (no scripts, no same-origin) via `srcdoc`, with the page's absolute-ised stylesheet and image URLs so it looks like the original). Right: the **mapped EW document** in a second sandboxed iframe in a neutral "structure view" (blocks drawn as labelled boxes with their cell grid, default content in plain styles) plus tabs for raw EW HTML and for warnings. The mapped view deliberately does **not** run the target site's block code (it would need the document to exist and be previewed on `aem.page`, and would execute site JS in our frame). A "preview on the target site" step (write to a scratch path and open the site's real preview) is a stretch listed in Open Questions, not in v1 scope.
31. **Selector feedback.** Each selector field shows its match count on the previewed page and across the whole crawl set (computed in the browser over cached source pages), and the matched elements are outlined in the source pane (the app injects highlight attributes into the parsed copy before serialising to `srcdoc`; no script in the frame). Click-to-pick-an-element in the source pane needs script in the frame and is out of scope for v1.
32. **Dropped-content report.** After mapping, the app computes text nodes present in the chosen `root` but absent from the mapped document (normalised whitespace, order ignored) and lists them. This is the main guard against silent content loss.

### Import and idempotency

33. **Target root.** A DA path the user chooses (default `/drafts/migration/<profile>`); validated lower-case, within the 900-character limit, not empty, not `/`, no `.da-versions`, and shown against a listing so a non-empty target is visible. The EW Import app's docs warn their import is destructive and suggest a drafts folder first (https://www.aem.live/docs/ew/administering/import); we default to the same and require explicit confirmation to target a non-drafts root.
34. **Plan before write.** Run = (1) **plan**: map every crawl-set page, resolve target paths, detect collisions, list the target subtree and the import manifest from DA, and compute for every document and media item the action it would take; (2) user reviews (and may untick items); (3) **execute**. No DA write happens during discovery, crawl, rules or preview, except the user-initiated profile Save.
35. **Manifest.** The import writes (and updates after each batch) one manifest file per profile+target root, listing for each source URL: target path, hash of the content last written, source ETag/Last-Modified/size where known, timestamp, outcome. It lives next to the profile in the hidden folder. It is what makes "unchanged", "edited in DA since last import" and "skip-existing" decidable. Losing the manifest degrades safely: existing targets are then treated as "exists, unknown provenance" and skipped unless Overwrite is chosen.
36. **Conflict policy (one setting per run).** `update-if-untouched` (default): write if the target does not exist, or exists and its current content hash equals the manifest's last-written hash (an author has not edited it); report `unchanged` if the new content equals what is there; `skipped (edited in DA)` if the hash differs. `skip-existing`: never touch existing targets. `overwrite`: replace existing targets, after an explicit confirmation showing the count; DA versions overwritten documents (per the Deep Clone spec). Every run reports each item as one of `created | updated | unchanged | skipped-existing | skipped-edited | failed | cancelled`, with a reason.
37. **Order and writes.** Media first (so rewritten document references resolve), then documents. Documents are written with `POST` multipart `data` to `{daOrigin}/source/{org}/{repo}/{path}.html`, media likewise with their MIME type; success is the response status (201/200), never assumed [VERIFIED: https://docs.da.live/developers/api/source, shape and 201]. The unconditional-overwrite behaviour of `POST` and the lack of conditional writes (so "check then write" is a narrowed, not closed, race) are taken from the Deep Clone spec. Each item is an independent unit: one failure never aborts the run; 429 and 5xx retried with capped backoff (3 attempts); `daFetch`'s synthetic `500` for network errors is treated as retryable; a `401` pauses the run.
38. **Concurrency.** DA writes: default 5, 1-10 (DA documents no rate limit; Deep Clone's conservative choice). Source fetches: default 4 per host. Memory: media bytes stream relay → memory → DA one file at a time per worker slot (up to the 20 MB cap); no bulk buffering of the whole crawl set's media. Crawled page HTML is kept in memory (cap 2,000 pages x 5 MB worst case is large, so pages are stored compressed or evicted once imported [ASSUMPTION: cap tuned from measurement; see R9]).
39. **Size and type guards.** Files above the target site's upload ceiling are `skipped (too large)`: the DA editor caps uploads at 4.5 MB on Helix-6 sites and 20 MB on legacy sites per the Deep Clone spec [VERIFIED second-hand], which the app treats as the practical Source API ceiling until measured [ASSUMPTION].
40. **Helix 6 targets.** Whether `admin.da.live` remains the supported write path for sites migrated to the new source bus is open (Deep Clone Further Notes); the app isolates the origin so changing it is one decision [OPEN].

### UI, security, tooling, docs

41. **UI.** One page, vanilla DOM, six stages (Source, Crawl, Rules, Preview, Import, Report) with a persistent summary bar; a side-effect-free render layer takes state and returns DOM (the testable seam). All source-derived and API-derived strings (URLs, page titles, selector text, error messages, extracted content) are rendered as text, never HTML; source markup only ever appears inside sandboxed `srcdoc` frames. Standard "waiting for / not running inside Experience Workspace" states from hello-world.
42. **Secrets and tokens.** No credentials in the browser or in any saved artefact (profile, manifest, report, export). The IMS token is never rendered, logged, put into profiles/reports or sent anywhere but the constant worker origin and (via `daFetch`) the DA origin.
43. **Tooling.** As decided in #1/#2: ESLint 8 + helix config, Stylelint 16, `@web/test-runner` for browser unit tests, `node:test` for worker tests, Playwright, Node 22 (>=22.12 for Wrangler 4), husky. Tests live in the extension folder. No new runner or framework.
44. **Docs.** The extension README covers: purpose and positioning (vs the AEM Importer and EW's Import app), setup, the EW `apps` sheet row (title `Migration Assistant`, path `https://da.live/app/{org}/{site}/apps/migration-assistant/migration-assistant`, `ref` blank), the site config it reads (**none**; it writes a profile/manifest folder in DA and reads the worker origin from a constant), worker deploy/secrets/variables (`ALLOWED_SOURCE_HOSTS`, source-credential secret), profile format reference, limits, `ref=local`/branch-ref instructions, the trust prompt, and the legal/permission attestation. The root README extensions table gets one row (name, folder, entry point, `app`, description).

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given a (fake) source site, a profile and a (fake) DA site, which pages are discovered, what mapped HTML is produced, what exists in DA afterwards, what the report says, and (for the worker) what `Request` gets what `Response`. Never assert on internal function names, DOM structure beyond accessible roles/text, CSS classes or call order (except where order is the behaviour: media before documents; auth before anything). Tests need no network, IMS, EW, Cloudflare login or real source site.

**Proposed seams** (recorded here instead of asked, per #50). Two engine ports, one worker boundary, and the three scaffold seams, reused wherever they exist:

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| M1 (primary, new, highest) | **Migration engine boundary**: inputs = options/profile + two injected ports (`sourceFetch`: the relay client; `daFetch`: the SDK function); outputs = crawl results, mapped documents, plan, report, DA state | new | WTR unit/integration tests of discovery, crawl runner, mapping, preview view-model, planner, executor, report | A **fake source site** (in-memory: robots, sitemaps incl. index/gz, pages, assets, redirects, failures, latency) behind `sourceFetch`; a **fake DA Admin** (in-memory tree with the real quirks: paging, lower-casing, silent behaviours, 401/403/5xx injection, size cap) behind `daFetch`; injected `now`/`sleep`/`random` |
| W1 (reused from #2, extended) | Worker HTTP boundary: `worker.fetch(request, env, ctx)` | from #2 | `node:test` tests for the three relay routes, SSRF matrix, caps, credential scoping | #2 test kit (`makeEnv`, `fakeIms`, `fakeUpstream`); a scripted fake source via the injected outbound `fetch` |
| W2 (reused from #2) | Same worker in real workerd over HTTP | from #2 | Smoke tier | `wrangler dev` with `IMS_ORIGIN` and source pointing at throwaway local servers (private-source flag on in the local env only) |
| S1 (reused from #1/#2) | Entry HTML page + SDK module boundary | from #1 | Playwright e2e | #1 SDK stub (token signed by the test key, per #2); fake DA Admin served through route interception of the DA origin; real local worker for the browser-to-worker path |
| S2 (reused from #1) | Render/logic module + SDK result | from #1 | WTR tests for UI render and bootstrap | hand-built SDK result, injected ports |
| S3 (reused from #1/#2, extended) | Repo convention check | from #1/#2 | CI lint job | filesystem fixtures |

Why M1 has two ports but is still one seam: every behaviour of the engine is observable at the two ports, so the whole pipeline is tested at the highest point with no module-internal assertions. Why the worker boundary is separate: it is a different deployable in a different runtime.

**Modules tested** (all through those seams): discovery (robots/sitemap/URL-list parsing and scoping); crawl runner (queue, concurrency, retry, progress, cancel); worker relay (auth, SSRF, caps, credential scoping, charset/gzip); mapping engine (page-type matching, root/remove/sections/blocks/cells/metadata/default content, sanitiser, determinism); path mapper; link and media rewriter; profile store (schema validation, versioning, DA persistence, export/import); preview view-model (match counts, dropped-text report, warnings); planner; executor (ordering, conflict modes, idempotency, manifest, retries, cancel, 401 pause); report/export; UI wiring (e2e); token holder; convention check.

**Prior art.** Unit/e2e patterns and fakes from #1 and `apps/deep-clone/SPEC.md` (in-memory fake DA Admin, `daFetch` as the seam, Playwright route interception). Worker tests from `shared/worker-template/SPEC.md` (test kit, canary secret, W1/W2). Mapping semantics from the AEM Importer's documented rule model (`transformDOM`, `generateDocumentPath`, `createTable`/metadata block helpers, https://github.com/adobe/helix-importer-ui/blob/main/importer-guidelines.md): behaviour comparison only, no code reuse. Upstream `adobe-rnd/ew-extensions` has no importer or worker tests to copy.

## Out of Scope

- Vendor source adapters (AEM, WordPress, Sitecore, Contentful, ...): the adapter seam exists, no vendor adapter is built (they go in `providers/<vendor>/` follow-up tickets).
- Link-following crawl (spidering) and JavaScript-rendered pages (headless browser / Cloudflare Browser Rendering); SPA sources.
- AI/LLM-suggested mappings, auto-detected block structure, or any model API (a possible follow-up; would add the first vendor credential).
- Click-to-pick selector in the source preview (needs script in the preview frame) and a "preview on the target site" step through `aem.page` (stretch, see Open Questions).
- Importing to AEM authoring (JCR packages), docx/Word output, or local-disk output (the AEM Importer's other targets).
- Preview/publish of imported documents, redirect creation or upload (only the CSV export), query-index/sitemap generation on the target, `head`/theme/CSS/block code migration, forms, search, commerce, user accounts.
- Cross-org targets other than the org/site EW opened the app for; Helix-6-specific write paths until the open question is resolved.
- Worker-side or background imports that survive a tab close, resumable server jobs, scheduling, large-scale (10k+) migrations (the AEM docs route these to the AEM team).
- Rollback ("delete everything this run created"); the report and manifest list what was written.
- Per-user quotas, online token revocation checks, secret-scanning setup, CI-driven worker deploy (all inherited as out of scope from #2).
- Rewriting content inside sheets/JSON data, free-text path mentions, and `robots.txt` `Disallow` enforcement.
- The Adobe outside-activity/IP policy decision (inherited from #1 R1; also relevant because the worker crawls third-party sites).

## Further Notes

- **Overlap and differentiation (the ticket's own caveat).** The AEM Importer already does DOM-to-block transformation, bulk URL lists, sitemap/robots crawl and a report [VERIFIED: https://www.aem.live/developer/importer], but its mapping is hand-written JavaScript in a local developer tool with a Chrome-only proxy UI and disk output. EW's Import app already writes into DA but only from content already on Edge Delivery Services and without mapping [VERIFIED]. This extension's differentiation is the **in-EW, no-code, iterate-with-the-result mapping UX with shared saved profiles and an idempotent import straight into DA**. The README must say when to prefer each tool. [OPEN: confirm with the EW team that no first-party mapping UI is planned; I found none in `adobe/da-nx` `nx/blocks` (listing read 2026-11-16: no mapping/migration block).]
- **A first-party generic CORS proxy exists** (`da-etc.adobeaem.workers.dev/cors?url=`, used by the Import app [VERIFIED in `nx/blocks/importer/index.js`]). I did not probe it. It cannot satisfy AC8 (credentials only in this extension's own worker, own auth) and its policy for arbitrary hosts is unknown, so this spec builds its own relay on the template. [OPEN: whether Adobe would prefer reuse.]
- **Docs-versus-source drift** on DA Admin (copy destination format, folder copy, silent 204, paging) is the same risk Deep Clone documents; the app only uses `list`, `source GET/HEAD/POST` and never `/copy`, which removes most of it. The remaining drift risk is the unconfirmed Source-API behaviour for a dot-prefixed folder and arbitrary JSON (decision 27).
- **Public test sources observed 2026-11-16:** `https://wknd.site/us/en.html` returns server-rendered HTML (118 KB, `200`), `robots.txt` and `sitemap.xml` return `404` (a natural "URL list only" case); `https://main--aem-boilerplate--adobe.aem.live/sitemap.xml` returns a 2-URL `urlset` (a natural "sitemap" case); `https://www.aem.live/sitemap.xml` returns a large `urlset` (29 KB) [VERIFIED by `curl`]. They are suggested manual-verification sources; they are Adobe-owned public sites, and hitting them lightly is expected to be fine [ASSUMPTION; owner to confirm].
- The `SPEC.md` in this folder is a planning artefact; when the app is built, keep it and link it from the folder README, or delete it per the #1 decision. [OPEN, low stakes.]

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live, prod IMS)                  This repo (EDS code site)
 ├─ /apps#/{org}/{site}      (card from the `apps` sheet row)
 └─ /app/{org}/{site}/apps/migration-assistant/migration-assistant  --iframe-->
        https://{ref}--{site}--{org}.aem.live/apps/migration-assistant/migration-assistant.html
           │  await DA_SDK -> { context, token, actions }
           │
           ├─ [browser engine: discovery, crawl scheduler, mapping, preview, planner, executor, report]
           │
           ├─ sourceFetch ──HTTPS + Bearer IMS──> Migration worker (Cloudflare)  ──HTTPS──> source site (any public host)
           │       relay: fetch-text | probe | fetch-binary        optional source credential (secret, host-scoped)
           │
           └─ actions.daFetch ──HTTPS + Bearer IMS──> admin.da.live   list | source GET/HEAD/POST   (target site, user's own rights)
```

| Concern | Browser extension (static, public) | Worker (private runtime, holds the secret) |
|---|---|---|
| Source credential | never; never sees or sends one | holds optional host-scoped credential; injects it; never returns it |
| Fetching source pages/assets | calls the relay; decides what to fetch | fetches (no CORS limits), SSRF rules, caps, charset/gzip, redirect validation |
| Sitemap/HTML parsing | all of it (`DOMParser`) | none (keeps CPU within the Free limit) |
| Mapping rules and transform | all of it | none |
| Preview | all of it (sandboxed frames) | none |
| DA reads/writes, profile and manifest | all of it via `daFetch` | none (never holds DA authority) |
| Authentication | obtains token (SDK + refresh holder), sends it to the worker | verifies it (template) before any other work |
| CORS | none | template policy (da.live + site origins) |
| Retries | browser-side retry on worker 5xx; DA retry with backoff | template `proxy` retry on source 429/5xx |

## 2. EW integration points

- **App, not library plugin.** Registered as a row in the `apps` sheet of the site config (`https://da.live/config#/{org}/{site}/`): `title` = `Migration Assistant`, `description`, `image` (optional), `path` = `https://da.live/app/{org}/{site}/apps/migration-assistant/migration-assistant`, `ref` blank (semantics of `ref` for apps undocumented, hello-world R11). The row makes a card appear on `https://da.live/apps#/{org}/{site}` [VERIFIED: https://www.aem.live/docs/ew/developing/apps-plugins]. This is how AC6 "reachable from the EW Apps menu" is met. Library plugin: none.
- **URL mapping** (shell source, per #1 spec 2.3): `https://da.live/app/{org}/{site}/apps/migration-assistant/migration-assistant?ref=local` iframes `http://localhost:3000/apps/migration-assistant/migration-assistant.html`; any other `ref` iframes `https://{ref}--{site}--{org}.aem.live/...` or `.preview.da.live`. Branch names without `/` (hello-world R9/2.3).
- **SDK usage.** `import DA_SDK from 'https://da.live/nx/utils/sdk.js'` and `await` it, plus the SDK `<script type="module">` tag in the entry HTML (decision 5 of #1). Context used: `org`, `repo`, `ref`, `daOrigin` (shell context; shape is not a documented contract, so a manual "org/site" field is the fallback if missing, as in Deep Clone). Actions used: **`daFetch` only**. `token` is read once for the worker (plus refresh holder, decision 7); never rendered.
- **Config the extension reads:** none from site config. It reads/writes the profile and manifest folder in DA (decision 27) and the worker origin constant.
- **Trust prompt** for non-`adobe` orgs on first open per `org/repo/ref` (shell.js, #1 2.4): README and manual steps cover it.
- **Folder:** `apps/migration-assistant/` (entry page named after the folder). Worker: `apps/migration-assistant/worker/` (template scaffold + three relay routes). Vendor adapters: `apps/migration-assistant/providers/<vendor>/` (none now).

## 3. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| DA App SDK handshake | gives `{context, token, actions}` | EW | https://da.live/nx/utils/sdk.js [VERIFIED] |
| `actions.daFetch` | all DA calls; attaches `Authorization: Bearer` to whatever URL it gets; synthetic `500` on network error; `401` triggers sign-in redirect | IMS bearer (SDK-held) | https://github.com/adobe/da-nx/blob/main/nx/utils/daFetch.js [VERIFIED] |
| DA `GET /list/{org}/{repo}/{path}` | list target subtree, profiles, manifest presence; paging via `da-continuation-token` | Bearer | https://docs.da.live/developers/api/list [VERIFIED]; paging from the Deep Clone spec (da-admin source) |
| DA `GET|HEAD /source/...` | read existing target docs (idempotency hash compare), profile, manifest | Bearer | https://docs.da.live/developers/api/source [VERIFIED]; `HEAD` from Deep Clone spec |
| DA `POST /source/...` multipart `data` | write documents, media, profile, manifest; `201` JSON; folders need no extension and no body | Bearer | https://docs.da.live/developers/api/source [VERIFIED]. Field name must be `data` (other names return 200 with nothing written, per the `da-content` skill, not re-verified) |
| `content.da.live/{org}/{repo}/{path}` | absolute URL form for media references in documents | none for public types | `da-content` skill [VERIFIED second-hand]; host constant, [OPEN for hlx6] |
| Migration worker `POST /v1/...` | relay | `Authorization: Bearer <IMS token>`; verified offline against `${IMS_ORIGIN}/ims/keys` | `shared/worker-template/SPEC.md` Decision 6 (da-admin pattern) |
| Source site (any public host) | pages, sitemaps, robots, assets | none, or the host-scoped credential | public web; sitemaps https://www.sitemaps.org/protocol.html; robots https://www.rfc-editor.org/rfc/rfc9309.html |
| Cloudflare Workers runtime | `fetch` handler, limits (Free 10 ms CPU, 50 subrequests, 6 simultaneous connections; Paid 5 min CPU, 10,000 subrequests) | n/a | https://developers.cloudflare.com/workers/platform/limits/ [VERIFIED] |
| Preview/publish (`admin.hlx.page`) | **not used** | n/a | out of scope |

**Auth flows.** Browser to worker: SDK token (refresh-tracked) as bearer; worker verifies per #2; handler runs. Worker to source: no auth, or host-scoped credential injected from the secret store only on exact-host hops. Browser to DA: `daFetch`. The worker never receives or forwards DA authority; the IMS token is never forwarded to the source.

**Request budget on Workers Free (why one URL per call).** One relay call = 1 JWKS fetch at most (cached) + up to 6 subrequests (1 fetch + up to 5 redirect hops) + at most the template's 3 retries on the final hop; this stays under 50. CPU per call: JWT verify + redaction scan of up to 5 MB text may approach 10 ms [ASSUMPTION; template R7/R14, measured in SM5]. A Paid plan removes both concerns [OPEN, Question 1].

## 4. Data contracts

All are behaviour contracts, shown as tables, not code. Names are indicative.

**Relay routes** (all `POST`, JSON in; all behind the template pipeline):

| Route | Request | Success response | Notes |
|---|---|---|---|
| `fetch-text` | `url`, `kind` (`page`/`sitemap`/`robots`), optional `maxBytes` (lower only) | `200` envelope: `requestedUrl`, `finalUrl`, `redirects[]` (from, to, status), `status`, `ok`, `contentType`, `bytes`, `truncated`, `body` (UTF-8 text or null), `error` (null or `{code}`) | Source-side outcomes are data in the envelope. `error.code` ∈ `blocked_host`, `blocked_scheme`, `blocked_port`, `redirect_limit`, `redirect_offsite`, `timeout`, `network`, `too_large`, `unsupported_type`, `source_status` |
| `probe` | `url` | `200` envelope without `body`, plus `etag`, `lastModified`, `contentLength` | `HEAD`, falling back to `GET` + abort after headers for servers rejecting HEAD; used for assets and change detection |
| `fetch-binary` | `url`, optional `maxBytes` | `200` bytes, `Content-Type` passed through (CORS-safelisted `Content-Length`/`Content-Type` suffice) | Failures use the template error contract (`not_found`, `payload_too_large`, `upstream_unavailable`, `rate_limited`, plus extension code `source_blocked`) |

Common rules: GET to the source only; no inbound headers forwarded; fixed identifying `User-Agent`; redirect hops re-validated and credential re-scoped per hop; byte caps enforced while streaming; error bodies from the source never passed through; every response has `x-request-id` (template).

**Worker configuration (non-secret `vars`):** `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST` (local env only), `ALLOWED_IMS_CLIENT_IDS` (from #2), plus `ALLOWED_SOURCE_HOSTS` (comma list; empty = any public host) and `ALLOW_PRIVATE_SOURCES` (local/test env only, permits loopback so e2e/smoke can use local fake sources; production config leaves it off). **Secret:** `SOURCE_AUTH` (JSON host-to-credential map; see Question 8 for the optional-secret mechanics).

**Mapping profile (saved JSON; the product's core contract):**

| Part | Fields |
|---|---|
| Header | `version`, `name`, `sourceOrigin`, `defaultTargetRoot`, `mediaRootName`, `updatedBy`, `updatedAt` |
| `paths` | `stripPrefix`, ordered `replace[] {pattern, with}`, `lowercase`, `dropExtensions[]`, `trackingParams[]`, `keepQuery` (bool), `onCollision` (`error` or `suffix`) |
| `pageTypes[]` (ordered) | `id`, `label`, `match {pathGlob, selectorPresent, meta {name or property, equals or contains}}` (AND of present conditions; absent = default type), `root`, `remove[]`, `sections[] {before selector, style}`, `blocks[]`, `metadata[]`, `cleanup` options |
| `blocks[]` (ordered) | `id`, `name`, `variants[]`, `match` (selector), `mode` (`one-per-match` or `rows-per-match`), `cells` (rows of cells `{selector, extract, attr, join, fixed}`), `required` |
| `metadata[]` | `key`, `source` (`selector`, `meta`, `fixed`), `value`, `extract` |
| `links` | `rewriteInternal` (bool), `keepQuery`, `externalHostsToLeave[]`, `unmappedInternal` (`leave` or `flag`) |
| `media` | `admitHosts[]`, `types[]`, `maxBytes`, `rewriteTo` (`content-da-live`) |

**Import manifest (saved JSON):** header (`version`, `profile`, `targetRoot`, `lastRun`), `items[]` keyed by source URL: `kind` (`document` or `asset`), `targetPath`, `contentHash` (SHA-256 of the bytes last written), `sourceEtag`, `sourceLastModified`, `sourceSize`, `writtenAt`, `outcome`. Contains no tokens, no credentials, no document bodies.

**Run report item:** `kind`, `sourceUrl`, `targetPath`, `status` (`created|updated|unchanged|skipped-existing|skipped-edited|failed|cancelled`), `httpStatus`, `reason`, `warnings[]` (counts of `unmapped-internal-link`, `dropped-text`, `missing-required`, `oversized-media`, `unsupported-media`, `path-collision`), `redirectedFrom`. Export: JSON (full) and CSV (flat); separate CSV of source URL to target path for redirects. No tokens, no credentials, no document bodies.

**Crawl result item (in memory):** `url`, `finalUrl`, `status`, `contentType`, `bytes`, `error`, `redirects[]`, and the page HTML (compressed or evicted per decision 38).

## 5. Folder layout (proposed; fits the #1/#2 convention)

```
apps/migration-assistant/
├─ SPEC.md                         this file
├─ README.md                       setup, apps-sheet row, site config read (none), worker deploy/secrets/vars, profile reference, positioning, attestation
├─ migration-assistant.html        entry page: SDK module + app script
├─ migration-assistant.js          thin bootstrap (awaits SDK, builds ports, token holder, wires UI)
├─ migration-assistant.css
├─ src/                            side-effect-free modules: discovery, crawl runner, source adapter (generic-html), mapping engine, sanitiser,
│                                  path mapper, link/media rewriter, profile store, preview view-model, planner, executor, report, ui render
├─ worker/                         template scaffold + relay routes (fetch-text, probe, fetch-binary), SSRF guard, source-auth; own test/
├─ providers/<vendor>/             (none in v1) source adapters, added by vendor tickets
└─ test/
   ├─ unit/                        WTR tests (engine, UI render)
   ├─ e2e/                         Playwright specs
   └─ support/                     fake source site, fake DA Admin (own copy; see Question 14), fixtures (real-world-shaped HTML pages)
```

The fake DA Admin duplicates the one in `apps/deep-clone`, because extensions must not import each other (#1 rule 4); promoting it to a shared harness is an owner decision (Question 14).

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Adobe outside-activity/IP policy** (inherits #1 R1) and now also: a personal-account worker crawling third-party sites with Adobe IMS-gated access. | High for publishing | README note; owner decision before sharing; spec makes no legal claim. [OPEN] |
| R2 | **Open proxy / SSRF.** Any authenticated Adobe user can make the worker fetch arbitrary public URLs and read the bytes. | High | Decision 16: scheme/port/IP-literal/name rules, hop re-validation, GET-only, caps, type allowlists, `ALLOWED_SOURCE_HOSTS`, client-id allowlist, optional `authorize`, per-route rate limit recommended (#2 notes it is approximate). Tests UW6-UW16. Owner decides default (Question 2). |
| R3 | **Template gaps** (dynamic public hosts, optional secret, extra error code, redaction of binary bodies at 5-20 MB on Free CPU). Redaction of a binary stream would blow the 10 ms CPU limit. | High (design-blocking if the template cannot flex) | Raise with the template owner before step 2 of the plan (Question 9); fallback: relay implemented as a route that opts out of body redaction because it never holds a secret that a source could echo (credential only goes to its own host). |
| R4 | **Mapping profile semantics are the IP and easy to get subtly wrong** (claim order, repeated blocks, nested matches, cell extraction). | High | Table-driven behaviour tests on real-world-shaped fixtures; determinism test; the AEM Importer's documented rule model used as a behavioural reference; "dropped text" and "required rule missing" make errors visible. |
| R5 | **Profile/manifest storage assumptions unverified** (arbitrary JSON in DA; dot-prefixed folder permissions and publishability; hlx6). | Med-High | Sandbox spike (plan step 0b) before building the store; fallback location (a normal folder, e.g. `/migration-assistant/`) and download-JSON degradation. [OPEN] |
| R6 | **Unverified DA behaviours for write at scale**: no documented rate limit, silent overwrite, upload ceiling (4.5 MB hlx6 / 20 MB legacy), `POST` behaviour on existing keys (201 vs 200). | Med | Conservative concurrency, status-based success, size guards; sandbox measurement step; contract tests against the fake pinned to Deep Clone's findings. |
| R7 | **JS-rendered or bot-protected sources** return empty or challenge HTML via a server-side fetch. | Med | Detect "very small body / no `main` content / challenge markers" and warn; documented limitation; Browser Rendering is a follow-up. |
| R8 | **Preview fidelity gap**: structure view is not the real site rendering; authors may over-trust it. | Med | Label it "structure preview"; raw EW HTML tab; optional later "preview on target" (Question 6). |
| R9 | **Browser memory/time at the page cap** (2,000 pages x HTML + media streams). | Med | Cap, compression/eviction, one media file in flight per slot, measured in a manual step; page cap is a setting. |
| R10 | **Token refresh and lifetime for long runs**: refresh messages are inferred from SDK code; lifetime unknown. | Med | Token holder + pause-on-401; observed in MA9; #2 R4/W2 inspects a real token. |
| R11 | **Idempotency edge cases**: manifest lost/forked by two users running concurrently; DA has no conditional writes. | Med | Last-write-wins documented; hash compare before write; `skipped-edited` protects authors; report shows what was written; no claim of atomicity. |
| R12 | **Code Sync + site registration** and DA org/site names (#1 R3/R10) still required before anything is reachable. | High, blocks manual verification | Owner prerequisite (plan step 0). |
| R13 | **Cloudflare plan limits** (Free: 10 ms CPU, 50 subrequests, 100k requests/day; a 2,000-page crawl with media is 2,000 + N relay calls per run). | Med | Request-per-URL budget in section 3; Paid plan decision (Question 1). |
| R14 | **Overlap with Adobe tooling** may make the extension redundant or politically awkward (ticket's own caveat). | Med | Positioning in README; confirm with the EW team (Further Notes). [OPEN] |
| R15 | **Content rights**: the tool copies third-party content. | Med | Attestation gate; README; policy owner decision. |
| R16 | **Docs drift on EW SDK** (bare `DA_SDK` global, context shape undocumented). | Low-Med | Import the SDK; generic context handling; same stance as #1 R4. |

## 7. Ordered build plan (sized to #12's acceptance criteria)

Sizes: S/M/L are relative to this extension (whole ticket is effort 5/5).

0. **Owner prerequisites (blocking):** #1 and #2 implemented and merged (tooling, hello app, CI, worker template, deployed hello worker); Code Sync + DA org/site (R12); Cloudflare account and plan (Q1); decide Open Questions 2, 8, 9 before step 2.
   0b. **Sandbox spike (S):** against a throwaway DA site, verify: arbitrary JSON write/read round-trip; dot-prefixed folder write by a normal editor; whether EDS publishes it; `POST` on an existing key (status); upload ceiling; behaviour of `HEAD`. Record results in the README; pick the profile folder name accordingly. (R5, R6)
1. **Skeleton (S)** (AC5, AC6, AC7): `apps/migration-assistant/` copied from the hello-world pattern: entry page, bootstrap with waiting/not-in-EW states, token holder, empty six-stage shell, README stub with the `apps` row, root README table row, S3 convention check green. Verify `ref=local` and branch ref render the shell in EW (MA1, MA2).
2. **Worker relay (L)** (AC1 server half, AC8): copy the template scaffold into `worker/`; implement SSRF guard, `fetch-text`, `probe`, `fetch-binary`, credential scoping, caps, charset/gzip; test-first with the #2 test kit (UW tests); smoke (SM tier); then deploy and verify bare call `401` (MA0, MA8). Browser-side `sourceFetch` client + browser retry.
3. **Discovery and crawl (M)** (AC1 browser half): URL-list parser, robots/sitemap discovery (index, gz, caps), scoping and normalisation, crawl runner with concurrency/progress/failures/cancel, Source and Crawl stages, attestation gate. Test-first via M1 with the fake source.
4. **Mapping engine core (L)** (AC2 half): profile model + validation; page-type matching; remove/root; default content cleanup + sanitiser; metadata; block rules with cells and both modes; sections; determinism. Test-first with fixtures. No UI yet; driven by profile JSON.
5. **Preview (M)** (AC3): view-model (match counts, dropped text, warnings), sandboxed source frame, structure view, raw HTML tab; Preview stage UI over fixed profile JSON.
6. **Rules editor and profile store (L)** (AC2 other half): Rules stage UI (page types, blocks, cells, selectors with live counts, reorder), profile persistence in DA (list/create/duplicate/delete, export/import, dirty/save), live re-render of preview on change. Result of 0b chooses the folder.
7. **Paths, links, media (M)**: path rules and collision detection; link rewriting; media discovery, probe, download through the relay, upload planning, reference rewriting, size/type warnings.
8. **Planner and executor (L)** (AC4): target root validation, plan against the DA listing and manifest, conflict modes, media-then-documents execution, concurrency, retries, cancel, 401 pause, manifest, idempotent re-run, per-item report, retry-failed, exports (JSON/CSV/redirect CSV).
9. **Docs and registration (S)** (AC5, AC6): full README (setup, config row, profile reference, worker deploy/secrets/vars, limits, positioning, attestation), root README row, config row in the sandbox site's config; S3 check passes.
10. **CI and e2e (M)** (AC9): add unit/e2e/worker jobs per section 6 of Testing Requirements; Playwright specs with fake DA + real local worker; lint and CI green.
11. **Manual verification in EW (M)** (AC7, AC8, AC1-4 end to end): MA0-MA12 below, recorded in the PR; README caveats updated (R6, R9, R10).

---

# Testing Requirements

Test families (IDs are referenced by the traceability table): **UW** worker relay, **UD** discovery, **UK** crawl runner, **UM** mapping engine, **UX** sanitiser/serialiser, **UP** paths/links/media, **UR** profile store, **UV** preview view-model, **UI** planner/executor, **UT** token holder, **UU** UI render, **E2E** Playwright, **SM** worker smoke, **UC** repo checks, **MA** manual EW steps.

## 1. Worker relay tests (seam W1; `node:test`; #2 test kit)

All use `makeEnv`, `fakeIms` and tokens signed by the kit; the outbound `fetch`, `sleep`, `random`, `now` are injected; a canary credential value is placed in `SOURCE_AUTH`.

| ID | Behaviour asserted |
|---|---|
| UW1 | **Every registered route**, enumerated from the route table, returns `401` with no token and `401` with an invalid token (wrong key, expired, wrong type); no outbound request is made (AC8; guards "forgot auth on a new route") |
| UW2 | Valid token plus disallowed `Origin` -> `403`, no outbound request; preflight from allowed origin succeeds without a token (inherits #2 UC matrix; only the extension-specific headers are re-asserted) |
| UW3 | `fetch-text` for a normal HTML page returns the envelope with `ok`, `status 200`, content type, byte count, UTF-8 body, final URL equal to the requested |
| UW4 | Redirect chain (301 -> 302 -> 200) returns the final URL and the hop list; 6 hops -> `error.code = redirect_limit`; redirect to another host with that host not admitted -> `redirect_offsite` (response still `200` envelope) |
| UW5 | Source `404`, `410`, `500`, `503` (after template retries) come back as `200` envelopes with `ok: false`, `status`, `error.code = source_status`; the source error body is not returned |
| UW6 | **SSRF matrix** (each yields an envelope `error.code` in `blocked_*` and zero outbound requests): `file:`, `ftp:`, `gopher:`, `data:`, `javascript:`; ports 22, 8080, 6379; `http://localhost`, `http://127.0.0.1`, `http://[::1]`, `http://0.0.0.0`, `http://169.254.169.254` (metadata), `http://10.0.0.1`, `http://192.168.1.1`, `http://172.16.0.1`; decimal/hex/octal IP forms (`http://2130706433`, `http://0x7f.1`); URL with credentials (`https://user:pw@host`); `http://foo.internal`, `http://foo.local`, a single-label host; the worker's own origin |
| UW7 | A public host that redirects to `http://127.0.0.1/` or to `http://169.254.169.254/` is blocked at the hop (the redirect target is validated, not only the first URL) |
| UW8 | `ALLOWED_SOURCE_HOSTS` set: only listed hosts (exact match, no suffix tricks such as `example.com.evil.com`) pass; empty = any public host; production env has `ALLOW_PRIVATE_SOURCES` off so loopback is blocked, local env on permits it |
| UW9 | Size caps: text body over 5 MB -> `too_large` and the stream is cancelled (not fully read); sitemap over its cap likewise; `fetch-binary` over `maxBytes` -> `payload_too_large` with the stream cancelled; a client `maxBytes` larger than the server cap is clamped |
| UW10 | Content-type allowlist: HTML accepted for `page`; an image/zip returned for a `page` request -> `unsupported_type`; `fetch-binary` refuses `text/html` and an executable type; a mismatched extension/type is judged by the response type |
| UW11 | Charset: `ISO-8859-1` header, a `<meta charset=windows-1252>` page and a UTF-8 page decode to the correct text; a gzip sitemap and an `.xml.gz` sitemap body decompress; a truncated gzip -> `error.code = network` (not a `500`) |
| UW12 | `probe` returns etag/last-modified/length from `HEAD`; when the source returns `405` for HEAD, falls back to `GET` and aborts after headers (assert the body was not read) |
| UW13 | Credential scoping: with `SOURCE_AUTH` for host A, requests to A carry the credential; requests to B carry none; a redirect A -> B drops it and B -> A re-adds it; a redirect A -> A.evil.com never carries it; the inbound `Authorization` is never forwarded |
| UW14 | **Canary**: across success, every envelope error, every template error and an upstream that echoes the request headers in its body, the `SOURCE_AUTH` value never appears in any response body or header or log line (extends #2 US1) |
| UW15 | Outbound hygiene: fixed identifying `User-Agent`; only `GET`/`HEAD`; no `Cookie`, `Host`, `cf-*`, forwarded headers; source `Set-Cookie` is not relayed |
| UW16 | Logs contain request id, route, source **host** (not path/query), status, duration, outcome; never the URL query (which can carry signed tokens), token or credential |
| UW17 | `Retry-After` from the source is honoured in the template retry (delta and date forms) up to the cap; POST-style inbound requests are never retried by the worker |
| UW18 | Binary route streams: a 20 MB response is passed through without being buffered whole and without a redaction scan (assert via a stream that errors if read fully into memory) [depends on Question 9] |
| UW19 | Malformed requests: missing/invalid `url`, wrong `kind`, body not JSON, oversized request body -> `400`/`413` template codes |

## 2. Engine tests (seam M1; WTR in real Chromium; fake source + fake DA)

**Fixtures.** A set of real-world-shaped source pages (blog article, product page, landing page with hero + carousel + cards, page with nested/overlapping components, page with `<script>`/`style`/`onclick`/hostile markup, non-UTF-8 page, page with relative and absolute links/images/srcset/video poster, SPA shell with no content), a robots file with two sitemaps, a sitemap index with a gzip child, a 3,000-URL sitemap, and a fake DA Admin tree. Fixtures are static files in the extension's test folder (no network).

### 2.1 Discovery and crawl (AC1)

| ID | Behaviour asserted |
|---|---|
| UD1 | Sitemap `urlset` -> exact URL list; `lastmod`/`xhtml:link` ignored; malformed XML -> a clear error, not a crash |
| UD2 | Sitemap index recursion with depth cap; gz child; a cycle (index referencing itself) terminates; failed child sitemap is listed as a failure while others proceed |
| UD3 | Origin input -> reads `robots.txt` `Sitemap:` lines (multiple), falls back to `/sitemap.xml`; no robots + no sitemap -> message pointing to the URL-list input |
| UD4 | URL-list parser: blank lines, comments, duplicates, `#fragments`, relative URLs (rejected), mixed hosts (flagged off-origin) |
| UD5 | Normalisation and dedup: case, default port, dot segments, trailing slash, tracking-param stripping (configurable), query retention |
| UD6 | Include/exclude globs and page cap apply in documented order; the UI model reports counts per rule and "capped at N" |
| UK1 | Crawl runner: concurrency never exceeds the setting per host (assert max in-flight); results ordered/aggregated; progress counters monotonic |
| UK2 | Failure taxonomy: 404, 5xx, timeout, redirect-off-site, non-HTML, too-large, blocked-by-worker each produce the right result and reason; none abort the crawl |
| UK3 | Browser-side retry on worker `5xx`/network error (backoff via injected `sleep`), no retry on worker `401`/`403`; worker `401` pauses the crawl with "needs sign-in" and resumes with a new token |
| UK4 | Cancel keeps fetched pages and results; a re-start fetches only unfetched URLs |
| UK5 | Redirects: final URL becomes the page identity; two sources redirecting to one final URL yield one page and both `redirectedFrom` entries |
| UK6 | Attestation gate: no relay call is made until confirmed |
| UK7 | Empty-content detector flags SPA-shell/challenge pages ("no content in raw HTML") per R7 |

### 2.2 Mapping engine (AC2, AC3)

| ID | Behaviour asserted |
|---|---|
| UM1 | Page-type matching: path glob, selector-present, meta equals/contains, AND within a type, first match wins, default catches the rest; a page matching no type is reported unmapped |
| UM2 | `root` and `remove`: only root content is mapped; removed elements never appear; missing root -> warning and fallback to `body` (documented) |
| UM3 | Block rule `one-per-match`: N matches -> N blocks in document order with the correct class (name normalised, variants appended) |
| UM4 | Block rule `rows-per-match`: N matches -> one block with N rows (card list) |
| UM5 | Cell extraction kinds: text, inner HTML, image (`src` + `alt`), link (`href` + text), attribute, fixed text, join of multiple matches |
| UM6 | Claim order: a rule that matches an element already claimed by an earlier rule matches nothing there; reordering rules changes the output predictably; nested matches resolved by order |
| UM7 | Remaining content becomes default content, in source order, between/around blocks |
| UM8 | Sections: break selectors split sections; section style written to a section-metadata block; no break -> single section |
| UM9 | Page metadata: from `<title>`, `meta[property=og:*]`, selector, fixed value; missing source -> key omitted with warning; the block is `metadata` and last |
| UM10 | `required` rule/field matching nothing -> `missing-required` warning on that page and none on pages where it matched |
| UM11 | Invalid selector -> validation error naming the rule; engine continues with the other rules on every page |
| UM12 | **Determinism**: same input + profile -> byte-identical output across runs and across rule-array copies; output is a `<body><header></header><main>…</main><footer></footer></body>` fragment, one top-level `div` per section |
| UM13 | Block name normalisation: `Hero Banner`, `hero_banner`, `1hero`, `hero--x` -> valid EDS names or a validation error per the `da-content` rules |
| UM14 | Profile validation: unknown version newer than supported -> refused; older -> migrated; missing required fields -> field-level errors |

### 2.3 Sanitiser and serialiser (AC3, AC4; security)

| ID | Behaviour asserted |
|---|---|
| UX1 | `script`, `style`, `iframe`, `object`, `embed`, `link`, `meta`, `form` elements, inline `style`, `on*` handlers, `javascript:` and `data:text/html` URLs never appear in mapped output |
| UX2 | `class`/`id` stripped from default content; allowed inline tags preserved; block-cell inline normalisation (`b`->`strong`, `i`->`em`, spans stripped, `br` rules) |
| UX3 | Hostile source (nested template tags, SVG with script, malformed HTML, 10 MB single text node) maps without throwing and without script-bearing output; mapping time bounded |
| UX4 | A cell/default-content string containing `<img src=x onerror=…>` as *text* in the source stays inert text in output |

### 2.4 Paths, links, media (AC4)

| ID | Behaviour asserted |
|---|---|
| UP1 | Path rules: prefix strip, ordered regex replaces, lowercase, hyphenation of spaces/underscores/unicode, extension drop, `/` and empty path -> `index`, query handling, 900-char cap, `..` rejected |
| UP2 | Collisions: two sources to one target are reported in the plan; `suffix` mode yields stable deterministic suffixes independent of crawl order |
| UP3 | Internal link rewriting: absolute and relative hrefs (resolved against the **final** URL) to crawl-set pages become root-relative target paths, hash preserved; links outside the set stay absolute and are counted; `mailto:`/`tel:`/`#x`/other hosts untouched |
| UP4 | Media: `img`, `srcset`, `source`, `video[poster]`, linked PDF on the source origin are discovered; off-origin images left in place with a warning; rewritten to the absolute `content.da.live` URL under the media root |
| UP5 | Media names deterministic from the source path; same URL referenced from many pages uploads once; different URLs with equal sanitised names get a hash suffix only on collision |
| UP6 | Media guards: type allowlist, per-file cap, SVG > 40 KB warning, unsupported type skipped with reason; none abort the run |

### 2.5 Profile store and preview view-model (AC2, AC3)

| ID | Behaviour asserted |
|---|---|
| UR1 | Save then load round-trips a profile through the fake DA byte-for-byte; list shows all profiles for the site; duplicate/rename/delete behave; saved JSON contains no token/credential |
| UR2 | Save failure (403/5xx/rejects arbitrary JSON) keeps the in-memory profile and offers a download; no silent fallback; `401` pauses with "needs sign-in" |
| UR3 | Export then import reproduces the profile; an invalid file is rejected with field errors; unsaved indicator toggles correctly |
| UR4 | Two profiles for different source origins on one target site stay independent |
| UV1 | Selector match counts for the previewed page and across the whole crawl set are correct and update when the profile changes |
| UV2 | Dropped-text report: text in `root` absent from output is listed; text legitimately moved into cells is not; whitespace/order differences are ignored |
| UV3 | Preview warnings include required-missing, unmapped internal links, oversized media, invalid block name, path collision |
| UV4 | Source pane model: scripts/handlers/`base`/meta-refresh removed, URLs absolutised, highlight attributes added, nothing from the source reaches the extension document (only a `srcdoc` string); both frames carry `sandbox=""` (no `allow-scripts`, no `allow-same-origin`) |
| UV5 | A page can be previewed for any crawled URL without any DA call (assert the fake DA saw zero requests) — AC3 "before import" |

### 2.6 Planner, executor, report (AC4)

| ID | Behaviour asserted |
|---|---|
| UI1 | Target root validation: empty, `/`, upper-case, over 900 chars, `.da-versions`, non-drafts root requires confirmation; a non-empty target is shown from a listing (with paging) |
| UI2 | Plan: every document and media item listed with predicted action; collisions block run; unticked items are excluded; nothing is written during planning (zero DA writes) |
| UI3 | First run creates documents and media under the target root and media root; document references to media resolve to the written media paths; media written **before** documents (assert order) |
| UI4 | **Idempotent re-run**: second run with the same inputs yields all `unchanged` and zero DA writes; changing one rule updates only affected pages (`updated`), others `unchanged` |
| UI5 | `update-if-untouched`: a document edited in the fake DA after the first run -> `skipped-edited` and untouched; `overwrite` replaces it after confirmation; `skip-existing` skips every existing target |
| UI6 | Missing/corrupt manifest: existing targets are treated as "exists, unknown provenance" and skipped unless `overwrite`; the manifest is rebuilt after the run |
| UI7 | Per-item failures (403, 413, 500, 429) are isolated, reported with reason, others continue; 429/5xx retried with backoff (3 attempts); `daFetch` synthetic 500 retried; 4xx not retried |
| UI8 | `401` from DA pauses the run ("needs sign-in") without writing further items and resumes; no sign-in loop |
| UI9 | Cancel mid-run: in-flight items finish or fail cleanly; the report is accurate (`cancelled` for the rest); the manifest reflects exactly what was written |
| UI10 | Retry-failed re-runs only failed items; DA write concurrency never exceeds the setting (assert max in-flight) |
| UI11 | Lower-casing and name normalisation: targets are written at the normalised path and references rewritten to it; a path the server would lower-case is shown as a warning |
| UI12 | Report/exports: JSON and CSV have per-item status and reason; redirect CSV maps source URL to target path (including `redirectedFrom`); none contains tokens, credentials or document bodies |
| UI13 | Source change detection: with unchanged source ETag/size the media is not re-downloaded; with a changed one it is re-uploaded (`updated`) |
| UI14 | Writes use `POST` multipart field `data`, correct MIME types; a response of `200` or `201` counts as success, a `200` with a body indicating failure does not [fake DA reproduces the documented silent field-name failure] |

### 2.7 Token holder and UI render (AC1-AC4, AC8)

| ID | Behaviour asserted |
|---|---|
| UT1 | Token holder initialises from the SDK result; a parent `message` carrying `token` updates it; a message from another source window or without `token` does not; the token never appears in the DOM, console output, saved profile, manifest, report or exports |
| UT2 | Relay requests use the latest token; worker calls never go through `daFetch`; DA calls always do |
| UU1 | Render layer: every stage renders from state; all source-derived strings (URLs, titles, error text, selector text, extracted content) appear as text and `<img onerror>` payloads in them create no elements |
| UU2 | Standalone (SDK never resolves): "waiting" then "not running inside Experience Workspace"; all actions disabled |
| UU3 | Worker origin comes from a constant: a `?worker=` parameter is ignored; `localhost` uses the loopback worker, other hosts the fixed deployed origin (as hello-world HP5) |
| UU4 | Accessibility basics: stages reachable by keyboard, progress announced via a live region, buttons have names |

## 3. End-to-end tests (seam S1; Playwright, Chromium, hermetic)

Setup: `aem up` (or the static fallback) on `:3000`; the real extension worker via wrangler on `:8787` in the local env (`ALLOW_PRIVATE_SOURCES=true`, `IMS_ORIGIN` pointing at a throwaway fake-IMS key server); a throwaway **fake source site** (Node HTTP server serving the fixtures: robots, sitemap, pages, images, a 404, a slow page, a redirect); the DA Admin origin intercepted with `page.route` and served by the in-memory fake DA; the #1 SDK stub supplies a token signed by the test key and `context` with `org`, `repo`, `ref`, `daOrigin`. Any other external request is aborted (hermetic guard).

| ID | Behaviour asserted |
|---|---|
| E2E1 | Enter the fake sitemap -> crawl runs through the real worker over real cross-origin HTTP (preflight included) -> progress shown -> failures listed with reasons (AC1) |
| E2E2 | The same call with a token signed by a different key, and a bare request to the worker, get `401` (the browser surfaces "needs sign-in", not a crash) (AC8) |
| E2E3 | URL-list input of five URLs incl. the 404 -> four fetched, one failed with reason (AC1) |
| E2E4 | Edit a block rule (selector and cell) in the Rules stage -> preview updates; source pane left, mapped pane right; counts and dropped-text list visible (AC2, AC3) |
| E2E5 | Save the profile, reload the page, the profile is listed and loads identically (AC2 "saved per site"), and the fake DA holds the profile file |
| E2E6 | Choose target root, build plan, run: fake DA now contains mapped documents and uploaded media with rewritten references; report shows per-page results (AC4) |
| E2E7 | Run again: every item `unchanged`, zero DA writes recorded; change one rule, run: only affected pages `updated` (AC4 idempotency) |
| E2E8 | Edit a page in the fake DA, run again: `skipped-edited`; switch to overwrite, confirm, run: replaced (AC4) |
| E2E9 | Token, source credential (canary placed in the worker's env) and any secret never appear in page HTML/text, storage, saved profile/manifest, report downloads or any network response (AC8) |
| E2E10 | Standalone page shows the "not inside Experience Workspace" state and no network calls to the worker (AC7 partial) |

## 4. Runtime smoke tier (seam W2, `wrangler dev`, local, no Cloudflare login)

| ID | Behaviour asserted |
|---|---|
| SM1 | The extension worker (importing `shared/worker-template`) bundles and starts; a bare request returns `401` |
| SM2 | Valid test token: `fetch-text` of a local fake page returns the envelope; `probe` and `fetch-binary` against local fixtures work in workerd; preflight from an allowed and a disallowed origin behaves as in the unit tests |
| SM3 | SSRF: with `ALLOW_PRIVATE_SOURCES` off (production-like env) a loopback source URL is blocked in the real runtime |
| SM4 | `DecompressionStream`-based gz sitemap decompression works in workerd (resolves the Decision 9 assumption) |
| SM5 | A 20 MB binary streams through without exceeding memory; records CPU/wall time and subrequest count for text and binary routes (informational against R3/R13; no hard threshold until a baseline exists) |
| SM6 | Canary `SOURCE_AUTH` never appears over real HTTP (repeat of UW14) |

## 5. Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| UC1 | `apps/migration-assistant/` has entry page named after the folder, README, unit tests, e2e tests, and a `worker/` that satisfies the #2 checks (wrangler config, README, test; UR1-UR5 of #2) |
| UC2 | Root README extensions table has a `migration-assistant` row (name, folder, entry point, type `app`, description) and the row resolves to the real entry page (#1 AC5) |
| UC3 | The extension README documents an `apps` registration row (type consistency check from #1) and states "site config read: none", the worker secrets/vars, and the attestation note |
| UC4 | No cross-extension imports; no `providers/` code outside `providers/<vendor>/`; no tracked `.dev.vars*`; `SOURCE_AUTH` is listed under `secrets.required`, appears in `.dev.vars.example`, and is not in `vars` (#2 UR2-UR5) |
| UC5 | No token or credential literal patterns in committed fixtures (a simple scan for the test-key canary shapes) |

## 6. CI jobs (no secrets, no Cloudflare login)

Extends the #1 workflow (push + pull_request, no path filter) and the #2 additions.

| Job | Steps | Notes |
|---|---|---|
| `lint` (existing) | ESLint + Stylelint over extension and worker code; `npm run check` (S3 incl. UC1-UC5) | |
| `unit` (existing) | WTR: `UD`, `UK`, `UM`, `UX`, `UP`, `UR`, `UV`, `UI`, `UT`, `UU` | Import-map remaps SDK URL to the stub; fetch guard blocks external URLs |
| `worker-unit` (from #2) | `node:test`: `UW1-UW19` + template tests | |
| `worker-smoke` (from #2) | `SM1-SM6` | Wrangler telemetry off; advisory if flaky (#2 Question 11) |
| `e2e` (existing, extended) | `E2E1-E2E10` with the worker `webServer`, fake source server and fake DA routes | Chromium only |

## 7. Manual verification in EW (needs interactive Adobe login; cannot be automated)

Accounts and credentials needed: GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync); an Adobe IMS identity with write access to a **sandbox DA org/site** and permission to edit its site config; Chrome; a Cloudflare account with Wrangler login (as #2 W0); the deployed migration worker with `ALLOWED_SOURCE_HOSTS` left empty or listing the test hosts; for the protected-source check a throwaway password-protected test page (for example a Cloudflare-protected or htaccess-protected staging page the owner controls) and its credential set as the worker's `SOURCE_AUTH` secret. Public sources: `https://wknd.site/us/en.html` (URL list case), `https://main--aem-boilerplate--adobe.aem.live/sitemap.xml` (sitemap case), `https://www.aem.live/sitemap.xml` (larger sitemap, page cap case). No vendor API keys. Never paste a real IMS token or credential into chat, issues or logs.

- **MA0 (prereq):** worker deployed (`wrangler deploy` from `apps/migration-assistant/worker/`, `SOURCE_AUTH` set, even as `{}`); bare `curl -i <worker>/v1/fetch-text` returns `401` (liveness + AC8 negative). Code Sync live: `curl -I https://main--ew-extensions--jazhou-adobe.aem.live/apps/migration-assistant/migration-assistant.html` returns `200`.
- **MA1 (app, `ref=local`):** `npm start` (port 3000) and the worker dev script (port 8787); open `https://da.live/app/jazhou-adobe/ew-extensions/apps/migration-assistant/migration-assistant?ref=local`; accept the trust prompt; the six-stage shell renders; DevTools shows no token in the DOM. (AC7)
- **MA2 (app, branch ref):** push branch `migration-assistant` (simple name), wait for code sync, open the same URL with `?ref=migration-assistant`; same behaviour; the deployed worker is called; record the page `Origin` as in #2 W3. (AC7)
- **MA3 (Apps menu):** add the `apps` row to the sandbox site config; the card appears at `https://da.live/apps#/jazhou-adobe/ew-extensions` and opens the app. (AC6)
- **MA4 (crawl):** URL list with `https://wknd.site/us/en.html` plus a deliberately bad URL; sitemap of aem-boilerplate; observe progress and the failure list; DevTools Network shows requests only to the worker (never to the source host) and responses carry CORS headers readable by the page. (AC1)
- **MA5 (rules + preview):** build a profile for the wknd page type (hero, cards, default content, metadata); see source vs mapped side by side, selector counts, dropped-text list; Save; reload the app; the profile reloads; open `https://da.live/` browse on the sandbox site and confirm the profile file exists in the DA folder (and that a colleague with access sees it). (AC2, AC3)
- **MA6 (import):** target root `/drafts/migration/wknd`; build plan; run; open an imported page from the report in the EW editor: blocks render as table-form blocks in the DA editor; images load from `content.da.live`; preview one page on `aem.page` and check no `about:error` images. Record SVG/oversize behaviours. (AC4)
- **MA7 (idempotency/edits):** run again: all `unchanged`; edit one imported page in DA; run again: that page `skipped-edited`; change one rule: only affected pages `updated`; confirm DA versions exist for an `overwrite`d page. (AC4)
- **MA8 (security):** with a token-less `curl` and with `Origin: https://evil.example` plus a valid token against the deployed worker: `401` and `403`; `curl` the relay to `http://169.254.169.254/` and `http://localhost/` with a valid token: blocked envelope. Search the page source, DevTools storage and the saved profile for the source credential value (none). (AC8)
- **MA9 (token refresh / long run):** crawl+import a 150-page subset of the aem.live sitemap (page cap setting) and keep the tab open past a token refresh; observe either seamless continuation or a clean pause with "needs sign-in" and resume; note token lifetime observed. (R10)
- **MA10 (protected source):** with `SOURCE_AUTH` set for the test host, crawl the protected page: success; without the secret: `source_status 401`; confirm the credential is never visible in DevTools Network, console or the exported report. (AC8)
- **MA11 (JS-rendered source):** crawl a known client-rendered page: the "no content in raw HTML" warning appears. (R7)
- **MA12 (cleanup):** delete the sandbox target folder and verify the manifest/profile can be removed by hand (documented in README).

Record screenshots/notes in the PR description (the #1 PR template asks for branch-ref test URLs).

## 8. Acceptance-criteria traceability (ticket #12)

| # | Acceptance criterion (#12) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Admin enters a sitemap or URL list; the worker fetches pages (no browser CORS limits) and shows crawl progress and failures | UD1-UD6 (inputs, index/gz, robots, normalisation, filters); UK1-UK7 (concurrency, failures, retries, cancel, redirects); UW3-UW5, UW9-UW12 (relay behaviour); E2E1, E2E3 (real cross-origin browser-to-worker path) | **MA4** (progress, failure list, only the worker contacted, CORS readable), MA9, MA11 |
| AC2 | Mapping rules (selector or content-type to block, field to cell) are editable in the app and saved per site | UM1-UM14 (page types, block/cell rules, determinism, validation); UR1-UR4 (persistence per site, export/import, failure handling); UV1 (live match counts); E2E4, E2E5 | **MA5** (build a profile, save, reload, visible to a colleague, file present in DA) |
| AC3 | Preview shows source vs mapped EW document side by side for any page before import | UV1-UV5 (counts, dropped text, warnings, sandboxed frames, zero DA writes); UX1-UX4 (output safety); UU1; E2E4 | **MA5** (side-by-side on real pages), MA6 (raw HTML tab vs what lands in DA) |
| AC4 | Import writes documents and media into DA under a chosen path; re-running is idempotent and reports per-page results | UP1-UP6; UI1-UI14 (validation, plan, ordering, conflict modes, idempotency, manifest, retries, 401 pause, cancel, report/exports); E2E6-E2E8 | **MA6** (real import, `aem.page` check), **MA7** (re-run, edited-in-DA, rule change, versions) |
| AC5 | All code in its own self-contained `migration-assistant` folder (per the scaffold convention), with a README covering setup, the EW config-sheet row that enables it, and any site config it reads | UC1, UC3, UC4 (structure, README contents, worker conventions) | Review: README sections exist (setup, `apps` row, site config read: none, worker deploy/secrets/vars, profile reference, positioning); a reviewer follows setup on a scratch clone to `ref=local` (MA1) |
| AC6 | Listed in the repo README extensions table and reachable from the EW Apps menu | UC2 (table row resolves to the entry page) | **MA3** (card on `https://da.live/apps#/{org}/{site}` opens the app) |
| AC7 | Works in EW with `ref=local` and with a branch ref | E2E10 and UU2/UU3 (standalone state, worker-origin constant); the whole e2e tier runs the page from the local server | **MA1** (`ref=local`), **MA2** (branch ref + real `Origin`), MA6 and MA9 repeated on a branch ref |
| AC8 | Vendor credentials live only in this extension's worker (built from the shared worker template); the browser never receives them; unauthenticated calls to the worker are rejected | UW1 (every route 401 without a valid token), UW2, UW13-UW16 (credential scoping, canary, hygiene), UW18; UT1, UT2; UC4; E2E2, E2E9; SM1, SM6 | **MA0** (bare call 401), **MA8** (negatives, SSRF, credential search), **MA10** (protected source) |
| AC9 | Core logic covered by unit tests; lint and CI green | Every UD/UK/UM/UX/UP/UR/UV/UI/UT/UU/UW test above runs in CI jobs `unit` and `worker-unit`; `lint` job; UC1-UC5 | Review: the CI run on the PR is green; deliberately break a rule (loosen the SSRF check, break claim order) on a scratch branch and see UW6/UM6 fail |

Every acceptance criterion on #12 maps to at least one automated test or a numbered manual verification step above.

## 9. Open questions for the owner

1. **Cloudflare account and plan.** Personal vs Adobe-provided account (carries over #2 Q1; the relay also crawls third-party sites and handles Adobe IMS tokens). Workers Free (10 ms CPU, 50 subrequests) is assumed workable for one-URL-per-call relaying; confirm Free vs Paid.
2. **Open-relay policy (R2).** Is "any authenticated Adobe user may make the worker fetch any public URL" acceptable by default, or should `ALLOWED_SOURCE_HOSTS` be required (one deploy-time list per migration) and/or a per-user rate limit? Default proposed: any public host, IMS client-id allowlist on, README warns.
3. **`robots.txt` policy.** Proposed: not enforced for `Disallow`, used only for sitemap discovery, plus an explicit "I am authorised to copy this content" attestation. Acceptable?
4. **Profile and manifest location.** Proposed: a dot-prefixed folder in the target site's DA content, written as ordinary JSON; to be verified in the sandbox spike (0b) with fallback to a normal folder. Do you prefer a different home (site config sheet, repo file, or browser-only with export)?
5. **Media destination and URL form.** Proposed: `{target root}/media` and absolute `https://content.da.live/...` references. Does the target site's convention differ (shared top-level `/media`)? And what is the right media origin for Helix-6 sites?
6. **Preview fidelity.** v1 is a structure preview in sandboxed frames. Do you want a stretch "preview on the target site" step (write to a scratch path, call the AEM preview API, open the real `aem.page` render), which adds `admin.hlx.page` calls and permissions? And click-to-pick selectors?
7. **Overwrite default.** Proposed default is `update-if-untouched` (never clobber an author's DA edits). Confirm, and confirm DA version history makes `overwrite` acceptable.
8. **Source credentials in v1.** Ship the optional host-scoped `SOURCE_AUTH` secret in v1 (gives AC8 real content) or defer protected sources? If shipped: the template requires secrets to be declared and set (`secrets.required` fails deploy if unset), so an "optional" secret is operationally "set it to `{}` once" unless the template adds optional secrets (Question 9).
9. **Template changes (needs the #2 owner/Main).** The relay needs: (a) an official per-call dynamic `allowedHosts` plus an SSRF "public host" validator (the template's helper assumes a route-declared allowlist); (b) optional secrets; (c) permission to add extension error codes (`source_blocked`) without it counting as a breaking contract change; (d) a per-route opt-out of response-body redaction for binary passthrough (a 20 MB scan breaks the 10 ms Free CPU limit and cannot match a secret the source never receives). Approve these as template additions, or I implement them in this extension's worker only?
10. **Scale target.** Defaults: 500 pages, hard cap 2,000 per run. Is that the right target for presales demos and pilot migrations, with 10k+ routed elsewhere as the AEM docs advise?
11. **Positioning and overlap.** Confirm with the EW team that no first-party in-EW mapping UI is planned, and that building this does not conflict with the Import app or AEM Importer roadmap (ticket's own caveat).
12. **Adobe outside-activity/IP policy** (inherits #1 R1) and content-rights stance for a tool that copies third-party content; who signs off before this is shared?
13. **Test sources.** OK to use `wknd.site` and the `aem.live` sitemaps as light manual-test sources, or should the owner host a dedicated fixture site (preferred for repeatability)?
14. **Shared test harness.** The fake DA Admin is needed by Deep Clone and this extension (and likely others); promote it to a shared harness at repo root (extensions may not import each other), or keep per-extension copies?
15. **Click-through legal text and README wording** for the attestation, and whether the app should record the attestation (user, time) in the manifest.
