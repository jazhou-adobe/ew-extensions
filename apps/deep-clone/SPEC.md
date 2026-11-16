# Spec: Deep Clone (fullscreen app)

Ticket: jazhou-adobe/ew-extensions#36 (this spec: #74). Blocked by: #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`). #2 (shared worker template) is NOT a dependency: this extension needs no backend.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend used throughout: **[VERIFIED]** = read in a primary source (URL or commit given); **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an Adobe answer.

Primary sources read (all 2026-11-16):
- DA Admin API docs: https://docs.da.live/developers/api/source, /copy, /list, /move.
- DA Admin API source, `adobe/da-admin` @ `4c0458c` (2026-11-10): https://github.com/adobe/da-admin (routes, handlers, `src/storage/object/copy.js`, `src/helpers/copy.js`, `src/utils/daCtx.js`, `src/utils/daResp.js`).
- DA App SDK source, `adobe/da-nx` @ `a1bd8ec` (2026-11-15): https://github.com/adobe/da-nx (`nx/utils/sdk.js`, `nx/utils/daFetch.js`, `nx/public/utils/tree.js`, `nx/blocks/shell/shell.js`, `nx/blocks/loc`).
- DA editor source, `adobe/da-live` @ `4a95ea6` (2026-11-13): https://github.com/adobe/da-live (`blocks/shared/prose2aem.js`, `blocks/shared/utils.js`).
- EW docs: https://www.aem.live/docs/ew/developing/apps-plugins, https://www.aem.live/docs/ew/administering/multi-site-manager, https://www.aem.live/docs/limits.
- Upstream conventions and prior art: https://github.com/adobe-rnd/ew-extensions (e.g. `tools/block-editor/document.js`, `tools/block-editor/config.js`), and the approved scaffold spec `apps/hello-world/SPEC.md`.
- Fragment block markup contract: https://github.com/adobe/aem-boilerplate/blob/main/blocks/fragment/fragment.js.
- Contentful reference pattern cited by the ticket: https://www.contentful.com/blog/new-apps-integrations-marketplace/ (not re-read for this spec; it is only the product analogy).

---

## Problem Statement

A content admin running a campaign in Experience Workspace (EW) frequently needs "the same campaign again": last quarter's landing page, its sub-pages, the fragments those pages include, and the images and files they use, copied to a new path and made to work independently. Today the only options are:

- DA's own copy/rename, which copies bytes only. A copied page still links to the *old* campaign's pages and still includes the *old* campaign's fragments, so the clone silently edits-through to the original (edit the shared fragment, both campaigns change) and its internal links lead authors back to the old campaign.
- Doing it by hand: open every page, find every fragment and link, copy, repoint. This is slow, error-prone and not reviewable.

