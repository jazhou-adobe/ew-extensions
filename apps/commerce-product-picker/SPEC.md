# Spec: Commerce Product Picker: Adobe Commerce catalog

Ticket: jazhou-adobe/ew-extensions#3 (this spec: #41). Blocked by: #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe.

Vocabulary follows #1 and #2: *extension* = one folder `apps/<name>/`; *library plugin* = an extension registered in the `library` tab of the EW site config; *worker* = the per-extension backend in `apps/<name>/worker/`; *template* = `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension. Commerce vocabulary: *Catalog Service* = the Adobe Commerce SaaS extension that exposes read-only catalog GraphQL (`productSearch`, `products`, `categories`); *store view* = the Commerce scope selected by the `Magento-Store-View-Code` header; *SKU* = the catalog's stock-keeping unit, the only identifier this extension writes into a page.

Primary sources read (all 2026-11-16):
- EW developing docs (SDK, `sendHTML`, plugins): https://www.aem.live/docs/ew/developing/apps-plugins
- DA App SDK and host source: https://da.live/nx/utils/sdk.js; `adobe/da-live` `blocks/canvas/ew-panel-extensions/iframe-protocol.js` and `helpers.js` (`insertHTML`, `replaceHTMLAtCursor`); the editor schema bundled in `adobe/da-live` `deps/da-parser/dist/index.js`.
- Catalog Service GraphQL docs: https://developer.adobe.com/commerce/webapi/graphql/schema/catalog-service/ , `.../queries/products`, `.../queries/categories`, https://developer.adobe.com/commerce/webapi/graphql/schema/live-search/queries/product-search (the `productSearch` query shared by Live Search and Catalog Service), headers: https://developer.adobe.com/commerce/webapi/includes/graphql/catalog-service/headers
- Adobe Commerce Optimizer Merchandising API: https://developer.adobe.com/commerce/services/optimizer/merchandising-services/using-the-api/
- Storefront configuration (endpoints, headers, Optimizer headers): https://experienceleague.adobe.com/en/tools/commerce-storefront/setup/configuration/commerce-configuration
- Storefront blocks reference and block docs: https://commerce-docs.github.io/microsite-commerce-storefront/_llms-txt/blocks-reference.txt ; boilerplate source `hlxsites/aem-boilerplate-commerce` (`blocks/product-list-page`, `blocks/product-details`, `blocks/product-recommendations`, `scripts/aem.js` `readBlockConfig`, and the removed `blocks/product-teaser` at commit `ae50c05e~1`).
- Block markup: https://www.aem.live/developer/markup-sections-blocks
- Live observations against Adobe's public demo storefront backend (`https://www.aemshop.net/cs-graphql`, its connection values are published in the public https://main--aem-boilerplate-commerce--hlxsites.aem.live/config.json): response shapes, error shapes and edge cases recorded in Further Notes.
- Upstream conventions: https://github.com/adobe-rnd/ew-extensions (no Commerce, picker or worker code exists there; checked via the GitHub tree API).

---

## Problem Statement

A content author building a commerce page in Experience Workspace (EW) needs to put real catalog products on it: a product teaser, a short list of featured items. Today the author has to leave EW, open the Adobe Commerce admin or the live storefront, find each product, copy its SKU, come back, and type the SKU into a block table by hand. Typos give a block that silently renders nothing; there is no way to see the product's image, price or stock state from inside the editor; and an author who does not know the SKU can only guess.

Commerce storefronts are a headline EW use case, and the equivalent experience exists elsewhere: Contentful's Shopify and commercetools apps let an author search and pick products without leaving the editor (https://www.contentful.com/marketplace/apps/). EW has no equivalent for Adobe Commerce.

Two constraints make this more than a UI task. First, the catalog API sits behind credentials and store-scope headers that must not be shipped in a public EDS code bus. Second, the storefront renders the product data itself at request time, so the page content must carry a stable reference (the SKU), not a copy of the product.

## Solution

A library plugin, **Commerce Products**, available from the EW editor library. The author:

