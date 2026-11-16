# Spec: Extra Translation Connectors: XTM Cloud (provider on the connector harness)

Ticket: jazhou-adobe/ew-extensions#6 (this spec: #44). Blocked by #4 (DeepL ticket: connector harness + first vendor; spec in `apps/translation-connectors/SPEC.md`), which itself is blocked by #1 (repo scaffold; spec `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec `shared/worker-template/SPEC.md`).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as #1, #2, #4): **[VERIFIED]** = read in a primary source (URL given) on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/XTM.

Vocabulary follows #1, #2 and #4: *extension* = one folder `apps/<name>/`; *worker* = the per-extension backend in `apps/<name>/worker/` built from `shared/worker-template/`; *provider* = one vendor under `apps/<extension>/providers/<vendor>/`; *connector* = the module the Translate app loads; *Translate app* = EW localization UI (`https://da.live/apps/loc`, source `nx/blocks/loc` in `adobe/da-nx`); *harness* = the #4 contract test harness; *IMS token* = the Adobe IMS access token; *submission* = the connector-generated grouping defined in #4 Decision 4. XTM-specific terms follow XTM's own definitions [VERIFIED, https://api.xtm-cloud.com/project-manager-api-rest/documentation/xtm-docs, tag "Definitions"]: **project** (one or more files, one source language, one or more target languages), **job** (one file in one target language), **step** (workflow step: translate, correct, review, approve TM, LQA, ...), **bundle**, **task**.

