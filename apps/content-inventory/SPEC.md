# Spec: Content Inventory & Health (fullscreen app)

Ticket: jazhou-adobe/ew-extensions#26 (this spec: #64). Blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an Adobe answer.

Vocabulary follows #1 and #2: *extension* = one folder `apps/<name>/`; *app* = extension registered in the `apps` config sheet; *worker* = the per-extension backend in `apps/<name>/worker/`, built from `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension. Additional terms used here: *document* = a `.html` source document in DA; *page* = a document that is not a fragment; *fragment* = a document included into other documents (see Decision 5); *inventory* = the dataset of one scan; *flag* = a health finding on a document; *scan* = one end-to-end crawl run.

Primary sources read (all 2026-11-16 unless stated):
- EW developer docs https://www.aem.live/docs/ew/developing/apps-plugins; App SDK source https://da.live/nx/utils/sdk.js and https://da.live/nx/utils/daFetch.js.
- DA Admin API: https://docs.da.live/developers/api/list ; `adobe/da-admin` OpenAPI https://github.com/adobe/da-admin/blob/main/docs/openapi/list-api.yaml , `parameters.yaml` (header `da-continuation-token`), `source-api.yaml`.
- AEM Admin API (legacy `admin.hlx.page`) https://www.aem.live/docs/admin.html (embedded OpenAPI: `status`, `bulkStatus`, job operations, schemas `previewInfo`, `liveInfo`, `contentBusResource`); new AEM Admin API Service (`api.aem.live`, "hlx6") https://www.aem.live/docs/api.html ; API keys https://www.aem.live/docs/admin-apikeys ; roles https://www.aem.live/docs/authentication-setup-authoring ; limits https://www.aem.live/docs/limits .
- DA's own Admin client notes https://github.com/adobe/da-nx/blob/main/nx2/utils/api.md (routing between the two Admin generations, "H6 has no bulk status endpoint"); crawler prior art https://github.com/adobe/da-nx/blob/main/nx/public/utils/tree.js.
- Boilerplate conventions: https://github.com/adobe/aem-boilerplate (`scripts/scripts.js` `buildAutoBlocks`, `blocks/fragment/fragment.js`, `blocks/header/header.js`, `blocks/footer/footer.js`); https://www.aem.live/docs/fragments ; https://www.aem.live/docs/metadata ; https://www.aem.live/docs/special-metadata-properties ; https://www.aem.live/docs/bulk-metadata .
- Upstream prior art https://github.com/adobe-rnd/ew-extensions (tree read via the GitHub API; no inventory or fragment-usage code exists there).
- Peer specs in this repo for shared conventions and verified facts: `apps/block-bulk-editor/SPEC.md`, `apps/deep-clone/SPEC.md`, `apps/prepublish-linter/SPEC.md`, `apps/automation-connectors/SPEC.md`.

---

## Problem Statement

