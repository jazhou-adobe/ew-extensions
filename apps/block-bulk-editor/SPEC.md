# Spec: Block Bulk Editor

Ticket: jazhou-adobe/ew-extensions#19 (this spec: #57). Blocked by #1 (repo scaffold; approved spec at `apps/hello-world/SPEC.md`, spec task #39). Not blocked by #2: no backend worker is needed.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend used throughout (same as the scaffold spec): **[VERIFIED]** = read in a primary source (URL given); **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an Adobe answer.

Consistency with the approved scaffold spec: single `apps/<name>/` folder per extension, type from the config-sheet row (this one is a row in the `apps` sheet = fullscreen app), SDK imported (not the bare `DA_SDK` global), vanilla ES modules with no build step, thin bootstrap + side-effect-free logic split, SDK stub seam (S1/S2), convention check (S3), CI jobs `lint` / `unit` / `e2e` on `push` + `pull_request`, manual EW verification with `ref=local` and a branch ref, trust-prompt and Chrome-only caveats, and no tokens in DOM/logs/snapshots.

---

## Problem Statement

A site admin or content operations lead who owns a Document Authoring (DA) / Experience Workspace (EW) site often needs to change **one block type across many pages**: fix a CTA label in every `cards` block, swap a link in every `hero`, retitle every `banner` that mentions a past campaign. Today the options are bad:

- Open each page in the editor, find the block, change it, save. With hundreds of pages this is days of error-prone clicking, and nobody can see "all instances of this block" in one place.
- Use a text find-and-replace tool. These operate on page text only (the scoring-sheet evidence is that FindReplace Pro covers text only [ASSUMPTION: not verified; no FindReplace Pro source was read]); they do not understand block structure, so they cannot target "the second cell of every `cards (dark)` row" and cannot show instances side by side.
- Script the DA Admin API. Needs a developer, a token, and care not to corrupt pages; no review step.