Documents this spec was written against (all read 2026-11-16):
- XTM REST API OpenAPI definition `info.version 26.5`, `servers: /project-manager-api-rest` (https://api.xtm-cloud.com/project-manager-api-rest/documentation/xtm-docs; human-readable at https://xtm.cloud/api and https://api.xtm-cloud.com/rest-api). Cited below as **XTM-OAS**.
- XTM Knowledge Base: API FAQ (https://xtm-cloud.atlassian.net/wiki/spaces/EXKB/pages/4024434690/API+Frequently+Asked+Questions+FAQ, **XTM-FAQ**), "Running your first REST API method" (https://xtm-cloud.atlassian.net/wiki/spaces/EXKB/pages/4221304837/Running+your+first+REST+API+method, **XTM-START**), "Understanding the XTM API documentation" (https://xtm-cloud.atlassian.net/wiki/spaces/EXKB/pages/4220158511/Understanding+the+XTM+API+documentation, **XTM-DOCS**).
- Adobe EW docs: https://www.aem.live/docs/ew/administering/translation-service-connection (**EW-CONN**), https://www.aem.live/docs/ew/administering/translation-config (**EW-CONFIG**), https://www.aem.live/docs/ew/administering/translation-config-samples (**EW-SAMPLES**), https://www.aem.live/docs/ew/developing/apps-plugins.
- `adobe/da-nx` `main` at commit `a1bd8ec146bdeea66b25aaac5ddb4e6bc8cbdca7` (2026-11-15): `nx/blocks/loc/views/translate/{index,translate}.js`, `views/translate/translate.css`, `views/options/options.js`, `connectors/smartling/{index,auth}.js`, `utils/{fetchWithRetry,downloadQueue}.js`, `dnt/dnt.js`. Cited as **da-nx@a1bd8ec**.
- Prior art for an XTM integration outside Adobe: the Blackbird XTM app (https://docs.blackbird.io/apps/xtm/, source https://github.com/bb-io/XTM, `Apps.XTM/Actions/FileActions.cs`), used only as evidence that the generate-then-download-ZIP flow works in practice.

---

## Problem Statement

A site that localises with **XTM Cloud** cannot use it from the EW Translate app: the app ships Google plus Lionbridge, Smartling and Trados connectors (EW-CONN), and nothing for XTM. Adobe's page says it normally builds connectors itself and also invites third-party pull requests (EW-CONN), so the contribution may land as a PR into `adobe/da-nx` rather than as an independent listing (ticket #6 rationale).

XTM is also the first connector on the #4 harness whose vendor is a **real human workflow**, not an API call that returns a translation:

1. **Status must mean reviewer progress.** An XTM project runs through a configured workflow (translate, correct, review, approve ...). Adobe's own requirement is that "status must reflect that work, and downloads must return the latest reviewed content" (EW-CONN). A connector that reports "translated" when the translate step finishes, and saves the pre-review text into the site, violates that. The connector has to read steps, not just a project flag.
2. **Project, job and file ids are numeric and server-assigned,** and the mapping from an uploaded page to a downloadable result goes through four ids (file name, job, generated file, download). A wrong mapping puts page A's German on page B (AC2).
3. **Downloads are ZIP archives** produced by an asynchronous "generate files" step [VERIFIED XTM-OAS `GET /projects/{projectId}/files/download`: "The response is generated in the application/octet-stream format as a ZIP file"], which the browser contract (`saveItems` returns HTML) cannot hand to the host as is.
4. **Language codes are locale-shaped.** XTM codes are `de_DE`, `fr_FR`, `ja_JP`, `zh_CN`, `zh_TW`; bare `de`, `fr`, `ja` are **not** in XTM's list, while EW sites commonly configure bare `de`, `fr`, `ja` [VERIFIED against the XTM-OAS "Language codes" list, 983 entries; bare codes present are only `en`, `zh`, `pt`].
5. **Credentials and CORS.** XTM credentials (company name, numeric user id, password) grant a project-manager account over real translation spend. They must live only in the worker (AC10). Whether XTM allows browser CORS is not documented [ASSUMPTION: not tested; the worker is needed for the secret regardless].
6. **Cost is human money.** Starting a workflow sends work to paid linguists. A bug that creates duplicate projects (for example a blind retry of a create call that actually succeeded) has a real price, unlike a duplicate DeepL document.

## Solution

Add `apps/translation-connectors/providers/xtm/` as the **third provider** (after #4's DeepL, beside #5's Phrase) in the existing `translation-connectors` extension. It contains:

- an **XTM connector** with the da-nx contract (`isConnected`, `connect`, `sendAllLanguages`, `getStatusAll`, `saveItems`, `cancelTranslation`, `serviceOptions`, `dnt`) laid out as a straight copy into `nx/blocks/loc/connectors/xtm/`;
- the **XTM routes of the extension worker** (credentials in the platform secret store, IMS-authenticated, CORS-gated, per #2/#4), including the three jobs the browser should not do: derive an XTM token from the stored credentials, rebuild the project-creation multipart in XTM's format, and turn XTM's ZIP download into plain HTML;
- a **fake XTM API** (a pure model of projects, jobs, workflow steps, analysis, file generation, ZIP download, and scripted failures) that plugs into the #4 harness as a backend adapter, so XTM passes the shared contract suite with no XTM account in CI;
- a provider **README** (setup, credentials, config keys, a `translate.json` sample with `zh-CN` and `zh-TW`, live-check and EW verification steps) plus a machine-checked sample config file.

What an author sees: with `translation.service.name = XTM` in `.da/translate`, the Translate app shows the connector connected, the Options step offers live dropdowns for XTM **customer**, **workflow**, optional **project template** and **auto-start**, *Translate all* creates one XTM project (more if the project is large) holding every selected page for every selected language, *Get status* reports per language how far reviewers have got ("Review: 3 of 5 pages") and flips to **translated** only when the last workflow step of every page is finished, and the reviewed translations are saved into the right language folders automatically, including `zh-CN`/`zh-TW`. A language can be cancelled.

## User Stories

Site administrator:

1. As a site administrator, I want to enable XTM by setting `translation.service.name` and a worker `origin` per environment in `.da/translate`, so that no code change is needed to move from Google.
2. As a site administrator, I want a copy-paste `translate.json` sample for XTM (including `zh-CN`, `zh-TW`), so that I configure languages, environments and conflict behaviour correctly the first time.
3. As a site administrator, I want separate `stage` and `prod` environments (an XTM sandbox tenant vs the production tenant), so that authors can trial a project without paying linguists.
4. As a site administrator, I want my XTM company name, user id and password to live only in the worker's secret store, so that they are not in the sheet, the browser, or the repo.
5. As a site administrator, I want to restrict which XTM customers the worker may create projects for, so that no EW user can spend another customer's budget.
6. As a site administrator, I want to restrict who may call the worker at all, so that "any Adobe user who finds the worker URL" cannot create paid XTM projects.
7. As a site administrator, I want the README to say which XTM role, API licence and user id are required, so that the first connection does not fail with an opaque error.
8. As a site administrator, I want to choose a workflow (and optionally a project template) from XTM, so that EW projects follow our review process (translate, review, approve) and linguist assignment.
9. As a site administrator, I want to decide whether EW starts the XTM workflow automatically or my project managers start it in XTM, so that spend only begins when we intend.
10. As a site administrator, I want a documented list of the proxy routes the connector calls, so that Adobe (or I) can host an equivalent proxy later.

Content author:

11. As an author, I want the Translate app to show whether XTM is connected (and why not), so that I do not start a project that cannot be sent.
12. As an author, I want to pick the XTM customer, workflow and template from lists fetched from XTM, so that I never type numeric ids.
13. As an author, I want *Translate all* to send every selected page for every selected language as one XTM project, so that project managers see one project per EW send.
14. As an author, I want `zh-CN` and `zh-TW` (and `de`, `fr-FR`, `pt-BR`, `ja`) mapped to the right XTM language, so that Simplified and Traditional Chinese are not swapped and `de` does not fail for lack of a region.
15. As an author, I want a clear message before anything is sent when a language cannot be mapped to an XTM language or equals the source, so that I am not billed for a doomed project.
16. As an author, I want *Get status* to tell me which workflow step each language is in (for example "Review: 3 of 5 pages"), so that I know reviewers are working and not that translation is "done".
17. As an author, I want a language to turn **translated** only after the last workflow step (including review) of every page is finished, so that unreviewed text never lands in my site.
18. As an author, I want the saved page to contain the reviewed text, not the machine-translated draft, so that I do not publish text a reviewer corrected.
19. As an author, I want each translated page saved at its own path in the right language folder, so that page A's French never lands on page B.
20. As an author, I want my page's layout, links and blocks to survive translation unchanged, so that I only review words.
21. As an author, I want content marked `translate="no"` (product names, code, `dnt-text` spans) left exactly as written, so that I do not repair them by hand in every language.
22. As an author, I want to cancel a language I no longer need, so that XTM stops work on it and nothing more is saved for it.
23. As an author, I want to reload the page or come back days later (translation takes days) and still get status and save results, so that translation does not depend on one browser tab.
24. As an author, I want a re-send after a partial failure to send only what failed, so that reviewers do not receive the same page twice.
25. As an author, I want a plain message when XTM rejects something (for example a description over the limit, or a wrong customer), so that I can fix the option instead of retrying.
26. As an author, I want a project that XTM has analysed but not yet started to show as "created", with the reason, so that I know a project manager has to start it.

Connector developer (#5 and later vendors):

27. As a connector developer, I want XTM to run the unmodified generic contract suite through an adapter, so that "implements the EW connector contract" stays a command.
28. As a connector developer, I want the XTM-specific cases (steps, ZIP, language mapping, create-or-adopt) written as provider cases beside the generic ones, so that vendor quirks never leak into the harness.
29. As a connector developer, I want a worked example of a project-based vendor with human workflow steps on the harness, so that Phrase TMS (#5) can follow the same pattern.

Maintainer / reviewer:

30. As the maintainer, I want CI to run the harness, XTM connector tests and XTM worker tests with no credentials, so that regressions cannot merge.
31. As the maintainer, I want live sandbox checks as an opt-in script with a documented budget, so that real-API facts (HTML `translate="no"`, language codes, ZIP shape, workflow start timing, rate limits) are verified without CI spending money.
32. As the maintainer, I want the XTM provider to change nothing in the extension shell except registering itself, so that #4 and #5 are unaffected.
33. As a reviewer, I want every #6 acceptance criterion mapped to a test or a numbered manual step, so that review is a checklist.
34. As the maintainer, I want to be able to upstream the connector to `adobe/da-nx` as a copy, so that the PR route Adobe offers stays open.

Security reviewer:

35. As a security reviewer, I want proof that XTM credentials and the derived XTM token never appear in any response, header, log line or browser-visible file, so that "credentials only in the worker" is tested.
36. As a security reviewer, I want proof that every XTM route rejects a missing or invalid IMS token and a disallowed origin before any XTM call (including the token exchange), so that the worker is not an open proxy.
37. As a security reviewer, I want proof that a caller cannot read, cancel or download any XTM project that this site did not create (other projects in the same XTM tenant), so that one shared PM-level XTM account does not become a read/write window into the tenant.
38. As a security reviewer, I want the worker to forward only an allowlist of project-creation fields and a fixed download file type, so that a caller cannot attach callbacks, change project managers, enable costs, or download non-target reports.
39. As a security reviewer, I want the connector to refuse to send the IMS token to a non-HTTPS or malformed origin, so that a mistyped config row cannot leak tokens.

## Implementation Decisions

(No file paths or code, except contract tables; paths are in the Build Analysis. Decisions of #4 are reused unchanged unless listed under "Deviations".)

### A. Inherited from #4 and #2 (not re-decided)

1. **Provider shape.** `providers/xtm/` mirrors da-nx's `nx/blocks/loc/connectors/<name>/` (index entry + helper modules), imports only da-nx-relative modules that exist upstream, and runs against the harness's vendored helper copies and shims. Type of the extension stays **connector**; registration is by `translation.service.name` in `.da/translate` (#4 Decision 1/2).
2. **Worker contract.** All backend concerns (IMS token validation, origin/CORS gate, secrets accessor, redaction, outbound proxy with retry, error contract, request ids, logging, test kit) are #2's, unchanged. XTM routes live under `apps/translation-connectors/providers/xtm/worker/` and are registered by the extension worker entry (#2 Decision 3). One worker deployment per environment, selected by the sheet's `origin`; there is no per-environment switch in the worker (#4 Decision 15).
3. **Auth and token.** The connector uses the shared da-nx `imsAuthHeader()` for every worker call; the DA App SDK is not involved (#4 Decision 14).
4. **Retries and concurrency baseline.** Browser-side calls use the shared da-nx `fetchWithRetry` (retries `429` and `>=500`, exponential backoff, `Retry-After`) and downloads use the shared `downloadQueue` with its default of **5**; `saveLangConcurrency` is not exported so the default of one language at a time holds (#4 Decision 12, 3).
5. **Persistence pattern.** State lives in `lang.translation` and is rehydratable from the persisted JSON; no module-level memory (#4 Decision 4, case C13). Statuses `created`, `in progress`, `translated`, `error`, `cancelled`, `complete` (host-set) are the styled vocabulary the host renders [VERIFIED `views/translate/translate.css` styles `is-created`, `is-in-progress`, `is-translated`, `is-complete`, `is-cancelling`, `is-cancelled`, `is-error`; da-nx@a1bd8ec]. Only `translated` and `complete` make the host save a language (`checkAndSaveLangs`, da-nx@a1bd8ec).
6. **Harness.** XTM supplies a backend adapter (fake XTM, service builder, sample pages, capability flags) and runs the generic cases C1-C16 and the harness self-test discipline H1-H5 from #4.
Tooling (part of the harness decision above): ESLint 8 + helix config, `@web/test-runner` for browser-side tests, `node:test` for worker tests, Playwright (Chromium) for the hermetic end-to-end tier, Node 22, husky; no new runner (#4 Decision 20).

### B. Contract deltas observed in current da-nx (`main`) that #4 should absorb

7. Reading `da-nx@a1bd8ec` surfaced details not in #4's text. None change the XTM design; each is recorded so the harness stays in step [OPEN: confirm with #4's owner, Open Question 14]:
   - the connector may opt into **managed status** by exporting `supportsManagedStatus = true`; the host then passes an abort `signal`, a `saveState(props, { waitForSave })` and expects `getStatusAll` to optionally return `{ message }`. XTM v1 does **not** opt in (smaller surface, same behaviour for the author).
   - `getStatusAll`, `sendAllLanguages` receive the whole conf (`org, site, snapshot, title, service, options, langs, urls, sourceLocations, langsWithUrls, actions`); `service` is `{ name, ...envConfig, org, site, env }` (`views/options/options.js`).
   - the Options step calls `connector.connect(service)` **without** `sendMessage` before fetching `serviceOptions`, so `connect` must tolerate a missing `sendMessage`.
   - a language that depends on another (`waitingFor`) is sent later by a second `sendAllLanguages` with `options['source.language']` overridden, so each send must take the **source language from options at call time**, not from site config.
   - the `downloadQueue` helper resolves only when every url has a truthy `status`, so the connector must set `status` on every page on every path (success, error, skipped).

### C. XTM-specific decisions

8. **XTM mapping of the contract.** One EW send creates one or more XTM projects ("parts" of one submission), each created with all of its files and target languages in a single call. A page x language pair is an XTM **job**; the identifier chain is `daBasePath -> upload file name -> (fileName, targetLanguage) in the create response -> jobId -> generated fileId -> download`. XTM's own words for these objects are used in user-facing messages ("project", "job", "step").
9. **Provider name and service name.** The provider folder is `xtm`. da-nx derives the connector folder from the configured service name with lower-casing and spaces replaced by hyphens, so the sheet value must be **`XTM`** (not `XTM Cloud`, which would resolve to `xtm-cloud`) [VERIFIED `setupConnector` in `views/translate/index.js` and `loadConnectorServiceOptions` in `views/options/options.js`, da-nx@a1bd8ec; same derivation #4 Further Note 1] [OPEN: confirm the name; Open Question 2]. The label shown to authors is the sheet's `translation.service.name` value.
10. **Authentication to XTM: XTM-Basic through the worker, OAuth later.** XTM documents three schemes: XTM-Basic (token from client name, user id, password; "tokens grant permanent access"), OAuth 2.0 (password, authorization-code with PKCE, refresh; "preferred by XTM", but a client id and secret must be requested from XTM support) and SAML-derived OAuth [VERIFIED XTM-OAS `securitySchemes`, tags "XTM Basic", "Password flow", "Refresh Token flow"]. v1 uses **XTM-Basic**: the worker holds the password as a secret, and the company name and numeric user id as non-secret config, posts them to the token endpoint and sends `Authorization: XTM-Basic <token>` upstream. Reasons: no registration step with XTM, fully non-interactive (an Adobe requirement, EW-CONN), matches Blackbird's working connection model [VERIFIED https://docs.blackbird.io/apps/xtm/]. The derived token is cached per isolate and regenerated once on an upstream `401`. Because XTM's own KB states the token merely *encodes* the credentials and is accepted or rejected only when used [VERIFIED XTM-START: "generates a token regardless of whether the data you provide is valid ... Each API method decodes the token"], the token is treated as a **secret equal to the password** for redaction and logging. OAuth password flow is a documented follow-up, not built [OPEN: Open Question 3].
11. **Worker routes** (proxy contract; names are independent of XTM's wire format; base `{origin}/translate/xtm/{org}/{site}`, mirroring Adobe's proxy convention used in #4 Decision 13):

   | Method + path (under the base) | Purpose | XTM call (relative to `XTM_API_BASE`) |
   |---|---|---|
   | `GET /system` | connectivity + auth check | `GET /system` |
   | `GET /languages` | XTM language codes (for pre-flight) | `GET /languages/language-codes` |
   | `GET /customers` | active customers (dropdown) | `GET /customers?activity=ACTIVE` |
   | `GET /workflows` | workflows (dropdown) | `GET /workflows` |
   | `GET /templates?customerId=` | project templates (dropdown) | `GET /projects/templates` |
   | `POST /projects` (multipart: `manifest` JSON + `file0..fileN`) | create-or-adopt one project part | `POST /projects` (+ `GET /projects`, `GET /projects/{id}/status?fetchLevel=JOBS` for adopt) |
   | `GET /projects/{projectRef}/status` | analysis + job/step status, normalized | `GET /projects/{id}/analysis`, `GET /projects/{id}/status?fetchLevel=STEPS` |
   | `POST /projects/{projectRef}/start` | start the workflow | `POST /projects/{id}/workflow/start` |
   | `POST /projects/{projectRef}/files` (JSON `{jobIds}`) | generate target files | `POST /projects/{id}/files/generate?fileType=TARGET&jobIds=...` |
   | `GET /projects/{projectRef}/files/status?fileIds=` | generated-file status | `GET /projects/{id}/files/status?fileScope=JOB&fileIds=...` |
   | `GET /projects/{projectRef}/files/{fileId}` | one translated page as HTML | `GET /projects/{id}/files/{fileId}/download?fileScope=JOB`, ZIP unpacked in the worker |
   | `POST /projects/{projectRef}/cancel` (JSON `{jobIds}`) | cancel jobs | `POST /projects/{id}/jobs/cancel?jobIds=...` |

   Responses are camelCase JSON except the file route (raw HTML bytes, `text/html`). The worker validates every id against strict numeric patterns before building an upstream URL, sets the `Authorization` header itself, forwards only the field allowlists below, and never passes upstream bodies through.
12. **Project handles are signed, per site.** The worker is one PM-level XTM account shared by every EW user of the deployment, so a bare numeric project id would let any authenticated caller read, cancel or download any project in the XTM tenant (including projects EW never created). The create route therefore returns an opaque **projectRef** (project id plus a MAC over `{org}/{site}/{projectId}` made with a dedicated worker secret), and every project-scoped route verifies it before any XTM call; a ref minted for another org/site, or tampered, is rejected as not found with zero upstream traffic. The ref is what the connector persists. The alternative (check a name prefix through an extra `GET /projects/{id}` per call) costs an upstream call each time and trusts a field XTM users can edit [OPEN: Open Question 16].
13. **Create is idempotent by name ("create-or-adopt").** Creating a project is not safe to retry blindly (a lost response could leave a real, paid project behind). Each part gets a unique **project name** containing the submission id and part number; the worker's create route, on a timeout or `5xx` from XTM, looks for a project with that exact name in the same customer created in the last minutes, adopts it (reading its jobs) if found, and otherwise retries once. `429` is retried with backoff without a lookup. The connector can therefore use the shared retry helper for the create call too, and a test proves a created-then-`503` scenario ends with exactly one project [ASSUMPTION: XTM's `name` filter on `GET /projects` returns exact matches or a superset the worker can filter; verified by live check XL11].
14. **What is sent, and file naming (AC2).** `url.content` (HTML with DNT markup applied by the shared `addDnt`) is sent unmodified as one `.html` file per page. The XTM file `name` is derived deterministically from `daBasePath`: leading `/` removed, path separators replaced by a double underscore, characters outside a conservative ASCII set replaced, `.html` appended, a numeric suffix added on collision, truncated with a short hash when over a length cap [ASSUMPTION: XTM file-name length cap unknown, live check XL12]. The name is a label and a join key for the create response only; the persisted mapping is `daBasePath -> {jobId per language}` taken from that response, never recomputed later. Each file lists its own `targetLanguages`, so a re-send can carry different language sets per page [VERIFIED XTM-OAS `RSSourceFileRequest.targetLanguages`/`targetLanguagesV2`]. The project's own `targetLanguages` is the union.
15. **Multipart shape toward XTM.** XTM requires `multipart/form-data` for project creation, with arrays addressed as `translationFiles[n].file`, `translationFiles[n].name`, `translationFiles[n].targetLanguages`, index from 0 ascending [VERIFIED XTM-FAQ "How do array types work in the form-data body request?" and "Is there a limit to the amount of files"]. How plain string arrays (`targetLanguages`) are encoded in the same form is not stated [ASSUMPTION: indexed or repeated key; verified by XL5]. The browser sends the simpler `manifest` + `fileN` form; the worker converts.
16. **Create-field allowlist (worker).** Forwarded: `name`, `description` (built by the worker from the verified identity, org, site and project title; never caller-supplied; XTM limit 2000 characters [VERIFIED XTM-FAQ]), `referenceId`, `sourceLanguage`, `targetLanguages`, `customerId` (must be on the worker's allowed-customer list), `workflowId` **or** `templateId`, optional `filterTemplateId`, and the files. Everything else in XTM's schema (callbacks, project manager id, custom fields, reference files, cost and AI options, `overrideFields`, `errorAction`, `externalCreatorId`, ...) is dropped [VERIFIED field list: XTM-OAS `RSProjectCreationModelAttributeRequest`]. Project name forbids the characters `\ / : * ? " < > | { }` and tab [VERIFIED XTM-OAS `name` description] so the worker sanitises the title.
17. **Analysis and start.** After creation XTM analyses the project; "many subsequent API methods ... will not work until the status changes to FINISHED" [VERIFIED XTM-FAQ, status values section] and a workflow must be started for linguists to begin [VERIFIED XTM-OAS `POST /projects/{id}/workflow/start`: "activates the first workflow step for all the jobs"]. Whether `start` is accepted before analysis ends is not documented [OPEN: XL7]. Therefore: `getStatusAll` reads analysis status; when the project is analysed, `autoStart` is `yes` (default) and the project has not been started by us, it calls the start route once and persists `started`. A rejection leaves `started` false and is retried on the next status check. With `autoStart = no` the connector never starts and the status message says a project manager must start the project in XTM. Automatic start through a **template** (with assigned first step) is also supported by XTM and documented [VERIFIED XTM-FAQ "Is there a way to start a workflow automatically?"]; the connector does not detect it, it only avoids a second start by treating an already-started response as success [ASSUMPTION on that response; XL7].
18. **Status model (AC: status reflects reviewer progress).** The connector requests status at step level for each project part (one call per part; XTM asks callers to stay under 50 GET requests per minute [VERIFIED XTM-FAQ, "How often should I query status checks"]). Per page and language (one XTM job):
    - job `FINISHED` (workflow completed in all steps) -> page `done` (ready to save);
    - job `IN_PROGRESS` -> page `in progress` with the first step that is `IN_PROGRESS` (or, if none, the first `NOT_STARTED`) as the current step, using the step's display name;
    - job `CANCELLED` set by us -> `cancelled`; job `CANCELLED` or `DELETED` that we did not cancel, or job `ERROR`, or a step with `autoStatus = ERROR` -> `error` with a message naming XTM's state;
    - project not found (deleted in XTM) -> every page of that project `error`.

    Language status: `created` while the project is not analysed or not started; `in progress` while any page is not done; `translated` only when **every** page of the language is `done` or already `saved` (this is what makes the host save, so it is "reviewed and finished", never "translate step finished"); `error` when any page is `error`; `cancelled`/`complete` are never regressed. `translation.sent` = pages accepted into XTM for the language; `translation.translated` = pages `done` or `saved`. **Reviewer progress** is shown (a) through `translated` count, (b) through a one-line message per language naming the active step(s) and counts ("de: Review 3 of 5 pages, Translate 2"), and (c) persisted as a non-UI `step` summary used by tests. The row's status text stays inside the styled vocabulary rather than custom strings such as `62% translated` (Smartling's choice, unstyled) [OPEN: Open Question 12].
19. **Save (AC2, AC3).** `saveItems` works per language: for pages not yet `saved`, (1) ensure a generated target file per job: one generate call per project part per language for the jobs that lack a stored `fileId` (job id lists chunked to keep URLs short), (2) poll generated-file status with a bounded number of attempts and a pause (as Smartling's process poll does), treating `FINISHED` as ready, `ERROR` as page error (regenerated on the next save), `IN_PROGRESS` as "not ready yet" (page left without success; the host marks the language `error` and *Get status* retries without re-generating), (3) download by `fileId` through the shared `downloadQueue` (**at most five in flight**), (4) run `removeDnt`, set `sourceContent`, call `saveFn`, and persist page state `saved`. Downloads are identified by the stored `fileId`, never by file name or response order. Because the worker returns the job id XTM states for a file (from the generate response and the `xtm-file-descrption` header [VERIFIED header name, XTM-OAS `GET /projects/{id}/files/download`, 200 response headers]) the connector and worker both refuse a file whose job id differs from the requested one. XTM files are repeatable, so a page already `saved` is not downloaded again but a failed save can re-download [ASSUMPTION: generated files are re-downloadable; XL8].
20. **ZIP handling in the worker.** Single-job download returns a ZIP [VERIFIED XTM-OAS]. The worker reads the central directory, accepts exactly one HTML entry (stored or deflate; no encryption, no archive-in-archive), enforces an uncompressed size cap, ignores entry names for mapping, and returns the HTML bytes. It uses the runtime's `DecompressionStream` (supports `deflate-raw`) rather than a new dependency [VERIFIED https://developers.cloudflare.com/workers/runtime-apis/web-standards "The CompressionStream and DecompressionStream classes support the deflate, deflate-raw and gzip compression methods"; ASSUMPTION: ZIP produced by XTM has one entry and standard methods; XL8]. The response is buffered (the Workers isolate has 128 MB memory [VERIFIED https://developers.cloudflare.com/workers/platform/limits/]; the per-file cap sits far below it).
21. **Cancel.** `cancelTranslation` cancels the XTM **jobs** of that language only (job ids from persisted state, excluding pages already `saved`), using the cancel-jobs operation documented as "cancels processing of jobs without removing them from the project" [VERIFIED XTM-OAS `POST /projects/{projectId}/jobs/cancel`], then marks the language and its pages `cancelled`. It does not deactivate the whole project (a project holds other languages) and does not delete anything. An all-cancelled project stays in XTM for a project manager to archive; the README says so [OPEN: Open Question 10]. Cancel is idempotent; a failure returns `{ ok: false }` with a message and leaves state unchanged.
22. **Language codes (AC4 Chinese).** EW codes (`languages` tab `code` column) map to XTM codes by: (a) normalise separators (`-` to `_`), case-insensitive exact match against XTM's list fetched from the worker; (b) an explicit alias table (`zh-CN`, `zh-Hans`, `zh-SG` ... `zh_CN`; `zh-TW`, `zh-Hant` ... `zh_TW`; `zh-HK` ... `zh_HK`); (c) for bare codes, a **default-locale table** because XTM has no bare `de`/`fr`/`ja`; candidates drawn from the list: `de`->`de_DE`, `fr`->`fr_FR`, `ja`->`ja_JP`, `ko`->`ko_KR`, `it`->`it_IT`, `es`->`es_ES`, `nl`->`nl_NL`, `sv`->`sv_SE`, `he`->`he_IL`, `en`->`en_US`, `pt`->`pt_PT`, `zh`->`zh_CN` [VERIFIED these codes exist in the XTM-OAS list; which default a customer wants (`en_US` vs `en_GB`, `pt_PT` vs `pt_BR`, bare `zh`) is a content decision, [OPEN: Open Question 5]]; (d) an optional sheet key `translation.service.{env}.languageMap` (comma-separated `ewcode=xtmcode`) overrides everything. A code that maps to nothing in XTM's list, or a target equal to the source, fails that language before any upload with a message, and other languages proceed (generic case C16). Source code goes through the same mapping.
23. **`translate="no"` and markup (AC2).** EW-CONN requires the service to "preserve the markup and treat any element with `translate="no"` as untranslatable". XTM documents that its **ITS rules** ("determine which part of the source file should be translated", provided "for all the file formats supported") are editable and that filter templates are applied per project [VERIFIED https://help.xtm.ai/en/xtm-cloud/26.5/en/analysis-manager.html, https://help.xtm.ai/en/xtm-cloud/26.3/en/filter-configuration.html; `filterTemplateId` exists on project creation, XTM-OAS]. It does **not** state that the default HTML filter honours the HTML5 `translate` attribute [OPEN; the central vendor risk R2; live check XL3]. Decision (a ladder, built only as far as evidence requires): **F0** send HTML unchanged and rely on XTM; **F1** if XL3 shows it is not honoured by default, document the one-time XTM admin step (an ITS rule or filter template that honours `translate="no"`) and expose `filterTemplateId` as a service option; **F2** only if neither is possible, connector-side placeholder protection of `translate="no"` subtrees with a persisted restore map (size-capped) [OPEN: approval, Open Question 9]. The same da-nx DNT plumbing as every connector is used (`dnt = { addDnt }`; `removeDnt` after download).
24. **Charset and fidelity.** The saved content must be UTF-8 HTML with markup preserved (tags, attributes, link targets byte-identical outside translated text). XTM's output encoding and whitespace normalisation for HTML are not documented [ASSUMPTION; XL4 with CJK and entity-heavy fixtures]. The worker returns the bytes with an explicit UTF-8 `Content-Type` only if XL4 proves it; otherwise the connector decodes by the document's declared charset.
25. **Concurrency, burst and retry across layers (AC3).** Connector: shared `fetchWithRetry` for every worker call (retry `429`, `>=500`, exponential backoff with jitter, `Retry-After`), shared `downloadQueue` default 5 for downloads, create parts sequential, generate/status calls one per part. Worker: #2 `proxy` defaults (retry `429` and `5xx` for idempotent requests, backoff with jitter), with the per-route policy in the table of section "Worker retry policy" (create-or-adopt is idempotent; workflow start and cancel `429` only unless the XL runs show repeat is safe). XTM's HTTP code list in its documentation has **no `429`** [VERIFIED XTM-OAS tag "HTTP Codes": 200, 201, 202, 400, 401, 403, 404, 405, 406, 415, 422, 500, 501, 503]; real rate-limit behaviour and any `Retry-After` are unknown [OPEN: XL9]. Two retry layers multiply (browser 5 x worker 3); budgets are tuned from XL9 (#4 R7).
26. **Service options (`serviceOptions`).** Entries `{ key, label, fetch(service) }`: `customerId` (live from `GET /customers`, active only), `workflowId` (live from `GET /workflows`), `templateId` (live from `GET /templates`, first item an explicit "No template" with empty value, because the Options step seeds an unset value with the *first* item [VERIFIED `loadConnectorServiceOptions`, da-nx@a1bd8ec]), `autoStart` (static yes/no). Items are `{ value, label }`; a fetch failure resolves to `[]` (generic case C11). Sheet keys with the same names under `translation.service.{env}.` give the defaults and are what the sample sets (the Options step spreads the env config into `service`) [VERIFIED `options.js`: `service = { name, ...envConfig, org, site, env }`].
27. **Chunking.** A send whose pages exceed a page-count or total-byte threshold becomes several project parts, created one after another; a part failure leaves earlier parts intact and reports which pages failed; a re-send creates parts only for pages lacking a live job. XTM states there is "no actual size limitation" on API uploads but a timeout may occur while the upload continues server-side [VERIFIED XTM-FAQ "Is there a limit to the amount of files or file size"], and the worker buffers multipart bodies (128 MB isolate memory, replayable for retries). Defaults are small enough to keep one part comfortably below those bounds [ASSUMPTION: 50 pages / 8 MiB per part; tuned by XL5 and XL9; Open Question 11].
28. **Provider isolation (AC7).** The XTM change set is `providers/xtm/**` plus three registration touch points outside it, all one-liners that #4 already designed for additional providers: the extension worker entry registers the XTM route module (#2 Decision 3), the extension README lists the provider, and the CI globs already cover `providers/*/`. A review checklist item and a path-filtered diff check enforce that nothing else in the extension shell changes.
29. **Documentation (AC6, AC8).** The provider README documents: prerequisites in XTM (API licence and "Access through: User Interface and API" or "Only API" on the user [VERIFIED XTM-START], a user with the **Project manager** role even if an administrator [VERIFIED Blackbird docs; ASSUMPTION it applies to the worker's calls], the numeric user id and where to find it [VERIFIED XTM-START: Users, info icon]); worker variables and secrets; the sheet keys; a `translate.json` sample; worker deploy and secret commands (by reference to the #2 README); how to read status; cancel semantics; cost and privacy notes. A machine-readable copy of the sample sheet lives next to the README and is parsed by a test.
30. **Worker config.** Non-secret `vars`: `XTM_API_BASE` (full base URL including the REST path, `https` only, host is the single allowed upstream host), `XTM_CLIENT` (company name), `XTM_USER_ID` (numeric), `XTM_ALLOWED_CUSTOMER_IDS` (comma list; empty means every customer is refused), plus #2's `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS`. Secrets (`secrets.required`): `XTM_PASSWORD`, `XTM_REF_KEY` (the MAC key of Decision 12). The XTM REST path prefix differs in the documentation between hosted and dedicated instances (`/project-manager-api-rest` in the OpenAPI `servers` entry; `/rest-api` in the sample code) [VERIFIED both strings in XTM-OAS], so the full base is configuration, not code [OPEN: Open Question 17].
31. **Worker amendments needed beyond what #4 already asks of #2 (#4 Open Question 8).** (a) a **derived-credential auth hook** (an async function that turns secrets into the outbound header value, with the derived value registered for redaction) because the proxy helper's "inject a secret by name" cannot express XTM-Basic; (b) the #4 requests (replayable multipart, per-route body cap, buffered response, per-route retry/idempotency flags, extension-defined error codes) apply unchanged; (c) binary upstream response handling for the ZIP route. If #2 declines (a), the XTM routes implement it inside `providers/xtm/worker/` using the redaction registry [OPEN: Open Question 4].
32. **Extension-defined error codes** (beyond #2's fixed list, same mechanism as #4): `vendor_auth_failed` (XTM refused the worker's credentials; deliberately **not** `401`, which the browser reads as "your Adobe session is not valid"), `vendor_forbidden` (XTM `403`: access disabled, IP/VPN restriction [VERIFIED XTM-DOCS HTTP codes: "instance is blocking your access ... behind a VPN"]), `vendor_rejected` (XTM `400`/`422`; carries only a field name from a fixed pattern, never XTM text), `project_not_found`, `file_not_ready`, `bad_archive`, `customer_not_allowed`.

### Worker retry policy (per route)

| Route | Retry on `429` | Retry on `5xx`/timeout | Why |
|---|---|---|---|
| token exchange, `GET` lookups (system, languages, customers, workflows, templates, status, file status, file download) | yes | yes | idempotent reads / stateless |
| create project | yes | adopt-then-retry-once (Decision 13) | not blindly repeatable |
| start workflow | yes | no (next status check retries) | repeat effect unknown |
| generate files | yes | yes (safe-to-retry flag) | creates files only; duplicates harmless |
| cancel jobs | yes | yes (safe-to-retry flag) | idempotent by definition |

## Testing Decisions

**What makes a good test here.** As in #4: assert external behaviour only (return values, messages, persisted JSON state, requests that reach XTM or the worker, concurrency, what the browser ever receives). Never assert on helper names or internal call counts. Two negative properties hold on every path: **no XTM secret (password, derived token, MAC key) anywhere** and **no XTM call before a verified IMS token**. All delays use a fake clock. XTM-specific additions: **no project created twice**, **no page saved before the last workflow step**, **no page ever saved to another page's destination**.

**Proposed seams** (recorded instead of asked). No new seam is introduced; XTM reuses #4's. The highest seam is the same.

| # | Seam | Status | Used by | What is faked |
|---|---|---|---|---|
| T1 (primary) | **Connector contract surface** (exported functions with da-nx-shaped args, all I/O at `window.fetch`, state as plain JSON) | reused from #4 | WTR: generic contract suite C1-C16 + XTM cases X* | the vendor backend via the XTM adapter (in-process real worker + fake XTM), IMS (`imsAuthHeader`), `saveFn`/`sendMessage`/`saveState`, clock |
| T2 | **Worker HTTP boundary** `worker.fetch(request, env, ctx)` for the XTM routes | reused (#2 W1, #4 T2) | `node:test` worker tests XW* | fake IMS key server and token factory, **fake XTM** at the injected `fetch` |
| T3 | **Full stack over real HTTP** (page on `localhost:3000` -> `wrangler dev` worker -> fake XTM server) | reused (#1 S1, #2 W2, #4 T3) | Playwright hermetic tier XE* | fake XTM process, fake IMS key server, stub token |
| T4 | **Repo convention / file checks** | reused (#1 S3, #4 U3), extended | CI lint job | filesystem fixtures, the sample config file |
| L | **Real XTM sandbox** through the deployed stage worker | manual/opt-in, not CI | live script XL*, manual EW steps XM* | none |

**The fake XTM.** A pure model (like #4's fake DeepL), wired three ways without being rewritten: injected `fetch` under the worker (T2), an HTTP server (T3), and the vendor end of the in-process backend (T1). It models: token endpoint (the token encodes the credentials; calls with a token for wrong credentials get `401`), customers, workflows with ordered steps (translate, review, approve), project templates, project creation with strict form validation (indexed `translationFiles[n].*`, forbidden characters in names, description cap, required `customerId`), per-file target languages, job creation (one per file x language, ids assigned by the fake and returned in shuffled order), an analysis state machine (`IN_PROGRESS` -> `FINISHED`), workflow start (rejected before analysis when configured), step progression driven by `controls`, file generation (asynchronous with `IN_PROGRESS` -> `FINISHED`/`ERROR`), ZIP download (a real ZIP writer: stored and deflate), the `xtm-file-descrption` header, jobs cancel, project listing by name, scripted `429`/`5xx`/`401`/`403`/`422`, a created-then-`503` mode (the project exists but the response is lost), a deterministic "translation" (prefixes translatable text with the target code; honours `translate="no"` in switchable modes *honoured* / *ignored*), and a recorder for every request including maximum in-flight requests. Self-tests (XF1-XF8) keep it from drifting from the documented behaviour it claims to model.

**Capability flags declared to the harness** (#4 adapter interface): `cancel: true`, `serviceOptions: true`, `granularity: 'job'` (status known per page x language, with workflow steps) [ASSUMPTION: #4 defines `job` as that; reconcile if it means project-level only], `download: 'repeatable'` [ASSUMPTION; XL8], `idempotentResend: true` (only pages without a live job are re-sent).

**Modules tested:** XTM connector (language mapping, manifest and file naming, job mapping, persisted state, chunking, create-or-adopt effects, analysis/start, step-aware status, save pipeline, cancel, service options, connection, origin handling, size guard, static no-secret check); XTM worker routes (auth, CORS, token exchange, allowlists, signed project refs, create-or-adopt, retries, ZIP extraction, error mapping, redaction); fake XTM (self-tests); in-process integration; hermetic e2e; the sample config file; the provider-isolation check.

**Prior art:** #4's T1 pattern (da-nx's Smartling connector test: `window.fetch` stub + sinon fake clock, https://github.com/adobe/da-nx/blob/main/test/loc/connectors/smartling/index.test.js); #2's worker test kit; #4's fake DeepL as the structural model for the fake XTM. Upstream `adobe-rnd/ew-extensions` has no connector or worker code [VERIFIED by #2 and #4 via the GitHub tree API], so there is no repo-local prior art for a project/workflow vendor.

## Out of Scope

- Everything #4 excludes (Adobe-hosted proxy, CI deploy, KV/R2 storage, automatic status timers, per-site credentials in the credential sheet).
- XTM features beyond create / start / status / generate+download / cancel / lookups: translation memory and terminology management, LQA, costs and quotes, rate cards, user and linguist administration, project callbacks and webhooks (the EW app polls on *Get status*), reference materials, custom fields, tags, pre-processing (`newSource*`), SOAP API, XTM Portal, AI translation settings, BYO-AI.
- OAuth 2.0 / PKCE / SAML authentication (documented as a follow-up; Decision 10).
- Assigning linguists through the API (`workflow/assign`): assignment comes from the XTM template or from project managers.
- Due dates (`translation.service.supports.duedate`) [OPEN: Open Question 15].
- Early-save policies (saving at an intermediate step); v1 saves only after the final step.
- Deactivating, archiving or deleting XTM projects.
- Persisting unsaved translations server-side (needless here: XTM keeps the files).
- A custom UI, an EW app or library plugin.

## Further Notes

1. **Conformance of XTM to Adobe's connector requirements (EW-CONN).** Adobe builds connectors only for services meeting these; the table records the evidence so a PR to `adobe/da-nx` or a request to Adobe has the answer ready.

   | Adobe requirement (EW-CONN) | XTM evidence | Result |
   |---|---|---|
   | Cloud-hosted, public HTTPS; no VPN-only/IP-allowlisted instances | `https://api.xtm-cloud.com` public; XTM KB says some instances sit behind VPN and answer `403` [VERIFIED XTM-DOCS] | OK for public instances; **VPN/IP-restricted dedicated instances cannot be used** |
   | Documented REST API: create project, upload sources, start, status, download | all present (XTM-OAS paths: `POST /projects`, `POST /projects/{id}/workflow/start`, `GET /projects/{id}/status`, `POST .../files/generate`, `GET .../files/{id}/download`) | OK |
   | Status must reflect translator/reviewer work; download returns latest reviewed content | step-level status (`fetchLevel=STEPS`) and generate-from-current-state; behaviour of the downloaded content after a review edit is confirmed only by live check XL10 | OK by design, verify live |
   | Non-interactive auth (client credentials, API key/token) | XTM-Basic token from stored credentials; OAuth password flow available | OK |
   | Standard language/locale codes with a defined source language | XTM `xx_YY` locale codes; project has `sourceLanguage` | OK with mapping (Decision 22) |
   | Rate limits tolerate bursts; `429`/`5xx` retry; five concurrent downloads | `429` is **not documented**; KB recommends at most 50 GET/min [VERIFIED XTM-FAQ] | **Unverified**; XL9; recommended-limit tension in R8 |
   | Stable id per uploaded file and per translated output | `sourceFileId`, `jobId`, generated `fileId` | OK |
   | Terminal states for finished, failed, cancelled | job `FINISHED`/`ERROR`/`CANCELLED`/`DELETED` [VERIFIED XTM-OAS `RSJobStatusResponse`] | OK |
   | HTML in, markup preserved, `translate="no"` untranslated | not documented for XTM's default HTML filter | **Open** (XL3, XL4) |
   | Optional: cancel; list projects/workflows/templates for dropdowns | jobs cancel; `GET /workflows`, `GET /projects/templates`, `GET /customers` | OK |

2. **Host-reachability** (the Translate app only loads connectors that exist inside da-nx) is inherited from #4 Further Note 1 and its Open Question 1; it shapes AC9 identically here and is not re-decided.
3. **Two retry layers, one cost.** Because XTM projects spend real money, retry policy is deliberately more careful than for DeepL (Decisions 13 and the retry table).
4. **Sandbox availability is unknown.** XTM's KB links to an `api-test.xtm-intl.com` documentation host [VERIFIED link text, XTM-FAQ]; whether a customer-facing sandbox tenant exists, or a trial must be requested from XTM, was not found [OPEN: Open Question 1]. The API requires an API licence on the user [VERIFIED XTM-START].
5. **Why the status text stays in the styled vocabulary.** The host draws a coloured pill from the status text (`is-in-progress`, `is-translated` ...), and uses `translated`/`complete` to trigger saving; any other string (for example `62% translated`) renders unstyled [VERIFIED `translate.css`, `translate.js`, da-nx@a1bd8ec]. Reviewer detail therefore travels in messages.

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace
 └─ Translate app (da-nx nx/blocks/loc)    page origin https://da.live
      │  dynamic import  connectors/xtm/index.js      <- must exist inside da-nx (#4 Further Note 1)
      │  Authorization: Bearer <IMS token> via imsAuthHeader()
      ▼  fetch  {origin}/translate/xtm/{org}/{site}/...      (cross-origin: preflight)
   Cloudflare Worker   apps/translation-connectors/worker  (+ routes from providers/xtm/worker)
      1 origin gate + preflight  2 IMS token check  3 route + field allowlists + signed projectRef
      4 XTM token exchange (XTM_PASSWORD)  5 proxy with per-route retry  6 ZIP -> HTML
      ▼
   XTM Cloud REST API   {XTM_API_BASE}  e.g. https://api.xtm-cloud.com/project-manager-api-rest
        (humans work in XTM: translate -> review -> approve ...; the connector only observes steps)
```

| Concern | Connector (browser, da-nx-shaped code) | Worker (private, secrets) |
|---|---|---|
| XTM credentials, derived token, MAC key | never | only place |
| User identity | gets IMS token via `imsAuthHeader()`, sends it | verifies it (#2); records user id in the XTM project description |
| Submission/part grouping, persisted state, mapping page->job->file | all | none (stateless) except create-or-adopt by name |
| Language-code mapping, pre-flight, file naming, chunking | all | validates code/name patterns |
| Project signing (projectRef) | stores and sends it | mints and verifies it |
| XTM wire format (multipart arrays, query lists, ZIP) | none | all |
| Status aggregation (steps -> language status) | all | normalises XTM JSON only |
| Retries | da-nx `fetchWithRetry` (429/5xx), `downloadQueue` (5) | #2 `proxy`, per-route policy |
| DNT add/remove | shared `addDnt`/`removeDnt` | never parses page content |
| Workflow execution (translate/review) | none | none; done by XTM linguists |

## 2. EW integration points

- **Type and registration:** type `connector` (extension-level, from #4); registered by `translation.service.name = XTM` (folder `xtm`) in `{org}/{site}/.da/translate`, `config` tab [VERIFIED EW-CONFIG]. No `apps`/`library` sheet row.
- **Config keys read** (`translation.service.{env}.`): `origin` (worker base, required), `link` (XTM instance URL shown to authors, optional), `customerId`, `workflowId`, `templateId`, `autoStart`, `languageMap`, optional `filterTemplateId`. Read from options at send time: `source.language` (code). Keys never read: any XTM credential (none exist in the sheet). The existing connectors keep credentials in the sheet or a credential sheet (EW-CONFIG "Protect service credentials"); this connector deliberately does not (AC10).
- **SDK actions:** none; a connector has no SDK handshake (#4 Decision 14).
- **Host calls into the connector** [VERIFIED da-nx@a1bd8ec]: `setupService` (`isConnected`), `handleConnect` (`connect`), `fetchUrls` (`connector.dnt.addDnt`), `handleSendAll` (`sendAllLanguages` via `sendAllForTranslation`, which short-circuits on per-url fetch errors), `handleGetStatus` (`getStatusAll` then `checkAndSaveLangs` -> `saveItems` for languages with status `translated`/`complete`), `cancelLang` (`cancelTranslation`, host sets a transient `cancelling` status and restores it on `{ ok: false }`), Options step (`connect(service)` then each `serviceOptions[].fetch(service)`).
- **`ref=local` (as redefined in #4):** local da-nx with the connector (or the upstream bundle) in `nx/blocks/loc/connectors/xtm/`, `?nx=local`; worker is the **deployed stage worker** (HTTPS page to localhost worker is unreliable, #2 R11).
- **Branch ref:** per #4 Further Note 1 and Open Question 1; the worker is not branch-sensitive.

## 3. External APIs and auth flows

All XTM calls are relative to `XTM_API_BASE` (the REST path prefix `/project-manager-api-rest`). Primary source for every row: **XTM-OAS** (https://api.xtm-cloud.com/project-manager-api-rest/documentation/xtm-docs, `info.version 26.5`).

| Operation | Method + path | Notes |
|---|---|---|
| Generate token (XTM-Basic) | `POST /auth/token`, JSON `{client, userId, password}` -> `{token}` | then header `Authorization: XTM-Basic <token>`; token "permanent"; generated even for invalid credentials, fails on first real call (XTM-START) |
| (Future) OAuth password flow | `POST authentication-api/oauth/token`, `Authorization: Basic Base64(CLIENT_ID:CLIENT_SECRET)`, form `grant_type=password`, `username=CLIENTNAME:USERNAME` | needs registration with XTM support; Bearer token afterwards |
| System details | `GET /system` -> `{companyName, website, logo, version}` | connectivity/auth probe |
| Language codes | `GET /languages/language-codes` -> `{languageCodesToDescriptors}` | 983 codes in the doc list; underscore locale form |
| Customers / workflows / templates | `GET /customers?activity=ACTIVE` -> `[{id,name,activity}]`; `GET /workflows` -> `[{id,name,steps}]`; `GET /projects/templates?customerIds=` -> `[{id,name,customerId}]` | dropdowns |
| Create project | `POST /projects`, `multipart/form-data`: `name`, `customerId`, `sourceLanguage`, `targetLanguages`, `workflowId` or `templateId`, `translationFiles[n].file/.name/.targetLanguages`, ... -> `201 {projectId, name, jobs:[{jobId,fileName,sourceFileId,sourceLanguage,targetLanguage}]}` | "must either include sourceLanguage, targetLanguages and workflowId or templateId"; name/customerId always required |
| Project list (adopt) | `GET /projects?name=&customerIds=&createdDateFrom=` -> `[{id,name,status,jobs?}]` | filter semantics to confirm (XL11) |
| Analysis status | `GET /projects/{id}/analysis` -> `{status: IN_PROGRESS\|PARTIALLY_FINISHED\|FINISHED, jobs}` | FAQ: query rarely, prefer callbacks (we cannot: browser app) |
| Start workflow | `POST /projects/{id}/workflow/start[?jobIds&targetLanguages]` | "activates the first workflow step for all the jobs" |
| Project/job/step status | `GET /projects/{id}/status?fetchLevel=STEPS` -> `{completionStatus, activity, jobs:[{jobId,completionStatus,fileName,sourceFileId,targetLanguage,steps:[{displayStepName,referenceStepName,status,autoStatus,finishDate}]}]}` | job `completionStatus` in `IN_PROGRESS, FINISHED, ERROR, CANCELLED, DELETED`; step `status` in `IN_PROGRESS, FINISHED, NOT_STARTED` |
| Generate files | `POST /projects/{id}/files/generate?fileType=TARGET&jobIds=...` -> `[{fileId,jobId,fileType}]` | required query: `fileType`; jobs scope by `jobIds` |
| Generated file status | `GET /projects/{id}/files/status?fileScope=JOB&fileIds=...` -> `[{fileId,jobId,status,message}]` | `IN_PROGRESS, FINISHED, ERROR, WARNING, UNKNOWN` |
| Download file | `GET /projects/{id}/files/{fileId}/download?fileScope=JOB` -> ZIP (`application/octet-stream`), header `xtm-file-descrption` (JSON: fileName, fileId, jobId, targetLanguage) | header name as spelled in XTM-OAS |
| Cancel jobs | `POST /projects/{id}/jobs/cancel?jobIds=...` | "cancels processing of jobs without removing them" |
| Trace headers | responses carry `xtm-trace-id`, `xtm-span-id` | logged for XTM support tickets |
| Error body | `{"reason": "...", "incorrectParameters": "FIELD"}` | seen in XTM-FAQ for a 400 |

Other primary sources: XTM-FAQ (50 GETs/min recommendation; poll analysis every 10-15 minutes; no file-count limit; array form-data naming; 2000-char description limit), XTM-START (credential prerequisites: API licence, Access through ...; numeric user id from Users -> info icon; first call `GET /system`), XTM-DOCS (HTTP code meanings incl. VPN `403`; instance-specific documentation at `<instance>/rest-api`), EW-CONN (requirements), EW-CONFIG/EW-SAMPLES (sheet keys, sample structure), https://developers.cloudflare.com/workers/platform/limits/ (128 MB memory, subrequests 50 on Free, request body 100 MB), https://developers.cloudflare.com/workers/runtime-apis/web-standards (DecompressionStream).

**Flows.** Caller to worker: IMS token as in #2. Worker to XTM: exchange stored credentials for an XTM token on first use, cache per isolate, regenerate once on `401`; the caller's token is never forwarded. Browser to worker for results: raw HTML bytes, `Content-Type: text/html`.

## 4. Data contracts

**Persisted project state (behavioural; JSON-serialisable; per language in `lang.translation`)** extends #4's table:

| Where | Field | Meaning |
|---|---|---|
| `lang.translation` | `submissionId` | connector-generated group id (same meaning as #4) |
| `lang.translation` | `sent`, `translated`, `status` | as #4 (status in the styled vocabulary) |
| `lang.translation` | `steps` | non-UI summary `{ stepDisplayName: pageCount }` from the last status check |
| `lang.translation.projects[projectRef]` | `part`, `analysed`, `started`, `cancelRequested` | per XTM project part; `analysed`/`started` flags are set only after XTM confirms |
| `lang.translation.items[daBasePath]` | `projectRef`, `jobId`, `fileId?`, `state`, `step?`, `error?` | page x language; `state` in `queued`, `in progress`, `done`, `saved`, `error`, `cancelled` |
| `service` | `origin`, `customerId`, `workflowId`, `templateId`, `autoStart`, `languageMap`, `filterTemplateId` | from sheet / Options step |

`projectRef` is opaque to the browser (Decision 12). No XTM credential, token or MAC key is ever stored.

**Proxy contract request/response shapes** (camelCase JSON unless stated):
- `POST /projects`: multipart `manifest` = `{ name, referenceId, title, sourceLanguage, targetLanguages[], customerId, workflowId | templateId, filterTemplateId?, files:[{ part: "file0", name, targetLanguages[] }] }` plus parts `file0..fileN` (HTML); reply `{ projectRef, name, adopted: boolean, jobs:[{ jobId, fileName, sourceFileId, targetLanguage }] }`.
- `GET /projects/{ref}/status`: `{ analysis: "IN_PROGRESS|PARTIALLY_FINISHED|FINISHED", completion: "IN_PROGRESS|PARTIALLY_FINISHED|FINISHED", jobs:[{ jobId, fileName, targetLanguage, state, steps:[{ name, referenceName, status }] }] }`.
- `POST /projects/{ref}/start`: `{ started: true }`.
- `POST /projects/{ref}/files` `{ jobIds[] }` -> `{ files:[{ fileId, jobId }] }`; `GET .../files/status?fileIds=` -> `{ files:[{ fileId, jobId, status, message? }] }`; `GET .../files/{fileId}` -> HTML bytes, response header `x-xtm-job-id` (exposed through CORS) carrying the job id XTM reported for that file.
- `POST /projects/{ref}/cancel` `{ jobIds[] }` -> `{ cancelled: true }`.
- `GET /system` -> `{ companyName, version }`; `GET /languages` -> `{ codes:[...] }`; `GET /customers`, `/workflows`, `/templates` -> `[{ id, name }]`.
- Errors: #2 contract plus Decision 32 codes.

**Worker config:** vars `XTM_API_BASE`, `XTM_CLIENT`, `XTM_USER_ID`, `XTM_ALLOWED_CUSTOMER_IDS` (+ #2's); secrets `XTM_PASSWORD`, `XTM_REF_KEY`. Env file template lists secret names only.

**Site config sample (AC6; README deliverable plus a parsed JSON copy):** `config` tab with the general keys EW samples carry (the four `*.conflict.behavior` keys; `translation.service.name = XTM`; `translation.service.all.env = stage, prod`; per environment `translation.service.{env}.origin` pointing at the stage/prod worker, `.link` to the XTM instance, `.customerId`, `.workflowId`, optional `.templateId`, `.autoStart`), and a `languages` tab with at least `en` (source), `de`, `fr`, `ja`, `zh-CN`, `zh-TW` (name, code, location, actions `Skip, Translate`, `translate type`). No credential keys. Structure copied from Adobe's samples (EW-SAMPLES; machine form `.../translation-config-samples/smartling-language.json`, read 2026-11-16: tabs `config`, `languages`, `custom-doc-rules`, `dnt-content-rules`, `dnt-sheet-rules`, columns `key`/`value`/`description`).

## 5. Folder layout (proposed; fits #1, #2, #4)

```
apps/translation-connectors/providers/xtm/
├─ SPEC.md                           this file
├─ README.md                         XTM prerequisites, worker vars/secrets, sheet keys + sample, status semantics, cancel, live-check + EW steps, cost/privacy
├─ translate.sample.json             machine-readable sample sheet (parsed by test XS1)
├─ index.js (+ helpers)              connector (drop-in layout for nx/blocks/loc/connectors/xtm/)
├─ worker/                           XTM route module registered by the extension worker: auth exchange, routes, ZIP reader, projectRef signing
├─ fake/                             fake XTM model + http server + fetch adapter + in-process backend + adapter for the harness
└─ test/                             contract.test.js (harness), xtm.test.js, worker tests, integration, e2e specs, sample/isolation checks
apps/translation-connectors/worker/  (existing, #4) entry gains one registration line for providers/xtm/worker
apps/translation-connectors/harness/ (existing, #4) unchanged by this ticket
```

Registration touch points outside the folder (and nothing else): the worker entry line, the extension README provider list, nothing in `harness/`, `shared/`, or other providers.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Host reachability** (connector only loadable from inside da-nx). Inherited from #4 R1; blocks AC4 (production), AC9 (branch). | High | #4's local-da-nx loop and upstream PR route; Open Question 13. |
| R2 | **`translate="no"` not honoured by XTM's default HTML filter**; markup/charset fidelity unknown. | High for AC2 | Spike XS-S2/XL3/XL4 first; F0/F1/F2 ladder (Decision 23). |
| R3 | **No XTM sandbox / API licence / human linguist for the reviewer-step test.** | High, blocks AC4 live | Owner provides tenant; test strategy minimises linguist effort (one reviewer pass); Open Question 1. |
| R4 | **Duplicate paid projects** from a retried create. | High (money) | Create-or-adopt by name (Decision 13), tests XW7/X7/XI4, live XL11. |
| R5 | **Shared PM-level XTM account** exposes the whole tenant to any authenticated caller. | High | Signed projectRef (Decision 12), customer allowlist, `authorize` hook, dedicated API user; Open Questions 6, 16. |
| R6 | **Save before review ends** (wrong status semantics) puts unreviewed text into the site. | High | `translated` only when every job is `FINISHED`; tests X8, X10, C5; live XL10. |
| R7 | **Wrong page mapping** through four id hops and XTM possibly renaming files. | High | Mapping from create response with exact file-name + language match, loud failure otherwise, job-id cross-check at download; tests X4, X12, C7. |
| R8 | **XTM rate limits are undocumented** (`429` absent from XTM's code list; KB recommends at most 50 GET/min) versus EW's five concurrent downloads and user-driven polling. | Medium | Retry layers per AC3; measure in XL9; pacing option if needed; large languages (hundreds of pages) flagged in README. |
| R9 | **Start-workflow timing and idempotency unknown** (before analysis; repeat start). | Medium | Persisted `started`, retry next status check, XL7; template auto-start documented as alternative. |
| R10 | **Bare language codes** (`de`, `fr`, `ja`) are not XTM codes; chosen defaults may not match a customer's TM/locale. | Medium | Default table + `languageMap` override + pre-flight failure; XL2; Open Question 5. |
| R11 | **Multipart array encoding** for string arrays and per-file `targetLanguages` not stated. | Medium | Spike XS-S1/XL5 with indexed and repeated forms in the fake and live. |
| R12 | **Derived-credential auth** is outside #2's `proxy` "secret by name" model; derived token must be redacted. | Medium | Template amendment or in-module registration (Decision 31); XW3/XW4. |
| R13 | **ZIP assumptions** (single entry, standard methods, zip-bomb bounds). | Medium | Strict reader, caps, XL8; XW11. |
| R14 | **da-nx drift** (managed status, option changes, helper edits). | Medium | #4's hash check and drop-in job; record the `da-nx@a1bd8ec` observations (Decision 7). |
| R15 | **Persistence assumption** (`lang.translation` mutated in `saveItems` persists; `items` size N x M with `projectRef` per item). | Medium | Spike S3 (inherited from #4); fallback per-url storage with `mergeUrls`. |
| R16 | **Adobe outside-activity/IP policy** and a personal Cloudflare account holding XTM credentials. | High for publishing | Carried from #1 R1/#2 R1; owner decision. |
| R17 | **Content privacy**: page HTML goes to XTM and then to human linguists; stage content must be non-confidential. | Medium | README; sandbox only with test content. |
| R18 | **Linguist assignment** is outside the connector: unassigned first step means "created/in progress" forever. | Medium | README (use a template with automatic assignment and start); status message says "waiting to start"; Open Question 8. |
| R19 | **Dedicated-instance URL form and VPN restrictions** (`/project-manager-api-rest` vs `/rest-api`; `403` behind VPN). | Low-Medium | Full base URL configurable; `vendor_forbidden` message; Open Question 17. |
| R20 | **Project name constraints** (forbidden characters; length unknown) and description cap 2000. | Low | Sanitiser, XL12. |

## 7. Ordered build plan (sized to #6's acceptance criteria)

0. **Owner prerequisites:** #4 implemented (harness, extension worker, DeepL provider, CI) and #2 deployed once; XTM sandbox tenant with API licence, a Project-manager API user (numeric id, password), a customer, a workflow with translate and review steps, optionally a template; a linguist (can be the same user) able to complete steps; Cloudflare account; da-nx clone. Answers to Open Questions 1-5 and 9.
1. **Spikes (time-boxed; results into the provider README and back into this spec where a decision changes):**
   - **XS-S1** (live): token exchange; create with indexed vs repeated array encoding; per-file `targetLanguages`; `templateId` plus explicit languages; job list shape; file-name echo. Fixes Decisions 14/15/16.
   - **XS-S2** (live): HTML `translate="no"` with default filter; markup/charset fidelity with `zh_CN`/`zh_TW`. Decides Decision 23 ladder; gates step 5.
   - **XS-S3** (live): analysis -> start timing and rejection shape; generate -> status -> download (ZIP shape, `xtm-file-descrption`, repeatable download); cancel behaviour; rate-limit burst.
   - **XS-S4** (offline): confirm the harness adapter can express `granularity: 'job'` and a project-with-steps fake without harness changes; confirm `DecompressionStream` + ZIP reader runs in workerd under `wrangler dev` (#2 W2 style).
2. **Fake XTM** (pure model, self-tests XF1-XF8, three wirings, adapter for the harness). AC5 foundation.
3. **XTM worker routes**, test-first (XW1-XW18) on the #2/#4 worker: token exchange, allowlists, signed refs, create-or-adopt, retry table, multipart conversion, ZIP reader, error mapping, redaction; entry registration; env file template. AC10 (server), AC3 (worker half).
4. **Connector skeleton + generic suite green:** contract surface, `isConnected`/`connect`, send, status, save, cancel against the adapter until C1-C16 pass. AC1, AC5.
5. **XTM-specific cases X1-X19** test-first: language mapping, file naming/manifest, job mapping, state, chunking, create-or-adopt effects, analysis/start, step-aware status, save pipeline with generate/poll/download, cancel, service options, connection, origin, size guard, static check. AC1-AC4 (offline), AC10 (browser).
6. **In-process integration (XI1-XI6) and hermetic e2e (XE1-XE4).** AC4 (offline round trip with `zh-CN`/`zh-TW`), AC10.
7. **README, sample config + its test (XS1), extension README provider entry, worker entry registration, isolation check (XS2).** AC6, AC7, AC8, AC11.
8. **Deploy stage worker; run live XL1-XL13 and manual EW XM0-XM10** with real Adobe login, an XTM sandbox user and a reviewer pass. Record results (observed `Origin`, actual limits) in the PR/README. AC4 (real), AC9, AC10 (deployed), AC2 (real).
9. **Hand-off notes** (README): what the harness learned from a workflow-step vendor, template amendments requested, remaining open items for #5.

---

# Testing Requirements

Runners as in #4: `@web/test-runner` (Chromium; harness resolver for da-nx-relative imports) for T1; `node:test` for T2; Playwright Chromium for T3; Node scripts for T4. A fetch guard fails any test reaching a real external host. A sinon fake clock drives every timing test (poll intervals, backoff, file-generation polling). **Case IDs:** `C*`, `H*` are #4's generic cases (reused unchanged); IDs below are XTM's and use prefix `X` to avoid collisions with #4's `D*`, `W*`, `I*`, `E*`, `L*`, `M*`.

## 1. Fixtures and mocks

- **Pages** (reuse #4's set where it exists): `html-basic` (headings, link, image), `html-dnt` (`<p translate="no">`, `<code>`, `<span translate="no" class="dnt-text">` inside translatable text), `html-entities` (named/numeric entities, `&nbsp;`, `<br>`, inline formatting), `html-cjk` (CJK text, path with spaces/CJK for file naming), `html-big` (just under/over the per-file cap), 12 pages for concurrency, 60 pages for chunking. Each has a unique marker so the fake's deterministic "translation" (prefix with the target code; leave `translate="no"` content untouched in *honoured* mode) proves ownership.
- **Languages:** `en` (source), `de`, `fr-FR`, `ja`, `pt-BR`, `zh-CN`, `zh-TW`, `zh-Hant`, `en-GB` (same-language trap against `en` only if the default table maps both to the same XTM code; otherwise a trap against `en-US`), `xx` (unmapped).
- **Fake XTM** (`providers/xtm/fake`): as described in Testing Decisions; canary `XTM_PASSWORD` value `canary-xtm-<random>`; token derived deterministically from the credentials so the canary-derived token is also known to the tests.
- **Backend adapters:** XTM in-process backend (real worker + fake XTM + fake IMS), plus the reference backend from #4.
- **Doubles:** `imsAuthHeader` returns a test-signed token; `saveFn`, `sendMessage`, `saveState` record calls; sample workflow `translate -> review -> approve` and a second single-step workflow.

## 2. Fake XTM self-tests (T2 infrastructure)

| ID | Behaviour asserted |
|---|---|
| XF1 | Token endpoint: valid credentials -> token; a token for other credentials gets `401` on any other route; token never accepted without the `XTM-Basic` scheme |
| XF2 | Project creation validates the form as XTM documents it (indexed `translationFiles[n].file`, forbidden name characters rejected with `400 {reason, incorrectParameters}`, description over 2000 characters rejected, missing `customerId` rejected, `workflowId` or `templateId` required) and returns jobs for every file x target language |
| XF3 | Analysis progresses with the fake clock; start is rejected before analysis finishes when configured; start after analysis activates step 1 |
| XF4 | Step progression only through `controls` (job moves translate -> review -> approve -> `FINISHED`); job `completionStatus` and step `status` follow the documented enums |
| XF5 | File generation is asynchronous (`IN_PROGRESS` -> `FINISHED`/`ERROR`); the download returns a ZIP that a reference unzip reads (stored and deflate variants), plus the `xtm-file-descrption` header with the right job id |
| XF6 | Scripted failures: `429` (with/without `Retry-After`), `5xx`, `401`, `403`, `422`; created-then-`503` mode leaves the project in place and lists it by name |
| XF7 | `translate="no"` *honoured* and *ignored* modes behave as named; the deterministic translation prefixes text with the XTM target code |
| XF8 | Request recorder captures method, URL, body, and maximum concurrent in-flight requests per route family |

## 3. Generic contract suite (T1; from #4, run for XTM unchanged)

C1-C16 run through the XTM adapter. Mapping of the generic cases to XTM-specific facts (the cases themselves are #4's; this column documents the expectation the adapter must meet):

| Case | XTM expectation the adapter supplies |
|---|---|
| C3 | the fake receives each page once per requested language (as jobs of one project part); content equals `url.content` byte for byte |
| C5 | `translated` only after the last workflow step of every job; vendor error -> `error`; terminal states not regressed; finished items not re-polled |
| C7 | create response, status and generate responses are returned in shuffled order; every destination still gets its own marker |
| C8 | 12 pages: maximum in-flight file downloads at the fake is exactly 5 |
| C9 | `429, 429, 200` and persistent `5xx` on status, generate and download; no retry on `400/403/404/422` |
| C10 | cancel marks language `cancelled`, calls the fake's cancel-jobs with that language's job ids only |
| C13 | JSON round trip of `langs` between create, status and save works |
| C14 | `translate="no"` fragment sent verbatim; fake in *honoured* mode leaves it unchanged; markup preserved |
| C16 | unmapped language fails alone, zero create traffic for it |

## 4. XTM connector cases (T1, provider-specific)

| ID | Behaviour asserted | Proves |
|---|---|---|
| X1 | Language mapping, table-driven through `sendAllLanguages`, inspecting the language codes the fake receives: `zh-CN`, `zh-Hans` -> `zh_CN`; `zh-TW`, `zh-Hant` -> `zh_TW`; `pt-BR` -> `pt_BR`; `fr-FR` -> `fr_FR`; bare `de`, `ja` -> default-locale table; case and `-`/`_` tolerant; source `en` mapped through the same table; sheet `languageMap` override wins | AC4 (zh), AC2 |
| X2 | Unmapped (`xx`), code absent from the fake's language list, or target equal to source: that language fails with a message naming it and **no** create request carries it; others proceed | AC4, story 15 |
| X3 | Manifest: one `.html` file per page, names ASCII-safe, unique, deterministic (same input -> same name), collision-disambiguated, length-capped; per-file `targetLanguages` equal exactly the languages requested for that page; content byte-identical; project `targetLanguages` is the union; customer/workflow/template taken from service; no extra fields | AC2, AC10 |
| X4 | Job mapping: create response with shuffled, extra and missing jobs; a missing (file, language) pair marks that page `error` and never borrows another's job; a renamed file in the response fails loud rather than mis-mapping | AC2 |
| X5 | Persisted state after send: `submissionId`, `projects[projectRef]`, `items[daBasePath] = { projectRef, jobId, state }` per language; JSON-serialisable; no XTM credential, token or MAC key anywhere in it; a second send creates a new part only for pages lacking a live job | AC2, story 24 |
| X6 | Chunking: 60 pages with a threshold of 25 -> three parts created sequentially; part 2 failing leaves part 1's items intact with a message naming pages of part 2; re-send creates only the missing part | AC4 (robustness) |
| X7 | Create-or-adopt effect: fake in created-then-`503` mode; after the connector's retries exactly **one** project exists at the fake and state references it | AC3, R4 |
| X8 | Status through steps: `translate` finished, `review` active -> language `in progress`, `translated` count counts finished jobs only, message names "Review" and counts; all jobs `FINISHED` -> `translated`; a reviewer-rejected job moving back to `translate` flips an earlier `done` page back to `in progress` until saved | AC2 (reviewed content), AC4 |
| X9 | Analysis and start: before analysis finishes status is `created` with the reason; after it finishes and `autoStart` is yes, start is called **once** and `started` persists; start rejected early -> retried on the next check; `autoStart = no` -> never called, message tells a project manager to start the project; already-started response treated as success | AC4 |
| X10 | Terminal and failure handling: `complete`/`cancelled` never regressed; job `ERROR`, step `autoStatus = ERROR`, job `DELETED` or externally `CANCELLED`, project `404` -> `error` with a message naming XTM's state; one failing status call surfaces a message and changes nothing | AC4 |
| X11 | Save pipeline: one generate call per part per language for jobs without a `fileId`; file status `IN_PROGRESS` -> page left unsaved with a "not ready" message and **no** re-generation on the next call; `ERROR` -> regenerated; `FINISHED` -> download by `fileId`; `removeDnt` applied; `saveFn` called once per page with `sourceContent`, `destination` untouched; every page gets a truthy `status` on every path | AC1, AC2, AC4 |
| X12 | Identity guard: a download whose reported job id differs from the stored one -> that page `error`, nothing saved; downloads use stored `fileId`s (shuffled file listing cannot mis-assign) | AC2 |
| X13 | Cancel: cancels only that language's non-`saved` job ids, marks language and pages `cancelled`, never calls generate/download afterwards, idempotent, other languages untouched; XTM failure -> `{ ok: false }` and state unchanged | AC1 |
| X14 | `serviceOptions`: `customerId` (active only), `workflowId`, `templateId` (first item "No template", empty value), `autoStart`; each item `{value,label}`; fetch failure resolves `[]`; works when `connect` is called without `sendMessage` | AC1 |
| X15 | `connect`/`isConnected` use the `system` route; IMS `401` -> "sign in to Adobe" message; `vendor_auth_failed` -> distinct "XTM refused the worker's credentials" message; unreachable worker -> false | AC1, AC10 |
| X16 | Origin handling: missing `origin` -> message, no request; non-HTTPS non-loopback refuses to send any token; base is `{origin}/translate/xtm/{org}/{site}`; a query override has no effect | AC10 |
| X17 | Static check: connector sources contain no `XTM-Basic`, no XTM host, no `Authorization` literal other than the IMS header; imports limited to da-nx-relative allowlist and the provider folder | AC7, AC10 |
| X18 | DNT: `html-dnt` sent verbatim; with the fake in *ignored* mode the connector's documented F0/F1 behaviour is observable (F1: `filterTemplateId` forwarded when configured); if F2 is built, a placeholder round trip restores the fragment exactly | AC2 |
| X19 | A page over the per-file cap is skipped with a message naming it and never sent; one just under is sent | AC2 |

## 5. XTM worker tests (T2, `node:test`, #2 test kit; fake XTM at the injected `fetch`)

| ID | Behaviour asserted | Proves |
|---|---|---|
| XW1 | **Every registered route**, iterated from the route table, answers `401` with no token and `401` for bad-signature/expired/wrong-type tokens; the fake XTM recorded **zero** requests, including zero token-exchange calls | AC10 |
| XW2 | Disallowed origins `403`; allowed origins get CORS on all responses incl. errors; multipart preflight needs no token; no custom request headers needed (`x-xtm-job-id` is a response header exposed via CORS) | AC10 |
| XW3 | Token exchange: first XTM-bound request obtains a token with the stored credentials; later requests reuse it (one exchange for N calls); upstream `401` triggers exactly one re-exchange and retry; persistent `401` -> `502 vendor_auth_failed`, never `401` to the browser; the caller's `Authorization` is never forwarded | AC10 |
| XW4 | Canary property: across success and every error path, neither `XTM_PASSWORD`, the **derived XTM token**, nor `XTM_REF_KEY` appears in any response body, header or log line, including when the fake echoes them in an error body | AC10 |
| XW5 | Create route allowlist: forwarded fields only (Decision 16); callbacks, project manager, custom fields, cost/AI options, `overrideFields`, reference files dropped; non-`.html` file -> `400`; over per-file or total cap -> `413` before any upstream call; `customerId` not on the allowed list -> `customer_not_allowed`; name sanitised; description built server-side with verified user id, org, site and the title, over 2000 characters truncated | AC10, AC2 |
| XW6 | **Signed project refs:** a ref minted for another org/site, a tampered ref, and a bare numeric id are rejected as `project_not_found` with zero upstream traffic on every project-scoped route; a valid ref passes; rotating `XTM_REF_KEY` invalidates old refs | AC10, R5 |
| XW7 | Create-or-adopt: fake created-then-`503` -> the worker finds the project by exact name, returns `adopted: true` with its jobs, **one** project at the fake; no match -> exactly one retry; `429` retried with backoff and no lookup; lookup returning a different customer's project of the same name is not adopted | AC3, R4 |
| XW8 | Retry matrix (table in Decisions): backoff schedule pinned with jitter bounds; `Retry-After` honoured when present; reads retried on `429`/`5xx`; start-workflow retried on `429` only; cancel and generate retried on `5xx`; `400/401/403/404/422` not retried | AC3 |
| XW9 | Multipart conversion: the fake sees `translationFiles[n].file/.name/.targetLanguages` in ascending index, files byte-identical, and every retry attempt replays byte-identical bodies | AC3, AC2 |
| XW10 | Status normalisation: analysis and job/step JSON mapped to the camelCase contract; unknown fields dropped; step and job enums passed through exactly | AC1 |
| XW11 | ZIP route: stored and deflate single-entry archives -> exact HTML bytes with `x-xtm-job-id`; zero or multiple entries, encrypted entries, oversize uncompressed content, malformed archive -> `bad_archive`; entry names (including `../`) never used; response fully buffered | AC2, AC3 |
| XW12 | Id and URL safety: ids numeric only; encoded traversal (`..%2f`, `%00`) rejected before URL building; upstream host is exactly the configured `XTM_API_BASE` host; non-`https` base (non-loopback) -> `500 misconfigured`; redirects not followed; `fileType` fixed to `TARGET` (a caller-supplied type is ignored or rejected) | AC10 |
| XW13 | Error mapping: XTM `400/422` -> `vendor_rejected` with an allowlisted field name only; `403` -> `vendor_forbidden`; `404` -> `project_not_found`; `5xx`/`503` -> `upstream_unavailable`; no upstream text forwarded; `xtm-trace-id` logged | AC3, AC10 |
| XW14 | Config guard: missing `XTM_PASSWORD` or `XTM_REF_KEY` -> `500 misconfigured`, generic; empty `XTM_ALLOWED_CUSTOMER_IDS` refuses all customers | AC10 |
| XW15 | If the #2 `authorize` hook is enabled: failing DA read check -> `403`; hook not run for unauthenticated requests; DA outage fails closed | AC10 |
| XW16 | Lookup routes: customers filtered to active and to the allowed list; workflows and templates mapped to `{id,name}`; languages list passed through as a sorted array; all `Cache-Control: no-store` | AC1 |
| XW17 | Generate and cancel routes: `jobIds` numeric lists with a size cap, chunked upstream if needed; empty list -> `400`; job ids not belonging to the project are refused by the fake and surfaced as `vendor_rejected`, not retried | AC10 |
| XW18 | Static check on worker sources: no outbound host literal other than via config, no `console.log` of headers or bodies | AC10 |

## 6. Integration and end-to-end (T1 in-process backend; T3)

| ID | Behaviour asserted | Proves |
|---|---|---|
| XI1 | Real connector + real worker (in-process) + fake XTM: send 3 pages x `de, zh-CN, zh-TW`; progress steps translate -> review -> approve with `controls`; `getStatusAll` shows `in progress` with step messages, then `translated`; `saveItems`; each destination holds its own marker translation; the fake saw `zh_CN` and `zh_TW` | AC4, AC2 |
| XI2 | Token missing/invalid on the connector side -> `isConnected` false; the fake saw no traffic | AC10 |
| XI3 | Canary XTM password, derived token and MAC key never observed by anything the connector can read (responses, headers, console, persisted state) | AC10 |
| XI4 | Created-then-`503` during send: exactly one project; state references it; a repeated *Translate all* does not create another | AC3 |
| XI5 | Cancel `fr` mid-way then reload state: no downloads for `fr`, status stays `cancelled`; `de` continues and saves | AC1 |
| XI6 | Reload mid-way (JSON round trip into a fresh module): status and save complete; a project already started is not started again | AC4 |
| XI7 | Maximum simultaneous downloads at the fake never exceeds 5 across the whole save; creates are sequential | AC3 |
| XE1 | Playwright: page on `localhost:3000` loads the connector with da-nx shims and calls a real `wrangler dev` worker on `:8787` backed by the fake XTM HTTP server: full round trip including a real cross-origin multipart upload preflight | AC4, AC10 |
| XE2 | Same page without a token: worker `401` readable by the page (CORS on errors); fake XTM saw zero requests | AC10 |
| XE3 | Origin `https://evil.example` -> `403`; no key, token, project id or file id leaked in any network response or the DOM | AC10 |
| XE4 | Only expected hosts contacted (page, worker, fake XTM); never a real XTM host | AC10 |

## 7. Repo and file checks (T4)

| ID | Behaviour asserted | Proves |
|---|---|---|
| XS1 | `translate.sample.json` parses as an EW sheet workbook (tabs `config`, `languages`); `config` has `translation.service.name = XTM`, `translation.service.all.env`, per environment `origin`, `customerId`, `workflowId`; `languages` has `en` plus `de`, `fr`, `ja`, `zh-CN`, `zh-TW`; **no** key whose name contains `secret`, `password`, `token`, `key` (outside `translation.service.key.path`, which must be absent) | AC6, AC8, AC10 |
| XS2 | Provider isolation: the diff of the #6 change set against the base touches only `providers/xtm/**`, the worker-entry registration line, and the extension README provider list; any file in `harness/`, `shared/`, or another provider fails | AC7 |
| XS3 | README checklist (scripted grep): sections for XTM prerequisites (API licence, user role, numeric user id), worker vars and secrets, sheet keys, the sample, status semantics, cancel semantics, privacy/cost note; every config key the connector reads appears in the README's key table | AC8, AC6 |
| XS4 | Convention check (#4 U3) passes for `providers/xtm`; `worker/` completeness rules from #2 apply to the registered routes; wrangler config lists `XTM_PASSWORD` and `XTM_REF_KEY` under `secrets.required` and not under `vars`; `.dev.vars.example` lists both | AC7, AC10 |
| XS5 | Upstream bundle (#4 U1/U2) produces `nx/blocks/loc/connectors/xtm/*` and its test with import-path rewrites only; advisory drop-in job passes against the pinned da-nx commit | AC7 |

## 8. Live sandbox checks (XL; opt-in script; needs an XTM sandbox user through the deployed stage worker; budget: a handful of tiny pages, a few hundred characters each, linguist time for one translate and one review pass)

| ID | Behaviour asserted | Proves / decides |
|---|---|---|
| XL1 | `GET /system` succeeds with the API user; record role and licence prerequisites that were actually required; a wrong password yields `vendor_auth_failed` | AC10, README accuracy |
| XL2 | `GET /languages` contains `zh_CN`, `zh_TW` and every default-table code (`de_DE`, `fr_FR`, `ja_JP`, `ko_KR`, ...); records which bare codes exist; confirms the default table | AC4 (zh), R10 |
| XL3 | **HTML with `<p translate="no">` and a `translate="no"` span** through the default filter: marked content unchanged? Also repeated with `filterTemplateId` pointing at a filter that honours it, if one exists | AC2; decides Decision 23 ladder |
| XL4 | Markup and charset fidelity: tag/attribute diff on `html-entities` and `html-cjk` round trip; output encoding; whitespace normalisation | AC2 |
| XL5 | Create variants: array encoding for `targetLanguages` (indexed vs repeated), per-file `targetLanguages`, `templateId` with explicit languages, upload of 25 pages x 3 languages in one call; time and size | Decisions 14/15/27 |
| XL6 | File-name echo and job list: `jobs[].fileName` equals the sent name (including collision suffix, CJK, long names); name and description limits | AC2, R20 |
| XL7 | Analysis -> start: is start accepted before analysis ends; response when started twice; template auto-start behaviour | Decision 17, R9 |
| XL8 | Generate -> status -> download: ZIP entry count and names, `xtm-file-descrption` content, second download of the same file; whether TARGET generation before the last step returns the current text | Decisions 19/20, repeatable flag |
| XL9 | Burst: 12 concurrent downloads, 6 consecutive creates, 60 status calls in a minute: observe `429`, `Retry-After`, `5xx`; connector completes without failed pages; note retry amplification | AC3, R8 |
| XL10 | **Reviewer-progress round trip:** complete translate in XTM, confirm the language is still `in progress` with "Review" shown; edit text during review, finish review; language becomes `translated`; the saved page contains the **reviewer's** edit | AC2 (latest reviewed content), status semantics |
| XL11 | Create-or-adopt: `GET /projects` name filter exact vs contains; created-then-lost-response simulated by killing the first response in a lab proxy or documented from XTM behaviour | Decision 13, R4 |
| XL12 | Constraints: project name length/characters, file-name length cap, description cap | R20 |
| XL13 | Cancel: jobs cancel on one language while another proceeds; status of the cancelled jobs; whether a cancelled job can be generated/downloaded | AC1, Decision 21 |

## 9. End-to-end checks inside real EW (manual; needs Adobe login, Chrome, an XTM sandbox user, Cloudflare login, a da-nx clone)

Accounts/credentials: GitHub admin on `jazhou-adobe/ew-extensions`; an Adobe IMS identity with config access to the DA org/site; XTM sandbox tenant with an API-licensed **Project manager** user (numeric id, password), a customer, a workflow with translate and review steps (and ideally a template with automatic assignment/start), a user able to perform the translate and review steps in XTM; Cloudflare account; write access to a da-nx clone. Secrets set with `wrangler secret put XTM_PASSWORD` and `XTM_REF_KEY`; never pasted into chat, issues or the sheet; never paste a real IMS token or XTM password anywhere.

- **XM0:** deploy the stage worker; bare `curl -i <stage-worker>/translate/xtm/{org}/{site}/system` -> `401`; with a real IMS token and `Origin: https://da.live` -> `200` with company name and version; `Origin: https://evil.example` -> `403`; a project route with a bare numeric id -> not found. (AC10 negative)
- **XM1 (config):** create/edit `https://da.live/edit#/{org}/{site}/.da/translate` from the README sample (`XTM`, `stage, prod` origins, `customerId`, `workflowId`, languages incl. `zh-CN`, `zh-TW`).
- **XM2 (`ref=local` equivalent):** da-nx clone with `providers/xtm` (or its upstream bundle) in `nx/blocks/loc/connectors/xtm/`, `npm run local`, open `https://da.live/apps/loc?nx=local`, create a project, Options step: environment `stage`; customer, workflow, template and auto-start dropdowns populate; the connector shows connected. (Resolves the same ASSUMPTIONs as #4 M2.)
- **XM3 (round trip):** 3 pages (one with `translate="no"` content and a block with a link), languages `de`, `zh-CN`, `zh-TW`; *Translate all*; in XTM: the project exists, named with the submission id, description names the EW user, files and jobs as expected; if `autoStart = no`, start it in XTM; *Get status*: `created` -> `in progress` with step messages; complete translate (still `in progress`), complete review (`translated`), pages saved; open each saved page: correct folder, own content (marker), layout and links intact, `translate="no"` text unchanged, Chinese in the right script per folder, reviewer edits present. Proves AC4, AC2, AC9 (local).
- **XM4 (cancel):** send `de` and `fr`, cancel `fr`; `fr` shows `cancelled`, its jobs cancelled in XTM, `de` proceeds and saves.
- **XM5 (partial failure):** make one page fail in XTM (cancel its job in XTM); status shows `error` with the page; re-send creates a project part only for that page (no duplicate of the others).
- **XM6 (reload):** send, close the tab, reopen the project days later (or after a worker redeploy), *Get status* and save work.
- **XM7 (branch ref):** repeat XM2-XM3 against a da-nx branch carrying the connector if the owner supplies one (#4 Open Question 1); otherwise record that AC9's branch half could not be performed and why.
- **XM8 (secret hygiene):** search DevTools Network/Application and page source across XM3 for the XTM password, a decoded XTM token, `XTM-Basic`, and the MAC key: none. `wrangler secret list` shows names only.
- **XM9 (docs):** a reviewer follows the provider README from a clean clone to XM3 on a scratch site.
- **XM10 (cost guard):** with `XTM_ALLOWED_CUSTOMER_IDS` excluding a second customer, attempt a send with that customer's id (edit the sheet): the connector shows a plain message and XTM shows no project.

## 10. CI additions (no credentials)

| Job | Steps | Notes |
|---|---|---|
| `connector-unit` (existing, extended) | WTR: harness self-tests H*, generic contract suite C* for the XTM adapter, XTM cases X*, integration XI* | every push and PR; fetch guard on |
| `worker-unit` (existing, extended) | `node:test`: XF1-XF8 (fake self-tests), XW1-XW18 | uses the #2 test kit |
| `worker-smoke`/`e2e` (existing, extended) | XE1-XE4 with the worker `webServer` and the fake XTM server; plus a smoke assertion that the ZIP route runs in workerd (spike XS-S4) | Chromium only |
| `lint` (existing) | ESLint + Stylelint + convention check + XS1-XS4 | |
| `upstream-dropin` (existing, advisory) | XS5 | non-blocking (#4 Open Question 14) |

## 11. Acceptance-criteria traceability (ticket #6)

| # | Acceptance criterion (#6) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Implements the EW connector contract: `isConnected()`, `connect()`, `sendAllLanguages()`, `getStatusAll()`, `saveItems()`, `cancelTranslation()`, `serviceOptions` for live dropdowns | C1-C6, C10, C11, C15; X11, X13, X14, X15; XW10, XW16; XI5 | **XM2** (connected, dropdowns populate), **XM4** (cancel), **XL13**; review against EW-CONN's contract list and da-nx@a1bd8ec call sites |
| AC2 | Sends HTML, preserves markup, leaves `translate="no"` untranslated, maps every translated output back to its source page via stable identifiers | C3, C7, C14; X3, X4, X5, X11, X12, X18, X19; XW5, XW9, XW11; XI1 | **XL3** (translate="no" with real XTM), **XL4** (markup, charset), **XL6** (file-name echo), **XL10** (reviewed content saved), **XM3** (page-by-page check) |
| AC3 | Retries `429`/`5xx` with exponential backoff; downloads at most five files concurrently | C8, C9; X7; XW3, XW7, XW8, XW9, XW11, XW13; XI4, XI7 | **XL9** (real limits, amplification), **XL11**; review of Decision 25 and the worker retry table |
| AC4 | Full round trip (send, status through to a terminal state, save) from the EW Translate app against the vendor sandbox, incl. a `zh-CN` or `zh-TW` target | C5, C13, C16; X1, X2, X6, X8, X9, X10, X11; XI1, XI6; XE1 | **XL2, XL7, XL8, XL10**, **XM3** (zh-CN and zh-TW), **XM5** (error state), **XM6** (reload) |
| AC5 | Passes the shared contract test harness | whole C1-C16 suite green for the XTM adapter; H1-H5 (including red on da-nx's sample stub) still pass with XTM registered; XF1-XF8 keep the fake honest | Review: the adapter implements only #4's interface (no harness edits, XS2) |
| AC6 | README includes a site translation-config sample for XTM Cloud | XS1 (parsed sample file), XS3 (README contains it and the key table) | **XM1** (sample used verbatim), review checklist: `translation.service.name = XTM`, `all.env`, per-env `origin`, `zh-CN`/`zh-TW`, no credential keys |
| AC7 | Added inside the existing `translation-connectors` folder as a new provider; no shell changes beyond registering the provider | XS2 (isolation diff), XS4, XS5, X17 | Review: diff touches only `providers/xtm/**` + the worker-entry line + the extension README provider list; **XM9** |
| AC8 | Extension README documents this vendor's setup (credentials, site config keys) | XS3 (sections present; every key the connector reads is documented) | **XM9** (follow the README from clean clone); review that prerequisites (API licence, role, user id) match XL1 findings |
| AC9 | Works in EW with `ref=local` and with a branch ref | environment-independent behaviour in XI1/XE1 | **XM2** (`?nx=local` as `ref=local`), **XM7** (branch ref, subject to #4 Open Question 1) |
| AC10 | Credentials only in this extension's worker; browser never receives them; unauthenticated calls rejected | C12; X5, X15, X16, X17; XW1-XW6, XW12, XW14, XW15, XW18; XI2, XI3; XE2-XE4; XS1, XS4 | **XM0** (bare `curl` -> 401), **XM8** (hygiene), **XM10**, `wrangler secret list` |
| AC11 | Core logic covered by unit tests; lint and CI green | all of sections 2-7 run by `connector-unit`, `worker-unit`, `worker-smoke`/`e2e`, `lint` on every push/PR | Review: CI green on a PR; break a rule on a scratch branch (drop the create-or-adopt lookup, or save at the first finished step) and see XW7 / X8 fail |

Every acceptance criterion on #6 maps to at least one automated test or a numbered manual verification step above.

## 12. Open questions for the owner

1. **XTM sandbox access (blocking AC4 live).** Which XTM tenant will serve as sandbox (a customer-facing test tenant, a trial from XTM, or an existing production tenant restricted to a test customer)? It needs an API licence, a Project-manager API user (numeric id and password), a workflow with at least translate and review, and a person to perform those steps. Who bears the linguist cost of the live checks (XL10, XM3)? XTM's KB links an `api-test.xtm-intl.com` host; do you know whether it is available to customers?
2. **Service name.** The sheet value must be `XTM` (folder `xtm`) because da-nx lower-cases and hyphenates the name; `XTM Cloud` would resolve to `xtm-cloud`. Accept `XTM`, or name the folder `xtm-cloud` (contradicting #44's working folder)?
3. **Authentication method.** Accept XTM-Basic (token from company name, user id, password) for v1, with OAuth password flow as a later follow-up that needs a client id/secret from XTM support? Note that an XTM-Basic token is effectively a permanent password-equivalent.
4. **Worker template amendments.** Beyond #4 Open Question 8 (multipart replay, body cap, buffered response, retry flags, extension error codes), XTM needs a derived-credential auth hook with redaction of the derived token, and binary upstream handling. Add them to `shared/worker-template` (breaking-contract note per #2 Decision 17) or keep them inside `providers/xtm/worker/`?
5. **Default locale table and overrides.** Confirm defaults for bare codes (`en` -> `en_US` or `en_GB`; `pt` -> `pt_PT` or `pt_BR`; `zh` -> `zh_CN`; `de` -> `de_DE`, `fr` -> `fr_FR`, `ja` -> `ja_JP`, ...), and approve the `languageMap` sheet key as the escape hatch.
6. **Who may spend XTM money.** Adopt the recommended `authorize` check (caller has DA read access to `{org}/{site}`) plus the XTM customer allowlist and a dedicated, least-privilege API user? Or accept "any authenticated Adobe user passing the client-id allowlist"?
7. **Auto-start default.** Default `autoStart = yes` (sending content starts the XTM workflow, matching Adobe's "create, upload, start" requirement) or `no` (a project manager starts it, like Smartling's manual authorize default)? The sample currently sets `yes` for `stage` and `no` for `prod`.
8. **Linguist assignment.** Assume the XTM template or project managers assign linguists and start steps (the connector never assigns)? Should the README mandate a template with automatic assignment for unattended flows?
9. **`translate="no"` ladder.** If live check XL3 shows XTM's default HTML filter ignores `translate="no"`, approve F1 (a documented one-time XTM filter/ITS configuration plus a `filterTemplateId` option) and, only if that is impossible, F2 (connector-side placeholder protection with a persisted restore map)?
10. **Cancel semantics.** Cancel jobs only and leave empty projects for XTM project managers to archive (this spec), or also deactivate a project once all its languages are cancelled?
11. **Chunking defaults.** Accept 50 pages / 8 MiB per XTM project part until live checks tune them, and several projects per large EW send?
12. **Status text.** Keep the styled vocabulary and put reviewer detail in messages (this spec), or use custom status text such as "Review 3/5" (unstyled pill) like Smartling's percentage?
13. **Upstreaming and reachability (inherited from #4 Q1, Q12).** Is the deliverable "verified here via a local da-nx, delivered upstream as a PR to `adobe/da-nx`" for XTM as well, given Adobe's own page says Adobe normally builds connectors and XTM meets its requirements apart from the undocumented `429` behaviour and VPN-restricted instances (Further Note 1)?
14. **da-nx drift and managed status.** The current `da-nx` exposes `supportsManagedStatus` and passes extra conf fields (Decision 7). Should the harness (#4) adopt them and should XTM opt in later? Which da-nx commit does the harness pin?
15. **Due dates.** Should `translation.service.supports.duedate` be supported (mapping an EW due date to the XTM project due date)? Out of scope in this spec.
16. **Project-scoping mechanism.** Use signed `projectRef` handles with a dedicated `XTM_REF_KEY` secret (this spec), or the simpler per-call name-prefix check through an extra upstream lookup?
17. **XTM instance URL form.** Confirm for your tenant the REST base (`https://api.xtm-cloud.com/project-manager-api-rest` versus a dedicated `https://<instance>.xtm-intl.com/...`), and whether the tenant is VPN- or IP-restricted (then neither EW nor this worker can reach it).
18. **Content and cost privacy.** Confirm that production page content may be sent to XTM and its linguists, and that `stage` runs only on non-confidential test content.
