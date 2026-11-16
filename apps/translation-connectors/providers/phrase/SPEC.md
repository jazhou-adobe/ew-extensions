# Spec: Extra Translation Connectors: Phrase TMS (provider `phrase`)

Ticket: jazhou-adobe/ew-extensions#5 (this spec: #43). #5 is blocked by #4 (extension shell, contract harness, first provider DeepL; spec in `apps/translation-connectors/SPEC.md`), which is itself blocked by #1 (repo scaffold, spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template, spec in `shared/worker-template/SPEC.md`).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as #1, #2, #4): **[VERIFIED]** = read in a primary source (URL given) on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Phrase.

Vocabulary follows #1, #2 and #4: *extension* = one folder `apps/<name>/`; *worker* = the per-extension backend in `apps/<name>/worker/` built from `shared/worker-template/`; *provider* = one vendor under `apps/<extension>/providers/<vendor>/`; *IMS token* = the Adobe IMS access token; *connector* = the module the Translate app loads; *harness* = the reusable contract test harness #4 delivers; *submission* = the connector-generated grouping of one send. Phrase vocabulary used here: *project* (container, created from a *project template* that fixes workflow, providers, TM/TB); *workflow step* (ordered stage such as Translation, Review; each has a 1-based *workflow level*); *job* = one source file for one target language; *job part* = the per-workflow-step instance of a job, which is what the API calls `job` and addresses by `jobUid` [VERIFIED: https://developers.phrase.com/en/api/tms/latest/job/get-job, "workflow-step instance of a job"]; *import* = Phrase's asynchronous parsing of an uploaded file; *export* = Phrase's asynchronous generation of the translated file.

This spec stays consistent with #4's provider/connector interface and does not redesign the shell. Everything #4 fixed (contract surface, da-nx-shaped layout, harness, worker conventions, the host-reachability finding, `ref=local` meaning) is reused by reference; only Phrase-specific decisions are made here.

---

## Problem Statement