MSM (Multi-Site Manager, https://www.aem.live/docs/ew/administering/multi-site-manager) covers the "same content on satellite sites" case. It does not cover "a new independent campaign on the same site cloned from an existing one". Path rewriting (making internal links and fragment includes point at the copies, and only at the copies) is the hard part and is the real value of this tool.

## Solution

A fullscreen EW app, **Deep Clone**, reachable from the EW Apps menu. The admin:

1. Picks a **source** (a page or a folder, typically a campaign) and a **target** path.
2. Chooses the clone options (what to include, naming pattern, conflict behaviour).
3. Presses **Build plan**. The app crawls the source, reads every document, discovers what each one references (fragments, media, other pages in the set), and shows a **clone plan**: every document and asset that would be written, its source path, its new path, why it is included, and any conflict at the target. **Nothing has been written yet.**
4. Reviews (and can untick items), then presses **Run clone**. The app copies assets, and rewrites-then-saves every document so that references to anything in the cloned set point at the clones and references to anything outside the cloned set are left exactly as they were.
5. Gets a **per-item report** (created / overwritten / skipped / renamed / failed, with reason) that can be exported.

It runs entirely in the browser against the DA Admin API using the user's own EW session (the IMS token handed over by the DA App SDK); there is no backend, no secrets and no vendor account. Permissions are whatever the user already has in DA: the app can never do more than the signed-in user could do by hand.

## User Stories

Campaign admin (primary actor):

1. As a campaign admin, I want to enter a source page or folder and a target path, so that I can clone a campaign without hand-copying every file.
2. As a campaign admin, I want the app to detect whether my source is a page or a folder, so that I do not have to know how DA stores them.
3. As a campaign admin, I want to be asked what to do when a page and a same-named folder both exist at the source path (page, folder or both), so that I clone exactly what I mean.
4. As a campaign admin, I want to see a clone plan before anything is written, listing every document and asset with its new path, so that I can check the blast radius first.
5. As a campaign admin, I want each plan row to say why it is included (in the source folder, referenced as a fragment by X, referenced as media by Y), so that surprises are explainable.
6. As a campaign admin, I want to untick individual plan rows (for example a shared brand fragment that should stay shared), so that I control what becomes a copy and what stays shared.
7. As a campaign admin, I want references to an unticked item to stay pointing at the original, so that "shared" really means shared.
8. As a campaign admin, I want links between pages inside the cloned set rewritten to the cloned pages, so that the new campaign is internally self-consistent.
9. As a campaign admin, I want fragment includes inside the cloned set rewritten to the cloned fragments, so that editing a cloned fragment does not change the original campaign.
10. As a campaign admin, I want images, videos, PDFs, SVGs and sheets stored in DA under the source copied and re-pointed, so that the clone does not depend on the original's files.
11. As a campaign admin, I want links to pages and resources outside the cloned set to be left untouched, so that cloning never changes meaning for things I did not choose to clone.
12. As a campaign admin, I want fragments referenced by fragments (and so on) to be discovered automatically, so that I do not miss nested dependencies.
13. As a campaign admin, I want circular fragment references handled without hanging or duplicating, so that odd content does not break the tool.
14. As a campaign admin, I want hash and query parts of links (`#section`, `?utm_...`) preserved when a link is rewritten, so that analytics and anchors keep working.
15. As a campaign admin, I want relative links (`./offer`, `../x`) resolved correctly even though the document moves, so that a moved page does not silently break.
16. As a campaign admin, I want absolute same-site links (`https://main--site--org.aem.page/...` or `.aem.live`) rewritten in the same form they were written, so that content conventions stay intact.
17. As a campaign admin, I want to choose where fragments and media that live *outside* the source folder go (under the clone, or not cloned at all), so that I decide how self-contained the clone is.
18. As a campaign admin, I want a configurable naming pattern for cloned items (`{name}`, `{name}-copy`, ...), so that clones follow my team's naming scheme.
19. As a campaign admin, I want to choose what happens when a target already exists (skip, overwrite, or add a numeric suffix), so that I can re-run safely and never clobber by accident.
20. As a campaign admin, I want "skip" and "suffix" to be the safe options, and "overwrite" to need an explicit extra confirmation that shows how many items will be replaced, so that destruction is never one stray click.
21. As a campaign admin, I want rewritten links to point at the *suffixed* name when suffix mode renames an item, so that the clone is consistent even after renaming.
22. As a campaign admin, I want to see warnings in the plan (target name will be lower-cased, a reference could not be resolved, a missing fragment, a sheet that may contain unrewritten paths), so that I know what the tool could not guarantee.
23. As a campaign admin, I want to see progress while the clone runs (done / total, current item, errors so far), so that I know the tool is alive on large campaigns.
24. As a campaign admin, I want to cancel a running clone and keep an accurate report of what was and was not written, so that I can recover from a mistake.
25. As a campaign admin, I want a per-item report with the result and reason for each item, so that I can audit the clone and fix failures.
26. As a campaign admin, I want to export the report (copy/CSV/JSON), so that I can attach it to a ticket.
27. As a campaign admin, I want to retry only the failed items from a report, so that one 5xx does not force me to redo the whole clone.
28. As a campaign admin, I want a re-run with "skip" to complete a half-finished clone idempotently, so that closing the tab mid-run is recoverable.
29. As a campaign admin, I want clear links to open the cloned root in the EW editor from the report, so that I can review the result immediately.
30. As a campaign admin, I want the app to reject a target inside the source, equal to the source, or in a reserved location, so that I cannot create a recursive or invalid clone.
31. As a campaign admin, I want a clear message if I lack read permission on the source or write permission on the target, so that I know it is an access problem and not a bug.
32. As a campaign admin, I want an explicit cap (max items) with a clear message when a source is too large, so that I never start a clone that cannot finish.

Extension author / maintainer:

33. As the maintainer, I want all code in one self-contained `deep-clone` folder with its own README, tests and entry page, so that it can be moved upstream or deleted without breakage (scaffold rule).
34. As the maintainer, I want the core (reference scanning, path mapping, planning, rewriting, execution) to be pure logic behind an injected DA client, so that it is fully unit-testable with no network or EW.
35. As the maintainer, I want an in-memory fake DA Admin that reproduces the real API's quirks (silent 204, lower-casing, same-org rule, pagination), so that tests catch the behaviours that bite in production.
36. As the maintainer, I want the README to say which config-sheet row enables the app and which site config it reads (none), so that enabling it is copy-paste.
37. As the maintainer, I want the app to need no backend, secrets or vendor accounts, so that it is cheap to run and safe to publish.
38. As the maintainer, I want the app to never log or render the IMS token, so that the template stays safe.

Stakeholder / reviewer:

39. As a reviewer, I want the README to position the tool for campaign pages versus MSM, so that nobody uses it for satellite-site content that MSM already handles.
40. As a reviewer, I want manual verification steps for `ref=local` and a branch ref that I can run in EW in a few minutes, so that I can approve a PR with evidence.

## Implementation Decisions

Decision-level only. Paths and names appear in Build Analysis.

### Shape and platform

1. **Type and location.** Fullscreen app (registered in the EW `apps` sheet), living in its own folder `deep-clone` under the `apps` directory per the scaffold convention (owner-approved: every extension, app or plugin, is `apps/<name>/`; type is determined by the config-sheet row, not the path). Entry page named after the folder. Vanilla DOM + browser-native ES modules, no bundler, as decided in #1.
2. **No backend.** All calls go from the browser to the DA Admin API. [VERIFIED] DA Admin answers with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: *` and exposes `da-continuation-token`, `x-da-actions`, `ETag` (`adobe/da-admin` `src/utils/daResp.js`), so browser calls from the `aem.live` extension origin work. This matches the ticket's "client-side only" and #36's `Backend needed: No`. The shared worker template (#2) is not used.
3. **Single boundary to DA: the SDK's `daFetch`.** Use `actions.daFetch` from the awaited DA App SDK (it adds `Authorization: Bearer <IMS>` and keeps the token current when the parent posts refreshes) [VERIFIED: `nx/utils/sdk.js`: `daFetch` is in `actions`; later parent messages carrying `token` call `setImsDetails`]. Upstream's block-editor does the same (`sdk.actions.daFetch(url, { method: 'POST', body })`, https://github.com/adobe-rnd/ew-extensions/blob/main/tools/block-editor/document.js). The Admin origin is taken from `context.daOrigin` (the app shell passes `daOrigin`, `org`, `repo`, `ref`, `path`) with `https://admin.da.live` as the fallback, never hard-coded elsewhere. [VERIFIED: shell.js `getParts`.]
4. **Scope = one DA site (org/repo).** The app operates inside the org/site EW opened it for (`context.org`, `context.repo`). Cross-site and cross-org clones are out of scope (the server forbids cross-org anyway, see 5c).
5. **Behaviours of the DA Admin API this design is built around** (all [VERIFIED] in `adobe/da-admin` @ `4c0458c` unless stated; the published docs disagree in places, so the code is treated as the contract and the drift is recorded as a risk):
   a. `GET /list/{org}/{repo}/{path}` returns immediate children only; folders have no `ext`; files have `ext`; paging is via the `da-continuation-token` response/request header (`nx/public/utils/tree.js` loops on it). The docs page does not mention paging; the first-party crawler does. A missing or empty folder returns `[]` with 200 (cannot distinguish "empty" from "does not exist"; docs and code agree).
   b. `GET /source/...` returns raw bytes for any supported type; 404/401/403 have empty bodies. `HEAD /source/...` exists (`handlers/head.js`) and is the existence probe.
   c. `POST /copy/{org}/{repo}/{path}` with form field `destination` requires `destination` to start with `/{org}/...` (code splits off the first segment and rejects 400 "Destination must be in the same org as the source." if it differs). **The published docs example (`destination=/drafts/cmillar/article-backup.html`, no org) would fail against the current code.** The server also **lower-cases** the destination. A folder source copies recursively server-side (docs say folders are NOT copied; the code lists the prefix and copies every key, 900 per call, returning 206 plus a `continuationToken` body to resume with form field `continuation-token`). The handler returns **204 even when the source does not exist or an individual key failed** (errors inside the batch are swallowed; only a thrown listing error becomes 404). Overwrite is silent (the 412 branch re-puts the source into the target with versioning). Copy gives the new object a fresh ID/history (not a rename).
   d. `POST|PUT /source/{org}/{repo}/{path}` with multipart `data` creates/overwrites a file and returns 201 JSON; no `If-None-Match` support on writes (conditional headers are only honoured on GET), so "skip if exists" cannot be made atomic server-side.
   e. Every request path is lower-cased by the server (`daCtx.js`), so keys are effectively case-insensitive/lower-case; ACLs are enforced per path (403), and `x-da-actions` on responses lists the caller's permissions for the path.
   f. Reserved folder `.da-versions` is blocked on every route (404/400).
6. **Why not use the server's recursive `/copy` for the clone.** It copies bytes only (cannot rewrite references), and it hides per-item failures (see 5c). The app therefore performs its own per-item operations. It may still use `/copy` for a *single* binary asset (server-side, no download) but must verify the result with `HEAD`, because success is not trustworthy. Documents and sheets are always read, transformed and written through the Source API so the exact HTTP status of each item is known. [OPEN: for very large binaries, `/copy` + HEAD is cheaper than GET + POST; decide after measuring in the sandbox.]

### Domain model (shared vocabulary)

7. **Source root / target root.** The user's source path and target path. A *page* is a `.html` document; a *folder* is a prefix.
8. **Clone set** = source root contents plus any dependencies the user kept ticked. **Dependency** = a document (fragment) or asset (media/file) referenced by something in the set but located outside the source root. **Reference** = a link, image, video or fragment include found inside a document.
9. **Reference classes and rules** (the heart of the feature; each is a unit-tested table of cases):

   | Reference form (in cloned HTML) | Resolves to | Rule |
   |---|---|---|
   | `a[href]` root-relative or same-site absolute (`https://{ref}--{repo}--{org}.aem.page` or `.aem.live`) to a path inside the clone set | clone target | Rewrite path; keep origin form, query and hash |
   | same, but to a path outside the clone set | original | Leave untouched |
   | `a[href]` relative (`./x`, `../x`, `x`) | resolved against the *source document's* location | If target in set: rewrite. If not: convert to the equivalent root-relative path of the original so it still points at the original after the document moves, and list it in the report as "relativised" |
   | Fragment include (fragment block with a link, or plain-text path in the block) | document `.html` | Same as page link; if the link text equals the old path/URL, update the text too |
   | `img[src]`, `source[srcset]`, `video` and `source[src]`, `poster` pointing at DA-hosted media (`https://content.da.live/{org}/{repo}/...` or root path to a DA file) | DA asset | If in set: rewrite; otherwise untouched |
   | `./media_<hash>.<ext>` (content-addressed media-bus reference) | media bus | Not a DA object; leave untouched. [ASSUMPTION: media-bus URLs resolve by hash independent of the document path; fragment.js resolves `./media_` against the fragment's own path for exactly that reason. Verify in manual step M3] |
   | `mailto:`, `tel:`, `javascript:`, `#anchor`, protocol-relative `//host`, other hosts, other sites | n/a | Never touched |
   | Same-site link to a `.json` sheet or other asset | DA asset | Same as page link |

   Matching is on a canonical path: percent-decoded, lower-cased (the server lower-cases keys), `.html` hidden, trailing `/` and `/index` both map to the `index` document. References are found by parsing the HTML (not regex on raw text), and only the specific attributes above are changed.
10. **Dependency discovery.** Transitive and cycle-safe, following only *fragment includes* and *media references* (not ordinary page links). Ordinary links to pages outside the source root are never followed, because following links would crawl the whole site; they stay as references to the original. Missing dependencies (404) are reported as warnings and left untouched.
11. **Target path mapping.** An item under the source root maps to the same relative path under the target root. A dependency outside the source root maps under a configurable dependency root inside the target (default: a `_deps` folder under the target root, mirroring the dependency's original full path). The option "do not clone external dependencies" keeps all references to outside things pointing at the originals. [OPEN: owner to confirm the default folder name and whether fragments should instead land in a sibling `fragments` folder of the target.]
12. **Naming pattern.** Applies to the base name (not extension) of every cloned item *below* the explicit target root; tokens `{name}`, `{date}` (UTC `YYYYMMDD`), `{n}` (suffix counter). Default `{name}` = keep names. The target root name is exactly what the admin typed. [OPEN: owner to confirm this reading of "naming pattern"; alternative is applying the pattern to the root name only.]
13. **Name rules.** Targets are normalised to what the server and delivery accept: lower-case, characters `a-z 0-9 -` (plus path separators and the file extension), total path <= 900 characters (https://www.aem.live/docs/limits). Anything the app changes is shown in the plan as a warning; the mapped (normalised) path is what references are rewritten to, so rewriting never targets a name the server will not create.
14. **Conflict behaviour** (one setting for the run, default `skip`): 
    - `skip`: existing target kept; the item is reported `skipped (exists)`; references are still rewritten to that target path (stable, idempotent re-runs).
    - `overwrite`: existing target replaced (DA versions the overwritten document); requires an extra confirmation showing the replace count.
    - `suffix`: a new unique name (`name-2`, `name-3`, ...) is chosen at *planning* time against the real target listing and the other planned names; the mapping table is updated before any rewriting so references point at the suffixed clone. If the target root itself collides, only the root is suffixed (children then cannot collide).
    Existence is determined by listing the target tree during planning (cheap, paged) and re-checked per item with `HEAD` just before writing (write is non-atomic; this narrows but cannot close the race, see risks).
15. **Order of execution.** Create nothing until the plan is accepted. Then: (1) assets and sheets, (2) documents. The mapping table is frozen when the plan is accepted, so document order does not matter and every rewrite uses the same table.
16. **Document rewriting.** Execution re-reads each document, rewrites it with the frozen table, and saves. References found at execution time that were not in the plan are left untouched and listed as "new since planning". The rewriter must be idempotent and must not change anything but the targeted attributes (and the link-text case in 9); a round-trip with an empty table must leave the document semantically identical.
17. **Sheets (`.json`).** Copied verbatim. If the text contains the source root path, a warning "may contain unrewritten paths" is added. Rewriting sheet data is out of scope. [OPEN: some sites keep path columns in sheets.]
18. **Failure handling and retries.** Each item is an independent unit with its own result; one failure never aborts the run. 429 and 5xx are retried with capped exponential backoff (3 attempts, injectable clock); 4xx other than 429 are not retried. Network errors surface as status 500 from `daFetch` (it wraps thrown errors into a 500 Response) and are retried like 5xx. 401 triggers the SDK's own sign-in flow; the run pauses as "needs sign-in". [VERIFIED: `daFetch` implementation.] There is no automatic rollback; the report lists what exists so the admin can delete it (see Out of Scope).
19. **Concurrency.** Bounded worker pool (default 5, setting 1-10) over items; the list crawl is sequential per folder with paging. [ASSUMPTION: DA Admin documents no rate limit; the https://www.aem.live/docs/limits rate limit (200 req/s per IP per host) is for aem.live/aem.page, not admin.da.live. Pool size is conservative.] [OPEN: ask the DA team for write rate limits.]
20. **Size guard.** Plan refuses (with a clear message) above a configurable item cap (default 1000 items). [ASSUMPTION: a safe default; tune with sandbox measurement.]
21. **Validation before planning.** Reject: empty/identical source and target; target inside the source (and source inside target); paths with a `.da-versions` segment; sources that list as empty and have no `.html` document; missing read permission (403) or, where `x-da-actions` on a target-parent listing shows no `write`, an early write warning. [VERIFIED: header name and the `=read,write` format in `daFetch`; exact semantics beyond that are an ASSUMPTION.]
22. **UI.** Single page, vanilla DOM: form (source, target, options) -> plan table (filterable; tick/untick; warnings summary) -> run view (progress, cancel) -> report table (+ export, retry failed, open in EW). All user-supplied and API-supplied strings rendered as text, never HTML. The IMS token is never rendered or logged. The page shows the standard "waiting for / not running inside Experience Workspace" states from the hello-world pattern.
23. **Sharing code.** No imports from other extensions. The fake DA Admin and SDK stub live in the shared test-support area created by #1 where they are generic (SDK stub) and inside this extension's test folder where they are DA-Admin-specific (fake). Reuse by other DA-writing extensions is a later refactor, not part of this ticket.
24. **Docs.** The extension README covers: purpose and positioning vs MSM, setup, the EW `apps` sheet row (title `Deep Clone`, path `https://da.live/app/{org}/{site}/apps/deep-clone/deep-clone`, `ref` blank), the site config it reads (**none**), permissions needed, option reference, known limits (sheets, lower-casing, no rollback, size cap), `ref=local` and branch-ref instructions, the trust prompt note. The root README extensions table gets one row (name, folder, entry point, `app`, description).

## Testing Decisions

**What makes a good test here:** assert external behaviour only: given a source tree in a (fake) DA site and a set of options, which items the plan lists, what documents/assets exist afterwards with what content, and what the report says. Never assert on internal function names, DOM structure beyond accessible roles/text, CSS classes, or the order of internal calls (except where order is the behaviour, e.g. assets before documents). Tests need no network, IMS, or EW.

**Proposed seams** (recorded instead of asked, per #74). Highest seam first; fewer is better, so there is one new seam and two existing ones:

| # | Seam | Used by | How it is stubbed |
|---|------|---------|-------------------|
| S1 (primary, new, highest) | **DA client boundary**: the single `daFetch(url, opts)` function the app receives from the SDK. Everything below it (list, source GET/HEAD/POST, copy) is the DA Admin API. | Unit/integration tests of the whole clone engine (plan, rewrite, execute, report) and e2e | An **in-memory fake DA Admin** that implements the API semantics in 5a-5f (paging, lower-casing, same-org rule, silent 204, 403s, 5xx injection). Unit tests call the engine with the fake `daFetch`; e2e serves the same fake through Playwright route interception of the Admin origin |
| S2 (existing, from #1) | Entry HTML page + SDK module boundary | Playwright e2e | Shared SDK stub (route-intercepts `https://da.live/nx/utils/sdk.js`, supplies `context` incl. `org`, `repo`, `daOrigin`, records actions) as in `apps/hello-world/SPEC.md` S1 |
| S3 (existing, from #1) | Repo convention (folders, README table, registration row) | CI lint job | Convention-check script |

The engine is deliberately specified as "inputs: options + injected `daFetch`; outputs: plan / report / DA state" so the one new seam covers every AC through the highest practical interface; pure helpers (reference scanner, path mapper, rewriter) are tested through the same seam as a table of input documents to output documents rather than by their internal signatures, except where a table-driven unit test of the rewriter is clearer (it is still behaviour-only: HTML in, HTML out).

**Modules tested:** reference scanner + rewriter (HTML in/HTML out tables), path mapper (naming, normalisation, conflict naming), planner (crawl, dependency closure, cycles, conflicts, validation), executor (ordering, concurrency bound, retries, cancel, per-item results), report (statuses, export), UI wiring (e2e), the fake DA Admin itself (contract test against recorded real responses/OpenAPI), the convention check (from #1).

**Prior art:**
- Unit: upstream `adobe-rnd/ew-extensions` `test/unit/**` with an import-map SDK fixture and injected `fetchImpl`/`now` (see `apps/hello-world/SPEC.md` Testing Decisions); the same WTR + Mocha + chai runner from #1.
- E2E: upstream `test/e2e/utils/da-api-stubs.js` (`stubDaApi`), which stubs the DA Admin network before `page.goto()`, and its Tier 1 (stub-only, CI) vs Tier 2 (real session, local) split.
- Contract source of truth: `adobe/da-admin` `docs/openapi/*.yaml` plus the handler source at the commit above.

## Out of Scope

- Cross-site and cross-org cloning (server rejects cross-org; cross-repo within an org is possible but not exposed in v1).
- Rewriting content inside spreadsheet data (`.json` sheets), block-specific data formats, metadata/`og:image` values that are not links or images, or free-text mentions of paths.
- Following ordinary page links to discover pages (only fragments and media are followed).
- Preview/publish of the clone (the admin triggers those through EW as usual), redirects, indexes, and query-index/sitemap updates.
- Rollback/undo (a "delete everything this run created" button), run history across sessions, scheduled/background jobs.
- MSM behaviour; cloning satellite-site inheritance relationships.
- Server-side (worker) execution, resumable jobs that survive tab close (re-running with `skip` is the recovery path).
- Permission administration; "admin only" enforcement beyond DA's own ACL.
- AEM-authoring (non-DA) content sources.
- Visual design polish and accessibility audit beyond semantics and keyboard operability.

## Further Notes

- **Docs vs source drift is the dominant risk** (copy `destination` format; folder copy; paging). The spec uses source code as truth and adds the drift to the risk table; a live contract smoke test (Tier 2) is the mitigation.
- **Hlx6 migration.** `da-admin` and `da-live` now contain source-bus ("hlx6") propagation (`syncCopy`, `syncSourcePut`; `api.aem.live/{org}/sites/{site}/source/...`). Whether `admin.da.live` stays the supported write path for migrated sites is [OPEN] for the EW team; the app isolates the origin (`context.daOrigin`) so a switch is one decision.
- **Image size.** da-live caps uploads at 4.5 MB on hlx6 sites and 20 MB on legacy sites (`blocks/canvas/utils/image-upload.js`); large binary clones may hit the same ceiling through `POST /source`, which is another reason to prefer `/copy` + `HEAD` for binaries. [VERIFIED in source comments; applicability to copy is an ASSUMPTION.]
- The `SPEC.md` in this folder is a planning artefact; when the app is built, keep it and link it from the folder README, or delete it per the #1 decision. [OPEN, low stakes, same as hello-world.]

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live, prod IMS)               This repo (EDS code site)
 ├─ /apps#/{org}/{site}  (card from `apps` sheet row)
 └─ /app/{org}/{site}/apps/deep-clone/deep-clone --iframe--> https://{ref}--{site}--{org}.aem.live/apps/deep-clone/deep-clone.html
                                                              │  await DA_SDK -> { context, token, actions }
                                                              └─ actions.daFetch ──HTTPS + Bearer IMS──> admin.da.live (DA Admin API)
                                                                       list | source GET/HEAD/POST | copy
```

- **Browser extension code (this ticket): everything.** UI, planning, rewriting, execution, reporting. One fullscreen iframe, no worker, no secrets.
- **Worker (#2): not used.** `Backend needed: No`. Rationale: DA Admin is already CORS-open and accepts the user's IMS bearer; the only server-side things a worker could add (server-side jobs, rate-limit smoothing) are out of scope.
- **EW host:** loads the iframe, runs the trust prompt for non-adobe orgs (first time per `org/repo/ref`), and posts the init message; the app is entirely subject to the signed-in user's DA ACLs.
- **DA Admin API:** system of record; the app never talks to AEM Admin (`admin.hlx.page`) because preview/publish is out of scope.

Module boundaries (conceptual; names are the implementer's call): `entry page` + `bootstrap` (awaits SDK, wires UI) / `engine` (plan + run) composed of `reference scanner`, `path mapper`, `planner`, `rewriter`, `executor`, `report` / `UI render` (side-effect-free, takes state, returns DOM). Only `bootstrap` touches the SDK and only through the injected `daFetch`.

## 2. EW integration points

| Concern | Decision | Source |
|---|---|---|
| Surface | Fullscreen **app** | https://www.aem.live/docs/ew/developing/apps-plugins |
| Config-sheet row | `apps` sheet in `https://da.live/config#/{org}/{site}/`; columns `title`, `description`, `image`, `path`, `ref` | same page [VERIFIED]; `ref` column semantics for apps undocumented [OPEN, as in hello-world R11] |
| App URL | `https://da.live/app/{org}/{site}/apps/deep-clone/deep-clone` (+ `?ref=local` or `?ref=<branch>`) | docs + `nx/blocks/shell/shell.js` [VERIFIED] |
| SDK | `import DA_SDK from 'https://da.live/nx/utils/sdk.js'` and `await`, plus the SDK script tag in the entry HTML (hello-world decision 5) | docs/source [VERIFIED] |
| Context used | `context.org`, `context.repo`, `context.ref`, `context.daOrigin` (shell context also has `view`, `path`, `search`, `hash`, `imsOrigin`); `token` is not used directly (`daFetch` holds it) | shell.js [VERIFIED]; shape is not a documented contract [ASSUMPTION], so missing `org`/`repo` fall back to a manual "org/site" field |
| SDK actions used | `daFetch` only. `sendText`/`closeLibrary` etc. are plugin-only and unused | sdk.js [VERIFIED] |
| Site config read | none in v1 | decision |
| Library plugin? | No; one app entry. [OPEN: a library-plugin entry that pre-fills the source with the currently open page is a possible v2.] | |

## 3. External APIs and auth flows

- **Auth:** the IMS access token from the SDK handshake, applied by `actions.daFetch` as `Authorization: Bearer`. 401 from `daFetch` triggers the SDK sign-in flow (`handleSignIn`) [VERIFIED]. The app never reads/stores/renders the token. Token refresh messages from the parent update `daFetch` transparently [VERIFIED], so long runs survive expiry as long as EW keeps refreshing [ASSUMPTION: EW sends refreshes; verify during the long-run manual step M7].
- **Endpoints used** (`{admin}` = `context.daOrigin`):

  | Purpose | Call | Success | Notes |
  |---|---|---|---|
  | List children | `GET {admin}/list/{org}/{repo}/{path}` (+ `da-continuation-token` request header for next page) | 200 JSON array; next token in `da-continuation-token` response header | Folder = no `ext`. Empty vs missing indistinguishable |
  | Read document/asset | `GET {admin}/source/{org}/{repo}/{path}` | 200 bytes | 404/401/403 empty body |
  | Exists probe | `HEAD {admin}/source/{org}/{repo}/{path}` | 200 / 404 | [VERIFIED handler exists; verified status codes from source only, not live] |
  | Write document/sheet/asset | `POST {admin}/source/{org}/{repo}/{path}` multipart `data` | 201 JSON | Overwrites silently; creates version for docs |
  | Server-side copy of one binary (optional) | `POST {admin}/copy/{org}/{repo}/{path}` multipart `destination=/{org}/{repo}/{newpath}` | 204 even on failure | Must `HEAD` to confirm; destination is lower-cased; must include org prefix (docs example wrong) |

  Docs: https://docs.da.live/developers/api/list, /source, /copy. Verified-from-code details: `da-admin/src/helpers/copy.js`, `src/storage/object/copy.js`, `src/storage/utils/list.js`, `src/utils/daResp.js`.
- **Content types:** documents `text/html`, sheets `application/json`, binaries by their own type. Supported delivery types per https://www.aem.live/docs/limits: HTML, JSON, MP4, PDF, SVG, JPG, PNG, AVIF, WEBP. Items with other extensions are listed with a warning "not deliverable" and copied only if the user keeps them ticked [ASSUMPTION: the DA source accepts them].
- **Hosts:** all DA/ACL calls go to the DA Admin origin; the app makes no other cross-origin calls (CSP-friendly, hermetic for tests).

## 4. Data contracts

- **Engine options** (UI model): `source` (path), `target` (path), `sourceKind` (`auto|page|folder|both`), `includeFragments`, `includeMedia`, `externalDependencies` (`underTarget|none`), `dependencyRoot`, `namingPattern`, `conflict` (`skip|overwrite|suffix`), `concurrency`, `maxItems`.
- **Clone plan** = ordered list of items + summary. Item fields: `kind` (`document|sheet|asset`), `sourcePath`, `targetPath`, `reason` (`source-root|fragment-of:<path>|media-of:<path>`), `selected`, `conflict` (`none|exists`) and the action that will be taken, `warnings[]`. Summary: counts per kind/conflict, warnings, estimated request count.
- **Mapping table** = canonical source path -> canonical target path (including suffix renames); frozen at "Run".
- **Result item** = plan item + `status` (`created|overwritten|skipped|renamed|failed|cancelled`), `httpStatus`, `message`, `rewrites` (count by class), `relativised[]`, `unresolved[]`.
- **Report export** = JSON (full) and CSV (flat). No tokens or full document bodies.
- **State persistence:** in memory only; optional `sessionStorage` copy of the last report to survive an accidental reload [OPEN, nice-to-have].

## 5. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Docs/source drift on `/copy`**: docs say folders aren't copied and show a destination without an org; source copies folders recursively and requires `/{org}/...`. Either could change. | High (breaks silently) | Use per-item Source API for documents; use `/copy` only for single binaries behind a feature switch + `HEAD` verify; contract tests against the fake pinned to the commit; Tier-2 live smoke test; [OPEN] ask the DA team which behaviour is a supported contract |
| R2 | **Silent success** (`/copy` 204 on missing/failed key; list can't distinguish missing from empty) | High | Verify every write via status (`POST`) or `HEAD` (`copy`); never trust 204 alone |
| R3 | **Server lower-cases paths**, names restricted to `[a-z0-9-]`, 900-char path limit | Med | Normalise during planning, rewrite to the normalised paths, show warnings |
| R4 | **No atomicity / rollback / conditional writes** (no `If-None-Match` on write) | Med | Plan-time listing + pre-write `HEAD`; idempotent re-run with `skip`; report enumerates created items; accepted race on concurrent editors |
| R5 | **Reference coverage**: DA HTML has multiple link/media forms (relative, same-site absolute, `content.da.live`, `./media_`, fragment text-only). Missing one yields a clone that still points at the original. | High (core value) | Table-driven rewriter tests with fixtures derived from real DA output (`prose2aem.js` behaviours: same-site `https://...aem.` links become root-relative on save; `content.da.live` images in the editor); plan shows "unrewritten references to the original" count per document for review |
| R14 | **Large campaigns**: hundreds of requests; unknown admin rate limits; browser memory for large binaries | Med | Concurrency cap, backoff on 429, item cap, streaming not required (docs small); measure in sandbox [OPEN: rate limits] |
| R6 | **Permissions**: user may read but not write; ACLs per path, descendant ACLs | Med | Per-item 403 reporting; early `x-da-actions` warning; sandbox user with restricted write for a negative test |
| R7 | **Hlx6 migration** may change where writes should go | Med | Isolate admin origin; [OPEN] EW team |
| R8 | **Media-bus semantic of `./media_<hash>`** (assumed path-independent) | Med | Manual verification M3 (open the clone on `aem.page` and confirm images render) |
| R9 | **HTML round-trip fidelity**: DOM parse/serialise can reformat markup | Med | Rewriter limited to attribute edits; round-trip test with empty mapping must be semantically identical (DOM equality); real-content review in M3 |
| R10 | **SDK context is not a documented contract** | Low | Fall back to manual org/site input; context rendered generically in the standalone state |
| R11 | **Trust prompt / `ref=local` / Code Sync prerequisites** (same as scaffold R3, R6) | Low-Med | Documented in README; owner prerequisite from #1 |
| R12 | **Adobe outside-activity / IP policy** and marketplace process (scaffold R1, R2) | High for publication | README note per #1 AC6; not solved here |
| R13 | **Overlap with DA's own copy and with MSM** (overlap risk 3/5 in the ticket) | Med (product) | README positioning: campaign clone with reference rewriting; link to MSM for satellite content |

## 6. Ordered build plan (sized to #36's acceptance criteria)

0. **Prerequisite (#1, owner):** scaffold merged, Code Sync + site registration working, DA org/site confirmed (scaffold R3/R10). Create a DA sandbox site/folder with seed content (Testing Requirements 5).
1. **Fake DA Admin + engine skeleton, test-first (AC1, AC2, AC3, AC7):** failing tests for the fake's contract (list paging, lower-casing, same-org copy, silent 204), then the fake. Folder created with entry page, README stub, test folders (AC4 scaffolding via the #1 copy-a-hello checklist).
2. **Reference scanner + rewriter** with the table of reference classes (AC2, AC7). Fixtures from real DA output.
3. **Path mapper** (target mapping, naming pattern, normalisation, conflict suffixing) (AC3, AC7).
4. **Planner**: source-kind detection, crawl with paging, dependency closure with cycle safety, conflicts, validation, size guard (AC1, AC2, AC3, AC7).
5. **Executor + report**: ordering, concurrency, retries, cancel, per-item results, retry-failed, export (AC3, AC7).
6. **UI**: form, plan table with tick/untick, overwrite confirmation, progress, report; standalone/waiting states; accessibility basics (AC1, AC3). E2E against SDK stub + fake DA Admin.
7. **README + registration**: positioning vs MSM, setup, `apps` row, "site config read: none", options, limits, `ref=local`/branch-ref, trust prompt; root README extensions-table row (AC4, AC5).
8. **Quality gates**: lint, unit, e2e, convention check, CI green on push and PR (AC7).
9. **Manual EW verification** M1-M8 (Testing Requirements 4) on `ref=local` and a branch ref (AC5, AC6); record screenshots in the PR.
10. **Tier-2 live smoke** against the sandbox site (local only) to confirm the fake still matches the API; update fake and spec drift notes.

Size: the ticket rates build effort 3/5; the dominant cost is steps 2-4 (reference coverage and mapping). Steps 1 and 5 are mechanical once the fake exists.

---

# Testing Requirements

## 1. Test tiers and seams

| Tier | Tool | Seam | Network | Runs in CI |
|---|---|---|---|---|
| Unit/integration | `@web/test-runner` (Mocha + chai, Chromium), per #1 | S1 (engine + fake DA Admin), pure HTML tables | none (fetch guard fails any real call) | Yes (`unit` job) |
| E2E (hermetic) | Playwright, Chromium, per #1 | S2 + S1 (SDK stub + fake DA Admin via route interception) | none; only the stubbed SDK and the stubbed Admin origin | Yes (`e2e` job) |
| Convention check | Node script from #1 | S3 | none | Yes (`lint` job) |
| Tier-2 live smoke | Playwright or Node against real DA Admin | real | needs sandbox + token | **No** (local, manual; `DA_AUTH_OK=1` convention from upstream `test/e2e/README.md`) |
| Manual in EW | Chrome, real EW | real | needs Adobe login | No (recorded in PR) |

Tests live inside the extension's own folder (`apps/deep-clone/test/unit`, `.../test/e2e`), per the owner-approved convention. Lint rules and CI are those from #1; no change to the shared tooling is required by this ticket.

## 2. Fake DA Admin (primary fixture)

An in-memory object store behind a `daFetch`-compatible function. It must reproduce, as behaviours (not by copying the server code): paged `list` with `da-continuation-token` (page size configurable so tests can force paging), folder vs file listing shape, `[]` for missing, `GET`/`HEAD`/`POST` source with the documented status codes, 403 per configured path (ACL), 5xx/429 injection per call count, **destination lower-casing**, **same-org rule and `/{org}/...` destination form**, **recursive folder copy with 206 + `continuation-token`**, **204-on-failure** for copy, reserved `.da-versions`, and a request log (so tests can assert "zero writes before Run" and request counts). Contract test: a fixture file of real responses recorded once from the sandbox (and the `docs/openapi/*.yaml` examples) must be accepted by the fake's response shapes; the Tier-2 test re-validates after any API drift.

## 3. Unit and contract tests (behaviour list)

**Reference scanner/rewriter (table-driven, HTML in -> HTML out):**
- Root-relative page link in the set -> rewritten to target; query and hash preserved; link outside set unchanged.
- Same-site absolute link (`.aem.page` and `.aem.live`, `main--` and branch refs) in the set -> rewritten and keeps the absolute form; another site's absolute link unchanged.
- Relative links (`./x`, `../x`, `x`): in the set -> rewritten; outside the set -> converted to root-relative original and recorded as `relativised`.
- `/index`, trailing slash and `.html`-less forms map to the same document.
- Mixed-case and percent-encoded paths match case-insensitively (server lower-cases).
- Fragment block with link: href rewritten; link text equal to old URL/path updated; link text different left alone. Fragment block with text-only path rewritten. Fragment to an item outside the set: untouched.
- `img[src]` / `source[srcset]` (with multiple candidates and width descriptors) / `video`/`source`/`poster` pointing at `content.da.live/{org}/{repo}/...` or a DA root path: rewritten when in the set; `./media_<hash>` untouched; external image hosts untouched.
- `mailto:`, `tel:`, `javascript:`, `#anchor`, `//host/...` untouched.
- Document with no references returns identical DOM; empty mapping round-trip is DOM-equal for a representative real-shaped document (fixture includes `<header>`, `<main>`, `<footer>`, `.da-metadata`, sections, blocks, pictures).
- Rewriter idempotent: running twice with the same table is a no-op the second time.
- Hostile content (`<script>`, event-handler attributes, `javascript:` hrefs) is never executed and never rewritten into something executable.

**Path mapper:**
- Relative-to-root mapping; target root exactly as typed; dependencies under the dependency root mirroring original full path; "no external dependencies" mode.
- Naming pattern tokens (`{name}`, `{date}`, `{n}`), applied below the root only; extension preserved.
- Normalisation: upper case, spaces and illegal characters -> allowed set with a warning; 900-char limit error.
- Suffix mode: `name-2`, `name-3` against target listing and against other planned names; folder root suffix only; references use the suffixed name.

**Planner:**
- Source-kind detection: folder, page, ambiguous page+folder (asks), missing (error).
- Crawl with paging (> 1 page of children, nested folders, empty folder) returns every document/asset exactly once.
- Dependency closure: fragment -> fragment -> media; circular fragments; fragment missing (warning); dependency outside the source root placed under the dependency root; the same dependency referenced from many documents appears once.
- Unticked items excluded and references to them left untouched; unticking a fragment keeps its inbound refs pointing at the original.
- Conflicts reflect the real target listing; `skip`/`overwrite`/`suffix` annotate the right actions.
- Validation: same source/target, target inside source, source inside target, `.da-versions`, size cap exceeded, 403 on source, `x-da-actions` without write on target parent (warning).
- **No writes** (no POST, no copy) occur during planning (request-log assertion).

**Executor/report:**
- Order: assets and sheets written before documents; every document rewritten with the frozen table.
- Per-item failure (403, 404, 500) does not stop the run; statuses and messages recorded.
- 429/5xx retried with backoff (fake clock), 4xx not retried; retry exhaustion -> `failed`.
- `/copy` binary path: 204 for a missing source is detected through `HEAD` and reported `failed`, never `created`.
- Skip conflict re-run completes a half-finished clone and is a no-op on a complete one (idempotence).
- Overwrite replaces existing content; version history assumptions are not asserted (fake does not model them).
- Cancel stops further writes and the report marks the rest `cancelled`.
- Concurrency never exceeds the configured bound (fake counts in-flight calls).
- Retry-failed re-runs only failed items; sheets containing the source path produce the "may contain unrewritten paths" warning.
- "New since planning" references are left untouched and listed.
- Token never appears in any DOM/report/log (stub token string search).

**Fake contract test:** fake responses match recorded real-response fixtures and the `docs/openapi` examples (shape and status codes).

**Shared:** SDK stub contract test (from #1).

Coverage target for the engine modules: >= 90% lines, reported but not a hard CI gate unless the owner agrees [OPEN].

## 4. End-to-end checks

### 4.1 Hermetic Playwright (CI)

Setup: local server on port 3000 (the dev loop under test), SDK route-intercepted with `context = { org, repo, ref, daOrigin: <fake origin>, ... }`, the Admin origin route-intercepted to the fake DA Admin seeded with the standard fixture tree (Section 5). Any other external request aborts.

- **E1 Plan before run:** enter source and target, Build plan -> table lists every document and asset with new paths, reasons, and warnings; the fake's request log has no `POST`/`copy` yet. (AC1)
- **E2 Run and report:** accept plan, Run -> progress reaches total; report lists each item with a status; cloned documents in the fake have rewritten references and original documents are byte-identical to before. (AC2, AC3)
- **E3 Untick:** untick a fragment -> that fragment is not created and references to it stay original. (AC2)
- **E4 Conflict modes:** pre-seed a conflicting target; skip leaves it, suffix creates `-2` with rewritten links to it, overwrite requires the extra confirmation and replaces it. (AC3)
- **E5 Failure handling:** inject a 403 and a 500 -> those rows `failed` with reason, run continues, Retry failed completes the remainder. (AC3)
- **E6 Cancel.** (AC3)
- **E7 Standalone/not-in-EW state:** SDK never resolves -> "not running inside Experience Workspace". (AC4 hello-world pattern)
- **E8 Hostile strings:** document names/content with HTML-like text render as text. (safety)
- **E9 Page loads at its published URL:** `http://localhost:3000/apps/deep-clone/deep-clone.html` served and bootstrapped with the stub. (AC6 partial: proves the entry page is a valid app page)

### 4.2 Manual in EW (needs interactive Adobe login; cannot be automated)

Prerequisites: scaffold complete; Code Sync installed and `https://main--ew-extensions--jazhou-adobe.aem.live/apps/deep-clone/deep-clone.html` returns 200 after merge (hello-world M0); Chrome; sandbox site and seed content (Section 5).

- **M1 (`ref=local`, app opens):** `npm start`; open `https://da.live/app/jazhou-adobe/ew-extensions/apps/deep-clone/deep-clone?ref=local`; accept the trust prompt (first time per `org/repo/ref`); the form appears after ~1 s with org/site prefilled. (AC6, AC1)
- **M2 (plan, `ref=local`):** source = seeded campaign folder; target = a scratch path; Build plan; compare the plan against the seeded tree (every doc/asset/fragment/media, new paths). (AC1)
- **M3 (run and inspect, `ref=local`):** Run; open the cloned landing page in the EW editor and on the `.aem.page` preview: internal links open the clone pages, fragments load from the cloned fragments, images render (also verifies the `./media_` assumption, R8), links to the outside (e.g. the home page) still go to the originals; edit a cloned fragment and confirm the original campaign page is unchanged. (AC2)
- **M4 (conflicts and report):** re-run with `skip` (no changes, all `skipped`), with `suffix` (`-2` clone, links consistent), with `overwrite` (confirmation shown, items replaced); export the report. (AC3)
- **M5 (branch ref):** push branch `deep-clone-spec-test` (no `/` in the name); open the same URL with `?ref=deep-clone-spec-test`; expect the dev-branch note in the trust prompt (first time); repeat M2-M3 quickly on a small source. (AC6)
- **M6 (Apps menu):** add the `apps` sheet row in `https://da.live/config#/jazhou-adobe/ew-extensions/`; confirm the card at `https://da.live/apps#/jazhou-adobe/ew-extensions` and that it opens the app. (AC5)
- **M7 (long run / token refresh):** clone a campaign of several hundred items (generated seed) and watch it complete past the typical IMS token lifetime if feasible; verify 401 handling. [ASSUMPTION about token lifetime and refresh; optional.]
- **M8 (permissions):** with a user who can read but not write the target (or a protected target path), confirm 403 rows and a clear message; with no read on the source, confirm a clear access message. (Needs a restricted test user or ACL config, see Section 6.)
- **M9 (standalone):** open `http://localhost:3000/apps/deep-clone/deep-clone.html` directly; expect the "not inside Experience Workspace" state.

Record screenshots and notes in the PR description (the PR template from #1 requires the branch-ref test URL).

## 5. Fixtures and seed content

Standard fixture campaign tree (used by the fake, the Playwright seed, and mirrored in the DA sandbox for manual/Tier-2 tests):

- `/campaigns/spring-2026/` folder with: `index` page; `offer` page (links to `./index`, `/campaigns/spring-2026/faq#pricing?x=1`, the site home `/`, an external URL, `mailto:`); `faq` page; nested `/details/terms` page; a hero image and a PDF stored in DA under the folder (`content.da.live` form and root-path form); a `.json` sheet containing a source-root path (triggers the warning).
- Outside the folder: `/fragments/promo` (references media in DA and a nested fragment `/fragments/legal`, which references `/fragments/promo` -> cycle), `/fragments/footer-cta` (unticked scenario), `/media/brand.png`, a missing fragment `/fragments/gone` (referenced, 404).
- Link-form variants: `https://main--{repo}--{org}.aem.page/...`, `.aem.live`, a branch-ref origin, `./media_<hash>.png`, a fragment block with link text equal to the URL, one with different text, one text-only fragment path, mixed-case and percent-encoded paths.
- Pre-existing conflict: `/campaigns/spring-2027/offer`.
- Large-listing variant: a generated folder with > one list page of children (configurable page size in the fake; in the sandbox, enough items to cross the real page boundary [OPEN: the real list page size is not documented]).
- Hostile variant: names/content with `<script>` and attribute-injection text.

Real-shape fixtures are produced by authoring the sandbox content in the actual EW editor and exporting via `GET /source`, so the HTML matches what DA really stores (including the `<header>`/`<main>`/`<footer>` wrapper and `da-metadata` rows).

## 6. Sandbox accounts and credentials

- **Hermetic tiers (CI):** none. No secrets, no network.
- **Manual and Tier-2:** (a) a DA org/site the maintainer can write to, with a scratch folder (default plan: `jazhou-adobe/ew-extensions`, subject to hello-world R10); (b) an Adobe IMS identity with edit permission there and config permission for the `apps` sheet; (c) GitHub admin on the repo (Code Sync); (d) for M8, a second identity or an ACL on a protected path that denies writes; (e) for Tier-2 scripted runs, a way to obtain an IMS token outside the browser [OPEN: the only first-party path found is the browser session (`nx-ims`/SDK handshake); owner to say whether a service token or a copy-paste session token is acceptable]. No vendor API keys.
- Tier-2 must refuse to run unless the target path starts with a dedicated sandbox prefix (safety against cloning into production content).

## 7. Acceptance-criteria traceability (ticket #36)

| # | Acceptance criterion (#36) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Admin picks source and target; app shows a clone plan (every document and asset, with new paths) before running | Unit: planner lists every document/asset exactly once with target paths (crawl, paging, dependencies); planner issues zero writes (request log). E2E E1 (plan renders, no `POST`/`copy` before Run) | M2 (plan matches the seeded tree); review: plan table shows source, target, reason, conflict, warnings |
| AC2 | Internal links and fragment references inside cloned content are rewritten to the clones; references outside the cloned set untouched | Unit: rewriter reference-class tables (in-set rewritten, outside untouched, relative links, absolute forms, query/hash, fragments incl. link text, media); planner closure and untick behaviour; integration against the fake: originals byte-identical, clones rewritten. E2E E2, E3 | M3 (open clone in editor and on preview; links/fragments/images resolve to the clone; outside links still go to the original; edit a cloned fragment, original unaffected) |
| AC3 | Naming pattern and conflict behaviour (skip/overwrite/suffix) configurable; per-item report lists results | Unit: path mapper (pattern tokens, normalisation, suffix), conflict handling per mode, executor per-item statuses, retry, cancel, report export. E2E E2, E4, E5, E6 | M4 (skip/suffix/overwrite against real DA; report exported) |
| AC4 | All code in its own self-contained `deep-clone` folder with a README (setup, EW config-sheet row, site config read) | S3 convention check: folder has entry page named after it, README, tests, no cross-extension imports [dependency: #1's check must include the no-cross-import rule; if not, add a one-line rule there; OPEN] | Review: README has setup, the `apps` row (title/description/path/ref), "site config read: none", positioning vs MSM, limits; run the #1 "adding an extension" checklist against it |
| AC5 | Listed in the repo README extensions table and reachable from the EW Apps menu | S3: table row exists for `deep-clone` and resolves to a real folder/entry page; type `app` matches the README's registration row | M6 (card appears on `https://da.live/apps#/{org}/{site}` and opens the app); review: table row has name, folder, entry point, type, description |
| AC6 | Works in EW with `ref=local` and with a branch ref | E9 (entry page boots at its local-server URL with the SDK stub) is necessary but not sufficient | **M1** (`ref=local`), **M5** (branch ref), M9 (standalone); only these prove it in real EW (needs login; cannot run in CI) |
| AC7 | Core logic covered by unit tests; lint and CI green | Unit suite in section 3 (scanner/rewriter, mapper, planner, executor/report, fake contract); `lint`, `unit`, `e2e` CI jobs green on push and PR; coverage report for the engine | Review: CI checks green on the PR; pre-commit hook runs |

Every #36 acceptance criterion maps to at least one automated test or a numbered manual step above. Every #74 acceptance criterion: folder and SPEC.md exist (this file); template + Build Analysis + Testing Requirements present; #36 AC mapping above; external API claims cite URLs and carry [VERIFIED]/[ASSUMPTION]/[OPEN]; no implementation code written.

## 8. Open questions for the owner

1. **Target and naming semantics:** is "target path" the exact root of the clone with the naming pattern applied only to items below it (this spec), or should the pattern name the root too?
2. **External dependency placement:** default `_deps` folder under the target root mirroring original paths, or a sibling `fragments`/`media` layout? Should the default be "clone fragments and media referenced from outside the source root" or "keep them shared and only clone what is inside the source folder"? (Spec default: clone and show unticked-able in the plan.)
3. **Relative links to outside targets:** this spec converts them to root-relative paths of the original (so they keep working after the page moves) and reports them. Acceptable against "left untouched"?
4. **`/copy` for binaries:** acceptable to use the server-side copy plus a `HEAD` check for single binaries given the docs/source drift, or always GET+POST (slower, strictly observable)? Which does the DA team support as a stable contract?
5. **DA Admin facts to confirm with the EW/DA team:** (a) is the code-level behaviour (recursive folder copy; `/{org}/...` destination; 204-on-failure) intended and stable; (b) write rate limits and list page size; (c) will `admin.da.live` remain the write path for hlx6-migrated sites; (d) `x-da-actions` semantics for early permission warnings.
6. **Sandbox:** may the clone tests use `jazhou-adobe/ew-extensions` as the DA site (needs R10 resolved), and what restricted user or ACL can be used for the 403 test? How can Tier-2 obtain a token outside the browser?
7. **Limits:** confirm default item cap (1000), concurrency (5, range 1-10) and retry policy (3 attempts, 429/5xx only).
8. **Sheets:** is verbatim copy plus a warning acceptable, or do you want path rewriting in sheet data in v1?
9. **Coverage gate:** hard CI threshold for the engine (suggest 90%) or report-only?
10. **Convention check (#1):** should the check enforce "no imports across extension folders" (needed to prove AC4 mechanically) and "extension README documents the config-sheet row"?
11. **Publication/policy (carried from #1):** Adobe outside-activity/IP policy and the absence of a public marketplace process remain open for the maintainer; unchanged by this ticket.
12. **Positioning copy:** is "Campaign clone with reference rewriting; use MSM for satellite-site inheritance" the wording you want in the README?