A content owner or site admin running a site in Experience Workspace (EW) has no single place to see what the site contains and what is wrong with it. To answer "how many pages do we have, which are stale, which fragments are used where, which pages are linked from nowhere, what is edited but not published" they must open documents one by one, or write throwaway scripts against the DA and AEM Admin APIs. Fragment-usage reports already circulate in the community as one-off scripts (scoring-sheet evidence, [ASSUMPTION: not independently located; I found no public tool, only AEM-classic content-fragment reports such as http://experience-aem.blogspot.com/2021/07/aem-cloud-service-content-fragments-usage-in-pages-custom-asset-report.html which is a different product]). Deleting or renaming a fragment, retiring a section, or planning a migration is risky without a reliable usage map.

Two kinds of data are awkward to obtain from a browser tab. Document content and modification times come from DA and are easy for a signed-in user. Preview and publish state comes from the AEM Admin API, and external link reachability from third-party sites, which a browser page cannot reliably probe (CORS, bot blocking, no safe place for a service credential). Large sites also make a crawl take minutes, so a scan has to show progress and survive a closed tab.

EW plans first-party optimisation insights (ticket rationale), so this extension must stay an **audit**: it reports facts and flags, it does not recommend, rewrite or score.

## Solution

A fullscreen EW app, **Content Inventory & Health**, opened from the EW Apps page. The user starts a scan (optionally limited to a folder). The app crawls the site's documents through the DA Admin API as the signed-in user, extracts per-document facts, asks the extension's own worker for preview/publish state (and, if enabled, external link reachability), and then shows:

1. an **inventory table** of every document: path, title, description, last modified, preview/publish status, word count and blocks used;
2. a **fragment usage report**: each fragment and every document that references it, with unused fragments flagged;
3. **health flags**: missing metadata, broken internal links, stale content (age configurable), unpublished changes, orphaned pages, unused fragments.

Results are filterable and sortable, and exportable as CSV (inventory, fragment usage, and issues). A long scan shows per-phase progress, can be cancelled, and can be **resumed** after a reload from a checkpoint kept in the browser. Only calls the browser cannot make go through the extension's worker: publish/preview status (needs a service credential held only in the worker) and external link checks (needs server-side egress). The worker is built from the shared template and rejects unauthenticated callers.

## User Stories

Site admin / content owner:

1. As a site admin, I want to open Content Inventory & Health from the EW Apps menu, so that I do not need to know a URL.
2. As a site admin, I want to start a scan of the whole site with one click, so that I get a complete inventory without configuration.
3. As a site admin, I want to limit a scan to a folder (for example one locale), so that I can audit a section quickly.
4. As a site admin, I want to see every document with path, title, description, last modified, preview/publish status, word count and blocks used, so that I can judge the state of the content at a glance.
5. As a site admin, I want the title and description shown to be the ones the site will actually serve (explicit metadata, else the same fallbacks AEM uses), and to see where each came from, so that I can tell authored values from derived ones.
6. As a site admin, I want to see which blocks each page uses (names and counts), so that I can find pages affected by a block change.
7. As a site admin, I want a fragment usage report listing each fragment and every document that references it, so that I know the impact before I edit or delete a fragment.
8. As a site admin, I want unused fragments flagged, so that I can clean them up.
9. As a site admin, I want orphaned pages (no other document links to them) flagged, so that I can decide to link, redirect or retire them.
10. As a site admin, I want header and footer fragments (`nav`, `footer`) treated as used by the site, so that they are not flagged as unused.
11. As a site admin, I want pages missing required metadata flagged with the missing key named, so that I can fix the SEO gaps.
12. As a site admin, I want to configure which metadata keys are required, so that the check matches my site's rules.
13. As a site admin, I want metadata supplied by the bulk metadata sheet to count as present, so that I am not flagged for values the site already provides.
14. As a site admin, I want broken internal links flagged with the source page and the broken target, so that I can fix them at the source.
15. As a site admin, I want links to redirected paths not reported as broken, so that known redirects are not noise.
16. As a site admin, I want stale content flagged when a document has not been modified for a configurable number of days, so that I can plan content reviews.
17. As a site admin, I want to change the stale threshold in the UI and see the flags update immediately without re-scanning, so that I can explore thresholds.
18. As a site admin, I want to see documents with unpublished changes (saved after the last preview, or previewed but not published, or never published) and why, so that I know what is not live.
19. As a site admin, I want to opt in to external link checks, so that I find dead outbound links without hammering third-party sites by default.
20. As a site admin, I want external link results that distinguish "broken" from "could not verify" (bot blocking, timeouts), so that I am not sent chasing false positives.
21. As a site admin, I want to filter the table by text, kind (page or fragment), flag, publish status and folder, so that I can focus.
22. As a site admin, I want to sort by any column, so that I can find the oldest, longest or largest items.
23. As a site admin, I want counts per flag shown next to the filters, so that I see the scale of each issue before drilling in.
24. As a site admin, I want to export the current inventory (filtered or all) as CSV, so that I can share it or analyse it in a spreadsheet.
25. As a site admin, I want separate CSV exports for fragment usage and for issues, so that I can hand work to the right people.
26. As a site admin, I want exported cells that cannot be interpreted as spreadsheet formulas, so that a hostile page title cannot attack whoever opens the CSV.
27. As a site admin, I want to see progress per phase (listing, reading, status, link checks) with counts and an estimate, so that I know a long scan is working.
28. As a site admin, I want to cancel a running scan and keep what was collected, so that I am not forced to wait.
29. As a site admin, I want to resume an interrupted scan after a reload, a crash or a token expiry, so that a 20-minute crawl is not lost.
30. As a site admin, I want to be told when a saved scan is for a different scope, configuration or app version, and to choose between resuming and starting fresh, so that stale checkpoints do not produce wrong results.
31. As a site admin, I want a clear message when preview/publish status is unavailable (worker down, not configured, wrong site), with the rest of the inventory still usable, so that one failing dependency does not block the audit.
32. As a site admin, I want per-document read failures listed (not silently dropped), so that I know which documents the inventory could not cover.
33. As a site admin, I want the "last scanned" time shown, so that I know how old the data is.

Content author (non-admin):

34. As a content author, I want to run the inventory with only my own DA permissions, so that I see exactly what I am allowed to see and no more.
35. As a content author without config-read permission, I want the app to fall back to defaults with a note, so that it still works.
36. As a content author, I want to click a path to open that document in the EW editor, so that I can fix an issue immediately.

Maintainer / reviewer:

37. As the maintainer, I want all code, README and tests in `apps/content-inventory/`, so that the extension is self-contained per the #1 convention.
38. As the maintainer, I want the extension listed in the repo README extensions table, so that the table stays the source of truth.
39. As the maintainer, I want the README to list the config-sheet row that enables the app and every site config it reads, so that setup is copy-paste.
40. As the maintainer, I want the Admin API credential only in the worker's secret store, so that nothing sensitive ships in the public code site.
41. As the maintainer, I want unauthenticated worker calls to fail with `401`, so that the worker cannot be used by strangers.
42. As the maintainer, I want the extension to work with `ref=local` and with a branch ref, so that I and reviewers can test before merging.
43. As the maintainer, I want the scan logic covered by deterministic unit tests against a synthetic fixture site, so that CI proves correctness without EW, DA or a vendor account.
44. As the maintainer, I want the worker to cap work per call, so that it stays inside Workers Free limits and cannot be turned into an open scanner.

Security reviewer:

45. As a security reviewer, I want proof that the IMS token is sent only to the DA origin and the extension's worker, and never stored or exported, so that a leak of local data or a CSV cannot leak a credential.
46. As a security reviewer, I want proof that page-derived strings (titles, descriptions, link text) are rendered as text and never executed, so that a hostile document cannot attack the admin viewing the inventory.
47. As a security reviewer, I want proof that the worker rejects private, loopback and non-web targets (also via redirects) and path-injection in status paths, so that it is neither an SSRF primitive nor a way to read other sites with our credential.

## Implementation Decisions

(No file paths or code, except where noted. Paths are in the Build Analysis.)

1. **Surface and registration.** Fullscreen **app**, registered with one row in the `apps` sheet of the site config (`title`, `description`, `image`, `path`, `ref`); folder `apps/content-inventory/` with an entry page named after the folder, per the owner-approved convention [VERIFIED convention in `apps/hello-world/SPEC.md` Decision 2 and 2.5; sheet columns https://www.aem.live/docs/ew/developing/apps-plugins]. It is not a library plugin and registers nothing in the `library` tab. Direct URL form: `https://da.live/app/{org}/{site}/apps/content-inventory/content-inventory` (mapping per #1 section 2.3).
2. **Scope is audit only.** The app reports facts and flags. It never rewrites content, never previews or publishes, never recommends fixes beyond a one-line description of each flag, and has no scores. This is the ticket's explicit boundary against EW's first-party insights.
3. **Browser-first, worker for exactly two things.** The browser does everything it can as the signed-in user: list and read documents, parse, analyse, store, filter, export. The worker does only what the browser cannot: (a) preview/publish status from the AEM Admin API with a service credential, (b) external link reachability. No other backend. [See Open Question 1: the ticket asserts publish status cannot be fetched from the browser; I observed that the Admin API answers CORS preflights for extension origins and that DA's own client attaches the user's token to it, so this premise is questionable. The ticket text wins for v1; the status source is an interface so the alternative is a contained change.]
4. **Target site.** The org and site audited are `context.org` and `context.repo` from the SDK, the DA origin is `context.daOrigin` with fallback `https://admin.da.live` [same approach as `apps/block-bulk-editor/SPEC.md` Decision 22; shell context keys per #1 section 2.2]. The worker is bound to exactly one site by its configuration (`ORG`, `SITE` vars, Decision 17). The page asks the worker which site it serves; if it differs from the audited site the status phase is skipped with a visible notice (story 31). Org/site are never taken from the request by the worker.
5. **Document model.** A *document* is a `.html` file found by listing. Non-HTML files (images, PDFs, sheets) are recorded by name only, for link resolution, and are not inventory rows. A document is a **fragment** if its path has a `fragments` folder segment at any depth (matching the boilerplate's `a[href*="/fragments/"]` rule), or it is the site's header/footer document (`nav` and `footer`, root or per-locale), or it is the target of a fragment reference from any other document. Everything else is a **page**. The root `fragments` convention and `nav`/`footer` defaults are configurable (Decision 15). [VERIFIED boilerplate behaviour: `buildAutoBlocks` replaces any `a[href*="/fragments/"]` outside a `.fragment` block with the fragment content; the `fragment` block takes the first link's `href` else its text as path; footer uses metadata `footer` else `/footer`; header uses metadata `nav` else `/nav`. Sources: https://github.com/adobe/aem-boilerplate/blob/main/scripts/scripts.js , `blocks/fragment/fragment.js`, `blocks/header/header.js`, `blocks/footer/footer.js`.] Fragments authored as spreadsheets are possible per https://www.aem.live/docs/fragments and are out of scope (Out of Scope).
6. **Scan pipeline (phases).** (A) *List*: breadth-first walk from the scope folder with `GET {daOrigin}/list/{org}/{repo}{folder}`, one level per call, following the `da-continuation-token` response header (sent back as a request header) until absent; folders are entries without `ext`; the reserved `.da-versions` segment is skipped [VERIFIED: https://github.com/adobe/da-admin/blob/main/docs/openapi/parameters.yaml `continuationTokenParam`; folder rule https://docs.da.live/developers/api/list; prior art https://github.com/adobe/da-nx/blob/main/nx/public/utils/tree.js `getChildren`]. (B) *Read*: `GET {daOrigin}/source/{org}/{repo}{path}` for each `.html`, parse in an inert `DOMParser` document, extract, discard the HTML. (C) *Status*: ask the worker for preview/publish state of every document (Decision 16). (D) *External links*, only if enabled (Decision 18). (E) *Analyse*: a pure function over the collected data produces rows, links graph, fragment report and flags. Rows appear as soon as phase B finishes; status columns show "pending" until phase C reports. Analysis is recomputed from stored data whenever a setting changes, without re-reading the site.
7. **Extraction rules (per document).**
   - *Metadata*: the `metadata` block (rows of key/value cells) at the end of the document. DA source is stored as `<body><header></header><main>…</main><footer></footer></body>` with blocks as nested `div`s [VERIFIED: https://da.live/nx/utils/daFetch.js `replaceHtml`; block row/cell markup https://www.aem.live/developer/markup-sections-blocks]. The `metadata`, `section-metadata`, `da-metadata` and `library-metadata` blocks are non-content blocks, excluded from "blocks used" and from word count [prior art: upstream block editor's `sourceBlocks`, as cited in `apps/block-bulk-editor/SPEC.md` Decision 9].
   - *Title*: metadata `title`, else the first `h1` [VERIFIED: https://www.aem.live/docs/special-metadata-properties: "If not specified, AEM will use the first Heading 1"]. *Description*: metadata `description`, else the first text paragraph of 10 or more words [VERIFIED: same page]. Each is recorded with its source: `metadata`, `derived`, or `none`.
   - *Word count*: words in the text of `main`, excluding non-content blocks, `script` and `style`. Word boundaries come from `Intl.Segmenter` with word granularity (so CJK text is counted sensibly), not whitespace splitting [https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter ; [ASSUMPTION] available in all browsers EW supports; the app targets Chrome per #1].
   - *Blocks used*: block name = first class token of each block `div` (variants are additional class tokens; multi-word options hyphenated) [VERIFIED: https://www.aem.live/developer/markup-sections-blocks "Block Options"]; both div form and table form are read; result is a list of `(name, count)`.
   - *Links*: every `a[href]` in `main`, including inside blocks. Skipped: empty, fragment-only (`#x`), `mailto:`, `tel:`, `javascript:` and other non-`http(s)` schemes (never recorded). Query and hash stripped for internal targets. Relative links resolve against the document path. Absolute links on this site's own origins (`{ref}--{site}--{org}.aem.live`, `.aem.page`, `.preview.da.live`, any ref, plus configured `own-hosts`) are internal; all other absolute `http(s)` links are external. Stored per document as de-duplicated target lists.
   - *Fragment references*: (a) the first link or the text path inside a `fragment` block; (b) any link whose path contains a `/fragments/` segment outside a `fragment` block (boilerplate auto-block rule); (c) metadata `nav` and `footer` values; (d) implicit: if the document has no `nav`/`footer` metadata, it references the default header/footer documents (`/nav`, `/footer`) — recorded as `implicit` references so header/footer fragments are "used" by every page [VERIFIED boilerplate defaults above; ASSUMPTION that the target site's code follows the boilerplate].
   - Extraction never inserts parsed content into the live DOM, never triggers resource loads, and returns plain data only (Decision 24).
8. **Metadata evaluation.** Required keys are configurable (default `title` and `description`). For each required key the status is `explicit` (non-empty value in the page's metadata block), `bulk` (supplied by a matching row of the bulk metadata sheet), `derived` (an AEM fallback exists: title from `h1`, description from first paragraph) or `missing`. Page-level metadata takes precedence over bulk metadata [VERIFIED: https://www.aem.live/docs/bulk-metadata]. The bulk metadata sheet (a `metadata` sheet in the site root; URL patterns where `*` is a prefix/suffix wildcard such as `/docs/**`, evaluated top to bottom, later matching rows override earlier ones, empty string `""` explicitly removes a value) is read once per scan [VERIFIED semantics: same page; DA storage form `/metadata.json` and exact glob semantics are [ASSUMPTION], spike S9]. A `missing-metadata` flag (naming the key) is raised when the status is `missing`; with the setting `metadata-strict` on, `derived` also raises it. If the bulk sheet cannot be read, evaluation proceeds without it and the report says so (a page may then be over-flagged; never under-flagged).
9. **Internal link resolution.** Each internal target is normalised and checked against the set of paths collected in phase A (no extra requests): `/x` matches `x.html` (or a non-HTML file named `x.<ext>`), `/folder/` matches `folder/index.html`, a target with an extension matches that file name exactly (same matching as the prepublish linter's internal-link rule, `apps/prepublish-linter/SPEC.md` Decision 7). A miss is `broken` unless: (a) the path is a source in the site's redirects sheet (`/redirects`, read once if present [ASSUMPTION: DA stores it as `/redirects.json`, spike S9]), or (b) it is **unverifiable**: content-bus media (`/media_*`) and generated resources (sitemap, robots, query index, `.plain.html`), which are not in the DA source tree. Unverifiable targets are counted, never flagged. A fragment reference whose target is missing is a broken link of kind `fragment-reference`. Links outside the scan scope are resolved against the full listing only if that folder was listed; if the scope is a sub-folder, targets outside the scope are `out-of-scope` (counted, not flagged), never `broken` [Decision 6 consequence]. Case-sensitivity and the exact path normalisation EDS applies are [OPEN, spike S5]; the default is exact match after the normalisation above.
10. **Fragment usage report.** One row per fragment with: the list of *direct referrers* (documents of any kind, with reference kind `block`, `auto-link`, `metadata`, `implicit`), the count, and *transitive page referrers* (pages that reach the fragment through nested fragments, with a cycle guard). A fragment with zero direct referrers is `unused-fragment`, except header/footer documents, which are used implicitly (Decision 7). References to documents that do not exist are listed as `broken-fragment-reference` against the referring document. Referrers are drawn from the scanned scope only; the report states the scope.
11. **Orphaned pages.** A page is `orphaned-page` when no other scanned document (page or fragment, including `nav` and `footer`) contains an internal link to it. Self-links do not count. A link inside a fragment counts for the fragment's own links (it is a link from a document). Never flagged as orphaned: the home document (`/index`), `nav`, `footer`, fragments (they have their own flag), and paths matching `orphan-exclude` (default `/drafts/`, `/tools/`). v1 does not require reachability from the home page: a page linked only from another orphan counts as linked [OPEN, Question 6]. Only links in documents are considered; a page present only in a sitemap or query index is still orphaned.
12. **Preview/publish status.** From the worker per document: preview state and last modified, live state and last modified (state = `ok`, `missing` for the Admin API's `404`, or `error`). Derived status per document, using DA's last-modified for the saved content: `draft` (no preview), `previewed` (preview newer than or equal to saved content, not published), `published` (live present, saved content not newer than live), `published-with-changes` (live present, saved content or preview newer than live). A tolerance (default 60 s, setting `status-tolerance-seconds`) absorbs clock/granularity differences between DA and the content bus [ASSUMPTION: granularity and skew unmeasured, spike S2]. **`unpublished-changes`** flag = any of: saved after last preview (`edited-after-preview`), previewed but newer than live (`preview-not-published`), never published (`never-published`; includes `draft`). The reason is recorded and filterable [OPEN, Question 4: whether never-published drafts should raise the flag at all]. When status is unavailable, the flag is not raised and the status shows `unknown`, never `draft`.
13. **Stale content.** A document is `stale` when `now − DA lastModified` is greater than `stale-days` (default 365 [ASSUMPTION: no basis; owner to set], Question 5). The age is changeable in the UI and persisted per site; `0` or blank disables the flag. Because it depends only on stored data, changing it re-evaluates immediately with no re-scan (stories 16 and 17). The basis is the saved-content time in DA (not the publish time).
14. **Flag catalogue.** The complete set for v1, each with a stable id, a one-line description, an item-level or link-level scope, and no severity or score (audit only): `missing-metadata`, `broken-internal-link`, `broken-fragment-reference`, `broken-external-link` (opt-in), `stale`, `unpublished-changes`, `orphaned-page`, `unused-fragment`. Informational non-flag facts: `unverifiable-links` count, `unverified-external` count, `scan-errors`.
15. **Settings.** Precedence: in-app value for this site (persisted in the browser) > site config tab `content-inventory` (key/value rows, optional) > built-in default. Keys: `stale-days`, `required-metadata`, `metadata-strict`, `status-tolerance-seconds`, `scope` (default `/`), `exclude` (path patterns not scanned), `fragment-roots` (default `fragments`), `implicit-fragments` (default `/nav,/footer`), `own-hosts`, `orphan-exclude`, `external-links` (default off), `concurrency` (1-10, default 5). The tab is read with `GET {daOrigin}/config/{org}/{site}` (multi-sheet JSON; rows under the tab's `data`) [VERIFIED read path and shape as used by `apps/prepublish-linter/SPEC.md` Decision 4; https://docs.da.live/developers/api/config]. A missing tab, `401`, `403` or `404` is not an error: defaults apply and the UI says so (story 35). Org-level fallback is not read (Out of Scope). The README lists this tab and every other thing the app reads (Decision 25).
16. **Worker contract (what the browser may ask).** Three routes behind the template pipeline (CORS gate, IMS token check, routing): `GET /info` returns the bound site and the caps; `POST /status` takes up to 20 site-relative web paths and returns per-path preview/live state; `POST /links/check` takes up to 8 absolute URLs and returns per-URL verdicts. Exact shapes in Build Analysis section 4. Per-path failures are isolated (one failing path yields an `error` entry, not a failed request). The browser throttles batches (one status call at a time) so the Admin API's per-project limit is respected.
17. **Worker authentication, secret and binding.** Authentication, CORS (`https://da.live` and the site's own origins), error contract, logging and retry come from the template unchanged (`shared/worker-template/SPEC.md` Decisions 4-10). One secret, `ADMIN_API_KEY`: an AEM Admin API key for the bound site, sent by the template's `proxy` helper as `Authorization: token <key>` (or `X-Auth-Token`) to the single allowed host of the configured Admin API generation (`admin.hlx.page` or `api.aem.live`) [VERIFIED header forms: https://www.aem.live/docs/admin-apikeys]. The key's role should be the least that allows reading status: per-path `status` requires `preview:read`, `live:read`, `code:read`, `edit:read`, all held by role `basic_author` [VERIFIED: operation security in https://www.aem.live/docs/admin.html and role table in https://www.aem.live/docs/authentication-setup-authoring]. The caller's IMS token is never forwarded. The Admin API generation is explicit configuration (`ADMIN_API` = `legacy` or `hlx6`), not auto-detected [DA detects via a `ping` header, https://github.com/adobe/da-nx/blob/main/nx2/utils/api.md; semantics per site unverified, so the owner states it; Question 3].
18. **External link checks.** Opt-in per scan (setting `external-links` and a checkbox). Unique external URLs are collected across documents, de-duplicated, sent to `POST /links/check` in chunks of at most 8. The worker's verdict vocabulary is the prepublish linter's (`ok`, `redirected`, `broken` for `404`/`410`/persistent `5xx`/connection failure, `unverified` for `401`/`403`/`429`/`451`/`999`, timeout, redirect limits) [`apps/prepublish-linter/SPEC.md` Decision 8 and route contract]. Only `broken` raises `broken-external-link`; `unverified` is counted as information. Worker egress rules (no IP literals, no localhost or internal-looking hosts, `http`/`https` default ports only, redirects followed manually with the guard re-applied each hop, hop cap, no cookies, no caller headers, fixed user agent, `HEAD` then range-limited `GET`, no bodies returned, fixed response schema, per-URL and overall timeouts) are the prepublish linter's Decision 11, re-implemented in this extension's worker because the template's `proxy` helper requires a declared host allowlist and this route has no secret [`apps/prepublish-linter/SPEC.md` Decision 9; Question 8 asks whether the template should gain a shared helper]. The result of each URL is cached in the scan store so a resume or a re-analysis does not re-probe.
19. **Resume and persistence.** The scan state is checkpointed in the browser (IndexedDB, one database per extension origin, keyed by `org/site`): the pending folder queue with continuation tokens, the set of listed paths, per-document extracted records, status results, link-check results, the settings that affect collection (scope, exclude, fragment roots, own hosts, external-links), and an extractor version. Checkpoints are written after every N documents or T seconds (initial 25 / 5 s [ASSUMPTION]) and at every phase boundary. On open, an unfinished scan for this site offers **Resume** or **Start new**; if collection-affecting settings or the extractor version changed, resume is refused and the user is told why. A completed scan is shown immediately as the last result with its timestamp. Settings that only affect analysis (stale days, required metadata, strictness, tolerance, orphan exclusions) never invalidate a checkpoint. The store never contains the IMS token, response headers or raw HTML. Data stays in the user's browser; nothing is uploaded. [VERIFIED mechanism: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB. The app runs in a cross-site iframe (`*.aem.live` inside `da.live`), where browsers partition storage by top-level site (https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/State_partitioning); persistence across reloads in the real EW iframe, and Safari behaviour, are [ASSUMPTION], spike S7 and manual step M5.] A `ref=local` page (`http://localhost:3000`) and a branch/main page (`aem.live`) are different origins and have separate stores.
20. **Authentication and token handling.** One internal `authedFetch` is the only place the token is used. It wraps the SDK's `actions.daFetch` and refuses any URL whose origin is not the DA origin or the extension's own worker origin, because `daFetch` attaches the Bearer token to every URL it is given [VERIFIED: https://da.live/nx/utils/daFetch.js sets `Authorization` for any URL when IMS details exist]. Using `actions.daFetch` also keeps the token current when the parent posts refreshes (the SDK result's own `token` is only the initial value) [VERIFIED: https://da.live/nx/utils/sdk.js calls `setImsDetails` on later messages]. Cost: on a `401`, `daFetch` triggers an interactive IMS sign-in redirect [VERIFIED: `handleSignIn()` in `daFetch.js`], which inside an iframe may navigate away; the crawl therefore checkpoints frequently so resume recovers (Decision 19; Open Question 11, spike S6). The token is never rendered, logged, stored, exported or put in test snapshots. The worker origin is a constant in the extension, never read from the URL (template Decision 13).
21. **Concurrency and politeness.** Reads use a bounded pool (default 5, user setting 1-10; the same conservative default as `apps/deep-clone/SPEC.md` Decision 19 [ASSUMPTION: DA documents no rate limit]); the folder listing is sequential per folder with pagination; transient failures (`429`, `5xx`, network) are retried with exponential backoff and a small cap; permanent failures (`403`, `404`, malformed) are recorded per document in `scan-errors` and the scan continues. The status phase makes one worker call at a time. The AEM Admin API's limit is 10 requests per second per project for all operations, shared with authors and other tools, and throttled requests get `429` [VERIFIED: https://www.aem.live/docs/limits "Admin API Limits"; the response headers I observed carry `x-ratelimit-limit: 10`].
22. **UI.** Single page, plain DOM (no framework, as hello-world). Regions: scan controls (scope, concurrency, external-links toggle, Start / Cancel / Resume / Start new), per-phase progress, summary counts per flag, tabs for *Inventory*, *Fragment usage*, *Issues*, filter bar, table. The table is paginated (page size 100 [ASSUMPTION]) or windowed so a 10,000-row inventory stays responsive. Each path links to the document's editor URL with `target="_blank"` and `rel="noopener noreferrer"` [the exact EW editor URL form is [OPEN] spike S4; the DA edit URL `https://da.live/edit#/{org}/{site}{path}` is used by DA's own tooling per https://da.live/nx/utils/daFetch.js `saveToDa` (`daHref`)]. Controls are native elements with labels; progress uses `role="progressbar"`; counts and state changes are announced politely. Standalone (outside EW) shows the hello-world "not inside Experience Workspace" state.
23. **Filtering, sorting, export.** Filters (combinable, AND): free text over path/title/description, kind, flag (any selected), publish status, blocks used, folder prefix, last-modified range. Sorting on every column. CSV export has three outputs: *inventory* (one row per document, respects the active filter by default with an "export all" option), *fragment usage* (one row per fragment-referrer pair, plus unused fragments with an empty referrer), *issues* (one row per flag instance: document, flag, detail such as the missing key or broken target). Format: RFC 4180 (comma separator, CRLF, double-quote escaping) [https://www.rfc-editor.org/rfc/rfc4180], UTF-8 with a byte-order mark so spreadsheet tools detect the encoding [ASSUMPTION; Question 15], and cells beginning with `=`, `+`, `-`, `@`, tab or CR are prefixed so spreadsheets do not treat them as formulas [https://owasp.org/www-community/attacks/CSV_Injection]. Block lists are joined with a fixed separator in one cell. The export is generated in the browser (Blob download); nothing leaves it.
24. **Rendering safety.** All page-derived strings (titles, descriptions, paths, link targets, block names, config values, error text) are written with `textContent`/attributes, never `innerHTML`. Parsing uses `DOMParser` (an inert document: scripts do not run, subresources are not fetched) and the parsed tree is discarded after extraction [VERIFIED by spec behaviour: https://developer.mozilla.org/en-US/docs/Web/API/DOMParser]. Outbound links in the UI are only `http(s)` and carry `rel="noopener noreferrer"`.
25. **Folder, README, table, config row.** The extension lives only in `apps/content-inventory/` (entry page, scripts, CSS, README, tests, fixtures, `worker/`). The README covers setup, the `apps` row (below), every site config it reads (the optional `content-inventory` tab, the bulk metadata sheet and the redirects sheet read from content, the DA permissions the user needs), the worker's deploy and secret steps, and the privacy note (data stays in the browser). The repo README extensions table gets one row: name *Content Inventory & Health*, folder `apps/content-inventory/`, entry `content-inventory.html`, type `app`, description *Audit every page and fragment: inventory, fragment usage, health flags, CSV export.* `apps` sheet row: title `Content Inventory & Health`, description `Inventory, fragment usage and health flags for this site`, image blank, path `https://da.live/app/{org}/{site}/apps/content-inventory/content-inventory`, ref blank.
26. **Tooling inherited, no additions.** ESLint 8 + helix config, Stylelint 16, `@web/test-runner`, Playwright, Node >= 22.12, husky as pinned by #1 and #2; the worker uses the template's wrangler/jose/`node:test` stack. No new runtime or dev dependency is planned.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: given a synthetic site (fake DA listing and sources, fake worker responses), assert the resulting inventory rows, flags, reports, exported bytes, progress events and the network calls made. Never assert on internal helper names, module structure, DOM beyond accessible roles/text, or CSS classes. Two properties are tested as *negative* properties across all paths: "the token never appears anywhere it should not" (store, export, DOM, logs, any request to another host) and "no document-derived string is ever executed or interpreted as markup". The most important positive property is **resume equivalence**: a scan that was interrupted and resumed produces exactly the dataset of an uninterrupted scan, without re-reading completed work.

**Proposed seams** (recorded here instead of asked, per #64). The boundaries are the ones the #1 and #2 specs already established, plus one new seam for the app's engine.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| SE (primary, new) | The scan engine: one function that takes injected ports (`da` list/read, `config`, `status` client, `linkCheck` client, `store`, `clock`, `settings`) and returns the dataset plus an event stream | new | WTR unit tests (the bulk of the tests) | A **fixture site**: an in-memory fake DA (folders, pagination tokens, documents, last-modified values, injectable failures) and a fake worker client; in-memory store with an interruption hook; injected clock |
| S1 (reused, extended) | Entry HTML page + SDK module boundary + network | #1 | Playwright e2e | #1's SDK stub; `page.route` fulfils `admin.da.live` (list/source/config) from the fixture site; the worker is the real local worker (W2 style) with a fake Admin API and fake IMS key server behind it |
| S2 (reused) | Pure modules (extract, analyse, CSV, filters) and the UI render functions | #1 | WTR | Hand-built inputs; no network |
| W1 (reused) | Worker HTTP boundary `worker.fetch(request, env, ctx)` | #2 | Node unit tests in `apps/content-inventory/worker/test/` | #2 test kit: fake IMS, signed tokens, fake upstream (fake Admin API), canary secret, injected `fetch`/`sleep`/`random`/`now` |
| W2 (reused) | Same worker in workerd over real HTTP | #2 | Smoke | `wrangler dev` with local fakes for IMS and Admin API |
| S3 (reused) | Repo convention check | #1 | CI lint job | Filesystem fixtures |

Why SE and not only S1: the logic (extraction, link graph, orphans, status derivation, resume) has a large combinatorial surface; driving it through a browser page would be slow and noisy. SE is a function-level seam that still tests behaviour (inputs: a fake site; outputs: dataset and events), and S1 then proves that the page wires the engine to the real boundaries. The IndexedDB implementation of the store is one adapter behind SE; a single contract test suite runs against both the in-memory and the IndexedDB adapters in real Chromium. The real EW boundary (IMS login, real DA content, real Admin API) is covered only by manual verification.

**Modules tested:** extractor; analyser (links, fragments, orphans, status derivation, metadata, stale); scan engine (progress, concurrency, cancel, resume, failures); store adapters; CSV exporter; filter/sort; UI render and wiring; worker routes (`/info`, `/status`, `/links/check`) incl. the SSRF guard and path validation; the worker-client contract; convention check for this folder.

**Prior art:**
- Unit: import-map SDK fixture and injected `fetchImpl`/`now` seams from upstream (`test/unit/block-editor/fixtures/utils/sdk.js`, `tools/brand-visibility/session-auth.js`) as cited in `apps/hello-world/SPEC.md`.
- E2E: `test/e2e/utils/da-api-stubs.js` (`stubDaApi`) from upstream, extended per `apps/hello-world/SPEC.md` and `apps/prepublish-linter/SPEC.md` (stubbed `admin.da.live`, real local worker).
- Worker: #2 test kit and Node `node:test` approach; link-check guard tests mirror `apps/prepublish-linter/SPEC.md` WK1-WK14.
- Crawler behaviour (pagination, skipping non-HTML, folder discovery): `apps/block-bulk-editor/SPEC.md` Decisions 20-21 and `apps/deep-clone/SPEC.md` Decision 4a.

## Out of Scope

- Recommendations, rewriting, scoring, health "grades", AI summaries, auto-fix, bulk edit, preview/publish/unpublish actions (EW first-party insights; Block Bulk Editor and Pre-publish Linter cover adjacent needs).
- Scheduled, recurring or server-side scans; sharing a scan between users; storing results in the worker or in DA. Results live in the scanning user's browser (and in CSV exports the user makes).
- Incremental re-scan that reuses unchanged documents from an earlier completed scan (only resume of an interrupted scan is built). [Possible follow-up; DA's last-modified makes it feasible.]
- Fragments authored as spreadsheets; non-HTML documents as inventory rows; media/asset inventory; accessibility, SEO scoring, performance, Core Web Vitals; analytics-based staleness (page views).
- Checking links inside blocks that load content dynamically at runtime (query-index driven lists), sitemaps, robots, redirect-chain analysis beyond "is the source in the redirects sheet".
- Multi-site or cross-org audits; a worker serving several sites; org-level config fallback.
- Bulk status via the Admin API's bulk job (needs a `publish`-role key) and hlx6 listing-based status; both are noted as alternatives (Question 2) and not built.
- A shared "public egress" helper in the template (Question 8); this worker carries its own guard.
- CI-driven worker deploy, custom domains, Cloudflare account choice (owned by #2).
- The Adobe outside-activity/IP policy and marketplace questions (owned by #1 R1/R2; README flags them).
- Cross-browser support beyond Chrome (per #1) and Safari/Brave mixed-content handling for `ref=local`.

## Further Notes

- **Premise of the ticket's worker split needs confirming (Question 1).** The ticket says calls the browser cannot make (publish status, external link checks) go through the worker. External link checks clearly cannot be made from a browser (CORS, bot defences). For publish status I observed on 2026-11-16: an `OPTIONS` preflight from `Origin: https://main--ew-extensions--jazhou-adobe.aem.live` with `Access-Control-Request-Headers: authorization,x-content-source-authorization` returned `204` with `access-control-allow-origin` echoing that origin and `access-control-allow-headers` including `Authorization` on both `https://admin.hlx.page/status/...` and `https://api.aem.live/{org}/sites/{site}/status/...`; an anonymous `GET` of `https://admin.hlx.page/status/adobe/da-live/main/` with `Origin: https://da.live` returned `200` JSON; and DA's own client attaches the user's IMS token (as `Authorization` and `x-content-source-authorization`) to calls to those hosts [VERIFIED: https://github.com/adobe/da-nx/blob/main/nx2/utils/api.md "Authentication"]. Whether a signed-in user's IMS token is accepted by the Admin API from an extension origin was not testable without a login (spike S1). If it is, a browser-direct status source would need no worker credential and would respect each user's permissions. This spec follows the ticket (AC5, AC9) and keeps the status source behind an interface.
- **Key-role consequence.** The Admin API's *bulk* status requires `edit:list`, `preview:list`, `live:list`; the `publish` role carries `live:list` but also `live:write`, so a leaked bulk-capable key could publish. Per-path `status` needs only read permissions that `basic_author` holds. The spec therefore uses per-path status with a least-privilege key at the cost of speed (10 requests per second per project, shared). [VERIFIED: https://www.aem.live/docs/admin.html (security of `bulkStatus` and `status`), https://www.aem.live/docs/authentication-setup-authoring (role table).] Two Admin generations coexist and DA's own client notes the new one has no bulk status endpoint [VERIFIED: nx2 `api.md` "Namespace: status"]; per-path status works on both.
- **Where the status result of a bulk job lives is undocumented** in the OpenAPI I read (the `bulkStatus` description lists `path`, `sourceLastModified`, `previewLastModified`, `publishLastModified`; the job details example shows only progress). Another reason to avoid depending on bulk status in v1.
- **Time estimates (planning numbers, [ASSUMPTION], measured in M9):** 1,000 documents: read phase at concurrency 5 and 200 ms per read is roughly 40 s; status phase at about 3 requests per second is roughly 5 to 6 minutes; external link phase depends on the count of unique URLs (8 per call). A 10,000-document site needs the resume feature for the status phase.
- **Permissions shape the data.** The scan lists and reads as the signed-in user; documents the user cannot read are absent or error and are reported in `scan-errors` where DA returns an error. The inventory is "what this user can see", stated in the UI and README. [ASSUMPTION: DA's list filters or errors by ACL; spike S3.]
- **Overlap.** Community fragment-usage scripts exist, and EW plans first-party optimisation insights. The differentiator in v1 is the combination in one audit view (inventory + fragment graph + health flags + resumable crawl + CSV) inside EW with the user's own permissions; the README should state "audit, not recommendations".
- This `SPEC.md` is a planning artefact; keep or delete it when the extension is built (same low-stakes decision as hello-world).

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)                         This repo (EDS code site)
 └─ /app/{org}/{site}/apps/content-inventory/content-inventory
        --iframe--> https://{ref}--{site}--{org}.aem.live/apps/content-inventory/content-inventory.html   (or .preview.da.live, or http://localhost:3000 for ref=local)
              │ SDK handshake: { token, context{org,repo,ref,daOrigin,...}, actions{daFetch,...} }
              │
              ├─ authedFetch (host-guarded actions.daFetch, Bearer IMS) ─────────────► DA Admin  admin.da.live
              │      list (paginated) · source (HTML) · config (optional tab) · metadata/redirects sheets
              │
              ├─ authedFetch ──► Cloudflare Worker  (apps/content-inventory/worker; core imported from shared/worker-template)
              │       1 origin gate → 2 IMS check → 3 routes
              │       GET /info · POST /status (≤20 paths) ──proxy, secret ADMIN_API_KEY──► AEM Admin API (status)
              │                  · POST /links/check (≤8 URLs, SSRF guard, no secret) ──► third-party sites
              │
              └─ IndexedDB checkpoint store (browser only)   ·   CSV via Blob download (browser only)
```

| Concern | Browser extension (public static files) | Worker (private runtime, holds the secret) |
|---|---|---|
| DA listing, reading, config | all of it, as the signed-in user | none |
| Parse, extract, analyse, flags | all of it | none |
| Preview/publish status | asks, displays, derives status/flags | holds `ADMIN_API_KEY`, calls the Admin API, isolates per-path failures |
| External link reachability | collects URLs, displays verdicts | probes with the SSRF guard, returns a fixed schema |
| Checkpoint / resume / export | all of it (IndexedDB, Blob) | none |
| Auth | obtains the IMS token via the SDK, sends it to DA and the worker only | verifies it (template), never forwards it |
| UI, filters, sorting | all of it | none |

## 2. EW integration points

- **Type: app** (not a library plugin). One `apps` sheet row (Decision 25). No `library` row. Config sheets are edited at `https://da.live/config#/{org}/{site}/` and need config permission [VERIFIED per #1 section 2.5, https://www.aem.live/docs/ew/administering/configs]. Card appears at `https://da.live/apps#/{org}/{site}`; the app is also reachable directly at the URL in Decision 1. EW's trust prompt appears the first time per `org/repo/ref` (#1 section 2.4).
- **SDK actions used:** `daFetch` (DA and worker calls, token kept current), and `setTitle` (automatic from `document.title`). No `sendText`/`closeLibrary` (those are library-plugin actions). Context keys used: `org`, `repo`, `ref`, `daOrigin` (fullscreen shell context per #1 section 2.2). The `token` field of the SDK result is not used directly (Decision 20).
- **Opening documents:** path links go to the EW editor. The exact URL form the EW editor expects (`https://da.live/edit#/{org}/{site}{path}` vs the newer EW shell) is [OPEN, spike S4]; implementation reads the form from one constant.
- **Site config read:** optional tab `content-inventory` (Decision 15). Also reads content-side sheets `metadata` (bulk metadata) and `redirects` if they exist (Decisions 8, 9). All reads are best-effort and non-fatal.
- **`ref=local`:** page served by the #1 dev server on port 3000; the worker runs locally on `http://localhost:8787` and the page uses it because it runs on `localhost` (template Decision 13). Local worker needs `ALLOW_LOCALHOST=true` in its local env and a local `ADMIN_API_KEY` in `.dev.vars` (or a fake Admin API for tests). **Branch ref / main:** the page on `*.aem.live` calls the deployed worker's `workers.dev` URL (a constant).
- **Origins the worker will see:** the three site hosts and `localhost:3000` per the template's CORS rules; the unknown remains which one EW uses in each mode (#2 R2; resolved by #2's W3).

## 3. External APIs and auth flows

| API | Use | Auth | Source / status |
|---|---|---|---|
| DA `GET {daOrigin}/list/{org}/{repo}{folder}` | walk the tree; items `{path, name, ext?, lastModified}`; folders have no `ext`; pagination header `da-continuation-token` (request and response) | `Authorization: Bearer <IMS>` via `daFetch` | https://docs.da.live/developers/api/list ; da-admin `list-api.yaml`, `parameters.yaml`; `lastModified` as epoch milliseconds and "empty array for empty or missing folder" from `apps/automation-connectors/SPEC.md` [VERIFIED there]; page size not documented [OPEN, S3] |
| DA `GET {daOrigin}/source/{org}/{repo}{path}.html` | read a document (extension required in the path) | same | https://github.com/adobe/da-admin/blob/main/docs/openapi/source-api.yaml |
| DA `GET {daOrigin}/config/{org}/{site}` | optional `content-inventory` tab | same | https://docs.da.live/developers/api/config ; shape as used by the prepublish linter spec |
| AEM Admin API status, legacy: `GET https://admin.hlx.page/status/{org}/{site}/{ref}/{path}`; hlx6: `GET https://api.aem.live/{org}/sites/{site}/status/{path}` | per-path preview/live state (response includes `webPath`, `resourcePath`, `live{status,url,lastModified,lastModifiedBy,...}`, `preview{...}`, optionally `edit`); read-only | `Authorization: token <API key>` or `X-Auth-Token` (worker only) | https://www.aem.live/docs/admin.html (operation `status`, schemas `previewInfo`, `liveInfo`, `contentBusResource`); https://www.aem.live/docs/api.html ; https://github.com/adobe/da-nx/blob/main/nx2/utils/api.md "Namespace: status" (URL shapes) [VERIFIED]. `?edit=auto` would call the content source and is not used. Behaviour for DA-backed content with an API key, `404` body for a never-previewed path, and path mapping of `index` are [OPEN, S2] |
| AEM Admin API limits | design the polling budget | n/a | https://www.aem.live/docs/limits: 10 requests/s per project for all operations, `429` when throttled [VERIFIED]; observed response header `x-ratelimit-limit: 10` on 2026-11-16 |
| AEM Admin API keys | how the owner creates the worker's key: `POST https://admin.hlx.page/config/{org}/sites/{site}/apiKeys.json` with `{description, roles:[…]}`; value shown once; needs `admin` role | admin-role caller | https://www.aem.live/docs/admin-apikeys [VERIFIED for legacy]; for hlx6 sites the route is [OPEN]; that `basic_author` can be assigned to an API key is [ASSUMPTION], spike S1 |
| Adobe IMS key set (worker side) | verify the caller's token | none | per #2 |
| Third-party sites (worker side) | external link probes | none | Decision 18 |
| Cloudflare Workers limits | Free: 100,000 requests/day, 10 ms CPU per request, 50 subrequests per invocation | n/a | https://developers.cloudflare.com/workers/platform/limits/ [VERIFIED per #2]; budget: `/status` = at most 20 Admin calls plus one JWKS fetch (21 of 50); `/links/check` = at most 8 URLs times (hops + fallback) must stay under the cap, hence 8 [ASSUMPTION, S8 measures] |

**Auth flows.** *Browser to DA and worker:* the SDK handshake supplies the IMS token; every call goes through `authedFetch` (`actions.daFetch`), which refuses other origins; the worker verifies the token (template) and never forwards it. *Worker to Admin API:* `ADMIN_API_KEY` injected by `proxy` from the secret store. *Worker to third parties:* none. No vendor account exists in this ticket; the only credential is the Admin API key.

## 4. Data contracts

All are behaviour contracts, not code.

**Collected record (per document; stored in the checkpoint; no HTML, no token).**

| Field | Meaning |
|---|---|
| `path` | DA path with `.html` (identity) |
| `webPath` | site-relative web path used for status and display (extension removed; `index` handling per S2) |
| `daLastModified` | epoch ms from the DA listing |
| `title`, `titleSource` | effective title; `metadata` / `derived` / `none` |
| `description`, `descriptionSource` | same |
| `metadata` | map of explicit metadata keys present (values truncated to a cap) |
| `wordCount` | integer |
| `blocks` | list of `(name, count)` |
| `links.internal` | de-duplicated normalised target paths |
| `links.external` | de-duplicated absolute URLs (credentials, fragments stripped) |
| `fragmentRefs` | list of `(target path, kind)`, kind in `block`, `auto-link`, `metadata`, `implicit` |
| `readError` | none, or a fixed reason (`not-found`, `forbidden`, `server-error`, `malformed`) |
| `extractorVersion` | integer; mismatch invalidates a checkpoint |

**Status result (per document, from the worker; stored).** `preview` and `live`, each `{ state: ok|missing|error, lastModified? (ISO), httpStatus? }`. Never the Admin API's raw body.

**Analysed row (derived, not stored).** Collected record + `kind` (page/fragment) + `publishStatus` (`draft`, `previewed`, `published`, `published-with-changes`, `unknown`) + `flags[]` with details + `inboundLinks` count + for fragments `referrers[]`.

**Flag instance.** `{ id, documentPath, detail }`; detail = missing key, broken target (and link kind), unpublished reason, age in days, referrer count.

**Worker routes** (all behind the template pipeline; error shape and codes per #2 Decision 9; CORS headers on every response to an allowed origin):

| Route | Request | Success response | Errors |
|---|---|---|---|
| `GET /info` | none | `200 { org, site, adminApi: "legacy"|"hlx6", statusBatchMax: 20, linksBatchMax: 8 }` | `401`, `403 forbidden_origin` |
| `POST /status` | `{ paths: [ "/en/foo", … ] }`, 1 to 20 site-relative web paths: start with `/`, no `?`, `#`, `\`, control characters, `//`, `.`/`..` segments (also percent-encoded), each at most 512 chars | `200 { results: [ { path, preview: {state, lastModified?, httpStatus?}, live: {state, lastModified?, httpStatus?}, error? } ] }` in request order; a path whose Admin call fails after retries has `error: "upstream_unavailable" | "rate_limited" | "forbidden"` and no states | `400 bad_request` (shape, count, path rule), `401`, `403`, `429` (all paths rate-limited, with `Retry-After`), `502 upstream_unavailable` (all paths failed), `500 misconfigured` (missing `ADMIN_API_KEY`) |
| `POST /links/check` | `{ urls: [ "https://…", … ] }`, 1 to 8 absolute URLs, each bounded length | `200 { results: [ { url, state: "ok"|"broken"|"unverified", reason, httpStatus?, finalHost? } ] }`; `reason` from the fixed set used by the prepublish linter (`ok`, `redirected`, `not-found`, `server-error`, `unreachable`, `blocked-by-site`, `timeout`, `too-many-redirects`, `redirect-loop`, `invalid-url`, `blocked-target`) | `400`, `401`, `403`, `413`, `429` |

**Worker configuration (non-secret `vars`).** `ORG`, `SITE` (bound site; the code site and the DA content site are assumed to be the same `jazhou-adobe`/`ew-extensions` per #1 R10), `ADMIN_API` (`legacy`|`hlx6`), `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS` (per #2). **Secret:** `ADMIN_API_KEY` (declared in `secrets.required`, listed in `.dev.vars.example`). Status upstream host allowlist: exactly one of `admin.hlx.page` / `api.aem.live`, chosen from `ADMIN_API`.

**Content-inventory config tab** (`content-inventory`, optional; key/value rows): the keys and defaults in Decision 15. Example rows for the README:

| key | value |
|---|---|
| `stale-days` | `365` |
| `required-metadata` | `title,description` |
| `fragment-roots` | `fragments` |
| `orphan-exclude` | `/drafts/,/tools/` |
| `external-links` | `off` |

**Checkpoint (IndexedDB).** One record per `org/site`: `{ schemaVersion, extractorVersion, startedAt, updatedAt, phase, collectionSettings, pendingFolders[ {path, token?} ], listedPaths, records, statusResults, linkResults, scanErrors, completedAt? }`. A write is atomic per checkpoint. `settings` (analysis-only) are stored separately so changing them never touches the checkpoint.

**CSV columns (fixed order, header row).** *Inventory:* `path, kind, title, title_source, description, description_source, last_modified, publish_status, preview_last_modified, live_last_modified, word_count, blocks, flags, inbound_links`. *Fragment usage:* `fragment, referrer, referrer_kind, reference_kind, unused`. *Issues:* `path, flag, detail`. Dates in ISO 8601 UTC.

## 5. Folder layout (proposed; fits the #1 convention)

```
apps/content-inventory/
├─ SPEC.md                      this file
├─ README.md                    setup, apps row, config read, worker deploy/secret, privacy note
├─ content-inventory.html       entry page: SDK <script type=module> + app script
├─ content-inventory.js         bootstrap: await SDK, build ports, start UI
├─ content-inventory.css
├─ src/                         extract · analyse · engine (scan, phases, resume) · store (memory + IndexedDB) · config/settings · csv · filters · ui · worker-client · authed-fetch
├─ test/
│  ├─ unit/                     WTR tests (SE, S2)
│  ├─ e2e/                      Playwright specs (S1)
│  └─ fixtures/                 synthetic site, recorded-sample contract fixtures (scrubbed)
└─ worker/                      scaffold from shared/worker-template: wrangler config, entry (routes: info, status, links/check), egress guard, README, test/ (W1, W2)
```

Names inside `src/` are the implementer's call. No `providers/` folder: the AEM Admin API is the platform's own API, not a vendor, and there is no vendor follow-up ticket. The `.hlxignore` (from #1) hides `**/test/`, `**/worker/` and the template from the public code site.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **AC5 premise**: publish status may be fetchable from the browser with the user's token (CORS allows it; DA's client does it). A worker-held key then adds cost and a credential for little gain, and grants any authenticated Adobe user read access to the site's publish status. | Medium | Follow the ticket; status source is an interface; spike S1; Question 1. Status data is low-sensitivity (live content is public) but the worker's `authorize` hook / client-id allowlist (#2 R3) still applies. |
| R2 | **Key role / blast radius.** Bulk status needs `publish` role; per-path needs only `basic_author`. | High if `publish` is used | Use per-path status and a `basic_author` key; Question 2; README tells the admin the minimum role. |
| R3 | **Admin API rate limit (10 req/s per project, shared with authors).** A big site's status phase is slow and may slow authors' preview/publish. | Medium | One batch at a time, worker concurrency 4, backoff on `429`, pause/resume, skip-status option; M9 measures. |
| R4 | **Status semantics unverified for DA-backed content** (fields present, `404` shape, `index` mapping, timestamp skew vs DA `lastModified`). Wrong derivation = wrong `unpublished-changes`. | High for AC3 | Spikes S2; derivation isolated in the analyser with a tolerance setting; recorded real responses become contract fixtures; status `unknown` rather than guessing. |
| R5 | **DA list behaviour** (page size, ACL filtering, rate limits, `lastModified` units, huge folders). | Medium | Spike S3; pagination loop tested; concurrency setting. |
| R6 | **Long crawl vs token lifetime and `daFetch` sign-in redirect in an iframe.** | Medium | Frequent checkpoints; resume; spike S6; Question 11. |
| R7 | **IndexedDB in a partitioned third-party iframe** (resume may not persist, Safari ITP caps, quota). | Medium | Spike S7 / M5; the app detects store failure and degrades to "no resume" with a notice; quota errors surfaced. |
| R8 | **Link resolution fidelity** (case, trailing slash, locale routing, rewritten paths, links to generated resources, links in the site's custom production domain). False positives erode trust. | High for AC3 | Conservative classification (`unverifiable`/`out-of-scope` never flagged); `own-hosts` setting; spike S5; fixture covers each class; Question 7. |
| R9 | **Fragment detection is convention-based** (`/fragments/`, `nav`/`footer`); a site with custom code differs. | Medium | Configurable roots/implicit list; documented; fragment reference rules mirror the boilerplate [VERIFIED]. |
| R10 | **Orphan definition ambiguity** (any inbound link vs reachable from home; sitemap). | Medium | v1 = any inbound link from a scanned document; excluded set configurable; Question 6. |
| R11 | **Worker as SSRF / open scanner** (any authenticated Adobe user passes the offline JWT check). | High | Egress guard + per-call caps + template client-id allowlist and `authorize` hook; tests WL4-WL9 and smoke; inherited from the prepublish linter design. |
| R12 | **Workers Free limits** (10 ms CPU, 50 subrequests) with 20 Admin calls per `/status` and redirects in `/links/check`. | Low-Med | Caps 20 and 8; S8 measures CPU/subrequests; paid plan is an owner decision (#2 Q1). |
| R13 | **Memory/DOM scale** (10,000 documents; thousands of links). | Medium | Store only extracted data; discard HTML; paginated/windowed table; M9 rehearsal with a large site. |
| R14 | **Hostile document content** (script, event handlers, huge or malformed HTML, formula-like titles). | High if mishandled | Inert parse, text-only rendering, CSV neutralisation, size cap on read (documents over a cap are recorded as `malformed`), tests X8, U-series, E-series. |
| R15 | **Docs vs source drift** (SDK, `daFetch`, Admin API shapes change without notice). | Medium | Contract fixtures from recorded real responses; SDK stub contract test from #1; worker client validates response shapes and maps surprises to `unknown`/`error`, never throws. |
| R16 | **Admin generation (legacy vs hlx6) of the target site unknown.** | Medium | Explicit `ADMIN_API` config; both URL shapes tested (WS6); Question 3. |
| R17 | **Inherited:** Code Sync, DA org/site naming, Adobe IP policy, Cloudflare account (#1 R1/R3/R10, #2 R1). | High, blocking publication | Owner actions listed in the build plan prerequisites. |

## 7. Ordered build plan (sized to #26's acceptance criteria)

0. **Prerequisites (owner):** #1 and #2 landed (tooling, hello apps, CI, worker template with test kit); site registered with Code Sync (#1 R3); Cloudflare account and `wrangler login` (#2); an Admin API key for the site with the least role that works (`basic_author`, Question 2), kept out of chat and git; a seeded sandbox content set (section 5 of Testing Requirements).
1. **Spikes against the real site (read-only), recording scrubbed responses as fixtures:** S1-S9 (listed below). Output: confirmed or corrected Decisions 8, 9, 12, 17 and 20; update this spec's [OPEN] tags.
2. **Fixture site and fake ports** (test support): synthetic documents covering every case in Testing Requirements section 1, a fake DA with pagination and failure injection, fake worker client, in-memory store with interruption hook. First, the fixture contract test against the recorded samples.
3. **Extractor, test-first** (X-series). AC1 data.
4. **Analyser, test-first** (A-series): metadata, links, fragments, orphans, status derivation, stale, flags. AC2, AC3.
5. **Scan engine and store, test-first** (C-series, ST-series): phases, progress, concurrency, failures, cancel, checkpoint/resume incl. IndexedDB adapter. AC4.
6. **CSV exporter and filters, test-first** (E-series, F-series). AC4.
7. **Worker routes, test-first** (WI, WS, WL series) on the template: `/info`, `/status`, `/links/check` with the egress guard; then smoke (SM-series). AC5, AC9.
8. **Worker client and status/link phases** integrated into the engine (contract tests shared with the worker fixtures). AC3, AC5.
9. **UI and entry page** (U-series): controls, progress, tabs, table, filters, export, settings, standalone state, safe rendering. AC1, AC2, AC3, AC4.
10. **Playwright e2e** (E2E-series) against the fixture site and the real local worker. AC1-AC5, AC8 (local origin).
11. **README, repo README table row, `apps` row** (AC6, AC7), then the S3 convention check passes for the folder.
12. **Deploy the worker; manual EW verification M0-M12** with `ref=local` and with a branch ref (AC7-AC9); record results and update README caveats.
13. **CI**: confirm the existing lint/unit/e2e/worker jobs cover this folder (AC10); no new workflow expected.
14. **Hand-off notes:** the decisions that surprised (status semantics, key role), and the Question 1 outcome.

**Spikes (read-only, real site; each ends with a scrubbed fixture and a spec update).**

- **S1** Admin API credentials: does `Authorization: token <key>` with role `basic_author` return `status` for a DA-backed site on the configured generation? Is a signed-in user's IMS `Bearer` accepted from the extension's origin (AC5 premise)?
- **S2** Real `status` responses: fields present for previewed, published, edited-after-publish and never-previewed documents; `404` shape; path mapping for `index` and nested paths; timestamp skew against DA `lastModified`.
- **S3** DA list: page size and pagination in practice, `lastModified` unit, ACL behaviour, throttling thresholds.
- **S4** Real DA source samples: metadata block markup, fragment block, link forms (relative, absolute, `aem.page`), embedded media; the EW editor URL form for "open in editor".
- **S5** Link normalisation: case sensitivity, trailing slash, `/media_*`, locale roots, which generated resources exist.
- **S6** Token refresh and `401` behaviour of `actions.daFetch` mid-crawl inside the EW iframe.
- **S7** IndexedDB persistence and quota in the EW iframe (Chrome; Safari optional).
- **S8** Worker cost: CPU and subrequests of `/status` (20 paths) and `/links/check` (8 URLs) on workerd.
- **S9** Storage form of the bulk metadata sheet and the redirects sheet in DA source, and glob semantics of `URL` patterns.

---

# Testing Requirements

## 1. Unit tests (seams SE and S2; `@web/test-runner`, real Chromium, as #1)

**Fixtures/mocks.** One synthetic **fixture site** (in `test/fixtures/`) built by a factory so a test can tweak one document. It covers, at least: home with metadata; page with full metadata; page with only an `h1`; page with no metadata and no `h1`; page whose description comes only from the first long paragraph; page with a bulk-metadata match; page not modified for two years; page edited after publish; page previewed but never published; never-previewed page; orphaned page; page reachable only via `nav`; fragment used by two pages; fragment used only by another fragment; unused fragment; broken fragment reference; `nav` and `footer` documents (implicit fragments, header/footer via default paths); page with `nav` metadata pointing at a custom header; pages with relative, root-relative, `./`, `../`, own-host absolute (`aem.page`, `aem.live`, `preview.da.live`), query/hash, `mailto:`, `tel:`, `javascript:`, `/media_` and sitemap links; broken internal link; link to a redirected path; external links (ok, 404, bot-blocked, redirect); folder with continuation-token pagination across two pages; empty folder; nested folders three deep; non-HTML files; `.da-versions` folder; a document that returns `404`, one that returns `500` twice then `200`, one that is not valid HTML; hostile content (`<img src=x onerror=…>`, `<script>`, title `=HYPERLINK(...)`, a 5 MB document, CJK text, NBSP/zero-width characters). The fake DA records every request (method, URL, headers) and can inject failures and delays per path. The fake worker client replays scripted status/link results. The fixture contract test compares the fake's response shapes with scrubbed recordings of real responses from the spikes (guards R15). A token canary (`canary-ims-<random>`) is the SDK token in every test.

**1.1 Extractor (AC1)**

| ID | Behaviour asserted |
|---|---|
| X1 | `title` and `description` read from the `metadata` block; `titleSource`/`descriptionSource` = `metadata` |
| X2 | No metadata title: first `h1` text becomes the title with source `derived`; none at all: empty with source `none` |
| X3 | No metadata description: first paragraph with at least 10 words is used with source `derived`; paragraphs of fewer than 10 words are skipped; none: `none` |
| X4 | Word count: counts words in `main` (default content and blocks), excludes `metadata`, `section-metadata`, `da-metadata`, `library-metadata`, `script`, `style`; empty document is 0; NBSP/zero-width handled; CJK text counted via word segmentation, not whitespace |
| X5 | Blocks used: name = first class token; variants ignored for the name; repeated blocks counted; div form and table form both read; non-content blocks excluded; stable order |
| X6 | Links: collected from default content and from inside blocks; empty, `#x`, `mailto:`, `tel:`, `javascript:` never recorded; relative resolved against the document path; query and hash stripped for internal; own-host absolute (all three hosts, any ref, `own-hosts` setting) become internal; other `http(s)` are external with credentials stripped; de-duplicated |
| X7 | Fragment references: first link or text path in a `fragment` block; `/fragments/` link outside a `fragment` block (auto-link); metadata `nav`/`footer`; implicit default header/footer references when metadata is absent; no duplicates |
| X8 | Hostile input: the `<img onerror>` and `<script>` fixtures execute nothing and trigger no network request (fetch guard and a global error trap stay silent); output is plain strings; malformed HTML does not throw (`readError: malformed` only when the document is unparseable); a document over the size cap is recorded as `malformed` without being parsed |
| X9 | The record carries `extractorVersion`; no HTML is retained |

**1.2 Analyser (AC2, AC3)**

| ID | Behaviour asserted |
|---|---|
| A1 | Status derivation matrix (`draft`, `previewed`, `published`, `published-with-changes`, `unknown`) for all combinations of saved/preview/live times, including equality and the tolerance boundary (`status-tolerance-seconds`), using an injected clock |
| A2 | `unpublished-changes` is raised with reason `edited-after-preview`, `preview-not-published` or `never-published` as defined; not raised for `published`; not raised and status `unknown` when no status result exists (not `draft`) |
| A3 | `stale`: exactly at the threshold is not stale, one second over is; changing `stale-days` re-evaluates with no recollection; `0`/blank disables; basis is DA last modified |
| A4 | Metadata: matrix `explicit`/`bulk`/`derived`/`missing` per required key; page-level wins over bulk; bulk rows later in the sheet override earlier ones; `""` removes; `metadata-strict` makes `derived` flag; custom required keys; unreadable bulk sheet reported and never under-flags |
| A5 | Internal links: `/x` finds `x.html`; `/folder/` finds `folder/index.html`; extension targets match files exactly; relative resolution; broken target reported with source document and target; redirect-sheet source not broken; `/media_*`, `sitemap`, `robots`, `.plain.html` are `unverifiable` and counted, not flagged; targets outside a sub-folder scope are `out-of-scope`, not broken; a broken fragment reference is `broken-fragment-reference` |
| A6 | Fragment report: each fragment lists direct referrers (pages and fragments) with reference kinds; counts correct; nested chain yields transitive page referrers; cycles terminate; zero referrers raises `unused-fragment`; implicit `nav`/`footer` are used by every page; the report names the scope |
| A7 | Orphans: zero inbound links raises `orphaned-page`; links from `nav`/`footer`/fragments count; self-links do not; home, `nav`, `footer`, fragments and `orphan-exclude` paths are never orphaned; a page linked only by another orphan is not orphaned (v1 rule) |
| A8 | Determinism: same inputs give identical rows/flags in a stable order; recomputing after a settings change equals a fresh computation |
| A9 | Kind classification: `fragments` segment at any depth, header/footer documents, and referenced targets are fragments; everything else pages |

**1.3 Scan engine and store (AC4)**

| ID | Behaviour asserted |
|---|---|
| C1 | Listing: walks nested and empty folders, follows `da-continuation-token` across pages (header sent back on the next request), skips `.da-versions`, treats entries without `ext` as folders, only `.html` become documents, other files kept by name |
| C2 | Progress events: per-phase `done/total` monotonic, totals only grow during listing, final summary matches the dataset, no negative or NaN estimates; events continue through failures |
| C3 | Concurrency: never more than the configured number of reads in flight (1-10); the status phase never has two worker calls in flight |
| C4 | Failures: `404`/`403`/malformed recorded in `scan-errors` and the scan continues; `429`/`5xx` retried with backoff and then recorded; the final dataset still contains every readable document |
| C5 | Cancel: stops issuing requests promptly, keeps collected data, state is resumable; Start new clears the checkpoint |
| C6 | **Resume equivalence**: interrupt at several points (during listing, mid-read, during status, during link checks) using the store's interruption hook, resume with a new engine instance: the final dataset equals an uninterrupted run, and completed documents are not re-read (assert the fake DA request counts) |
| C7 | Resume refused with a reason when collection-affecting settings (scope, exclude, fragment roots, own hosts, external-links) or `extractorVersion` differ; allowed when only analysis settings differ |
| C8 | A `401` from DA pauses the scan in an `auth-expired` state with the checkpoint intact; resume continues |
| C9 | Status phase: batches of at most 20 paths in order; per-path `error` becomes `unknown` status, not a scan failure; worker `401` shows a worker-auth notice and the inventory remains usable; `/info` site mismatch skips status with a notice; worker down is a notice, not an exception |
| C10 | External links: only when enabled; unique URLs; chunks of at most 8; `unverified` is counted and never raises `broken-external-link`; results cached so re-analysis and resume do not re-probe |
| C11 | Token canary: not present in the store contents, the export, the DOM, console output, or in any request to a host other than the DA origin and the worker origin; `authedFetch` refuses any other origin (a request to `https://evil.example` is rejected before `daFetch` is called) |
| C12 | Settings precedence: in-app > config tab > default; missing/`401`/`403`/`404` config tab falls back with a notice; unknown keys ignored with a notice |
| ST1 | Store contract suite run against the in-memory and the IndexedDB adapters (real Chromium): put/get/clear, atomic checkpoint (a write interrupted mid-way leaves the previous checkpoint readable), records round-trip exactly, quota/IO errors surface as a typed error, no token field exists in a stored record |

**1.4 Export and filters (AC4)**

| ID | Behaviour asserted |
|---|---|
| E1 | RFC 4180: commas, double quotes, CR/LF inside cells are quoted/escaped; CRLF line ends; header row; fixed column order; UTF-8 BOM present |
| E2 | Formula neutralisation: cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed; the `=HYPERLINK(...)` fixture title is safe in all three exports |
| E3 | Inventory export respects the active filter by default; "all" exports every row; counts match the table |
| E4 | Fragment-usage export: one row per fragment-referrer pair; unused fragments appear once with an empty referrer; issues export: one row per flag instance with detail |
| E5 | 10,000 synthetic rows export in bounded time and memory (a generous threshold documented in the test; informational on CI) |
| F1 | Each filter (text, kind, flag, publish status, blocks, folder prefix, last-modified range) selects the right rows; filters combine with AND; flag filter with several flags is OR within the flag filter; empty filter shows all |
| F2 | Sorting on every column ascending/descending, stable, numeric and date columns sorted by value not text |
| F3 | Summary counts per flag equal the number of flag instances/documents in the unfiltered dataset and update on settings change |

**1.5 UI render and wiring (AC1-AC4, AC7)**

| ID | Behaviour asserted |
|---|---|
| U1 | Given a dataset, the inventory table shows every column named in AC1 for each row; pagination/windowing never drops rows; row count text is accurate |
| U2 | Hostile titles, descriptions, paths and error text render as text: no element is created from them; outbound links carry `rel="noopener noreferrer"` and only `http(s)` hrefs |
| U3 | Controls reachable by role/name: Start, Cancel, Resume, Start new, scope input, concurrency, external-links toggle, stale-days input, tabs, filters, export buttons; progress exposes `role="progressbar"` with values |
| U4 | Saved checkpoint on load shows the Resume / Start new choice, or the refusal reason; a completed scan shows its timestamp |
| U5 | Notices: status unavailable, site mismatch, config not readable, scan errors count, bulk metadata unreadable, external unverified count; the rest of the UI stays usable |
| U6 | Standalone (SDK never resolves): "not inside Experience Workspace" state after the timeout, no network calls; token indicator never shows the token |
| U7 | Changing `stale-days` or required metadata in the UI updates flags and counts immediately and does not issue DA requests |

## 2. Worker tests (seam W1, Node `node:test`, in `apps/content-inventory/worker/test/`; plus the template's own UA/UC/UP/US suites, which the worker inherits)

Fixtures: #2 test kit (fake IMS and signed tokens; fake upstream; `makeEnv` with canary `ADMIN_API_KEY`; injected `sleep`/`random`/`now`). The fake Admin API serves `status` for both generations from the recorded samples.

| ID | Behaviour asserted |
|---|---|
| WI1 | `GET /info` with a valid token returns the bound site, generation and caps; contains no secret or env dump |
| WS1 | `POST /status` with valid token and allowed origin: results in request order; preview/live `ok`/`missing` mapped from `200`/`404`; `lastModified` passed through; no raw upstream body or headers in the response |
| WS2 | Upstream request carries the API key in the documented header and only to the allowed host; inbound `Authorization` is not forwarded; the canary key never appears in any response, header or log line, including upstream-echo and error paths |
| WS3 | Path validation: `..`, encoded `..` (`%2e%2e`), `//`, `?`, `#`, `\`, control characters, missing leading `/`, over-long path, non-string entries, empty array, more than 20 entries, non-JSON body: all `400 bad_request`, zero upstream calls |
| WS4 | Org/site in every upstream URL come from configuration; a body or query that names another org/site has no effect (the upstream URL list is asserted) |
| WS5 | Upstream `429` is retried with the template backoff and honours `Retry-After`; `5xx` retried (GET is idempotent); a persistent failure on one path yields that path's `error` entry while others succeed; all paths failing maps to `429`/`502` per the template |
| WS6 | `ADMIN_API=legacy` uses `admin.hlx.page/status/{org}/{site}/{ref}/{path}`; `hlx6` uses `api.aem.live/{org}/sites/{site}/status/{path}`; no other host is ever contacted |
| WS7 | Concurrency inside a call never exceeds the cap and total subrequests per call stay within the Workers Free budget (counted with the fake) |
| WS8 | Missing `ADMIN_API_KEY` gives `500 misconfigured` with a generic message and a log line with the name only |
| WS9 | No token gives `401` with CORS headers for an allowed origin and zero upstream calls; disallowed origin with a valid token gives `403` and zero upstream calls; unknown route without token `401`, with token `404` (template pipeline order) |
| WL1 | `POST /links/check` without a token gives `401` and the scripted `fetch` records zero outbound requests |
| WL2 | Body validation: empty, over 8 URLs, non-string, over-length URL, non-JSON: `400`; nothing probed |
| WL3 | Guard: IP literals (decimal, hex, octal, IPv6), `localhost`, `*.internal`/`*.local`, URL credentials, non-default ports, `file:`/`ftp:`/`data:`, cloud metadata addresses: `blocked-target`/`invalid-url`, never fetched |
| WL4 | Redirects followed manually: `301→200` is `ok/redirected`; a hop to a private or IP-literal target is `blocked-target` and not fetched; loop gives `redirect-loop`; beyond the hop cap `too-many-redirects`; relative and absolute `Location` handled |
| WL5 | Verdict mapping: `404`/`410` broken; persistent `5xx` after one retry broken; connection failure broken; `401`/`403`/`429`/`451`/`999` unverified; timeout unverified; `HEAD` refused falls back to a range-limited `GET` |
| WL6 | Egress hygiene: no cookies, no caller headers, no `Authorization`, fixed user agent; the caller's token canary is absent from every outbound request |
| WL7 | Response schema is fixed: no headers, bodies or query strings echoed; order matches the request |
| WL8 | Per-URL and overall time limits enforced with the injected clock |
| WL9 | CORS headers present on `200`, `400`, `401`, `403`, `429` responses to an allowed origin |
| WC1 | Worker-client contract: the extension's worker client parses the worker's recorded success and error responses (shared fixtures used by both sides) and maps unknown shapes to `unknown`/`error` without throwing |

## 3. End-to-end tests (seam S1, Playwright, Chromium only, hermetic)

Setup: #1's local static server on `:3000`; `page.route` fulfils the SDK module (token = test-signed JWT) and `admin.da.live` (list with pagination, source, config) from the fixture site; the real local worker on `:8787` with a throwaway fake-IMS key server and a fake Admin API behind it (as #2 E2E). Every other request is aborted.

| ID | Behaviour asserted |
|---|---|
| E2E1 | Start a full scan: progress appears per phase; the inventory shows every fixture document with all AC1 columns; counts per flag match the golden expectations of the fixture |
| E2E2 | Fragment tab: each fixture fragment with its referrers; the unused fragment and the orphaned page are flagged; `nav`/`footer` not flagged |
| E2E3 | Health: missing metadata (key named), broken internal link (source and target), stale (change the threshold in the UI, flags update with no new network requests), unpublished changes with reasons |
| E2E4 | Filters and sort: combine flag + kind + text; export CSV: downloaded bytes equal the golden CSV for the filtered view; the fragment-usage and issues exports likewise |
| E2E5 | **Resume**: start a scan, reload the page mid-crawl (IndexedDB persists), choose Resume: the final inventory equals an uninterrupted run and the fake DA saw no repeated reads of finished documents; "Start new" discards the checkpoint |
| E2E6 | Worker negative: the same status request without a token is answered `401` by the real worker and the page shows a worker-auth notice while the inventory remains usable; a token signed by a different key gets `401` through the full browser path |
| E2E7 | Network audit: hosts contacted are only the page, the SDK stub, the stubbed DA origin and the worker; the token appears only in `Authorization` headers to those two origins and nowhere in page HTML/text, IndexedDB contents, downloaded CSV or console |
| E2E8 | External links toggle: off makes no `/links/check` call; on sends chunks of at most 8; `unverified` shown separately from `broken` |
| E2E9 | Standalone: opening the page without the SDK shows the "not inside Experience Workspace" state |

## 4. Runtime smoke tier (seam W2)

Real worker in workerd via `wrangler dev` (no Cloudflare login), local fakes for IMS and the Admin API, canary secret from an env file.

| ID | Behaviour asserted |
|---|---|
| SM1 | Worker bundles (shared core resolved) and starts; a bare request gets `401` (liveness) |
| SM2 | Valid token: `/info` and `/status` over real HTTP return the contract shapes; preflight from `https://da.live` allowed and from `https://evil.example` refused |
| SM3 | `/status` retries a scripted `429` in the real runtime; the fake Admin API observes the key header and no inbound `Authorization` |
| SM4 | `/links/check` against local fake targets: `ok`, `404`, redirect to a blocked address; guard holds over real sockets |
| SM5 | Canary absent from all responses; per-request CPU/wall time and subrequest count recorded for a 20-path `/status` and an 8-URL `/links/check` (informational, feeds R12 and S8) |

## 5. Manual verification inside real EW (needs interactive login; cannot run in CI)

**Accounts and credentials needed.** GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, per #1); an Adobe IMS identity with edit access to the DA org/site and config permission (a second, author-only identity for M8); Chrome; a Cloudflare account with `wrangler login` (per #2); an Admin API key for the site with the minimum role (Open Question 2) set only with `wrangler secret put ADMIN_API_KEY` (never pasted into chat, issues or logs); no vendor sandbox. Never share a real IMS token; it is a live credential until it expires.

**Seed content (manifest; created by hand or with a one-off script kept out of the repo) under `/sandbox/inventory/`:** about 40 documents covering the fixture cases: complete metadata, no metadata, `h1`-only, a page untouched for the configured stale threshold (set the threshold low, for example 1 day, instead of waiting a year), one previewed and published then edited, one previewed only, one never previewed, an orphan, a fragment used by two pages, an unused fragment, header/footer, a broken internal link, a link to a redirected path (with a `redirects` sheet row), a bulk `metadata` sheet row, and external links to `https://www.aem.live/` (200) and `https://www.aem.live/definitely-missing-content-inventory-test` (404). Also a folder of 120 trivial documents for the pagination/resume checks.

- **M0 (prereq):** `curl -I https://main--ew-extensions--jazhou-adobe.aem.live/apps/content-inventory/content-inventory.html` returns 200 after first merge; deploy the worker from `apps/content-inventory/worker/` and `curl -i <worker>/info` returns `401`; set the worker origin constant by a normal PR. Do not put a real IMS token on any command line (shell history and logs retain it); authenticated checks are done through the app (M1).
- **M1 (`ref=local`):** `npm start` (port 3000) and the local worker (`wrangler dev`, port 8787); open `https://da.live/app/jazhou-adobe/ew-extensions/apps/content-inventory/content-inventory?ref=local`; accept the trust prompt (first time per `org/repo/ref`); scope `/sandbox/inventory/`; run a scan. Check: row count equals the seeded count; every AC1 column populated; the preview/publish status matches what DA and the AEM Sidekick/admin show for the seeded documents; no token anywhere in the page (DevTools Elements/Application/Network review).
- **M2 (branch ref):** push branch `content-inventory-spec` (simple name), wait for code sync, repeat M1 with `?ref=content-inventory-spec` against the deployed worker; record the page's actual `Origin` as seen by the worker (feeds #2 R2) and confirm no local-network prompt.
- **M3 (health flags against known truth):** each seeded issue appears with the right flag and detail; change `stale-days` in the UI; preview a never-previewed page in EW and edit another after publish, re-scan (or resume-complete) and verify `unpublished-changes` reasons update; compare unverifiable/out-of-scope counts with expectations.
- **M4 (fragments):** the used fragment lists exactly its two referrers; the unused fragment and the orphan are flagged; header/footer not flagged; deleting the referencing link in one page and re-scanning updates the report.
- **M5 (resume in the real iframe):** start a scan of the 120-document folder, reload mid-crawl, choose Resume: completes without re-reading finished documents (DevTools Network); repeat after closing the tab and reopening the app; then also in a Safari-class browser if available to record whether the store persists (R7). Record the result in the README caveats.
- **M6 (external links):** enable the toggle: the 200 URL is `ok`, the missing path is `broken`, a bot-blocking site (record which) shows `unverified`; with the toggle off no worker `/links/check` request occurs.
- **M7 (CSV):** export the three CSVs; open in a spreadsheet: encoding correct (accented/CJK titles), no formula execution for the seeded `=...` title, column counts correct, filtered export equals the on-screen view.
- **M8 (permissions and config):** as the author-only identity: scan works with that user's visibility, the config tab fall-back note appears if config read is denied; as admin add the `content-inventory` tab with different `stale-days`/`required-metadata` and see it applied and labelled as config-sourced; in-app value overrides it.
- **M9 (scale rehearsal):** run on a site with at least 500 documents (the owner names it, Question 12): record read-phase time, status-phase time (and any `429` from the Admin API), memory in DevTools, and whether authors' preview/publish remained responsive during the status phase (R3, R13). Feeds the README's "expect about N minutes per 1,000 pages".
- **M10 (apps card and menu):** add the `apps` row in `https://da.live/config#/jazhou-adobe/ew-extensions/`; the card appears at `https://da.live/apps#/jazhou-adobe/ew-extensions` and opens the app; the app is reachable from the EW Apps menu.
- **M11 (worker negatives on the deployed worker):** `curl -i <worker>/status -X POST` without a token gives `401`; preflight with `Origin: https://evil.example` gives `403` and no `Access-Control-Allow-Origin`; with `Origin: https://da.live` gives `204` with that origin echoed; `Origin: http://localhost:3000` against the production worker gives `403`; `wrangler secret list` shows the secret name only; rotating the key (`wrangler secret put`) needs no code change.
- **M12 (standalone and long-session):** open `http://localhost:3000/apps/content-inventory/content-inventory.html` directly: "not inside Experience Workspace"; leave a scan running past the IMS token refresh window if observable and note what `daFetch` does on `401` (S6), confirming resume recovers.

## 6. CI (no credentials, no Cloudflare login)

Inherits #1's `lint`, `unit`, `e2e` jobs and #2's `worker-unit`, `worker-smoke` jobs; this folder's tests are picked up by their globs (`apps/*/test/unit`, `apps/*/test/e2e`, `apps/*/worker/test`). The S3 convention check (entry page, README, tests, table row, registration-row consistency) and the worker rules UR1-UR5 apply to this folder. The ESLint override for worker globals covers `worker/`. Nothing here needs repository secrets.

## 7. Acceptance-criteria traceability (ticket #26)

| # | Acceptance criterion (#26) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Inventory lists every document with path, title, description, last modified, preview/publish status, word count and blocks used | X1-X5, X9 (extraction), A1 (status derivation), C1-C2 (every document discovered; pagination), U1 (all columns rendered), E1-E4 (columns in CSV), E2E1 | **M1** (count equals seed, columns populated, status matches real preview/publish state), M9 (scale) |
| AC2 | Fragment usage report shows each fragment and every page that references it; orphaned pages and unused fragments are flagged | X7, A6, A7, A9 (references, kinds, transitive, implicit nav/footer, orphan rules), E4 (fragment export), E2E2 | **M4** (exact referrers, flags, update after edit) |
| AC3 | Health flags: missing metadata, broken internal links, stale content (configurable age), unpublished changes | A2-A5 (flags and reasons, stale threshold, metadata matrix, link resolution), C9-C10 (status and external phases), U7 (settings update flags with no requests), E2E3 | **M3** (seeded issues with known truth, threshold change, preview/edit then re-check), M6 (external) |
| AC4 | Results are filterable and exportable as CSV; long crawls show progress and can resume | F1-F3, E1-E5, C2-C8, ST1, U3-U4, E2E4, E2E5 (reload mid-crawl resume equivalence) | **M5** (resume in the real iframe, persistence caveats), M7 (CSV in a spreadsheet), M9 |
| AC5 | Calls the browser cannot make (publish status, external link checks) go through the worker | C9-C10 (status and links only via the worker client), C11 and E2E7 (network audit: only DA and worker origins contacted), WS1-WS9, WL1-WL9, WC1, SM1-SM5, E2E6, E2E8 | **M6**, **M11**; review: Question 1 outcome recorded (whether status could be browser-direct) |
| AC6 | All code in the self-contained `content-inventory` folder, with a README covering setup, the EW config-sheet row and site config read | S3 convention check enforces folder structure, README presence, table row and a documented registration row of type `app` (#1 AC1, AC5); UR1, UR4 for `worker/` placement | Review checklist: README sections exist (setup; `apps` row; the `content-inventory` tab; bulk metadata and redirects sheets; DA permissions; worker deploy/secret; privacy note); a reviewer follows the README on a clean clone to a first scan (M1) |
| AC7 | Listed in the repo README extensions table and reachable from the EW Apps menu | S3 table-integrity check (row exists, points to a real folder and entry page, type `app`) | **M10** (card on the Apps page opens the app); review of the table row's five columns |
| AC8 | Works in EW with `ref=local` and with a branch ref | E2E1-E2E9 prove the page and worker work on the local origin; ST1/U-series are origin-independent | **M1** (`ref=local`), **M2** (branch ref against the deployed worker), M5 (separate stores per origin noted) |
| AC9 | Vendor credentials only in this extension's worker; the browser never receives them; unauthenticated calls to the worker are rejected | C11, E2E7 (token and key never in page, store, export, console), WS2 and WL6 (key and caller token hygiene), WS8 (missing secret generic), WS9 and WL1 and E2E6 (unauthenticated rejected), UR2/UR3/UR5 (no secret in git/vars, declared in `.dev.vars.example`), SM2, SM5 | **M0** (bare `curl` gives `401`), **M11** (negatives, `wrangler secret list` names only, rotation), DevTools review in M1 for the key (none) |
| AC10 | Core logic covered by unit tests; lint and CI green | Sections 1 and 2: X, A, C, ST, E, F, U, WI/WS/WL series run in CI on every push and PR; lint and S3 | CI shows all jobs green on the PR; deliberately break one rule (e.g. the orphan exclusion) on a scratch branch and see A7 fail |

Every acceptance criterion on #26 maps to at least one automated test or a numbered manual verification step above.

## 8. Open questions for the owner

1. **Publish-status premise (AC5).** The ticket says publish status cannot be fetched from the browser. I observed the Admin API answers CORS preflights for extension origins and DA's own client sends the user's IMS token to it. Do you want (a) the ticket's design (worker + service key, as specified), or (b) browser-direct status with the user's own token (no key, per-user permissions, but depends on S1)? Either way the external-link route stays in the worker. This spec builds (a) behind an interface.
2. **Key role and speed.** Per-path status with a `basic_author` key (least privilege, about 3 requests per second, so roughly 5 minutes per 1,000 pages) or bulk status with a `publish`-role key (fast, but a leaked key can publish)? Spec assumes the former.
3. **Admin API generation.** Is `jazhou-adobe/ew-extensions` (and your target sites) on the legacy `admin.hlx.page` API or the new `api.aem.live`? (`ADMIN_API` is explicit configuration.) Which Admin-API-key creation route applies for hlx6?
4. **`unpublished-changes` scope.** Should never-published drafts raise the flag, or only pages that are live and have newer edits/previews?
5. **Stale default.** Is 365 days (measured from the last DA modification) a sensible default, or should stale be measured from the last publish?
6. **Orphan definition.** Any inbound link from a scanned document (v1), or reachable from the home page? Should sitemap/query-index membership count as "linked"? Default `orphan-exclude` of `/drafts/` and `/tools/`?
7. **Fragment and link conventions.** Do your sites follow the boilerplate (`/fragments/`, `/nav`, `/footer`)? Do they use a custom production domain (needs `own-hosts`)? Are links normalised case-insensitively in your sites?
8. **Shared egress guard.** The external-link route duplicates the prepublish linter's SSRF guard because the template's `proxy` needs a host allowlist. Should the template gain a shared "public egress without a secret" helper, with both extensions using it?
9. **Config tab.** Is an optional `content-inventory` config tab (site level only, no org fallback) acceptable, with in-app overrides stored per browser? Do authors lacking config read permission matter?
10. **Resume store.** Is a per-browser IndexedDB checkpoint (not shared across users or machines; may not persist in some iframe/Safari cases) acceptable for "resume"?
11. **`daFetch` sign-in redirect.** Accept using `actions.daFetch` (token stays current, but a `401` triggers an IMS sign-in redirect that may navigate the iframe), relying on checkpoint/resume to recover? The alternative is plain `fetch` with the initial token, which cannot refresh.
12. **Scale.** How many documents does the largest site you will audit have? This sets the status-phase expectation and whether a paid Workers plan or the bulk-status alternative matters.
13. **Overlap and positioning.** Confirm "audit, not recommendations", and whether to ask the EW team about overlap with their planned insights before a large build.
14. **Inherited decisions.** Cloudflare account/plan and the Adobe outside-activity/IP policy (#2 Q1, #1 R1); Code Sync and the DA org/site names (#1 R3/R10); whether `workers.dev` is acceptable for the worker URL (#2 Q10).
15. **CSV details.** UTF-8 with BOM and comma separator are assumed; do you prefer no BOM or a locale-dependent separator?
16. **Visibility model.** The inventory shows only what the signed-in user can read. Is that acceptable for a "site-wide" audit, or should an admin-only mode exist?