EW authors translate pages in the Translate app, which ships Google Translate plus Lionbridge, Smartling and Trados connectors (https://www.aem.live/docs/ew/administering/translation). A site whose localisation team works in **Phrase TMS** cannot use it: there is no Phrase connector, and Adobe's own page says Adobe normally builds connectors itself, while inviting third-party contributions (https://www.aem.live/docs/ew/administering/translation-service-connection) [VERIFIED].

Phrase is not DeepL. #4's first provider translates machine-only, with one request per file and no human in the loop. Phrase is a human-workflow system, which creates six problems that the DeepL design does not have:

1. **Status must reflect reviewers.** The same Adobe page requires that "translators and reviewers can work in the vendor's own tools in between, but status must reflect that work, and downloads must return the latest reviewed content" [VERIFIED]. In Phrase every job exists once per workflow step (for example Translation, then Review), each with its own status. The Translate app saves a language the moment its status is exactly `translated` and then marks it `complete`, which is terminal [VERIFIED: `checkAndSaveLangs` and `saveLangItemsToDa`, https://github.com/adobe/da-nx/blob/main/nx/blocks/loc/views/translate/translate.js and `.../views/translate/index.js`]. If the connector reports `translated` when only the first step is complete, unreviewed text is saved and the language can never be refreshed.
2. **Project plus jobs, many-to-many.** Phrase wants a project (from a template that carries workflow and linguist assignments), then one job per file and target language, each fanned out into one part per workflow step. The connector must keep all those ids and map every translated output back to its source page.
3. **`translate="no"` is not documented for Phrase's HTML import.** Adobe's requirement is that the service "treat any element with `translate="no"` as untranslatable" [VERIFIED]. Phrase's HTML import documentation lists exclusion by tag name only (settings "Exclude elements" and "Non-translatable inline elements") and never mentions the `translate` attribute; a 2022 Phrase community post asks for attribute-based exclusion as a feature request [VERIFIED: https://support.phrase.com/hc/en-us/articles/5709623015452--HTML-TMS; https://support.phrase.com/hc/en-us/community/posts/5744096674716-HTML-import-settings-define-attribute-and-value-to-exclude-elements-containing-it]. Absence of documentation is not proof of non-support, so this is a live-check item [OPEN: spike S1], but the design must not depend on Phrase honouring it.
4. **Asynchronous everything.** Creating a job (import) and fetching the translated file (export) are asynchronous requests tracked by an `asyncRequest` id; the download id is single-use [VERIFIED: https://developers.phrase.com/en/guides/build-a-tms-plugin.md]. Phrase caps concurrently running async requests per plan (50 on Developer, 100 Team, up to 2000 Enterprise) and answers `429` beyond it [VERIFIED: https://support.phrase.com/hc/en-us/articles/5784117234972-Phrase-TMS-Limits].
5. **Secrets and blast radius.** The Phrase credential must never reach the browser, and a Phrase credential can read, cancel and download every project in the organisation, not just spend quota as DeepL's key does. A worker that proxies Phrase calls for any IMS-authenticated caller would let one site's author read another team's projects. That needs scoping beyond #2's identity check.
6. **Sandbox is thin.** Phrase's free Developer edition is limited to two jobs and 1 MB files, and sandbox jobs are not processed by real translators [VERIFIED: limits page above; Phrase Verified Solution Program guide, https://phrase.com/wp-content/uploads/2026/06/Phrase-Verified_Solution_Program-Guide.pdf]. A round trip with zh-CN and zh-TW, human steps and 12-file concurrency checks cannot all run on it.

## Solution

Add `apps/translation-connectors/providers/phrase/`: one provider inside the existing extension, containing a da-nx-shaped **connector** (`translation.service.name = Phrase`), the **Phrase routes of the extension's worker**, a **fake Phrase API**, and a harness **adapter** so the generic contract suite from #4 runs against it. The shell is not redesigned; registration is: the provider folder, one route-registration line in the worker entry plus the provider's secret and variable names in the worker config, and a Phrase section in the extension README (Decision 1).

An author sees: `translation.service.name = Phrase` in `.da/translate`, a connected indicator, a **Project template** dropdown fetched live from Phrase in the Options step, *Translate all*, then *Get status* showing `in progress` until every page of a language has finished **every workflow step in Phrase, including review**, then `translated`, automatic save into the language folders (including `zh-CN` and `zh-TW`), and optional per-language cancel that cancels the Phrase jobs.

What happens behind it: the connector creates one Phrase project per send from the chosen template, uploads each page as its own HTML file for all selected target languages in one request, remembers every returned part id per page and language, and polls part status per workflow level. A page is done only when all its parts are `COMPLETED` or `DELIVERED`. Saving exports the last-level part of each page, downloads it, reverses the connector's `translate="no"` protection, runs da-nx `removeDnt`, saves, and (by default) marks the Phrase job `DELIVERED`. All Phrase traffic goes through the worker, which holds the Phrase credential, exchanges it for short-lived tokens, and refuses to act on a project it did not create for that `{org}/{site}`.

## User Stories

Site administrator:

1. As a site administrator, I want to enable Phrase by setting `translation.service.name` to `Phrase` and an `origin` per environment in `.da/translate`, so that switching from Google needs no code change.
2. As a site administrator, I want a copy-paste `translate.json` sample for Phrase including Chinese targets, so that I configure environments, languages and conflict behaviour correctly the first time.
3. As a site administrator, I want `stage` and `prod` environments that point at a Phrase sandbox and a production organisation, so that authors can trial a project without creating production work.
4. As a site administrator, I want the Phrase API token to live only in the worker's secret store, so that it is not in the sheet, the browser or the repo.
5. As a site administrator, I want a README step list for the Phrase side (API token, project template with workflow and providers, active languages), so that setup is not guesswork.
6. As a site administrator, I want to pin a project template in config but still change it per project in the Options step, so that authors cannot accidentally use a wrong workflow.
7. As a site administrator, I want other sites and other teams' Phrase projects to be unreachable through my worker, so that "any Adobe user who finds the worker URL" cannot read or cancel them.
8. As a site administrator, I want to turn off the automatic `DELIVERED` marking, so that my Phrase process (for example a client-side sign-off) stays in control of that status.

Content author:

9. As an author, I want the Translate app to show that Phrase is connected, or why not, so that I do not start a project that cannot be sent.
10. As an author, I want a project template dropdown filled from Phrase, so that I choose a workflow without typing ids.
11. As an author, I want to select several target languages at once, so that one project covers all my markets.
12. As an author, I want `zh-CN` and `zh-TW` (and `pt-BR`, `fr-FR`, `en-GB`) to map to the right Phrase language, so that Simplified and Traditional pages are not swapped.
13. As an author, I want a clear message before anything is uploaded when a language is not active in my Phrase organisation, so that I am not left with a half-created project.
14. As an author, I want *Translate all* to send every selected page for every selected language in one project, so that the localisation manager sees one coherent project.
15. As an author, I want *Get status* to say `in progress` while linguists or reviewers are still working and `translated` only when review is finished, so that unreviewed text is never saved over my pages.
16. As an author, I want to see how many pages are finished for each language, so that I know how far along review is.
17. As an author, I want a plain message when a Phrase linguist declined, a reviewer rejected a job, or a manager cancelled it in Phrase, so that I know to talk to the localisation team instead of retrying.
18. As an author, I want finished pages saved automatically into the right language folder at the right page, so that page A's translation never lands on page B.
19. As an author, I want links, blocks and layout to survive translation unchanged, so that I only review words.
20. As an author, I want product names, code and `translate="no"` content left exactly as I wrote them, even though Phrase's HTML import does not document that attribute, so that I do not fix them by hand in every language.
21. As an author, I want to cancel a language I no longer need and have its Phrase jobs cancelled, so that linguists stop working on it.
22. As an author, I want to reload the page or come back next week and still get status and save results, so that human review (which takes days) does not depend on one browser tab.
23. As an author, I want a re-send after a partial failure to upload only what failed and never create duplicate jobs, so that linguists are not asked to do the same page twice.
24. As an author, I want a plain explanation when Phrase is rate limiting or my Phrase plan cap is hit, so that I can wait or ask the admin.

Localisation manager (works in Phrase):

25. As a localisation manager, I want one Phrase project per Translate project named after the title and submission, so that I can find and manage it.
26. As a localisation manager, I want the project created from my template so that workflow steps, translation memory, term bases and providers apply as I configured them.
27. As a localisation manager, I want providers assigned from the template automatically after import, so that linguists are not waiting for a manual assignment.
28. As a localisation manager, I want finished jobs marked `DELIVERED` once EW has saved them, so that I can see what reached the website.
29. As a localisation manager, I want the original page path preserved as the job file name and folder, so that linguists and I recognise the page.

Connector developer (#6 and later vendors):

30. As a connector developer, I want Phrase to run on the unchanged generic contract suite, so that "implements the EW connector contract" is a command.
31. As a connector developer, I want the few harness capabilities Phrase needs (transformed wire content, structural markup fidelity, required service options) recorded as small additive changes, so that the next vendor with human workflow reuses them.
32. As a connector developer, I want a fake Phrase API that models import, workflow levels, single-use exports and limits, so that nothing in CI needs a Phrase account.

Maintainer / reviewer:

33. As the maintainer, I want CI to run the Phrase connector, worker and fake tests with no credentials, so that regressions cannot merge.
34. As the maintainer, I want live Phrase checks as an opt-in script with a job budget, so that real-API facts (HTML handling, statuses per level, Chinese codes) are verified without CI.
35. As the maintainer, I want proof that adding Phrase touched nothing in the shell beyond registration, so that AC7 is a check and not a claim.
36. As a reviewer, I want every acceptance criterion on #5 mapped to a test or a numbered manual step, so that review is a checklist.

Security reviewer:

37. As a security reviewer, I want proof that the Phrase token, the signing key and Phrase access tokens never appear in any response, header, log or browser-visible file, so that "credentials only in the worker" is tested.
38. As a security reviewer, I want every worker route to reject a missing or invalid IMS token and a disallowed origin, so that the worker is not an open proxy.
39. As a security reviewer, I want proof that a handle issued for project A, org/site X cannot operate on project B or org/site Y, so that one caller cannot read, cancel or download another team's Phrase work.
40. As a security reviewer, I want the worker to forward only an allowlist of Phrase operations and fields, so that a caller cannot reach other Phrase endpoints (user management, term bases, billing).

## Implementation Decisions

(No file paths or code except contract tables; paths are in the Build Analysis.)

1. **Provider placement and registration (AC7).** Phrase is a provider of the existing `translation-connectors` extension (type `connector`, registered by `translation.service.name`, as in #4 Decision 1). The service name is **`Phrase`**: da-nx derives the connector folder from the name by lower-casing and replacing spaces with hyphens, so `Phrase` resolves to `connectors/phrase/` and `Phrase TMS` would resolve to `connectors/phrase-tms/` [VERIFIED: `setupConnector` in https://github.com/adobe/da-nx/blob/main/nx/blocks/loc/views/translate/index.js]. "Registering the provider" means exactly: (a) the new provider folder; (b) one line in the extension worker entry that registers the Phrase route module, plus the Phrase secret and variable names added to the worker configuration [OPEN: Open Question 3, because the template's `secrets.required` makes a deploy fail when a declared secret is missing, which couples DeepL and Phrase in one worker]; (c) a Phrase section and a provider-table row in the extension README. The harness discovers the provider's contract test by convention, with no harness edit. Nothing else in the shell changes. A footprint check proves it (test PD1).
2. **Connector layout is da-nx-shaped** (#4 Decision 2): an `index.js` exporting the contract plus sibling helper modules, importing only da-nx-relative modules that exist upstream and the provider folder. `dnt = { addDnt }` is exported like every real connector. `saveLangConcurrency` is not exported, so the host saves one language at a time and "at most five downloads at once" holds across a save [VERIFIED default `connector.saveLangConcurrency ?? 1`]. A Phrase connector does not exist in da-nx today [VERIFIED: connectors directory lists glaas, globallink, google, lionbridge, sample, smartling, trados, 2026-11-16], so there is no overlap to design around.
3. **Contract surface** is #4 Decision 3, unchanged: `isConnected(service)`, `connect(service, sendMessage?)` (the Options step calls `connect(service)` with no `sendMessage`, so it is optional [VERIFIED `loadConnectorServiceOptions`, https://github.com/adobe/da-nx/blob/main/nx/blocks/loc/views/options/options.js]), `sendAllLanguages`, `getStatusAll`, `saveItems`, `cancelTranslation`, `serviceOptions`, `dnt`. Cancel and serviceOptions are both implemented (Phrase supports real cancel; it has templates to list).
4. **Submission model: one Phrase project per send, one create-job request per page.** `sendAllLanguages` creates a connector-generated `submissionId` (time-based, readable), creates **one project from the chosen template** with all target languages of the send, then for each page makes **one create-job request carrying that page's file and every target language that shares its source** (languages with a custom `source` location form their own groups). Per (page, language) Phrase returns one job part per workflow step; the connector records all of them. ZIP/multi-file uploads are not used, because identifying output by file name inside an archive is exactly the fragile mapping AC2 forbids. Project name: title plus submission id, truncated; project note names `{org}/{site}` and the submission id (both are metadata for the localisation manager, never trusted for authorisation).
5. **Persisted state (rehydratable; no module memory).** Per language, `lang.translation` carries `submissionId`, `projectUid`, `projectHandle` (Decision 14), `templateUid`, `phraseLang` (the Phrase code used), `levels` (number of workflow levels seen), `providersAssigned` (`pending | done | failed`), plus the standard `sent`, `translated`, `status`, and an `items` map keyed by the language-agnostic `daBasePath` to `{ parts: [{ uid, level }], state, message? }`. States: `importing`, `waiting`, `in progress`, `done`, `saved`, `error`, `cancelled`. Same persistence assumption and same fallback as #4 (R9, spike S3) [ASSUMPTION]. State is saved after project creation, every N uploaded pages (N configurable, default 20), and after the last upload, so a tab crash mid-send leaves a project that a re-send can adopt (Decision 11).
6. **Stable identifier mapping (AC2).** The only authority is the part uids returned by the very create-job request that carried that page, matched by `targetLang` and `workflowLevel`; the connector never matches by file name or response order. The upload file name is a deterministic function of `daBasePath` (path without leading slash, `.html` appended if absent; folder kept as the Phrase job directory per the Create job documentation, [VERIFIED: https://developers.phrase.com/en/api/tms/latest/job/create-job]); it is used only (a) so linguists recognise the page, and (b) for reconciliation after an ambiguous failure (Decision 11). File and directory names over 255 characters are truncated by Phrase [VERIFIED limits page], so over-long paths are shortened deterministically with a hash suffix and reconciliation is skipped for them with a message.
7. **HTML and `translate="no"` (AC2).** `url.content` is already HTML with DNT markup applied by the shared `addDnt`, which marks elements with `translate="no"` (for example `code`, `body > .da-metadata`, rule-matched blocks, and `span.dnt-text` wrappers) [VERIFIED: https://github.com/adobe/da-nx/blob/main/nx/blocks/loc/dnt/dnt.js]. Because Phrase's HTML filter is documented to exclude by tag name only, the connector **protects DNT itself**: before upload, every outermost `translate="no"` element is replaced by an inert placeholder element with a reserved tag name whose attribute carries the original element (outer HTML) in a URL-safe encoding; after download, placeholders are expanded back to the original elements. The payload travels inside the file, so protection survives a reload and needs no persisted stash and no extra Phrase configuration. Order on save is fixed: download, **expand placeholders, then `removeDnt`**, then `saveFn` (so `removeDnt` still strips `translate` attributes and unwraps `dnt-text` spans). Consequences, all documented in the README: translators see a tag in place of the protected text instead of the text; a fragment whose encoded size exceeds a guard (default 15,000 characters, chosen under Phrase's documented 20,480-character tag-metadata limit per segment [VERIFIED limits page; ASSUMPTION that a placeholder attribute counts toward it]) fails that page pre-flight with a message naming the page; the guard is configurable. Spike S1 decides whether Phrase preserves the placeholder and its attribute unchanged and without producing stray segments. Alternative if S1 fails or translator experience is unacceptable ("Design B"): rewrite protected elements to two reserved tag names and require an admin-created Phrase *import settings* object that lists them under "Exclude elements" and "Non-translatable inline elements", referenced in job creation; the connector then refuses to send unless the settings are verified. Not built unless S1 demands it [OPEN: Open Question 6].
8. **Markup fidelity.** Phrase re-serialises HTML on export, so byte equality is not promised; the guarantee is structural: same elements, attributes and link targets, with only text nodes changed. The contract suite supports this through a capability flag (Decision 18); the live check L3 measures the real difference. HTML pages are sent as `.html` whatever `url.ext` says, because da-nx converts JSON sheets to HTML before `addDnt` and `removeDnt` converts back by `ext` [VERIFIED: `addDnt` and `removeDnt`, dnt.js].
9. **Language codes (AC4 Chinese).** Phrase locale codes are lower-case with underscores (`de_de`, `pt_br`, `fr_fr`, `en_gb`, `zh_cn`, `zh_tw`, `zh_hans`, `zh_hant`, `zh_hant_tw`, also `zh_hk`, `zh_mo`, `zh_sg`, and bare `zh`, `de`, `fr`) [VERIFIED: https://support.phrase.com/hc/en-us/articles/5709608511516-Supported-Languages-TMS]. EW codes map by (a) case-insensitive, `-`/`_`-tolerant normalisation (`zh-CN` becomes `zh_cn`, `zh-TW` becomes `zh_tw`), (b) check against the languages **active for the organisation** (`GET /api2/v1/languages?active=true`; the support article says unactivated languages are unavailable [VERIFIED]), (c) a small explicit alias table (`zh-Hans` to `zh_hans`, `zh-Hant` to `zh_hant`, `zh-HK` to `zh_hk`, ...), (d) base-language fallback only when the base is active. `zh-CN` and `zh-TW` therefore need no alias because both exist as codes. Source code is mapped the same way. A language that cannot be mapped fails pre-flight with a message that tells the admin to activate it in Phrase (Settings, Active languages) and causes **zero** uploads for that language while others proceed. Bare `zh`, `pt`, `en` map to the bare Phrase code, which is a documented Phrase locale [OPEN: Open Question 9 on whether sites should be forced to explicit variants].
10. **Status model: reviewer progress (AC4, requirement 1).** Statuses of a part: `NEW, ACCEPTED, DECLINED, REJECTED, DELIVERED, EMAILED, COMPLETED, CANCELLED` [VERIFIED enum, OpenAPI `JobPartReferenceV2.status`]. Import status per part: `RUNNING, ERROR, OK` [VERIFIED `ImportStatusDtoV2`]. Rules per page and language (all evaluated over **all** workflow levels):
    - any part `CANCELLED`: item `cancelled` (cancelling at any step cancels the whole job across all steps in Phrase [VERIFIED: https://support.phrase.com/hc/en-us/articles/10825557816092-Job-Status-TMS]);
    - any part import `ERROR`: item `error` with Phrase's `errorMessage`; any part import `RUNNING`: item `importing`;
    - part uid missing from the listing (deleted in Phrase): item `error` ("job no longer exists in Phrase");
    - **every part `COMPLETED` or `DELIVERED`: item `done`**. This conservative rule makes the review step mandatory for "translated" even if a manager skipped an earlier step by completing a later one, and also accepts a manager retiring a step by setting it completed, which Phrase documents as the way to retire a step [VERIFIED job-status article]. Whether Phrase completes earlier levels implicitly is [ASSUMPTION: measured in live check PL4; the rule is correct either way];
    - otherwise `in progress`, or `waiting` when every part is `NEW` or `EMAILED` (nobody has accepted yet). `DECLINED` and `REJECTED` parts keep the item in progress with a warning message ("declined by provider, ask your localisation team to reassign" / "rejected back to step X"); they are not terminal because Phrase documents rejection as returning work to the previous step [VERIFIED job-status article].
    Language status: `translated` iff every page is `done` or `saved`; `error` if any page is `error`, or some but not all pages are `cancelled`; `cancelled` iff every page is `cancelled`; otherwise `in progress` with `translated` counting `done`+`saved` pages. The host's terminal states `complete` and `cancelled` are never regressed, and a language the host put in `error` after a failed save is re-evaluated (so a later status check can return it to `translated`). A human-readable breakdown (which step is open, how many pages) is sent as a non-error message; the status text stays the plain known values [ASSUMPTION: the host renders any status string, as Smartling's `62% translated` shows; keeping plain values avoids unknown CSS classes].
11. **Retries, concurrency, idempotency (AC3).** Browser side: all worker calls use the shared da-nx `fetchWithRetry` (retries `429` and `>=500`, 500 ms base, 30 s cap, jitter, honours numeric `Retry-After` [VERIFIED: https://github.com/adobe/da-nx/blob/main/nx/blocks/loc/utils/fetchWithRetry.js]); `downloadQueue` default concurrency **5** bounds downloads, uploads and status fan-out [VERIFIED `downloadQueue(urls, callback, concurrency = 5)`]. A queue slot covers one whole export cycle (start export, poll, download), so five is the cap on in-flight exports and downloads together. Non-idempotent creates (`create project`, `create job`) pass `fetchWithRetry` a **429-only** retry predicate (an `isRetryable` option it supports): a `5xx` or network failure on a create is ambiguous, so the connector then **reconciles** before retrying: for a job, list the project's jobs by the deterministic file name and adopt the returned parts if present; for a project, stop with a message ("creation outcome unknown; check Phrase for project NAME, then re-send") because enumerating projects by name through the worker would defeat project scoping (Decision 14). A `4xx` other than `401/429` is never retried. Worker side: #2 `proxy` policy applies (`GET`/`PUT` retried on `429`+`5xx`; `POST` on `429` only unless flagged). Flagged safe: setting a job status (idempotent). Not retried on `5xx` at all: downloading an export result (the async id is single-use [VERIFIED create-job/export docs]); the connector starts a new export instead. Phrase documents two `429` families: request-rate (6,000/min logged-in users) and concurrent requests (global 100, local 50, signalled by `Ratelimit-Limit`/`Ratelimit-Remaining` headers) [VERIFIED limits page]; Phrase's own guidance suggests a long ~1 minute backoff for the concurrency family [VERIFIED: https://developers.phrase.com/en/api/tms/latest/handling-concurrent-api-limits.md], which exceeds da-nx's 30 s cap, so the connector surfaces a plain "Phrase is rate limiting, try again in a minute" error after the retries are exhausted rather than waiting longer.
12. **Save (AC2, AC3, AC4).** For each page whose item is `done`: export the **last-level part** (start export, poll the async request, download once ready), expand placeholders, `removeDnt`, `saveFn`. Items already `saved` are skipped and count as success on a retried save. Phrase exports are repeatable, so, unlike DeepL, a failed `saveFn` or a failed download loses nothing: `saveFn` is retried twice in session, then the item is `error` and the next status check re-evaluates it; an export is never replayed on the same async id. Export poll: interval and attempt cap bounded and injectable for the fake clock; on timeout the item is `error` with a retry message. After a successful `saveFn` the connector sets the last-level part to `DELIVERED` unless the site disabled it (`markDelivered`); a failure to mark is a warning, never a save failure. Status derivation treats `DELIVERED` as done, so marking does not regress a language.
13. **Cancel.** `cancelTranslation` sets every stored part of the language to `CANCELLED` through per-job status calls on the bounded queue, marks the language `cancelled` when all succeed, returns `{ ok }`, is idempotent, and never touches the project or other languages. Phrase cancel is real, so linguists stop receiving the work. If some parts fail, the language keeps its previous status and `ok: false` is returned with a message; nothing is half-cancelled silently. The project is not cancelled when the last language is (the manager decides) [OPEN: Open Question 12].
14. **Worker scoping: signed project handles (AC10).** #2 verifies identity only. Phrase credentials are organisation-wide, so any project-scoped route must be unforgeable and bound to `{org}/{site}`. When the worker creates a project it returns a **handle**: an HMAC over `{org}|{site}|{projectUid}` keyed by a second secret held only by the worker. Every project-scoped route requires the handle as a query parameter (custom headers are not allowed by the template CORS policy) and rejects with `403 forbidden` when it is missing, malformed, or does not verify for the `{org}/{site}` in the path, before any Phrase call. The async-request and job routes also re-check that the Phrase object belongs to the handle's project (the async response names its project; jobs live under the project path). The handle is not a credential (useless without a valid IMS token and without the matching org/site) and is stored in project state. Non-project routes (session, languages, templates) expose only organisation metadata and are protected by #2 auth plus the recommended `authorize` hook from #4 Decision 17 (caller can read `{org}/{site}` in DA) [ASSUMPTION per #4; spike S4]. If the owner rejects handles, the fallback is `authorize`-only and the cross-project exposure is documented as accepted risk (Open Question 4).
15. **Phrase authentication (worker only).** The documented non-interactive paths are: (a) **personal API token** from the Phrase Platform Access Tokens page, exchanged for a short-lived JWT at `https://{eu|us}.phrase.com/idm/oauth/token` with grant `urn:ietf:params:oauth:grant-type:token-exchange` (`expires_in` 14399 s in the documented example) and sent as `Authorization: Bearer`; (b) **Service Account** (OAuth client credentials, `client_id` and `client_secret`, optional `resource=tms`), whose bot user "can't be assigned as project owners" [VERIFIED: https://developers.phrase.com/en/api/platform/authentication.md]; (c) the older `auth/login` username and password giving an `ApiToken` token valid 24 h, and an authorization-code OAuth app [VERIFIED: https://support.phrase.com/hc/en-us/articles/5709662181404-API-Authentication-TMS-], neither used (password handling and interactive consent). **Decision: v1 uses (a)**, which matches both the TMS plugin guide and Phrase's own sandbox instructions (generate a personal API token) [VERIFIED guide and PDF]; secret `PHRASE_API_TOKEN`. Service Account is the preferred production credential because a personal token dies with its owner; whether a bot user can create projects and jobs in TMS is untested [OPEN: spike S2, Open Question 2]. The worker caches the access token in isolate memory until shortly before expiry with a single-flight refresh, retries a request once after a `401` with a fresh token, and never returns, logs or forwards either token (Phrase checklist: tokens refreshed before expiry and retried on 401 [VERIFIED]). Phrase region and TMS host are worker `vars`: `PHRASE_PLATFORM_ORIGIN` (`https://eu.phrase.com` or `https://us.phrase.com`) and `PHRASE_TMS_ORIGIN` (`https://cloud.memsource.com/web` or `https://us.cloud.memsource.com/web`) [VERIFIED docs list both; other regional hosts [OPEN]]. The outbound host allowlist is exactly those two configured origins.
16. **Project template and providers.** A project template is **required**; there is no "no template" option because workflow steps come from it. Project creation from a template through the API "does not automatically assign providers configured in the template's workflow steps", so after all of a language's parts have imported (`importStatus` `OK`), the connector calls the documented *assign providers from template* operation once and records `providersAssigned`; a failure is a warning with the Phrase reason and does not fail the send, because a manager can assign in Phrase [VERIFIED: https://developers.phrase.com/en/api/tms/latest/project/create-project-from-template and `assignLinguistsFromTemplate` description in the OpenAPI; ASSUMPTION that it works on freshly imported jobs and is idempotent: spike S5]. Notifying assigned users, due dates, and `preTranslate` are not set by the connector in v1; the template governs.
17. **Polling only; no webhooks.** The worker is stateless (#2 excludes storage) and cannot receive durable callbacks; the Translate app's *Get status* button is the polling loop (#4 Decision on status). Phrase's Verified Solution Program requires webhooks for certification and says polling alone will not pass [VERIFIED PDF]. This provider does not seek Verified status (Open Question 11).
18. **Harness fit and three small additive capabilities.** The Phrase adapter declares `cancel: true`, `serviceOptions: true`, `granularity: file`, `download: repeatable`, `idempotentResend: true`. Three needs go beyond #4's documented flags and are proposed to #4's owner as additive flags that default to current behaviour [OPEN: Open Question 5]: (1) `wireContent: verbatim | transformed` with an adapter hook that reverses the transform, because the file Phrase receives is the placeholder form, not `url.content` byte for byte (C3); (2) `markupFidelity: byte | structural` (C14); (3) per-option `required` in the service-options capability so C11's "first item is an explicit none" is skipped for the required template dropdown.
19. **Tooling.** Per #1, #2, #4: ESLint 8 + helix config, `@web/test-runner` for browser-side tests, `node:test` for worker tests, Playwright for the hermetic end-to-end tier, Node 22, husky. No new tooling.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: what each exported connector function returns, which messages it sends, how `langs`, `urls` and `service` change, what requests reach the vendor and the worker (count, parameters, concurrency), what the saved content is, and what the browser can ever receive. Never assert on helper names or internal call counts. Two negative properties run across every path: "no Phrase credential, access token or signing key is observable" and "no request reaches Phrase without a verified IMS token and a verified project handle where required". All delays use a fake clock.

**Proposed seams** (recorded instead of asked). Phrase adds **no new seams**; it reuses #4's.

| # | Seam | Status | Used by | What is faked |
|---|---|---|---|---|
| T1 (primary, highest) | The connector contract surface (functions called with da-nx-shaped arguments; all I/O at `window.fetch`; state as plain JSON) | reused from #4 | WTR browser tests: generic contract suite via the Phrase adapter, plus Phrase-specific cases | Phrase (through the in-process backend), IMS (`imsAuthHeader`), `saveFn`/`sendMessage`/`saveState`, clock |
| T2 | The worker HTTP boundary `worker.fetch(request, env, ctx)` for the Phrase routes | reused from #2 W1 / #4 T2 | `node:test` worker tests | #2 test kit (fake IMS, token factory), **fake Phrase** at the injected `fetch`, a fake Phrase Platform token endpoint |
| T3 | Full stack over real HTTP: test page on `localhost:3000`, real worker (`wrangler dev`), fake Phrase HTTP server | reused from #4 T3 | Playwright hermetic tier | fake Phrase process, fake IMS key server, stub token |
| T4 | Repo convention and footprint check | reused from #1 S3 / #4 T4, extended | CI lint job | filesystem and a base/head file list |
| L | Real Phrase (sandbox org) through the deployed stage worker | manual / opt-in | live script PL*, manual PM* | none |

The **fake Phrase** is one model wired three ways without rewriting (as in #4): injected `fetch` under the worker, an HTTP server, and the vendor end of #4's in-process backend (the real worker code inside the browser test next to the connector; same spike S2 assumption and fallback as #4).

**Modules tested:** fake Phrase (self-tests), worker Phrase routes (auth, CORS, handles, allowlists, mapping, retry, token cache, redaction), connector pure modules (language mapping, DNT codec, file name and identity, status derivation, state model), connector orchestration (send, status, save, cancel, options, connect), harness adapter and the three harness deltas, in-process integration, hermetic end-to-end, footprint and README checks.

**Prior art.** #4's T1 pattern (WTR, recording `window.fetch`, sinon fake clock; da-nx's Smartling test, https://github.com/adobe/da-nx/blob/main/test/loc/connectors/smartling/index.test.js), #2's W1 test kit, #1's S3. Upstream `adobe-rnd/ew-extensions` has no connector or worker code [VERIFIED per #2/#4], so there is no prior art there.

## Out of Scope

- Any other vendor; the harness changes are limited to the three additive flags above.
- Phrase Language AI, Phrase Strings, Phrase Orchestrator, machine-translation or pre-translation settings, analyses, quotes, cost, TM/TB editing, LQA, in-context preview packages, continuous jobs, update-source flows.
- **Webhooks and callbacks**, the Phrase Verified Solution Program, the `sourceData` plugin metadata (its `clientType` "must be registered with Phrase" [VERIFIED guide]; the worker sends it only if an optional variable is set) [OPEN: Question 11].
- Creating or editing project templates, import settings, users, providers, or workflow steps; the connector only uses what the template defines.
- Due dates, notifying assigned users, per-language provider assignment overrides, vendor (LSP) assignment.
- Cancelling or archiving the Phrase project itself.
- Server-side storage (Workers KV/R2/D1), CI-driven deploy, the Adobe-hosted proxy and da-nx PR/CLA process (all as #4).
- Per-site Phrase credentials in `translate-keys.json` (the existing connectors' model); one credential per deployed worker (Open Question 2).
- A custom UI or an EW app/library plugin.

## Further Notes

1. **Host reachability is unchanged from #4.** The Translate app only loads connectors from inside da-nx, so `ref=local` means a local da-nx with the provider copied in and `?nx=local`, and the branch-ref half of AC9 depends on #4's Open Question 1. This spec inherits those interpretations and does not re-open them.
2. **Adobe's connector requirements vs Phrase.** Adobe lists requirements a service must meet for Adobe to build a connector itself, including that the service "treat any element with `translate="no"` as untranslatable" and "preserve the markup" [VERIFIED]. Phrase documents neither guarantee for HTML, so a Phrase connector as designed here compensates on the connector side; this is also the strongest argument for confirming behaviour with Phrase before proposing the connector upstream.
3. **Docs drift worth knowing.** Phrase's TMS guide lists job statuses `NEW, ACCEPTED, DECLINED, COMPLETED, DELIVERED, CANCELLED, REJECTED` plus `JOB_NOT_READY` (an error code on pre-translate, not a status), while the OpenAPI enum adds `EMAILED` and has no `JOB_NOT_READY` [VERIFIED both]. The connector tolerates unknown values by treating them as `in progress` with a warning. The guide also describes `DELIVERED` as the post-import terminal status the plugin sets; Phrase's own help text does not describe it from the linguist side [ASSUMPTION about transitions; live check PL6].
4. **Two API generations coexist.** Phrase's older username/password `auth/login` and the newer Platform token exchange both work against TMS; the docs now lead with the latter [VERIFIED]. Create-job is `v1`, export is `v3`, listing is `v2`; the paths here are those the current reference and the plugin guide call [VERIFIED: https://developers.phrase.com/public/assets/openapi/phrase-tms-latest.yaml, Swagger 2.0, base host `cloud.memsource.com/web`].
5. **Sandbox shape.** Phrase's own sandbox instructions: sign up, create a personal API token, create a project template, note the TMS base URL; sandbox jobs are not processed by real translators and are advanced with the job `setStatus` call; rate limits apply [VERIFIED PDF]. The Developer edition caps jobs at two and files at 1 MB [VERIFIED limits page; the newer limits article variant could not be read, ASSUMPTION that the figures are current]. So a live round trip needs: one page and two languages (`zh_cn`, `zh_tw`) fits the Developer cap exactly; multi-page, multi-language and concurrency checks need a trial or partner organisation (Open Question 7).
6. **Content privacy.** Page HTML (possibly unpublished) goes to Phrase through the worker and is visible to Phrase linguists and any vendor on the template. The README must say so; sandbox must never receive real customer content.
7. **Data region.** EU and US Phrase data centres use different hosts [VERIFIED]; one worker deployment targets one region. Multi-region organisations need one worker per region.

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace
 └─ Translate app (da-nx nx/blocks/loc)    page origin https://da.live
      │  dynamic import  connectors/phrase/index.js        <- must live inside da-nx (see #4 Further Notes 1)
      │  Authorization: Bearer <IMS token> via imsAuthHeader()
      ▼  fetch  {origin}/translate/phrase/{org}/{site}/...    (cross-origin, preflight; project routes add ?handle=)
   Cloudflare Worker  apps/translation-connectors/worker  (+ routes from providers/phrase/worker)
      1 origin gate + preflight  2 IMS token check  3 route + field allowlists + handle check  4 proxy(secret, Phrase token cache, retries)
      ▼
   Phrase Platform  https://{eu|us}.phrase.com/idm/oauth/token    (API token -> JWT, cached)
   Phrase TMS API   https://cloud.memsource.com/web  |  https://us.cloud.memsource.com/web
```

| Concern | Connector (browser, da-nx code) | Worker (private, secrets) |
|---|---|---|
| Phrase credential, Phrase access token, handle signing key | never | only place |
| User identity | gets IMS token from `imsAuthHeader()`, sends it | verifies it (#2) |
| Submission grouping, per-page and per-language part ids, persisted state | all | none (stateless) |
| Language mapping, pre-flight, status derivation across workflow levels | all | validates code shapes |
| HTML in/out; DNT placeholder encode and expand; `removeDnt` | all | never parses content, buffers and forwards bytes |
| Project scoping (handle) | stores and sends it | issues and verifies it |
| Token exchange, caching, 401 refresh | none | all |
| Retries | da-nx `fetchWithRetry` (429/5xx by policy), queue (5) | #2 `proxy` per route policy |
| Async import/export polling | polls through worker routes | thin pass-through |

The Translate app's callers (`views/translate`, `views/options`) are unchanged.

## 2. EW integration points

- **Type and registration:** type `connector`; selected by `translation.service.name = Phrase` in `{org}/{site}/.da/translate`, tab `config` [VERIFIED: https://www.aem.live/docs/ew/administering/translation-config]. No `apps` or `library` sheet row, no entry page; the SDK is not involved (a connector has no App SDK handshake), so #1's SDK stub seam does not apply; the equivalent seam is the fake `imsAuthHeader`.
- **Config keys read** (under `translation.service.{env}.`): `origin` (worker base, required), `link` (reference URL, optional), `projectTemplateUid` (optional preselect; also the key the `serviceOptions` dropdown writes, because the Options step seeds `envConfig[option.key]` [VERIFIED `options.js`]), `markDelivered` (`no` disables; default on). Keys the connector must not read: any Phrase credential. Project options read at send time: `source.language`. The Options step passes `{ name, ...envConfig, org, site, env }` to `connect` and `serviceOptions[].fetch` [VERIFIED].
- **`serviceOptions`:** one entry, `projectTemplateUid` (label "Project template"), live from the worker's templates route. Unset or unknown values are seeded to the first item by the Options step [VERIFIED], so the README tells admins to pin the key; an empty list renders "No options found" and send fails with a message.
- **Host calls into the connector:** as #4 section 2 (`setupService`, `handleConnect`, `fetchUrls` calling `dnt.addDnt`, `handleSendAll`, `handleGetStatus` then auto-save of `translated` languages, `cancelLang`, the Options step). The status/save path builds its configuration with `fetchContent = false`, so **`urls` carry no `content` at save time** [VERIFIED: `getBaseTranslationConf(false)` in `handleGetStatus`]; this is why DNT protection is self-contained in the uploaded file.
- **`ref=local` and branch ref:** as #4 (local da-nx with the provider copied in, `https://da.live/apps/loc?nx=local`; the stage worker, not localhost, serves the backend; branch half subject to #4 Open Question 1) [ASSUMPTION unchanged]. The Phrase worker routes are not branch-sensitive (origin from config).
- **Cross-extension footprint:** none. Phrase adds no extension, no README table row, no `apps`/`library` row.

## 3. External APIs and auth flows

All Phrase operations below were read in the current OpenAPI (https://developers.phrase.com/public/assets/openapi/phrase-tms-latest.yaml) and the TMS plugin guide (https://developers.phrase.com/en/guides/build-a-tms-plugin.md) on 2026-11-16; reference pages live under https://developers.phrase.com/en/api/tms/latest/.

| API | Use | Notes |
|---|---|---|
| `POST {PLATFORM}/idm/oauth/token` (token exchange) | API token to JWT | form body; JWT `expires_in` about 4 h; https://developers.phrase.com/en/api/platform/authentication.md |
| `GET /api2/v1/auth/whoAmI` | connectivity, org, edition | `isConnected` |
| `GET /api2/v1/languages?active=true` | active locale codes | pre-flight and mapping |
| `GET /api2/v1/projectTemplates` | template dropdown | paged, `pageSize` 1-50, zero-based `pageNumber`; item has `uid`, `templateName`, `workflowSteps`, languages |
| `POST /api2/v2/projects/applyTemplate/{templateUid}` | create project | body: `name`, `sourceLang`, `targetLangs`, `note`; does not assign providers |
| `POST /api2/v1/projects/{projectUid}/jobs` | create jobs | header `Memsource` (JSON: required `targetLangs`; optional others), header `Content-Disposition` (`filename*=UTF-8''...`), body raw bytes (`application/octet-stream`); `201` returns `jobs[]` (one part per language per workflow step) and `asyncRequest`; import is asynchronous |
| `GET /api2/v2/projects/{projectUid}/jobs` | list parts | filters `workflowLevel` (default 1), `targetLang`, `filename`, `status`; `pageSize` max 50; items carry `uid`, `status`, `importStatus`, `workflowLevel`, `workflowStep`, `fullFilename`, `targetLang` |
| `POST /api2/v1/projects/{projectUid}/applyTemplate/{templateUid}/assignProviders` | assign providers | applicable when step counts match |
| `POST /api2/v1/projects/{projectUid}/jobs/{jobUid}/setStatus` | cancel / deliver | `requestedStatus` enum; `204` |
| `PUT /api2/v3/projects/{projectUid}/jobs/{jobUid}/targetFile` | start export | `202` with async request id |
| `GET /api2/v1/async/{asyncRequestId}` | poll import/export | `asyncResponse` null until finished; includes project reference |
| `GET /api2/v2/projects/{projectUid}/jobs/{jobUid}/downloadTargetFile/{asyncRequestId}` | download | **single use**; `application/octet-stream` |
| Limits | 6,000 requests/min logged-in; concurrent global 100 / local 50 (`Ratelimit-*` headers); async-request caps 50 (Developer) to 2000; 500,000 segments per job; tag metadata 20,480 chars per segment; names 255 chars | https://support.phrase.com/hc/en-us/articles/5784117234972-Phrase-TMS-Limits |
| Async polling vs callbacks | callbacks retried 2, 4, 8, 16, 30 min x 10 | https://support.phrase.com/hc/en-us/articles/5709706916124-API-TMS; not used |

**Flows.** Caller to worker: IMS token as #2. Worker to Phrase: exchange `PHRASE_API_TOKEN` at the Platform origin, cache the JWT, send `Authorization: Bearer <JWT>` to the TMS origin, add the `User-Agent` the TMS docs ask for (application name plus contact) [VERIFIED introduction page]. The caller's token is never forwarded. Raw HTML bytes travel browser to worker as `text/html`, and worker to Phrase as `application/octet-stream`.

## 4. Data contracts

**Persisted state:** Decision 5. Per-item record example in words: parts for `de` in a two-step template are two `{uid, level}` entries (levels 1 and 2); the last-level uid is the export and `DELIVERED` target; all uids are the cancel set.

**Proxy contract.** Base `{origin}/translate/phrase/{org}/{site}`; responses camelCase JSON except the download (raw bytes, `text/html`); unknown Phrase fields are dropped; Phrase error text is never passed through (mapped to fixed codes).

| Method + path | Auth scope | Purpose | Phrase call | Worker retry policy |
|---|---|---|---|---|
| `GET /session` | IMS (+authorize) | connectivity, org name, edition | `whoAmI` | 429+5xx |
| `GET /languages` | IMS (+authorize) | active codes | `languages?active=true` | 429+5xx |
| `GET /templates` | IMS (+authorize) | merged pages, capped (default 10 pages) | `projectTemplates` | 429+5xx |
| `POST /projects` JSON `{templateUid, name, sourceLang, targetLangs, note}` | IMS (+authorize) | create; reply `{projectUid, handle}` | `applyTemplate` | 429 only |
| `POST /projects/{pid}/jobs?handle&filename&targetLangs` body HTML | IMS + handle | upload; reply `{ jobs: [{uid, level, targetLang}], asyncRequestId }` | `jobs` (adds `Memsource`, `Content-Disposition`) | 429 only |
| `GET /projects/{pid}/jobs?handle&level&targetLang&filename&page` | IMS + handle | list parts, `{ items: [{uid, level, status, importStatus, importError?, fullFilename, targetLang}], totalPages }` | `v2 jobs` | 429+5xx |
| `POST /projects/{pid}/assign?handle` JSON `{templateUid}` | IMS + handle | assign providers | `assignProviders` | 429 only |
| `POST /projects/{pid}/jobs/{jid}/status?handle` JSON `{status}` (`CANCELLED` or `DELIVERED` only) | IMS + handle | set status | `setStatus` | 429+5xx (flagged safe) |
| `POST /projects/{pid}/jobs/{jid}/export?handle` | IMS + handle | start export; `{asyncRequestId}` | `PUT targetFile` v3 | 429+5xx |
| `GET /projects/{pid}/async/{id}?handle` | IMS + handle | async state; 404 if the request's project differs | `async/{id}` | 429+5xx |
| `GET /projects/{pid}/jobs/{jid}/exports/{id}?handle` | IMS + handle | translated bytes, once | `downloadTargetFile` | 429 only |

The worker validates every id against strict patterns before building an upstream URL (project and job uids alphanumeric, async ids numeric), accepts only the listed fields, rejects `targetLangs` entries not matching the Phrase code shape, accepts an upload body only up to a cap (default 10 MB, `PHRASE_MAX_UPLOAD_BYTES`) [ASSUMPTION: Phrase documents 1 GB per import request, so 10 MB is a conservative proxy cap], and permits only the two status values above.

Worker configuration: non-secret vars `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS`, `ALLOWED_SITES` (per #2/#4) plus `PHRASE_PLATFORM_ORIGIN`, `PHRASE_TMS_ORIGIN`, `PHRASE_MAX_UPLOAD_BYTES`, optional `PHRASE_CLIENT_TYPE`. Secrets: `PHRASE_API_TOKEN`, `PHRASE_HANDLE_KEY`. Error codes beyond #2's list: `language_not_active`, `template_not_found`, `import_failed`, `phrase_forbidden` [OPEN: Open Question 3, same template-amendment question as #4 Q8].

**Site config sample (README deliverable, AC6).** The `config` tab of `translate.json`: the general keys the existing samples carry (`sync/translate/copy/rollout.conflict.behavior`, `source.language`, completion keys), `translation.service.name = Phrase`, `translation.service.all.env = stage, prod`, `translation.service.stage.origin` and `translation.service.prod.origin` (the two worker URLs), optional `translation.service.{env}.link` (the Phrase web UI URL for the region), optional `translation.service.{env}.projectTemplateUid`, optional `translation.service.{env}.markDelivered`; and a `languages` tab with at least `de`, `fr`, `ja`, `zh-CN`, `zh-TW` rows (name, code, location, actions `Skip, Translate`). It contains no credential keys. Structure copied from Adobe's samples (https://www.aem.live/docs/ew/administering/translation-config-samples).

## 5. Folder layout (proposed; fits #1, #2, #4)

```
apps/translation-connectors/
├─ README.md                       gains: Phrase section (setup, credentials, config keys, sample translate.json), provider-table row
├─ worker/                         (#4) entry gains one route registration; wrangler config gains Phrase vars and secret names
├─ harness/                        (#4) gains the three additive capabilities (Decision 18)
└─ providers/phrase/
   ├─ SPEC.md                      this file
   ├─ index.js (+ helpers)         connector; drop-in layout for nx/blocks/loc/connectors/phrase/
   ├─ worker/                      Phrase route module, token cache, handle signing (registered by the extension worker)
   ├─ fake/                        fake Phrase model + http server + fetch adapter + in-process backend + fake Platform token endpoint
   └─ test/                        contract.test.js (harness adapter), phrase.test.js, worker tests, integration, e2e spec, docs/footprint checks
```

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Host reachability** (connector loads only from inside da-nx): AC4 (production), AC8-style reachability and the branch half of AC9. | High | Inherited from #4 R1 and its Open Question 1. |
| R2 | **`translate="no"` not honoured by Phrase's HTML import**, and **placeholder handling unverified** (stray segments, attribute altered, lone-tag segments, 20,480-char tag-metadata limit). | High for AC2 | Spike S1 first; connector-side protection is the design; Design B pre-described; size guard; live L2-L3. |
| R3 | **Org-wide Phrase credential behind an IMS-only check**: cross-project read, cancel, download. | High | Signed project handles (Decision 14), `authorize` hook, handle tests PW10-PW14; Open Question 4. |
| R4 | **Status semantics across workflow levels** unverified: does completing level n complete earlier levels; are part statuses independent; DELIVERED transitions. | High for "reviewer progress" | Conservative all-parts rule (correct either way); live PL4, PL6. |
| R5 | **Sandbox capacity**: Developer edition two jobs, 1 MB; no real translators; concurrency (AC3) and multi-language checks not runnable. | High for AC3-live and AC4-live | One page x `zh_cn`+`zh_tw` fits two jobs; trial/partner org for the rest (Open Question 7); fake covers concurrency. |
| R6 | **Service Account viability** (bot cannot own projects; TMS scope) vs personal token tied to a person. | Medium | Spike S2; v1 uses personal token; Open Question 2. |
| R7 | **Two retry layers and ambiguous creates**: browser up to 5 retries on top of worker retries; duplicate projects or jobs on a lost response. | Medium | 429-only retries on creates, reconcile by file name (jobs), stop-and-tell for projects; measured in PL7. |
| R8 | **Async limits** (50 on Developer): bursts of create-job requests trigger `429`. | Medium | upload concurrency 5, backoff, plain message; PL7. |
| R9 | **Providers not assigned by API-created projects**; assign timing and notifications unverified. | Medium | Assign after import, failure is a warning; spike S5; Open Question 8. |
| R10 | **Persistence assumption** (`lang.translation` mutated inside `saveItems` persists; state size for N pages x M languages x levels). | Medium | #4 spike S3; item state keeps uids only (about 30 bytes per part); fallback as #4. |
| R11 | **Template amendments for #2/#4**: raw binary (non-multipart) request bodies with a per-route cap, per-route retry flags, a handle helper, extension error codes, per-provider secret declarations. | Medium | Open Questions 3 and 5. |
| R12 | **Adobe outside-activity/IP policy**, personal Cloudflare account, possible da-nx PR. | High for publishing | Carried from #1 R1, #2 R1, #4 R12. |
| R13 | **Content privacy** (pages go to Phrase and its vendors). | Medium | README; paid org for production; sandbox test content only. |
| R14 | **da-nx drift** (helpers, DNT module, `fetchContent=false` save path). | Medium | #4 H2 hash check and advisory drop-in job. |
| R15 | **Token lifetime in an isolate** (cold starts re-exchange; concurrent exchanges). | Low | Single-flight; exchange count asserted in PW tests; PL measurement. |
| R16 | **HTML export re-serialisation** changes markup beyond whitespace. | Medium | structural fidelity contract; L3 measures. |

## 7. Ordered build plan (sized to #5's acceptance criteria)

0. **Owner prerequisites:** #1, #2 and #4 implemented (tooling, CI, worker template, harness, DeepL provider, deployed stage worker); Open Questions 1-5 answered; a Phrase sandbox organisation with an API token, an active-language set including `de`, `zh_cn`, `zh_tw`, and a project template with at least two workflow steps (translation and review) and one provider you control; Cloudflare account; local da-nx clone.
1. **Spikes (time-boxed; results written into the README and, where they change a decision, into this spec):**
   - **S1** (live Phrase): HTML upload with `translate="no"`, a lone block placeholder, an inline placeholder and an over-size attribute; observe segments, tags, export markup, language declaration, and whether `translate="no"` is honoured. Decides Decision 7 vs Design B. Gates step 4.
   - **S2** (live Phrase): Service Account client-credentials token with TMS scope can create a project from a template, import, list, export, set status. Decides Open Question 2.
   - **S3** (#4's persistence spike, rerun for the Phrase state shape).
   - **S4** (#4's DA-read `authorize` spike).
   - **S5** (live Phrase): assign providers timing and idempotency; `setStatus` for `CANCELLED` (repeat) and `DELIVERED` on a completed part; whether completing level n completes earlier levels; `Ratelimit-*` and `Retry-After` on `429`.
2. **Fake Phrase** (pure model, self-tests PF1-PF8) and its three wirings. Foundation for AC3, AC4, AC10.
3. **Worker Phrase routes**, test-first (PW1-PW20) on the #2 template: route table, handle signing, allowlists, token exchange cache, mapping, retries, redaction; worker entry registration; `.dev.vars.example`. AC10 (server side), AC3 (worker half), AC7 (registration).
4. **Connector pure modules**, test-first: language mapping (PC1-PC3), file name and identity (PC4-PC5), DNT codec (PC6-PC9), status derivation (PC10-PC12).
5. **Harness deltas** (HD1-HD3) and the Phrase **adapter**; contract suite C1-C16 green on Phrase. AC5.
6. **Connector orchestration**, test-first: connect and options, send, status, save, cancel, retries, concurrency, errors (PC13-PC27). AC1-AC4, AC10 (browser side).
7. **In-process integration** (PI1-PI7) and **hermetic e2e** (PE1-PE4). AC4 (offline full round trip incl. `zh-CN`/`zh-TW`), AC10.
8. **README (Phrase section and config sample), footprint and docs checks (PD1-PD5), CI wiring.** AC6, AC7, AC8, AC11.
9. **Deploy stage worker; run live PL1-PL10 and manual PM0-PM9** with a real Adobe login and the Phrase sandbox; record results and observed `Origin` in the PR/README. AC4 (real), AC9, AC10 (deployed).
10. **Hand-off:** note the three harness capabilities and the "human workflow" pattern for #6.

---

# Testing Requirements

Runners: `@web/test-runner` (Chromium; #4's WTR config with da-nx-relative resolution) for T1; `node:test` for T2 (as #2); Playwright Chromium for T3; a Node script for T4. A fetch guard fails any test that reaches a real external host. Fake clock (sinon) in every timing test.

## 1. Fixtures and mocks

- **Pages:** `html-basic` (headings, link, image); `html-dnt` (`<p translate="no">` block, `<code>`, `span.dnt-text` terms inside translatable text, `body > .da-metadata`, a nested `translate="no"` inside another, and `translate="no"` on an element with attributes); `html-bigdnt` (one fragment just under and one just over the placeholder guard); `html-nonascii` (path with spaces and CJK); `html-longpath` (name over 255 characters); 12 pages for concurrency; each carries a unique marker so the fake's deterministic "translation" (prefixes translatable text with the target code, ignores `translate="no"` exactly as Phrase's HTML filter is documented to, leaves the placeholder tag and its attribute alone) makes ownership checkable.
- **Languages:** `de`, `fr-FR`, `ja`, `pt-BR`, `zh-CN`, `zh-TW`, `zh-Hans`, `en-GB`, `xx` (unmappable), plus one language active in Phrase but not in the project, and one in the project but not active.
- **Templates (fake):** a two-step workflow (Translation, Review), a one-step workflow, a template with no providers, and a template whose step count differs from the project.
- **Fake Phrase** (`providers/phrase/fake`): Platform token exchange with TTL and scripted `401` on expiry; `Authorization: Bearer` required on TMS calls; templates, languages (active flag), project creation, job creation that validates the `Memsource` header JSON, the `Content-Disposition` pattern, `targetLangs` against project and active languages, and creates **one part per language per workflow level**; asynchronous import (`RUNNING` then `OK`, scripted `ERROR` with message); per-part status machine advanced by `controls` (`accept`, `complete`, `decline`, `reject`, `cancel`, `delete`) per level; async requests with single-use export ids; export returns the uploaded HTML with the deterministic "translation" and a switchable structural re-serialisation mode (attribute order, quoting, entity form); listing with level, filename, targetLang and paging (50); `setStatus` for any enum value; assign providers; scripted `429` (with and without `Ratelimit-*`, `Retry-After` optional), `5xx`, `401`, `403`, `404`; async-request cap; records every request with timestamps and maximum in-flight counts for exports and downloads.
- **Backend adapters:** Phrase in-process backend (real worker + fake Phrase + fake IMS); the harness reference backend.
- **Doubles:** `imsAuthHeader` returns a test-signed token; `saveFn`, `sendMessage`, `saveState` record calls; canaries `canary-phrase-token-<random>`, `canary-phrase-jwt-<random>`, `canary-handle-key-<random>`.

## 2. Fake Phrase self-tests (T1/T2 infrastructure)

| ID | Behaviour asserted |
|---|---|
| PF1 | Token exchange issues a JWT with `expires_in`; an expired JWT yields `401` on TMS calls; wrong grant parameters yield `400` |
| PF2 | Creating a job for `n` languages in a two-step template yields `2n` parts with correct `workflowLevel`, `workflowStep`, `targetLang`, `fullFilename`; a language not in the project is rejected |
| PF3 | Import is asynchronous: `importStatus` goes `RUNNING` then `OK`; a scripted failure yields `ERROR` with `errorMessage`; the async request reflects it |
| PF4 | Status machine: advancing level 1 does not advance level 2; `cancel` on any part cancels all parts of the job; `decline`/`reject` set the documented statuses |
| PF5 | Export: `PUT` returns an async id; the id downloads exactly once, a second download fails; unrelated ids fail |
| PF6 | HTML model: `translate="no"` text **is** translated (documented non-support) unless inside a placeholder; the placeholder tag and attribute survive; structural re-serialisation mode changes markup form but not structure |
| PF7 | Limits: `429` with `Ratelimit-*` for concurrent overshoot, plain `429` for rate overshoot, async-request cap, optional `Retry-After`; recorded maxima are correct |
| PF8 | Strictness: missing `Memsource` header, bad `Content-Disposition`, missing `Bearer`, unknown project or job each fail with the right status |

## 3. Worker tests (T2, `node:test`, #2 test kit; fake Phrase at the injected `fetch`)

| ID | Behaviour asserted | Proves |
|---|---|---|
| PW1 | **Every registered Phrase route**, iterated from the route table, answers `401` with no token and with a bad-signature, expired or wrong-type token, and the fake records zero requests | AC10 |
| PW2 | Disallowed origins get `403`; allowed origins (`https://da.live`, the site's own hosts) get CORS on every response including errors; preflight needs no token; no custom request headers are needed by any route | AC10 |
| PW3 | Project routes reject a missing, malformed, tampered or wrong-site handle with `403` **before** any Phrase call | AC10 |
| PW4 | A handle minted for project A / site X is refused for project B, for site Y, and with a modified project id; a handle is accepted for the same project across different callers | AC10 |
| PW5 | Async-request route returns `404` for an async id whose project differs from the handle's project; list and export on a job that is not in the handle's project fail | AC10 |
| PW6 | Upload forwards only allowlisted fields: `Memsource` carries `targetLangs` only (plus `sourceData` only if `PHRASE_CLIENT_TYPE` is set); extra caller-supplied metadata (`assignments`, `workflowSettings`, `callbackUrl`, `remoteFile`, `importSettings`) is dropped; `Content-Disposition` is rebuilt by the worker from a validated file name | AC10 |
| PW7 | Id and name validation: `../`, encoded slashes, non-alphanumeric uids, non-numeric async ids, `targetLangs` not matching the code shape, over-length file names, wrong content type all `400` before any upstream call; body over the cap `413` | AC10 |
| PW8 | Status route accepts only `CANCELLED` and `DELIVERED`; any other value `400`; the route cannot reach any other Phrase endpoint | AC10 |
| PW9 | Token handling: first call exchanges once; concurrent first calls share one exchange (single flight); a call after JWT expiry re-exchanges; a Phrase `401` triggers exactly one refresh and one retry; a second `401` surfaces as the generic misconfigured error; the exchange uses the configured Platform origin and nothing from the caller | AC10 |
| PW10 | Canary property: across success and every error path none of the three canaries appears in any response, header or log line; an upstream error body echoing a canary is redacted | AC10 |
| PW11 | Host allowlist: only the two configured origins are ever contacted; redirects are not followed; the caller's `Authorization` is never forwarded | AC10 |
| PW12 | Retry policy: list, templates, languages, session, status, export retry `429`+`5xx` on the exponential schedule (jitter pinned); create project, create job, assign, download retry `429` only; a `5xx` on download and create is returned, not retried | AC3 |
| PW13 | Mapping: Phrase `400/401/403/404/408/410/415/429/5xx` map to documented codes with fixed messages and no upstream text; `Retry-After` forwarded when present; `Ratelimit-*` presence is surfaced as a distinct detail code | AC3 |
| PW14 | Request bodies replay byte-identically on a `429` retry of an upload | AC3 |
| PW15 | Download returns the exact bytes and an HTML content type; the response is fully buffered; a second download maps to the documented "export already used" outcome, not retried | AC3 |
| PW16 | `languages`, `templates`, `session` map Phrase fields to the camelCase contract and drop unknown fields; templates pagination merges pages and stops at the cap | AC1 |
| PW17 | Missing `PHRASE_API_TOKEN` or `PHRASE_HANDLE_KEY` gives `500 misconfigured`, generic; region vars select the Platform and TMS hosts and no other | AC10 |
| PW18 | If the `authorize` hook is enabled: a caller whose DA read check fails gets `403` on every route, hook not run unauthenticated; fake DA outage fails closed | AC10 |
| PW19 | Create-project route returns a handle; the handle verifies in constant time; the route refuses `targetLangs` or names that break the field patterns | AC10 |
| PW20 | `assign` route calls assign-providers for the handle's project only and the template id given; failure maps to a fixed code | AC1 |

## 4. Harness integration and deltas (T1)

| ID | Behaviour asserted | Proves |
|---|---|---|
| HD1 | `wireContent: transformed` with the adapter's reverse hook: C3 compares the reversed upload to `url.content`; with `verbatim` (default) DeepL's behaviour is unchanged (DeepL suite stays green) | AC5 |
| HD2 | `markupFidelity: structural`: C14 passes on a structurally equal but re-serialised export and **fails** on a structurally different one; default `byte` unchanged | AC5, AC2 |
| HD3 | Per-option `required`: C11 skips the "first item is an explicit none" rule only for options flagged required; an adapter omitting the flag on an optional option still fails | AC5, AC1 |
| C1-C16 | The generic suite from #4 runs unmodified through the Phrase adapter (contract surface, connectivity, send, partial failure and resend, status, save, identity mapping under shuffled order, 12-page concurrency exactly 5, retries and `Retry-After`, cancel, options, no-secret leakage, rehydration, DNT round trip, message shape, per-language failure with zero uploads) | AC1, AC2, AC3, AC4, AC5, AC10 |
| H1-H5 | #4's harness self-tests still pass with the deltas (including red on da-nx's sample stub and green on the reference connector) | AC5 |

## 5. Phrase connector cases (T1, provider-specific)

| ID | Behaviour asserted | Proves |
|---|---|---|
| PC1 | Language mapping, table-driven through `sendAllLanguages` and inspecting the codes the fake receives: `zh-CN` to `zh_cn`; `zh-TW` to `zh_tw`; `zh-Hans`/`zh-Hant` to `zh_hans`/`zh_hant`; `pt-BR` to `pt_br`; `fr-FR` to `fr_fr`; `en-GB` to `en_gb`; case and `-`/`_` tolerant; source `en` to `en` | AC4 |
| PC2 | A language not active in Phrase, an unmappable code (`xx`) and a target equal to the source fail pre-flight with a message that names the language and tells the admin to activate it; **zero** requests for that language while others proceed; no project is created if every language fails | AC4 |
| PC3 | Active-language list is fetched once per session and reused; a failed fetch fails the send with a message, not a crash | AC4 |
| PC4 | File name: deterministic from `daBasePath` (leading slash dropped, `.html` ensured, folder kept); two pages never share a name; CJK and spaces encoded correctly; over-255 names shortened with a hash suffix and reconciliation skipped with a message | AC2 |
| PC5 | Identity: parts are recorded from the create-job response of that page's own request, matched by language and level; fake responses returned in shuffled order and uploads completing out of order never cross pages | AC2 |
| PC6 | DNT encode: every outermost `translate="no"` element (including inside `<head>`) is replaced by exactly one placeholder; nested `translate="no"` is not double-wrapped; the wire file contains none of the protected text | AC2 |
| PC7 | DNT decode: expanded placeholders restore byte-identical original elements; order on save is expand then `removeDnt` (resulting page has no `translate` attribute and no `dnt-text` wrappers, same text) | AC2 |
| PC8 | A fake that "translates" `translate="no"` text (as documented) still leaves protected text unchanged end to end; the same page without protection would not (control case proving the protection is what does the work) | AC2 |
| PC9 | Guard: a fragment over the encoded-size guard fails that page pre-flight with a message naming the page and element; other pages proceed; a fragment just under it is sent | AC2 |
| PC10 | Status derivation table-driven over the rules in Decision 10 for one-, two- and three-step workflows: level 1 `COMPLETED` and level 2 `ACCEPTED` is `in progress` (never `translated`); all levels `COMPLETED` or `DELIVERED` is `done`; any `CANCELLED` is `cancelled`; import `ERROR` is `error` with the Phrase message; import `RUNNING` is `importing`; missing uid is `error`; `DECLINED`/`REJECTED` stay in progress with a warning; unknown status value is in progress with a warning | AC4 |
| PC11 | Language aggregation: `translated` only when every page is `done`/`saved`; partial cancellation is `error`; all cancelled is `cancelled`; host terminal states are never regressed; a language the host set to `error` after a failed save is re-evaluated to `translated` when all items are done | AC4 |
| PC12 | Status calls: one list per (level, language) paginated at 50; finished and terminal items are not re-queried; request count is bounded as stated (assert upper bound for 3 levels x 4 languages x 120 pages) | AC3, AC4 |
| PC13 | `connect` and `isConnected`: use the session route; worker `401` gives a distinct "not signed in" message; unreachable worker gives `false`; `connect(service)` with no `sendMessage` does not throw | AC1 |
| PC14 | Origin handling: missing `origin` gives an error message and no request; non-`https` (non-loopback) refuses to send any token-bearing request; base is `{origin}/translate/phrase/{org}/{site}`; a URL query override has no effect | AC10 |
| PC15 | `serviceOptions`: one `projectTemplateUid` entry listing template names as labels and uids as values; failure resolves `[]` (no throw); pinned config key preselects; an unknown pinned value is seeded as the host does | AC1 |
| PC16 | Send: one project per call from the chosen template with all mapped targets; one create-job request per page carrying all target languages of its source group; persisted state after project creation, every N pages and at the end; `sent` and `status: created` set; message names the project | AC1, AC2 |
| PC17 | Send with no template selected or an empty template list fails with a message, no project, no upload | AC1 |
| PC18 | Resend after partial failure uploads only pages without parts; pages with parts are untouched; an item whose import ended in `ERROR` has its parts cancelled then re-created once; the existing project is reused; no duplicate parts appear in the fake | AC1, AC2 |
| PC19 | Ambiguous create (`5xx`/network on create-job): the connector reconciles by file name, adopts existing parts, and creates nothing twice; with nothing present it retries within the budget; a lost project-create response stops with the "check Phrase for project NAME" message and no retry | AC3 |
| PC20 | Providers: after all of a language's parts import `OK`, assign-providers is called once and `providersAssigned` becomes `done`; failure is a warning and `failed`, not an error status; no repeat call on later status checks | AC1 |
| PC21 | Save: only `done` items are exported; the last-level part is exported; export is polled until finished (fake clock); the download uses the returned async id once; an export timeout marks that item `error` with a retry message | AC2, AC3, AC4 |
| PC22 | Save retries: `saveFn` fails twice then succeeds saves without a second export; fails three times marks `error` and a later `saveItems` re-exports and saves (no data lost); already `saved` items are not exported again and count as success | AC4 |
| PC23 | `DELIVERED`: set on the last-level part after a successful `saveFn`; skipped when `markDelivered` is `no`; a failure to set is a warning, the item stays `saved`; status derivation still reads `DELIVERED` as done | AC4 |
| PC24 | Cancel: all stored parts of the language are set `CANCELLED` (levels 1 and 2), language `cancelled`, `{ ok: true }`, idempotent, other languages and the project untouched, no export afterwards, `getStatusAll` leaves it cancelled; a partial failure leaves the previous status with `ok: false` and a message; nothing sent: no-op message | AC1 |
| PC25 | Retries and rate limits: `429, 429, 200` succeeds with growing delays honouring `Retry-After`; persistent `5xx` ends as a reported error not a crash; `400/403/404` are not retried; `429` with `Ratelimit-*` after retries gives the "rate limiting, try again in a minute" message | AC3 |
| PC26 | Concurrency: with 12 pages the maximum simultaneous export-plus-download cycles at the fake is exactly 5; uploads respect the same bound | AC3 |
| PC27 | Static check: connector sources contain no `PHRASE_API_TOKEN`, no Phrase host names other than through config, no `Bearer` constant, and import only the da-nx-relative allowlist and the provider folder | AC7, AC10 |

## 6. Integration and end-to-end (T1 in-process backend; T3)

| ID | Behaviour asserted | Proves |
|---|---|---|
| PI1 | Real connector + real worker (in-process) + fake Phrase: send 3 pages x `de, zh-CN, zh-TW` in a two-step template; before review, status is `in progress` and **nothing is saved**; complete both levels; `getStatusAll` then reports `translated`; `saveItems`; every destination holds its own marker translation; `zh-CN` used `zh_cn`, `zh-TW` used `zh_tw`; parts marked `DELIVERED` | AC4, AC2 |
| PI2 | Token missing or invalid on the connector side: `isConnected` false, no Phrase traffic | AC10 |
| PI3 | Canaries are never observed by anything the connector can read (responses, headers, console) | AC10 |
| PI4 | Maximum simultaneous export/download cycles at the fake never exceeds 5 across a whole save; Phrase async cap `429` is retried and recovers | AC3 |
| PI5 | Cancel mid-way then reload state: no exports, status stays `cancelled` | AC1 |
| PI6 | Reload at three points (after send, mid review, after a partial save): state JSON round trip into a fresh module instance; status and save complete | AC4 |
| PI7 | Cross-project isolation: a second `{org}/{site}` using the same worker cannot see, cancel or export the first project's jobs with a copied handle | AC10 |
| PE1 | Playwright: test page on `localhost:3000` loads the connector with da-nx shims and calls a real `wrangler dev` worker on `:8787` backed by the fake Phrase server: full round trip, real cross-origin preflight | AC4, AC10 |
| PE2 | Same page without a token: worker `401` readable by the page (CORS on errors) | AC10 |
| PE3 | Origin `https://evil.example` gets `403`; no credential or handle key in any network response or the DOM | AC10 |
| PE4 | Only expected hosts contacted (page, worker, fake Phrase); no real Phrase host | AC10 |

## 7. Repo and docs checks (T4)

| ID | Behaviour asserted | Proves |
|---|---|---|
| PD1 | **Footprint:** given a base and head file list, every changed path is inside `providers/phrase/**` or in the allowlist (extension README, worker entry registration, worker wrangler config limited to Phrase vars and secret names, harness capability additions); anything else fails with the offending path. Fixture tests for pass and fail | AC7 |
| PD2 | **Config sample:** the README's `translate.json` sample parses; `translation.service.name` equals the provider folder name case-insensitively with spaces hyphenated; `all.env` and per-env `origin` present; `languages` contains `zh-CN` and `zh-TW`; no key whose name looks like a credential; every key is in the connector's declared read-list | AC6 |
| PD3 | **Docs coverage:** every config key the connector declares it reads, every worker secret and var name in the Phrase worker config, and every Phrase-side setup step (API token, project template with workflow and providers, active languages) appear in the extension README's Phrase section; `.dev.vars.example` lists exactly the Phrase secrets | AC8 |
| PD4 | Convention check (#4 U3) passes for the extension with `providers/phrase`; upstream bundle (#4 U1) includes `phrase` and the advisory drop-in job (#4 U2) runs on it | AC7, AC11 |
| PD5 | No tracked `.dev.vars*`, no Phrase token or JWT shape (regex) in any tracked file | AC10 |

## 8. Live sandbox checks (PL; opt-in script through the deployed stage worker; budget: at most 2 jobs on a Developer edition org, otherwise under 20 jobs and under 20,000 words)

| ID | Behaviour asserted | Proves |
|---|---|---|
| PL1 | `GET /languages` includes `zh_cn` and `zh_tw` (or records the real codes and updates the alias table); `session` returns org and edition | AC4 |
| PL2 | **HTML page with `<p translate="no">`, a `span.dnt-text` and `code`, uploaded raw (control) and with placeholders:** observe whether Phrase honours `translate="no"` unprotected, segments and tags presented to translators, whether placeholder attribute and tag survive import and export unchanged, behaviour at the size guard | AC2 (decides Decision 7 / Design B) |
| PL3 | Full round trip for `zh_cn` and `zh_tw` through the connector and the deployed worker, advancing both levels with `setStatus`; diff exported markup against the source structurally and record byte differences | AC4, AC2 |
| PL4 | Two-step template: complete level 1 only, then level 2; record each part's status and whether completing level 2 changes level 1; confirms or revises the all-parts rule | AC4 |
| PL5 | Decline and reject a part from Phrase: statuses and the connector's messages | AC4 |
| PL6 | `DELIVERED` on a `COMPLETED` part succeeds; repeat `CANCELLED` on a cancelled job; cancel at level 2 cancels level 1 | AC1 |
| PL7 | Burst of create-job calls and exports on a trial/partner org: `429` family, headers present, completion without failed uploads; amplification of two retry layers measured | AC3 |
| PL8 | Provider assignment timing and idempotency; whether assigned linguists are notified | AC1 |
| PL9 | Token exchange response (`expires_in`), a request after forced expiry, Service Account (S2) if available | AC10 |
| PL10 | Import failure shape for malformed HTML and an over-size file | AC4 |

## 9. End-to-end checks inside real EW (manual; needs Adobe login, Chrome, Phrase sandbox, Cloudflare login, a da-nx clone)

Accounts and credentials: GitHub admin on `jazhou-adobe/ew-extensions`; an Adobe IMS identity with config access to the DA org/site; a **Phrase sandbox organisation** (sign up at phrase.com, personal API token from Settings, Access Tokens, project template with at least two workflow steps and a provider you can act as, languages `de`, `zh_cn`, `zh_tw` active, region noted) [VERIFIED steps: Phrase Verified Solution Program guide]; a Phrase trial or partner org if multi-job checks are wanted (Open Question 7); secrets set with `wrangler secret put PHRASE_API_TOKEN` and `PHRASE_HANDLE_KEY` (never pasted into chat or issues); Cloudflare account; write access to a da-nx clone. Never paste a real IMS token or Phrase token anywhere; sandbox content only.

- **PM0:** deploy the stage worker with the Phrase routes; `curl -i <stage-worker>/translate/phrase/{org}/{site}/session` returns `401`; with a real IMS token from DevTools and `Origin: https://da.live` returns `200` with the org name; `Origin: https://evil.example` returns `403`; a project route without `handle` returns `403` even with a valid token.
- **PM1 (config):** edit `https://da.live/edit#/{org}/{site}/.da/translate` per the README sample (`Phrase`, `stage, prod` origins, languages incl. `zh-CN`, `zh-TW`).
- **PM2 (`ref=local` equivalent):** da-nx clone with the provider copied in, `npm run local`, open `https://da.live/apps/loc?nx=local`, create a project, Options step: Environment `stage`; **Project template** dropdown populates from Phrase; connector shows connected.
- **PM3 (round trip):** pages incl. one with `translate="no"` content and a block with a link; languages `de`, `zh-CN`, `zh-TW`; *Translate all*; in Phrase see one project from the template with one job per page per language and the original paths as file names; *Get status*: shows `in progress`; complete **level 1 only** and confirm *Get status* stays `in progress` and nothing is saved; complete the review level; *Get status*: `translated`, saved; check each saved page (right language folder, own content, layout and links intact, `translate="no"` text unchanged, Chinese script correct per folder); in Phrase the jobs are `DELIVERED`. Proves AC2, AC4, AC9 (local).
- **PM4 (cancel):** send `de` and `fr`, cancel `fr`: all `fr` jobs `CANCELLED` in Phrase (both levels), `de` untouched, nothing saved for `fr`.
- **PM5 (terminal and error states):** decline a job in Phrase (message appears, status stays in progress); cancel a job in Phrase (language shows `error` or `cancelled` as specified); send into a language not active (pre-flight message, no uploads).
- **PM6 (reload):** send, close the tab, come back after completing review, *Get status* and save work.
- **PM7 (branch ref):** as #4 M7, subject to #4 Open Question 1; record if unavailable.
- **PM8 (secret hygiene):** in DevTools Network and Application and page source across PM3 search for the Phrase token value, `Bearer` JWTs issued by Phrase and the handle key: none; `wrangler secret list` shows names only; the handle in project state is not usable from another site.
- **PM9 (docs):** a reviewer follows the README Phrase section from a clean clone to PM3 on a scratch site.

## 10. CI additions (no credentials)

| Job | Steps | Notes |
|---|---|---|
| `connector-unit` (#4, extended) | WTR: harness self-tests (H*, HD*), contract suite (C*) for Phrase, Phrase cases (PC*), integration (PI1-PI7) | every push and PR; fetch guard on |
| `worker-unit` (#4, extended) | `node:test`: PW1-PW20, PF1-PF8 | #2 test kit |
| `e2e` (#4, extended) | PE1-PE4 with the worker `webServer` and fake Phrase server | Chromium only |
| `lint` (existing) | ESLint + Stylelint + convention check + PD1-PD5 | PD1 needs the PR base ref; on `push` it compares against the default branch |
| `upstream-dropin` (#4) | bundle includes `phrase`; advisory | non-blocking |

## 11. Acceptance-criteria traceability (ticket #5)

| # | Acceptance criterion (#5) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Implements the EW connector contract: `isConnected`, `connect`, `sendAllLanguages`, `getStatusAll`, `saveItems`, `cancelTranslation`, `serviceOptions` | C1-C6, C10, C11, C15; PC13, PC15-PC18, PC20, PC24; HD3; PW16, PW20; PI5 | **PM2** (connected, dropdown populates), **PM4** (cancel), **PL6**; review against https://www.aem.live/docs/ew/administering/translation-service-connection |
| AC2 | Sends HTML, preserves markup, leaves `translate="no"` untranslated, maps every output to its source page by stable ids | C3, C7, C14; HD1, HD2; PC4-PC9, PC16, PC18, PC21; PF2, PF6; PI1 | **PL2** (real Phrase behaviour decides Decision 7), **PL3** (structural diff), **PM3** page-by-page check |
| AC3 | Retries `429`/`5xx` with exponential backoff; at most five concurrent downloads | C8, C9; PC12, PC19, PC25, PC26; PW12-PW15; PF7; PI4 | **PL7** (real `429` family and amplification); review of Decision 11 |
| AC4 | Full round trip from the Translate app against the vendor sandbox incl. `zh-CN` or `zh-TW`, status through to a terminal state, save | C5, C13, C16; PC1-PC3, PC10, PC11, PC21-PC23; PI1, PI6; PE1 | **PL1, PL3, PL4, PL5**, **PM3** (zh-CN and zh-TW, review gating), **PM5** (terminal states), **PM6** (reload) |
| AC5 | Passes the shared contract test harness | C1-C16 through the Phrase adapter; H1-H5; HD1-HD3 | Review: adapter declares capabilities honestly; the three deltas approved by #4's owner (Open Question 5) |
| AC6 | README includes a site translation-config sample for Phrase TMS | PD2 | Review checklist (sample has `Phrase`, `all.env`, per-env `origin`, `languages` with `zh-CN`/`zh-TW`, no credential keys); **PM1** uses it verbatim |
| AC7 | Added inside the existing `translation-connectors` folder as a new provider; no shell change beyond registering the provider | PD1, PD4, PC27 | Review of the PR diff against the allowlist; **PM9** |
| AC8 | Extension README documents the vendor's setup (credentials, site config keys) | PD3 | **PM9** (follow the README), review of the Phrase section |
| AC9 | Works in EW with `ref=local` and a branch ref | PI1/PE1 (environment-independent behaviour) | **PM2** (`?nx=local` as the `ref=local` equivalent), **PM7** (branch ref, subject to #4 Open Question 1) |
| AC10 | Credentials only in the extension's worker (from the template); the browser never receives them; unauthenticated calls rejected | C12; PC14, PC27; PW1-PW11, PW17-PW19; PI2, PI3, PI7; PE2-PE4; PD5 | **PM0** (bare `curl` gives 401; no handle gives 403), **PM8**, `wrangler secret list`; **PL9** |
| AC11 | Core logic covered by unit tests; lint and CI green | all of sections 2-7 run by `connector-unit`, `worker-unit`, `e2e`, `lint` | Review: CI green on a PR; break a rule on a scratch branch (drop the all-levels rule, or the retry) and see PC10/PC25 fail |

Every acceptance criterion on #5 maps to at least one automated test or a numbered manual step above.

## 12. Open questions for the owner

1. **Inherited, blocking (#4 Open Question 1): host reachability.** AC9's branch half and "reachable from its host platform" depend on whether a da-nx branch can be served; the Phrase provider inherits whatever you decide there.
2. **Phrase credential and plan.** Which Phrase organisation and region provide the sandbox and the production credential? Personal API token (v1) vs Service Account (client credentials) for production, given a bot user "can't be assigned as project owners" and TMS scope is untested (spike S2)? One credential per worker deployment (this design) vs per-site credentials in `translate-keys.json` (the existing connectors' model)?
3. **Template amendments and registration coupling (with #2/#4 owners).** The Phrase routes need: a per-route retry flag set (create is 429-only, status is safe-to-retry), raw binary (non-multipart) request bodies with a per-route cap, a handle/HMAC helper in the shared worker, extension-defined error codes, and per-provider secret declarations (the template's `secrets.required` fails a deploy when a declared secret is missing, which couples DeepL and Phrase in one worker). Do these belong in `shared/worker-template` or in this extension, and how should a provider declare optional secrets (separate wrangler environments per provider vs a `PROVIDERS` var)?
4. **Project scoping.** Adopt signed project handles (recommended: Phrase credentials are organisation-wide) plus the `authorize` DA-read check, or accept identity-only access and document the cross-project exposure?
5. **Harness deltas.** Approve the three additive capabilities (`wireContent`, `markupFidelity`, per-option `required`) in #4's harness, or have Phrase carry them locally?
6. **`translate="no"` strategy.** Is connector-side placeholder protection (translators see a tag instead of the protected text; per-fragment size guard) acceptable, or should Design B (admin-created Phrase import settings listing reserved tags, text stays visible but locked) be built if live check PL2 shows it feasible? Should we ask Phrase to confirm `translate="no"` support for HTML before anything is proposed upstream?
7. **Sandbox capacity.** Will you obtain a Phrase trial or partner organisation, given the Developer edition's two-job and 1 MB caps and that sandbox jobs are never processed by real translators (you advance statuses yourself)? Without it AC3's live concurrency check and multi-language round trips cannot run, only the zh-CN + zh-TW single-page case.
8. **Provider assignment and notification.** Assign providers from the template automatically after import (this design), leave assignment to the localisation manager, or also notify assigned users?
9. **Bare language codes.** For `zh`, `pt`, `en` (no variant) send the bare Phrase code (this design) or require explicit variants in the languages sheet? Where should extra aliases live (code only vs a config key)?
10. **`DELIVERED` marking.** On by default (matches Phrase's documented plugin lifecycle) with an opt-out key, or off by default?
11. **Phrase partner path.** Do you want Phrase Verified Solution status (requires webhooks, a registered `sourceData.clientType`, support and policy documents)? This design does not pursue it.
12. **Project lifecycle.** Should the connector cancel or complete the Phrase project when the last language is cancelled or saved, or leave that to the localisation manager (this design)?
13. **Upstreaming and licensing.** As #4 Open Questions 12 and 13: do you intend an `adobe/da-nx` PR (CLA, IP policy), and is vendoring helpers acceptable?
14. **Content privacy.** Confirm no real customer or unpublished content goes to the sandbox, and that production use will go through a Phrase organisation under a data-processing agreement.
15. **Live script budget.** Approve running PL1-PL10 only by hand with the documented job budget.
