# Spec: Workfront / Jira Link: Workfront (plugin shell + first tool)

Ticket: jazhou-adobe/ew-extensions#16 (this spec: #54). Blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`). Blocks #17 (Jira Cloud provider), which must be able to add itself as one module.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe/Cloudflare/Workfront.

Vocabulary follows #1 and #2: *extension* = one folder `apps/<name>/` (type comes from its EW config-sheet row; this one is a **library plugin**, a row in the `library` tab); *worker* = the per-extension backend in `apps/<name>/worker/`, built from `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension. Additional terms used here:

- **Work item** = a task or issue in a work-management tool (Workfront in this ticket).
- **Provider** = the module that knows one tool's API (Workfront now, Jira in #17). The **shell** is everything that is not provider-specific.
- **Link** = the association between one page (org + site + page path) and one work item.
- **Publish event** = the worker's observation that a linked page's live version changed (the page was published).
- **Technical account** = the Workfront user that the Adobe Developer Console creates for an OAuth Server-to-Server credential (`techacct` in Workfront).

---

## Problem Statement

Content authors in Experience Workspace (EW) work against tickets: a Workfront task or issue says what the page should say, who owns it and when it is due. Today the page and the ticket live in two tools with nothing connecting them. The author has to copy the page URL into the ticket by hand, keep a second browser tab open to check status, and remember to go back to the ticket after publishing to say the work is live. Project managers cannot tell from the ticket whether the page was published, and authors cannot tell from the editor whether the ticket is still open, who it is assigned to, or when it is due.