1. Opens the library and chooses **Commerce Products**.
2. Searches by keyword or SKU, or browses the category tree; results show a product image, name, SKU, price and stock state, with paging, a clear empty state, and plain-language error states.
3. Ticks one or many products (the selection persists across pages and searches), optionally also adds SKUs by pasting a list.
4. Presses **Insert**. The plugin writes block markup at the editor cursor through `actions.sendHTML`, one SKU-carrying block per product (or one list block, per the site's configuration), and closes the library.

The block the plugin writes is a SKU reference only. Name, price, image and stock stay live on the storefront because the storefront's own commerce block renders them at request time; the page never goes stale.

Behind the plugin is a per-extension Cloudflare worker built from the shared template (#2). The worker authenticates the caller by IMS token, applies the site's Commerce endpoint, store view and credentials, calls the Catalog Service GraphQL API, and returns a small normalized product/category contract. The browser never sees a Commerce credential, an endpoint it could call directly, or raw vendor responses.

## User Stories

Content author (primary actor):

1. As a content author, I want to find the **Commerce Products** plugin in the editor library, so that I can pick products without leaving EW.
2. As a content author, I want to search by keyword, so that I can find a product by what it is called.
3. As a content author, I want to paste or type a SKU into the same search box and get that exact product, so that I can confirm a SKU I already know.
4. As a content author, I want to browse the category tree and open a category, so that I can find products when I do not know their names.
5. As a content author, I want each result to show an image, name, SKU and price, so that I can recognise the right product.
6. As a content author, I want prices for products with variants (configurable, bundle) shown as a range, so that I am not misled by a single number.
7. As a content author, I want to see when a product is out of stock, so that I do not feature something shoppers cannot buy.
8. As a content author, I want results paginated with a visible position (page X of Y, total count), so that I can move through a large catalog.
9. As a content author, I want a clear "no products found" state that suggests what to try, so that an empty result is not mistaken for a failure.
10. As a content author, I want a plain error message when loading fails, with a retry button and no technical detail, so that I know whether to try again or contact an admin.
11. As a content author, I want search to wait until I stop typing and to ignore stale responses, so that results never flash the wrong list.
12. As a content author, I want to select a single product, so that I can insert one teaser.
13. As a content author, I want to select many products, so that I can insert a featured list in one step.
14. As a content author, I want my selection to stay when I change page, search or category, so that I can assemble a list from several searches.
15. As a content author, I want a selection tray that shows what I have picked with a remove button on each, so that I can fix a mistake before inserting.
16. As a content author, I want to paste a list of SKUs (one per line or comma separated) and have the plugin resolve them, so that I can insert a product list from a spreadsheet or campaign brief.
17. As a content author, I want SKUs that do not exist to be reported by name, not silently dropped, so that I can correct them.
18. As a content author, I want the **Insert** button to say how many products it will insert and to be disabled for an empty selection, so that I know what will happen.
19. As a content author, I want Insert to place the block(s) at my cursor and close the library, so that I can carry on editing.
20. As a content author, I want the inserted block to appear as an ordinary block table in the document, so that I can see and edit it like any other block.
21. As a content author, I want the page preview to render the inserted products with live name, price and image, so that my page is correct without further work.
22. As a content author, I want the same product inserted twice to be inserted once, so that I do not create duplicate blocks by double-clicking.
23. As a content author, I want a sensible cap on how many products I can insert at once, with a message when I hit it, so that I do not paste a 500-product wall by accident.
24. As a content author, I want the plugin to tell me when Commerce has not been set up for my site, so that I know to ask an admin and do not think the plugin is broken.
25. As a content author, I want the plugin to say so when I open it outside EW, so that a stray browser tab does not look like a bug.
26. As a content author, I want the plugin to be usable at the width of the library panel and keyboard accessible (search, results, selection, insert), so that it fits the editor and works without a mouse.
27. As a content author, I want the products' names and other catalog text shown as plain text, so that unusual catalog content can never break or hijack the editor.

Site administrator / developer who enables it:

28. As a site administrator, I want to enable the plugin with one row in the site's `library` config, so that setup is copy-paste.
29. As a site administrator, I want to configure my Commerce endpoint, store view and credentials per site, so that each site's authors see only that site's catalog.
30. As a site administrator, I want credentials to live in the worker's secret store only, so that nothing sensitive is visible in the public site code.
31. As a site administrator, I want to rotate the Commerce API key with one command and no code change, so that a leaked key is a five-minute fix.
32. As a site administrator, I want to choose which storefront block name and which config rows the plugin writes (one block per product, or a single list block), so that it matches my storefront's block contract.
33. As a site administrator, I want to set the category tree root, the default page size and the insert cap per site, so that the picker fits my catalog.
34. As a site administrator, I want a README that lists exactly what to configure (config-sheet row, worker variables, secret names, store headers), so that I can enable the plugin without reading code.
35. As a site administrator, I want a documented list of what the storefront block must accept, so that I can build or adapt the block.

Maintainer / reviewer:

36. As the maintainer, I want the worker to reject any request without a valid IMS token and any disallowed origin, so that nobody can use my Commerce credentials from the internet.
37. As the maintainer, I want one test that walks every worker route and asserts it rejects an unauthenticated call, so that a newly added route cannot forget auth.
38. As the maintainer, I want the Commerce credential proven absent from every response, header, log line and page, so that "never leaves the worker" is tested, not promised.
39. As the maintainer, I want unit tests that run in CI with no Commerce account, no Adobe login and no Cloudflare login, so that regressions are caught on every push.
40. As the maintainer, I want an optional live contract check against a real catalog, so that drift in the Catalog Service API is detected without making CI depend on a third party.
41. As the maintainer, I want the plugin listed in the root README extensions table and its folder to pass the convention check, so that it is discoverable and consistent.
42. As the maintainer, I want a second commerce backend (Shopify, commercetools, Adobe Commerce Optimizer) to be addable without touching the browser UI, so that today's vendor choice is not a rewrite later.
43. As the maintainer, I want to verify the plugin in real EW with `ref=local` and with a branch ref, so that I can try changes before merging.

Security reviewer:

44. As a security reviewer, I want request parameters validated and bounded (length, page range, SKU count, charset), so that nobody can use the worker to run arbitrary or expensive catalog queries.
45. As a security reviewer, I want the Commerce endpoint to come only from worker configuration and never from a request, so that the worker cannot become an open proxy.
46. As a security reviewer, I want the worker's responses limited to an allowlisted set of product fields, so that new vendor fields never leak by default.
47. As a security reviewer, I want the markup builder to construct the DOM rather than concatenate strings, so that a hostile SKU cannot inject HTML into the document.

## Implementation Decisions

(No file paths or code, except where noted. Layout is in the Build Analysis.)

1. **Extension type and registration.** A library plugin, registered in the `library` tab of the site config (type from the config sheet, per the decided convention). One entry page, no fullscreen app. Title **Commerce Products** (not one of the reserved names `blocks`, `templates`, `icons`, `placeholders`, `aem-assets*`; #1 spec section 2.5). `experience` is left to the owner's testing: the picker is dense (grid, filters, selection tray), so `window` or `fullsize-dialog` may suit better than `inline`; their semantics are undocumented [OPEN, MV2 decides].
2. **Built on the shared worker template; one worker for this extension.** The worker follows the #2 contract unchanged: origin gate, IMS token verification before routing, secrets accessor, `proxy` helper with retries, error contract, redaction, logging. This spec adds only extension routes and a provider module. No auth, CORS, retry or secret code is written in this extension.
3. **Provider boundary.** The browser UI is vendor-neutral. It consumes a normalized contract (config, categories, product page, SKU lookup; Data contracts in the Build Analysis). The Adobe Commerce specifics (GraphQL documents, headers, field mapping, error mapping) live in a provider module in `providers/adobe-commerce/worker/` and are registered by the extension's worker entry (the #2 Decision 3 placement; the refinement is awaiting owner confirmation there [OPEN]). A later Shopify, commercetools or Optimizer ticket adds a sibling provider and a `backend` value, with no browser changes.
4. **First provider = Catalog Service flavour of Adobe Commerce.** It targets the Catalog Service GraphQL schema (`productSearch`, `products`, `categories`), which Adobe documents as the read API for Edge Delivery storefronts [VERIFIED: https://experienceleague.adobe.com/en/tools/commerce-storefront/setup/configuration/commerce-configuration , `commerce-endpoint` is "read-only ... Catalog Service, Live Search, and Product Recommendations"]. It covers Adobe Commerce PaaS (headers `Magento-Store-Code`, `Magento-Store-View-Code`, `Magento-Website-Code`, `Magento-Environment-Id`, `x-api-key`) and Adobe Commerce as a Cloud Service (same store headers; no API key or environment id by default) [VERIFIED: same page and https://developer.adobe.com/commerce/webapi/includes/graphql/catalog-service/headers]. Adobe Commerce Optimizer uses different headers (`AC-View-ID`, `AC-Price-Book-ID`, `AC-Policy-*`, optional signed JWT in `AC-Catalog-View-Access-Token` for private catalog views) and a Merchandising API whose schema equivalence with Catalog Service I did not verify; it is a follow-up provider, not built here [VERIFIED headers; ASSUMPTION on schema; OPEN].
5. **Per-site configuration (AC3).** The worker holds a site table: a non-secret `vars` entry mapping a site key (`org/site`, taken from the SDK `context`) to that site's settings, and one secret per site that needs a credential. Non-secret settings per site: backend flavour, GraphQL endpoint, store codes and view codes, optional customer-group header, environment id, root category id, page size, insert cap, and the **insert profile** (Decision 9). Credentials: the PaaS `x-api-key` as a Cloudflare secret whose name is given explicitly in the site entry (a `credentialRef` suffix), declared under `secrets.required` so a deploy without it fails (#2 Decision 7). A site with no credential requirement (Cloud Service default) has no secret. The request names the site; the worker uses it only to select among the sites the operator configured, never to build a URL (Decision 12). An unconfigured site is a clean "not configured" state in the UI, not an error.
6. **Why the worker is still required when Catalog Service keys are public.** Adobe's own storefront config ships the Catalog Service key in the public `config.json` (it is in the browser for every shopper) [VERIFIED: https://experienceleague.adobe.com/en/tools/commerce-storefront/setup/configuration/commerce-configuration ; demo config observed]. The worker is therefore not hiding a high-value secret in the PaaS case; it still (a) satisfies AC7, (b) keeps endpoint and store scope out of a public extension bundle, (c) gives per-user authentication and a place to rate-limit, and (d) is the only safe home for credentials that are genuinely private (Optimizer private catalog views need a signing key; a Cloud Service tenant behind an admin token). The README states this trade-off plainly so nobody believes the worker is "securing" a public key.
7. **Worker routes (all behind the template's auth; all read-only).** `config` (non-secret subset the UI needs), `categories` (subtree of the configured root), `products` (search and category browse with paging and sort), `products/lookup` (resolve a list of exact SKUs). There are no write routes and no cart, price-mutation or customer routes. Each route validates its inputs against fixed bounds (Decision 11). Idempotent `GET`s except `lookup`, which is a `POST` carrying a JSON array of SKUs (avoids a comma-in-SKU ambiguity and URL length limits).
8. **Search semantics.** Keyword: one `productSearch` call with the phrase, the page size and number, optional sort, and a fixed visibility filter (`Search` and `Catalog, Search`) as the boilerplate's own product list page applies [VERIFIED: `hlxsites/aem-boilerplate-commerce` `blocks/product-list-page/product-list-page.js`]. SKU-like input (matches the SKU charset, 2 to 64 characters) additionally asks for `products(skus:[input])` in the *same* GraphQL document, and on page 1 an exact SKU hit not already in the results is placed first (the demo backend already returned an exact SKU through `productSearch` alone, but partial or differently tokenised SKUs are not guaranteed to [VERIFIED observation; ASSUMPTION on other catalogs]). Category browse: empty phrase plus `categoryPath eq <urlPath>` and default sort `position`, as documented for category pages [VERIFIED: https://developer.adobe.com/commerce/webapi/graphql/schema/live-search/queries/product-search "Filtering by categories"]. Sort options exposed: relevance/position, name, price ascending and descending (the documented default sortable attributes) [VERIFIED]. Search depth is capped by the API at 10,000 products per query [VERIFIED docs]; the UI and the worker clamp the requested page accordingly.
9. **What gets inserted (AC2): a SKU reference, per a per-site insert profile.** The profile names the storefront block and its rows: `mode` = one block per product (default) or one list block; the block name; the SKU row key (`sku` for one product, a configurable key such as `skus` for list mode); optional extra static rows (for example a details-button flag). The default profile targets the SKU teaser contract of the boilerplate's former `product-teaser` block: a block whose config rows include `sku` (plus optional `details-button`, `cart-button`) [VERIFIED from source at commit `ae50c05e~1` of `hlxsites/aem-boilerplate-commerce`]. **Important finding:** the current boilerplate no longer ships a SKU teaser or SKU list block. The commit "Removes widgets and custom plp (#591)" (2025-06-25) removed `product-teaser`; today's commerce blocks are `product-details` (SKU from page metadata or URL), `product-list-page` (category `urlpath`, or search), and `product-recommendations` (optional `currentsku`) [VERIFIED: tree listing and block sources]. So "the SKU-based block the storefront already renders" is a *site contract*, not something the plugin can assume exists. The plugin is therefore profile-driven, the README documents the contract a storefront block must satisfy, and the owner decides whether to ship a reference block (Open Questions). List mode writes SKUs one per paragraph in the value cell, which `readBlockConfig` returns as an array, or comma-joined per profile [VERIFIED: `scripts/aem.js` `readBlockConfig`: multiple `p` in the value cell give an array; ASSUMPTION that the DA editor keeps one `<p>` per line].
10. **Block markup is built as a table, via the DOM.** `actions.sendHTML(html)` without `replace` is a fire-and-forget `postMessage`; the host runs `insertHTML`, which parses the string with ProseMirror's DOM parser from the editor schema and inserts at the selection [VERIFIED: `sdk.js`, `iframe-protocol.js`, `helpers.js`]. The editor schema bundled with da-live has parse rules for `table` (with `colspan`) and no rule for `div`; the host's "EDS block" conversion (`htmlToProse`) exists only in the *replace* path, which overwrites the block under the cursor [VERIFIED by reading `helpers.js` and the bundled schema 2026-11-16]. Consequence [INFERENCE from source, to be proved by spike MV1 and unit proof MK*]: a `<div class="product-teaser">...</div>` payload would likely be flattened into plain text, while a `<table>` payload becomes a DA block table (first row = block name, one row per key/value), which DA serialises to the `div` block markup the storefront reads. The decision is to send table markup, build it with DOM APIs (never string concatenation), and escape through the DOM. `replace: true` is not used (it overwrites the block at the cursor and needs the `sendHTMLReplace` capability). Whether a block table inserted while the cursor sits inside another block's cell nests or splits is unverified [OPEN, MV1].
11. **Input validation, per route.** Keyword length 1 to 100; page size 1 to a per-site cap (default max 48); page 1 to `ceil(10000 / pageSize)`; sort from a fixed set; category identifier from a fixed charset and length, and it must be a category returned by the configured tree (the worker resolves it rather than trusting it); `lookup` body: JSON array of 1 to 50 strings, each trimmed, 1 to 64 characters, no control characters, deduplicated; unknown query parameters ignored. Bad input yields the template's `400 bad_request` before any upstream call. GraphQL documents are constants with variables; no string interpolation of any request value into a document.
12. **No open proxy.** The upstream URL is built only from the site configuration. The `proxy` helper's `allowedHosts` is the configured endpoint host of the selected site. No request parameter chooses a host, path or header. The caller's `Authorization` is never forwarded (template behaviour, asserted again here).
13. **Upstream error mapping (provider responsibility).** Catalog Service returns GraphQL errors with HTTP 200 (observed: out-of-range page gives HTTP 200 with `data: null` and a `FAILED_PRECONDITION` error) and returns a non-GraphQL JSON body with HTTP 403 for a bad API key (observed). The template's status-based mapping does not see the first case. The provider maps: out-of-range page to an empty page (the worker clamps and re-queries once, or returns an empty page) [ASSUMPTION on the best behaviour]; other GraphQL errors to `502 upstream_unavailable`; upstream `401/403` to `500 misconfigured` (a deployer problem, not the author's, and the log carries the status and the site key, never the credential); `429` and `5xx` handled by the template's retry. Read-only GraphQL queries are `POST`s to the vendor, so the provider passes the template's explicit "safe to retry" flag (#2 Decision 8; depends on the owner accepting the opt-in design, #2 Open Question 6). No upstream error text reaches the browser.
14. **Normalized product contract (what the browser gets).** Allowlisted fields only: `sku`, `name`, `type` (`simple` or `complex`), `inStock`, `urlKey`, `image` (https URL, alt text), `price` (final and regular as a currency plus a number, or a minimum/maximum range for complex products). Prices are display-only and are never written into the page. Image URLs are accepted only as `https`. Non-ISO currency codes occur in the wild (the demo backend returned the literal currency `NONE` for a configurable product's minimum price [VERIFIED observation]); the browser must format defensively (Decision 17).
15. **Browser module split (the #1 convention).** (a) A side-effect-free *logic* layer: picker state (query, category, page, sort, selection, status), the request/response normaliser for the worker contract, the markup builder, price formatting; exported for tests. (b) A thin *view/bootstrap* layer: awaits the SDK, wires `fetch`, renders text-only DOM, calls `actions.sendHTML` then `actions.closeLibrary`. The worker origin is a constant in the extension, never taken from the URL; `localhost` pages use the local worker and every other host the deployed worker (#2 Decision 13; a `?worker=` parameter is ignored and tested).
16. **Worker call behaviour.** Every call sends `Authorization: Bearer <SDK token>`, has a bounded wait (aborted with a plain message), and cancels the previous in-flight search (stale responses never render). Search input is debounced. The token is never rendered, logged or stored.
17. **Rendering rules.** All catalog text is rendered with text-content APIs, never as HTML. Images use `https` only, with an empty `alt` when the catalog supplies none and a neutral placeholder on load failure. Money is formatted with `Intl.NumberFormat` and the item's currency; an invalid currency code falls back to the plain number plus the raw code rather than throwing. Out-of-stock products stay selectable (an author may be planning a restock page) but are visibly marked.
18. **Selection and insert rules.** Selection is a map keyed by SKU, bounded by the per-site insert cap (default 20). Insert builds markup from the selected SKUs in selection order, deduplicated. Before inserting, the plugin re-resolves the SKUs through `lookup` and refuses to insert SKUs the catalog no longer has (and says which), so a stale tab cannot write dead references. After a successful `sendHTML` call the plugin calls `closeLibrary` (`sendHTML` gives no acknowledgement, so "successful" means the call did not throw and the markup was non-empty). An empty selection never calls the SDK.
19. **Configuration surfaces recorded in the README.** The site config `library` row; the worker `vars` site table (schema with a fully worked example); the secret names and the `wrangler secret put` command per site; the insert-profile reference and the storefront block contract; how the extension finds its worker origin; what a second site needs. The README also points at the owner-facing policy notes from #1 (outside-activity/IP; no public marketplace process found) and does not restate them.
20. **Tooling.** Nothing new beyond #1 and #2: ESLint 8 helix config, Stylelint 16, `@web/test-runner` for browser unit tests, `node:test` for worker tests, Playwright (Chromium) for hermetic e2e, wrangler 4 for the worker. No bundler, no framework: vanilla DOM, like the hello extensions.
21. **No Commerce write access.** The worker holds, and is configured with, read credentials only. No cart, order, customer or admin endpoint is reachable through any route. The README says the operator should create a read-scoped credential where the platform allows it.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given a worker request (and a faked Commerce upstream) assert the response, the outbound request(s) the worker made, and what was logged; given an SDK result and a faked worker, assert what the picker shows and which SDK actions were called with what payload. Never assert on internal helper names, internal state shape, or CSS classes; DOM assertions use roles, labels and text. The two most important properties are tested as negative properties across every code path: "the Commerce credential never appears anywhere" and "no route answers without a valid token".

**Proposed seams** (recorded instead of asked, per #41). All existing seams from #1 and #2 are reused; one small new seam (markup contract) is added for AC2.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 (primary for the worker) | The worker's HTTP boundary `worker.fetch(request, env, ctx)` | reused from #2 | Node tests for this extension's worker | Constructed `Request`; test-kit `makeEnv` and fake IMS; **fake Commerce upstream** from the test kit (`fakeUpstream`) replaying recorded Catalog Service responses and recording every request it receives |
| S1 | Entry page + SDK module boundary + real worker | reused from #1, extended as in #2 | Playwright e2e | `page.route` SDK stub with test-signed token; real worker in wrangler (W2 style) with a throwaway local fake Commerce server |
| S2 | Browser logic/view modules + SDK result + injected `fetch` | reused from #1 | WTR unit tests | Hand-built SDK result with recorded `actions`; injected fake `fetch` serving worker-contract fixtures |
| S3 | Repo convention check | reused | CI lint job | Temp-dir fixtures (adds the new rules in the traceability section) |
| M1 (new, small) | **Markup contract:** the markup the plugin sends to `sendHTML`, converted the way DA documents say blocks convert, then read the way a storefront block reads it | new | WTR unit tests | A small test-support converter implements the documented rule (table first row = block name, one row per key/value, class from the kebab-cased name) and the real `readBlockConfig` function is copied into a fixture verbatim from `hlxsites/aem-boilerplate-commerce` `scripts/aem.js` (pinned commit recorded). The assertion is: inserted markup converts to a block whose `readBlockConfig` yields the expected SKU(s) |
| L1 (optional, not CI) | A real Catalog Service endpoint | new, local only | Live contract tier | The worker (local wrangler) pointed at the public demo backend or the owner's sandbox; used to recapture fixtures and to detect API drift |

Why not fewer: M1 is needed because AC2 ("renders correctly on preview") is otherwise unverifiable by machine; it proves the markup is what the storefront contract expects without needing EW. Its limitation is honest: it proves our reading of DA's conversion rule, not DA's real converter (the real conversion is covered by MV1/MV5 manually) [OPEN: an optional canary that imports the real da-parser in a non-CI job]. L1 exists because every other tier fakes the vendor; recorded fixtures only prove the worker against *yesterday's* responses.

**Modules tested:** worker routes and validation, site-table resolution, provider (query construction, response projection, error mapping), credential hygiene, `config` route; browser picker logic (state machine, selection, markup builder, price formatting, request normaliser), the view (render states, a11y roles, SDK calls), the worker-origin constant; convention-check additions.

**Prior art (all in this repo's approved specs, none in upstream code):**
- `apps/hello-world/SPEC.md`: S1/S2 stub SDK seam, WTR import-map remap of `https://da.live/nx/utils/sdk.js`, fetch guard, convention check S3.
- `shared/worker-template/SPEC.md`: W1 `worker.fetch` tests with the test kit (`makeEnv`, `fakeIms`, `signToken`, `fakeUpstream`, canary), the canary property test (US1), the hello page's injected-`fetch` tests (HP1-HP6) and real-worker Playwright pattern (E2E1-E2E4).
- Upstream `adobe-rnd/ew-extensions`: dependency-injection pattern (`fetchImpl`, `now`) in `tools/brand-visibility/session-auth.js`; Playwright `stubDaApi` route stubbing; it has no worker and no picker code.

## Out of Scope

- Any commerce platform other than Adobe Commerce (Catalog Service flavour). Shopify, commercetools, Adobe Commerce Optimizer, Magento Open Source without Catalog Service/Live Search are follow-up providers under `providers/<vendor>/`. The provider boundary is built; no second provider is.
- Adobe Commerce Optimizer private catalog views and signed access tokens (the headers and JWT are researched above; the provider is a follow-up).
- Writing or changing any Commerce data: cart, checkout, orders, customers, inventory, product edits. Read-only.
- Building the storefront block that renders the SKU on the page. The plugin writes a block reference; the site owns the block. (Whether to ship a reference block is an owner decision, Open Questions.)
- Inserting a category listing (`product-list-page` with `urlpath`). It would use a block the current boilerplate does ship, but the ticket asks for picking products; recorded as a natural follow-up.
- Rich product detail (variants, option pickers, attribute browsing, filters/facets beyond category), customer-group pricing UI, price books, multi-currency switching.
- Updating or re-validating blocks already in a document (no "refresh product" or bulk SKU repair).
- Caching layers (Cloudflare Cache API, KV) and rate-limiting bindings beyond what the template provides.
- A fullscreen app version.
- Multi-site worker hosting for sites whose own origins differ from the worker's configured `ORG`/`SITE` (copying the plugin code into other repos); only the plugin hosted from one site's origin, serving a table of editing sites, is supported (Further Notes).
- Cloudflare deployment automation, custom domains, Cloudflare account policy (owned by #2 and #1 R1).
- Visual design beyond a clean, accessible layout; theming against the EW design system.

## Further Notes

- **How the plugin learns "which site".** The library plugin's `context` carries `org`, `site` (also `repo`), `ref`, `path`, `view`, `hash`, `branch` [VERIFIED in `iframe-protocol.js`, per the #1 spec section 2.2]. Those shapes are not a documented contract, so the plugin reads `org` and `site` defensively and falls back to `repo`; a missing value is the "not configured" state [ASSUMPTION: no versioned contract].
- **Where the plugin's code runs, and why that matters for CORS.** A library row `path` that starts with `/` loads the plugin from the editing site's own origin; an absolute URL loads it from wherever that URL points [VERIFIED: `helpers.js`, per the #1 spec section 2.5]. The template's allowlist is the worker's configured `ORG`/`SITE` plus `da.live` (#2 Decision 5). So: (a) plugin hosted from this repo's site, worker `ORG`/`SITE` = this repo, editing site = this repo or any other site that registers the *absolute* plugin URL; this works with the template unchanged and is the supported topology; (b) plugin code copied into each customer repo would produce other origins and is out of scope.
- **Observed Catalog Service behaviour (public demo backend, 2026-11-16; connection values from the public storefront config, no account used):**
  - `productSearch` with a phrase returns `total_count`, `page_info{current_page,page_size,total_pages}` and `items[].productView`; `SimpleProductView` has `price{final,regular}` and `ComplexProductView` has `priceRange{minimum,maximum}`.
  - Searching the phrase `ADB150` (a SKU) returned exactly that product; `products(skus:["NOPE"])` returned `[]`; `products(skus:["ADB150"])` returned the product.
  - A non-matching phrase returned `total_count: 0`, `page_size: 0`, `total_pages: 0`, `items: []` with HTTP 200.
  - Requesting a page beyond the last returned HTTP **200** with `data: null` and an error `FAILED_PRECONDITION: Page number is out of bounds ... Maximum valid page is N` (the worker must not treat HTTP 200 as success).
  - A bad `x-api-key` returned HTTP **403** with a non-GraphQL body `{"title":"ErrInvalidAPIKey","status":403,"error_code":403003,...}`.
  - `page_size: 60` was honoured; I did not find the documented maximum page size [OPEN].
  - `categories(ids:["2"], subtree:{startLevel:1, depth:2})` returned `id, name, urlPath, path, level, parentId, children (ids), roles, position`; the `children` field is a list of ids, so a tree is assembled from the flat list.
  - A `ComplexProductView` item had `priceRange.minimum.final.amount.currency` equal to `NONE` (not an ISO 4217 code).
  - `images(roles:["small_image"])` returns `url` and `label`; the label can be empty.
- **Docs gaps.** The EW developer doc lists `sendHTML` in one line and says nothing about how HTML maps to blocks, what happens inside a block cell, or what error/ack is returned; the behaviour above is from source reading and needs MV1 [VERIFIED docs content; ASSUMPTION on behaviour]. The Catalog Service `Catalog Service Guide` pages for endpoints and installation were not opened (the Experience League URL referenced from the storefront config); the PaaS endpoint form `catalog-service.adobe.io/graphql` and the SaaS tenant form `https://{region}-{env}.api.commerce.adobe.com/{tenantId}/graphql` appear in Adobe's pages as search-index snippets and the Optimizer page respectively [VERIFIED for the Optimizer base URL; ASSUMPTION for which form each Catalog Service flavour uses; OPEN].
- **Existing `picker` config in the public boilerplate config.** The demo `config.json` has a `plugins.picker.rootCategory` entry. I did not find what reads it; it is a candidate source for the site's root category id (so authors configure it once for the storefront and the picker), but I do not depend on it [OPEN].

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace editor (da.live)
  └─ library iframe: Commerce Products   (origin: https://{ref}--{site}--{org}.aem.live | .preview.da.live | http://localhost:3000)
        │  SDK handshake: { token (IMS), context {org, site, ...}, actions {sendHTML, closeLibrary, ...} }
        │  fetch(WORKER/v1/..., Authorization: Bearer <IMS token>)           <- CORS preflight, then call
        ▼
  Cloudflare Worker (apps/commerce-product-picker/worker; core imported from shared/worker-template)
        1 origin gate  2 IMS token check  3 route: validate input, pick site entry
        4 provider (adobe-commerce): build GraphQL doc + headers, proxy(retry), map errors, project fields
        ▼
  Adobe Commerce Catalog Service  POST {endpoint}  (headers: store scope; x-api-key injected from secret)
```

| Concern | Browser (static, public) | Worker (private runtime) |
|---|---|---|
| Commerce endpoint, store scope, credential | none; never present | all; vars + secret store |
| Identity | takes the IMS token from the SDK, sends it | verifies it (template) |
| Search/browse logic | UI state, debounce, paging, selection | translates to GraphQL, validates, bounds |
| Vendor response shape | consumes only the normalized contract | projects an allowlist of fields; maps errors |
| Markup written to the page | builds block table from SKUs; calls `sendHTML` | none |
| Retries, vendor quirks | shows "working"/error state | template retry; GraphQL-200-error handling |
| Per-site settings | reads the non-secret subset (`config`) | holds the whole table |

## 2. EW integration points

- **Library plugin (not an app).** Register a row in the `library` tab of `https://da.live/config#/{org}/{site}/`. Columns: `title`, `path`, `format`, `ref`, `icon`, `experience` [VERIFIED columns: https://www.aem.live/docs/ew/administering/set-up-library]. Proposed row: title `Commerce Products`; path `/apps/commerce-product-picker/commerce-product-picker.html` (the `.html` entry page, as in upstream's Brand Visibility README) or the absolute `https://main--ew-extensions--jazhou-adobe.aem.live/apps/commerce-product-picker/commerce-product-picker.html` for other sites; `ref` blank; `experience` per MV2 [OPEN]. Behaviour of `path`, `ref` filtering and org/site override is as described in the #1 spec section 2.5 [VERIFIED in da-live `helpers.js` there].
- **SDK actions used:** `actions.sendHTML(html)` (insert at the cursor; fire-and-forget), `actions.closeLibrary()`. The SDK result's `token` (to authenticate to the worker) and `context.org/site` (to select the site entry). Not used: `sendHTML` with `replace`, `getSelection`, `daFetch`, live-document APIs [VERIFIED present in `sdk.js`; deliberately unused].
- **`ref=local`:** editor opened with `?ref=local`; the library row resolves to `http://localhost:3000/apps/commerce-product-picker/commerce-product-picker.html` (port fixed by EW; #1 spec 2.3). The page then calls the local worker at `http://localhost:8787` (wrangler dev default; #2 section 2), with `ALLOW_LOCALHOST` true in the local environment only. The local worker's upstream is the public demo backend or a sandbox, via `.dev.vars` (untracked).
- **Branch ref:** `?ref=<branch>`; the page is served from `https://<branch>--ew-extensions--jazhou-adobe.aem.live` (or the `preview.da.live` proxy) and calls the *deployed* worker's `workers.dev` URL (#2 Decision 13). Use a simple branch name without `/` (#1 spec 2.3).
- **Which `Origin` the page sends** is an inherited unknown (#2 R2), observed in MV3.
- **Reachable from the editor library (AC5):** only after (a) Code Sync is installed (#1 R3), (b) the library row is saved, (c) the editor is opened on a document of that site.
- **Config-sheet rows needed:** the one `library` row. Worker settings are not in a config sheet (Decision 5; moving non-secret site settings into a DA config sheet is an option, [OPEN], and would need the worker to fetch and validate them).

## 3. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| Catalog Service `productSearch(phrase, current_page, page_size, sort, filter)` | keyword search, category browse, paging | store headers + (PaaS) `x-api-key` | https://developer.adobe.com/commerce/webapi/graphql/schema/live-search/queries/product-search |
| Catalog Service `products(skus)` | exact SKU lookup and pre-insert validation; unknown SKUs return `[]` (observed) | same | https://developer.adobe.com/commerce/webapi/graphql/schema/catalog-service/queries/products |
| Catalog Service `categories(ids, roles, subtree{startLevel, depth})` | category tree for browse; docs recommend depth <= 3 | same | https://developer.adobe.com/commerce/webapi/graphql/schema/catalog-service/queries/categories |
| Headers | `Magento-Store-Code`, `Magento-Store-View-Code`, `Magento-Website-Code`, `Magento-Environment-Id` (PaaS), `Magento-Customer-Group` (optional), `X-Api-Key` (PaaS) | | https://developer.adobe.com/commerce/webapi/includes/graphql/catalog-service/headers |
| Optimizer Merchandising API (follow-up) | base `https://{region}[-{env}].api.commerce.adobe.com/{tenantId}/graphql`; headers `AC-View-ID`, `AC-Price-Book-ID`, `AC-Policy-*`; private views need RS256 JWT in `AC-Catalog-View-Access-Token`; no auth otherwise | | https://developer.adobe.com/commerce/services/optimizer/merchandising-services/using-the-api/ |
| Adobe IMS key set (token verification) | by the template | none (public) | `shared/worker-template/SPEC.md` section 3 |
| DA App SDK | `sendHTML`, `closeLibrary`, `token`, `context` | host-provided | https://da.live/nx/utils/sdk.js ; https://www.aem.live/docs/ew/developing/apps-plugins |
| Cloudflare Workers / wrangler | runtime, secrets, local dev | owner's Cloudflare login (deploy only) | as in #2 section 3 |

**Auth flows.**
1. *Author to worker:* IMS bearer token from the SDK, verified offline by the template (#2 Decision 6): signature (RS256, Adobe key set), `type = access_token`, expiry, optional client-id allowlist. No token or a bad token gives `401` before any route logic.
2. *Worker to Commerce:* store-scope headers from the site entry; PaaS `x-api-key` injected by the `proxy` helper from the named secret; the caller's token is never forwarded. Cloud Service: no credential by default [VERIFIED: https://experienceleague.adobe.com/en/tools/commerce-storefront/setup/configuration/commerce-configuration]. A future Optimizer private view would sign a JWT per request (follow-up).
3. *Who may use the worker:* any authenticated Adobe user passing the client-id allowlist (the #2 R3 trade-off), further limited by the optional `authorize` hook; the site table also confines users to the configured sites' catalogs. Because the PaaS key is public by Adobe's design (Decision 6), the incremental exposure of this default is low; stricter org/user allowlists remain a template-level decision (Open Question 9).

## 4. Data contracts

All behaviour contracts, not code.

**Browser to worker (all with `Authorization: Bearer`, JSON, error contract from #2 Decision 9):**

| Route | Request | Success response |
|---|---|---|
| `GET /v1/config?site=org/site` | `site` selects the entry | `{ site, currencyHint?, pageSize, maxPageSize, insertCap, rootCategoryId, insert: { mode, blockName, skuKey, ... } }`. No endpoint, no store codes, no credential. Unknown site: `404` (`not_found`, or an extension code `site_not_configured` if the template permits extension codes [OPEN]) |
| `GET /v1/categories?site=org/site` | root fixed by site entry | `{ categories: [{ id, name, urlPath, parentId, level, position, childIds[] }] }`; flat list, depth at most 3 |
| `GET /v1/products?site=&q=&category=&page=&pageSize=&sort=` | see Decision 11 | `{ items: [Product], page: { current, size, totalPages, totalCount } }`; empty result has `items: []` and `totalCount: 0`; a page beyond the end returns an empty page for that number, not an error |
| `POST /v1/products/lookup?site=` | body `{ skus: [string] }`, 1 to 50 | `{ items: [Product], missing: [string] }` (missing = requested SKUs not in the catalog, order preserved) |

`Product` = `{ sku, name, type: 'simple'|'complex', inStock, urlKey, image: { url, alt } | null, price: { currency, final, regular } | { currency, min, max, regularMin } }`. `currency` is a string passed through verbatim (may not be ISO; the UI copes). Nothing else from the vendor is returned.

**Error behaviour specific to this extension** (on top of the template's codes): invalid input `400 bad_request`; unconfigured site `404`; upstream auth failure `500 misconfigured`; GraphQL error or upstream `5xx` after retries `502 upstream_unavailable`; upstream `429` after retries `429 rate_limited` with `Retry-After`.

**Worker configuration.** Non-secret `vars`: `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS` (the template's), plus one JSON var `COMMERCE_SITES`: an object keyed by `org/site`, each entry `{ backend: 'catalog-service', endpoint, store: { code, viewCode, websiteCode }, environmentId?, customerGroup?, credentialRef?, rootCategoryId, pageSize, insertCap, insert: { mode, blockName, skuKey, extraRows? } }`. Secrets (`secrets.required`): one `COMMERCE_API_KEY_<credentialRef>` per site that needs one. Constraints recorded for the README: the `endpoint` host is the only upstream host for that site; no secret-looking key may appear in `vars` (#2 UR3).

**What the plugin writes (insert profile, default).** For each selected SKU, a block table: first row the block name; one row with key `sku` and the SKU; extra static rows from the profile. After DA serialisation this is the storefront's `div.<block-name>` with rows of key/value divs, read by `readBlockConfig` into `{ sku: '...' }` [VERIFIED reader; ASSUMPTION on the editor's table-to-div conversion, MV1]. List mode: one block, SKUs one per paragraph in the value cell (or comma-joined). The README publishes this as the block contract.

**Per-site isolation.** A request for site A can only reach site A's endpoint and credential. Site keys come from a fixed table; there is no wildcard or default site.

## 5. Folder layout (fits the #1/#2 convention)

```
apps/commerce-product-picker/
├─ SPEC.md                         this file
├─ README.md                       setup, library row, worker vars/secrets, insert profile, block contract, local dev, deploy, policy pointers
├─ commerce-product-picker.html    entry page: SDK <script type=module> + extension script
├─ commerce-product-picker.js      thin bootstrap/view (awaits SDK, wires fetch and actions)
├─ <logic modules>.js              side-effect-free: picker state, worker-contract normaliser, markup builder, price formatting
├─ commerce-product-picker.css
├─ providers/adobe-commerce/worker/   provider module: GraphQL documents, headers, projection, error mapping (registered by the worker entry)
├─ worker/                         scaffold copied from shared/worker-template: wrangler config, entry (routes), .dev.vars.example, README, test stub
└─ test/
   ├─ unit/                        WTR tests (BR*, MK*)
   ├─ e2e/                         Playwright specs (PE*)
   └─ fixtures/                    recorded Catalog Service and worker-contract responses (+ pinned readBlockConfig copy)
   (worker tests live in worker/test/; provider tests alongside the provider)
```

Naming of the logic modules is the implementer's call. Root changes (one README table row, one convention-check rule set) are the only edits outside this folder.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **`sendHTML` block insertion semantics unverified.** `div` block markup is probably flattened by `insertHTML`; table markup is expected to work; behaviour inside an existing block cell, at a section boundary, or with a selection is unknown; there is no acknowledgement. | High (AC2) | Decision 10; **spike MV1 before building the UI** (step 1 of the build plan); fallback options if table insertion fails: `sendHTML` with `replace` on a placeholder block (needs the `sendHTMLReplace` capability, [VERIFIED capability flag in `iframe-protocol.js`]) or asking the EW team for a supported "insert block" action [OPEN]. |
| R2 | **The storefront block contract does not exist in the current boilerplate.** `product-teaser` was removed (2025-06-25); no SKU list block ships. "Blocks the storefront already renders" is therefore site-specific. | High (AC2) | Profile-driven insert; README contract; owner decides on a reference block and on the test storefront (Open Questions 1 and 2). |
| R3 | **Which storefront verifies "renders correctly on preview".** No Commerce-enabled EDS site exists in this org; code sync and a block are prerequisites. | High (AC2 manual proof) | Owner prerequisite: a storefront site from the Commerce boilerplate connected to the demo backend, plus a SKU block; documented in the build plan step 0. |
| R4 | **Catalog Service flavours and endpoints.** PaaS vs Cloud Service vs Optimizer differ in endpoint form, headers and (for Optimizer) schema; I verified PaaS-style behaviour on the public demo only. | Medium | v1 documents and tests the Catalog Service flavour; the `backend` discriminator and provider boundary isolate others; owner states which backend they actually have (Open Question 3). |
| R5 | **GraphQL errors arrive with HTTP 200; bad key arrives as non-GraphQL 403.** Status-based retry/mapping would miss one and mis-handle the other. | Medium | Decision 13; contract tests WK9, WK14 and WK15 use recorded cases. |
| R6 | **Public demo backend as a test target.** It is Adobe's shared demo (SKU set, store codes, key published in a public config); it can change, rate-limit, or disappear. | Low-Med | Live tier is optional and not in CI; CI uses recorded fixtures; fixtures carry a capture date and a recapture note. |
| R7 | **Any authenticated Adobe user can use the worker.** Inherited from #2 R3. Lower impact here (PaaS key is public by design) but the worker still spends the operator's request quota and credential reputation. | Medium | Client-id allowlist and `authorize` hook from the template; per-route rate-limiting recommendation in the README; owner decision (Open Question 9). |
| R8 | **Credential-less Cloud Service endpoint.** If the endpoint needs no key, the worker is the only access control the endpoint has through this extension, but the endpoint itself remains publicly reachable by anyone who knows it; the worker adds nothing there beyond hiding the URL. | Low (honest-scope note) | README states it; no claim of protection. |
| R9 | **Search quality and exact SKU semantics** differ per catalog configuration (Live Search rules, synonyms, indexed attributes). | Low-Med | SKU-like inputs add an exact `products(skus)` lookup in the same request (Decision 8); live tier checks one real catalog. |
| R10 | **Catalog data shape drift** (new product types, missing images or prices, non-ISO currency `NONE` observed). | Medium | Defensive projection and formatting; fixtures include odd cases (MK*, WK*, BR*). |
| R11 | **`context` shape and `site` key not contractual.** | Low-Med | Defensive read with `repo` fallback; "not configured" state; test with arbitrary key sets. |
| R12 | **Worker origin / CORS across topologies** (editing site vs hosting site; `preview.da.live`). | Medium | Inherited from #2 R2; MV3 records the real `Origin`; the supported topology is stated in Further Notes. |
| R13 | **Library panel real estate.** A dense picker in an `inline` panel may be cramped. | Low | `experience` decided in MV2; UI designed to the panel width first. |
| R14 | **Sort and attribute availability.** `price`, `name`, `position` are "default" sortable attributes in Luma [VERIFIED docs]; a customised catalog may not sort on them (the docs warn invalid filter attributes error). | Low | Sort options are fixed and minimal; an unsupported sort surfaces as `502`, README notes it. |
| R15 | **Policy:** outside-activity/IP and infrastructure account (#1 R1, #2 R1). | High for publishing | README pointer only. |
| R16 | **Template dependencies not yet built** (#1, #2 are specs). | Medium | Build is blocked on them (ticket graph); step 0 gates on both. |

## 7. Ordered build plan (sized to #3's acceptance criteria)

0. **Prerequisites (owner / blockers).** #1 and #2 implemented and merged (tooling, hello pair, CI, template, test kit). A Commerce-connected EDS storefront site for preview proof (R3) with a SKU block (R2), and a decision on the backend to test against (public demo vs own sandbox; R4). Owner answers to Open Questions 1 to 4. Cloudflare account and login (#2).
1. **Spike MV1 (insertion semantics), manual, throwaway.** With the hello plugin from #1 registered in a real site: send (a) a table block, (b) a `div` block, (c) several blocks, at the cursor in an empty paragraph, in the middle of text, and inside an existing block cell; record the resulting document. Decide the final markup shape and whether a cursor-position guard is needed. Update Decision 10 and the README if the finding differs. Gate for everything UI-related (R1).
2. **Worker contract tests first (W1), then the provider.** Record fixtures from a real catalog (demo backend) for the cases in WK*. Write failing tests WK1 to WK22; implement the site table resolution, `config`, `categories`, `products`, `lookup` routes and the `adobe-commerce` provider on the template. AC3 (worker half), AC7.
3. **Markup builder and contract (M1), test-first.** MK1 to MK10. AC2 (automated half).
4. **Picker logic (S2), test-first.** BR1 to BR25: state machine, selection, normaliser, price formatting, worker-origin constant. AC1 (logic), AC2.
5. **View and entry page.** Text-only rendering, accessible roles, standalone state, library-panel layout, CSS; then Playwright e2e PE1 to PE10 against the real worker and a fake Commerce server. AC1, AC2, AC7 (browser half).
6. **Worker scaffold wiring and docs.** `wrangler` config (`vars`, `secrets.required`, local environment), `.dev.vars.example`, per-site README section. AC3, AC4.
7. **Repo wiring.** README extensions table row (name `Commerce Product Picker`, folder, entry point, type `library plugin`, description); convention-check rules (below); CI jobs from #1/#2 pick the new tests up with no new job. AC4, AC5, AC8.
8. **Live contract tier (L1), local only.** LV1 to LV4 against the demo backend; used to recapture fixtures. Not blocking.
9. **Deploy and manual verification in EW.** MV0 to MV9 with real Adobe login and a Cloudflare deploy; record screenshots and observed origins in the PR; fold findings (R1, R12, R13) back into the README. AC1, AC2, AC5, AC6, AC7.
10. **Hand-off notes** in the README for follow-up providers (how to add `providers/<vendor>/` and a `backend` value).

---

# Testing Requirements

## 1. Worker unit and contract tests (seam W1, `node:test`)

Runner and structure inherited from #2 (Node built-in runner, test kit). Fixtures/mocks: the #2 test kit (`makeEnv`, `fakeIms`, `signToken`, canary secret, `fakeUpstream`) plus **recorded Catalog Service responses** in `test/fixtures/` with their capture date: keyword search (page 1 of several), exact-SKU search, empty result, out-of-bounds page error (HTTP 200 + errors), bad-key 403 body, category subtree (flat list with `children` ids), `products` with a known and an unknown SKU, a complex product with `priceRange`, a product with `currency: "NONE"`, a product with no images, a product with an empty image label. `makeEnv` gets a `COMMERCE_SITES` fixture with two sites (one with a credential, one without) and a canary `COMMERCE_API_KEY_*` value. `fakeUpstream` records every request (URL, headers, body) so tests assert what the worker sent. All tests call `worker.fetch(...)`.

| ID | Behaviour asserted | Proves |
|----|--------------------|--------|
| WK1 | **Every registered route rejects a request with no token** (`401`, handler and upstream untouched). The test iterates the route registry, so a new route without coverage fails | AC7 |
| WK2 | Every route rejects a malformed/expired/wrong-key token (`401`) and a disallowed origin even with a valid token (`403`); preflight from `https://da.live` and from the site's own origins succeeds with no token | AC7 |
| WK3 | `config` for a configured site returns exactly the documented non-secret fields; the response contains no endpoint, no store/environment code, no credential (canary absent) | AC3, AC7 |
| WK4 | `config`/`products`/`categories`/`lookup` for an unconfigured or malformed site key: fixed not-configured/`400` response, **no upstream call** | AC3 |
| WK5 | Site isolation: a request for site A hits only site A's endpoint with site A's headers and credential; site B's credential never appears in the outbound request | AC3, AC7 |
| WK6 | Keyword search builds the documented `productSearch` variables (phrase, page, size, visibility filter, sort mapping) and uses variables not string interpolation (a hostile `q` appears only as a variable value) | AC1 |
| WK7 | Category browse sends empty phrase + `categoryPath` filter + default `position` sort; a category not in the configured tree is rejected before any upstream call | AC1 |
| WK8 | SKU-like `q` on page 1 adds an exact `products(skus)` lookup in the **same** upstream request; an exact hit missing from the search page is placed first; an exact hit already present is not duplicated; page 2 does not add the lookup | AC1 |
| WK9 | Pagination: response `page` carries current/size/totalPages/totalCount; a page beyond the end returns an empty page with `items: []` (the HTTP-200-with-errors case is handled), never an error to the browser | AC1 |
| WK10 | Empty result returns `items: []`, `totalCount: 0` (not an error) | AC1 |
| WK11 | Projection: only allowlisted fields are returned (an extra vendor field in the fixture is absent from the response); `image.url` is only returned for `https`; missing image gives `null`; complex product yields min/max; `currency: "NONE"` passes through verbatim | AC1 |
| WK12 | Validation matrix: `q` over 100 chars; `page` 0/negative/non-numeric/over the 10,000-product window; `pageSize` over the site cap; bad `sort`; `category` with a bad charset; each yields `400 bad_request` and no upstream call. An empty `q` with no `category` is valid ("all products", the default landing view; the demo backend returned 220 visible products for an empty phrase). `lookup` with 0, 51, non-string, over-long or control-character SKUs yields `400`; duplicate SKUs are deduplicated, not rejected | AC1, AC7 |
| WK13 | `lookup` returns found products in request order and `missing` for unknown SKUs; unknown-only gives `items: []` | AC1, AC2 |
| WK14 | Upstream GraphQL errors with HTTP 200 (non out-of-bounds) map to `502 upstream_unavailable` with a fixed message and no upstream text | AC1 |
| WK15 | Upstream `403` with the non-GraphQL bad-key body maps to `500 misconfigured`; the log has the site key and status only; nothing from the upstream body reaches the response | AC7 |
| WK16 | Upstream `429`, `503`, timeout: retried per the template schedule; read-only GraphQL `POST` is retried on `5xx` only because the provider sets the explicit safe-to-retry flag; exhaustion maps to `429`/`502` | AC1, AC8 |
| WK17 | Upstream request hygiene: exactly the expected store headers; `x-api-key` present exactly where the site entry says and absent for credential-less sites; inbound `Authorization`, `Cookie`, `Origin`-derived and `cf-*` headers absent; URL equals the configured endpoint (no request value in URL, path or headers) | AC3, AC7 |
| WK18 | **Canary property test:** across success, every error code above, an upstream that echoes the key in its error body, and a handler throw containing the key, the canary credential never appears in any response body, response header, or captured log line; the caller's token never appears either | AC7 |
| WK19 | Missing secret for a configured site (`COMMERCE_API_KEY_*` absent): `500 misconfigured`, generic message, the log names the secret (not a value) | AC3, AC7 |
| WK20 | A site entry whose `endpoint` is not `https` (outside loopback in test) or has credentials in the URL fails at configuration load, not at request time | AC7 |
| WK21 | Error responses carry CORS headers for allowed origins so the browser can read the status (`401`, `400`, `404`, `500`, `502`) | AC7 |
| WK22 | No write capability: the set of GraphQL operations the provider can emit is exactly `productSearch`, `products`, `categories` (asserted by inspecting all outbound documents across the suite for `mutation` and for any other root field) | AC3 |

Prerequisite checks from #2 (UA*, UC*, UP*, US*, UK*) are the template's; they are not repeated here.

## 2. Markup contract tests (seam M1, WTR)

Fixtures: pinned verbatim copy of `readBlockConfig` and `toClassName` from `hlxsites/aem-boilerplate-commerce` `scripts/aem.js` (commit recorded), and a small test-support converter implementing the documented DA rule (table first row = block name, one row per key/value, lowercase kebab class). The tests use real DOM APIs in Chromium.

| ID | Behaviour asserted | Proves |
|----|--------------------|--------|
| MK1 | One SKU, default profile: output is a table whose first row is the block name and whose second row is `sku` and the SKU; converted and read, `readBlockConfig` returns `{ sku: <the SKU> }` | AC2 |
| MK2 | N SKUs, per-product mode: N independent tables, in selection order, each reading back to its own SKU; no cross-talk | AC2 |
| MK3 | List mode (paragraph per SKU): converted and read, `readBlockConfig` returns the array of SKUs in order; comma-joined variant returns the joined string | AC2 |
| MK4 | Extra static rows from the profile are present and read back; row keys read back through `toClassName` as configured | AC2 |
| MK5 | Hostile SKUs (`"><img src=x onerror=...>`, `<script>`, quotes, ampersands, newlines, very long) produce markup in which the text appears literally and no element or attribute is injected; the serialised string parses back to the same SKU | AC2 |
| MK6 | Duplicate SKUs are inserted once; empty selection yields no markup (and the view never calls the SDK) | AC2 |
| MK7 | Markup contains no product name, price or image (SKU reference only) | AC2 |
| MK8 | Block name and row keys come from the profile; an invalid profile (empty block name, key with markup characters) is rejected at config load with a plain message | AC3 |
| MK9 | Generated markup contains no `div` block wrapper and no scripts/styles (table form per Decision 10) | AC2 |
| MK10 | Inserting over the insert cap is refused with a message before building markup | AC1, AC2 |

## 3. Browser unit tests (seam S2, WTR, injected `fetch`)

Fixtures: the #1 SDK stub factory (`{ context, token: 'stub-token', actions }` with recorded calls; `context` includes `org`, `site`), worker-contract fixtures (config, categories, product pages, empty, error bodies), fake timers for debounce/timeouts.

| ID | Behaviour asserted | Proves |
|----|--------------------|--------|
| BR1 | On load the plugin requests `config` for the SDK's `org/site` with `Authorization: Bearer <sdk token>` to the configured worker origin; shows a loading state, then results or categories | AC1 |
| BR2 | Typing a keyword (debounced) requests `products` with `q`; results show image, name, SKU and a formatted price per product | AC1 |
| BR3 | Rapid typing issues one request after the debounce; a slower earlier response arriving after a later one is discarded (stale-response protection) | AC1 |
| BR4 | Category browse: choosing a category requests products for it; breadcrumb/selection visible; clearing returns to search | AC1 |
| BR5 | Pagination: next/previous request the right page; position text "page X of Y" and total count shown; controls disabled at the ends; changing the query resets to page 1 | AC1 |
| BR6 | Empty result shows the empty state with a suggestion, not an error | AC1 |
| BR7 | Each failure class (`401`, `400`, `429`, `502`, `500`, network error, timeout) shows a short plain message with Retry; none shows a stack trace, status text from the server, or the token; Retry repeats the request | AC1, AC7 |
| BR8 | Site not configured (`config` not-found): "Commerce is not set up for this site" state; no search UI | AC3 |
| BR9 | Prices: simple shows final (and regular struck through when greater); complex shows a range; invalid currency (`NONE`) renders as number plus raw code without throwing | AC1 |
| BR10 | Out-of-stock marker shown and the product remains selectable | AC1 |
| BR11 | Selecting products updates the tray and the Insert button text ("Insert N products"); Insert disabled when empty; selection survives paging, new searches and category changes | AC1 |
| BR12 | Removing a product from the tray deselects it in the results | AC1 |
| BR13 | Selecting past the insert cap is refused with a message; selection unchanged | AC1, AC2 |
| BR14 | Paste-SKU list (newline and comma separated, whitespace, duplicates): resolved through `lookup`; found products selected; missing SKUs listed by name | AC1 |
| BR15 | Insert: re-resolves selected SKUs via `lookup`; with all found, `actions.sendHTML` called **once** with the expected markup, then `actions.closeLibrary` once, in that order | AC2 |
| BR16 | Insert with a SKU now missing: nothing is sent to the SDK; the missing SKU is named; the author can remove it and retry | AC2 |
| BR17 | `sendHTML` throwing (SDK rejects the payload): plain error, library not closed, selection kept | AC2 |
| BR18 | Double-click on Insert sends once | AC2 |
| BR19 | Catalog text containing HTML/script (name, alt, SKU) renders as literal text; no elements created | AC1, AC7 |
| BR20 | Images: non-`https` URL not rendered (placeholder shown); load error shows placeholder | AC1 |
| BR21 | The token never appears in the DOM, console output, URL or storage | AC7 |
| BR22 | A `?worker=https://evil.example` page parameter is ignored; on `localhost` the loopback worker is used, on any other host the fixed deployed origin | AC7 |
| BR23 | Standalone (SDK never resolves): "waiting" then "not running inside Experience Workspace"; no worker calls | AC1 |
| BR24 | Keyboard and roles: search field, results (listbox or list with checkbox roles), tray, pagination and Insert are reachable and operable by keyboard; live region announces result counts and errors | AC1 |
| BR25 | `context` with extra/missing keys (arbitrary key sets, `repo` only, no `site`) does not throw; missing site yields the not-configured state | AC3 |

## 4. End-to-end tests inside the repo (seam S1 extended, Playwright, Chromium, hermetic)

Server setup follows #2: the #1 static server on `:3000`, the real worker via wrangler on `:8787` (local environment, `IMS_ORIGIN` at a throwaway fake-IMS server, `COMMERCE_SITES` pointing at a **local fake Commerce server** that serves the recorded fixtures keyed by operation, secrets from a temp env file), SDK stubbed through `page.route` with a test-signed token and a call log. No external request is allowed except the stubbed SDK URL.

| ID | Behaviour asserted | Proves |
|----|--------------------|--------|
| PE1 | Open the plugin page; the first page of products appears from the real worker through a real cross-origin request (preflight included) | AC1, AC6 (local origin) |
| PE2 | Search by keyword and by SKU, paginate, browse a category; results, positions and empty state as in BR | AC1 |
| PE3 | Select two products on different pages, press Insert: the SDK call log shows exactly `sendHTML(<two tables>)` then `closeLibrary`, and the markup converts (M1 helper) to two blocks reading back to the two SKUs | AC2 |
| PE4 | Same request without the token (via the page's token-removed mode or a direct `fetch` in the test) returns `401` through the full browser path and the UI shows the plain auth error | AC7 |
| PE5 | A token signed by a different key gets `401` | AC7 |
| PE6 | Fake Commerce returns `500` then `200`: the UI recovers without author action (worker retry); fake Commerce returning the HTTP-200-with-errors out-of-range body: the UI lands on a valid page | AC1 |
| PE7 | Fake Commerce returning a bad-key `403`: the UI shows a plain "temporarily unavailable, contact an admin" message; the page and all network responses contain neither the token nor the credential | AC7 |
| PE8 | Canary: the Commerce credential is absent from page HTML, DOM text, every network response and header seen by the browser; the fake Commerce server records that it *did* receive the credential from the worker | AC7 |
| PE9 | Only expected hosts contacted (page, worker, SDK stub); the browser never contacts the Commerce endpoint | AC7 |
| PE10 | Narrow viewport (library-panel width): search, results, tray and Insert are all visible and operable | AC1 |

## 5. Repo checks (seam S3 additions)

| ID | Behaviour asserted | Proves |
|----|--------------------|--------|
| PR1 | The convention check passes for `apps/commerce-product-picker/` (entry page named after the folder, README, tests, worker folder per UR1) | AC4 |
| PR2 | The root README extensions table has a row for this extension with name, folder, entry point, type `library plugin`, description, and the row resolves to a real folder and entry page | AC5 |
| PR3 | The extension README documents a `library` registration row (type consistency check from #1) and contains the required sections (config-sheet row, `COMMERCE_SITES` schema, secret names, insert profile and block contract, local dev) via a heading grep [OPEN: include the heading grep] | AC4 |
| PR4 | `wrangler` config present only under `apps/commerce-product-picker/worker/`; `.dev.vars*` untracked and ignored; no credential-like key in `vars`; every `secrets.required` name appears in `.dev.vars.example` (#2 UR1 to UR5) | AC7 |
| PR5 | Lint (ESLint 8 helix + Stylelint 16) passes on the extension, including the worker and test files | AC8 |

## 6. Live contract tier (seam L1, local only, optional, not in CI)

Runs the local worker against a real Catalog Service (the public demo backend, or the owner's sandbox), credentials from an untracked env file, gated by an environment flag (`LIVE_COMMERCE=1`); skipped otherwise.

| ID | Behaviour asserted |
|----|--------------------|
| LV1 | `productSearch` page 1 returns items with the documented shape; the projection yields valid `Product` objects (name, SKU, price, image) |
| LV2 | An exact known SKU is found and placed first; an unknown SKU is reported missing |
| LV3 | The category tree contains the configured root; browsing a child category returns products |
| LV4 | The out-of-range page and bad-key behaviours still match the recorded fixtures (drift detector); if not, fixtures and Decision 13 are updated |

## 7. End-to-end checks inside real Experience Workspace (manual; interactive Adobe login required)

**Accounts and credentials needed:**
- GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync; #1 prerequisite) and write access for branches.
- Adobe IMS identity with access to the DA org/site and permission to edit the site config (library row).
- Chrome (Safari/Brave may block `localhost` iframes, #1 section 5).
- Cloudflare account with a Wrangler login (deploy and secrets; #2).
- **A Commerce-connected storefront site** (EDS site from `hlxsites/aem-boilerplate-commerce` with a SKU block per the block contract) to prove preview rendering. Backend options: (a) Adobe's public demo backend (endpoint and key published in `https://main--aem-boilerplate-commerce--hlxsites.aem.live/config.json`; no Adobe Commerce account needed, but it is shared and may change) or (b) the owner's own sandbox: PaaS (Commerce Services Connector, Catalog Service, API key) or Adobe Commerce as a Cloud Service tenant [OPEN, Open Question 3].
- Never paste real tokens or keys into issues, chat or logs.

Verification steps (ids are `MV`, to avoid clashing with #1's M0-M6 and #2's W0-W6):
- **MV0 (prereq):** worker deployed from `apps/commerce-product-picker/worker/` with `COMMERCE_SITES` and the secret(s) set; `curl -i <worker>/v1/config?site=<org>/<site>` returns `401` (liveness + AC7 negative). Library row saved (below).
- **MV1 (insertion spike, build step 1):** hello plugin or a temporary page sending table and `div` block markup via `sendHTML` into a real document: at an empty line, mid-paragraph, inside an existing block cell; record the resulting document and what `sendHTML` returns. Decides R1/Decision 10.
- **MV2 (library row, reachable, AC5):** add the row (`title` Commerce Products, `path` the entry page, `experience` tried as `inline`, then `window`/`fullsize-dialog`) in `https://da.live/config#/{org}/{site}/`; open a document in the editor; the library lists **Commerce Products**; pick the best `experience` for usability.
- **MV3 (`ref=local`, AC6):** terminals: `npm start` (port 3000) and the worker dev script (port 8787, local environment); editor opened with `?ref=local`; the plugin loads; DevTools Network shows the preflight `OPTIONS` `204` and `Access-Control-Allow-Origin: http://localhost:3000`. Search "bag", browse a category, page forward, select 2 products, Insert: the document shows two block tables and the library closes.
- **MV4 (branch ref, AC6):** push branch `commerce-picker` (simple name), wait for code sync, open the editor with `?ref=commerce-picker`; repeat MV3 against the deployed worker. Record the page's actual `Origin` (`aem.live` or `preview.da.live`) and whether the library loads via the preview proxy.
- **MV5 (preview render, AC2):** after MV3/MV4, save/preview the document on the storefront site and open the preview URL: each inserted block renders its product (name, price, image) via the storefront's SKU block; inspect the generated markup (view source or the DA code view) and confirm it is the block `div` with `sku` rows. Repeat for list mode if the site supports it.
- **MV6 (per-site config, AC3):** call `curl` against the worker for a site not in the table: not-configured response, no upstream traffic (worker logs). Rotate the secret: `wrangler secret put COMMERCE_API_KEY_<ref>` with a wrong value: the picker shows the plain "unavailable, contact an admin" state with no detail; restore the value; no code change or redeploy of code needed.
- **MV7 (credential hygiene, AC7):** search DevTools Network responses, page source and Application storage for the API key value (none); `wrangler secret list` shows names only; the browser never contacts the Commerce endpoint (Network panel filter).
- **MV8 (auth negatives against the deployed worker, AC7):** `curl` the routes with no token: `401`; with a real token (inspect claims locally, as in #2 W2) and `Origin: https://evil.example`: `403`; with a real token and `Origin: https://da.live`: `200`.
- **MV9 (error and empty states):** search a gibberish term (empty state); take the worker offline or point at a bad endpoint in a scratch environment (error state with Retry).

## 8. CI

No new jobs. The extension's tests are picked up by the existing jobs defined in #1 and #2: `lint` (ESLint, Stylelint, convention check including PR1 to PR5), `unit` (WTR: BR*, MK*), `worker-unit` (`node:test`: WK*), `worker-smoke` (wrangler runtime; the extension's worker is bundled and a bare request returns `401`; its inclusion in SM1 is part of the #2 smoke set), `e2e` (Playwright: PE*). Triggers are push and pull request, no secrets, no Commerce or Cloudflare credentials (all fixtures and fakes). The live tier (LV*) and the manual MV steps are not in CI.

## 9. Acceptance-criteria traceability (ticket #3)

| # | Acceptance criterion (#3) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Author can search by keyword or SKU and browse by category; results show image, name, SKU, price, with pagination and empty/error states | WK6 to WK14 (queries, SKU path, paging, empty, projection, validation, errors); BR1 to BR14, BR19, BR20, BR23 to BR25 (UI behaviour and states); PE1, PE2, PE6, PE10; LV1 to LV3 | **MV3** (search, category, pagination in real EW), **MV9** (empty and error states) |
| AC2 | Selecting one or many products inserts block markup via `actions.sendHTML` that the storefront's blocks render correctly on preview | MK1 to MK10 (markup contract against the pinned `readBlockConfig` and the documented conversion); BR15 to BR18 (sendHTML payload, order with closeLibrary, stale SKU refusal, error handling); PE3 | **MV1** (insertion spike: real editor behaviour), **MV3/MV4** (insert in the document), **MV5** (preview renders the product via the storefront block) |
| AC3 | Commerce endpoint, store view and credentials configured per site; credentials held by the worker | WK3 to WK5 (config route, unknown site, site isolation); WK17, WK19, WK20, WK22; MK8; BR8, BR25 | **MV6** (per-site config, secret rotation), README review of the `COMMERCE_SITES` schema and secret naming |
| AC4 | All code in its own `commerce-product-picker` folder, with a README covering setup, the EW config-sheet row, and any site config it reads | PR1, PR3, PR4 (convention check, README sections, worker folder completeness) | Review: README walkthrough on a scratch copy (clean clone to `wrangler dev` to editor) including the `library` row and the `COMMERCE_SITES` example |
| AC5 | Listed in the repo README extensions table and reachable from the editor library | PR2 (table row resolves to the folder and entry page) | **MV2** (library lists Commerce Products in a real document) |
| AC6 | Works in EW with `ref=local` and with a branch ref | PE1 (local-origin cross-origin path, hermetic); BR22 (worker origin rule) | **MV3** (`ref=local`), **MV4** (branch ref, observed `Origin`) |
| AC7 | Vendor credentials only in the worker (built from the shared template); the browser never receives them; unauthenticated calls rejected | WK1, WK2, WK15, WK17, WK18, WK21; PE4 to PE9; BR7, BR21, BR22; PR4 | **MV0** (bare `curl` 401), **MV7** (credential hygiene), **MV8** (auth negatives on the deployed worker) |
| AC8 | Core logic covered by unit tests; lint and CI green | All WK*, MK*, BR* run by `npm run test:worker`, `npm test`; PR5 (lint); the existing CI jobs green on a PR | Review: CI shows all checks green on the PR; deliberately break a rule (e.g. loosen input validation) on a scratch branch and see WK12 fail |

Every acceptance criterion on #3 maps to at least one automated test and at least one numbered manual or review verification step above.

## 10. Open questions for the owner

1. **Storefront block contract (R2).** The current Commerce boilerplate has no SKU teaser or SKU list block (the former `product-teaser` was removed on 2025-06-25). Which block(s) does your target storefront render from a SKU, and what rows do they read? Do you want a small **reference block** (the old teaser contract) shipped or documented so MV5 can pass, or will you supply a site that already has one? Which mode should be the default: one block per product, or one list block?
2. **Preview-test storefront (R3).** Which EDS site proves "renders correctly on preview": a new storefront site from the Commerce boilerplate in your org? Who creates it and connects it to a backend, and may it be named in the README?
3. **Backend and flavour (R4).** Which Adobe Commerce backend do you have: PaaS with Catalog Service, Adobe Commerce as a Cloud Service, or Commerce Optimizer? Is Adobe's public demo backend (shared, key published in a public config) acceptable as the development and demo target, or do you want your own sandbox? (Optimizer and other platforms are follow-up providers.)
4. **Insertion semantics (R1).** Are you comfortable with the plan to run the MV1 spike before any UI work, and if table insertion is unsupported, with falling back to `sendHTML` replace-mode on a placeholder block, or to asking the EW team for a supported insert-block action? Who on the EW team can answer how non-replace `sendHTML` treats block markup?
5. **Provider placement.** Confirm `providers/adobe-commerce/worker/` for the first provider (the #2 refinement still awaits confirmation), rather than putting Adobe Commerce directly in `worker/` and moving it when a second vendor arrives.
6. **Site-table location.** Is a worker `vars` JSON table (redeploy to change) acceptable, or should non-secret per-site settings (endpoint, store view, insert profile) live in an author-editable DA config sheet read at runtime (more flexible, needs worker validation of anything read)?
7. **`library` row and panel size.** Preferred `experience` value is unknown until MV2; any known EW guidance on `window` / `fullsize-dialog` semantics?
8. **Limits.** Defaults proposed: page size 12 (max 48), insert cap 20, category depth 3, SKU lookup 50. Accept, or give real numbers for your catalog? What is the real maximum `page_size` of the target Catalog Service (not found in docs)?
9. **Who may call the worker (R7).** Accept "any authenticated Adobe user passing the client-id allowlist" as the default (it carries #2's R3 policy; impact is lower here because the Catalog Service key is public by Adobe's design), or require an org/user allowlist from the start?
10. **Policy and accounts (R15).** Which Cloudflare account hosts this worker (the #1 R1 / #2 R1 decision), and have you cleared the Adobe outside-activity/IP question for publishing or sharing this extension? This spec only flags it.
11. **Template extension codes and retry opt-in.** May an extension add its own error code (e.g. `site_not_configured`), or must it reuse the template's? Do you accept #2's "explicit safe-to-retry flag for POST" design, which this extension relies on for read-only GraphQL (#2 Open Question 6)?
12. **Optional extras.** Include the optional non-CI canary that imports the real `da-parser` to check our table-to-block assumption? Include the README heading grep (PR3)? Include category-listing insertion (`product-list-page` with `urlpath`) as a follow-up ticket?
13. **`plugins.picker.rootCategory`.** The public boilerplate config contains a `picker` entry; do you know what reads it, and should the plugin use it as the default root category?
14. **Naming.** Confirm the plugin title `Commerce Products`, the route prefix `/v1`, and the worker name (`ew-commerce-product-picker-worker`, following the #2 `ew-<ext>-worker` suggestion).
