# Spec: Release & Campaign Planner

Ticket: jazhou-adobe/ew-extensions#37 (this spec: #75). Blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision, a real-EW observation, or an answer from Adobe.

Vocabulary follows #1/#2: *extension* = one folder `apps/<name>/` (type comes from its EW config-sheet row); *worker* = a per-extension backend in `apps/<name>/worker/` built from `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the extension. Additional terms used here: *release* = the planner's unit of work (a named set of pages with a go-live date); *snapshot* = EW/EDS content snapshot (https://www.aem.live/docs/snapshots-reviews); *scheduler* = Adobe's Cloudflare-hosted snapshot scheduler that EW's Snapshots and Schedule Publish features use (https://www.aem.live/developer/scheduling, source https://github.com/adobe/helix-snapshot-scheduler); *Admin API* = `https://admin.hlx.page` (https://www.aem.live/docs/admin.html); *DA source API* = `https://admin.da.live/source` (https://docs.da.live/developers/api/source).

---

## Problem Statement

Marketing and content teams launch content in groups: a campaign page, its landing pages, a few updated product pages, all going live together at a set time. EW already has the ingredients: **snapshots** capture a set of pages at a point in time, `.aem.reviews` URLs let people review them, and **scheduling** publishes a snapshot at a future time (https://www.aem.live/docs/ew/authoring/snapshots, https://www.aem.live/developer/scheduling). But they are spread over separate apps (Snapshots, Schedule Publish at https://da.live/apps/scheduler, the page editor) and each answers a narrow question about one snapshot or one page. Nobody can answer the planner's questions in one place:

- What is going live this week and next, across all releases, on a calendar?
- For each release, which pages are still drafts, which are previewed, which are published, and which have **changed since they were published** (or since they were captured in the snapshot, which would make the go-live publish stale content)?
- Is the release actually scheduled in EW, when, by whom, and did the scheduled publish happen?
- Is the same page in two releases, or also scheduled individually, so that two launches collide?

Today an admin answers these by opening the Snapshots app, expanding each snapshot, opening the scheduler list, and checking each page in the editor. The ticket asks for a fullscreen app that does this planning **on top of** EW's own snapshots and scheduling (the Contentful Launch pattern), and explicitly not a second publishing engine.

## Solution

A fullscreen EW **app** (`apps/release-planner/`) registered in the `apps` sheet. An admin opens it from the EW Apps menu for the site and gets:

- a **list view** and a **calendar view** of the site's releases, filterable by state and campaign label;
- a **release detail panel** with the release's pages and a per-page status (**draft, previewed, published, changed since publish**), plus release-level state (planning, in review, scheduled, due, published, failed, ...), derived live from EW;
- **create / edit / schedule / unschedule / delete** a release. A release is created as a real **EW snapshot** (same name, same pages) plus a small planner record stored in DA for the things a snapshot cannot hold (campaign label, the planned page set, notes). Go-live is the snapshot's own `scheduledPublish` plus an entry in EW's scheduler, so EW does the publishing at the chosen time exactly as it does for a snapshot scheduled from the EW Snapshots app;
- deep links into EW (the Snapshots app for the snapshot, the editor for each page, the `.aem.reviews` URL).

The planner owns **no publishing logic and no schedule storage**: everything about *what* goes live and *when* is read from and written to EW's own systems; the planner record only adds planning metadata.

**Backend decision (key finding, see Implementation Decision 4 and Build Analysis section 3).** The ticket rates this "Partial backend", and ACs 4 and 8 assume a worker. I probed every service the planner must call (Admin API, scheduler, DA source API) with CORS preflights from all four origins an extension page can have (`da.live`, `{ref}--{site}--{org}.aem.live`, `.preview.da.live`, `http://localhost:3000`) and read the source of EW's own Snapshots and Scheduler apps: they call all three directly from the browser with the user's IMS token (through the SDK's `daFetch`). No vendor credential is needed and no call was found that the browser cannot make. The spec therefore **does not build a worker in v1**, the same decision the block-bulk-editor spec took for the same reason, and records the evidence, the rule for when a worker becomes necessary (a secret or a call the browser cannot make), how a future worker would use the #2 contract, and the owner question this raises (Q1) because ACs 4 and 8 are worded for a worker.

## User Stories

Admin / release planner (the persona the ticket calls "admin"; what that requires in EW terms is Decision 14):

1. As an admin, I want to see all releases for my site in one list with name, campaign, go-live, state and page count, so that I know what is in flight without opening each snapshot.
2. As an admin, I want a month calendar with each release on its go-live day, so that I can see the launch rhythm and spot a crowded day.
3. As an admin, I want to move between months and jump to today, so that I can plan ahead and look back.
4. As an admin, I want releases without a go-live date in a separate "unscheduled" list beside the calendar, so that nothing is hidden because it has no date.
5. As an admin, I want to create a release with a name, a go-live date and time, and a set of pages, so that I can group pages into one launch.
6. As an admin, I want to paste page URLs or paths (from the editor, preview, or a spreadsheet), and have them normalised and de-duplicated, so that I do not need to know the path rules.
7. As an admin, I want to be told which pasted pages do not exist, have never been previewed, or are in an unsupported format, so that I fix the list before it fails.
8. As an admin, I want the go-live date entered in my local time with the time zone shown and the UTC value visible, so that I schedule what I mean.
9. As an admin, I want a clear error if the go-live time is less than five minutes away or in the past, so that I am not surprised by the scheduler's lead-time rule.
10. As an admin, I want an optional campaign label on a release, so that I can group related releases and filter by campaign.
11. As an admin, I want a free-text description and notes on a release, so that the reason for the launch travels with it.
12. As an admin, I want the release to be a real EW snapshot, so that reviewers can use the normal `.aem.reviews` URLs and the EW Snapshots app shows the same release.
13. As an admin, I want a one-click link to the release's snapshot in the EW Snapshots app, so that I can use EW features the planner does not have (review password, launch).
14. As an admin, I want a one-click link to each page in the EW editor and its review URL, so that I can fix a page that is not ready.
15. As an admin, I want each page to show draft, previewed, published or changed since publish, so that I can tell what still needs work.
16. As an admin, I want a count of pages per status on each release row, so that I can scan readiness without opening the release.
17. As an admin, I want to know when a page in the release has changed since it was captured in the snapshot, so that I do not go live with an out-of-date copy.
18. As an admin, I want a one-click action to refresh the snapshot's copy of selected or all stale pages, so that the go-live publishes the current preview.
19. As an admin, I want planned pages that cannot be added to the snapshot yet (never previewed) to be listed as "not in snapshot yet" with the reason, so that I know what blocks scheduling.
20. As an admin, I want to see pages that are in the snapshot but not in the plan (added in the EW Snapshots app), so that the two views do not silently disagree.
21. As an admin, I want to see which releases a page belongs to and whether another release or an individual Schedule Publish entry also targets it, so that I can avoid colliding launches.
22. As an admin, I want to schedule a release's go-live through EW's scheduler from the planner, so that EW publishes at the chosen time.
23. As an admin, I want the planner to show the release's EW state (planning, in review, rejected, scheduled, due, published, failed), so that I trust what I see.
24. As an admin, I want a banner with a link to the EW scheduler app when my site is not registered for scheduling, so that I know how to enable it, and I still want to be able to save a planned date.
25. As an admin, I want a release that has a planned date but is not scheduled in EW to be clearly marked "date set, not scheduled in EW", so that I do not assume it will publish.
26. As an admin, I want to change a release's go-live time, so that I can move a launch.
27. As an admin, I want to unschedule a release (clear the date, remove the schedule entry, unlock the snapshot), so that I can pull a launch back.
28. As an admin, I want editing the pages of a scheduled (locked) release to be an explicit, confirmed "unlock, edit, reschedule" flow, so that I never change what will publish by accident.
29. As an admin, I want to see after the go-live time whether the scheduled publish succeeded or failed, with the failure reason if EW logged one, so that I can react.
30. As an admin, I want a release whose go-live time has passed but whose outcome I cannot confirm to say so explicitly instead of "published", so that the planner never over-claims.
31. As an admin, I want to delete a release (its planner record, its schedule entry and its snapshot) after typing its name, so that abandoned launches disappear without leaving stray snapshots.
32. As an admin, I want multi-step operations (create, schedule, refresh) to show each step's result and let me retry the remaining steps, so that a mid-way failure is recoverable.
33. As an admin, I want snapshots created in the EW Snapshots app to appear in the planner as "unmanaged" releases that I can adopt, so that existing launches are visible too.
34. As an admin, I want a planner record whose snapshot was deleted in EW to appear as "snapshot missing" with a repair or remove option, so that data does not rot.
35. As an admin, I want two admins editing the same release not to overwrite each other silently, so that a conflict is reported.
36. As an admin, I want a refresh button and an automatic refresh when I return to the tab, so that status is current without polling constantly.
37. As an admin, I want the list loaded progressively with a visible progress indicator, so that a site with many releases is usable immediately.

Author / reviewer (read-only users):

38. As an author without publish rights, I want to open the planner and see releases, pages and status read-only, so that I can follow launches I contribute to.
39. As an author, I want actions I am not permitted to take to be disabled with a reason (or to fail with a plain message when EW refuses), so that I understand why.
40. As a reviewer, I want the review links of a release's pages, so that I can open them without finding the snapshot first.

Maintainer / operator:

41. As the maintainer, I want the planner to hold no vendor credential and no token string, so that nothing sensitive can leak from this public code.
42. As the maintainer, I want the planner to call only a closed set of hosts, so that a bug cannot send the user's token elsewhere.
43. As the maintainer, I want the planner to work with `ref=local` and with a branch ref, using the site's `main` content in both, so that I can test my own changes against real snapshots.
44. As the maintainer, I want the README to state the config-sheet row, the prerequisites (scheduler registration, roles) and which site config the planner reads (none), so that enabling it is copy-paste.
45. As the maintainer, I want the planner row in the repo README extensions table and the S3 convention check green, so that the folder convention holds.
46. As the maintainer, I want the contract with EW's scheduler isolated in one small module with recorded fixtures, so that when Adobe changes it the break is local and visible.
47. As the maintainer, I want unit tests for the domain rules (page status, release state, dates) that need no network, so that CI proves the core logic.
48. As a maintainer reviewing an upgrade of EW, I want a documented manual re-record procedure for the service fixtures, so that fakes stay faithful.

EW end user:

49. As an admin, I want to find Release Planner in the Apps menu, so that I do not need its URL.
50. As an admin opening the app outside EW, I want a clear "not inside Experience Workspace" message, so that I understand a blank page.
51. As an admin opening a not-yet-trusted app, I want the README to explain the EW trust prompt, and that this app acts with my own rights, so that I am not alarmed or misled.
52. As an admin using a keyboard or screen reader, I want the calendar and list to be usable without a mouse, so that planning is accessible.

## Implementation Decisions

Decision level only; module boundaries and layout are in the Build Analysis. API routes appear as contracts.

### Product and scope

1. **Surface and type.** Fullscreen **app**, registered with one row in the `apps` sheet of the site config; folder `apps/release-planner/` with an entry page named after the folder, per the owner-approved convention. It does **not** register in the `library` tab. Extensions-table `type` = `app`. It reads **no site config** (README says so explicitly for AC5).
2. **A release is an EW snapshot plus a planner record.** One release = one snapshot; the release id is the snapshot name. Everything EW can hold stays in EW: title, description, page set, lock/review state, go-live (`metadata.scheduledPublish` on the manifest), schedule entry. The planner record (DA JSON, Decision 6) adds only: campaign label, notes, the **planned** page set, creator, timestamps, schema version. The record never duplicates title, go-live or state; when the snapshot and the record disagree EW wins and the planner shows the difference (stories 20, 33, 34).
3. **Build on EW, do not reimplement.** The planner never publishes pages itself. Go-live uses the scheduler exactly as EW's Snapshots app does (Decision 9). The planner has no timer, no queue and no schedule store.
4. **No worker in v1 (decided here; owner confirmation requested, Q1).** Rule: a backend concern exists when a call needs a secret, or the browser cannot make it. Audit of every call the planner makes (table in Build Analysis section 3): all are browser-capable with the user's IMS token via the SDK's `actions.daFetch`, none needs a secret. Consequences: `apps/release-planner/worker/` is **not created**; no Cloudflare account, no CORS allowlist and no wrangler config for this extension; ACs 4 and 8 are met by showing, with tests, that the set of calls the browser cannot make is empty and that no credential exists in or is sent from the extension (Testing Requirements). If a backend concern appears later (first candidate: go-live reminders to Slack or email, see Further Notes), the worker is built from `shared/worker-template/` at `apps/release-planner/worker/` and its vendor code under `apps/release-planner/providers/<vendor>/`, with the #2 pipeline (CORS gate, IMS check, secrets accessor, proxy helper) unchanged. **Rejected alternative:** a worker that calls the Admin API with a site API key on the user's behalf. That is a confused-deputy design (the worker would act with the key's authority, not the user's), the #2 template deliberately never forwards the caller's token, and EW already enforces the user's own roles when the browser calls the Admin API.
5. **Identity.** All calls go through `actions.daFetch` from the SDK result, which attaches `Authorization: Bearer <IMS token>` itself (and `x-content-source-authorization` for `admin.hlx.page`) [VERIFIED: https://da.live/nx/utils/daFetch.js, https://da.live/nx/utils/sdk.js]. The planner code never reads, stores, renders, logs or forwards the token string, and never builds an `Authorization` header. A `401` from `daFetch` is treated as "session expired, reload from EW" (daFetch may itself call `handleSignIn()`, which can navigate the iframe [ASSUMPTION, same as the block-bulk-editor spec]).
6. **Where planner records live.** One JSON file per release in the site's DA content under a dot-folder dedicated to releases (the same convention EW uses for `.snapshots`, https://github.com/adobe/da-nx/blob/main/nx/blocks/snapshot-admin/utils/utils.js `daSnapshotEdit`), written through the DA source API with optimistic concurrency: `If-None-Match: *` on create, `If-Match: <ETag>` on update; `412` = conflict, reported to the user (story 35) [VERIFIED: conditional PUT in https://github.com/adobe/da-admin/blob/main/src/storage/version/put.js; ETag exposed through CORS: https://github.com/adobe/da-admin/blob/main/src/utils/daResp.js]. One file per release (not one index file) so two admins editing different releases never conflict. Listing uses the DA list API with the continuation-token header (as in the block-bulk-editor spec). "Stored per site" (AC1) = records live under the site's own DA content. DA ACLs decide who can write (https://www.aem.live/docs/ew/administering/permissions). **Rejected alternative:** stash planner data in the snapshot manifest `metadata` (the Admin API accepts arbitrary key/values: https://www.aem.live/docs/admin.html, POST snapshot manifest). It would keep one store, but EW's own Snapshots app rebuilds `metadata` from its form on save (https://github.com/adobe/da-nx/blob/main/nx/blocks/snapshot-admin/views/snapshot.js `getUpdatedManifest`), so it may drop unknown keys [ASSUMPTION: whether the POST replaces or merges `metadata` is undocumented; spike S-4 settles it]. Whether DA stores arbitrary (non-sheet) JSON and treats dot-folders like any folder is [ASSUMPTION], settled by spike S-5.
7. **Release list = union of three sources.** Snapshot list from the Admin API (the authority for existence), planner records from DA, and the schedule from the scheduler. Rows: *managed* (snapshot + record), *unmanaged* (snapshot, no record: created in EW; adoptable by writing a record), *orphan* (record, no snapshot: repairable by recreating the snapshot from the planned pages, or removable). The planner never modifies a snapshot it does not manage without an explicit action (adopt, edit, schedule).
8. **Release identity and names.** Release id = snapshot name = lowercase slug of the typed name restricted to letters, digits and hyphens (the restriction EW's own form applies, https://github.com/adobe/da-nx/blob/main/nx/blocks/snapshot-admin/views/snapshot.js `formatSnapshotName`), uniqueness-checked against the snapshot list at create time. The display name is the snapshot `title`; the id is not renamed after creation. Maximum length is [ASSUMPTION: no documented limit; cap 60, confirmed by spike S-3].
9. **Scheduling = EW's contract, reproduced exactly.** Schedule go-live for a release (requires publish permission, Decision 14) runs these steps in order, each idempotent (a step already satisfied is skipped): (a) ensure the plan's previewed pages are in the snapshot and current (`forceUpdate`); (b) write the manifest with `metadata.scheduledPublish` as an ISO-8601 UTC string; (c) lock the snapshot (review `request`); (d) register the schedule with the scheduler, snapshot id, `approved: true`, and the user's email as `userId` (mirrors EW's "Approve & publish" with a date: https://github.com/adobe/da-nx/blob/main/nx/blocks/snapshot-admin/views/snapshot.js `handleReview`, `updateSchedule`). The scheduler re-reads `scheduledPublish` from the manifest, requires it to be at least five minutes in the future and registers the entry; at the time it approves and publishes the snapshot and records the outcome in the Admin audit log [VERIFIED: https://github.com/adobe/helix-snapshot-scheduler `register/src/index.js`, `publish/src/index.js`, `shared/admin.js`]. Unscheduling reverses it: delete the schedule entry, clear `scheduledPublish` from the manifest (read-modify-write, as EW's scheduler app does: https://github.com/adobe/da-nx/blob/main/nx/blocks/scheduler/scheduler.js `clearSnapshotScheduledPublish`), unlock (manifest `locked: false`). Reschedule = update date + re-register (the scheduler overwrites the entry by snapshot id). Whether the scheduler requires the snapshot to be locked before `approve` is [ASSUMPTION: EW's UI enables Approve only when locked, snapshot-admin `snapshot.js` line using `?disabled=!this._manifest?.locked`; spike S-6].
10. **Which scheduler route.** The documented, currently-used route is `POST /schedule` on `https://helix-snapshot-scheduler-prod.adobeaem.workers.dev` (what EW's Snapshots app calls today: https://github.com/adobe/da-nx/blob/main/nx/blocks/snapshot-admin/utils/utils.js `updateSchedule`; documented in the scheduler README). The source also has a path-parameter variant `POST /schedule/snapshot/{org}/{site}` labelled "new route". The planner uses the route EW's own app uses and isolates it in the Scheduler client module (Decision 24) so a switch is a one-line change [ASSUMPTION that both stay live].
11. **Scheduler availability is optional.** The planner checks registration with `GET /register/{org}/{site}` (`200` registered, `404` not; same as EW). If not registered: a banner explains and links to the EW scheduler app; creating releases and saving a go-live date still work (the date lives in the manifest), and the release shows "date set, not scheduled in EW" (stories 24-25). The planner does **not** register the site itself: registration needs an Admin API key creation (a credential) and is a one-time admin action EW already provides at https://da.live/apps/scheduler (https://www.aem.live/docs/ew/administering/schedule-publish). Snapshot scheduling is documented as an early-access feature that Adobe enables per organisation (https://www.aem.live/docs/ew/authoring/snapshots, "Scheduling Snapshots"), while the developer doc says scheduling is built in for EW sites (https://www.aem.live/developer/scheduling) [OPEN, Q5].
12. **Content ref is always `main`.** Snapshot, status and schedule calls use the literal `main` ref in their paths (https://www.aem.live/docs/admin.html: `/snapshot/{org}/{site}/main/...`; EW does the same). The SDK `context.ref` is the **code** ref (`local`, a branch, or `main`) and must never be used as a content ref; otherwise `ref=local` would break every call (AC7). Org and site come from the SDK `context` (`org`, `repo`) for the app surface [VERIFIED per #1 spec 2.2/2.3].
13. **No unrequested writes outside the release set.** The planner writes only: snapshot manifests and resources of releases it manages or adopts, scheduler entries for those snapshots, and planner records. It never previews or publishes a page, never edits a page, never touches another snapshot, never registers the scheduler, and never handles the snapshot review password (it round-trips existing `metadata` untouched; the password stays managed in the EW Snapshots app).

### Permissions and trust

14. **Capabilities, enforced by EW, not by the planner.** Creating/editing a release needs snapshot write; locking needs `preview:write`; unlocking, review actions and the scheduled publish need publish rights (`live:write`) per the Admin API (https://www.aem.live/docs/admin.html, snapshot operations); writing records needs DA write on the site; reading the audit log needs the `author` role (https://www.aem.live/docs/auditlog). The planner (a) reads publish permission up front the way EW does, from `live.permissions` of the status of `/` (https://github.com/adobe/da-nx/blob/main/nx/blocks/snapshot-admin/utils/utils.js `getUserPublishPermission`), and DA write permission from the `x-da-actions` header of record reads, to disable actions with a reason; (b) treats this as UX only and always handles `401/403` from the server as the real answer. "Admin" in the ticket is therefore "a user who holds these roles"; read-only users get a read-only planner (stories 38-39). [OPEN, Q4: confirm that is the intended meaning.]
15. **Trust model.** Like every EW app, the planner acts with the user's rights (the shell's trust prompt says so, per #1 spec 2.4). Because it can lock snapshots and schedule publishes, every write that changes what or when something goes live (schedule, reschedule, unschedule, delete, refresh stale pages) states its effect in a confirmation, and the README says the app acts as the signed-in user.

### Domain rules (pure, the main unit-test surface)

16. **Page status** is derived per page from four inputs: source (edit) last-modified, preview status and last-modified, live status and last-modified (bulk status API `select: edit, preview, live`), and, for release pages, the snapshot copy's last-modified (manifest `resources[].lastModified`). Closed set, evaluated in this order:
    - `missing`: no source and no preview (404 on both): the page does not exist (anymore). Not one of the four ticket statuses; it exists so bad input never renders as "draft".
    - `draft`: source exists, preview is 404 (never previewed or removed from preview).
    - `previewed`: preview is 200 and live is not 200.
    - `changed since publish`: live is 200 and (preview last-modified or source last-modified is later than live last-modified).
    - `published`: live is 200 and neither is later.
    Release-scoped flags, independent of the status: `not in snapshot` (planned, not captured; includes the reason: `draft`/`missing`), `snapshot stale` (preview or source later than the snapshot copy: go-live would publish the older copy), `unplanned` (in snapshot, not in the plan), `also in release X`, `also scheduled individually at T`. The comparison rule (later-than, with a small tolerance for clock skew) is [ASSUMPTION]: how `lastModified` is assigned on publish is undocumented (https://www.aem.live/docs/admin.html says "last modification date"); spike S-7 verifies it on a real page, and the rule lives in one function so a fix is local.
17. **Release state** is derived, never stored, from: manifest (`locked`, `review`, `metadata.scheduledPublish`, resources), the scheduler entry (present, `approved`, time), the audit-log outcome when readable, the pages' statuses, the registration result and `now`. Closed set: `planning` (unlocked, no date); `date set, not scheduled in EW` (date in manifest, no scheduler entry, date in the future); `in review` (locked, review `requested`, no entry); `rejected` (review `rejected`); `scheduled` (entry present, time in the future; flag `approved`); `due` (entry present, time passed: the scheduler is about to run or lagging; the cron runs every five minutes, https://github.com/adobe/helix-snapshot-scheduler README); `published` (no entry, time passed, and either the audit log reports `scheduled-publish` status `published` for this snapshot, or, when the log is not readable, every page is live no earlier than the go-live time); `failed` (log reports `failed`; show reason and attempts); `unconfirmed` (time passed, no entry, neither evidence available: never rendered as published). Field names in `manifest.review`/`locked` come from EW's own UI code (snapshot.js `_reviewStatus`, `_lockStatus`) [VERIFIED as used by EW; the Admin API schema documents `locked` only, https://www.aem.live/docs/admin.html].
18. **Time.** Go-live is stored only as ISO-8601 UTC in the manifest (as EW does: `new Date(value).toISOString()`). The form uses a local date-time field, shows the browser time zone name and the UTC equivalent, and validates at least five minutes ahead of `now` (the scheduler's rule: https://github.com/adobe/helix-snapshot-scheduler `register/src/index.js` `updateSchedule`, mirrored by EW's UI `validateSchedule`). Calendar bucketing uses the browser's time zone through `Intl` with an injectable zone so tests are machine-independent. Scheduler run precision is about five minutes (cron every five minutes, entries queued with exact delay: scheduler README) [VERIFIED as documented; actual precision not measured, ASSUMPTION].
19. **Page input rules.** Accepts full URLs on the site's hosts (`aem.page`, `aem.live`, `aem.reviews`, `da.live/edit`) or paths; strips query, hash, `.html`; keeps only html pages, `.json` sheets and `.svg` or extension-less paths (the filter EW's form applies: snapshot-admin `utils.js` `filterPaths`/`pathnameAllowedForSnapshot`); de-duplicates; **rejects wildcards** (`*`): the Admin API treats a wildcard add as a bulk operation over a whole folder (https://www.aem.live/docs/admin.html, bulk snapshot), which is too destructive for a paste box. Cap per release: 500 pages [ASSUMPTION, UI sanity cap; the API itself is sync under 200 paths and async above, which the client handles].
20. **Resilient multi-step operations.** Create, schedule, unschedule, refresh and delete are ordered steps; each step reports done / skipped / failed with the service's message (`X-Error`, which the Admin API and the scheduler expose to CORS: observed `access-control-expose-headers: x-error` on both, 2026-11-16). On failure the sequence stops, shows what completed and what remains, and offers "retry remaining". There is no automatic rollback; the one exception is create, where a failure after the snapshot exists leaves a valid unmanaged release that can be adopted or retried (nothing is lost and nothing is half-hidden).
21. **Load and rate limits.** The Admin API is limited to 10 requests per second per project across all users and operations; throttled calls get `429`; bulk APIs are the sanctioned way to touch many resources; async jobs are capped at 500 pending per topic (https://www.aem.live/docs/limits). Design: page status always via the **bulk status job** (one job for the union of visible pages, polled like EW does, 750 ms); snapshot manifests fetched progressively with a small concurrency cap (default 4 [ASSUMPTION]); `429` retried with exponential backoff and a visible "waiting" state; status is fetched lazily (visible month in calendar view, opened release in list view) rather than for all releases at once. Expected volume is [OPEN, Q9].
22. **EW origins and hosts.** The planner may call only: `https://admin.hlx.page`, `https://admin.da.live`, and `https://helix-snapshot-scheduler-prod.adobeaem.workers.dev` (all through `daFetch`). It links out (never fetches) to `https://da.live`, `*.aem.page`, `*.aem.live`, `*.aem.reviews`. The host list is a constant, not read from the URL (same rule as the #2 worker-origin constant) and is enforced by a test.
23. **Frontend technology.** Vanilla ES modules and DOM, no framework or bundler (mirrors #1, hello apps and upstream). The calendar is a hand-written month grid (a table with ARIA grid roles), not a library. All service text and user input is rendered as text, never HTML.
24. **Modules** (interfaces are the test seams): Admin client; Scheduler client; Release store (DA records); Domain (paths, page status, release state, dates, calendar math); Loader (union of sources, progressive, rate-limit aware); Orchestrator (multi-step operations); Views (list, calendar, detail, forms); Bootstrap. Clients take `daFetch` and the three base URLs as inputs, return a closed set of outcome kinds, and never throw on HTTP errors.

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: what the DOM shows for a given SDK result and service state, which HTTP requests the planner makes (method, URL, body, order) and which it does not, and what the pure domain functions return for given inputs. Never assert on helper names, DOM structure beyond roles/text, or CSS classes. No test may need the network, IMS, EW or a real clock (inject `now`, time zone and delays). Domain rules are tested as data tables (input -> expected status/state) so that a rule change is one row.

**Proposed seams** (recorded instead of asked). One boundary matters: the **service boundary behind `actions.daFetch`** (three origins, plain HTTP). Everything above it is the extension; everything below it is EW.

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| S1 (primary, highest) | Entry HTML page + SDK module boundary, with `daFetch` forwarding to the three service origins | reused from #1, extended as in block-bulk-editor | Playwright e2e | #1's `page.route` serves the SDK stub whose `actions.daFetch` forwards to real `fetch`; `page.route` on the three origins is backed by **stateful in-memory fakes** (Admin snapshots + bulk status jobs + audit log, scheduler, DA source with ETags). Any other external request is aborted |
| S2 | Modules + injected `daFetch` | reused from #1 | WTR unit tests | `daFetch` wired directly to the same fakes (no HTTP); domain tables with no fakes; injected `now`, zone, delays |
| S3 | Repo convention check | reused from #1 | CI lint job | filesystem fixtures: folder complete, README row and registration row present, **no `worker/` and no credential-looking files** (the AC8 negative) |

No new seam type is introduced. There is no W1/W2 worker seam because there is no worker (Decision 4); if one is added later it adds #2's W1/W2 seams unchanged.

**The fakes are a test-support asset, not a mock of convenience.** They are small stateful models of: Admin API snapshot list/manifest/resource add (sync and async job) and delete, review request/approve/reject with lock rules, bulk status job lifecycle, audit log; scheduler register/schedule/get/delete with the five-minute rule and a `tick(now)` that performs the scheduled publish the way the real publish worker does; DA source list (continuation token), get/put with `ETag`, `If-Match`, `If-None-Match`, `x-da-actions`. Each fake exposes knobs for the facts still [ASSUMPTION] (manifest `metadata` merge vs replace; approve requires locked or not; log readable or not) and **the suite runs both settings**, so the code is correct under either answer until spike S-4/S-6 fixes the truth. Contract fixtures: real responses recorded during the manual spike (sanitised) are committed in the extension's test folder and a test asserts each fake's responses have the same shape as the recorded ones (guards drift, risk R5).

**Modules tested:** Domain (paths, page status, release state, dates, calendar), Admin/Scheduler/DA clients (outcome mapping, headers, `main` ref, host allowlist), Release store (CRUD, conflict, list paging), Loader (union, progressive, `429`), Orchestrator (every operation, partial failure, retry-remaining), Views (list, calendar, detail, forms, a11y), Bootstrap (standalone state), repo checks.

**Prior art:** the #1 spec's S1/S2/S3 seams and SDK stub; block-bulk-editor's `daFetch`-through-in-memory-fake pattern and DA ETag handling (`apps/block-bulk-editor/SPEC.md`, decisions 15, 19, 23); upstream `adobe-rnd/ew-extensions` `test/e2e/utils/da-api-stubs.js` (`stubDaApi`) and `session-auth.js` dependency-injection seams (https://github.com/adobe-rnd/ew-extensions). Upstream has no snapshot/scheduling/release code (checked via the GitHub tree API, 2026-11-16: no path matching snapshot, schedul, releas or campaign), so the planner has no upstream prior art for its domain; its prior art is EW's own code in `adobe/da-nx` (`nx/blocks/snapshot-admin`, `nx/blocks/scheduler`) and `adobe/helix-snapshot-scheduler`, which this spec reads for contracts, not copies.

## Out of Scope

- Any backend: worker, Cloudflare account, secrets, CORS allowlist (Decision 4). Go-live reminders/notifications (Slack, email), ICS calendar feed, and any other time-triggered or credential-holding behaviour.
- Publishing, previewing or editing pages from the planner; unpublish and rollback after a release has published.
- Registering the site with the scheduler or creating Admin API keys (EW's scheduler app does it).
- Managing the snapshot review password, the snapshot `launch` feature, and `.snapshots` content (EW Snapshots app).
- Cross-site or cross-org planning; multi-site campaigns; releases containing pages from several sites.
- Wildcard/folder adds, a folder-tree page picker (v1 accepts pasted URLs/paths; a picker is a possible later improvement), CSV import/export.
- Recurring releases, dependencies between releases, approvals beyond EW's review states, comments.
- Individually scheduled **pages** as first-class items (shown only as collision warnings on release pages, story 21).
- Drag-and-drop rescheduling on the calendar (v1 reschedules through the form).
- Marketplace publication and the Adobe IP/outside-activity question (README flag only, per #1).

## Further Notes

- **Overlap and positioning.** The scoring sheet rates overlap risk 4/5. The planner's differentiating value is exactly what EW's Snapshots (https://www.aem.live/docs/ew/authoring/snapshots) and Schedule Publish (https://www.aem.live/docs/ew/administering/schedule-publish) lack: a calendar, cross-release page status with "changed since publish / since snapshot", campaign grouping, and collision warnings. The build plan therefore delivers the **read-only planner first** (it adds value for releases created in EW today, with no write risk) and writes second.
- **Observed contracts worth knowing.** (1) The scheduler's `POST /schedule` does not check the caller's token in the source at `main` (it only reads the snapshot manifest with the site's stored key); authorization effectively rests on who can write the manifest (https://github.com/adobe/helix-snapshot-scheduler `register/src/index.js` `updateSchedule`). Not ours to fix, worth reporting to Adobe [OPEN, Q12]. (2) The scheduler's browser CORS rule is a hostname *suffix* match on `aem.live`, `aem.page`, `da.live` plus two localhost ports, so it is loose; irrelevant to the planner's design. (3) After a scheduled publish EW calls approve with `keepResources=true`, so the snapshot keeps its page list, but docs say a plain approve clears it (https://www.aem.live/docs/snapshots-reviews), which is why the planner keeps its own planned page set.
- **First worker candidate, if wanted (Q1).** A "notify on go-live" feature needs a time trigger (cron, which #2 lists as out of scope) and a vendor credential (a Slack incoming-webhook URL is itself a secret: https://api.slack.com/messaging/webhooks). It would be built as `apps/release-planner/worker/` with `providers/slack/` and would also need a way to run without the user's browser, i.e. a service identity, which changes the auth model of the #2 template. It overlaps with `chat-approvals`. Not recommended for v1.
- **Ticket graph.** #37 is blocked by #2, but with Decision 4 it uses #2 only for tooling conventions and as the contingency; the owner may relax that edge [OPEN, Q1].
- This `SPEC.md` is a planning artefact; keep or delete at build time (as the #1 spec notes).

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)
  └─ iframe: Release Planner (origin: {ref}--{site}--{org}.aem.live | .preview.da.live | http://localhost:3000)
        │  SDK handshake: { token (never read by us), context {org, repo, ref, ...}, actions.daFetch }
        │  actions.daFetch(url)  -> Authorization: Bearer <IMS> added by the SDK
        ├──► https://admin.hlx.page      snapshots (list, manifest, add/remove pages, lock/review), bulk status + jobs, audit log
        ├──► https://helix-snapshot-scheduler-prod.adobeaem.workers.dev   register check, schedule, get schedule, delete schedule
        └──► https://admin.da.live       list/get/put planner records (JSON, ETag)
```

| Concern | Release Planner (static files in this repo) | EW / Adobe services |
|---|---|---|
| Identity | calls `daFetch`; never sees the token string | SDK attaches the user's IMS token; services enforce roles |
| What goes live | reads/writes snapshot page set | snapshot content (immutable copies), review state |
| When it goes live | writes `scheduledPublish`, asks scheduler to register | scheduler cron queues and publishes, writes audit log |
| Per-page status | derives from bulk status + snapshot copy dates | status API (edit/preview/live timestamps) |
| Planning metadata | campaign, notes, planned pages in DA records | DA stores them (ETag concurrency, ACLs) |
| Calendar, list, detail, rules | all of it (pure domain + views) | none |
| Secrets, CORS, retries to vendors | none (no vendor) | n/a |
| Worker | **none in v1** (Decision 4) | n/a |

## 2. EW integration points

- **App vs library plugin:** fullscreen **app**. `apps` sheet row in `https://da.live/config#/{org}/{site}/`:

  | title | description | image | path | ref |
  |---|---|---|---|---|
  | Release Planner | Plan releases and campaigns on top of EW snapshots and scheduling | (optional) | `https://da.live/app/{org}/{site}/apps/release-planner/release-planner` | (blank) |

  Format and the unknown meaning of the `ref` column for apps are as in the #1 spec 2.5 [VERIFIED docs; `ref` semantics OPEN]. Result: a card at `https://da.live/apps#/{org}/{site}` and the direct URL; `ref=local` opens the code from `http://localhost:3000` (#1 spec 2.3).
- **Site config read:** none. **Other prerequisites to document (AC5):** the site registered for scheduling (`https://da.live/apps/scheduler`, needs admin), the roles in Decision 14, DA write access to the site for planner records.
- **SDK actions used:** `daFetch` only (plus `context`). `sendText`, `closeLibrary` etc. are plugin concerns. `setTitle` is automatic.
- **Deep links out (read-only strings):** snapshot in EW: `https://da.live/apps/snapshots?snapshot={id}#/{org}/{site}` [VERIFIED as built by https://github.com/adobe/da-nx/blob/main/nx/blocks/scheduler/scheduler.js `buildItemLink`]; page in editor `https://da.live/edit#/{org}/{site}{path}`; review URL `https://{id}--main--{site}--{org}.aem.reviews{path}`; preview `https://main--{site}--{org}.aem.page{path}`; live `https://main--{site}--{org}.aem.live{path}` [VERIFIED: snapshot-admin `utils.js` `formatResources`].
- **`ref=local` / branch ref:** only where the code loads from. All service calls use content ref `main` (Decision 12). The `context.ref` value is displayed in a footer line for debugging only.
- **Org/site:** from `context.org` and `context.repo`. If the app is registered in a different site than the one planned, that is the "code site = content site" limitation shared with every extension [OPEN as in block-bulk-editor Q4].

## 3. External APIs, auth flows, and the browser-capability audit

Every call the planner makes, with the evidence that the browser can make it. "CORS preflight" = `OPTIONS` observed with `curl` on 2026-11-16 from `Origin` = `https://da.live`, `https://main--ew-extensions--jazhou-adobe.aem.live`, `https://main--ew-extensions--jazhou-adobe.preview.da.live`, `http://localhost:3000`; all four were allowed on all three services. A curl preflight does **not** prove an authenticated browser request works; spike S-1 does (R2).

| # | Call | Purpose | Method and path | Needed role | Source |
|---|---|---|---|---|---|
| A1 | List snapshots | release list | `GET admin.hlx.page/snapshot/{org}/{site}/main` -> `{snapshots:[id]}` | `snapshot:read` | https://www.aem.live/docs/admin.html (snapshot list) |
| A2 | Snapshot manifest | release details, page list, lock/review, go-live | `GET .../snapshot/{org}/{site}/main/{id}` -> `{manifest:{id,title,description,created,lastModified,lastUpdated,locked,resources[{path,status,lastModified}],metadata?}}` | `snapshot:read` | same; `metadata`, `review` seen in EW UI code (R3) |
| A3 | Write manifest | create, edit, set go-live, lock/unlock | `POST .../snapshot/{org}/{site}/main/{id}` JSON `{title,description,metadata,locked?}`; lock needs `preview:write`, unlock needs `live:write` | `snapshot:write` | same |
| A4 | Add/remove pages | page set | `POST .../main/{id}/*` JSON `{paths[], forceUpdate?}`, `{delete:true, paths[]}` (EW's delete form); `200/202`; `202` -> poll `links.self` job until `state:"stopped"` (<200 paths sync, else async) | `snapshot:read`+`write` | same; delete form from snapshot-admin `utils.js` `deleteSnapshotFiles` |
| A5 | Review state | lock for scheduling, reject/unlock | `POST .../main/{id}?review=request|approve|reject` (`message` optional); `204` | `snapshot:read`, `live:read`, `live:write` | same |
| A6 | Delete snapshot | delete release | `DELETE .../main/{id}` after emptying resources (EW's `deleteSnapshot` sequence) | `snapshot:delete` | same; snapshot-admin `utils.js` |
| A7 | Bulk status | per-page status | `POST admin.hlx.page/status/{org}/{site}/main/*` JSON `{paths[], select:["edit","preview","live"]}` -> `202` job; poll `GET /job/{org}/{site}/main/status/{job}` and `/details` | `edit/preview/live:list` | same. Job-details payload shape is only partly documented [OPEN, spike S-2] |
| A8 | Page status (single, permission probe) | publish permission | `GET .../status/{org}/{site}/main/{path}` -> `live.permissions` | read | same; EW `getUserPublishPermission` |
| A9 | Audit log | outcome after go-live | `GET .../log/{org}/{site}/main?from=&to=` (+ `nextToken`) | `log:read` = `author` role | https://www.aem.live/docs/auditlog |
| S1 | Registration | scheduler enabled? | `GET {scheduler}/register/{org}/{site}` `200/404` | any signed-in user (observed code path: no admin check on GET) | scheduler README; source `isRegistered` |
| S2 | Get schedule | scheduled releases and pages | `GET {scheduler}/schedule/{org}/{site}` -> `{"{org}--{site}": {"<snapshotId|/path>": {type:"snapshot"|"page", scheduledPublish, approved?, userId?}}}`; requires `Authorization` and the ability to read the snapshot list | snapshot list read | source `getSchedule`; the README example still shows an older string-valued shape [VERIFIED code; README stale] |
| S3 | Schedule snapshot | go-live | `POST {scheduler}/schedule` JSON `{org, site, snapshotId, approved, userId}`; `400` with `X-Error` for bad/past/<5-min date, `404` not registered | none enforced by the scheduler (see Further Notes) | source `updateSchedule`; EW `updateSchedule` |
| S4 | Unschedule | unschedule | `DELETE {scheduler}/schedule/snapshot/{org}/{site}/{id}` | snapshot list read | source `deleteSnapshotSchedule` |
| D1 | List records | release records | `GET admin.da.live/list/{org}/{site}/{releases folder}` (+ `da-continuation-token` header paging) | DA read | https://docs.da.live/developers/api/list; sibling spec |
| D2 | Read / write / delete record | CRUD | `GET/PUT/DELETE admin.da.live/source/{org}/{site}/{releases folder}/{id}.json`; PUT multipart `data`; `If-Match` / `If-None-Match: *` | DA write | https://docs.da.live/developers/api/source; conditional PUT in da-admin source |

CORS observations (2026-11-16, curl preflight with request headers `authorization, x-content-source-authorization, content-type`):
- `admin.hlx.page` returns `204`, echoes the request origin, allows methods `GET, HEAD, POST, PUT, OPTIONS, DELETE`, allows headers `Authorization, x-auth-token, x-content-source-authorization, content-type`, `allow-credentials: true`, exposes `x-error, x-error-code` (it also reflected `https://evil.example`, which does not matter because auth is a bearer header, not ambient cookies).
- The scheduler returns `204`, echoes the four origins, allows `GET, POST, DELETE, OPTIONS` and headers `Content-Type, Authorization`, exposes `X-Error` (and did **not** echo `evil.example`).
- `admin.da.live` returns `204` with `Access-Control-Allow-Origin: *`, `Allow-Headers: *`, methods `HEAD, GET, PUT, POST, DELETE`, exposes `ETag`, `da-continuation-token`, `X-da-actions`. A wildcard `Allow-Headers` does not cover `Authorization` under the Fetch spec, but EW's own apps call this host from the browser with `Authorization` in production, so [ASSUMPTION] it works for extension origins too; spike S-1 confirms (R2).

**Capability conclusion (supports Decision 4):** no row needs a secret or a call the browser cannot make. EW's own Snapshots app (`nx/blocks/snapshot-admin`) and Scheduler app (`nx/blocks/scheduler`) make A1-A8, S1-S4 from the browser with the same `daFetch`.

**Auth flow:** SDK handshake -> `actions.daFetch` -> `Authorization: Bearer <IMS>` (+ `x-content-source-authorization` for `admin.hlx.page`) -> service validates the IMS identity and applies its roles. The scheduler forwards the same `Authorization` value to the Admin API for its own permission probes (source `isAuthorized`). The planner holds no other credential. The scheduler's own stored credential (a `publish`-role API key created at registration) lives in Adobe's KV; it is never visible to the planner.

**Contingency if S-1 fails** (a service rejects an extension origin): ask Adobe to allow the origin; do **not** build a proxy holding a site key (Decision 4). If a worker is still wanted, its contract is #2's unchanged.

## 4. Data contracts (behaviour, not code)

**Planner record** (JSON in DA; schema version 1). Fields: `schema` (1), `id` (= snapshot name), `campaign` (string, optional, trimmed, max 80), `notes` (string, optional, max 2000), `pages` (array of normalised paths, the plan, order preserved, max 500), `createdBy` (email from the SDK `context`/profile if present else absent), `createdAt`, `updatedAt` (ISO UTC). Forbidden by construction: title, go-live, state, tokens, passwords. Readers ignore unknown fields and reject `schema` values they do not know (shown as "created by a newer planner").

**Release view model** (what the views receive): `id`, `managed|unmanaged|orphan`, `title`, `description`, `campaign`, `notes`, `goLive` (UTC string or none), `state` (Decision 17) with `approved`, `failedReason`, `pages[]` each `{path, status (Decision 16), flags[], links{edit, preview, live, review}}`, `counts` per status, `snapshotUrl`, `lock`, `review`, `fetchedAt`, `errors[]` (per-source partial failures, so one failing source degrades the view instead of blanking it).

**Operation result** (orchestrator): ordered `steps[{name, outcome: done|skipped|failed|pending, message?}]`, `ok`, `retryable`.

**Outcome kinds** returned by all clients (closed set): `ok`, `notFound`, `conflict` (412/409), `forbidden` (403), `unauthenticated` (401), `rateLimited` (429, with delay hint), `badRequest` (400 with `X-Error` text), `unavailable` (5xx/network). Views map these to plain messages; `X-Error` text is shown as text only.

**Page status input** (per path): `{edit:{status,lastModified}, preview:{status,lastModified}, live:{status,lastModified}, snapshotCopy?:{lastModified}}`; output closed set (Decision 16).

**Config the extension reads:** none. **Constants:** the three service base URLs, content ref `main`, retry/backoff defaults, concurrency cap, page cap, clock-skew tolerance, polling interval.

## 5. Folder layout (proposed; fits #1/#2)

```
apps/release-planner/
├─ SPEC.md                    this file
├─ README.md                  what it does, apps-sheet row, prerequisites, roles, reads no site config, no worker and why, local dev, trust prompt
├─ release-planner.html       entry page: SDK <script type=module> + extension script
├─ release-planner.js         bootstrap: awaits SDK, wires daFetch/context into modules, standalone state
├─ release-planner.css
├─ src/ (names are the implementer's call): domain (paths, page-status, release-state, dates, calendar), clients (admin, scheduler, da-source), store, loader, orchestrator, views (list, calendar, detail, forms)
└─ test/
   ├─ unit/*.test.js          S2
   ├─ e2e/*.spec.js           S1
   └─ support/                stateful fakes (admin, scheduler, DA), recorded contract fixtures, SDK-stub wiring
(no worker/ folder; no providers/ folder)
```

Shared pieces used, not copied: #1's SDK stub and page helpers in repo-level `test/support/`; #1's `.hlxignore` hides `**/test/` (so fakes and fixtures are not published). The fakes sit inside this extension (no cross-extension imports). If a second extension needs the DA fake (block-bulk-editor has its own), promoting a shared one to repo-level `test/support/` is an owner decision [OPEN, Q10].

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Adobe outside-activity/IP policy** (carried from #1 R1): a personal repo building on Adobe's internal ecosystem and calling Adobe-hosted internal-looking endpoints (the scheduler). | High for publishing, blocks nothing technical | README note; owner decides before sharing [OPEN]. |
| R2 | **Browser reality of the three CORS paths** is inferred from preflights and from EW's own apps, not from an authenticated call from an extension origin (preview-proxy origin especially). If any fails, the no-worker decision needs revisiting. | High for the decision, small effort to settle | **Spike S-1 first** (Build Plan step 0), with real login, from `ref=local`, a branch ref and the preview-proxy origin. |
| R3 | **Undocumented contract pieces:** `manifest.metadata`, `manifest.review`, the schedule GET shape, the scheduler routes, the bulk-status job-details payload. EW's own UI is the only consumer; Adobe can change them. | Medium | One client module per service; recorded fixtures; fakes validated against them; manual re-record procedure (story 48); schedule/review features fail soft with a visible "EW changed" message when a response shape is unexpected (unknown shape never rendered as success). |
| R4 | **Scheduler is Adobe-hosted and gated.** Snapshot scheduling is documented as early access per org; the site may not be registered. | Medium | Banner + planned-date-only mode (Decision 11); [OPEN, Q5]. |
| R5 | **Fakes drift from reality** (the suite passes, EW disagrees). | Medium | Contract fixtures recorded from the spike; shape-equality tests; both-answers runs for each [ASSUMPTION] knob; manual M-steps cover the real services. |
| R6 | **Record/snapshot divergence** (EW UI edits, deletes, others' edits). | Medium | Union model with managed/unmanaged/orphan, EW wins, diffs shown, no hidden state. |
| R7 | **Status semantics:** how `lastModified` is set on publish and for DA sources; tolerance; `edit` data for DA sources. | Medium | Single pure function with a table test; spike S-7 on real pages; flags make staleness explicit. |
| R8 | **Rate limits:** 10 req/s per project shared with all users and EW itself; a big site could throttle authors' normal work. | Medium | Bulk status job, lazy fetch, concurrency 4, backoff on `429`, no background polling; [OPEN, Q9] volume. |
| R9 | **Scheduled-publish outcome unobservable** without the `author` role (audit log) or after log rotation. | Medium | `unconfirmed` state, never over-claim; fallback evidence from live timestamps (Decision 17). |
| R10 | **High-impact writes** (lock, schedule, delete) by a wrong click; app acts with the user's rights. | Medium | Confirmations that state effects; typed-name delete; no wildcard adds; no publish/preview from the app. |
| R11 | **Time zones / DST**; scheduler resolution ~5 min; lead-time rule. | Low-Med | UTC storage, local entry with zone shown, injectable zone in tests, DST-boundary tests. |
| R12 | **Snapshot id collisions and naming** with EW-created snapshots; unknown length limit. | Low | Uniqueness check, slug rule, cap 60 pending spike S-3. |
| R13 | **`daFetch` 401 may navigate the iframe** (`handleSignIn`), losing unsaved form state. | Low-Med | Save drafts of open forms to `sessionStorage` (non-sensitive fields only) [ASSUMPTION worth it; owner may drop]. |
| R14 | **Records in the content tree** (dot-folder) could be previewed/published by someone by mistake or hidden/handled differently by DA. | Low | Spike S-5; README note; folder name documented; JSON contains nothing sensitive. |
| R15 | **Scope size** (effort 5/5, overlap 4/5, rank 17/18). | Project risk | Read-only slice first; each slice is mergeable and valuable alone; owner can stop after slice B. |
| R16 | **Scheduler `POST /schedule` is unauthenticated in source** (Further Notes). | Low for us | Report to Adobe; the planner does not rely on it for authorization. |

## 7. Ordered build plan (sized to #37's acceptance criteria)

0. **Prerequisites (owner):** #1 merged (tooling, hello apps, CI); Code Sync installed and DA org/site confirmed (#1 R3/R10); site registered for scheduling; sandbox site with test pages and two users (publisher, read-only); Q1, Q4, Q5 answered.
1. **Spike S-0 (no product code kept; manual, real EW).** From the hello app's iframe (or devtools console in the planner stub) run through `actions.daFetch`: A1, A2, A7 (+job details), A8, A9, S1, S2, a throwaway snapshot create/delete (A3/A6), D1/D2 on a scratch record. Settle: S-1 CORS/auth from `ref=local`/branch/preview-proxy origins; S-2 job-details shape; S-3 id length; S-4 `metadata` merge vs replace; S-5 DA arbitrary-JSON + dot-folder; S-6 approve-requires-locked; S-7 status timestamp semantics; S-8 audit log visibility of `scheduled-publish` entries and the `author`-role requirement. Record sanitised fixtures. **Gate:** if S-1 fails, stop and decide (Decision 4 contingency). This step produces the contract fixtures every later step uses.
2. **Domain core, test-first** (AC2 rules, AC1 validation, AC3 state): path normalisation, page status, release state, dates and calendar math, as tables. No I/O.
3. **Fakes + clients, test-first:** stateful Admin/scheduler/DA fakes and fixtures; Admin, Scheduler, DA clients; host allowlist; `main` ref rule (AC3, AC7, AC8-negative).
4. **Loader + read-only views** (AC2, AC3 read side, AC6 Apps menu, AC7): list, calendar, detail with per-page status, state banners, deep links, standalone state; works for releases created in EW. **First shippable slice.** README, extensions-table row, apps-sheet row (AC5, AC6).
5. **Release store + create/edit/adopt** (AC1): record CRUD with conflict handling; create orchestration (snapshot, record, add pages); unmanaged adoption; orphan repair; stale-copy refresh.
6. **Scheduling operations** (AC3 write side): schedule, reschedule, unschedule, edit-while-scheduled flow, scheduler-not-registered mode, outcome (`published|failed|unconfirmed`) via audit log.
7. **Delete and polish:** delete with typed confirmation, collision warnings, accessibility pass, progressive-load indicators, error mapping.
8. **e2e hermetic suite** (S1) over steps 4-7; CI green (AC9).
9. **Manual verification in real EW** (M0-M10 in Testing Requirements), including the go-live wait; record results and caveats in the PR and README.
10. **Hand-off notes** in the README: contract assumptions settled/open, fixture re-record procedure, the no-worker rule and when to add one.

---

# Testing Requirements

## 1. Domain unit tests (seam S2, `@web/test-runner`, no I/O)

Data tables; `now` and time zone injected.

### 1.1 Path normalisation and validation (AC1)

| ID | Behaviour asserted |
|---|---|
| PN1 | `https://main--s--o.aem.page/a/b.html?x=1#h`, `.aem.live`, `.aem.reviews` (with `snap--main--s--o` host) and `https://da.live/edit#/o/s/a/b` all normalise to `/a/b`; `/` and `/index` handling is stable and documented |
| PN2 | `.json` and `.svg` kept; `.png`, `.pdf`, `.mp4` rejected with a reason; extension-less kept |
| PN3 | Duplicates (including URL vs path forms) collapse, order of first occurrence kept |
| PN4 | Any path containing `*` is rejected (no wildcard adds) |
| PN5 | URL for another site/org, `javascript:` and other schemes, empty lines, whitespace-only lines are rejected without throwing |
| PN6 | More than 500 unique pages -> validation error naming the cap |

### 1.2 Page status (AC2)

| ID | Behaviour asserted |
|---|---|
| PS1 | source 200, preview 404, live 404 -> `draft` |
| PS2 | preview 200, live 404 -> `previewed` |
| PS3 | live 200, preview/source not later than live -> `published` |
| PS4 | live 200, preview later than live -> `changed since publish` |
| PS5 | live 200, source later than live (not re-previewed) -> `changed since publish` |
| PS6 | all 404 -> `missing`, never `draft` |
| PS7 | equal timestamps and differences inside the tolerance -> not changed; just outside -> changed (boundary row) |
| PS8 | release flags: `snapshot stale` when preview later than snapshot copy; `not in snapshot` with reason `draft`/`missing`; `unplanned`; each independent of the status |
| PS9 | collision flags: page in two releases; page also in the individual-schedule map with its time; none when absent |
| PS10 | malformed/absent timestamps or unexpected status values degrade to an explicit unknown flag, never to `published` |

### 1.3 Release state (AC3)

| ID | Behaviour asserted |
|---|---|
| RS1 | unlocked, no date -> `planning` |
| RS2 | date in future, no schedule entry -> `date set, not scheduled in EW` |
| RS3 | locked + review requested, no entry -> `in review`; review rejected -> `rejected` |
| RS4 | entry present, time future -> `scheduled` with `approved` flag passed through |
| RS5 | entry present, time passed -> `due` |
| RS6 | no entry, time passed, log says published -> `published` |
| RS7 | no entry, time passed, log says failed -> `failed` with reason and attempts |
| RS8 | no entry, time passed, log unreadable, all pages live no earlier than go-live -> `published`; otherwise `unconfirmed` |
| RS9 | scheduler not registered -> RS2 still yields the date state plus a `scheduler unavailable` flag; never `scheduled` |
| RS10 | entry present for a snapshot with no manifest date (EW inconsistency) -> shown as `scheduled` with an inconsistency flag, entry time wins for display |
| RS11 | orphan record (no snapshot) and unmanaged snapshot (no record) get their own row kinds; EW values win when record and snapshot disagree on pages |

### 1.4 Dates and calendar (AC1, AC2)

| ID | Behaviour asserted |
|---|---|
| DT1 | local input value + zone -> ISO UTC string; round-trips through display |
| DT2 | exactly five minutes ahead accepted; one second less rejected; past rejected, with the same messages EW uses |
| DT3 | DST spring-forward and fall-back local times resolve to the intended UTC instant or are rejected as ambiguous/nonexistent with a message |
| DT4 | calendar month grid for a fixed zone: correct leading/trailing days, week start, 28/29/30/31-day months, leap February |
| DT5 | a release at 23:30 UTC lands on the correct local day in UTC-8 and UTC+10 (zone injected) |
| DT6 | releases without a date never appear in the grid and appear in the unscheduled list |

## 2. Client, store, loader and orchestrator tests (seam S2 with stateful fakes)

Every test runs against the fakes; the three [ASSUMPTION] knobs (`metadata` merge/replace, approve-needs-locked, log readable) are parameterised so each test passes under both settings where relevant.

### 2.1 Clients (AC3, AC7, AC8)

| ID | Behaviour asserted |
|---|---|
| CL1 | every Admin/status/snapshot request uses content ref `main` even when `context.ref` is `local` or a branch name (the AC7 regression test) |
| CL2 | requests go only to the three allowed origins; any URL built from an unexpected host throws before `daFetch` is called; the host list ignores anything in `location.search` |
| CL3 | the client never sets an `Authorization` header and never reads a `token` property; a `daFetch` spy sees only URL and non-auth options |
| CL4 | outcome mapping: 200/201/204 -> `ok`; 401 -> `unauthenticated`; 403 -> `forbidden`; 404 -> `notFound`; 409/412 -> `conflict`; 429 -> `rateLimited` with the delay hint from `Retry-After` when present; 400 -> `badRequest` with `X-Error` text; 5xx or thrown error -> `unavailable`; none throws |
| CL5 | bulk page add: under 200 paths sync; over 200 handles `202` + job polling to `stopped`; job `progress.failed` surfaces failed paths |
| CL6 | bulk status: a job is created for the union of paths once, polled at the injected interval, and its details parsed into the page-status input shape; unexpected shape -> `unavailable` with "EW changed" detail |
| CL7 | scheduler: registration `200/404` parsed; schedule POST body contains exactly `org, site, snapshotId, approved, userId`; `400` + `X-Error` surfaced (5-minute rule, not registered); delete uses the snapshot route |
| CL8 | get-schedule parsing accepts the object entry shape and a legacy string value (README form) and rejects anything else explicitly |
| CL9 | manifest write round-trips existing `metadata` keys (including `reviewPassword`, `launchEnabled`) untouched, adds/removes only `scheduledPublish`; under replace semantics nothing is lost, under merge semantics nothing is duplicated |
| CL10 | `lock` uses the manifest write, `unlock` uses `locked:false`, review `request` for scheduling; each 403 maps to `forbidden` with which permission is the likely cause |

### 2.2 Release store (AC1)

| ID | Behaviour asserted |
|---|---|
| ST1 | create writes `If-None-Match: *`; an existing id -> `conflict`, nothing overwritten |
| ST2 | update sends `If-Match` with the ETag from the last read; a second writer with a stale ETag gets `conflict` and the first write survives |
| ST3 | list follows the continuation header across pages; folder missing (`404`) -> empty list, not an error |
| ST4 | read of a record with an unknown `schema` -> "newer planner" marker, never modified; unknown extra fields preserved on update |
| ST5 | records contain no title/go-live/state/token/password fields (asserted on the serialized body of every write) |
| ST6 | `x-da-actions` without `write` -> the store reports read-only; a `403` on write maps to `forbidden` |

### 2.3 Loader (AC2, AC3)

| ID | Behaviour asserted |
|---|---|
| LD1 | union: snapshots, records and schedule yield managed, unmanaged and orphan rows as in RS11 |
| LD2 | progressive: rows render as manifests arrive; a failing manifest yields that row with an error, the others unaffected; a failing source degrades the view with a notice instead of blanking |
| LD3 | concurrency never exceeds the cap; `429` triggers backoff and a visible waiting state, then success; repeated `429` -> `rateLimited` on that row only |
| LD4 | status fetched lazily: only for the visible month (calendar) or opened release (list); one bulk job for the union of those pages |
| LD5 | scheduler `404` registration -> banner state, no schedule calls attempted; `403` on audit log -> state falls back per RS8 without an error banner |
| LD6 | refresh re-queries and replaces stale data; tab refocus triggers one refresh |

### 2.4 Orchestrator (AC1, AC3)

| ID | Behaviour asserted |
|---|---|
| OR1 | create: validates, slugs the id, checks uniqueness, creates the snapshot, writes the record, adds previewed pages; the order and bodies of requests are asserted; draft/missing pages stay in the plan, are listed as not in snapshot with reasons, and do not fail the create |
| OR2 | create with a go-live date and `scheduler` unavailable -> release created, date stored, state `date set, not scheduled in EW` |
| OR3 | create failure after the snapshot exists (record write fails) -> result lists done/failed/pending; the snapshot remains; `retry remaining` completes it; no duplicate snapshot |
| OR4 | schedule: refreshes stale copies with `forceUpdate`, writes `scheduledPublish`, locks, registers; each step skipped when already satisfied (idempotent re-run); a `400` from the scheduler (5-minute rule) leaves date written and snapshot locked and reports exactly that, offering retry or unschedule |
| OR5 | reschedule changes date and re-registers; the scheduler entry's time equals the manifest's; no duplicate entries |
| OR6 | unschedule deletes the entry, clears `scheduledPublish`, unlocks; running it twice is a no-op the second time |
| OR7 | edit pages of a locked/scheduled release requires the confirmed unlock flow; without the confirmation nothing is written; after edit the release is rescheduled only if the user chose to |
| OR8 | refresh-stale updates only the selected stale pages with `forceUpdate` and leaves others untouched |
| OR9 | adopt (unmanaged -> managed) writes a record with the snapshot's current pages as the plan and modifies nothing in the snapshot |
| OR10 | orphan repair recreates the snapshot from the plan; orphan removal deletes only the record |
| OR11 | delete requires the typed name, then deletes schedule entry (if any), snapshot resources, `.snapshots` content only if EW's own sequence does, the snapshot, and the record, in that order; a failure mid-way reports remaining steps |
| OR12 | no operation ever calls preview or publish endpoints, wildcard paths, or another snapshot's routes (asserted over the full request log of every test) |

## 3. View tests (seam S2, rendered in the real browser)

| ID | Behaviour asserted |
|---|---|
| VW1 | list rows show name, campaign, go-live (local with zone), state, page count and per-status counts; sorting and filters by state and campaign |
| VW2 | calendar shows releases on the correct day (zone injected), a "+n more" overflow, prev/next/today; unscheduled list beside it |
| VW3 | detail panel shows per-page status labels exactly `draft`, `previewed`, `published`, `changed since publish` and the flags with reasons; links (editor, preview, review, snapshot app) are well-formed |
| VW4 | create form: validation messages for name, date, pages (PN rules), 5-minute rule, local time + UTC shown; submit disabled while running; result steps listed |
| VW5 | scheduler banner shows when unregistered with a link to the EW scheduler app; planned-date mode wording |
| VW6 | read-only user: write actions disabled with a reason; EW `403` mapped to a plain message |
| VW7 | service-provided text (`X-Error`, titles, notes, page paths) containing `<img onerror>`/`<script>` renders as literal text and creates no elements |
| VW8 | keyboard: calendar grid navigable with arrow keys, Enter opens a release, focus returns on close; list sortable by keyboard; roles/labels present |
| VW9 | standalone (SDK never resolves): waiting state then "not running inside Experience Workspace" after the injectable timeout; no network calls |
| VW10 | no token string in DOM, console or serialized state; the "session expired" state on `unauthenticated` |
| VW11 | confirmations state their effect for schedule, reschedule, unschedule, refresh, delete; cancel writes nothing |

## 4. Repo checks (seam S3, extended)

| ID | Behaviour asserted |
|---|---|
| RC1 | `apps/release-planner/` has the entry page named after the folder, README, tests; the README extensions-table row exists with `type` `app` and the folder/entry resolve (AC5, AC6) |
| RC2 | the README documents the `apps` row, prerequisites, "reads no site config", and the no-worker statement; the registration row in the README matches the table type |
| RC3 | no `worker/` folder, no wrangler config, no `.dev.vars*`/`.env*`, and no credential-looking constants (key/secret/token assignments) in the extension's source (the AC8 "no credential anywhere" check, run as a fixture-tested rule); if a `worker/` is ever added the #2 rules UR1-UR5 apply instead |

## 5. End-to-end tests inside the extension (seam S1, Playwright, Chromium, hermetic)

Stub SDK from #1 whose `actions.daFetch` forwards to real `fetch`; `page.route` backs the three origins with the stateful fakes; any other external request is aborted and fails the test.

| ID | Behaviour asserted |
|---|---|
| E2E1 | open with fake data of 5 releases in all states: list and calendar render; per-page statuses visible; counts match |
| E2E2 | `ref=local` and a branch ref in the stubbed context: every captured request path uses `main`; the page renders identically (AC7, automated half) |
| E2E3 | create a release (name, local go-live, pasted URLs including a draft page and a bad URL): fake receives snapshot create, record write, page add; UI shows the release, the draft page as not in snapshot; no preview/publish request occurs |
| E2E4 | schedule it: fake shows manifest date, lock, scheduler entry; UI state `scheduled`; fake `tick` past the time publishes; UI after refresh shows `published` with the log evidence; a variant with log unreadable shows `published` only when live timestamps prove it, else `unconfirmed` |
| E2E5 | scheduler `404` registration: banner; create works; state `date set, not scheduled in EW`; no schedule POST made |
| E2E6 | conflict: fake DA returns `412` on record update -> UI shows the conflict and offers reload; nothing overwritten |
| E2E7 | read-only user (fake returns `403` on writes, no `write` in `x-da-actions`): actions disabled, message plain |
| E2E8 | edit a page in the fake after publish -> `changed since publish`; edit after snapshot capture -> `snapshot stale`; refresh action clears the flag |
| E2E9 | hostile content (`<script>` in titles/notes/X-Error) renders inert; the set of hosts contacted equals the allowlist; token and credential strings absent from DOM and network log (AC8, automated half) |
| E2E10 | `429` burst from the fake: UI waits, retries, completes; no request storm (rate observed against the cap) |

## 6. Manual verification in real EW (needs interactive Adobe login; cannot be automated)

Accounts and credentials needed: GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, per #1); a DA org/site with config access (`https://da.live/config#/{org}/{site}/`); **two Adobe IMS users on a sandbox site**: a *publisher* (EDS author + publish roles, DA write, config admin for scheduler registration) and a *read-only* user (DA read, no publish); the site registered for scheduling (`https://da.live/apps/scheduler`) or, for M7, a second site that is not; at least 8 test pages in various states; Chrome. No vendor sandbox, no API keys, no Cloudflare account (no worker). Never paste a real IMS token into chat, issues or logs.

- **M0 (prereq, as #1 M0):** `curl -I https://main--ew-extensions--jazhou-adobe.aem.live/apps/release-planner/release-planner.html` returns 200 after the first merge; scheduler registration `GET .../register/{org}/{site}` returns 200 on the sandbox site (check in EW scheduler app).
- **M1 (spike S-0, before build):** run the S-1..S-8 checks listed in Build Plan step 0 from the iframe; record outcomes and sanitised fixtures in the PR. Proves the browser-capability audit (supports AC4, AC8).
- **M2 (app, `ref=local`):** `npm start`; open `https://da.live/app/{org}/{site}/apps/release-planner/release-planner?ref=local`; accept the trust prompt; list and calendar show the sandbox site's existing snapshots/schedules; per-page statuses present (AC2, AC7).
- **M3 (branch ref):** push branch `release-planner`; open the same URL with `?ref=release-planner`; identical data (AC7).
- **M4 (Apps menu):** add the `apps` row; confirm the card at `https://da.live/apps#/{org}/{site}` and that it opens the planner (AC6).
- **M5 (create + mapping):** create release `m5-test` with 4 pages (one draft). In `https://da.live/apps/snapshots` verify the snapshot `m5-test` exists with title, description, the previewed pages; in `https://da.live/browse` verify the planner record exists; the draft page shows "not in snapshot yet" (AC1, AC3).
- **M6 (schedule and go-live):** as publisher, schedule `m5-test` about 12 minutes ahead; verify in the EW scheduler app (`https://da.live/apps/scheduler`) the entry with that time; planner shows `scheduled`; wait past the time; verify pages live with `curl https://main--{site}--{org}.aem.live{path}`; planner shows `published`; check the audit log entry (log viewer https://tools.aem.live/log-viewer) matches (AC3).
- **M7 (not registered):** on a site without scheduler registration: banner, planned date only, state `date set, not scheduled in EW` (AC3, story 24-25).
- **M8 (status transitions):** edit and re-preview a published page -> `changed since publish`; edit after snapshot capture -> `snapshot stale`; refresh clears it; verify against the page's status in EW (AC2).
- **M9 (coexistence):** add a page to the snapshot in EW Snapshots -> `unplanned` flag; create a snapshot in EW -> `unmanaged` row, adopt it; delete a managed snapshot in EW -> `orphan` row, repair and remove both work (AC1, AC3).
- **M10 (permissions and concurrency):** as the read-only user, planner is read-only and EW's `403` is mapped; two browsers edit the same release record -> second save reports conflict (AC1, AC8 spirit).
- **M11 (security checks, AC8):** DevTools Network on every flow: only the three allowed origins plus page assets; no request carries a token in URL or body; the app source contains no credential (reviewed via RC3 and `grep`); confirm there is no worker URL anywhere in the code.
- **M12 (standalone):** open `http://localhost:3000/apps/release-planner/release-planner.html` directly: "not inside Experience Workspace" state.

## 7. CI (no credentials)

No new jobs. #1's `lint` (ESLint, Stylelint, S3 convention check including RC1-RC3), `unit` (domain, client, store, loader, orchestrator, view tests) and `e2e` (E2E1-E2E10) run on every push and PR; Node 22; Chromium only. No secrets; the fakes and recorded fixtures are in the repo (hidden from the code bus by `.hlxignore`).

## 8. Acceptance-criteria traceability (ticket #37)

| # | Acceptance criterion (#37) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Admin creates a release with name, go-live date and a set of pages; releases are stored per site | PN1-PN6, DT1-DT3, ST1-ST6, OR1-OR3, OR9-OR11, VW4, E2E3, E2E6 | **M5** (snapshot + record visible in EW and DA), **M9**, **M10** (conflict) |
| AC2 | Calendar and list views show releases and per-page status (draft, previewed, published, changed since publish) | PS1-PS10, DT4-DT6, RS11, LD1-LD4, VW1-VW3, VW8, E2E1, E2E8 | **M2**, **M8** (statuses checked against EW's own status) |
| AC3 | A release maps to an EW snapshot/schedule so go-live uses EW's own scheduling; the app shows its state | RS1-RS10, CL5-CL10, OR1, OR4-OR6, OR12, VW5, E2E3-E2E5 | **M5** (EW Snapshots shows the same snapshot), **M6** (entry in EW scheduler, publish happens, state flips), **M7**, **M9** |
| AC4 | Worker handles any calls the browser cannot make (Partial backend) | CL2, CL3, OR12, E2E9 (every call is browser-capable and host-restricted: the set of calls the browser cannot make is empty by construction), RC3 | **M1** (spike proves each call works from an extension origin), **M11**; review: capability audit table (Build Analysis section 3); owner confirms Decision 4 (**Q1**). If the owner overrules and wants a worker, #2's W1/W2/UA/UC/UP/US tests and manual W0-W6 apply unchanged |
| AC5 | All code in its own self-contained `release-planner` folder, with a README covering setup, the EW config-sheet row, and any site config it reads | RC1, RC2 (folder complete, README sections present, no cross-extension imports via the S3 import rule) | README review against the list in Build Analysis section 2; walk the README on a scratch site (**M4**) |
| AC6 | Listed in the repo README extensions table and reachable from the EW Apps menu | RC1 (table row and entry page resolve) | **M4** (card in `https://da.live/apps#/{org}/{site}`, opens the app) |
| AC7 | Works in EW with `ref=local` and with a branch ref | CL1, E2E2 (every service call uses `main` regardless of `context.ref`) | **M2** (`ref=local`), **M3** (branch ref) |
| AC8 | Vendor credentials live only in this extension's worker; browser never receives them; unauthenticated calls to the worker are rejected | CL3, VW10, E2E9, RC3 (no credential, no token handling, no worker exists, so nothing is shipped to the browser and there is no worker to call unauthenticated), ST5 (records carry no secrets) | **M11** (network and source review); the **vacuous-by-design reading** is flagged for owner sign-off (**Q1**); if a worker is added, #2's UA1-UA15, UC1-UC9, HW-style route tests and W0-W6 apply |
| AC9 | Core logic covered by unit tests; lint and CI green | PN, PS, RS, DT, CL, ST, LD, OR, VW suites; `npm run lint`, `npm test`, `npm run test:e2e` and the three #1 CI jobs | CI green on a PR; a deliberately broken status rule on a scratch branch turns PS* red |

Every #37 acceptance criterion maps to at least one automated test or a numbered manual step above.

## 9. Open questions for the owner

1. **Worker or no worker (AC4, AC8, the biggest one).** The evidence says every call is browser-capable with no secret (Build Analysis 3), so v1 has no worker, and AC8's worker-specific wording is met by "no credential exists and none reaches the browser". Do you accept that, and relax the #37 -> #2 dependency edge? Or do you want a worker in v1 anyway (the only concrete candidate is Slack/email go-live reminders, which needs a cron the #2 template excludes and a service identity)?
2. **Campaign model.** Is a *campaign* just a label shared by releases (this spec), or a first-class entity that owns several releases (dates, owners, goals)? The ticket title says "Release & Campaign Planner" but its ACs only speak about releases.
3. **One release = one snapshot** (the id is the snapshot name; planner records live in DA). Acceptable, including the DA dot-folder record store, over stashing planner data in snapshot metadata (rejected for EW-UI overwrite risk, Decision 6)?
4. **Who is an "admin" (AC1)?** This spec means "holds snapshot-write, and for scheduling publish rights, plus DA write on the site" and lets EW enforce it. Do you want a stricter planner-level gate (for example a config-sheet allowlist)? That would be a config the app reads (README change).
5. **Is snapshot scheduling enabled** for the org/site you will test on? The EW docs call it an early-access feature enabled by Adobe per organisation; the developer doc says it is built in for EW. Who confirms with Adobe?
6. **Approval semantics at go-live.** EW's own flow, reproduced here, schedules with `approved: true` (the scheduler approves and publishes at the time). Is that what you want, or should scheduling be "publish without an approval step" (`approved: false`, `?publish=true`), or require an explicit review step first?
7. **Page entry in v1:** pasted URLs/paths only (this spec), or must a folder/page picker ship in v1? It adds a sizeable UI slice.
8. **Delete:** is deleting a release's snapshot from the planner wanted in v1, or should delete only remove the planner record and leave the snapshot to the EW app?
9. **Expected volume** (releases per site, pages per release) and tolerance for the shared 10 requests/second Admin API budget; this sets the loader's concurrency and lazy-loading defaults.
10. **Shared DA fake:** keep this extension's DA test fake private, or promote one fake to repo-level `test/support/` that block-bulk-editor and this extension share (allowed by the #1 layout, but a cross-extension dependency on test code)?
11. **Persist form drafts in `sessionStorage`** to survive a `daFetch` 401 re-login (R13), or accept losing unsaved input?
12. **Report the scheduler observation to Adobe?** `POST /schedule` does not authenticate the caller in the current source (Further Notes); and the production scheduler URL is documented only for registration, while the planner relies on the same routes EW's apps use. Who on the EW team confirms these routes are stable for third-party apps?
13. **Policy carry-overs (#1 R1/R2):** Adobe outside-activity/IP clearance before publishing, and the missing third-party marketplace process; unchanged by this ticket, README flags only.
14. **Real-token and origin facts** this spec could not observe without a login (R2, spike S-1): if you already know that extension origins (especially the `.preview.da.live` proxy origin) call `admin.hlx.page`, the scheduler and `admin.da.live` successfully, tell me and step 1 shrinks to the contract spikes.
