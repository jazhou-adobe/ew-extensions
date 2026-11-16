# Spec: Extra Translation Connectors: DeepL (connector harness + first vendor)

Ticket: jazhou-adobe/ew-extensions#4 (this spec: #42). Blocked by #1 (repo scaffold, spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template, spec in `shared/worker-template/SPEC.md`). #4 blocks #5 (Phrase TMS) and #6 (XTM Cloud), which will reuse the harness defined here.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/DeepL.

Vocabulary follows #1 and #2: *extension* = one folder `apps/<name>/`; *worker* = the per-extension backend in `apps/<name>/worker/` built from `shared/worker-template/`; *provider* = one vendor under `apps/<extension>/providers/<vendor>/`; *IMS token* = the Adobe IMS access token. Domain terms from the EW docs: *connector* = the module the Translate app loads to talk to a translation service; *Translate app* = the EW localization project UI (`https://da.live/apps/loc`, source `nx/blocks/loc` in `adobe/da-nx`).

---

## Problem Statement

EW authors translate pages in the Translate app. It ships Google Translate (no setup) plus Lionbridge, Smartling and Trados connectors (docs: https://www.aem.live/docs/ew/administering/translation). A site that already pays for **DeepL** cannot use it: there is no DeepL connector, and Adobe's own page says Adobe normally builds connectors itself, while also inviting third-party pull requests (https://www.aem.live/docs/ew/administering/translation-service-connection).

Three things make this harder than "call an API":

1. **No project concept.** Existing vendors (Smartling job+batch, Lionbridge job, GlobalLink submission) hold a project server-side and the connector stores one id. DeepL translates one *document* per request, one target language per request, and forgets it after the first download. The connector has to invent and persist its own "submission" grouping.
2. **Secrets and CORS.** The DeepL key must never reach the browser, and DeepL does not document browser CORS support [ASSUMPTION: not tested; EW's own docs say it routes through a proxy when a vendor lacks CORS]. So a backend is needed (the #2 worker template).
3. **Where connectors run.** The Translate app loads connectors by a *relative dynamic import inside da-nx* (verified below). An extension hosted only from this repo's EDS site cannot be selected by `translation.service.name`. That shapes what "works in EW with `ref=local` and a branch ref" can mean (section Further Notes, Open Question 1).

Later connector tickets (#5 Phrase, #6 XTM) also need a way to prove a connector honours the contract without a vendor account in CI. Today nothing in the repo tests connectors; da-nx's own sample connector (https://github.com/adobe/da-nx/blob/main/nx/blocks/loc/connectors/sample/index.js) exports `connect`, `sendAllLanguages`, `getStatusAll`, `saveItems`, `cancelTranslation` as empty bodies and omits `isConnected` and `dnt`, which the docs (and every real connector) require [VERIFIED, read 2026-11-16].

## Solution

Ship `apps/translation-connectors/` as one extension that contains:

- a **reusable contract test harness** (generic suite + fake clock/fetch/actions + da-nx environment shims + a vendor *backend adapter* interface) that any connector can run against, with a fake vendor API supplied by the adapter;
- the first **provider, DeepL**: a connector laid out so it is a straight copy into `adobe/da-nx` (`nx/blocks/loc/connectors/deepl/`), plus the DeepL routes of this extension's **worker** (key in the platform secret store, IMS-authenticated, CORS-gated), plus a **fake DeepL API** that models DeepL's documented document-translation behaviour (once-only download, status machine, error codes);
- a README with setup, the `translate` config-sheet rows that enable it, a DeepL `translate.json` sample (including Chinese targets), and the extensions-table row.

An author using it sees: set `translation.service.name` to `DeepL` in `.da/translate`, open the Translate app, see the connector connected, optionally pick a **glossary** and **formality** from live dropdowns, start a project, press *Translate all*, press *Get status* until each language is translated, watch results saved into the language folders (including `zh-CN` / `zh-TW`), and optionally cancel a language.

## User Stories

Site administrator:

1. As a site administrator, I want to enable DeepL by setting `translation.service.name` and an `origin` per environment in `.da/translate`, so that no code change is needed to switch from Google.
2. As a site administrator, I want a copy-paste `translate.json` sample for DeepL, so that I can configure languages, environments and conflict behaviour correctly the first time.
3. As a site administrator, I want separate `stage` and `prod` environments (sandbox vs paid account), so that authors can trial a project without spending production quota.
4. As a site administrator, I want my DeepL API key to live only in the worker's secret store, so that it is not in the sheet, the browser, or the repo.
5. As a site administrator, I want to restrict who can spend my DeepL quota, so that "any Adobe user who finds the worker URL" cannot.
6. As a site administrator, I want an unambiguous README of the proxy routes the connector calls, so that Adobe (or I) can host an equivalent proxy later.

Content author:

7. As an author, I want the Translate app to show that DeepL is connected (or why not), so that I do not start a project that cannot be sent.
8. As an author, I want to pick a glossary from a list fetched from DeepL, so that product terms are translated consistently without typing glossary ids.
9. As an author, I want a formality choice (default / more formal / less formal), so that German or Japanese output matches my brand voice.
10. As an author, I want to select several target languages at once, so that one project covers all my markets.
11. As an author, I want `zh-CN` and `zh-TW` (and other regional codes in my config) to translate into the right Chinese script, so that Simplified and Traditional pages are not swapped or rejected.
12. As an author, I want a clear message before anything is uploaded when a language is unsupported or equals the source language, so that I am not billed for a doomed request.
13. As an author, I want *Translate all* to send every selected page for every selected language, so that I do not upload page by page.
14. As an author, I want *Get status* to move each language through "in progress" to "translated", and to say "error" with DeepL's reason when something fails, so that I know what to do next.
15. As an author, I want translated pages saved automatically into the right language folder at the right page, so that page A's German never lands on page B.
16. As an author, I want my page's layout, links and blocks to survive translation unchanged, so that I only review words.
17. As an author, I want do-not-translate content (product names, code, `translate="no"` blocks) left exactly as written, so that I do not fix them by hand in every language.
18. As an author, I want to cancel a language I no longer need, so that nothing further is saved or billed for it.
19. As an author, I want to reload the page or come back tomorrow and still get status and save results, so that translation does not depend on one browser tab staying open.
20. As an author, I want a re-send after a partial failure to upload only what failed, so that I am not billed twice.
21. As an author, I want a plain explanation when DeepL's quota is exhausted, so that I can ask the admin to raise it instead of retrying.

Connector developer (#5, #6 and future vendors):

22. As a connector developer, I want one generic contract suite, so that "implements the EW connector contract" is a command, not a reading exercise.
23. As a connector developer, I want to supply only a small backend adapter (a fake of my vendor and a few fixtures), so that I do not rebuild fake clocks, fake actions and project builders.
24. As a connector developer, I want the suite to run the connector against the real da-nx helper modules (retry, download queue), so that tests prove the behaviour authors get.
25. As a connector developer, I want the suite to be red on da-nx's own empty sample connector and green on a tiny reference connector, so that I can trust it discriminates.
26. As a connector developer, I want capability flags (cancel supported, service options, status granularity), so that project-based vendors like Phrase and XTM are not forced into DeepL's per-document model.
27. As a connector developer, I want a drop-in check against the real da-nx tree, so that "upstreaming is a straight copy" stays true.

Maintainer / reviewer:

28. As the maintainer, I want CI to run the harness, the DeepL tests and the worker tests with no credentials, so that regressions cannot merge.
29. As the maintainer, I want live sandbox checks as an opt-in script with a quota budget, so that real-API facts (HTML `translate="no"`, Chinese codes, once-only download) are verified without CI spending money.
30. As the maintainer, I want the extension folder self-contained with a README, so that it can be moved, upstreamed or deleted without touching other extensions.
31. As a reviewer, I want every acceptance criterion mapped to a test or a numbered manual step, so that review is a checklist.

Security reviewer:

32. As a security reviewer, I want proof that the DeepL key never appears in any response, header, log or browser-visible file, so that "credentials only in the worker" is tested.
33. As a security reviewer, I want proof that every worker route rejects a missing or invalid token and a disallowed origin, so that the worker is not an open proxy.
34. As a security reviewer, I want the worker to forward only an allowlist of upload parameters, so that a caller cannot enable paid DeepL features (quality evaluation, other output formats) or reach other DeepL endpoints.
35. As a security reviewer, I want the connector to refuse to send the IMS token to a non-HTTPS or malformed origin, so that a mistyped config row cannot leak tokens in clear.

## Implementation Decisions

(No file paths or code except contract tables; paths are in the Build Analysis.)

1. **Extension shape.** One extension, `translation-connectors`, with type **connector** (new value for the README extensions table). The type still comes from the registration row, as decided in #1: the "row" for a connector is `translation.service.name` in the site's `.da/translate` sheet (https://www.aem.live/docs/ew/administering/translation-config). It has **no entry page and no `apps`/`library` row**; nothing in it is served to browsers. Consequence for #1's convention check: a `connector` extension needs a README, tests and its connector module instead of an entry page [OPEN: confirm this S3 carve-out; Open Question 2]. Vendors live in `providers/<vendor>/`; this ticket adds `deepl`. #5/#6 add `providers/phrase`, `providers/xtm` to the same extension and reuse the harness.
2. **Connector layout is da-nx-shaped.** The provider folder mirrors `nx/blocks/loc/connectors/<name>/` in da-nx (https://github.com/adobe/da-nx/tree/main/nx/blocks/loc/connectors): an `index.js` entry that exports the connector contract, plus sibling helper modules. It imports **only** da-nx-relative modules that exist upstream (the shared `dnt`, `utils/fetchWithRetry`, `utils/downloadQueue`, `utils/auth`, the queue in `nx2/public/utils/tree` and `nx2/utils/utils`), never anything from this repo outside the provider folder. The connector's import specifiers are written exactly as in da-nx; for tests, the harness resolves them to its vendored copies and shims through the WTR module resolver (a resolver plugin or import-map remap of the resolved URLs). That is necessary because the `../../` imports would otherwise land on `apps/translation-connectors/{dnt,utils}` and the five-level `nx2` imports would resolve outside the repository. The upstream bundle step therefore only relocates files and needs no edits to the connector body. [VERIFIED import specifiers used by the Smartling/Google/GlobalLink connectors: `../../dnt/dnt.js`, `../../utils/fetchWithRetry.js`, `../../utils/downloadQueue.js`, `../../utils/auth.js`, `../../../../../nx2/...`; ASSUMPTION: WTR's resolver can remap them, proven in step 1 spike S2.]
3. **Contract surface** (docs: https://www.aem.live/docs/ew/administering/translation-service-connection; caller: https://github.com/adobe/da-nx/blob/main/nx/blocks/loc/views/translate/index.js and `translate.js`):
   - `isConnected(service)` -> boolean, no throw; called on page load.
   - `connect(service, sendMessage)` -> boolean; on failure calls `sendMessage({ text, type: 'error' })`.
   - `sendAllLanguages({ org, site, title, service, options, langs, langsWithUrls, urls, actions })` creates the submission, uploads, persists, sets per-language `translation.sent` and `translation.status`.
   - `getStatusAll({ service, langs, urls, actions })` refreshes each language's status; one-shot (the UI's *Get status* button is the polling loop).
   - `saveItems({ org, site, service, lang, langIndex, urls, behavior, saveFn, sendMessage })` downloads, strips DNT, calls `saveFn`, returns the urls with `status`.
   - `cancelTranslation({ service, lang, sendMessage })` -> `{ ok }`; optional (UI hides cancel if absent).
   - `serviceOptions` array of `{ key, label, fetch(service) -> [{ value, label }] }`; optional.
   - `dnt = { addDnt }` from the shared da-nx module, like every real connector (the loc block calls `connector.dnt.addDnt` before sending).
   - `saveLangConcurrency` is **not** exported (da-nx default 1 language at a time), so "at most five downloads at once" holds across the whole save [VERIFIED default `connector.saveLangConcurrency ?? 1` in `views/translate/index.js`].
4. **DeepL has no project; the connector defines a *submission*.** `sendAllLanguages` creates a connector-generated `submissionId` (time-based, human-readable, derived from the project title) and, per target language, one DeepL document translation per source page. The grouping lives entirely in persisted project state: per language, `lang.translation` carries the `submissionId` and an `items` map keyed by the page's language-agnostic `daBasePath` (the identifier da-nx documents as "language agnostic identifier for localization services") to `{ documentId, documentKey, state }`. States: `queued`, `translating`, `done`, `error`, `saved`, `lost`. Everything the next session needs is rehydratable from the persisted JSON; no module-level memory is required (a requirement the Google connector's in-memory `results` array does not meet and that the harness tests, case C14). [ASSUMPTION: `lang.translation` objects are the ones persisted by the host's `saveState`/`handleSaveLangs` and may be mutated inside `saveItems`; the code reads that way (`lang.translation.saved` is assigned after `saveItems`), confirm in spike S3.]
5. **Stable identifier mapping (AC2).** The upload response returns a `document_id`/`document_key` pair [VERIFIED: https://developers.deepl.com/api-reference/openapi.yaml `/v2/document`]. The connector records `daBasePath -> documentId` **at upload time, from the response of that very request**, and downloads by that stored id, never by matching filenames or response order. The uploaded `filename` is an ASCII-safe label only.
6. **What is sent.** `url.content` (the HTML the Translate app produced, with DNT markup already applied by the shared `addDnt`) as an `.html` file, unmodified. One upload per (page x target language). Form fields forwarded by the worker: `file`, `filename`, `target_lang`, `source_lang` (when the project has a source language; mandatory when a glossary is used [VERIFIED: https://developers.deepl.com/docs/best-practices/document-translations "Using glossaries with documents"]), `formality`, `glossary_id`. Nothing else. HTML upload limit 5 MB both plans, 500,000 characters per document on free plans, 1,000,000 on paid [VERIFIED: https://developers.deepl.com/docs/resources/usage-limits]; a page over the byte cap is skipped with a message naming the page; character-cap failures come back from DeepL as errors and are surfaced.
7. **Markup and `translate="no"` (AC2).** DeepL documents `translate="no"` for HTML in the *text* API with `tag_handling=html` (https://developers.deepl.com/docs/translate/translating-html) and for XML, XLIFF and DITA *documents* (https://developers.deepl.com/docs/best-practices/document-translations). It does **not** state that the *document* endpoint honours `translate="no"` for `.html` uploads. That is the central vendor risk. [OPEN: verified only by live check L2.] Decision: build against the document endpoint (async, size-friendly, no 128 KiB text-request cap), gate the first provider build on spike S1. If L2 shows `translate="no"` is not honoured for HTML documents, the fallback (built only then) is **connector-side protection**: replace each `translate="no"` element with an opaque placeholder before upload and restore it after download, keyed per document, inside the provider folder. Either way the AC is proven by the same tests (D-DNT cases and live L2).
8. **Language codes (AC4 Chinese).** EW language codes from the `languages` tab (`code` column, e.g. `de`, `fr-FR`, `pt-BR`, `zh-CN`, `zh-TW`) map to DeepL **target** codes through (a) exact case-insensitive match against DeepL's supported document targets fetched from the worker, then (b) a small explicit alias table, then (c) base-language fallback. Aliases that matter: `zh-CN`, `zh-SG`, `zh-Hans` -> `ZH-HANS`; `zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant` -> `ZH-HANT`. **Source** codes are always the base language (`zh-CN` -> `ZH`), as DeepL source codes are base languages [VERIFIED for glossaries: "Source languages are always base languages", https://developers.deepl.com/api-reference/openapi.yaml; ASSUMPTION for document uploads]. The DeepL spec mentions `ZH-HANS` as a translation variant (OpenAPI glossary text) and lists `zh-HANS`/`zh-HANT` in some resource enums, but the authoritative list for `translate_document` is only returned by `GET /v3/languages?resource=translate_document`, which needs a key [ASSUMPTION that `ZH-HANT` is available for documents; verified by live L1]. Unsupported target, or a target whose base language equals the source (DeepL rejects `EN` -> `EN-US` with 400 [VERIFIED: document-translations page]), fails that language **before any upload**. Bare `zh`, `en`, `pt` have no unambiguous variant [OPEN: Open Question 9].
9. **Status model.** DeepL document status values are `queued`, `translating`, `done`, `error`; `error_message` is documented in the schema while the example shows `message`, so the connector reads either; `seconds_remaining` is explicitly unreliable and is not used for decisions [VERIFIED: openapi `/v2/document/{document_id}` and the document-translations page]. A language becomes `translated` only when every one of its documents is `done`/`saved`; any `error`/`lost` document makes it `error` (with per-page messages); otherwise `in progress` with a translated count. Terminal states (`complete`, `cancelled`) are never regressed. Documents already `done`/`saved`/`error` are not re-polled.
10. **Download is once-only; this drives saveItems.** DeepL deletes a document after its first successful download and invalidates its id; a second download returns 404 (and the spec also documents a 503 with message "Document already downloaded") [VERIFIED: openapi `/v2/document/{document_id}/result`; the 404/503 wording is internally inconsistent, so treat both as "gone"]. Characters are billed only after a successful download [VERIFIED: openapi `billed_characters`]. Therefore: (a) a document already `saved` is never downloaded again and counts as success on a retried save; (b) a document that comes back "gone" without a stored `saved` state is marked `lost` and the message tells the author to re-send that language (it will be billed again); (c) the downloaded HTML is held in memory until `saveFn` succeeds and `saveFn` is retried twice in-session before the document is marked `error`; (d) the worker buffers the full result before responding so a worker-to-browser failure is less likely to consume the download. Surviving a page reload *between* DeepL delivering the file and DA saving it is not possible without server-side storage (Out of Scope; Open Question 7).
11. **Cancel.** DeepL exposes no cancel/delete for a document translation (the OpenAPI has exactly three document operations: upload, status, result) [VERIFIED: `/v2/document*` paths in openapi.yaml]. `cancelTranslation` is therefore connector-side: it marks the language `cancelled`, discards stored document keys, and the connector never downloads those documents, so nothing is billed [VERIFIED billing rule above]. Undownloaded documents expire on DeepL's side after "a limited time" (duration not documented) and count against the "too many un-retrieved documents" 429 until then [VERIFIED wording: https://developers.deepl.com/docs/best-practices/document-translations "Error 429"; ASSUMPTION on duration]. This is documented in the README and in the cancel message.
12. **Retries and concurrency (AC3).** Browser side reuses the shared da-nx `fetchWithRetry` for every worker call (retries `429` and `>=500`, exponential backoff from 500 ms capped at 30 s with jitter, honours numeric `Retry-After`; `456`, `400`, `403`, `404` are returned, not retried [VERIFIED source: https://github.com/adobe/da-nx/blob/main/nx/blocks/loc/utils/fetchWithRetry.js; DeepL guidance: https://developers.deepl.com/docs/best-practices/error-handling]). Downloads use the shared `downloadQueue` with its default concurrency of **5** [VERIFIED: `downloadQueue(urls, callback, concurrency = 5)`]. Uploads and status calls use the same queue primitive at a conservative concurrency [ASSUMPTION: 5, tuned in live test L5 because DeepL warns un-downloaded documents and bursts cause 429]. Worker side: the #2 `proxy` helper retries `429` and `5xx` for idempotent routes (status, usage, languages, glossaries) and `429` only for uploads and downloads by default; this is the template's stricter POST policy, and for DeepL it is safe to loosen uploads to `5xx` because an orphaned upload is never billed (billing happens only on download) [OPEN: Open Question 11 on the retry budget split and the amplification of two retry layers]. A `456` (quota) stops the batch: no further uploads are attempted and the language gets a quota-specific error.
13. **Backend = the #2 worker, one route family.** All backend concerns (IMS token validation, CORS, secrets, outbound retry, error contract, request ids, logging) are the #2 contract, unchanged. This extension adds routes under `/translate/deepl/{org}/{site}/...`, mirroring Adobe's own proxy convention (`{DA_TRANSLATE}/translate/<vendor>/{org}/{site}`, seen in the Google and GlobalLink connectors) so that Adobe could host an equivalent proxy and the connector would only need a different `origin`. Route contract (names are the proxy contract, independent of the DeepL wire format):
   | Method + path (under the base) | Purpose | DeepL call |
   |---|---|---|
   | `GET /usage` | connectivity + quota | `GET /v2/usage` |
   | `GET /languages` | supported document source/target languages | `GET /v3/languages?resource=translate_document` |
   | `GET /glossaries` | glossary list with dictionary language pairs | `GET /v3/glossaries` |
   | `POST /documents` (multipart) | upload one HTML document | `POST /v2/document` |
   | `POST /documents/{documentId}/status` (JSON `{documentKey}`) | status | `POST /v2/document/{id}` |
   | `POST /documents/{documentId}/result` (JSON `{documentKey}`) | translated HTML | `POST /v2/document/{id}/result` |
   Responses are camelCase JSON except `result` (raw HTML bytes). The worker validates ids/keys against strict patterns before building the upstream URL, forwards only the field allowlist in Decision 6, accepts `.html` uploads only, enforces a body cap above DeepL's 5 MB HTML limit, and sets `DeepL-Auth-Key` itself from the secret. Upstream bodies are not passed through; DeepL's `message` is mapped to a short fixed set of codes. Browser calls may only use the headers the template allows (`Authorization`, `Content-Type`), so no custom headers are used. Extension-defined error codes (`quota_exceeded`, `document_gone`, `unsupported_language`) are needed beyond the template's fixed list [OPEN: Open Question 8].
14. **Auth and the token.** The connector gets the IMS token the same way GlobalLink does for its DA_TRANSLATE proxy: the shared da-nx `imsAuthHeader()` (https://github.com/adobe/da-nx/blob/main/nx/blocks/loc/utils/auth.js). The DA App SDK is **not** involved: a connector is not an EW app/plugin and has no SDK handshake, so the #1 SDK stub seam does not apply (the equivalent seam is the fake `imsAuthHeader`). The page origin is `https://da.live` (Translate app), already on the worker's allowlist.
15. **Environments and origin.** `translation.service.all.env` lists `stage, prod` (documented). Each environment's `translation.service.{env}.origin` points to a worker deployment: `stage` -> sandbox worker holding a DeepL free/developer key and `https://api-free.deepl.com`; `prod` -> production worker holding the paid key and `https://api.deepl.com`. This selects the DeepL account purely by origin, so the worker needs no environment switch. The connector sends the IMS token only to an `https://` origin (loopback `http` allowed only when the page is on localhost) and builds the base itself from `origin`, org and site; a `?worker=`-style URL override does not exist [aligns with #2 Decision 13; the config-sheet override is the documented existing pattern (`translation.service.{env}.origin`) and is a deliberate, admin-controlled exception; OPEN: Open Question 5].
16. **Live dropdowns (`serviceOptions`).** Two entries: `glossaryId` (live from `GET /glossaries`, first item an explicit "No glossary" with empty value, because the Options step seeds an unknown/unset value with the *first* item [VERIFIED: `loadConnectorServiceOptions` in https://github.com/adobe/da-nx/blob/main/nx/blocks/loc/views/options/options.js]) and `formality` (static list: default, prefer more formal, prefer less formal; the `prefer_*` values fall back to default for languages without formality, so one value is safe for every target [VERIFIED: openapi `Formality`]). A glossary is applied to a language only if one of its dictionaries covers that source/target pair (a document translation with a glossary requires `source_lang` and a matching pair [VERIFIED]); otherwise that language is sent without it and a message says so. v3 multilingual glossaries only [OPEN: Open Question 10].
17. **Who may call the worker (R3 of #2).** Default policy for the worker: the #2 IMS verification plus client-id allowlist. Recommended hardening, decided by the owner: the `authorize` hook additionally checks that the caller can read the `{org}/{site}` named in the route through DA's admin API using the caller's own token, so path claims are backed by real DA permission [ASSUMPTION: DA admin read call and its status semantics; verified in spike S4]. DeepL-side cost control (Cost Control / key-level usage limit) is recommended in the README for paid accounts [VERIFIED availability: https://developers.deepl.com/docs/best-practices/cost-control].
18. **Reusable harness.** Generic suite plus adapter interface (Testing Decisions). The harness is the product for #5/#6; DeepL is its first consumer. The harness uses **verbatim vendored copies** of the small da-nx helpers whose behaviour AC3 depends on (`fetchWithRetry`, `downloadQueue`, the queue in `nx2/public/utils/tree.js`), pinned by upstream commit and checked by hash, and **shims** for modules that need a live EW session (`auth`, `nx2/utils/utils`) and a simplified `dnt` (the plumbing, not Adobe's DNT rules). Files carry da-nx's Apache-2.0 header [VERIFIED on `nx2/scripts/nx.js`, read 2026-11-16; ASSUMPTION: the same header is on the three vendored files and no NOTICE obligation exists beyond it; confirm with the repo licence choice in #1 R9].
19. **Upstream bundle.** A script produces a copy of the provider and its unit test at da-nx's layout with only import-path rewrites, and an advisory CI job drops it into a pinned da-nx checkout to run da-nx's lint and WTR on it. This is how "upstreaming can be a straight copy" is checked rather than claimed.
20. **Tooling.** Per #1/#2 decisions: ESLint 8 + helix config, Stylelint 16 (no CSS here), `@web/test-runner` for browser-side tests (connector, harness, in-process integration), `node:test` for worker tests (they must set `Origin`, forbidden in browsers), Playwright for the hermetic end-to-end tier, Node 22, husky. No new test runner.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: what a connector function returns, which messages it sends, how project state (`langs`, `urls`, `service`) changes, what requests reach the vendor/backend (count, parameters, concurrency), and what the browser ever receives. Never assert on helper names, internal module structure or call counts of internal functions. Two negative properties are tested across every path: "no vendor secret anywhere" and "no request reaches the vendor without a verified IMS token". All delays use a fake clock.

**Proposed seams** (recorded instead of asked, per #42). Existing seams preferred; the ideal count is one per concern.

| # | Seam | Status | Used by | What is faked |
|---|---|---|---|---|
| T1 (primary, highest) | **The connector contract surface**: the exported functions called with da-nx-shaped arguments, all I/O at `window.fetch`, state as plain JSON | new, generic | WTR browser tests: the generic contract suite for every connector, plus DeepL-specific cases | the vendor backend (adapter-supplied), IMS (`imsAuthHeader`), `saveFn`/`sendMessage`/`saveState`, clock |
| T2 | **The worker HTTP boundary** `worker.fetch(request, env, ctx)` for the DeepL routes | reused from #2 seam W1 | `node:test` worker tests | fake IMS key server and token factory (#2 test kit), **fake DeepL** at the injected `fetch` |
| T3 | **Full stack over real HTTP**: connector page on `localhost:3000` -> real worker (`wrangler dev`) -> fake DeepL server | reused from #1 S1 / #2 W2 | Playwright hermetic tier | fake DeepL process, fake IMS key server, stub token |
| T4 | **Repo convention check** | reused from #1 S3, extended | CI lint job | filesystem fixtures |
| L | **Real DeepL** (sandbox key) through the deployed stage worker | manual/opt-in, not CI | live script L*, manual EW steps M* | none |

Two fakes and how they relate: the **fake DeepL** (a pure model: document store, status progression, once-only download, scripted `429/5xx/456`, strict wire validation of auth header, multipart fields, language codes) is the vendor fake. It is wired in three ways without being rewritten: as injected `fetch` under the worker (T2), as an HTTP server (T3), and as the vendor end of an **in-process backend** for T1 in which the *real* worker code runs inside the browser test next to the connector, so the connector is tested against the actual proxy contract rather than a hand-written imitation [ASSUMPTION: the worker core (Fetch API, `crypto.subtle`, `jose`) runs in Chromium under WTR; validated by spike S2; fallback is an adapter-written fake of the proxy contract, with T3 covering the real worker]. For a future vendor, the adapter supplies only that vendor's fake and its `service` config.

**Harness API (behavioural, no code).** A *backend adapter* provides: a name; a factory returning `{ fetch, controls }` where `fetch` is what the connector's `window.fetch` becomes and `controls` can script failures (`failNext(route, status, count, headers)`), advance remote state (finish a document), inspect recorded vendor-side requests, and enforce vendor concurrency; a `service` config builder; sample pages including a `translate="no"` fragment and a deterministic marker so tests can tell whose translation is whose; and capability flags (`cancel`, `serviceOptions`, `granularity: file | language | job`, `download: once | repeatable`, `idempotentResend`). The suite derives every generic case from those; capability flags skip cases that do not apply (H4).

**Modules tested:** harness self-checks; generic contract cases; DeepL connector (language mapping, upload form, persisted state, status aggregation, save with once-only download, cancel, service options, connection, origin handling, size guard, static no-secret check); DeepL worker routes (auth, CORS, allowlists, error mapping, retry policy, buffering, redaction); fake DeepL (it is test infrastructure and gets self-tests so it cannot drift from the documented behaviour it claims to model); in-process integration; hermetic e2e; upstream drop-in; convention check.

**Prior art.**
- Da-nx connector tests: WTR + `@esm-bundle/chai` + `sinon`, `window.fetch` replaced by a recording stub, sinon fake clock ticked in poll-interval steps (https://github.com/adobe/da-nx/blob/main/test/loc/connectors/smartling/index.test.js). Our T1 formalises exactly this pattern and generalises it.
- #1 S1/S2 (SDK stub, WTR import-map remap, fetch guard) and #2 W1/W2 (`worker.fetch` seam, test kit, wrangler smoke), reused as-is.
- Upstream `adobe-rnd/ew-extensions` has no connector or worker code [VERIFIED via the repo tree API 2026-11-16: 137 paths, containing `blocks/skills`, `tools/block-editor`, `tools/brand-visibility`-related tests, Playwright e2e and unit tests; no `connectors`, `worker` or `wrangler` paths], so there is no prior art for a connector harness there.

## Out of Scope

- Any other vendor (Phrase, XTM, Smartling etc.); only the harness capabilities they will need (capability flags) are designed here.
- DeepL features beyond document translation with glossary and formality: text API, Write, Voice, style rules/profiles, translation memories, custom instructions, quality evaluation, watermarks, non-HTML formats, regional endpoints (`api-us`/`api-jp`, require a signed addendum [VERIFIED: https://developers.deepl.com/docs/getting-started/regional-endpoints]).
- Creating or editing glossaries (listing and applying only).
- Server-side storage of translations (Workers KV/R2/D1) to survive a reload between DeepL download and DA save; the #2 template excludes storage.
- Adobe-hosted proxy (`translate.da.live`) work and the Adobe CLA/IP process for a da-nx PR; only the structure that makes a later PR a copy is in scope.
- CI-driven worker deploy and credentials in CI (as #2).
- Automatic status polling timers in the connector (the UI's *Get status* owns polling).
- Per-site DeepL credentials stored in the `translate-keys.json` credential sheet (the existing connectors' model); this extension uses one key per deployed worker (Decision 15; Open Question 4).
- A custom connector UI or an EW app/library plugin.

## Further Notes

1. **The host-platform finding that shapes the whole ticket.** The Translate app picks the connector with `import(`../../connectors/${serviceName}/index.js`)` where `serviceName = service.name.toLowerCase().replaceAll(' ', '-')` [VERIFIED: https://github.com/adobe/da-nx/blob/main/nx/blocks/loc/views/translate/index.js `setupConnector`; the Options step does the same in `views/options/options.js`]. The path is relative to da-nx's own code origin. A connector served from `https://{ref}--ew-extensions--jazhou-adobe.aem.live` is never loaded. Hence: (a) `ref=local` for a connector means running da-nx locally with the connector present in its tree and opening the Translate app with `?nx=local` (da-nx README: https://github.com/adobe/da-nx#readme; the consuming app URL form is `https://main--{site}--{org}.aem.live/apps/loc?nx=local`, and the docs' Translate app is `https://da.live/apps/loc`); (b) a *branch ref* needs a da-nx branch the code bus can serve, which only maintainers of `adobe/da-nx` can create [ASSUMPTION: Code Sync mirrors only the branches of the installed repo; and how `nx=<branch>` resolves is not documented, so it is unverified]. These are the interpretations used for AC9 and AC8 below; the owner must confirm (Open Question 1). Without Adobe merging the connector, "reachable from its host platform" is only true for a developer running a local da-nx.
2. **Docs vs source drift.** The docs list four connectors (Google, Lionbridge, Smartling, Trados); the repo also contains `glaas` and `globallink` [VERIFIED directory listing]. The docs' list of required methods omits the `dnt` export that every connector has and that the loc block calls; this spec treats `dnt` as required.
3. **Existing proxy pattern.** GlobalLink already sends the IMS token as `Authorization` to a DA_TRANSLATE proxy and keeps the vendor credential in a separate header held server-side [VERIFIED: https://github.com/adobe/da-nx/blob/main/nx/blocks/loc/connectors/globallink/index.js]. This DeepL design is the same trust model with a vendor-specific worker we host ourselves.
4. **DeepL account landscape changed.** DeepL's help centre now says API Free "can no longer be purchased" and describes a **Developer** plan (free, total 1,000,000 characters, "will not reset") and paid Growth/Pro; data deletion-after-translation is listed as a paid-plan benefit [VERIFIED: https://support.deepl.com/hc/en-us/articles/360021200939-DeepL-API-plans, read 2026-11-16]. Whether a new Developer key uses `api-free.deepl.com` is not stated [ASSUMPTION: DeepL's quickstart says free plans use `api-free`, https://developers.deepl.com/docs/getting-started/quickstart]. **The sandbox must not be fed real customer content** (free-plan data handling is weaker than paid) [ASSUMPTION on the exact policy; the help article only lists deletion as a paid benefit].
5. **No true DeepL sandbox.** DeepL documents no separate test environment; the "sandbox" for AC4 is a free/developer-plan key (real translations, small quota). Document formats billed by exact characters for HTML, so a live test page of a few hundred characters per language is cheap [VERIFIED: document-translations "Billing minimums"].
6. **Prior-art observation worth reusing in the README.** da-nx connectors persist vendor ids in project state (Smartling `options.service.jobUid`, GlobalLink `documentIds` map, Lionbridge `requestIds` per url merged by `mergeProjectUrls`); this design stores them in `lang.translation` because `saveItems` receives no `saveState` action but does receive the persisted `lang` [VERIFIED call signature in `saveLang`].

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace
 └─ Translate app (da-nx nx/blocks/loc)  page origin https://da.live
      │  dynamic import  connectors/deepl/index.js          <- must be inside da-nx (Further Notes 1)
      │  Authorization: Bearer <IMS token> via imsAuthHeader()
      ▼  fetch  {origin}/translate/deepl/{org}/{site}/...       (cross-origin: preflight)
   Cloudflare Worker   apps/translation-connectors/worker  (+ routes from providers/deepl/worker)
      1 origin gate + preflight  2 IMS token check  3 route + field allowlists  4 proxy(secret DEEPL_AUTH_KEY, retries)
      ▼
   DeepL API   https://api-free.deepl.com (stage worker)  |  https://api.deepl.com (prod worker)
```

| Concern | Connector (browser, da-nx code) | Worker (private, secrets) |
|---|---|---|
| DeepL key | never | only place (secret store) |
| User identity | gets IMS token from `imsAuthHeader()`, sends it | verifies it (#2) |
| Submission grouping, persisted state, idempotent resend | all | none (stateless) |
| Language-code mapping and pre-flight checks | all | validates the final `target_lang` shape |
| HTML in/out, DNT add/remove | calls shared `addDnt`/`removeDnt` | never parses content, only buffers and forwards |
| Retries | da-nx `fetchWithRetry` (429/5xx), download queue (5) | #2 `proxy` (policy per route) |
| Quota, cost | shows messages | `/usage`, error mapping |

Both da-nx callers (`views/translate`, `views/options`) are unchanged; the connector slots into the existing contract.

## 2. EW integration points

- **Type and registration:** type `connector`; registered by `translation.service.name = DeepL` (case-insensitive; spaces become hyphens, so the folder name is `deepl`) in `{org}/{site}/.da/translate`, tab `config` [VERIFIED: https://www.aem.live/docs/ew/administering/translation-config]. No `apps` or `library` sheet row.
- **Config keys read** (all under `translation.service.{env}.`): `origin` (worker base, required), `link` (reference URL shown to authors, optional). Project options read at send time: `source.language` (`code`), `translation.service.custom.*` is not used. Service options saved by the Options step: `glossaryId`, `formality`. Keys the connector must **not** read: any DeepL credential (none exist in the sheet).
- **SDK actions:** none. A connector is not an app/plugin; there is no DA App SDK handshake [VERIFIED: the connector contract in the docs has no SDK; the IMS header helper is a da-nx util].
- **Host calls into the connector:** `setupService` (sets `service.org`/`service.site`, calls `isConnected`), `handleConnect` (`connect`), `fetchUrls` (calls `connector.dnt.addDnt`), `handleSendAll` (`sendAllLanguages`), `handleGetStatus` (`getStatusAll` then auto-save of `translated` languages via `saveItems`), `cancelLang` (`cancelTranslation`), Options step (`serviceOptions`). All [VERIFIED in `views/translate/translate.js` / `index.js` and `views/options/options.js`, read 2026-11-16].
- **`ref=local` loop (reinterpreted):** terminal A: da-nx clone `npm run local`; connector present in `nx/blocks/loc/connectors/deepl/` (symlink or the upstream-bundle copy); terminal B: nothing needed for the worker because HTTPS `da.live` calling `http://localhost:8787` is blocked/prompted by Chrome local-network rules [ASSUMPTION, per #2 R11]; the loop uses the **deployed stage worker**. Open `https://da.live/apps/loc?nx=local` [ASSUMPTION that `da.live/apps/loc` honours `?nx=local`; the README documents it for consuming EDS apps].
- **Branch-ref:** see Further Notes 1. The extension's own worker is not branch-sensitive (origin from config).

## 3. External APIs and auth flows

| API | Use | Auth | Primary source |
|---|---|---|---|
| DeepL `POST /v2/document` | upload one document, get `document_id` + `document_key` | header `Authorization: DeepL-Auth-Key <key>`; `multipart/form-data` | https://developers.deepl.com/api-reference/openapi.yaml (v3.16.0 read) ; https://developers.deepl.com/api-reference/document/upload-and-translate-a-document |
| DeepL `POST /v2/document/{id}` | status `queued/translating/done/error`, `seconds_remaining`, `billed_characters`, `error_message` | same + `document_key` in body (JSON or form) | same spec |
| DeepL `POST /v2/document/{id}/result` | download once; deleted after success; `404` gone, `503` not ready/already downloaded | same + `document_key` | same spec |
| DeepL `GET /v2/usage` | connectivity, `character_count`, `character_limit` | same | same spec |
| DeepL `GET /v3/languages?resource=translate_document` | supported source/target + features (`formality`, `glossary`) | same | same spec |
| DeepL `GET /v3/glossaries` | list v3 glossaries and their dictionary pairs | same | same spec |
| Hosts | Pro `https://api.deepl.com`, Free `https://api-free.deepl.com` | n/a | https://developers.deepl.com/docs/getting-started/quickstart |
| Error semantics | `429`/`529` retry; `456` no retry; `5xx` retry; `X-Trace-ID` header to log | n/a | https://developers.deepl.com/docs/best-practices/error-handling |
| Limits | HTML 5 MB; 500k chars (free) / 1M (paid); non-doc request 128 KiB | n/a | https://developers.deepl.com/docs/resources/usage-limits |
| Billing and doc rules | HTML billed by exact characters (no 50k minimum); one language pair per upload; same-language rejected | n/a | https://developers.deepl.com/docs/best-practices/document-translations |
| `Retry-After` | delta-seconds or HTTP-date | n/a | https://www.rfc-editor.org/rfc/rfc9110.html |

**Flows.** Caller to worker: IMS token (as in #2). Worker to DeepL: key injected by the proxy helper by secret *name*; caller token never forwarded. Browser to worker for results: raw HTML bytes with `Content-Type: text/html`.

## 4. Data contracts

**Persisted project state (behavioural contract, JSON-serialisable):**

| Where | Field | Meaning |
|---|---|---|
| `lang.translation` | `submissionId` | connector-generated group id for this send of this language |
| `lang.translation` | `sent` | pages accepted by DeepL for this language |
| `lang.translation` | `status` | `created`, `in progress`, `translated`, `error`, `cancelled`, `complete` (host-set) |
| `lang.translation` | `translated` | pages `done` or `saved` |
| `lang.translation.items[daBasePath]` | `documentId`, `documentKey`, `state` | DeepL handle and per-page state (`queued`, `translating`, `done`, `error`, `saved`, `lost`) and last error message |
| `service` | `glossaryId`, `formality`, `origin` | from the Options step / sheet |

`documentKey` is stored in project JSON; it is not the account credential (DeepL still requires the auth key on every call) [VERIFIED: key "must be provided with every subsequent request", openapi `/v2/document` response description]. [ASSUMPTION: the persisted project file is readable by site editors only.]

**Proxy contract:** Decision 13 table. Request/response shapes:
- `POST /documents`: form fields `file`, `filename`, `targetLang`, optional `sourceLang`, `formality`, `glossaryId`; reply `{ documentId, documentKey }`.
- `POST /documents/{id}/status`: reply `{ documentId, status, secondsRemaining?, billedCharacters?, errorMessage? }`.
- `POST /documents/{id}/result`: reply raw HTML; errors use the #2 error contract plus extension codes.
- `GET /languages`: `[{ lang, name, usableAsSource, usableAsTarget, features }]` (camelCased subset). `GET /glossaries`: `[{ glossaryId, name, dictionaries: [{ sourceLang, targetLang, entryCount }] }]`. `GET /usage`: `{ characterCount, characterLimit }`.
- Worker config (non-secret `vars`): `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS` (per #2) plus `DEEPL_API_ORIGIN`, optional `ALLOWED_SITES`. Secret: `DEEPL_AUTH_KEY`.

**Site config sample (README deliverable, AC6):** the `config` tab of `translate.json` with the general keys the existing samples carry (conflict behaviours, `translation.service.name = DeepL`, `translation.service.all.env = stage, prod`, `translation.service.{env}.origin` per environment pointing at the stage/prod worker, optional `translation.service.{env}.link`) and a `languages` tab with at least `de`, `fr`, `ja`, `zh-CN`, `zh-TW` rows (name, code, location, actions `Skip, Translate`). It uses no credential keys. Structure copied from Adobe's samples (https://www.aem.live/docs/ew/administering/translation-config-samples and the download pattern `.../translation-config-samples/*.json`; the Google sample inside da-nx `connectors/google/translate.json` shows the sheet JSON shape).

## 5. Folder layout (proposed; fits #1 and #2)

```
apps/translation-connectors/
├─ SPEC.md, README.md                  setup, config rows, sample translate.json, proxy contract, upstream/dev loops, limits
├─ harness/                            reusable: contract suite, backend-adapter interface, fake clock/fetch/actions, project builders,
│   ├─ vendor/da-nx/                   verbatim fetchWithRetry, downloadQueue, tree Queue (pinned commit + hash file)
│   ├─ shims/                          auth, nx2 utils, simplified dnt (da-nx-relative resolution)
│   ├─ reference/                      tiny in-memory reference connector + adapter (proves the suite is green on a good connector)
│   └─ test/                           harness self-tests (H*)
├─ providers/deepl/                    drop-in layout for nx/blocks/loc/connectors/deepl/
│   ├─ index.js (+ helpers)            connector
│   ├─ worker/                         DeepL routes registered by the extension worker (per #2 Decision 3)
│   ├─ fake/                           fake DeepL model + http server + fetch adapter + in-process backend
│   └─ test/                           contract.test.js (uses harness), deepl.test.js, worker tests, integration, e2e specs
├─ worker/                             extension worker (scaffold from shared/worker-template): wrangler config, entry, .dev.vars.example
├─ scripts/                            upstream bundle + drop-in check, live-test runner
shared/worker-template/                #2 (unchanged)
```

`providers/phrase/`, `providers/xtm/` (#5, #6) are added beside `deepl` and call the same harness. Everything but the connector's README is hidden from the code bus (`.hlxignore`, per #1/#2); the connector module itself is harmless to publish [ASSUMPTION; nothing consumes it from EDS].

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Host reachability.** Translate app only loads connectors from inside da-nx; AC4/8/9 cannot be fully met from this repo alone. | High, blocks AC4 (production), AC8, AC9 (branch) | Local-da-nx loop for AC4/AC9-local; upstream PR for reachability; owner decides (Open Question 1). |
| R2 | **`translate="no"` not honoured by DeepL's *document* API for `.html`** (only documented for text API, XML, XLIFF, DITA). | High for AC2 | Spike S1 first; connector-side placeholder fallback pre-designed (Decision 7). |
| R3 | **Once-only download loses a translation** if DA save fails or the page closes after DeepL delivers; a re-send is billed again. | Medium-High | In-session retry + memory hold + buffered worker result; persisted `saved`/`lost` states; documented; storage deferred (Open Question 7). |
| R4 | **Chinese target codes for documents** (`ZH-HANS`/`ZH-HANT`) not confirmed for `translate_document`; bare `zh`/`en`/`pt` ambiguity. | Medium | Alias table + runtime list check; live L1/L3; Open Question 9. |
| R5 | **Account/sandbox availability**: API Free not purchasable; Developer plan 1M chars total non-resetting; free-plan data handling weaker. | Medium | Owner supplies a key; tiny fixtures; never real customer content in stage (README warns). |
| R6 | **Quota abuse**: one shared key; any IMS-authenticated caller who knows the worker URL. | High if worker URL leaks | client-id allowlist (#2), recommended DA-permission `authorize` check (S4), DeepL cost control / key limit; Open Question 4. |
| R7 | **Two retry layers amplify** (browser up to 5 retries x worker up to 3). | Low-Medium | Split budget (Decision 12), measured in L5; tune. |
| R8 | **Template gaps**: multipart upload with replayable buffered body and a body cap above the default, buffered (non-streamed) response, per-route retry/idempotency flags, extension-defined error codes. | Medium, blocks worker step | Confirm with #2 (Open Question 8); worker test cases UP7-style for multipart replay. |
| R9 | **Persistence assumption** (`lang.translation` persisted/mutated from `saveItems`; `items` map size for N x M documents). | Medium | Spike S3 against a local da-nx; fallback: `url.requestIds`-style per-url storage with `mergeUrls`. |
| R10 | **da-nx drift**: helpers or contract change; vendored copies go stale. | Medium | Hash check (H2), advisory drop-in job against da-nx `main`, pinned commit recorded. |
| R11 | **Upload burst -> 429** ("too many un-retrieved documents"); unknown concurrency limit. | Medium | Conservative concurrency, `Retry-After`, live L5; cancel leaves documents un-retrieved until DeepL expires them (duration undocumented). |
| R12 | **Adobe outside-activity/IP policy** for a vendor connector, a personal Cloudflare account holding Adobe IMS-validated infrastructure, and a possible da-nx PR (CLA). | High for publishing | Carried from #1 R1 and #2 R1; owner decision. |
| R13 | **Content privacy**: page HTML (possibly unpublished) is sent to DeepL via our worker. | Medium | README states it; paid plan for production; sandbox only test content. |
| R14 | **DeepL status/response inconsistencies** (`error_message` vs `message`; `seconds_remaining` unreliable; 404 vs 503 for "already downloaded"). | Low | Tolerant parsing; fake DeepL models both; live L4/L7. |
| R15 | **`document_key` stored in DA project JSON.** | Low | Not a credential on its own; documented; cleared on cancel/`saved`. |

## 7. Ordered build plan (sized to #4's acceptance criteria)

0. **Owner prerequisites:** #1 and #2 implemented (tooling, CI, worker template, hello worker deployed once); Open Questions 1-4 answered; a DeepL key for stage and a Cloudflare account; a local da-nx clone available. Decide the S3 carve-out (Open Question 2) before step 8.
1. **Spikes (time-boxed; results written into the extension README and, where they change a decision, back into this spec):**
   - **S1** (live DeepL): HTML upload with `translate="no"`; `ZH-HANS`/`ZH-HANT` and the languages list; once-only download error shape; `error` status shape; character billing visible in `/v2/usage`. Decides Decision 7 fallback and the alias table. Gates step 5.
   - **S2**: under WTR in Chromium, (a) can a resolver remap the da-nx-relative imports (`../../utils/...`, five-level `nx2/...`) to the vendored copies and shims, and (b) does the real worker core run (jose, `crypto.subtle`, no Node globals)? (a) is mandatory; (b) decides the in-process backend vs an adapter-written fake of the proxy contract.
   - **S3**: in a local da-nx, confirm `lang.translation` mutations in `saveItems` persist, and the load path for `?nx=local` and a connector symlink.
   - **S4**: DA admin read as the caller (for the optional `authorize` check): URL, status codes.
2. **Fake DeepL** (pure model, self-tests F1-F8) and its three wirings (fetch, HTTP server, in-process backend). AC5 foundation.
3. **Harness**: da-nx vendoring + hash check, shims, fake clock/fetch/actions, builders, adapter interface, generic contract suite C1-C16, reference connector, H1-H5. Prove red on da-nx's sample stub, green on the reference. AC5.
4. **DeepL worker routes**, test-first (W1-W20) on the #2 template: route table, field allowlists, id/key patterns, error mapping, retry policy, buffering, redaction; extension worker entry and config; `.dev.vars.example`. AC10 (server side), AC3 (worker half).
5. **DeepL connector**, test-first: contract suite green first (C*), then provider cases D1-D14 (language mapping, upload form, state, status, save/once-only, cancel, options, connect, origin, size guard, no-secret static check). AC1, AC2, AC3 (browser half), AC4 (offline), AC10 (browser side), AC11 (unit).
6. **In-process integration** (I1-I6) and **hermetic e2e** (E1-E4; reuses #2's worker `webServer`). AC4 (offline full round trip incl. `zh-CN`/`zh-TW`), AC10.
7. **Upstream bundle and drop-in check** (U1-U3). AC7 (self-contained and copyable), supports AC8.
8. **README, extensions-table row, convention check change** (S3 carve-out for `connector`), CI jobs, `.hlxignore` entries. AC6, AC7, AC8 (table), AC11.
9. **Deploy stage worker; run live L1-L8 and manual EW M0-M9** with a real Adobe login and a DeepL key; record results and observed `Origin` in the PR/README. AC4 (real), AC9, AC10 (deployed), AC8 (reachability as decided).
10. **Hand-off for #5/#6:** harness README (adapter interface, capability flags, how to add a provider), worker route conventions, the persisted-state pattern, known da-nx gaps.

---

# Testing Requirements

Runners: `@web/test-runner` (Chromium, WTR config from #1 extended with da-nx-relative resolution for the harness shims) for T1; `node:test` for T2 (as #2); Playwright Chromium for T3; a Node script for T4. A fetch guard fails any test that reaches a real external host. Fake clock (sinon) in every timing test; ticking in poll-interval steps as da-nx's tests do.

## 1. Fixtures and mocks

- **Pages:** `html-basic` (headings, link, image), `html-dnt` (a `<p translate="no">`, a `<code>` and a `<span translate="no">` term inside translatable text), `html-big` (just under and just over 5 MB, generated), `html-nonascii` (path with spaces/CJK), 12 pages for concurrency. Each contains a unique marker so the fake DeepL's deterministic "translation" (prefixes translatable text with the target code, leaves `translate="no"` content untouched) makes ownership checkable.
- **Languages:** `de`, `fr-FR`, `ja`, `pt-BR`, `zh-CN`, `zh-TW`, `en-GB` (same-language trap against `en` source), `xx` (unsupported).
- **Fake DeepL** (`providers/deepl/fake`): strict about `Authorization: DeepL-Auth-Key <canary>`, multipart fields and `target_lang` validity; status machine advanced by `controls`; once-only result (second download `404`, plus the documented `503 Document already downloaded` as a switchable mode); scripted `429` (with `Retry-After`), `5xx`, `456`; HTML cap; same-language `400`; records every request and the maximum number of in-flight requests; error body shapes both `message` and `error_message`.
- **Backend adapters:** DeepL in-process backend (real worker + fake DeepL + fake IMS), reference vendor backend (harness).
- **Doubles:** `imsAuthHeader` returns a test-signed token; `saveFn`, `sendMessage`, `saveState` record calls; canary secret `canary-deepl-<random>`.

## 2. Harness self-tests (T1 infrastructure)

| ID | Behaviour asserted |
|---|---|
| H1 | Scripted fetch router replays status sequences and delays; recorder captures method, URL, body; fake clock drives `fetchWithRetry` delays |
| H2 | Vendored da-nx files match the recorded hashes; a deliberately edited copy fails the check naming the file and pinned commit |
| H3 | **Discrimination:** the generic suite is red on da-nx's `sample` connector as published (missing `isConnected`/`dnt`, empty bodies) and green on the reference connector |
| H4 | Capability flags: no `cancelTranslation` -> cancel cases are skipped (not failed); `download: repeatable` skips once-only cases; `granularity: job` changes status expectations |
| H5 | An adapter missing a required hook fails with an error naming the missing hook |

## 3. Generic contract suite (T1; runs for every provider; DeepL is the first)

| ID | Behaviour asserted | Proves |
|---|---|---|
| C1 | `isConnected`, `connect`, `sendAllLanguages`, `getStatusAll`, `saveItems` are functions; `dnt.addDnt` exists; `cancelTranslation` and `serviceOptions` (each `{key,label,fetch}`) are well-formed when present | AC1 |
| C2 | `isConnected` true on a healthy backend, false (no throw) on 401, 5xx and network failure; `connect` mirrors it and, on failure, sends one `{ type: 'error' }` message | AC1 |
| C3 | `sendAllLanguages` happy path: vendor receives every page for every language exactly once; the content equals `url.content` byte for byte; `translation.sent` equals the page count; status `created`; `saveState` called | AC1, AC2 |
| C4 | One page rejected by the vendor: message names the page, language `error`, no unhandled rejection; a second send uploads only the failed page (when `idempotentResend`) | AC1 (robustness) |
| C5 | `getStatusAll`: non-terminal while vendor is working; reaches `translated` when finished; vendor error -> `error`; `complete`/`cancelled` are not regressed; finished items are not re-polled | AC1, AC4 |
| C6 | `saveItems`: `saveFn` once per page with `sourceContent` set (DNT markup removed), `destination` untouched; `saveFn` failure -> that page `status: 'error'` and message; returns the pages | AC1 |
| C7 | **Identity mapping:** vendor returns finished items in shuffled order; every page's destination receives its own translation (marker check), never a neighbour's | AC2 |
| C8 | **Concurrency:** during `saveItems` with 12 pages, the maximum in-flight vendor downloads is exactly 5 | AC3 |
| C9 | **Retries:** `429, 429, 200` succeeds; delays strictly grow and respect `Retry-After`; persistent `5xx` ends as a reported error, not a crash; `400/403/404/456` are not retried | AC3 |
| C10 | `cancelTranslation`: language `cancelled`, `{ ok: true }`, idempotent, no download afterwards, `getStatusAll` leaves it cancelled; no-op message when nothing was sent | AC1 |
| C11 | `serviceOptions.fetch` returns `[{value,label}]`, resolves `[]` (no throw) when the backend is down; an optional option's first item is the explicit "none" | AC1 |
| C12 | **No secret leakage:** the vendor canary never appears in any request the connector makes, any message, any console output; backend requests carry only the IMS stub in `Authorization` | AC10 |
| C13 | **Rehydration:** after a JSON round trip of `langs`/`service`/`urls` (simulated reload) status and save still work; no reliance on module memory | AC4, story 19 |
| C14 | **DNT round trip:** `translate="no"` fragment is sent verbatim; vendor leaves it unchanged; saved content has no `translate="no"` attribute left but identical text; markup (tags, attributes, link targets) is otherwise byte-preserved | AC2 |
| C15 | Messages are `{ text, type? }` only; no thrown error escapes any exported function on vendor failure | AC1 |
| C16 | Language handling: a language the vendor cannot serve fails that language with a message and **zero** uploads for it, other languages proceed | AC4 |

## 4. DeepL connector cases (T1, provider-specific)

| ID | Behaviour asserted | Proves |
|---|---|---|
| D1 | Language mapping, table-driven through `sendAllLanguages` and inspecting the `target_lang`/`source_lang` the fake DeepL receives: `zh-CN`, `zh-Hans`, `zh-SG` -> `ZH-HANS`; `zh-TW`, `zh-HK`, `zh-Hant` -> `ZH-HANT`; `pt-BR` -> `PT-BR`; `fr-FR` -> `FR`; `en-GB` stays `EN-GB`; case and `_`/`-` tolerant; source `zh-CN` -> `ZH` | AC4 (zh) |
| D2 | Same-language (`en` -> `en-GB`) and unsupported (`xx`) targets fail pre-flight with a message and **no** upload request | AC4, story 12 |
| D3 | Upload form carries exactly `file` (HTML), `filename`, `target_lang`, `source_lang`, `formality` and `glossary_id` when configured; no other field; `source_lang` present whenever a glossary is sent | AC2, AC10 |
| D4 | Persisted state after send: `submissionId`, `items[daBasePath] = { documentId, documentKey, state }` for each page/language; JSON-serialisable; a second send does not upload items already holding a live document | AC2, story 20 |
| D5 | Status aggregation: mixes of `queued/translating/done/error` yield `in progress` with counts, `translated`, or `error` with per-page messages; both `error_message` and `message` are read; `seconds_remaining` of `2^27` is ignored | AC4 |
| D6 | **Once-only download:** after a successful save the second `saveItems` downloads nothing and counts those pages as success; a "gone" (`404` or `503 already downloaded`) for an unsaved page marks `lost` with a re-send message; no retry storm | AC3, AC4 |
| D7 | `saveFn` fails twice then succeeds -> the page is saved without re-downloading; fails three times -> `error`, content not lost within the session | AC4 |
| D8 | `456` on upload stops the batch (no further uploads), language `error` with a quota message, no retry; `456` on status/download is surfaced the same way | AC3 |
| D9 | Cancel never calls the result endpoint, clears stored keys, marks `cancelled`; message explains DeepL documents expire | AC1 |
| D10 | `serviceOptions`: `glossaryId` items start with "No glossary" (empty value), labels list language pairs; `formality` has the three values; fetch failure -> `[]`; a glossary without a dictionary for a language's pair is skipped for that language with a message | AC1 |
| D11 | `connect`/`isConnected` use the `usage` route; worker `401` yields a distinct "not signed in" message; unreachable worker -> false | AC1, AC10 |
| D12 | Origin handling: missing `origin` -> error message, no request; `http://` (non-loopback) refuses to send any request with a token; base URL is `{origin}/translate/deepl/{org}/{site}`; a URL query override has no effect | AC10 |
| D13 | A page over 5 MB is skipped with a message naming it and never uploaded; one just under is uploaded | AC2 |
| D14 | Static check: the connector sources contain no `DeepL-Auth-Key` and no vendor host name other than via config; imports are limited to the da-nx-relative allowlist and the provider folder | AC7, AC10 |

## 5. Worker tests (T2, `node:test`, #2 kit; fake DeepL at the injected `fetch`)

| ID | Behaviour asserted | Proves |
|---|---|---|
| W1 | **Every registered route**, iterated from the route table, answers `401` with no token and `401` with a bad-signature/expired/wrong-type token, and never reaches DeepL (fake records zero requests) | AC10 |
| W2 | Disallowed origins `403`; allowed origins (`https://da.live`, the site's own hosts) get CORS on all responses incl. errors; preflight needs no token; no custom request headers needed | AC10 |
| W3 | Upload forwards only the allowlisted fields; extra fields (`enable_quality_evaluation`, `output_format`, `glossary_ids`, `style_id`, `custom_instructions`) are dropped; DeepL receives `Authorization: DeepL-Auth-Key <canary>` and nothing from the caller's `Authorization` | AC10 |
| W4 | Upload accepts only `.html`/HTML content type; other types `400`; body over the cap `413` before any upstream call; `target_lang` must match a strict code pattern | AC10 |
| W5 | `documentId`/`documentKey` patterns enforced (path traversal, `../`, encoded slashes rejected before URL building); host allowlist holds for both `DEEPL_API_ORIGIN` values | AC10 |
| W6 | Canary property: across success and every error path the key never appears in any response, header or log line; DeepL echoing it in an error body is redacted | AC10 |
| W7 | Error mapping: DeepL `400, 403, 404, 413, 429, 456, 500, 503, 504, 529` map to the documented codes; no upstream text; `Retry-After` forwarded on `429`; `X-Trace-ID` logged | AC3 |
| W8 | Retry policy: status/usage/languages/glossaries retry `429`+`5xx` with the exponential schedule (jitter pinned); upload and result follow the chosen policy (429 only at the worker, per Decision 12); a `456` is never retried | AC3 |
| W9 | Multipart upload replays byte-identical bodies on each retry attempt | AC3 |
| W10 | Result returns the exact DeepL bytes with an HTML content type; the response is fully buffered before the worker replies; second download maps to the `document_gone` code, not retried | AC3 |
| W11 | `usage`, `languages`, `glossaries` map DeepL snake_case to the camelCase contract and drop unknown fields | AC1 |
| W12 | `DEEPL_AUTH_KEY` missing -> `500 misconfigured`, generic; `DEEPL_API_ORIGIN` selects `api-free` vs `api` and no other host | AC10 |
| W13 | If the `authorize` hook is enabled: a caller whose DA read check fails gets `403`, hook not run unauthenticated; fake DA admin outage -> fail closed with the documented code | AC10 (R6) |

## 6. Integration and end-to-end (T1 in-process backend; T3)

| ID | Behaviour asserted | Proves |
|---|---|---|
| I1 | Real connector + real worker (in-process) + fake DeepL: send 3 pages x `de, zh-CN, zh-TW`; advance remote state; `getStatusAll` until `translated`; `saveItems`; each destination holds its own marker translation; `zh-CN` request carried `ZH-HANS`, `zh-TW` carried `ZH-HANT` | AC4, AC2 |
| I2 | Token missing/invalid on the connector side -> `isConnected` false, no DeepL traffic | AC10 |
| I3 | Canary DeepL key never observed by anything the connector can read (responses, headers, console) | AC10 |
| I4 | Max simultaneous DeepL result downloads at the fake never exceeds 5; no more than the configured upload concurrency | AC3 |
| I5 | Cancel mid-way then reload state: no downloads, status stays `cancelled` | AC1 |
| I6 | Reload mid-way (state JSON round trip into a fresh module instance): status/save complete | AC4 |
| E1 | Playwright: a test page on `localhost:3000` loads the connector with da-nx shims and calls a real `wrangler dev` worker on `:8787` backed by the fake DeepL server: full round trip, real cross-origin preflight | AC4, AC10 |
| E2 | Same page without a token: worker `401` readable by the page (CORS on errors) | AC10 |
| E3 | Origin `https://evil.example` -> `403`; no key/ids leaked in any network response or the DOM | AC10 |
| E4 | Only expected hosts contacted (page, worker, fake DeepL); no request to a real DeepL host | AC10 |

## 7. Upstream and repo checks (T4)

| ID | Behaviour asserted | Proves |
|---|---|---|
| U1 | The bundle step produces `nx/blocks/loc/connectors/deepl/*` and `test/loc/connectors/deepl/index.test.js` with only import-path rewrites (diff of file bodies is empty) | AC7 |
| U2 | **Drop-in (advisory CI job, pinned da-nx commit and `main`):** bundle copied into a da-nx checkout; da-nx ESLint and WTR pass for the deepl files | AC7 (straight-copy claim) |
| U3 | Convention check: a `connector` extension folder with README, tests and `providers/*/index.js` passes; missing README/tests, or an entry listed in the README table without a folder, fails; `worker/` completeness rules from #2 apply | AC7, AC8 |
| U4 | README table row exists for `translation-connectors` (type `connector`, entry `providers/deepl/index.js`) | AC8 |

## 8. Live sandbox checks (L; opt-in script, needs a DeepL sandbox key through the deployed stage worker; budget: well under 10,000 characters total)

| ID | Behaviour asserted | Proves |
|---|---|---|
| L1 | `GET /languages` lists the document targets incl. `ZH-HANS` and `ZH-HANT` (or records the real codes); updates the alias table if not | AC4 (zh) |
| L2 | **HTML document with `<p translate="no">` and a `translate="no"` span:** after translation the marked content is unchanged and markup is preserved (tag/attribute diff). Result decides Decision 7 fallback | AC2 |
| L3 | Full round trip for `de`, `zh-CN`, `zh-TW` through the connector against the deployed worker | AC4 |
| L4 | Second download of the same document: record the real status and body (`404` vs `503`) and compare with the fake's modes | AC3, R14 |
| L5 | Burst of 12 uploads: observe `429`/`Retry-After`; the connector completes without failed uploads; note the amplification (R7) | AC3 |
| L6 | `GET /usage` before/after: characters rise only after download; a cancelled language leaves usage unchanged | story 18 |
| L7 | Same-language request and malformed HTML: record the `error` status body shape | R14 |
| L8 | An over-cap page (free-plan 500k chars) returns a readable error | story 21 |

## 9. End-to-end checks inside real EW (manual; needs Adobe login, Chrome, a DeepL key, Cloudflare login, a da-nx clone)

Accounts/credentials: GitHub admin on `jazhou-adobe/ew-extensions`; an Adobe IMS identity with config access to the DA org/site; DeepL sandbox key (stage) set with `wrangler secret put DEEPL_AUTH_KEY` (never pasted into chat or issues); Cloudflare account; write access to a da-nx clone. Never paste a real IMS token or DeepL key anywhere.

- **M0:** deploy the stage worker; `curl -i <stage-worker>/translate/deepl/{org}/{site}/usage` -> `401` (liveness + AC10 negative); with a real token from DevTools (claims decoded locally) and `Origin: https://da.live` -> `200` with usage numbers; `Origin: https://evil.example` -> `403`.
- **M1 (config):** create/edit `https://da.live/edit#/{org}/{site}/.da/translate` per the README sample (`DeepL`, `stage, prod` origins, languages incl. `zh-CN`, `zh-TW`).
- **M2 (`ref=local` equivalent):** in the da-nx clone, link/copy the connector to `nx/blocks/loc/connectors/deepl/`, `npm run local`, open `https://da.live/apps/loc?nx=local`, create a project, go to *Confirm options*: **Environment** `stage`; glossary and formality dropdowns populate; the connector is connected. [Resolves ASSUMPTIONs on `nx=local` and port.]
- **M3 (round trip):** 3 pages (one with `translate="no"` content and a block with a link), languages `de`, `zh-CN`, `zh-TW`; *Translate all*; *Get status* until each is `translated`; pages saved; open each saved page in the editor: correct language per folder, own page content (marker check), layout and links intact, `translate="no"` text unchanged, Chinese in the correct script per folder. Proves AC4, AC2, AC9 (local).
- **M4 (cancel):** send `de` and `fr`, cancel `fr` before status; `fr` shows `cancelled`, nothing saved; `GET usage` unchanged for `fr` (L6).
- **M5 (error):** exceed the sandbox quota or set a bad glossary id; the language shows `error` with a readable reason, no retry loop.
- **M6 (reload):** send, close the tab, reopen the project, *Get status* and save; works (C13/I6 in real EW).
- **M7 (branch ref):** run M2-M3 against a da-nx branch carrying the connector, if the owner provides one (Open Question 1); record how `?nx=<branch>` resolves. If no branch route exists, record that AC9's branch half could not be performed and why.
- **M8 (secret hygiene):** in DevTools Network/Application and page source across M3, search for the DeepL key value and for `DeepL-Auth-Key`: none. `wrangler secret list` shows names only.
- **M9 (docs):** a reviewer follows the README from clean clone to M3 on a scratch site.

## 10. CI additions (no credentials)

| Job | Steps | Notes |
|---|---|---|
| `connector-unit` | Node 22, `npm ci`, WTR: harness self-tests (H*), contract suite (C*), DeepL cases (D*), integration (I*) | every push and PR; fetch guard on |
| `worker-unit` (existing, extended) | `node:test`: W1-W13 | uses the #2 test kit |
| `worker-smoke`/`e2e` (existing, extended) | E1-E4 with the worker `webServer` and the fake DeepL server | Chromium only |
| `lint` (existing) | ESLint + Stylelint + convention check (U3, U4, D14 static check) | |
| `upstream-dropin` | U1 always; U2 against pinned da-nx and `main` | advisory (non-blocking) [OPEN: Open Question 14] |

## 11. Acceptance-criteria traceability (ticket #4)

| # | Acceptance criterion (#4) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Implements the EW connector contract: `isConnected`, `connect`, `sendAllLanguages`, `getStatusAll`, `saveItems`, `cancelTranslation`, `serviceOptions` for live dropdowns | C1-C6, C10, C11, C15; D9, D10, D11; H3 (suite discriminates); I5 | **M2** (connected, dropdowns populate), **M4** (cancel); review against the docs' contract list |
| AC2 | Sends HTML, preserves markup, leaves `translate="no"` untranslated, maps outputs to source pages by stable ids | C3, C7, C14; D3, D4, D13; I1 | **L2** (real DeepL honours `translate="no"` for HTML documents), **M3** (page-by-page check) |
| AC3 | Retries `429`/`5xx` with exponential backoff; at most five concurrent downloads | C8, C9; D6, D8; W7-W10; I4 | **L4**, **L5** (real behaviour and amplification); review of Decision 12 |
| AC4 | Full round trip (send, status to terminal, save) from the Translate app against the vendor sandbox, incl. `zh-CN` or `zh-TW` | C5, C13, C16; D1, D2, D5-D7; I1, I6; E1 | **L1, L3**, **M3** (zh-CN and zh-TW), **M6** (reload), **M5** (terminal error state) |
| AC5 | Contract harness (fake vendor API) exercises every contract method and is reusable by later connectors | H1-H5 (incl. reference connector green, sample stub red); C1-C16; harness README | Review: a new `providers/<vendor>` can run the suite with only an adapter (walk through on the reference adapter) |
| AC6 | README includes a site translation-config sample for DeepL | None (prose requirement) | Review checklist: sample has `translation.service.name = DeepL`, `all.env`, per-env `origin`, `languages` with `zh-CN`/`zh-TW`, no credential keys; **M1** uses it verbatim |
| AC7 | All code in its own self-contained folder, README with setup, EW config-sheet row, site config it reads | U1-U3, D14 (imports limited to provider folder and da-nx allowlist), convention check | **M9** (follow README on a scratch site); review that no file outside the folder is required |
| AC8 | Listed in the repo README extensions table and reachable from its host platform | U4 (table row), U3 | **M2/M7** show reachability via da-nx; the "reachable without a da-nx change" reading is not satisfiable (Further Notes 1); owner decision on acceptable reading |
| AC9 | Works in EW with `ref=local` and with a branch ref | I1/E1 (environment-independent behaviour) | **M2** (`?nx=local` as the `ref=local` equivalent), **M7** (branch ref, subject to Open Question 1) |
| AC10 | Credentials only in this extension's worker (from the template); browser never receives them; unauthenticated calls rejected | C12; D11, D12, D14; W1-W6, W12, W13; I2, I3; E2-E4 | **M0** (bare `curl` -> 401 on the deployed worker), **M8** (hygiene), `wrangler secret list` |
| AC11 | Core logic covered by unit tests; lint and CI green | all of sections 2-7 run by `connector-unit`, `worker-unit`, `lint` on every push/PR | Review: CI shows the jobs green on a PR; break a rule on a scratch branch (e.g. drop the retry) and see C9/D8 fail |

Every acceptance criterion on #4 maps to at least one automated test or a numbered manual step above.

## 12. Open questions for the owner

1. **Host reachability and the meaning of AC8/AC9 (blocking).** The Translate app only loads connectors that exist inside da-nx, so nothing served from this repo's EDS site can be selected by `translation.service.name`. Is the accepted deliverable "connector developed and verified here via a local da-nx (`?nx=local`), delivered upstream as a PR to `adobe/da-nx`"? For "branch ref": can you obtain a da-nx branch served by the code bus (Adobe maintainers) or is a `jazhou-adobe` da-nx fork with Code Sync acceptable (and does `?nx=` accept it)? If neither, should AC9's branch half be waived for this extension?
2. **`connector` as an extension type and the S3 carve-out.** Approve a third `type` value `connector` (registration: `translation.service.name`) and a convention-check rule that a connector extension needs README + tests + `providers/*/index.js` instead of an entry page. Alternative: add a tiny entry page purely for the convention check (not recommended).
3. **DeepL account.** Which account and plan will provide the sandbox key (API Free is no longer sold; Developer plan is 1,000,000 characters total, non-resetting)? Who pays for a production key, and is a Cost Control limit set? Confirm no real customer content goes to the sandbox.
4. **Who may spend the quota.** Adopt the recommended `authorize` check (caller must have DA read access to `{org}/{site}`) or accept "any authenticated Adobe user passing the client-id allowlist"? One shared key per worker (this design) vs the existing connectors' per-site credentials in a sheet?
5. **Origin from config.** The connector takes the worker base from `translation.service.{env}.origin` (documented key) and only enforces `https`. Should it also restrict origins to an allowlist (e.g. `*.workers.dev` plus a configured domain) so a mistyped sheet cannot send IMS tokens to an arbitrary host? This is an admin-controlled exception to #2's "never from the URL".
6. **`translate="no"` fallback.** If live check L2 shows DeepL's HTML document API ignores `translate="no"`, approve building the connector-side placeholder protection (Decision 7) rather than switching to the text API (128 KiB request cap, different protocol)?
7. **Lost translation window.** Accept the once-only download risk (re-send is billed again) with in-session retry only, or approve adding storage (Worker KV/R2) outside the #2 template's scope?
8. **Template amendments for #2.** The DeepL routes need (a) multipart uploads with a replayable buffered body and a per-route body cap, (b) a fully buffered response option, (c) per-route retry/idempotency flags, (d) extension-defined error codes beyond the fixed list. Confirm these belong in `shared/worker-template` (a breaking-contract note per #2 Decision 17) or in this extension.
9. **Bare codes.** For `zh`, `en`, `pt` (no variant) choose defaults (`ZH-HANS`, `EN-US`, `PT-PT`/`PT-BR`?) or require the site to configure explicit variants? Where should extra aliases live (code only, or a config key)?
10. **Glossary scope.** v3 multilingual glossaries only, applied per language when a dictionary covers the pair. Acceptable? Should a missing pair block the send instead of sending without it?
11. **Retry budget and concurrency.** Accept the worker/browser retry split and conservative upload concurrency (to be tuned from L5), and loosening upload POST retry to `5xx` at the worker because orphaned uploads are never billed?
12. **Upstreaming.** Do you intend an `adobe/da-nx` PR (Adobe CLA, IP policy per #1 R1)? Should we ask Adobe to host the proxy (`translate.da.live`) so the final connector needs no `origin` for this vendor?
13. **Licence and vendoring.** Is Apache-2.0 vendoring of three small da-nx helpers (with headers and a pinned commit) acceptable, pending the repo licence in #1 R9?
14. **Drop-in job.** Required CI check or advisory? It needs network access to `adobe/da-nx` and adds minutes.
15. **Sandbox cost.** Approve the live script (L1-L8) running only by hand with a documented character budget.