Contentful's Jira Cloud app (https://www.contentful.com/help/apps/jira-app/) shows the value of linking content to tickets inside the editor, but it is Jira-only, is one-way (the editor shows tickets; it does not report back), and keeps its link metadata inside Jira. Workfront is Adobe's own work-management product and the natural first tool for EW, but no connection exists, and the second tool (Jira, #17) must not need a second plugin.

The work cannot be a browser-only extension. The page being published is an event that happens whether or not any author has EW open, the work-item update must be posted by a server that holds Workfront credentials, and the browser must never receive those credentials.

## Solution

A **library plugin** ("Work Item") in the EW editor library, backed by a worker, in one self-contained folder. For the page the author is editing it offers:

1. **Link**: search Workfront (or paste a Workfront link or id) and pick a task or issue, or create a new task or issue and link it in one step. The link is saved with the page (keyed to the page's org, site and path) and shows up for every author who opens the page.
2. **See status**: the plugin card shows the linked item's title, status, assignee(s) and due date, with a button that opens the item in Workfront, plus the state of the last publish update ("sent 14:02", "failed, retry", "waiting for first publish").
3. **Keep in sync**: when the page is published, the worker (which polls the page's publish status on a schedule) posts an update to the linked item: a comment, a status transition, or both, as configured per site in an EW config tab. No author action is needed and nobody has to have EW open.

Under the hood the plugin shell is provider-agnostic. The worker holds a registry of providers; each provider is a module that implements a small, closed contract (describe itself, parse references, search, get, create, post a publish update). The shell renders whatever the provider describes, so **Jira (#17) only adds a module and registers it**. Workfront is the first provider and proves the contract. A test-only second provider with a different vocabulary proves that the shell does not depend on Workfront.

Vendor credentials (Workfront OAuth Server-to-Server client id and secret, and the AEM Admin API key used to read publish status) exist only as worker secrets from the shared template; the browser sees only normalised, field-allow-listed data, and unauthenticated calls are rejected by the template.

## User Stories

Content author (EW editor):

1. As a content author, I want a "Work Item" plugin in the editor library, so that I can reach the ticket for the page without leaving EW.
2. As a content author, I want to search Workfront by words from a task or issue name, so that I can find the ticket without knowing its id.
3. As a content author, I want to paste a Workfront link or id and have it recognised, so that I can link a ticket I already have open in another tab.
4. As a content author, I want search results to show the type (task or issue), name, status and assignee, so that I pick the right ticket and not a look-alike.
5. As a content author, I want to link the chosen item to the current page with one click, so that the connection takes seconds.
6. As a content author, I want the link to be saved with the page, so that I, my colleagues and my future self see the same ticket when we reopen the page, from any browser.
7. As a content author, I want to create a new Workfront task or issue from the plugin when none exists, so that I do not have to switch tools to start tracking the page.
8. As a content author, I want a created item to be linked to the page automatically, so that I do not have to search for what I just made.
9. As a content author, I want a created item to carry a link back to the page in EW, so that people who start in Workfront can reach the page.
10. As a content author, I want to see the linked item's status, assignee and due date on the card, so that I know whether the work is on track without opening Workfront.
11. As a content author, I want the card to say "Unassigned" or "No due date" plainly when those are empty, so that an empty value is not mistaken for a loading error.
12. As a content author, I want a button that opens the item in Workfront in a new tab, so that I can read the full ticket and discussion.
13. As a content author, I want to unlink a ticket (with a confirmation), so that I can fix a wrong link.
14. As a content author, I want to replace the link with a different ticket, so that a re-scoped page follows its new ticket.
15. As a content author, I want the card to refresh when I reopen the plugin and to have a "Refresh" action, so that I see status changes made in Workfront.
16. As a content author, I want to see whether the last publish update reached Workfront (waiting for first publish, sent with time, failed with reason, skipped by configuration), so that I know the ticket is up to date.
17. As a content author, I want a "Retry" button when a publish update failed, so that I can recover without asking an admin.
18. As a content author, I want plain-language error messages (not found, no access, Workfront unavailable, session expired), so that I know whether to retry, ask for access or reopen EW.
19. As a content author, I want the plugin to say clearly when it is open outside EW, so that a stray browser tab does not look broken.
20. As a content author, I want the plugin to keep working with the keyboard and with status shown as text (not only colour), so that it is usable by everyone.
21. As a content author, I want the plugin not to change my document, so that linking cannot interfere with my editing session.

Site administrator:

22. As a site administrator, I want to enable the plugin with one `library` row, so that rollout is copy-paste.
23. As a site administrator, I want to choose per site whether publishing posts a comment, changes the status, both, or nothing, so that the integration matches our process.
24. As a site administrator, I want to set the comment text with placeholders (page URL, live URL, path, time, who published), so that the message reads the way our project managers expect.
25. As a site administrator, I want to set which Workfront status a task or issue moves to on publish, so that "published" maps to our own status vocabulary.
26. As a site administrator, I want a status transition to be skipped when the item is already in that status or already done, so that publishing never reopens or rewinds finished work.
27. As a site administrator, I want to set a default Workfront project for newly created tasks, so that authors are not asked something they cannot know.
28. As a site administrator, I want to set how often publish status is checked (within bounds), so that I trade latency for load.
29. As a site administrator, I want invalid settings reported (and safe defaults used), so that a typo in the config sheet never causes a surprising status change.
30. As a site administrator, I want the settings to live in the EW config sheet I already manage, so that I do not need a second admin tool.

Workfront administrator:

31. As a Workfront administrator, I want the integration to use one named technical account created through Adobe Developer Console, so that I can see, scope and revoke exactly what it can do.
32. As a Workfront administrator, I want the integration to see only the projects I share with the technical account, so that linking cannot expose the rest of the instance.
33. As a Workfront administrator, I want automatic notes to say they come from the EW integration and which page was published, so that they are recognisable in the item's updates.
34. As a Workfront administrator, I want a publish never to post the same note twice and never to flood an item, so that the update stream stays readable.

Project manager (reads Workfront):

35. As a project manager, I want a note on the ticket when its page is published, with the live URL, so that I know the work is live without asking.
36. As a project manager, I want the ticket to move to the agreed status automatically when configured, so that the board reflects reality.
37. As a project manager, I want a ticket created from EW to point back to the page, so that I can open the page from the ticket.

Extension author / maintainer (this repo):

38. As the maintainer, I want a documented, closed provider contract with a test suite any provider must pass, so that adding Jira (#17) is writing one module and not rewriting the shell.
39. As the maintainer, I want a test-only second provider that differs from Workfront (different statuses, different fields), so that "the shell is generic" is a tested property, not a claim.
40. As the maintainer, I want Workfront and AEM Admin credentials only in the worker's secret store, never in the browser, in git, in logs or in responses, so that a public repo and a public site cannot leak them.
41. As the maintainer, I want unauthenticated and wrongly-originated calls to the worker rejected before any provider or store is touched, so that the worker cannot be used as an open Workfront proxy.
42. As the maintainer, I want publish detection to be idempotent (overlapping ticks, retries, restarts), so that "one update per publish" is a tested property.
43. As the maintainer, I want the poller to respect Admin API, Workfront and Cloudflare limits and say what it needs, so that scaling to more pages is a plan, not a surprise.
44. As the maintainer, I want every vendor API assumption listed with its source or marked unverified, and a sandbox spike scheduled before the build, so that unknowns are retired early.
45. As the maintainer, I want the extension README to cover setup, the registration row, the site config tab and each provider's credentials, so that someone else can deploy it.
46. As the maintainer, I want the extension added to the repo README extensions table, so that the repo index stays truthful.

Security reviewer:

47. As a security reviewer, I want proof that vendor payloads are reduced to an allow-list of fields before reaching the browser, so that description text, owners or custom fields are not leaked.
48. As a security reviewer, I want proof that user-supplied text (search text, names, comment templates) cannot change which host, object or endpoint the worker calls, so that the worker is not an SSRF or injection vector.
49. As a security reviewer, I want the site configuration to be unable to redirect outbound calls or widen status transitions beyond what the worker operator allowed, so that a config edit (or a spoofed settings push) has bounded impact.

## Implementation Decisions

(No file paths or code, except type shapes that encode a decision. Paths and layout are in the Build Analysis.)

**Extension shape**

1. **Type and registration.** A library plugin: one row in the site's `library` tab (title "Work Item" [OPEN: final name], `inline` experience, `ref` blank). Not an `apps` fullscreen app in this ticket. Folder `work-management-link` per the ticket and the owner convention; the entry page is named after the folder; vendor code lives under `providers/<vendor>/`, the worker under `worker/`.
2. **Shell versus provider.** The shell owns: SDK handshake and standalone state, link/unlink/refresh/retry interactions, status card rendering, search and create forms, settings handling, the route table, the registry, the link store, the poller and the update ledger. A provider owns only: talking to one tool, turning its objects into the normalised shape, and naming its own secrets. The browser renders from provider **descriptors** fetched from the worker (labels, item types, create-form fields, lookups), so a provider needs no browser code for the Workfront-like case. An optional per-provider browser hook is reserved for flows the descriptor cannot express (for example a Jira OAuth connect button in #17) and is exercised by a test-only provider. [OPEN risk R14: Jira's OAuth connect UI is not built here.]
3. **Provider contract (closed).** Every provider implements exactly these operations; the shell calls nothing else:
   - `describe`: id, display name, item types (with the fields each type can be created with, and lookups such as "project"), id pattern for validation, whether it needs user-level connection (`service` only in this ticket), and the names of secrets it needs.
   - `parseReference(text)`: turns a pasted URL or id into `{ type?, id }` or "not mine"; must reject URLs on foreign hosts.
   - `search({ query, type, limit })`: list of normalised items.
   - `get({ type, id })`: one normalised item, or a typed "not found".
   - `create({ type, fields })`: a new normalised item (not blindly retried on 5xx).
   - `lookup({ name, query })`: options for a create-form lookup.
   - `postPublishUpdate({ item, event, settings, action })` for `action` = `comment` or `status`: performs one action idempotently and returns a typed outcome (`sent`, `skipped` with reason, or a failure).
   - Errors are a closed taxonomy: `not_found`, `forbidden`, `invalid_input`, `rate_limited`, `unavailable`, `auth_failed`, `provider_error`. Anything else is mapped to `provider_error` with a generic message; vendor error text is never passed through.
4. **Normalised item** (the only item shape the browser or ledger sees): provider id, item type, id, title, url (https), status `{ code, label, phase }` with `phase` one of `open`, `in-progress`, `done`, `other`, assignees (list of `{ name }`; empty = unassigned), due date (ISO 8601 instant or date, or null), plus `fetchedAt`. Fields beyond these are dropped at the provider boundary (allow-list).
5. **Registration.** Adding a provider = one new module plus one line in each of two registries (the worker provider registry and the `secrets.required` list in the worker config) plus its README section. A repo check enforces that the declared secrets match the worker config. #17's acceptance criterion "no changes needed in the shell beyond registering the provider" is the design target and is tested with the second provider (decision 31).

**Linking and storage**

6. **Where the link lives.** The authoritative link record lives in the worker's database (Cloudflare D1), keyed by org, site and the normalised page path, not in the page source and not in the browser. This is what "stored with the page" means in this spec: durable, shared by every author, and attached to the page's identity rather than to a user or browser. Reasons: the poller must know which pages to watch with no user present and no DA credentials; writing into the page source (for example a metadata row) would modify a document the author has open (conflicting with the live editor), would mark the page as changed since publish, and the metadata block is turned into page metadata on the published page, which would publish internal ticket ids. The DA Admin API has no per-page custom property store (its `properties` route is a stub that echoes the request: https://github.com/adobe/da-admin/blob/main/src/routes/properties.js [VERIFIED]). Cost: moving or renaming a page in DA orphans its link (R9). [OPEN Q1: the owner may read "stored with the page" as "in the page document"; the alternative is described in Further Notes.]
7. **One active link per page.** The data model is unique on (page, provider, item), so lifting the limit later is non-breaking, but v1 allows one link per page; linking a second item requires an explicit replace. [OPEN Q9: Contentful's Jira app allows unlimited issues per entry.]
8. **Data minimisation.** The link stores: org, site, normalised path, provider id, item type, item id, item url, creator's IMS user id (not email), timestamps, poll state, baseline publish time. It does not store item titles, descriptions, page content or emails. When the provider is down the card shows "Linked to Workfront task <id>" with the open-in-Workfront link and a retry; nothing is cached at rest beyond the id. Item data is fetched live with a short in-memory TTL.
9. **Org and site come from the worker's configuration**, not from the request, so one worker serves one org and site (as in the #2 template's `ORG`/`SITE` variables). The request carries only the page path.
10. **Path normalisation.** The plugin reads `context.path` from the library context (a leading-slash path, `/` when empty [VERIFIED: https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/iframe-protocol.js: `path ? '/' + path : '/'`]). The worker normalises it to the EDS web path (no extension, no trailing slash except the root, no duplicate slashes, `/index` collapses to `/`), rejecting traversal, control characters and over-long values. [ASSUMPTION: the EDS web path rule; verified in sandbox step S4.]
11. **Content ref is `main`.** The library context's `ref`/`branch` is the code branch used to load the extension (and may be `local`); page content is published to the site's `main` ref. The poller therefore always asks about `main`. Non-main content refs are out of scope. [ASSUMPTION; confirm in M-L3.]

**Publish detection and delivery**

12. **Detection by per-page status polling.** A Cloudflare cron trigger (every minute) wakes the worker; each tick polls the AEM Admin API page status for links that are due, and compares the live version's last-modified time with the link's stored baseline. A larger value is a publish event. Source: `GET https://admin.hlx.page/status/{org}/{site}/{ref}/{path}` returns `live.status`, `live.lastModified`, `live.lastModifiedBy` [VERIFIED: https://www.aem.live/docs/admin.html, operation `status`]; the new Admin service exposes the same under `https://api.aem.live/{org}/sites/{site}/status/{path}` [VERIFIED: https://www.aem.live/docs/api.html]. Which generation a site uses is configuration. [ASSUMPTION: `live.lastModified` changes on every publish; confirmed by sandbox step S4. OPEN Q7.]
13. **Baseline and coalescing.** On link, the baseline is the page's current live last-modified (or "never published"), so linking an already-published page does not fire an update. Multiple publishes between two polls collapse into one event for the newest timestamp. Only timestamps reported by the API are compared; the worker's clock is never compared with them.
14. **Event identity and idempotency.** An event is identified by (link, live last-modified). A uniqueness constraint in the store makes overlapping or replayed ticks create it once. Each event has a state per action (comment, status): `pending`, `sent`, `skipped`, `failed`. A concurrent-tick lease prevents two ticks working the same link.
15. **Delivery.** Actions run in a fixed order: comment, then status. A failed status does not undo a sent comment; a retry re-runs only the actions that are not `sent`/`skipped`. A comment carries a stable marker with the event id; before re-posting after an ambiguous failure (timeout after the POST may have landed) the provider looks for the marker, so the same publish never produces two notes. [ASSUMPTION: the vendor's note search supports "contains"; S3 verifies.]
16. **Retry schedule.** Failed actions are retried by later ticks at +1, +5, +15, +60 and +240 minutes; then the event is `failed_final` with a reason code and the author sees "Retry" (which re-queues once). `not_found` and `forbidden` from the vendor are final immediately. The template's in-call retry (429 and idempotent 5xx) still applies inside each attempt; a note POST is not retried on 5xx within the call (the template's non-idempotent rule).
17. **Cadence and budgets.** Default poll interval per link is 5 minutes (setting, bounds 1 to 60). Each tick polls at most a configured batch (default 20), oldest-due first, with a subrequest budget below the platform limit and spacing that respects the Admin API's 10 requests per second per project [VERIFIED: https://www.aem.live/docs/limits]. A throttled response (429) ends the tick early and leaves unpolled links due. Detection latency is poll interval plus up to one minute. [OPEN Q2: platform plan; the free plan's cron limits (10 ms CPU, 50 subrequests) fit only a handful of links; the Paid plan is assumed for real use, matching the #7 spec's decision.]
18. **Stale links.** A page that stays 404 on live is not an error (never published or unpublished). After a configurable number of days of 404 on both preview and live (default 30) the link is flagged `stale` and shown as such; it is never deleted automatically.

**Per-site settings**

19. **Settings live in the EW site config** as a custom tab named `work-management-link` (key/value rows), read by the plugin through `GET https://admin.da.live/config/{org}/{site}` with the user's token (site tab first, org tab as fallback), the same mechanism as the Pre-publish Linter's `prepublish-lint-rules` tab (`apps/prepublish-linter/SPEC.md`, decision 4) and EW's Request Publish (https://www.aem.live/docs/ew/administering/request-publish). Keys (v1): `providers`, `on-publish` (`comment`, `status`, `comment,status`, `none`), `comment-template`, per-provider-and-type target status (for Workfront: one key for tasks, one for issues), `workfront.default-project-id`, `poll-minutes`, `stale-days`. [ASSUMPTION: key names; the owner may rename.]
20. **Validation and defaults.** Unknown keys are ignored; invalid values are rejected individually with a warning and the previous valid (or default) value stays. Defaults when nothing is configured: `on-publish` = `comment`, default template, poll 5 minutes, **status transitions disabled** until a target status is configured.
21. **How settings reach the worker.** The poller runs with no user present, so it cannot read DA config itself. The plugin therefore pushes the parsed rows to the worker when the settings hash differs from the worker's stored hash (on every plugin open); the worker validates against a strict schema and stores one settings record per site. Because any authenticated caller can push, the worker enforces hard limits that config cannot widen: outbound hosts never come from settings; a status transition is allowed only if the target is in the operator's `vars` allow-list (default empty = no transitions); comment length and placeholders are bounded. Settings changes are audited (who, when, hash). [OPEN Q6: the stronger alternative is for the worker to read DA config itself with the caller's token (a documented exception to #2's "caller token not forwarded" rule, which is written about vendors, not DA).]
22. **Comment template.** Plain text with a closed placeholder set: page path, preview URL, live URL, publish time (ISO), who published (when the API reports it), site, org. Values are substituted once (no recursive expansion), control characters stripped, length capped, no markup. Unknown placeholders stay literal. The default does not include a person's email. [OPEN Q11: whether `{published_by}` (an email from the Admin API) may be posted into Workfront.]
23. **Status transitions.** Only to the configured target for that item type; skipped when the item is already in the target or in phase `done`; the status code must be in the worker allow-list; a vendor rejection (invalid transition for that workflow) is recorded as `failed` with reason, not retried blindly.

**Workfront provider**

24. **Authentication to Workfront: Adobe Developer Console OAuth Server-to-Server.** The legacy Workfront OAuth2 custom applications are being retired: new ones cannot be created after 2026-11-01 and existing ones stop on 2027-02-01 [VERIFIED: https://experienceleague.adobe.com/en/docs/workfront/using/administration-and-setup/configure-integrations/migrate-oauth2-to-developer-console]. API keys "continue to work" but Adobe no longer recommends them for new integrations [VERIFIED: Workfront API basics, https://github.com/AdobeDocs/workfront.en/blob/main/help/quicksilver/wf-api/general/api-basics.md]. So the worker uses a Server-to-Server credential: it mints a token with the client-credentials grant at `https://ims-na1.adobelogin.com/ims/token/v3`, caches it until near expiry (tokens usually last 24 hours; Adobe may throttle excessive minting) and refreshes once on a vendor 401 [VERIFIED: https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/implementation]. The client id and secret are worker secrets; the token is held in memory only (never in D1, never logged, never returned).
25. **Which header carries the token is unverified.** Workfront's own legacy OAuth docs pass an access token in the `sessionID` header; Workfront's MCP server uses `Authorization: Bearer` with a Developer Console credential [VERIFIED both: https://github.com/AdobeDocs/workfront.en/blob/main/help/quicksilver/wf-api/api/oauth-app-pkce-flow.md; https://github.com/AdobeDocs/workfront.en/blob/main/help/quicksilver/workfront-basics/workfront-mcp-server/configure-workfront-mcp-server.md]. For `/attask/api` calls with a Developer Console token the header form, the required IMS scopes and whether the instance must be selected are [OPEN]; sandbox step S1 settles them first, and the provider isolates the choice in one place. The token must never go in a query string.
26. **Identity of the integration is the technical account.** Notes and status changes are made by the `techacct` user [VERIFIED: https://developer.adobe.com/workfront-apis/guides/gaining-access/], which is added as a Contributor with limited access by default and can be scoped like any user. Consequence: authors see (and can link) whatever that account can see, regardless of the author's own Workfront rights. Mitigation: least-privilege sharing of projects with the technical account, the worker's caller allow-list, and a documented note. Attribution of automatic notes to the page and publisher is in the note text. [OPEN Q4: per-user Workfront identity (User Authentication / OAuth web app) is the alternative, deferred.]
27. **Objects and fields.** Tasks (`task`) and issues (`issue`) via the REST object URIs of the `/attask/api/<version>/` API; search uses the `search` action with `name` + `name_Mod=cicontains`, a result `$$LIMIT` (default 100, maximum 2000) and an explicit `fields` list; mutations POST (create) and PUT (update) [VERIFIED: https://github.com/AdobeDocs/workfront.en/blob/main/help/quicksilver/wf-api/general/api-basics.md]. The API version is a worker variable, default `v21.0` (supported to 2028; v22 released 2026-05-08) [VERIFIED: https://github.com/AdobeDocs/workfront.en/blob/main/help/quicksilver/wf-api/api/api-version-support-schedule.md]. The instance host is a worker variable in the documented `<domain>.my.workfront.adobe.com` form [VERIFIED: https://github.com/AdobeDocs/workfront.en/blob/main/help/quicksilver/wf-api/tips-tricks-and-troubleshooting/locate-domain-for-api.md]; it is never read from request data or site config.
28. **Unverified Workfront facts that the build must settle first (sandbox spike, step 1):** how a note is created and attached to a task or issue (candidate: POST to `note` with the object code, object id and note text; third-party sources show this, no primary Adobe page found); whether issues require a project or a request-queue topic at creation; the due-date field for issues versus tasks (tasks: planned completion date [ASSUMPTION]); the status code vocabulary and which transitions a workflow permits; how a note search by marker text is expressed; whether an issue needs an `assignedTo` lookup shape that differs from tasks; the task/issue UI URL form for "open in Workfront". Each is marked [OPEN] where it appears and has a spike check (S1 to S6).
29. **Create semantics.** Tasks need a project (a lookup in the create form, or the site's default project); issues follow the spike result. A created item's description carries the EW edit URL for the page and the page's live URL. Create is not retried on 5xx, so a flaky response never produces duplicate items. After a successful create the plugin links it; if the link call fails, the card offers "Link now" instead of creating another item.
30. **Concurrency limits.** The Workfront API limits concurrent API threads per instance and states that the sandbox has the same limit [VERIFIED: api-basics above]; the poller therefore delivers updates with small bounded concurrency (default 2) and treats `429`/`rate_limited` as retryable.

**Quality gates**

31. **Provider conformance suite plus a second provider.** A table-driven conformance suite exercises every registered provider through the contract only. A test-only provider with a different status vocabulary, different create fields, a different id pattern and different notion of "assignee" is registered in tests and must pass the same suite and the same shell flows with no shell change. This is the acceptance proof for "Jira only adds a module".
32. **Browser rules (reuse #1/#2).** Vanilla DOM, side-effect-free render module plus thin bootstrap; the SDK is imported and awaited, and its `<script>` tag is in the entry page; the plugin uses only `context` and `token` (no `sendText`/`sendHTML`, it never edits the document); every vendor-supplied string is rendered as text; links from the worker are opened only if `https`; the token is sent only as `Authorization: Bearer` to the worker and to `admin.da.live` (not through the SDK's `daFetch`, whose 401 handling redirects to IMS sign-in, wrong inside a plugin iframe; same decision as `apps/prepublish-linter/SPEC.md` decision 13); the worker origin is a constant (localhost only when the page itself is on localhost), never taken from the URL (#2 decision 13).
33. **Worker rules (reuse #2).** Built from the shared template: origin gate, IMS token verification before anything else, secrets through the accessor and redaction, the `proxy` helper with allowed hosts (the Workfront host, the IMS token host, the Admin API host) and the error envelope. This extension adds: a D1 binding with migrations, a cron trigger and a scheduled entry point, the registry, the poller and the extension's own error codes under the template's envelope. [OPEN risk R13: the template spec lists D1 and cron as out of scope and its pipeline is `fetch`-only; the scheduled path must be able to call the exported `proxy`, secrets accessor and logger outside the request pipeline.]
34. **Authorisation scope.** Authentication is the template's (any valid IMS token, optional client-id allow-list). The worker adds an optional allow-list of IMS user ids for this extension. It does not check DA page permissions (the #2 spec lists that as out of scope); an authenticated Adobe user outside the site could call the routes directly. [OPEN Q5.]
35. **README and registry.** The extension README documents setup, the `library` row, the config tab and its keys, the Workfront credential steps (Developer Console project, S2S credential, technical-account access, secret names, instance host variable), the AEM Admin API key (role, header form, expiry and rotation), the D1 and cron requirements, local development (`ref=local` and branch ref), and the provider contract for Jira. The repo README extensions table gets one row: name, folder, entry point, type `library plugin`, description.

## Testing Decisions

**What makes a good test here.** Assert external behaviour: given requests, a controllable clock, and fake outside services (fake IMS, fake Workfront, fake AEM Admin, fake DA config), assert the responses, the observable state of the fakes (what notes exist, what status an item has), what the store contains, and what was logged. Never assert on helper names, module structure or call counts of internal functions. The three properties tested as *negative* properties across every path: **no secret or vendor token ever leaves the worker** (canary), **nothing happens before authentication succeeds**, and **a publish produces at most one update per action** (idempotency).

**Proposed seams** (recorded here instead of asked, per #54). Existing seams from #1 and #2 are reused; one genuinely new seam (P1) is added.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| W1 (primary, highest) | The worker boundary: `worker.fetch(request, env, ctx)` and `worker.scheduled(controller, env, ctx)` | reused from #2, extended with `scheduled` | Node unit tests (`node:test`) for every server-side AC | Constructed `Request`s; the template's test kit (fake IMS key server, signed-token factory, env factory, canary); a stateful in-memory fake Workfront and a fake IMS token endpoint behind the injected `fetch`; a scripted fake AEM Admin status service; an in-memory link store behind the store port; injected clock, `sleep`, `random` |
| P1 (new) | The provider contract (registry entries) | new | Conformance suite for every provider, run through the shell's registry only | A shared conformance table; Workfront via the fake above; a test-only second provider |
| S2 (reused) | Render/logic module + SDK result + injected `fetch` | from #1 | WTR unit tests for the plugin UI | Hand-built SDK result; injected `fetch` returning contract fixtures |
| S1 (reused, extended) | Entry HTML + SDK stub + real local worker | from #1/#2 | Playwright e2e (hermetic) | The #1 SDK stub (token signed by the test key); worker run by wrangler locally (the #2 W2 pattern) with local D1, pointed at local fake servers for IMS, Workfront, AEM Admin and DA config |
| W2 (reused) | The same worker in workerd over real HTTP, including D1 and the scheduled handler | from #2 | Smoke tier | `wrangler dev` local mode; fake servers |
| S3 (reused, extended) | Repo convention check | from #1/#2 | CI lint job | Temp-dir filesystem fixtures |

Why P1 is a new seam and not just W1: AC4 ("Jira only adds a module") is about a boundary inside the worker; testing it only through HTTP would hide which provider obligations exist. W1 is still the highest seam for behaviour (the conformance suite is driven through the registry the routes use). The real EW boundary (real IMS login, real Workfront instance, real publish) is covered only by manual verification (Testing Requirements section 6). The store is behind a port with an in-memory fake (W1) and the real D1 (W2); one contract test suite runs against both, so the fake cannot drift.

**Modules tested:** route layer (auth, validation, errors, field allow-list), link service, settings service, poller (scheduling, detection, baseline, coalescing, leases, budgets), delivery (actions, ledger, markers, retry schedule), provider registry and conformance, Workfront adapter (URL building, auth/token cache, normalisation, error mapping), AEM Admin status source (both generations), link store (memory and D1), plugin render/logic (states, forms, settings sync), repo checks.

**Prior art.**
- `shared/worker-template/SPEC.md`: test kit, canary property tests, `proxy` retry matrix, smoke tier with `wrangler dev`, Playwright against a real local worker (HW*/E2E*/SM*).
- `apps/hello-world/SPEC.md`: SDK stub, convention check S3, `ref=local` and branch-ref manual steps.
- `apps/prepublish-linter/SPEC.md`: config-tab reading and validation, plugin states, stubbing `admin.da.live`.
- `apps/automation-connectors/SPEC.md`: D1 ledger with uniqueness constraints, overlapping-tick idempotency, poll budgets.
- Upstream `adobe-rnd/ew-extensions` has no worker code (confirmed in the #2 spec); the pattern, not code, is the prior art.

## Out of Scope

- **Jira Cloud (#17)** and any provider other than Workfront and the test-only provider. The contract and the second-provider proof are in scope; Jira's OAuth connect flow and token refresh are not.
- **Two-way push from Workfront to EW.** v1 shows live status on open/refresh; it does not receive Workfront event subscriptions (the API exists: https://github.com/AdobeDocs/workfront.en/blob/main/help/quicksilver/wf-api/general/event-subs-api.md) or notify the author. Follow-up.
- Per-user Workfront identity (User Authentication / per-author consent); v1 uses one technical account.
- Multiple links per page (data model allows; UI does not).
- Content refs other than `main`; following a page across move/rename/delete; bulk linking or bulk status updates.
- Unpublish events (a page going 404) and preview events; only publish.
- Workfront custom forms/fields, documents/attachments, time tracking, approvals, Planning, projects creation, portfolios, Fusion.
- Authorisation against DA page permissions (the #2 spec's out-of-scope item) and per-user quotas.
- Mirroring the link into the page document (metadata row) or into a DA sheet.
- Consuming the #7 event relay instead of polling directly (noted as a convergence option).
- A fullscreen "all linked pages" app or reporting on links.
- Marketplace publication, monetisation, and the Adobe outside-activity/IP policy decision (flagged in #1 R1; amplified here because the worker handles customer Workfront data).
- TypeScript, bundlers beyond wrangler, frameworks.

## Further Notes

- **Docs gaps.** The EW developer doc cited by the ticket (https://www.aem.live/docs/ew/developing/apps-plugins) says nothing about backends, config tabs or SDK actions beyond `sendText`/`sendHTML`/`closeLibrary`; everything about context shape, config reads and the library row comes from SDK/da-live source and sibling specs. The Workfront docs describe object search, create and update but no primary page for creating notes was found; those details come from the sandbox spike.
- **Today's date matters for Workfront auth.** On 2026-11-16 new Workfront custom OAuth2 applications can no longer be created (disabled 2026-11-01) and the legacy service stops on 2027-02-01, so a Developer Console Server-to-Server credential is the only forward path [VERIFIED above]. Creating it needs a **full IMS Org admin** (not merely a Workfront admin) [VERIFIED: https://developer.adobe.com/workfront-apis/guides/gaining-access/], which is an owner prerequisite.
- **Two Admin API generations coexist** (`admin.hlx.page` and `api.aem.live`, "hlx6"); both expose page status, both accept an Admin API key [VERIFIED: https://www.aem.live/docs/admin-apikeys; https://www.aem.live/docs/api.html]. Which one a site uses is an open question carried from the #7 spec; the status source is an interface with a base-URL variable.
- **Admin API key role.** Reading page status needs `preview:read` and `live:read` permissions; the smallest predefined role that has both is `basic_author`, which also grants preview-write and code-write permissions [VERIFIED: https://www.aem.live/docs/authentication-setup-authoring, roles table]. Whether a custom narrower role exists is [OPEN]. Keys expire; rotation is a documented procedure.
- **Alternative detection via the log endpoint.** `GET /log/{org}/{site}/{ref}` returns publish operations with the user and paths in one call per site (needs `log:read`, part of role `author`) [VERIFIED: https://www.aem.live/docs/admin.html, operation `getLogs`; roles table]. It scales better than per-page polling and tells you who published. v1 polls per-page status because that is what the ticket specifies and needs the smaller role; the detection source is behind an interface so the log strategy can be swapped in (the #7 relay already does this).
- **The alternative reading of "stored with the page".** Writing the link into the page's metadata block would travel with the page on move, but is visible in published page metadata, modifies a source the author is editing, and still needs a worker-side registry for polling. If the owner prefers it, the worker registry can be kept as the poller's index and the metadata row added as a mirror in a follow-up.
- **Naming.** The ticket title is "Workfront / Jira Link"; the library row title for the one plugin is "Work Item" until the owner decides (Jira shows up inside the same plugin, so a Workfront-only name would age badly).

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)
  └─ editor library ──iframe──> plugin page (https://{ref}--{site}--{org}.aem.live | .preview.da.live | http://localhost:3000)
        │  SDK handshake: { token (IMS), context { org, site, path, ref, ... } }
        ├─ GET https://admin.da.live/config/{org}/{site}   (Bearer user token)  -> config tab `work-management-link`
        └─ fetch(worker /v1/*, Authorization: Bearer <IMS token>)               -> CORS preflight first
                                   ▼
Cloudflare Worker (apps/work-management-link/worker; core imported from shared/worker-template)
  fetch:      1 origin gate -> 2 IMS token check -> 3 route -> shell services (links, settings, items) -> provider registry
  scheduled:  every minute -> poller -> AEM Admin status -> events ledger -> delivery -> provider
  state:      D1 (links, settings, events)     secrets: Workfront client id/secret, AEM Admin API key
        ├─ https://ims-na1.adobelogin.com/ims/token/v3     (client-credentials token for Workfront)
        ├─ https://<domain>.my.workfront.adobe.com/attask/api/v21.0/...   (search, get, create, note, status)
        └─ https://admin.hlx.page/status/... or https://api.aem.live/{org}/sites/{site}/status/...   (publish status)
```

| Concern | Browser plugin (static, public) | Worker (private, holds secrets and state) |
|---|---|---|
| Vendor credentials | never | only place (secret store); Workfront token in memory only |
| UI, EW context | all of it | none |
| Which providers exist, what a provider's forms look like | renders descriptors | owns the registry and descriptors |
| Searching/creating work items, reading status | calls the worker, shows normalised items | calls the vendor, normalises, allow-lists fields |
| Link persistence | none (shows what the worker returns) | D1 link table |
| Publish detection and update posting | none (shows sync state) | scheduled poller, ledger, delivery, retries |
| Per-site settings | reads the config tab, pushes rows | validates, bounds, stores, applies |
| Identity | sends the IMS token | verifies it; user id recorded on link/settings writes |

## 2. EW integration points

- **Library plugin vs app:** library plugin; one `library` row (README documents it; site config at https://da.live/config#/{org}/{site}/):

  | title | path | format | ref | icon | experience |
  |---|---|---|---|---|---|
  | `Work Item` | `/apps/work-management-link/work-management-link.html` | | | | `inline` |

  Path semantics (`/`-relative resolves to `http://localhost:3000` under `?ref=local`, otherwise `https://{branch}--{site}--{org}.aem.live`; the row `ref` filter) are from the #1 spec section 2.5 [VERIFIED there from `ew-panel-extensions/helpers.js`].
- **Config tab read (in addition to its own `library` row):** custom tab `work-management-link` (key/value rows), read by authors via `GET https://admin.da.live/config/{org}/{site}` (multi-sheet JSON, rows under `data`), site tab first then org tab (`/config/{org}`), as in `apps/prepublish-linter/SPEC.md`. Authors therefore need read access to the config; a 403/404 means "use defaults" with a visible notice. The config is edited at https://da.live/config#/{org}/{site}/ with config-write permission (https://www.aem.live/docs/ew/administering/configs [VERIFIED per #1]).
- **SDK actions used:** none. Only the SDK result's `context` (`org`, `site` falling back to `repo`, `path`; `ref`/`branch` for display) and `token`. Capability flags are not needed. The promise never resolves outside EW, so the plugin has the same "waiting, then not inside Experience Workspace" state as hello-world.
- **`ref=local`:** plugin page at `http://localhost:3000` (`aem up`, port hard-coded by EW), local worker at `http://localhost:8787` with the local wrangler environment (`ALLOW_LOCALHOST=true`, local D1, fakes or sandbox endpoints in `vars`). **Branch ref / main:** pages on `*.aem.live` (or `*.preview.da.live`) call the deployed worker via the constant worker origin. The origin the page sends is covered by the #2 CORS allow-list.
- **Config-sheet rows summary:** `library` row (enable), `work-management-link` tab (behaviour). No `apps` row.

## 3. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| DA App SDK result | `context`, `token` | handshake | https://da.live/nx/utils/sdk.js [VERIFIED per #1] |
| DA config `GET https://admin.da.live/config/{org}/{site}` | read the config tab | user IMS token (Bearer) | `apps/prepublish-linter/SPEC.md` [VERIFIED there]; https://docs.da.live/developers/api/config |
| Adobe IMS keys `GET {IMS_ORIGIN}/ims/keys` | verify the caller's token (template) | none | `shared/worker-template/SPEC.md` [VERIFIED there] |
| Adobe IMS token `POST https://ims-na1.adobelogin.com/ims/token/v3` | mint the Workfront S2S token: `client_id`, `client_secret`, `grant_type=client_credentials`, `scope` (form-encoded) | client id + secret (worker secrets) | https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/implementation [VERIFIED]; scopes for Workfront [OPEN] |
| Workfront REST `https://<domain>.my.workfront.adobe.com/attask/api/v21.0/{task|issue|note|project...}` | search (`/search`, `name_Mod=cicontains`, `$$LIMIT`, `fields`), get, create (POST), update (PUT) | S2S token; header form [OPEN S1] | api-basics [VERIFIED]; version table [VERIFIED]; domain format [VERIFIED]; note creation [OPEN S3, third-party sources only: https://docs.oneteg.com/documentation-home/workfrontconnector-v1-1] |
| Workfront credentials setup | Developer Console project, Workfront API, Server-to-Server, technical account (`techacct`, Contributor by default) | IMS Org admin | https://developer.adobe.com/workfront-apis/guides/gaining-access/ [VERIFIED] |
| AEM Admin status `GET https://admin.hlx.page/status/{org}/{site}/main/{path}` (or hlx6 `https://api.aem.live/{org}/sites/{site}/status/{path}`) | read `live.status`, `live.lastModified`, `live.lastModifiedBy` | Admin API key: `Authorization: token <key>` or `X-Auth-Token`; permissions `live:read`, `preview:read` | https://www.aem.live/docs/admin.html; https://www.aem.live/docs/api.html; https://www.aem.live/docs/admin-apikeys [VERIFIED]; role table https://www.aem.live/docs/authentication-setup-authoring [VERIFIED] |
| Cloudflare Cron Triggers | `scheduled()` handler, `crons` in wrangler config; Free plan: 5 triggers per account, 10 ms CPU and 50 subrequests per invocation | n/a | https://developers.cloudflare.com/workers/configuration/cron-triggers/ ; https://developers.cloudflare.com/workers/platform/limits/ [VERIFIED] |
| Cloudflare D1 | links, settings, events; Free: 5 M rows read/day, 100 k rows written/day, 5 GB | binding | https://developers.cloudflare.com/d1/platform/pricing/ [VERIFIED]; migrations via `wrangler d1 migrations` [ASSUMPTION, not fetched] |

**Auth flows.**
- *Browser to worker:* SDK token as `Authorization: Bearer`; the template verifies it (signature, type, expiry, optional client-id allow-list) before routing; this extension adds an optional user-id allow-list.
- *Worker to Workfront:* worker mints a client-credentials token (cached, single-flight, refresh once on 401) and calls the instance host with the header form settled in S1. The caller's IMS token is never forwarded.
- *Worker to AEM Admin:* the Admin API key from the secret store; the caller's token is not used.
- *Poller:* no user; identity is the technical account (Workfront) and the Admin key (AEM).

**Unverified [OPEN]:** Workfront token header form and scopes (S1); note creation and note search shapes (S3); issue creation requirements (S2); due-date field for issues (S2); status vocabularies and permitted transitions (S5); UI URL form (S6); `live.lastModified` semantics and path normalisation (S4); whether D1/KV calls count toward the 50-subrequest Free limit (not stated in the pages read); `context.path` extension form.

## 4. Data contracts

All contracts are behaviour contracts, not code.

**Worker routes** (all require the template's auth; all JSON; errors use the template's envelope with this extension's added codes; `org`/`site` are never request inputs):

| Route | Purpose | Notes |
|---|---|---|
| `GET /v1/config` | enabled providers (descriptors), effective settings summary, settings hash, warnings | descriptors: id, label, item types, create fields, lookups, id pattern; no secrets |
| `PUT /v1/settings` | push parsed config rows | validated; reports accepted/rejected keys; idempotent on equal hash; audited |
| `GET /v1/items/search?provider&type&q&limit` | search or resolve a pasted reference | `q` bounded; a reference resolves to one item |
| `GET /v1/lookups?provider&name&q` | options for a create-form lookup (for Workfront: projects) | bounded |
| `POST /v1/items` | create an item | no 5xx auto-retry; returns normalised item |
| `GET /v1/links?path[&refresh=1]` | current link, live item snapshot (short TTL), sync summary | outage returns 200 with `itemError` |
| `PUT /v1/links` | link `{path, provider, itemType, itemId[, replace]}` | `409 link_exists` unless `replace`; validates id pattern; captures baseline |
| `DELETE /v1/links?path` | unlink | idempotent; cancels pending events |
| `POST /v1/links/retry` | re-queue a `failed_final` event | one-shot |
| `scheduled` | poll and deliver | not an HTTP route |

**Extension-defined error codes** (same envelope as the template): `invalid_path` (400), `invalid_reference` (400), `invalid_input` (400, with a field code), `link_exists` (409), `item_not_found` (404), `item_forbidden` (403), `provider_unavailable` (502), `provider_auth_failed` (502, generic; operator-facing detail only in logs), `settings_invalid` (warning, not an error status), `provider_not_enabled` (400).

**Normalised item** (decision 4):

| Field | Type | Notes |
|---|---|---|
| `provider` | string | registry id, e.g. `workfront` |
| `type` | string | provider's item type, e.g. `task`, `issue` |
| `id` | string | provider id, validated by the provider's pattern (Workfront ids are 32 hex characters [VERIFIED by the examples in api-basics]) |
| `title` | string | text only |
| `url` | string (https) | "open in tool" |
| `status` | `{ code, label, phase }` | `phase` in `open`, `in-progress`, `done`, `other` |
| `assignees` | `[{ name }]` | empty = unassigned |
| `dueDate` | ISO string or null | task planned completion; issue field [OPEN S2] |
| `fetchedAt` | ISO string | |

**Sync summary** (in `GET /v1/links`): `state` in `waiting_first_publish`, `idle`, `pending`, `sent`, `failed` (retrying), `failed_final`, `skipped`; `lastEventAt`; `lastSentAt`; per-action results; reason code; `stale` flag; `sourceError` flag (Admin API unreachable).

**D1 tables (conceptual):**

| Table | Key columns |
|---|---|
| `links` | id; org; site; path; provider; item_type; item_id; item_url; created_by (IMS user id); created_at; baseline_live_at (nullable); last_polled_at; next_poll_at; consecutive_404; state (`active`, `stale`, `removed`); UNIQUE(org, site, path, provider, item_id) |
| `site_settings` | org; site; hash; values (JSON); updated_by; updated_at |
| `events` | id; link_id; live_modified_at; published_by (nullable); comment_state; status_state; attempts; next_attempt_at; last_error_code; created_at; UNIQUE(link_id, live_modified_at) |
| `leases` | name; holder; expires_at (concurrent-tick guard) |

Retention: sent/skipped events 90 days, failed_final 180 days, removed links 30 days [ASSUMPTION; OPEN Q13].

**Worker configuration (`vars`, non-secret):** `ORG`, `SITE`, `IMS_ORIGIN`, `ALLOW_LOCALHOST`, `ALLOWED_IMS_CLIENT_IDS` (from #2); extension-specific: `ALLOWED_USER_IDS` (optional), `WORKFRONT_HOST` (full host), `WORKFRONT_API_VERSION` (default `v21.0`), `WORKFRONT_UI_BASE_URL` (for "open in Workfront" [OPEN S6]), `ALLOWED_PUBLISH_STATUSES` (default empty), `ADMIN_API_BASE` (legacy or hlx6), `POLL_BATCH` (default 20), `MAX_DELIVERY_CONCURRENCY` (default 2).
**Secrets (`secrets.required`):** `WORKFRONT_CLIENT_ID`, `WORKFRONT_CLIENT_SECRET`, `AEM_ADMIN_API_KEY`. Provider-declared secrets must equal this list (repo check).
**Cron:** one trigger, every minute. **Config tab keys:** decision 19.

**Config tab example (README will carry it):**

| key | value |
|---|---|
| on-publish | comment,status |
| comment-template | `Page published: {live_url} ({path}) at {published_at}` |
| workfront.task.on-publish-status | `CPL` [ASSUMPTION: code; S5] |
| workfront.issue.on-publish-status | `CLS` [ASSUMPTION; S5] |
| workfront.default-project-id | `<32-hex project id>` |
| poll-minutes | `5` |

## 5. Folder layout (proposed; fits #1 and #2)

```
apps/work-management-link/
├─ SPEC.md                         this file
├─ README.md                       setup, library row, config tab, per-provider setup, provider contract, local dev
├─ work-management-link.html       entry page (SDK <script type=module> + extension script)
├─ work-management-link.js         bootstrap (awaits SDK, wires modules)
├─ work-management-link-render.js  side-effect-free render + view-model logic
├─ work-management-link.css
├─ lib/                            browser: worker client, config-tab reader, settings sync, state, path helpers
├─ worker/                         wrangler config (D1 binding, cron, secrets.required), entry (routes + scheduled),
│  │                               services (links, settings, items, poller, delivery), store port + D1 + memory,
│  │                               status source (admin generations), provider registry + conformance helpers,
│  │                               migrations/, .dev.vars.example, README
├─ providers/workfront/            vendor README section, recorded sandbox fixtures
│  └─ worker/                      workfront provider module (client, token cache, normaliser, descriptor)
└─ test/                           unit (browser, WTR), worker (node:test), e2e (Playwright), fixtures, support (fakes)
```

Imports follow #2: the worker imports the shared template core by relative path (OPEN Q2 of #2); vendor server code lives in `providers/workfront/worker/` and is registered by the extension worker's registry. #17 adds `providers/jira/` the same way.

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Workfront API facts are partly unverified** (token header form, scopes, note creation, issue creation, issue due date, status codes/transitions, UI URL) | High | Sandbox spike S1 to S6 is build step 1 and gates everything else; findings recorded in the provider README and recorded as fixtures |
| R2 | **Workfront auth path is new and moving:** legacy OAuth2 retired (new apps disabled 2026-11-01, existing end 2027-02-01); S2S credential needs a full IMS Org admin | High, blocks the build | Owner prerequisite (Q3); spike validates a real token against a real instance |
| R3 | **Privilege model:** the technical account's access, not the author's, determines what authors can see and update; any authenticated Adobe user can call the worker | High | Least-privilege project sharing; client-id and optional user-id allow-lists; documented; per-user identity deferred (Q4, Q5) |
| R4 | **Settings spoofing:** any authenticated caller can push settings | Medium | Strict schema; operator allow-list for status targets (default none); hosts never configurable; audit; stronger alternative in Q6 |
| R5 | **Publish detection semantics unverified:** `live.lastModified` per publish, path normalisation, which Admin generation, role sufficiency, key expiry | High | Spike S4 publishes a page twice and records the status JSON; detection source is an interface; log strategy documented |
| R6 | **Cloudflare plan:** Free cron gives 10 ms CPU and 50 subrequests, too small beyond a handful of links; D1/KV subrequest accounting unclear | Medium | Paid plan for real use (Q2); batch and budget settings; smoke test SM-L4 measures |
| R7 | **Duplicate or lost notes** (ambiguous POST, restart mid-tick, overlapping ticks) | Medium | Events ledger with uniqueness, per-action states, marker check before re-post, leases; tests WP5, WU7 |
| R8 | **Orphaned links** when a page is moved, renamed or deleted | Medium | Stale flag (decision 18) and documentation; no auto-delete (Q1 alternative) |
| R9 | **Customer and personal data in a personal Cloudflare account:** page paths and Workfront ids in D1; emails (publisher) in Workfront notes | High for publishing | Minimise (decision 8); template excludes emails by default; policy decision carried from #1 R1 and #2 R1 (Q10, Q11) |
| R10 | **Workfront concurrency limit and Admin API 10 rps/project** | Low-Med | Bounded concurrency; 429 honoured; tick ends early; documented |
| R11 | **`context.path` form and `ref` semantics** (`.html`? branch vs content ref) read from source only | Low-Med | Normaliser accepts both forms; manual M-L3 observes real values |
| R12 | **Token expiry in a long-open plugin** (SDK later token refreshes update only `daFetch`'s copy, per the #7 spec) | Low | 401 handled with a "reopen the library" message, no redirect |
| R13 | **Template gaps:** `fetch`-only pipeline, no state or scheduler, closed error-code list, `proxy` use outside a request | Medium | Ask the template owner (Q2 of the template questions); this ticket keeps scheduler/store/ledger local to the extension and uses only exported `proxy`, secrets accessor, logger |
| R14 | **Jira readiness is unexercised until #17** (OAuth connect UI, per-user tokens) | Medium | Optional browser hook reserved and exercised by the test-only provider; descriptor `connection` field reserved; conformance suite; #17 review checkpoint (M-L14) |
| R15 | **D1 data loss or migration mistake** deletes all links | Medium | Migrations in the repo, documented export/backup step [ASSUMPTION: D1 Time Travel exists, not verified; Q13] |
| R16 | **Note spam:** bulk publish of many linked pages or repeated publishes | Low | One event per observed change; bounded concurrency; one note per publish per item |

## 7. Ordered build plan (sized to #16's acceptance criteria)

0. **Prerequisites (owner):** #1 and #2 landed (tooling, hello-world, shared template, CI); Cloudflare account with D1 and Workers plan decision (Q2); Workfront sandbox instance with a System Admin; an IMS Org admin to create the Developer Console project and S2S credential; technical account shared on a test project; AEM Admin API key for the test site with a role that has `live:read` and `preview:read`; Code Sync and DA site as in #1.
1. **Sandbox spike (S1 to S6), no repo code beyond throwaway scripts:** record the Workfront token header/scopes (S1); create task and issue with minimal fields and find the required ones (S2); create a note on each and find a marker (S3); publish a test page twice and record the Admin status JSON for both generations as available (S4); list status codes and a permitted transition for a task and an issue (S5); capture item URLs (S6). Output: recorded, sanitised fixtures and an updated list of decisions that moved from [OPEN] to [VERIFIED]. Gates steps 5 to 9.
2. **Tooling additions:** D1 binding, cron trigger and `crons` in the extension's wrangler config; migrations folder; scripts to apply migrations locally; repo-check additions (section 5 of Testing Requirements). Lint stays green.
3. **Test support (it is the seam):** stateful fake Workfront (tasks, issues, projects, users, notes, statuses, auth, throttling and failure injection, request log); fake IMS token endpoint; scripted fake AEM Admin status; fake DA config; in-memory store with the store-contract suite; second test-only provider. Self-test: fake responses match the recorded fixtures' shape.
4. **Provider contract and registry**, test-first (WV1 to WV5), with the test-only provider only. AC4 (contract half).
5. **Workfront provider**, test-first against the fake and fixtures (WF1 to WF6). AC1, AC2 (server half).
6. **Shell services and routes:** settings (WK*), links (WL*), search/create (WS*, WC*), status (WG*), field allow-listing and hygiene (WA*). AC1, AC2, AC8.
7. **Poller, ledger and delivery**, test-first (WP*, WU*). AC3.
8. **D1 store + migrations;** store contract suite green on memory and D1; smoke tier SM-L1 to SM-L4. AC3, AC9.
9. **Plugin UI, test-first** (UL*): states, search/link/create/unlink, status card, sync states, settings sync, descriptor-driven rendering with the second provider. AC1, AC2, AC4 (browser half), AC6, AC8.
10. **Entry page, CSS, README** (setup, `library` row, config tab, provider setup, Jira contract, local dev), repo README table row. AC5, AC6.
11. **Hermetic e2e** (E2E-L1 to E2E-L7) against the real local worker with fakes. AC1, AC2, AC3, AC7, AC8.
12. **CI:** extend the `worker-unit`, `worker-smoke`, `lint`, `e2e` jobs; no credentials. AC9.
13. **Deploy and manual verification in real EW** (M-L0 to M-L14) with a real Workfront sandbox; record observed `Origin`, status JSON and the final field names in the README. AC1 to AC8.
14. **Hand-off note to #17:** the provider contract, the descriptor fields, the registration checklist, the unexercised extension points (browser hook, user-level connection).

---

# Testing Requirements

## 1. Worker tests (seam W1, `node:test`) and provider conformance (seam P1)

Fixtures and mocks (all from `test/support/`, built on the #2 test kit): `makeEnv()` production-like env (`ALLOW_LOCALHOST` false) with canary values for `WORKFRONT_CLIENT_SECRET` and `AEM_ADMIN_API_KEY`; `fakeIms` (RSA key, JWKS, `signToken`) for caller tokens; **`fakeWorkfront`**: a stateful in-memory implementation of the used API subset (tasks, issues, projects, users, notes, statuses), requires the token in the header form determined by S1, supports search with `cicontains` and `$$LIMIT`, scripted failures (429, 5xx, ambiguous success-then-timeout, 401 to force token refresh, 403, 404) and records every request; **`fakeImsToken`**: client-credentials endpoint with counted mints and expiry; **`fakeAdminStatus`**: scripted timeline of `live.status`, `live.lastModified`, `lastModifiedBy` per path for both Admin generations, plus 401/403/429; **`fakeDaConfig`**: multi-sheet config JSON; in-memory `LinkStore`; injected `now`, `sleep`, `random`; log capture; `testProvider` (a second provider with different statuses such as `todo/doing/finished`, a numeric id pattern, a single "owner" instead of assignee list, and different create fields). Sandbox-recorded sanitised fixtures live in `providers/workfront/` and gate the fake's shape (WF5). Every test calls `worker.fetch(...)` or `worker.scheduled(...)` and inspects responses, fake state and store contents.

### 1.1 Access, hygiene (AC8)

| ID | Behaviour asserted |
|---|---|
| WA1 | Table-driven over every declared route: no `Authorization` -> `401`, error envelope, no CORS-opened data; provider, store and fakes untouched; `OPTIONS` preflight from an allowed origin needs no token |
| WA2 | Disallowed origin with a valid token -> `403`; allowed origins (`da.live`, site `aem.live`/`aem.page`/`preview.da.live`) are echoed and every error response carries the CORS headers (the template's UC matrix is reused, not rewritten) |
| WA3 | Token signed by another key, expired, wrong type or wrong client -> `401` on every route (sample per route) |
| WA4 | Canary matrix: across success, every error code, vendor 401/403/429/5xx, a vendor error body that echoes the secret, a failing token mint, and the scheduled path, the Workfront secret, the Admin key and the minted Workfront token appear in no response body or header and no log line |
| WA5 | Field allow-list: the fake returns extra fields (owner ids, descriptions, custom data, internal urls); none reach any response; only the normalised shape does |
| WA6 | With `ALLOWED_USER_IDS` set, a valid token for another user -> `403` on every route; unset -> any valid caller allowed (documented) |
| WA7 | `org`/`site` supplied in query, body or headers are ignored; keys always use the worker's configuration |
| WA8 | Outbound host safety: Workfront host only from `vars`; a crafted pasted URL, `q`, name or template cannot change host, object path or query structure (no `&`/`/`/`..` injection); a request whose built URL leaves the allowed hosts fails before any fetch |

### 1.2 Linking (AC1)

| ID | Behaviour asserted |
|---|---|
| WL1 | Link existing task: `PUT /v1/links` -> `200`; `GET /v1/links?path` returns it; a fresh worker instance over the same store still returns it (stored with the page, shared across users) |
| WL2 | Path normalisation: `/a/b`, `/a/b.html`, `/a/b/`, `/a//b`, `/a/index` map to the documented key; `..`, relative paths, control characters, over-long values -> `400 invalid_path`, nothing stored |
| WL3 | Second link on the same page -> `409 link_exists`; with `replace` it swaps the item, resets the baseline and cancels pending events |
| WL4 | Unknown item -> `404 item_not_found`; item the technical account cannot read -> `403 item_forbidden`; nothing stored in both cases |
| WL5 | Item id not matching the provider's pattern (`../x`, wrong length, URL-like) -> `400`, **no vendor call made** |
| WL6 | Unlink -> `204`; `GET` returns no link; poller no longer polls it; pending events cancelled; unlinking again -> `204` |
| WL7 | Baseline: linking a page already published at T creates no event for T; linking a never-published page produces an event on its first publish |
| WL8 | Link row contains only the documented columns; no title, description, page content or email (store dump assertion); `created_by` is the IMS user id |
| WL9 | Another user reading the same page sees the link; link counts per page never exceed one active |

### 1.3 Search and create (AC1)

| ID | Behaviour asserted |
|---|---|
| WS1 | Search returns normalised items (type, id, title, status, assignees, due, url) up to the limit; empty or over-long `q` -> `400`; the vendor request uses `cicontains`, an explicit `fields` list and a bounded `$$LIMIT` |
| WS2 | Pasted Workfront URL or bare id resolves via `get` to one item; a URL on another host -> `400 invalid_reference`, no vendor call |
| WS3 | Type filter `task`, `issue`, both; results for both types are merged with a stable order |
| WS4 | Vendor 429/5xx -> retried per the template (`proxy`) then `502 provider_unavailable`; vendor 401 -> one token refresh then success; second 401 -> `502 provider_auth_failed` with a generic message |
| WC1 | Create task with name and project -> exactly one vendor POST; returned item is normalised; description contains the EW edit URL and live URL as plain text |
| WC2 | Create issue per the S2 findings; project lookup route returns bounded options |
| WC3 | Validation: missing name, name over the cap, unknown type, missing project and no default -> `400 invalid_input` with field codes, no vendor call |
| WC4 | Vendor `5xx` or timeout on create is not retried; the fake contains at most one new item (no duplicates) |
| WC5 | Default project from settings is used when the form leaves project empty |

### 1.4 Status display (AC2)

| ID | Behaviour asserted |
|---|---|
| WG1 | `GET /v1/links` returns status code/label/phase, assignee names and due date for a task and for an issue (different vendor shapes) |
| WG2 | No assignee -> `[]`; several assignees -> all names; no due date -> `null`; vendor timestamps with offsets -> ISO |
| WG3 | Unknown status code -> phase `other` with the vendor's label or the code |
| WG4 | Item deleted in the vendor -> `200` with the link and `itemError: item_not_found` |
| WG5 | Vendor outage -> `200` with the link and `itemError: provider_unavailable`; nothing cached at rest beyond ids |
| WG6 | TTL: two reads within the TTL = one vendor call; after the TTL (injected clock) a new call; `refresh=1` always calls |
| WG7 | Sync summary reflects event states (`waiting_first_publish`, `pending`, `sent`, `failed`, `failed_final`, `skipped`, `stale`, `sourceError`) |

### 1.5 Settings (AC3, per-site configuration)

| ID | Behaviour asserted |
|---|---|
| WK1 | Valid rows stored; `GET /v1/config` returns effective settings and a hash; pushing equal rows again writes nothing |
| WK2 | Invalid values (unknown `on-publish`, poll outside 1 to 60, status code not in the operator allow-list, template over the cap, bad project id) are rejected individually with warnings; previous valid or default value stays |
| WK3 | Unknown keys ignored; keys and values trimmed; case rules documented and tested |
| WK4 | Attempts to set a host or URL-like key have no effect on outbound calls (WA8 re-check) |
| WK5 | No settings pushed -> defaults: `comment` only, default template, poll 5, status transitions disabled |
| WK6 | Each settings write records who (user id), when and the hash |

### 1.6 Poller and detection (AC3)

| ID | Behaviour asserted |
|---|---|
| WP1 | Tick with no due links makes no outbound call |
| WP2 | Due link, live `lastModified` newer than baseline -> exactly one event; baseline advances; delivery runs once |
| WP3 | Unchanged `lastModified` -> no event; `next_poll_at` set per the site's poll interval (clamped) |
| WP4 | Two publishes between polls -> one event for the newest timestamp (coalescing) |
| WP5 | Same tick delivered twice, and two concurrent ticks (lease) -> one event and one vendor note |
| WP6 | `live.status` 404 (never published) -> no event; publish after 404 -> event; unpublish then republish -> event |
| WP7 | Admin 401/403 -> `sourceError` recorded, backoff applied, other links still polled, no crash |
| WP8 | Admin 429 -> `Retry-After` honoured; tick ends early; unpolled links stay due |
| WP9 | 100 due links with `POLL_BATCH=20` -> 20 polled, oldest-due first, subrequests under the budget; all 100 served over successive ticks (fairness) |
| WP10 | Both Admin generations build the right URL (`admin.hlx.page/status/{org}/{site}/main/{path}` and `api.aem.live/{org}/sites/{site}/status/{path}`); path encoded; host on the allow-list |
| WP11 | Status request carries the Admin key in the documented header form and never the caller's token; the key is absent from logs |
| WP12 | Consecutive 404s past `stale-days` flag the link `stale` (still returned, never deleted) |
| WP13 | Clock skew: worker clock a day ahead or behind gives identical events (only API timestamps are compared) |

### 1.7 Delivery (AC3)

| ID | Behaviour asserted |
|---|---|
| WU1 | `on-publish=comment` -> exactly one note on the right object (task vs issue) with template text, placeholders substituted once, marker included; the fake's item status is unchanged |
| WU2 | `on-publish=status` -> one read and one status update to the configured code for that type; fake item now has it |
| WU3 | `comment,status` -> comment then status; a status failure leaves the comment `sent`; retry re-runs only the failed action |
| WU4 | Item already in the target status or in phase `done` -> status `skipped(already)`, no update |
| WU5 | Target status not in the operator allow-list or invalid -> `skipped` with `settings_invalid` surfaced; never sent |
| WU6 | `on-publish=none` -> event `skipped`, no vendor calls |
| WU7 | Vendor 5xx on the note POST is not retried in-call; later ticks retry at +1/+5/+15/+60/+240 min (injected clock); success on the 3rd attempt = one note; ambiguous failure (note landed, response lost) -> next attempt finds the marker and does not post again |
| WU8 | Vendor 403/404 -> `failed_final` with reason code, no further attempts |
| WU9 | Template safety: unknown placeholders literal; markup treated as plain text; values containing `{path}`-like text not re-expanded; control characters stripped; length capped |
| WU10 | Vendor 401 during delivery -> one token refresh then success |
| WU11 | `POST /v1/links/retry` re-queues a `failed_final` event once; on a `sent` event it is a no-op with a clear code |
| WU12 | Delivery never forwards the caller's token; concurrency capped at `MAX_DELIVERY_CONCURRENCY` |
| WU13 | Bulk: 30 linked pages published in one window -> 30 events, 30 notes, concurrency and 429 handling respected, no duplicates |

### 1.8 Provider contract (AC4)

| ID | Behaviour asserted |
|---|---|
| WV1 | The conformance table runs against every registry entry (`workfront` via the fake, `testProvider`): descriptor shape, `parseReference` accept/reject (foreign hosts rejected), search/get/create/lookup/`postPublishUpdate` shapes, closed error taxonomy, allow-listed fields |
| WV2 | **Zero-shell-change proof:** with only `testProvider` registered, search, link, status display, settings, publish detection and both update actions work through the same routes and the same plugin code; the provider appears in `GET /v1/config` |
| WV3 | A provider missing a required operation is rejected at registry construction (configuration error), not as a runtime 500 |
| WV4 | An error outside the taxonomy (including a raw vendor message) is mapped to `provider_error` with the generic message |
| WV5 | Provider-declared secret names are readable only through the accessor and equal the worker config's `secrets.required` (the repo check UR-L3 is the CI form) |

### 1.9 Workfront adapter against the fake (AC1, AC2, AC3)

| ID | Behaviour asserted |
|---|---|
| WF1 | URL building: host and version from `vars`, `/attask/api/<version>/`, object codes `task`/`issue`, search params via URL encoding, no secrets in the query string |
| WF2 | Token: one mint for 10 concurrent callers (single-flight); reused until near expiry; refresh once on 401; mint failure -> `auth_failed`; token never stored in D1 |
| WF3 | Normalisation: assignee from the vendor's assignee/assignment shape, status phase mapping, due date field per type, ISO conversion |
| WF4 | Note and status-update request bodies match the shapes found in spike S3/S5 |
| WF5 | Contract: the fake's response shapes equal the sandbox-recorded fixtures (keys and types); guards R1 |
| WF6 | The credential travels only in the header form found in S1 |

### 1.10 Store contract

SC1: one suite (insert, unique constraints, lease, ordering by `next_poll_at`, event idempotency, retention purge) run against the in-memory store in W1 and against local D1 in the smoke tier (SM-L2).

## 2. Browser unit tests (seam S2, `@web/test-runner`, injected `fetch`, hand-built SDK result)

| ID | Behaviour asserted |
|---|---|
| UL1 | SDK never resolves -> "waiting" then "not inside Experience Workspace" (short injectable timeout); no worker call made |
| UL2 | No link -> search and create entry points; linked -> card with title, status label (text, not colour alone), assignee names, due date; "Unassigned" and "No due date" shown plainly |
| UL3 | Search: debounced input; results list shows type, title, status, assignee; selecting links and shows the card; errors are plain-language |
| UL4 | Paste of a Workfront URL or id resolves to one result; an unrecognised input shows a helpful message |
| UL5 | Create form is built from the provider descriptor (fields, required, lookups); validation messages; success links automatically; link failure after create offers "Link now" (no second create) |
| UL6 | Unlink asks for confirmation; replace flow; double-click does not send two requests |
| UL7 | Sync states render as text: waiting for first publish, pending, sent with time, failed with reason and "Retry", skipped, stale, source error; Retry calls the retry route once |
| UL8 | All vendor strings (title, assignee, label) are rendered as text: `<img src=x onerror=...>` creates no element; an item `url` that is not `https` is not rendered as a link; external links use `rel="noopener noreferrer"` |
| UL9 | The token never appears in DOM or console; the worker origin ignores `?worker=...`; localhost origin only when the page is on localhost |
| UL10 | Settings sync: config tab read from a stubbed `admin.da.live` (site tab, org fallback); a hash difference triggers one `PUT /v1/settings`; invalid rows shown as warnings; 403/404 on config -> defaults with a notice; `401` handled without redirect |
| UL11 | Descriptor-driven rendering with the test-only provider (different fields, statuses, id pattern) works unchanged (AC4, browser half) |
| UL12 | Worker errors map to messages: `401` (reopen EW), `403`, `404`, `409`, `5xx`, timeout; bounded wait with visible "working" state; no stack traces |
| UL13 | `context.path` variants (`/a/b`, `/a/b.html`, `/`) normalised before calls; context without org/site -> clear message |
| UL14 | Keyboard operation and accessible names for all buttons; status conveyed in text |

## 3. Runtime smoke tier (seam W2, `wrangler dev` local, no Cloudflare login)

Starts the real worker in workerd with local D1 (migrations applied), `IMS_ORIGIN`, Workfront host, Admin base and DA config pointed at local Node fake servers, secrets from an env file; the scheduled handler is triggered through wrangler's local scheduled-event test mechanism (https://developers.cloudflare.com/workers/configuration/cron-triggers/ describes testing cron triggers locally).

| ID | Behaviour asserted |
|---|---|
| SM-L1 | Worker bundles (shared template import, `jose`, D1 binding, cron config) and starts; a bare request -> `401` |
| SM-L2 | Store contract suite (SC1) passes against local D1 |
| SM-L3 | Link, advance the fake Admin `lastModified`, trigger scheduled: fake Workfront has exactly one note; a second trigger adds none; canary secret absent from all responses |
| SM-L4 | Records CPU/wall time and subrequest count per tick for 1, 20 and 100 links (informational against R6; no hard threshold until a baseline exists) |

## 4. End-to-end tests inside the extension (seam S1, Playwright, Chromium, hermetic)

Server: the #1 static server on `:3000`; the real worker via wrangler on `:8787` with local D1 and the fakes as local servers; the #1 SDK stub with a token signed by the test key and `context` `{ org, site, path, ref: 'local' }`; `page.route` serves the stub SDK and the DA config tab; every other external request is aborted.

| ID | Behaviour asserted |
|---|---|
| E2E-L1 | Open the plugin, search, pick an item, link: card shows the fake's status, assignee, due date (real cross-origin request, preflight included) |
| E2E-L2 | Create a task, auto-linked; the fake contains one new task whose description has the page URLs |
| E2E-L3 | Advance the fake Admin `lastModified`, trigger the scheduled event, reload the plugin: fake item has the note (and status change when configured); plugin shows "sent" |
| E2E-L4 | Per-site settings: config tab with `on-publish=comment,status` and a target status results in note + transition; `none` results in neither |
| E2E-L5 | Negative: request without token -> `401` shown as a plain message; token signed by another key -> `401`; neither HTML, DOM, nor any network response contains the client secret, Admin key or minted token |
| E2E-L6 | Only expected hosts contacted: page, SDK stub, worker, stubbed `admin.da.live` |
| E2E-L7 | Standalone (SDK route unfulfilled): standalone message, no worker call; second author (new browser context, same stub identity or another user id) sees the same link |

## 5. Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| UR-L1 | The folder has an entry page named after it, a README, tests; the repo README table has a row (`library plugin`) pointing to it |
| UR-L2 | The README contains the registration row, the config tab and its keys, the per-provider setup section, and the provider contract section (heading grep so they cannot be silently removed) |
| UR-L3 | `secrets.required` equals the union of provider-declared secrets plus the Admin key; no `vars` key named like a secret; `.dev.vars.example` lists every secret (extends the #2 UR3/UR5 rules); D1 binding and exactly one cron trigger present |
| UR-L4 | Every registered provider has a README section and appears in the conformance run (enumerates the registry) |
| UR-L5 | No file outside the extension folder (other than the README table row) is changed by this extension; no cross-extension imports |

## 6. End-to-end checks inside real Experience Workspace (manual; needs interactive Adobe login)

**Accounts and credentials needed:** GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, per #1); an Adobe IMS identity with access to the DA org/site and config-write permission; Chrome; Cloudflare account (D1, Workers plan per Q2, Wrangler login); a **Workfront sandbox or non-production instance** (the Workfront API docs say production-affecting API use should be tested in the beta/sandbox environment first [VERIFIED: api-basics "Disclaimer"]) with a System Admin; an **IMS Org admin** to create the Adobe Developer Console project, Workfront API credential (Server-to-Server) and technical account; the technical account shared on a test project with a few tasks and issues; an AEM Admin API key for the test site (role per Further Notes; created with a config-admin identity); the S2S client id/secret and Admin key stored only as worker secrets. Never paste a real IMS token, client secret or Admin key into chat, issues or logs.

- **M-L0 (prereq):** worker deployed (D1 created, migrations applied, three secrets set, vars set, cron present); `curl -i <worker>/v1/config` -> `401`; `library` row added; config tab created; plugin appears at `https://da.live/...` editor library.
- **M-L1 (spike S1 to S6, before the build):** execute the build-plan step-1 checks against the sandbox with throwaway scripts; record outcomes. Proves nothing in the product; retires R1/R5.
- **M-L2 (`ref=local`):** `npm start` (port 3000) and the worker dev script (port 8787) against the sandbox; open a document in the EW editor with `?ref=local`; open the library; **Work Item** appears and shows the "link a work item" state. Proves AC6 (reachable from the library), AC7 (local).
- **M-L3 (search and link):** search for a known sandbox task and issue (and paste a URL); link one; compare title, status, assignee and due date with the Workfront UI. Record the real `context.path`/`ref` values and the page's `Origin` seen by the worker (DevTools). Proves AC1, AC2.
- **M-L4 (create):** create a task (with project lookup) and an issue; confirm each exists in Workfront with the page back-link and is linked. Proves AC1.
- **M-L5 (stored with the page):** reload; open the same page in another browser profile and as a second user; the link is there. Unlink and relink. Proves AC1.
- **M-L6 (publish update):** edit and publish the page (Request Publish or the normal publish flow); wait at most the poll interval plus one minute; the Workfront item shows exactly one note with the live URL; with a status mapping configured, the status moved; the plugin shows "sent". Publish again quickly twice: a single coalesced note. Proves AC3.
- **M-L7 (per-site settings):** change the config tab through `none`, `comment`, `status`, `comment,status`, a bad status code (warning shown, no transition), a custom template; reopen the plugin; observe each outcome on the next publish. Proves AC3 (configurable per site).
- **M-L8 (negatives and access):** `curl` without token -> `401`; with a valid token and `Origin: https://evil.example` -> `403`; link an item the technical account cannot see -> generic not-found/forbidden message. Proves AC8.
- **M-L9 (failure and recovery):** set a wrong Workfront client secret, publish, watch the plugin show "failed"; fix the secret (`wrangler secret put`), press Retry; exactly one note appears. Proves AC3 (retry/idempotency) and AC8 (rotation without code change).
- **M-L10 (branch ref):** push branch `wml-plugin` (simple name), wait for code sync, open the editor with `?ref=wml-plugin` (library row `ref` blank); the plugin loads from `{branch}--ew-extensions--jazhou-adobe.aem.live` and works against the deployed worker; repeat M-L3 and M-L6 once. Proves AC7 (branch ref).
- **M-L11 (secret hygiene):** search the Network panel responses, page source and application storage for the client secret, Admin key and any bearer token other than the IMS token to the worker (none); `wrangler secret list` shows names only. Proves AC8.
- **M-L12 (listing):** the repo README extensions table has the row; the S3 check passes. Proves AC5, AC6.
- **M-L13 (docs walk-through):** a reviewer follows the extension README from clean clone to a working local instance using only the README. Proves AC5.
- **M-L14 (Jira readiness review):** read the provider contract section and the test-only provider and confirm in writing that a Jira provider would be a new module plus two registry lines, noting any gaps for #17 (OAuth connect, per-user tokens). Supports AC4.

## 7. CI additions (no credentials, no Cloudflare login, no vendor calls)

| Job | Steps | Notes |
|---|---|---|
| `lint` (existing) | ESLint + Stylelint over the extension (worker globals override); S3 UR-L1 to UR-L5 | |
| `unit` (existing) | WTR UL1 to UL14 | `--no-sandbox` Chromium args as in #1 |
| `worker-unit` (existing, extended) | `node:test` WA, WL, WS, WC, WG, WK, WP, WU, WV, WF, SC1 (memory) | runs on every push and PR |
| `worker-smoke` (existing, extended) | SM-L1 to SM-L4 with local D1 and the scheduled trigger | advisory until stable, per #2 Q11 |
| `e2e` (existing, extended) | E2E-L1 to E2E-L7 with the worker and fakes as web servers | Chromium only |

## 8. Acceptance-criteria traceability (ticket #16)

| # | Acceptance criterion (#16) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Author can search for or create a Workfront task/issue and link it to the current page; the link is stored with the page | WS1 to WS4, WC1 to WC5, WL1 to WL9, WF1 to WF4, UL3 to UL6, E2E-L1, E2E-L2, E2E-L7 (shared across authors), SM-L3 | **M-L3**, **M-L4**, **M-L5** (persistence across browsers/users); Q1 confirms the meaning of "stored with the page" |
| AC2 | Plugin shows the linked item's status, assignee and due date | WG1 to WG7, WF3, UL2, UL7, E2E-L1 | **M-L3** (compare with Workfront UI) |
| AC3 | When a linked page is published (worker polls publish status) the worker posts an update to the linked item (comment and/or status transition, configurable per site) | WP1 to WP13, WU1 to WU13, WK1 to WK6, SM-L3, E2E-L3, E2E-L4 | **M-L6**, **M-L7**, **M-L9**; spike S4 for detection semantics |
| AC4 | Provider interface is defined so Jira only adds a module | WV1 to WV5 (conformance and zero-shell-change proof), UL11, UR-L3, UR-L4 | **M-L14** review; README contract section (UR-L2) |
| AC5 | All code in its own self-contained folder per the scaffold convention, with a README (setup, EW config-sheet row, site config read) | UR-L1, UR-L2, UR-L5 | **M-L13** (docs walk-through), **M-L12** |
| AC6 | Listed in the repo README extensions table and reachable from the editor library | UR-L1 (table row and entry page) | **M-L2** (library), **M-L12** |
| AC7 | Works in EW with `ref=local` and with a branch ref | UL9, E2E-L1 to E2E-L7 (local origin, constant worker origin), WA2 (origins) | **M-L2** (`ref=local`), **M-L10** (branch ref) |
| AC8 | Vendor credentials only in this extension's worker (from the shared template); browser never receives them; unauthenticated calls rejected | WA1 to WA8, WF2, WF6, WP11, UL9, UR-L3, E2E-L5, E2E-L6, SM-L1, SM-L3 | **M-L0** (bare `curl` -> 401), **M-L8**, **M-L9** (rotation), **M-L11** (hygiene) |
| AC9 | Core logic covered by unit tests; lint and CI green | All W1/P1/S2 tables above; SC1; CI jobs in section 7 | CI shows `lint`, `unit`, `worker-unit`, `e2e` green on a PR; deliberately break a rule on a scratch branch (for example loosen the field allow-list) and see WA5 fail |

Every acceptance criterion on #16 maps to at least one automated test or a numbered manual step.

## 9. Open questions for the owner

1. **"Stored with the page" (decision 6).** Is a durable worker-side link keyed to org/site/path acceptable, or must the link live inside the page document (metadata row: travels with moves, but publishes ticket ids in page metadata, edits a source the author has open, and still needs a worker registry)? Should a metadata mirror be a follow-up?
2. **Cloudflare account, plan and template scope.** Workers Paid (cron CPU and subrequests; D1 free limits are only a prototype)? This ticket adds D1 and a cron trigger that the #2 template lists as out of scope: confirm that the scheduler, store and ledger stay local to this extension and that the template's exported `proxy`, secrets accessor and logger may be called from the scheduled path.
3. **Workfront access.** Who is the IMS Org admin who can create the Developer Console project and Server-to-Server credential, which sandbox instance is available, what is its host, and which technical account and test project will be used? Which IMS scopes does the credential need (not found in the docs read)?
4. **Service account versus per-user identity.** Accept that the technical account's visibility defines what authors can link and update, with attribution only in note text? Or require per-user Workfront consent (User Authentication) in a follow-up?
5. **Who may call the worker.** Beyond "any valid IMS token passing the client-id allow-list", do you want an allow-list of IMS user ids (or another org signal) from the start? DA page permissions are not checked (as in #2).
6. **Settings authenticity.** Accept the browser-pushed settings with operator hard limits (decision 21), or have the worker read the DA config itself with the caller's token (a documented exception to #2's "not forwarded" rule, which targets vendors)?
7. **Admin API generation and key.** Does the target site use `admin.hlx.page` or `api.aem.live`, and may the poller hold a `basic_author`-level key (the smallest predefined role with `live:read` and `preview:read`)? Do you want the per-site log strategy (one call per site, who published) instead of per-page polling for scale, or later consuming the #7 relay?
8. **Default behaviour.** Default `on-publish` = comment only, status transitions off until configured, poll 5 minutes: right defaults? What target statuses does your Workfront use for tasks and issues?
9. **Multiple links per page.** One active link in v1 (data model allows more): acceptable, or do you want several (as Contentful's Jira app)?
10. **Policy and data location.** The worker will process customer Workfront data and Adobe IMS tokens from a Cloudflare account: is a personal account acceptable for the sandbox proof only, with an Adobe-provided account required before real use (carries #1 R1, #2 Q1)?
11. **Personal data in notes.** May `{published_by}` (an email from the Admin API) appear in Workfront notes, or must the default and the placeholder set exclude it?
12. **Content ref.** Confirm page content is always published to `main` (the library context's `ref` is the code branch), so non-main refs are out of scope.
13. **Retention and backups.** Event retention (90/180 days) and link retention (30 days after removal): acceptable? Do you want a documented D1 export/backup step?
14. **Provider placement.** Confirm `apps/work-management-link/providers/workfront/worker/` for server-side vendor code, registered by the extension worker's registry (carries #2 Q3), and the optional browser hook for Jira's connect flow.
15. **Naming.** Library row title: "Work Item", "Workfront / Jira Link", or other? Icon?
16. **Follow-ups.** Do you want tickets for: Workfront event subscriptions (status pushed to authors), stale-link cleanup/move tracking, a per-site "linked pages" overview app?