Contentful ships exactly this pattern for structured content: its Bulk Edit app lets editors filter by content type, change fields across many entries, and review a side-by-side comparison before applying (https://www.contentful.com/blog/new-apps-integrations-marketplace/, "Bulk Edit" section, read 2026-11-16) [VERIFIED]. EW has no equivalent for DA blocks.

## Solution

A fullscreen EW app, **Block Bulk Editor**, opened from the EW Apps page. Entirely client-side: it runs in an iframe, gets the user's token through the DA App SDK, and talks to the DA Admin API as that user. No backend.

The admin flow:

1. **Pick** a block type (name, e.g. `cards`) and optionally narrow to a folder path (e.g. `/blog`). The app crawls that part of the site, reads each page, and finds every instance of that block.
2. **See** all instances in one grid: one row per instance, showing the page, the instance position on the page, the variant(s), and every cell value.
3. **Edit** cell values directly in the grid. Rows you change are marked dirty.
4. **Review**: a before/after diff for every changed row, plus a summary (N rows across M pages will be written; the other pages will not be touched).
5. **Apply**: the app writes only the changed pages through the DA Admin API, with progress, cancel, and a per-page success/failure report. Failed pages can be retried. A page that someone else edited since the scan is not overwritten: it is reported as a conflict.

Untouched pages are never rewritten. The app edits the site it was opened for (the `org`/`repo` in the EW-supplied `context`), with exactly the user's DA permissions.

## User Stories

Admin / content operations (primary actor):

1. As a site admin, I want to choose a block type by name, so that I only see the block I intend to change.
2. As a site admin, I want to enter an optional folder path filter, so that I can limit the change to one section of the site (for example `/blog`).
3. As a site admin, I want to see a progress indicator while the app scans the site (folders visited, pages read, instances found), so that I know a long scan is working.
4. As a site admin, I want to cancel a running scan, so that a mistyped path on a huge site does not tie up the app.
5. As a site admin, I want every instance of the block listed with its page path, its position on that page, and its cell values, so that I can see the whole picture in one grid.
6. As a site admin, I want a link from each row to open the page in the EW editor, so that I can inspect the surrounding content before changing a row.
7. As a site admin, I want the grid to show the block variant (for example `dark`, `wide`) for each instance, so that I can tell variants apart.
8. As a site admin, I want to filter the grid by variant and by free text in the page path or cell values, so that I can narrow down to the rows I care about.
9. As a site admin, I want columns labelled by cell position, or by the key text when the block is a key/value style block with a consistent key, so that I know what each column holds.
10. As a site admin, I want to edit a text cell in place in the grid, so that I can fix copy without opening the page.
11. As a site admin, I want to edit a link cell's text and URL in place, so that I can retarget CTAs in bulk.
12. As a site admin, I want to edit an image cell's source URL and alt text, so that I can fix a broken or wrong image across pages. (Uploading new media is not included.)
13. As a site admin, I want complex cells (multiple paragraphs, lists, mixed content) to be editable as restricted HTML, so that no cell is a dead end.
14. As a site admin, I want changed rows to be visibly marked, with a count of changed rows and affected pages, so that I always know how big the pending change is.
15. As a site admin, I want to undo a single cell edit or reset a changed row to its scanned value, so that a slip does not force me to start over.
16. As a site admin, I want a before/after diff for every changed row before anything is written, so that I can catch mistakes.
17. As a site admin, I want the review step to list the pages that will be written and state that all other pages stay untouched, so that I can trust the blast radius.
18. As a site admin, I want to deselect individual rows or whole pages in the review step, so that I can apply a subset.
19. As a site admin, I want Apply to show live progress (pages done, failed, remaining), so that I know the state of a long write.
20. As a site admin, I want to cancel Apply midway, with a clear report of which pages were already written, so that I can stop safely.
21. As a site admin, I want a per-page success/failure report with the reason for each failure (permission denied, conflict, validation, network), so that I know exactly what happened.
22. As a site admin, I want to retry only the failed pages, so that transient failures do not force a full re-run.
23. As a site admin, I want a page that someone else changed after my scan to be reported as a conflict and not overwritten, so that I do not destroy their work.
24. As a site admin, I want the app to create a labelled restore version of each page before writing it, so that I can roll back a bulk change with the existing DA version history.
25. As a site admin, I want links in the report to open each written page in the editor, so that I can spot-check the result.
26. As a site admin, I want the app to tell me that applying writes DA source only and that pages still need preview/publish, so that I do not assume the live site changed.
27. As a site admin, I want pages I cannot write to be marked read-only in the grid, so that I do not waste edits on rows that cannot be applied.
28. As a site admin, I want pages that fail to load or parse during the scan to be listed separately, so that a block hiding on an unreadable page is not silently missed.
29. As a site admin, I want to leave the block name blank to get a summary of all block types found with their counts, so that I can discover what exists when I do not know the exact name.
30. As a site admin, I want changing the block name within the same scope to reuse the scan, so that I do not wait through another full crawl.

Cautious editor / reviewer:

31. As a reviewer, I want the diff to show unchanged neighbouring cells of the row, so that I can judge a change in context.
32. As a reviewer, I want a reminder in the app if the page's markup would be normalised on save (whitespace/attribute changes outside the edited block), so that unrelated content is never silently altered.

Extension author / maintainer:

33. As a maintainer, I want all code in one self-contained folder with a README (setup, config-sheet row, config read), so that the extension can be enabled, moved upstream, or deleted without side effects.
34. As a maintainer, I want an entry in the repo README extensions table, so that the extension is discoverable and passes the convention check.
35. As a maintainer, I want the core logic (parsing, edit model, diff, apply planner) unit-tested without EW or network, so that regressions are caught in CI.
36. As a maintainer, I want an in-memory fake of the DA Admin API (list, source, version), so that every scan/apply scenario, including continuation tokens, 412 conflicts and 403s, is testable offline.
37. As a security-conscious maintainer, I want page content never injected into the app DOM as raw HTML and the token never rendered or logged, so that a malicious page cannot act with the admin's rights.
38. As a maintainer, I want the app to work with `ref=local` and a branch ref, so that changes can be iterated and reviewed in real EW.

EW end user:

39. As an admin in EW, I want to find Block Bulk Editor in the Apps menu, so that I do not need to know its URL.
40. As an admin, I want a clear message if the page is opened outside EW, so that I understand why nothing loads.
41. As an admin opening a not-yet-trusted app, I want the README to explain the EW trust prompt, so that I am not alarmed by it.

## Implementation Decisions

Paths of modules appear in Build Analysis; this section stays at the decision level.

### Product and scope decisions

1. **Surface and type.** Fullscreen **app**, registered with a row in the `apps` sheet of the site config; folder `apps/block-bulk-editor/` with an entry page named after the folder, per the owner-approved convention. It does **not** register in the `library` tab. The extensions-table `type` is `app`.
2. **Target site = the site the app was opened for.** The org and site come from the SDK `context` (`org`, `repo`). In EW the code host and the content site are the same `org/site` (shell loads `{ref}--{site}--{org}.aem.live` for `/app/{org}/{site}/...`). No cross-site editing in v1. [VERIFIED in source: https://github.com/adobe/da-nx/blob/main/nx/blocks/shell/shell.js, see scaffold spec 2.3]. Consequence: to bulk-edit a site, the extension code must be deployed in that site (or repoless-mapped) [OPEN, see Q4].
3. **No backend and no secrets.** All calls go to the DA Admin API from the browser through `actions.daFetch` (SDK), authenticated as the user. `Backend needed: No` per #19. The `worker/` folder from the convention is not created.
4. **Reads no site config.** The README states this explicitly (AC4 "any site config it reads"): block names are typed or discovered by scanning, not read from the library config. Reading the site's blocks library to feed the picker is a possible later improvement [OPEN, Q9].
5. **Block type input.** Free text block name, matched case-insensitively against the block's first CSS class (the block name), optionally narrowed by variant filter in the grid. Block names in DA source are the first class token; options/variants follow as additional classes, e.g. `Columns (dark, wide)` becomes `class="columns dark wide"`, and multi-word options are hyphenated (https://www.aem.live/developer/markup-sections-blocks, "Block Options") [VERIFIED].
6. **Path filter.** A folder path prefix, default `/` (whole site). It is the crawl root. Glob/wildcard patterns are not in v1 [OPEN, Q10]. Only `.html` documents are scanned. Folders are those list entries without `ext` (https://docs.da.live/developers/api/list, note under Response) [VERIFIED].
7. **Scan indexes all blocks per page, not just the picked one.** A page is fetched and parsed once; every block on it is recorded (name, variants, position, cells). Picking or changing the block name filters the in-memory index (user story 30); a blank block name shows the block-type summary (story 29). The index stores parsed cell values for blocks, not whole page HTML.
8. **Instance identity.** An instance is identified by (page path, block ordinal among all recognised blocks on the page in document order). "Position" shown to the user is the 1-based ordinal among instances of the same block name on that page, plus the section number. Cell identity adds (row index, cell index).
9. **What counts as a block.** Following the upstream block editor's prior art: elements matching `main > div > div[class]` (div form) and `main > div > table` (table form), excluding the non-content blocks `metadata`, `section-metadata`, `da-metadata`, `library-metadata` (https://github.com/adobe-rnd/ew-extensions/blob/main/tools/block-editor/document.js, function `sourceBlocks`) [VERIFIED for upstream's rule; whether stored DA source ever contains table-form blocks is [ASSUMPTION], so both are read and the original form is preserved on write]. Each child `div` of the block is a row and each of its child `div`s a cell, matching the documented markup (https://www.aem.live/developer/markup-sections-blocks) [VERIFIED].
10. **Cell model.** Each cell is classified from its content, which decides its editor in the grid and its safe write-back:
    - `text`: one text container (paragraph, heading, list item, optionally wrapped in inline formatting) with no links or images. Editor: plain text input (multi-line if the cell has `<br>`). Write-back replaces the text inside the existing wrapper, preserving the element and its formatting wrapper.
    - `link`: exactly one `<a>` as the content. Editor: text + URL. Write-back updates link text and `href` on the existing anchor.
    - `image`: exactly one `<picture>`/`<img>` and no text. Editor: source URL + alt text. Write-back updates `src`/`alt` on the existing `<img>` (and clears now-stale `<source>` srcsets from the same picture so a changed image is not shadowed [ASSUMPTION: `<picture>` `<source>` elements are present in DA source; if not, no-op]).
    - `rich`: anything else (multiple elements, lists, mixed). Editor: restricted-HTML textarea. On apply the value is sanitised against the allowlist of tags documented for block cells (`a br code del em h1-h6 img li ol p picture source span strong sub sup table tbody td th thead tr u ul`; https://www.aem.live/developer/markup-reference, "Main Content") [VERIFIED list]; anything outside it is rejected with a validation error, not silently dropped.
    The depth of rich-cell editing in v1 is an owner decision [OPEN, Q11].
11. **Grid shape.** One row per instance. Columns: page, position, variant, then one column per (row, cell) position, as a union across the instances in view. Instances with fewer cells show disabled cells. Column labels: the shared first-cell key text if every instance with that row has the same key text and the block is key/value style (all rows have exactly two cells whose first cell is text; this mirrors the `optionKey` detection in the upstream block editor), otherwise "Row R, Cell C". Variant and block name are read-only (variant editing is not in v1).
12. **Large result sets.** Client-side filter + pagination (default 100 rows per page) rather than rendering every row. [ASSUMPTION: pagination is sufficient for sites in the low thousands of instances; no measured limit.]
13. **Edit model.** Edits are staged in memory as (cell identity, before value, after value). A row is dirty when any cell differs from its scanned value. Reset/undo operates per cell and per row. Nothing is written until Apply.
14. **Diff.** The review step shows, per changed row: page, position, and per changed cell the before and after values (text/URL/alt as text; rich as sanitised-HTML text diff), with unchanged cells of the row shown muted for context. Grouped by page with a header count. Row/page checkboxes allow deselecting.
15. **Apply pipeline per page** (pages are independent work items):
    1. `GET /source/{org}/{repo}{path}.html` with `actions.daFetch`; keep the response `ETag`.
    2. Parse; locate each edited block by ordinal and verify its name and that the cell's current value still equals the scanned "before" value. If not, the page is a **conflict** and is not written.
    3. Check the response write permission when available (see decision 19); otherwise rely on the write response.
    4. Optionally create a restore point: `POST /versionsource/{org}/{repo}{path}.html` with JSON body `{ "label": "..." }` (label required; 201 on success; 422 if the type is not versionable) (https://github.com/adobe/da-admin/blob/main/src/storage/version/put.js, `postObjectVersion`; https://github.com/adobe/da-admin/blob/main/docs/openapi/version-api.yaml) [VERIFIED].
    5. Apply the edits to the parsed document, serialise, and `PUT /source/{org}/{repo}{path}.html` as `multipart/form-data` with the HTML in the `data` field (the same call da-nx makes: https://github.com/adobe/da-nx/blob/main/nx/utils/daFetch.js `saveToDa`), with header `If-Match: <ETag from step 1>`. A `412` means someone wrote between our GET and PUT: reported as a conflict. [VERIFIED: If-Match handling on PUT in https://github.com/adobe/da-admin/blob/main/src/storage/version/put.js; CORS allows all request headers and exposes `ETag`: https://github.com/adobe/da-admin/blob/main/src/utils/daResp.js.]
    6. Record the result (written / skipped-unchanged / conflict / forbidden / invalid / network error) with its message.
    Pages run with a small bounded concurrency (default 4 [ASSUMPTION]; DA documents no rate limit [OPEN, Q7]). Apply is cancellable between pages; in-flight pages finish. Failed pages can be retried individually (they re-run the whole pipeline from step 1).
16. **Untouched pages are not rewritten.** A page enters Apply only if at least one selected row on it is dirty. A page whose edits turn out to produce byte-identical HTML after serialisation is reported "unchanged, not written".
17. **Whole-page write fidelity guard.** Writing back means replacing the whole page HTML, so unrelated markup must not change. Decision: before writing a page the pipeline serialises the parsed page with **no** edits applied and compares to the fetched source; if they differ beyond whitespace, the page is flagged "markup would be normalised" and skipped unless the admin opted in for that run [OPEN, Q12]. The review step warns about flagged pages (user story 32) [the scan can compute the flag cheaply: the page is already parsed].
18. **Restore point default.** The pre-write version snapshot (step 4) is **on by default**, with a toggle, because a plain `PUT` does **not** create a version: versions are created only for an explicit label or when the body is emptied (https://github.com/adobe/da-admin/blob/main/src/storage/version/put.js: `shouldCreateVersionObject = createVersion && (update.label != null || Label === 'Restore Point')`) [VERIFIED by source reading]. Without it there is no automatic undo for a bulk change. Cost: one extra request per written page.
19. **Permissions.** `actions.daFetch` sets `response.permissions` from the `x-da-actions` header (value format `/<key>=read,write` per `daResp`) (https://github.com/adobe/da-nx/blob/main/nx/utils/daFetch.js; https://github.com/adobe/da-admin/blob/main/src/utils/daResp.js). When the scan's GET carries it and `write` is absent, the page's rows are marked read-only. Whether source GET always carries this header is unverified [ASSUMPTION]; if absent, a `403` on PUT is reported as "forbidden". The server enforces write permission regardless (`hasPermission(..., 'write')` in https://github.com/adobe/da-admin/blob/main/src/routes/source.js) [VERIFIED].
20. **Scan pipeline.** Crawl from the filter path with `GET /list/{org}/{repo}{path}`; the list is one folder level, non-recursive; the listing is paginated via the `da-continuation-token` response header, sent back as a request header on the next call until absent (https://github.com/adobe/da-admin/blob/main/docs/openapi/list-api.yaml and `parameters.yaml`; prior art https://github.com/adobe/da-nx/blob/main/nx/public/utils/tree.js `getChildren`/`crawl`) [VERIFIED]. Folders are queued, `.html` files are fetched with `GET /source/...` and parsed. Bounded concurrency, progress callbacks, cancellation. Errors per page are collected, not fatal. The reserved `.da-versions` segment returns 404 from the admin and is ignored (https://github.com/adobe/da-admin/blob/main/src/index.js) [VERIFIED].
21. **Do not import da-nx's `crawl`.** It is an internal da-nx module (https://github.com/adobe/da-nx/blob/main/nx/public/utils/tree.js) that imports its own `daFetch` and the global IMS state, so it cannot be driven through the injected `daFetch` seam, and it is not a documented public API. It polls on a timer and offers only a coarse `cancelCrawl`. The extension has its own small crawler built on the same API contract, written against the injected `daFetch`.
22. **Admin origin.** Use the SDK-supplied `context.daOrigin` (present in the shell context: https://github.com/adobe/da-nx/blob/main/nx/blocks/shell/shell.js) so stage/local admin overrides keep working; fall back to `https://admin.da.live` when absent [ASSUMPTION: `daOrigin` is always supplied to apps].
23. **Token handling.** Use `actions.daFetch` rather than building `Authorization` headers: the app never touches the token string, which keeps it out of code, DOM, logs and tests. [VERIFIED: `daFetch` is part of the `actions` the SDK resolves with: https://da.live/nx/utils/sdk.js.] Open point: `daFetch` calls `loadIms()`/`handleSignIn()` on a 401, which may navigate the iframe [ASSUMPTION; OPEN Q6]; the app must treat 401 as "session expired, reload from EW" and stop.
24. **Security: untrusted content.** Page HTML comes from any author on the site and is processed with the admin's token. Rules: parse with `DOMParser` (inert document, scripts do not run); never assign page-derived strings to `innerHTML` of the live document; render values with `textContent`; rich previews are rebuilt node by node from the allowlist (tags above; attributes only `href`, `src`, `alt`, `class` for spans; URL schemes `https:`, `http:`, relative, `mailto:`, `tel:`); images are not loaded in the grid (placeholder chip with alt/src text) so the app does not fire requests to arbitrary hosts when merely scanning.
25. **Standalone behaviour.** Same as scaffold: "waiting for Experience Workspace" then "not running inside Experience Workspace" (SDK never times out).
26. **Technology.** Vanilla DOM and ES modules, no framework, no build step, to stay inside the scaffold's tooling (ESLint 8 + helix config, Stylelint 16, WTR, Playwright, Node 22). Upstream's larger tools use Lit via da-nx; not adopted here to avoid a runtime dependency on da-nx internals [OPEN, Q13].
27. **Module boundaries** (each with a narrow interface; names are conceptual):
    - **DA client**: list a folder (all continuation pages), get a source (+ETag, permissions), put a source with `If-Match`, create a version snapshot. Takes `daFetch` and `daOrigin` as inputs. Maps HTTP outcomes to a closed set of result kinds.
    - **Page model**: parse HTML to blocks/cells; classify cells; serialise; apply a list of cell edits to a parsed page with before-value verification; normalisation check. Pure functions, DOMParser only.
    - **Scan**: crawl + fetch + parse with concurrency/progress/cancel; produces the block index and the list of unreadable pages.
    - **Edit session**: staged edits, dirty tracking, undo/reset, filter/sort/pagination state, diff computation.
    - **Apply**: plans pages from the edit session, runs the per-page pipeline with concurrency/cancel/retry, produces the report.
    - **UI**: renders the form, grid, review dialog, progress and report from the above; the only module that touches the live DOM.
    - **Bootstrap**: awaits the SDK, wires `daFetch`/`context` into the modules.
    The Page model and DA client are the two bottom-most modules; UI never calls DA directly.
28. **Result kinds** (closed set, used in the report): `written`, `unchanged`, `conflict` (before-value mismatch or 412), `forbidden` (403), `unauthorized` (401), `invalid` (sanitiser/validation), `notFound` (404, page deleted), `error` (5xx/network; message kept; no token or request bodies).
29. **Accessibility baseline.** Semantic table with labelled inputs, keyboard-operable edit (Enter/Esc), visible focus, status updates in an `aria-live` region for progress. No full ARIA-grid keyboard model in v1.

## Testing Decisions

**What makes a good test here:** assert external behaviour only: what the admin sees in the DOM given a fake site, which requests reach the (fake) DA Admin API and in what order, and what the resulting site content is. Never assert on internal helper names, module call order, or CSS classes. Tests must not need network, IMS, or EW. Destructive behaviour is tested only against the in-memory fake or a dedicated sandbox site.

**Proposed seams** (recorded here instead of asked, per #57). Reuses the scaffold's seams S1/S2/S3 and adds one fake behind them; **no new seam type**:

| # | Seam | Used by | How it is stubbed |
|---|------|---------|-------------------|
| S1 (primary, highest) | Entry HTML page + SDK module boundary, with the DA Admin API behind `actions.daFetch` | Playwright e2e | As scaffold S1: `page.route()` serves the SDK stub; the stub's `actions.daFetch` forwards to real `fetch`, and `page.route()` on the admin origin is backed by the in-memory fake DA Admin (prior art: upstream `test/e2e/utils/da-api-stubs.js` `stubDaApi`). Any other external request is aborted. |
| S2 | Logic modules + injected `daFetch` | WTR unit tests | Call modules with a `daFetch` function wired directly to the same in-memory fake (no HTTP). Page model tested with HTML fixtures and no network at all. |
| S3 | Repo convention (folders, README table) | CI lint job | Inherited unchanged from the scaffold; this extension only has to satisfy it. |

The **in-memory DA Admin fake** is the one new test asset. It implements the documented behaviour that the extension depends on: `list` (folder-level, `ext` absent for folders, `da-continuation-token` pagination with a configurable page size), `source` GET/PUT (ETag, `If-Match` → 412, multipart `data`, 403 for read-only paths), `versionsource` POST (label required, records snapshots), and call logging. A **fake-contract test** pins the fake to the documented API shapes so it cannot drift silently from the primary sources cited in Build Analysis.

**Modules tested:** Page model (parse, classify, serialise, patch, normalisation check, sanitiser), DA client (outcome mapping), Scan, Edit session (dirty/diff), Apply (per-page pipeline), UI at the e2e level, the fake DA Admin itself.

**Prior art (upstream adobe-rnd/ew-extensions, read 2026-11-16):** `test/unit/block-editor/*.test.js` (DOM-based tests of block parsing/editing in WTR with an SDK fixture), `test/e2e/utils/da-api-stubs.js` (route-level DA Admin stub), `test/e2e/README.md` (Tier 1 stub-only in CI, Tier 2 real-session local). Within this repo: the scaffold's SDK stub and convention check (`apps/hello-world/SPEC.md`).

## Out of Scope

- Cross-site or cross-org editing; choosing a target site other than the one in `context`.
- Preview/publish after apply (the report only states the pages are still unpublished). Triggering `admin.hlx.page` preview/live is a follow-up.
- Editing block names, variants, adding/removing/reordering rows or cells, or moving blocks between pages.
- Text find-and-replace across arbitrary page content (non-block text), regular-expression search, or fill-down/"set this column to X for all selected rows" convenience [OPEN, Q14].
- Uploading or choosing media (image cells accept URLs only).
- Exporting the report (CSV/JSON), saved views, scheduled or recurring bulk edits.
- Server-side or background processing; any worker. Large-site scale beyond what a single browser tab can crawl.
- Glob path filters (Q10); reading the site blocks library config (Q9).
- Spreadsheet (`.json`) sources and non-HTML documents.
- Real-time collaboration awareness (detecting that someone has the page open in the editor).
- The Adobe outside-activity/IP policy decision and marketplace publishing (README flags them via #1).
- Visual design, EW design-system theming, accessibility audit beyond the baseline.

## Further Notes

- **Overlap risk (3/5 in the scoring sheet).** The scoring evidence says FindReplace Pro covers text only [ASSUMPTION: not verified]. The README should position this app as structural (block/cell/variant aware, with review and per-page report) rather than text replace. Check whether the EW team plans native bulk editing before investing heavily [OPEN, Q15].
- **Collab interplay.** After a successful source write, da-admin calls the collab service to sync open documents (`notifyCollab('syncadmin', ...)` in https://github.com/adobe/da-admin/blob/main/src/storage/utils/object.js, called from `postSource` for non-`collab` initiators) [VERIFIED call]. What an editor with the page open sees, and whether their unsaved edits can overwrite ours, is not documented [OPEN, Q8].
- **Docs vs source drift.** The docs example for apps uses the bare `DA_SDK` global; the SDK source only exports a default (scaffold spec, Further Notes). This spec imports the SDK, as the scaffold decided.
- **The DA Admin API reference at docs.da.live has moved** into aem.live docs; the `docs.da.live/developers/api` page is a stub today. The authoritative contract used here is the da-admin repo's OpenAPI files and source (https://github.com/adobe/da-admin, `docs/openapi/`, `src/`), plus the aem.live docs. If the public docs diverge, the repo's behaviour tests in the sandbox win (see M-steps).
- The `SPEC.md` is a planning artefact; same keep/delete decision as the hello-world spec applies once built [OPEN, low stakes].

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live, prod IMS)                 This repo (EDS code site)
 └─ /app/{org}/{site}/apps/block-bulk-editor/block-bulk-editor
      --iframe-->  https://{ref}--{site}--{org}.aem.live/apps/block-bulk-editor/block-bulk-editor.html
                   (ref=local -> http://localhost:3000/...)
      postMessage handshake: parent -> {ready, token, context, MessagePort}; page awaits the SDK default export

   iframe app (this extension)                          DA Admin API (https://admin.da.live, per context.daOrigin)
     UI  <->  Edit session / Scan / Apply  <->  DA client  --actions.daFetch (Bearer user token)-->  /list  /source  /versionsource
                                   \-> Page model (DOMParser)
```

- **Browser (this extension) does everything:** crawl, parse, edit state, diff, apply orchestration, reporting.
- **No worker:** reads and writes use the user's own IMS token through the SDK-provided `daFetch`. The shared worker template (#2) is unused. If a future need arises (server-side bulk jobs, scale beyond one tab) it would live in `apps/block-bulk-editor/worker/` per convention.
- **EW (host):** iframe, token, trust prompt, config-sheet lookup. The app is stateless across reloads: no persistence of the index or edits (in-memory only) [ASSUMPTION: acceptable for v1; Q16].

## 2. EW integration points

- **Type:** fullscreen app. Config: row in the `apps` sheet of the site config at `https://da.live/config#/{org}/{site}/` with columns `title`, `description`, `image`, `path`, `ref` (https://www.aem.live/docs/ew/developing/apps-plugins, "Enable") [VERIFIED]. Proposed row:

  | title | description | image | path | ref |
  |---|---|---|---|---|
  | Block Bulk Editor | Edit one block type across many pages, review the diff, and apply. | (blank) | `https://da.live/app/{org}/{site}/apps/block-bulk-editor/block-bulk-editor` | (blank) |

  The doc's `path` examples are full `da.live/app/...` URLs; `ref` column semantics for apps are undocumented [OPEN, carried from scaffold R11]. A card then appears at `https://da.live/apps#/{org}/{site}` (AC5 "reachable from the EW Apps menu").
- **Direct URL:** `https://da.live/app/{org}/{site}/apps/block-bulk-editor/block-bulk-editor` (`?ref=local` or `?ref=<branch>`), mapping per scaffold 2.3 [VERIFIED].
- **SDK actions used:** only `daFetch` (+ `context`). Not used: `sendText`, `sendHTML`, `closeLibrary` (plugin-only features per the docs). `setTitle` is automatic. [VERIFIED in https://da.live/nx/utils/sdk.js.]
- **Context fields used:** `org`, `repo` (site), `daOrigin`; the app shell supplies `context = { view: 'fullscreen', org, repo, ref, path, search, hash, daOrigin, imsOrigin }` plus `token` and `email` (https://github.com/adobe/da-nx/blob/main/nx/blocks/shell/shell.js) [VERIFIED in source; not a documented contract, see scaffold 2.2]. The app must fail with a readable message if `org` or `repo` is missing.
- **Trust prompt:** apps from non-trusted orgs show a warning on first open per `org/repo/ref`; README must say the app acts with the user's rights, which is literally the case here (writes pages) (scaffold 2.4) [VERIFIED].
- **Deployment prerequisite (inherited from #1):** AEM Code Sync on the repo and the site registered; branch-ref testing impossible otherwise (scaffold R3).

## 3. External APIs and auth flows

All calls go through `actions.daFetch(url, opts)`, which adds `Authorization: Bearer <user IMS token>` (https://da.live/nx/utils/sdk.js includes `daFetch` in `actions`; behaviour read in https://github.com/adobe/da-nx/blob/main/nx/utils/daFetch.js) and returns the `Response` with `permissions` parsed from `x-da-actions`. Primary source for the Admin API: https://github.com/adobe/da-admin (`docs/openapi/*.yaml`, `src/`), read 2026-11-16. The public DA docs reference (https://docs.da.live/developers/api, https://docs.da.live/developers/api/list) is partly stubbed/moved.

| Call | Purpose | Contract notes | Source |
|---|---|---|---|
| `GET {daOrigin}/list/{org}/{repo}{folder}` | Crawl | JSON array of `{ path, name, ext?, lastModified? }`; folders have no `ext`; one level only; empty array for empty or missing folder (cannot distinguish); 401 empty body; continuation: `da-continuation-token` response header, resend as request header | https://docs.da.live/developers/api/list; da-admin `list-api.yaml`, `parameters.yaml`, `src/storage/object/list.js` |
| `GET {daOrigin}/source/{org}/{repo}{path}.html` | Read page | Body = stored HTML; `ETag` exposed; 403/404 mapped from permission/missing; extension required in path | `source-api.yaml`; `src/routes/source.js`; `src/utils/daResp.js` (exposes `ETag`) |
| `PUT {daOrigin}/source/{org}/{repo}{path}.html` | Write page | `multipart/form-data` with `data` = HTML blob (as in da-nx `saveToDa`) or raw `text/html` body; 201 on success (verified in `putObject` result status for create; update returns the S3 put status, [ASSUMPTION: 200/201 both treated as success]); `If-Match: <etag>` → 412 on mismatch | `source-api.yaml`; `src/helpers/source.js` (`putHelper`); `src/storage/version/put.js`; da-nx `daFetch.js` |
| `POST {daOrigin}/versionsource/{org}/{repo}{path}.html` | Restore point | JSON `{label}` required (400 otherwise); 201 created; 422 not versionable | `version-api.yaml`; `src/storage/version/put.js` |
| (optional later) `GET /versionlist/...` | Verify restore points in tests/M-steps | Lists versions/audits | `version-api.yaml` |

Auth/error semantics: anonymous → 401; no permission → 403; reserved `.da-versions` path → 404 (`src/index.js`) [VERIFIED]. CORS: `Access-Control-Allow-Origin: *`, allow headers `*`, methods `HEAD, GET, PUT, POST, DELETE`, exposed `ETag`, `da-continuation-token`, `X-da-actions` (`src/utils/daResp.js`) [VERIFIED], so a browser app on `*.aem.live` can call them with custom headers.

Rate limits, per-request size limits, and list page size: not documented [OPEN, Q7]. S3 `ListObjectsV2` defaults to up to 1000 keys per page and da-admin passes no `MaxKeys` from the client, so continuation must be handled for folders > 1000 entries [ASSUMPTION: derived from S3 behaviour and `buildInput` in `list.js`; confirm in sandbox M7].

## 4. Data contracts (in-app)

Prose tables, not code. Names are indicative.

**Block instance** (one per grid row): `pagePath` (e.g. `/blog/post-1`), `ordinal` (0-based among recognised blocks on that page), `name` (first class token or table header name), `variants` (remaining class tokens), `form` (`div` | `table`), `section` (1-based), `position` (1-based among same-name instances on the page), `rows` (list of rows; row = list of cells), `canWrite` (boolean | unknown).
**Cell**: `kind` (`text|link|image|rich`), `value` (type depends on kind: string; `{text, href}`; `{src, alt}`; sanitised HTML string), `readOnly` reason if any.
**Edit**: `{ pagePath, ordinal, name, row, cell, kind, before, after }`.
**Page work item** (Apply): `{ pagePath, edits[], selected }`. **Page result**: `{ pagePath, kind (see decision 28), message?, etag?, restoreLabel? }`.
**Scan result**: `{ instances[], blockSummary (name → {instances, pages}), unreadable[] ({pagePath, reason}), stats }`.
**Progress event**: `{ phase: scan|apply, folders, pagesRead|pagesDone, failed, total? }`; `total` is unknown during the scan.

## 5. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Data loss by whole-page rewrite**: `PUT` replaces the entire page; serialisation drift or a missed edge case in block parsing could alter unrelated content. | High | Before-value verification per cell; normalisation guard (decision 17); restore-point snapshot default on (decision 18); fixtures with realistic and nasty markup; sandbox-only destructive M-steps. |
| R2 | **No automatic undo**: plain PUT creates no version (verified in source). | High | Labelled snapshot before every write; report tells the user how to roll back via version history; test that the snapshot call precedes the PUT and that a failed snapshot blocks the write. |
| R3 | **Concurrent edits / collab**: someone has the page open; collab sync interplay undocumented. | Medium | `If-Match` + before-value check; conflicts are reported, never forced; M-step with a second tab (Q8). |
| R4 | **Scale**: crawling a large site with one GET per page from a browser tab. | Medium | Path filter, bounded concurrency, cancel, progress, in-memory index of parsed blocks only; document practical limits after M7; no hard cap invented. |
| R5 | **XSS with the admin's token**: page HTML is attacker-influenceable by any author. | High | Decision 24; unit tests with hostile fixtures (`<img onerror>`, `javascript:` links, `<script>`, `<svg onload>`); e2e asserts no script execution and no external requests from content. |
| R6 | **`daFetch` side effects on 401** (`handleSignIn()` may redirect/reload). | Medium | Treat 401 as terminal; verify in M-step; avoid loops (Q6). |
| R7 | **Block recognition mismatch**: stored DA source may differ from the assumed `main > div > div[class]` form (tables, nested wrappers, section wrappers). | Medium | Fixtures taken from a real sandbox site (M-step captures real source); support both forms; scan summary lists "unrecognised structure" pages instead of silently skipping. |
| R8 | **Undocumented contracts**: SDK `context` shape, `daOrigin`, `x-da-actions` on GET, apps-sheet `ref`, update-PUT status code. | Low-Med | Validate in sandbox; defensive reads; tag assumptions in README. |
| R9 | **Cell editing semantics are lossy for rich cells** (formatting inside text, nested wrappers, images with multiple sources). | Medium | Typed editors preserve wrappers; rich cells go through the allowlist sanitiser and fail closed; owner decision on depth (Q11). |
| R10 | **Overlap with existing/planned EW functionality** (score: overlap 3/5). | Medium | Position as structural; ask the EW team (Q15). |
| R11 | **Prerequisites from #1** (Code Sync, DA org/site names, licence, Adobe policy) still open. | Carried | See scaffold spec section 7; not re-litigated. |
| R12 | **Testing against real DA is destructive** and needs a sandbox site with write access. | Medium | Dedicated sandbox DA site; seed script described in Testing Requirements (no production content ever). |

## 6. Ordered build plan (sized to #19's acceptance criteria)

0. **Prerequisites** (owner): #1 merged (convention, tooling, CI, stub harness); Code Sync + DA site registered; sandbox DA site with write access and seed content (Testing Requirements section 5).
1. **Page model, test-first (AC1, AC2, AC3):** parse/recognise blocks, classify cells, patch, serialise, normalisation check, sanitiser. Fixtures from the sandbox site's real source. Unit tests only; no UI.
2. **DA client + in-memory fake DA Admin (AC3):** outcome mapping, continuation, If-Match, snapshot. Fake-contract test.
3. **Scan (AC1):** crawl with concurrency/progress/cancel and block index; blank-name summary mode. Unit tests against the fake.
4. **Edit session and diff (AC2):** staged edits, dirty tracking, reset, filters, pagination state, diff output. Unit tests.
5. **Apply (AC3):** per-page pipeline, conflict handling, retry, cancel, report. Unit tests against the fake, including 412/403/404/5xx and snapshot-failure paths.
6. **UI and entry page (AC1-AC3):** form, progress, grid with typed cell editors, review dialog, progress/report; standalone state. e2e through S1 (stubbed SDK + fake DA Admin).
7. **Extension README and repo README table row (AC4, AC5):** setup, `apps` sheet row, "reads no site config", permissions and risks (restore point, publish step), local dev, branch-ref steps. One table row `block-bulk-editor`, folder `apps/block-bulk-editor/`, entry `block-bulk-editor.html`, type `app`. Convention check (S3) green.
8. **CI and lint (AC7):** nothing new to wire beyond the scaffold; verify the three jobs run this folder's unit/e2e tests.
9. **Manual EW verification (AC5, AC6):** M-steps in Testing Requirements with `ref=local` and a branch ref; record results in the PR.
10. **Hand-off notes:** measured scale limits, any API behaviours that differed from this spec, and the answers to open questions in the README.

Folder layout (inside the convention; sizes are guidance, naming is the implementer's call):

```
apps/block-bulk-editor/
├─ block-bulk-editor.html        entry page (SDK script + app script)
├─ block-bulk-editor.js          bootstrap: await SDK, wire modules
├─ block-bulk-editor.css
├─ page-model.js  da-client.js  scan.js  edit-session.js  apply.js   (side-effect-free logic)
├─ ui.js                          only module touching live DOM
├─ README.md
├─ SPEC.md                        planning artefact
└─ test/
   ├─ unit/*.test.js
   ├─ e2e/*.spec.js
   ├─ fixtures/                   HTML pages (real + hostile), expected outputs
   └─ support/fake-da-admin.js    in-memory DA Admin (+ its contract test)
```

---

# Testing Requirements

Runner and tooling follow the scaffold: `@web/test-runner` + Mocha + `@esm-bundle/chai` in real Chromium for unit tests, Playwright (Chromium) for hermetic e2e, tests inside the extension's `test/` folder, fetch guard enabled (any non-stubbed external request fails the test). Shared harness (SDK stub, fetch guard) comes from #1's `test/support/`.

## 1. Fixtures, mocks, helpers

- **Page fixtures** (HTML strings in the stored DA shape, `<body><header></header><main><div>...</div></main><footer></footer></body>`): a page with no blocks; one `cards` block; two `cards` blocks (one with variant `dark`, one `dark wide`) in different sections; a `hero`; a key/value `columns`-style block; a table-form block; metadata/section-metadata blocks (must be excluded); each cell kind (`text`, `link`, `image` with `picture`/`source`, `rich` with list + multiple paragraphs); a block with unequal cell counts; **hostile** content (`<script>`, `<img onerror>`, `javascript:` href, `<svg onload>`, huge attribute values); markup that normalises (whitespace, attribute order, uppercase tags) to exercise the fidelity guard; a page in a folder the fake marks read-only. At least one fixture captured from the real sandbox site (M1) so the assumptions in R7 are tested against real source.
- **In-memory fake DA Admin** (`test/support/fake-da-admin.js`): configurable site tree; `list` with folder entries lacking `ext`, `da-continuation-token` pagination at a configurable page size (set to 2 in tests); `source` GET with `ETag`; `PUT` multipart `data` with `If-Match` → 412; per-path ACL → 403; `versionsource` POST (label required, 400 otherwise, 422 for non-versionable); latency/failure injection (5xx, network error, 401); full request log. Exposed both as a `daFetch`-compatible function (S2) and as `page.route()` handlers (S1).
- **SDK stub** (S1/S2): reuse #1's shared stub for `context`/`token`; the stub must also provide `actions.daFetch`, which the scaffold's stub (only `sendText`/`closeLibrary`) lacks. Proposal: compose it locally (shared stub + `daFetch` override) rather than editing shared files from this ticket [OPEN, Q17]. The scaffold stub contract test ("same shape as the real SDK result") should be extended to include `daFetch` once it is added to the shared stub.
- **Token hygiene:** a test token string is injected; every e2e/unit run asserts it never appears in DOM text, logs, or the error messages in the report.

## 2. Unit tests (S2) and what they prove

Page model (AC1, AC2, AC3):
- recognises div-form and table-form blocks, excludes metadata-type blocks, extracts name/variants/section/position/cells in document order;
- `Columns (super wide)`-style classes parse to name `columns`, variant `super-wide`;
- classifies cells; `text`/`link`/`image` edits patch only the targeted node, preserving wrappers and sibling markup; byte-identical output when edits are empty on already-normal fixtures;
- before-value mismatch → conflict result, no patch;
- rich edit with disallowed tags/attributes/schemes → validation error, nothing patched;
- hostile fixtures never produce executable nodes in the preview builder; `textContent` rendering only; no `innerHTML` writes of page data (checked behaviourally: no script execution, no `javascript:` hrefs in produced DOM);
- normalisation guard flags drifting fixtures and passes stable ones.

DA client + Scan (AC1):
- crawls nested folders; follows continuation tokens until absent (folder with 5 entries at page size 2); treats entries without `ext` as folders and only fetches `.html`;
- scope: path filter `/blog` visits only that subtree; blank filter visits all;
- one unreadable page (403 / 5xx / parse failure) is listed in `unreadable` and does not stop the scan;
- cancel stops further requests (assert on the fake's request log) and returns partial results marked cancelled;
- concurrency never exceeds the configured bound;
- block-name match is case-insensitive; blank name yields the summary with correct counts; switching name reuses the index (no new requests);
- read-only marking when `x-da-actions` lacks `write`.

Edit session (AC2):
- editing a cell marks only its row dirty; edit then restoring the original value clears dirty; reset row/cell; counts of changed rows and pages are correct;
- diff contains before/after for exactly the changed cells, grouped by page, with unchanged cells flagged as context; deselected rows/pages are excluded from the plan.

Apply (AC3):
- only pages with selected dirty rows are requested for GET/PUT (assert on the fake's log: untouched pages have zero PUT, zero GET);
- order per page: GET → (snapshot POST) → PUT with `If-Match` = the GET's `ETag`; snapshot failure blocks the PUT; snapshot toggle off skips it;
- written content equals expected (diff against a golden fixture) and other pages in the fake are byte-identical afterwards;
- 412 → `conflict`; before-value mismatch → `conflict` without PUT; 403 → `forbidden`; 404 → `notFound`; 401 → `unauthorized` and the run stops; 5xx/network → `error`; each carries a message without the token;
- progress events are monotonic and end at total; cancel stops scheduling new pages and reports the written/skipped split; retry re-runs only failed pages and can then succeed;
- identical serialised output → `unchanged`, no PUT.

Fake contract test (supports all of the above): asserts the fake's behaviour matches the cited API facts (extensionless folders, continuation header name, `If-Match` 412, label required for versions, `ETag` exposed). It is the guard against drift from the primary sources; extend it whenever a sandbox run disagrees with the fake.

## 3. End-to-end tests (S1), hermetic, Playwright Chromium

Setup: serve the repo as in the scaffold (`aem up` on 3000, or its fallback static server); stub SDK + fake DA Admin as above; all other external requests aborted.

- **Happy path:** open the entry page with stub context `{ org, repo }`; enter `cards` and `/blog`; scan completes with the expected instance count; grid shows page, position, variant and cell values; edit a text cell and a link cell; changed rows are marked; open Review; diff shows before/after for exactly those cells; Apply; progress reaches 100%; report lists each page as written; the fake site content equals expected; untouched pages have no PUT in the request log.
- **Mixed outcomes:** fake injects one 403, one 412, one 500; report shows each failure with its reason; Retry on the 500 page succeeds; the conflict page stays unwritten.
- **Cancel:** cancel during scan and during apply; UI returns to a consistent state with the correct partial report.
- **Blank block name:** summary of block types with counts; selecting one shows its instances without extra list/GET requests.
- **Standalone:** SDK route unfulfilled → "not running inside Experience Workspace" message.
- **Security:** a hostile fixture page is scanned and displayed; no dialog/script executed (Playwright `dialog` listener and a `window` canary), no requests to hostile hosts, token never in page text/HTML.
- **Accessibility smoke:** grid cells reachable by Tab, edit with Enter/Esc, progress announced in the live region.
- **Large result sets:** 1,000+ fake instances: pagination renders only one page of rows; filter by text/variant works.

## 4. Convention and CI

- S3 convention check runs unchanged: folder has entry page named after it, README, tests; README extensions table has the `block-bulk-editor` row; the README documents the `apps` registration row so the table `type` (`app`) matches.
- CI: the three scaffold jobs (`lint`, `unit`, `e2e`) on push and PR must pass with this folder included (AC7). No secrets are required, since all tests are hermetic.

## 5. Manual verification in EW (needs an interactive Adobe IMS login; cannot run in CI)

**Accounts and credentials needed:**
- GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync), as in #1.
- An Adobe IMS identity with permission to edit the site config and with **write** access to the DA content of a **sandbox** site. Destructive tests must never target production content. Recommended: the DA org/site used for #1 (`jazhou-adobe/ew-extensions`) is also the content site (decision 2), so seed it with throwaway pages under `/sandbox/bbe/...` [OPEN, Q4].
- Optional: a second identity or a second browser profile for conflict testing; a read-only path (needs DA permissions config for the sandbox; how to configure is [OPEN, Q5]).
- No vendor API keys, no tokens in the repo.

**Seed content (sandbox, created by hand or via a throwaway script that is not committed):** ~12 pages in 3 folders using `cards` (two variants, 1 to 3 instances per page, text/link/image/rich cells), a `hero`, a `columns` key/value block and one page with none; two pages with markup that normalises; optionally one folder with >1000 trivial pages to exercise list continuation (M7).

- **M0 (prereq):** `curl -I https://main--ew-extensions--jazhou-adobe.aem.live/apps/block-bulk-editor/block-bulk-editor.html` returns 200 after first merge (inherited from #1 M0).
- **M1 (real source capture):** in the sandbox site, use `curl`/DA UI with a token to fetch the stored HTML of the seed pages; save as fixtures; confirm the block markup form assumed in decision 9 (div vs table). Feeds R7.
- **M2 (`ref=local`):** `npm start` on port 3000; open `https://da.live/app/{org}/{site}/apps/block-bulk-editor/block-bulk-editor?ref=local`; accept trust prompt; scan `cards` under `/sandbox/bbe`; grid lists every instance (compare counts with the seed manifest); edit two cells; review diff; Apply; verify each page in the EW editor shows the change and untouched pages' last-modified timestamps in `/list` are unchanged. Proves AC1-AC3, AC6.
- **M3 (branch ref):** push branch (simple name), open the same URL with `?ref=<branch>`; repeat a short scan/edit/apply cycle on one page. Proves AC6 branch ref.
- **M4 (Apps menu):** add the `apps` sheet row; the card appears at `https://da.live/apps#/{org}/{site}` and opens the app. Proves AC5.
- **M5 (restore point):** after M2, open version history of a written page; the "before bulk edit" label exists and restoring it returns the original content.
- **M6 (conflict):** scan, then edit one target page in the EW editor in another tab and save, then Apply from the app; that page is reported as a conflict and keeps the editor's content. Also test with the page open and unsaved in the other tab; record observed collab behaviour in the README (Q8).
- **M7 (scale and continuation):** scan the large folder; record time, peak requests in flight, and any 429/5xx; confirm continuation pages are followed. Record limits in the README (Q7).
- **M8 (permissions):** with a read-only path, rows on those pages are marked read-only or a 403 is reported; the app never writes them.
- **M9 (401 behaviour):** let the session expire (or revoke) and trigger Apply; record whether `daFetch` redirects the iframe; confirm the app stops with a clear message (Q6).
- **M10 (standalone):** open `http://localhost:3000/apps/block-bulk-editor/block-bulk-editor.html` directly; expect the "not inside EW" state.
- **M11 (clean-up):** delete the sandbox seed pages or restore them from versions.

Record screenshots/notes in the PR description (PR template asks for the test URLs).

## 6. Acceptance-criteria traceability (ticket #19)

| # | Acceptance criterion (#19) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Admin picks a block type and optional path filter; the app lists every instance (page, position, cell values) across the site | Unit: page-model recognition/position/cell extraction; Scan (nesting, continuation, path filter, unreadable pages, name matching, blank-name summary). E2E: happy-path scan, blank block name, large result sets | **M1** (real markup form), **M2** (counts match the seed manifest), **M7** (continuation at scale) |
| AC2 | Cells editable in the grid; changed rows show a before/after diff before apply | Unit: cell classification and typed edits, edit session dirty tracking/reset, diff content, sanitiser. E2E: edit text+link cell, changed rows marked, Review shows exact before/after | **M2** (visual check of editing and diff on real data) |
| AC3 | Apply writes changed pages via the DA Admin API with progress and a per-page success/failure report; untouched pages are not rewritten | Unit: Apply pipeline (only dirty pages requested; GET → snapshot → PUT with `If-Match`; golden output; 412/403/404/401/5xx outcomes; retry; cancel; zero PUTs for untouched pages in the fake's log). E2E: happy path content equality; mixed-outcomes report; cancel | **M2** (written pages visible in the editor; untouched pages' `/list` `lastModified` unchanged), **M5** (restore point), **M6** (conflict), **M8** (permissions), **M9** (401) |
| AC4 | All code in a self-contained `block-bulk-editor` folder per the scaffold convention, with README (setup, EW config-sheet row, any site config it reads) | S3 convention check (folder structure, README present, `type` matches documented registration row); unit/e2e tests live inside the folder | Review: README has setup, the exact `apps` row, an explicit "reads no site config" statement, permission/restore-point/publish notes; no imports from other extensions (lint) |
| AC5 | Listed in the repo README extensions table and reachable from the EW Apps menu | S3: table row exists and resolves to the folder and entry page | **M4** (card appears at `https://da.live/apps#/{org}/{site}` and opens the app); review of the README table row (name, folder, entry point, type `app`, description) |
| AC6 | Works in EW with `ref=local` and with a branch ref | E2E covers the page itself (hermetic); config-independent | **M2** (`ref=local`), **M3** (branch ref), **M10** (standalone), trust prompt noted |
| AC7 | Core logic covered by unit tests; lint and CI green | Unit suites for Page model, DA client, Scan, Edit session, Apply and the fake-contract test; CI `lint`, `unit`, `e2e` jobs green on push and PR | Verify on GitHub: the three checks on the PR; pre-commit hook blocks a staged lint error (inherited from #1) |

Every #19 acceptance criterion maps to at least one automated test or a numbered manual verification step above.

## 7. Open questions for the owner

1. **Adobe outside-activity/IP policy and marketplace/monetisation** (inherited from #1 R1/R2): this extension performs destructive writes on customer content; confirm it may be built and published under a personal account before anyone but you uses it.
2. **Overlap with FindReplace Pro (scoring sheet) and EW roadmap (Q15 below):** is FindReplace Pro a public EW/DA tool worth studying, and does it already handle blocks? No source was read for it.
3. **Prerequisites from #1** (Code Sync on the repo, DA org/site naming, config-sheet access, licence): still open per the scaffold spec.
4. **Target site for testing and use:** the app edits the site it is opened for, and code must be deployed in that site. Is `jazhou-adobe/ew-extensions` (or a sandbox repo) the intended content site, and may the test content live there? Should a future version let the admin pick another site they can access?
5. **Read-only test path:** how will a DA permissions config for the sandbox be created (which sheet and format)? Needed for M8; unverified in this spec.
6. **`daFetch` 401 behaviour:** `daFetch` calls `handleSignIn()` on 401 (source read); is that safe in an iframe, and is there a documented way to refresh the token in an app? We treat 401 as terminal until confirmed.
7. **API limits:** does DA Admin publish rate limits, request-size limits or a list page size? Default concurrency of 4 and no hard cap on pages are guesses [ASSUMPTION].
8. **Collab behaviour:** if the page is open in the EW editor when the app writes, which wins and does the editor user see the change? Who on the EW/DA team can confirm?
9. **Block picker source:** should v1 also read the site's blocks library config to suggest block names (adds a config read the README must document), or stay with typed name plus blank-name discovery?
10. **Path filter syntax:** prefix only (this spec), or glob/wildcards?
11. **Rich cell depth:** is restricted-HTML editing of complex cells wanted in v1, or should complex cells be read-only (diff-visible, not editable) to cut risk and effort?
12. **Fidelity guard strictness:** skip pages whose markup would be normalised on save (spec default, with an opt-in), or write them anyway and warn?
13. **Framework:** vanilla (spec) vs Lit via da-nx as upstream's larger tools do; the latter couples the extension to da-nx internals.
14. **Fill-down / "set column to value for selected rows":** wanted in v1 (it is the "bulk" in bulk edit) or is per-cell editing plus filtering enough for AC2?
15. **Roadmap overlap:** does the EW team plan native bulk block editing (R10)? Worth asking before a large build.
16. **Persistence:** is losing staged edits on reload acceptable in v1 (spec assumes yes), or should edits be saved to `sessionStorage`?
17. **Test harness changes:** may this ticket extend the shared SDK stub from #1 with `actions.daFetch`, or must it compose locally (spec default)?
18. **Restore point default:** on by default (spec) at the cost of one extra request per page, or opt-in?
