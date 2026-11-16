# Spec: Skills & MCP Pack Catalog (fullscreen app + registry worker)

Ticket: jazhou-adobe/ew-extensions#11 (this spec: #49). Blocked by #1 (repo scaffold; spec in `apps/hello-world/SPEC.md`) and #2 (shared worker template; spec in `shared/worker-template/SPEC.md`).
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend (same as the #1 and #2 specs): **[VERIFIED]** = read in a primary source (URL given) or observed with a command on 2026-11-16; **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an answer from Adobe.

Vocabulary follows #1 and #2: *extension* = one folder `apps/<name>/`; *worker* = the per-extension backend in `apps/<name>/worker/`, built from `shared/worker-template/`; *IMS token* = the Adobe IMS access token the DA App SDK hands the page. Terms specific to this spec:

- **Pack**: a named, versioned, declarative bundle of **items**: skills, MCP server registrations and prompts.
- **Item**: one skill, one MCP server registration or one prompt inside a pack.
- **Registry**: the set of packs the worker serves. Authored as files in the repo, bundled into the worker at deploy.
- **Site config**: the EW (DA) config document of one site, edited at `https://da.live/config#/{org}/{site}/`. The Skills Editor's storage lives in it (sheets `skills`, `mcp-servers`, `prompts`) plus `.da/skills/*.md` files.
- **Ledger**: the new site-config sheet `pack-installs` that records which items a pack installed, so uninstall removes exactly those.
- **Plan**: the dry-run list of operations (add, replace, remove, conflict, no-op) computed from a pack, the site's current state and the ledger. Nothing is written before the admin confirms a plan.
- **Drift**: an installed item whose current content no longer matches the hash recorded in the ledger (an admin edited it in the Skills Editor).
- **Target site**: the `org/site` a pack is installed into.
- **Harness**: the assistant backend a site uses (flag `ew.coworker`: unset = legacy da-agent, `true` = Coworker on Agent Orchestrator, `cma` = CMA bridge).

Primary sources read (all 2026-11-16):
- EW docs: https://www.aem.live/docs/ew/developing/apps-plugins, https://www.aem.live/docs/ew/administering/configs, https://www.aem.live/docs/ew/administering/request-publish, https://www.aem.live/docs/ew/administering/request-publish-skill, https://www.aem.live/docs/ew/administering/agentic-plugins.
- Upstream Skills Editor source (`adobe-rnd/ew-extensions`, branch `main`): https://github.com/adobe-rnd/ew-extensions/blob/main/blocks/skills/skills-editor-api.js, `.../utils/skill-frontmatter.js`, `.../utils/sheet-utils.js`, `.../utils/da-fetch.js`, `.../nx-skills-editor.js`, `.../constants.js`.
- DA backend: https://github.com/adobe/da-admin/blob/main/src/routes/config.js, https://github.com/adobe/da-admin/blob/main/src/storage/kv/put.js; API docs https://docs.da.live/developers/api/config and https://docs.da.live/developers/api/source.
- SDK and shell: https://da.live/nx/utils/sdk.js, https://da.live/nx/utils/daFetch.js, https://github.com/adobe/da-nx/blob/main/nx/blocks/shell/shell.js.
- Prior art for packs: https://github.com/adobe/skills (`.claude-plugin/marketplace.json`), upstream PRs #66, #77, #79, #80 (the Marketplace tab).

---

## Problem Statement

A site administrator who wants the Experience Workspace assistant to do something new (for example "request publish approval for this page") has to assemble the capability by hand from public documentation. The Request Publish docs show it: open the Skills Editor, register an MCP server by typing a key and URL, create a skill with a precise id and paste a 9 KB `SKILL.md` into it, make sure the status is not left as draft, and then find the right prompts to try ([docs](https://www.aem.live/docs/ew/administering/request-publish), "Agentic mode"). Every step is a chance for a typo, a wrong id, a skill left in draft, or a stale copy of the skill text. There is no way to see what a capability will add before adding it, no record of what came from where, no clean way to remove exactly what was added, and no way to pick up a newer version of a skill the owner of the capability has improved.

The agentic direction is moving fast and Adobe's own capabilities (the AEM agentic plugins connector exposes request publish, schedule publish and permissions, [docs](https://www.aem.live/docs/ew/administering/agentic-plugins)) are each documented as manual copy-paste recipes. Upstream's Skills Editor has only recently grown a "Marketplace" tab (merged 2026-10-28/29, upstream PRs #77, #79, #80), but it installs Claude-style *plugins* into the caller's personal CMA-bridge settings, not skills, MCP servers and prompts into the site's shared config (see Further Notes 1). Administrators on the default harness have nothing.

## Solution

A fullscreen **Skills & MCP Pack Catalog** app. An administrator opens it from the EW Apps menu and sees a catalog of curated packs. Each card shows a description, the version, who publishes it, what is inside (counts of skills, MCP servers and prompts), what permissions installing and using it needs, and whether it is installed on this site. A detail view previews the exact content: the full skill markdown, the MCP server URLs and host, the prompt texts.

**Install** is one click plus one confirmation. The confirmation shows the plan: what will be added, what will be replaced, what conflicts with something the admin already has. On confirm the app writes the pack's skills, MCP registrations and prompts into the site config **in the Skills Editor's own format**, and records the ledger, so the Skills, MCPs and Prompts tabs of the Skills Editor show them straight away. **Uninstall** removes exactly the items the ledger says the pack installed, and nothing else; items the admin edited are flagged first. **Update**: when the registry has a newer version, the same button updates in place (same rows, same positions), without duplicating or disturbing the admin's own items.

Packs are declarative files (JSON manifest plus the skill markdown), authored in this repo, validated by a lint that is the same code the browser uses to distrust what it fetches, and served by the extension's own worker, which sits behind the shared worker template's IMS-token check and CORS rules. Two real packs ship, both sourced from public Adobe documentation: the **AEM agentic plugins connector** (the MCP registration) and **Request Publish** (the `request-publish` skill, example prompts, depending on the connector).

## User Stories

Site administrator (config-write access):

1. As a site administrator, I want a catalog of curated packs in the Apps menu, so that I can find a capability without hunting through documentation.
2. As a site administrator, I want each pack card to show description, version, publisher and contents counts, so that I can judge it at a glance.
3. As a site administrator, I want each pack to list the permissions it needs and the capabilities it gives the assistant, so that I know what I am granting before I install.
4. As a site administrator, I want to preview the full text of every skill, the URL and host of every MCP server and every prompt in a pack, so that I can review exactly what will run in my assistant.
5. As a site administrator, I want to install a pack in one click after a confirmation, so that I do not hand-author each item in the Skills Editor.
6. As a site administrator, I want the confirmation to list exactly what will be added, replaced and removed, so that nothing surprising happens to my site.
7. As a site administrator, I want the installed skills, MCP servers and prompts to show up in the Skills Editor's Skills, MCPs and Prompts tabs, so that I can keep using the tool I know to adjust them.
8. As a site administrator, I want installed skills to be approved (not draft) and MCP servers to be registered with the right key and URL, so that the assistant can use them immediately.
9. As a site administrator, I want the app to refuse to overwrite an item I created myself that has the same id, key or title, so that my own skills are never silently replaced.
10. As a site administrator, I want to override that refusal explicitly per item, with a warning that the overwritten item cannot be restored by uninstall, so that I stay in control.
11. As a site administrator, I want to uninstall a pack and have exactly the items it installed removed, so that my site returns to the state before the install.
12. As a site administrator, I want to be told which installed items I edited after install before uninstall or update touches them, so that my edits are not lost silently.
13. As a site administrator, I want to choose, per edited item, to keep my version or take the pack's version, so that I can merge intent.
14. As a site administrator, I want to see "update available" when the registry has a newer version, so that I can pick up improved skills.
15. As a site administrator, I want an update to change the installed rows in place, add new items and remove items the new version dropped, so that I never end up with duplicates or leftovers.
16. As a site administrator, I want my toggles (an MCP server I disabled, a skill I set to draft) to survive an update, so that updating does not undo my decisions.
17. As a site administrator, I want installing an already-installed, unchanged pack to do nothing, so that clicking twice is harmless.
18. As a site administrator, I want a pack that depends on another (Request Publish needs the connector) to offer to install the prerequisite in the same operation, so that I do not install them in the wrong order.
19. As a site administrator, I want the app to stop me from uninstalling a pack that another installed pack depends on, so that I do not break it.
20. As a site administrator, I want the pack's real-world prerequisites shown (for example "your org and site must be onboarded by your AEM contact"), so that I do not install something that cannot work yet.
21. As a site administrator, I want to see which site the install will go into, prominently, in the confirmation, so that a crafted link cannot trick me into changing the wrong site.
22. As a site administrator, I want a clear message when my account lacks config-write access, so that I know to ask an org admin instead of seeing a cryptic failure.
23. As a site administrator on a site that uses the CMA harness, I want a warning that pack items written to the site config may not appear in that harness, so that I do not think the install failed.
24. As a site administrator, I want a failed install to leave my site exactly as it was, so that a half-installed pack never confuses the assistant.
25. As a site administrator, I want a damaged install (ledger rows with missing items) detected and offered as "Repair", so that I can recover from partial manual deletion.
26. As a site administrator, I want clear, short error messages (no stack traces, no tokens), so that I know whether to retry or contact the maintainer.
27. As a site administrator, I want the catalog to say when it cannot reach the registry and let me retry, so that a slow or down worker does not hang the page.

Content author / assistant user:

28. As a content author, I want the assistant to pick up the installed skill and tools without any setup on my side, so that I can simply ask "request publish approval for this page".
29. As a content author, I want the pack's example prompts to appear in my prompt list, so that I can discover what to ask.

Pack author (the maintainer or another contributor):

30. As a pack author, I want a pack to be a folder of plain files (manifest, skill markdown), so that I can add or change one in a normal pull request.
31. As a pack author, I want a lint that validates my pack the way the browser and the Skills Editor would, so that I find format problems before release.
32. As a pack author, I want the lint to reject secrets, headers and non-https MCP URLs, so that a pack can never carry a credential.
33. As a pack author, I want the lint to derive the permissions list from the contents and fail when I forget to declare one, so that the permission list shown to admins is trustworthy.
34. As a pack author, I want the lint to reject a second pack that claims the same skill id, MCP key or prompt title, so that item ownership is unambiguous.
35. As a pack author, I want a documented release checklist (bump the pack version and the skill `version` when content changes), so that installed sites see an update.

Maintainer / operator:

36. As the maintainer, I want the registry served by the extension's own worker behind the template's IMS-token check, so that unauthenticated callers cannot use it.
37. As the maintainer, I want no vendor credential anywhere in the browser or the registry, so that the public code bus can never leak one.
38. As the maintainer, I want the app's pure logic (manifest validation, planning, ledger) covered by unit tests that run without network, IMS or EW, so that CI proves behaviour on every push and PR.
39. As the maintainer, I want the written config checked against a pinned copy of the Skills Editor's own parsing code, so that format drift in a fast-moving upstream is caught.
40. As the maintainer, I want a README that explains setup, the `apps` sheet row that enables the catalog, and every sheet the app reads and writes, so that enabling it is copy-paste.
41. As the maintainer, I want the catalog listed in the root README extensions table and reachable from the Apps menu, so that it is discoverable.
42. As the maintainer, I want the app to work with `ref=local` and with a branch ref, so that reviewers can try a branch before merge.
43. As a security reviewer, I want packs to be inert data (no script execution, all strings rendered as text), so that a compromised registry cannot run code in the admin's session.

## Implementation Decisions

Paths and layout are in the Build Analysis; this section stays at the decision level.

### Product and scope

1. **App, not library plugin.** Type comes from the EW config-sheet row: a row in the `apps` sheet ([docs](https://www.aem.live/docs/ew/developing/apps-plugins)). Lives in `apps/skills-mcp-catalog/` (owner convention, #1).
2. **A pack contains skills, MCP server registrations and prompts, nothing else.** Agent presets (`.da/agents/*.json`), memory, tool overrides and marketplace sources (all other Skills Editor storage) are out of scope in v1 even though the Skills Editor stores them. [VERIFIED storage list: skills-editor-api.js.]
3. **Reuse the Skills Editor's storage format, do not invent a second one** (ticket requirement). The exact formats this app writes (all [VERIFIED] in https://github.com/adobe-rnd/ew-extensions/blob/main/blocks/skills/skills-editor-api.js):
   - **Skills:** two writes, exactly as the editor's save does ([nx-skills-editor.js](https://github.com/adobe-rnd/ew-extensions/blob/main/blocks/skills/nx-skills-editor.js), "Write the .md file first"): a file `/{org}/{site}/.da/skills/{id}.md` via the DA source API (`PUT`, multipart field `data`), then a row in config sheet `skills` with columns `key` (the id), `content` (the whole markdown including frontmatter) and `status` (`approved` or `draft`). Skill ids must match `^[a-zA-Z0-9_-]+$`; frontmatter must satisfy the editor's contract: `name` equal to the id (lowercase letters, digits, hyphens, max 64, no reserved words `anthropic`/`claude`), single-line `description` (max 1024, no XML tags), positive-integer `version`, optional `status` and `license` ([skill-frontmatter.js](https://github.com/adobe-rnd/ew-extensions/blob/main/blocks/skills/utils/skill-frontmatter.js)).
   - **MCP servers:** a row in sheet `mcp-servers` with `key`, `url`, optional `description`, optional `headers` (array of `{name,value}`), optional `enabled`. A row counts as active when it has `key` and `url`, is not `status: draft` and is not disabled.
   - **Prompts:** a row in sheet `prompts` with `title`, `prompt`, `category` (one of `Review`, `Workflow`, `Style`, `Content`, or empty), `icon`, `status`. Rows are matched by `title`.
   - **Config document:** `GET https://admin.da.live/config/{org}/{site}/` returns the multi-sheet JSON; saving is a **full-document replace**: `POST` multipart field `config` ([docs](https://docs.da.live/developers/api/config), [da-admin put.js](https://github.com/adobe/da-admin/blob/main/src/storage/kv/put.js)). There is no ETag or `If-Match` on config (see R3). The editor rebuilds `:names` and `:type: multi-sheet` before saving; this app does the same. Write access is the server-enforced `CONFIG` ACL; a write by someone without it is a `403` ([da-admin config.js](https://github.com/adobe/da-admin/blob/main/src/routes/config.js)).
4. **Ownership ledger = new sheet `pack-installs`, one row per installed item.** Columns: `pack`, `version`, `type` (`skill` | `mcp` | `prompt`), `id` (skill id, MCP key or prompt title), `hash` (SHA-256 of the item's canonical content as installed), `installedAt`, `installedBy`. A sheet inside the site config is the same storage class the editor uses for its own extras (`marketplace-sources`, `tool-overrides`) and is human-readable and editable in the EW config UI [VERIFIED analogues; unknown-sheet tolerance by da-admin is inferred from `put.js` accepting any JSON, [ASSUMPTION] confirmed in manual step M4]. Row-per-item (rather than one JSON cell per pack) keeps rows diffable and within sheet conventions. Rows owned by a pack are not otherwise marked; the ledger is the single source of truth.
5. **Item ownership is exclusive.** One item (skill id, MCP key, prompt title) belongs to at most one pack. The lint enforces it across the registry; the planner defends against it at run time.
6. **Install never silently overwrites.** An existing item with the same identity that the ledger does not own is a **conflict**: the install is blocked until the admin resolves it, either outside the app (rename/delete in the Skills Editor) or by an explicit per-item "overwrite and take ownership" choice in the confirmation, which states that uninstall will then remove the item and cannot restore the previous content.
7. **Drift protection.** The ledger hash covers only the fields the pack defines (skill: full markdown; MCP: `url` + `description`; prompt: `title`, `prompt`, `category`, `icon`). Admin-owned toggles (`status` on skills and prompts, `enabled` on MCP rows, extra columns) are neither part of the hash nor touched by update. On update or uninstall, a drifted item needs an explicit per-item choice: keep mine (leave the row in place, release it from the pack's update) or take the pack's version (update) / delete it (uninstall).
8. **Update in place.** For items present in both versions: the row is overwritten at the same position, preserving every column the pack does not define. Items only in the new version are added; items only in the old version are removed. Identical content produces no write. The pack version is semver; only the registry's latest version is offered; an installed version newer than the registry is shown as such and never "downgraded".
9. **Skill `version` stays monotonic for the editor.** The editor bumps the integer `version` on every save. When an update changes a skill's content, the written `version` is `max(registry version, installed version + 1)`; so a registry author who forgets to bump cannot make the editor's version go backwards. The registry lint requires a valid integer `version` in every shipped skill.
10. **One-level dependencies.** A pack may list `requires` (pack id, optional minimum version). Install offers the prerequisite packs in the same plan, in dependency order, in the same single config write. Uninstall is blocked while an installed pack requires the target. No cycles (lint).
11. **Atomicity model (the honest version).** Config changes are one `POST` containing all sheet changes plus the ledger, so config state is all-or-nothing. Skill files are separate objects and cannot be in the same transaction, so the order and compensation are fixed:
    - **Install/update:** write files first (collect previous content for every file that already existed), re-read the config immediately before writing, one config `POST`, then verify by re-reading. File failure: restore previous content or delete new files; no config write. Config failure: same restore. This mirrors the editor's own save, which deletes the orphan `.md` for a new skill when the config write fails.
    - **Uninstall:** delete the files **first**, then one config `POST`. Reason: the editor continuously syncs `.da/skills/*.md` and the `skills` sheet in both directions: a `.md` file with no config row is back-filled into the sheet, and a config row with no file gets its file re-written ([syncOrphanSkillsToConfig](https://github.com/adobe-rnd/ew-extensions/blob/main/blocks/skills/skills-editor-api.js)). Deleting config first and a file second could therefore resurrect the skill. If the config write fails after the files were deleted, the files are restored from the content read beforehand.
    - A crash between steps leaves a state the app detects on next load (ledger vs reality) and offers to **Repair** (re-run the install plan) or **Remove**. Not transactional across files and config; stated, not hidden.
12. **Concurrency.** There is no optimistic locking on config (R3). Mitigation: plan on fresh state, show the plan, **re-read the config immediately before the write** and abort with "the site changed while you were reviewing, review again" if the plan would differ, patch only the sheets this app owns (everything else is re-serialised unchanged from the fresh read), and verify after writing. The residual window (between the re-read and the `POST`, plus the editor's own 15 s config cache [VERIFIED CACHE_TTL_MS] for an admin with the Skills Editor open) is documented in the README.
13. **Permission gate = the server's CONFIG ACL, read fail-closed.** The app reads the caller's write grant from the `x-da-actions` header on `GET /config/{org}/{site}/`, the same mechanism the editor uses ([`canWriteConfig`](https://github.com/adobe-rnd/ew-extensions/blob/main/blocks/skills/skills-editor-api.js)); any non-2xx, missing header or error means "no write": Install/Update/Uninstall are disabled with an explanation. The UI gate is a convenience; the real enforcement is the `403` from da-admin. Skill files also need write access under `.da/skills/`; the app additionally treats a `403` on the first file write as the same "no access" outcome with a clean rollback.
14. **Harness awareness.** The app reads the merged `flags` sheet (org config then site config, site wins; key `ew.coworker`) as the editor does ([`fetchEwFlags`](https://github.com/adobe-rnd/ew-extensions/blob/main/blocks/skills/skills-editor-api.js)). Unset = legacy da-agent harness = the verified home of site-config skills and MCP servers. Any other value shows a warning that the site's assistant may not read site-config items (on `cma` the skill list comes from the bridge and MCP servers from the caller's personal bridge settings, upstream comments in `skills-editor-api.js`), and requires an acknowledgement before install. [OPEN: behaviour of `ew.coworker=true` for site-config skills is not clear from source; see Q4.]
15. **Target site resolution.** In EW the shell's `context.org`/`context.repo` are the **code-hosting** org/repo from the `/app/{org}/{site}/...` URL, and the shell passes `search` and `hash` through to the page ([shell.js](https://github.com/adobe/da-nx/blob/main/nx/blocks/shell/shell.js), [VERIFIED]). Sibling specs assume code host equals content site. A customer site that registers this app from a *different* hosting repo (the docs' own Request Publish app is registered as `/app/adobe-rnd/aem-apps/...` for every customer, [docs](https://www.aem.live/docs/ew/administering/request-publish)) would otherwise be mis-targeted. Resolution order: (a) `#/{org}/{site}` in `context.hash` (the Skills Editor's own URL convention, `https://da.live/apps/skills#/<org>/<site>`), (b) `org`/`site` query parameters, (c) `context.org`/`context.repo`, (d) a manual `org/site` field. The resolved target is shown at the top of the page and in every confirmation. Names are validated against the same charset as DA names before use. [OPEN: how EW tells a cross-repo app which site it was opened from is undocumented; verified in manual step M3; see Q3.]
16. **Packs are inert data.** No pack content is ever executed or interpreted as HTML. Skill markdown, descriptions, names, URLs and prompts are rendered as text. Pack JSON has a closed schema: unknown keys fail validation. MCP entries cannot carry `headers` in v1 (so no credentials can ride in a pack); only `https` URLs without userinfo, query or fragment, on hosts the registry lint allows.
17. **Permissions are declared and derived, shown in the catalog.** Closed vocabulary. Derived by the lint from the contents and compared with the manifest, so the list cannot understate: `da-config-write` (always: needed to install), `da-skills-write` (when the pack has skills), `mcp-host:<host>` (one per MCP server: the assistant will call that host; for Adobe-hosted hosts it forwards the user's IMS identity, [docs](https://www.aem.live/docs/ew/administering/request-publish): "hosted on a trusted Adobe domain so the assistant forwards your IMS identity to it"). Plus author-declared `capabilities` from a closed list (`read-content`, `write-content`, `publish-content`, `manage-permissions`, `external-network`) describing what the assistant can do with the pack.
18. **Pack manifest contract (behavioural; no code).** Required: `schemaVersion` (1), `id` (kebab-case), `name`, `description` (single line, length-capped), `version` (semver), `publisher` (name, URL), `license`, `source` (URL of the public documentation the content derives from), `sourceCheckedAt` (date), `category`, `permissions`, `capabilities`. Optional: `requires`, `requirements` (human-readable real-world prerequisites), `skills` (id + file), `mcpServers` (key, url, description), `prompts` (title, prompt, category, icon). At least one item. Size caps on every string and on item counts [ASSUMPTION: numbers chosen in implementation, e.g. skill body 32 KB, 20 items per type].
19. **Content hash.** Each pack has a `contentHash`: SHA-256 (WebCrypto `SubtleCrypto.digest`, [MDN](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest)) of a canonical serialisation (sorted keys, normalised line endings) of the full manifest including skill bodies. The worker computes it; the browser recomputes it from what it received and **refuses** to install on mismatch or on schema failure. It guards transit corruption and a worker that serves inconsistent summary and detail; it is not a signature (a compromised worker can serve a consistent bad pack, see R6). The per-item `hash` in the ledger uses the same canonicalisation.
20. **Two real packs ship, sourced from public Adobe documentation**, golden values verified on 2026-11-16:
    - `aem-agentic-plugins`: one MCP server, key `aem-agentic-plugins`, URL `https://aem-agentic-plugins.adobeaem.workers.dev/mcp` ([docs](https://www.aem.live/docs/ew/administering/request-publish), "Step 2: Register the MCP connector" and [agentic-plugins](https://www.aem.live/docs/ew/administering/agentic-plugins) Step 1). The URL answers `405` to a bare `GET /mcp` and `404` on `/` (observed with curl), i.e. the host is live and speaks MCP over `POST` [VERIFIED observation only].
    - `request-publish`: skill id `request-publish` (the docs fix this id; body = the published `SKILL.md`, [source](https://www.aem.live/docs/ew/administering/request-publish-skill)), plus prompts taken from the docs' "Try:" lines ("Request publish approval for this page", "What's awaiting my approval?", "Approve the homepage", "What have I submitted?"), `requires: aem-agentic-plugins`. `requirements`: "Your org and site must be onboarded by your AEM contact and configured per the Request Publish documentation" (the app cannot verify this).
    - **Format adaptation:** the published `SKILL.md` has nested frontmatter (`metadata:` with `version: "1.0.0"`) and no top-level integer `version`; the editor's contract requires a flat positive-integer `version` and its parser is a flat `key: value` subset ([skill-frontmatter.js](https://github.com/adobe-rnd/ew-extensions/blob/main/blocks/skills/utils/skill-frontmatter.js)). The registry copy therefore carries adapted frontmatter (`name`, `description`, integer `version`, `status`) and the unchanged body. The adaptation is deliberate and recorded in the pack's `source` provenance. The skill body is a copy of Adobe documentation; redistribution rights are an open question (Q7).
21. **Worker contract (reuses #2).** One worker for this extension, in this extension's `worker/` folder, copied from `shared/worker-template/`. All requests pass the template's pipeline unchanged: origin gate and CORS (da.live and the site's own origins), preflight, **IMS-token verification before routing** (missing or invalid token = `401`), then routes. Error shape, request ids and logging are the template's. Routes (all `GET`; every other method `405` after auth):
    - `GET /v1/registry`: list of pack **summaries** (id, name, description, version, publisher, category, permissions, capabilities, requirements, requires, content counts and item identities without bodies) plus `registryHash`. `ETag` and `If-None-Match` supported.
    - `GET /v1/packs/{id}`: the full manifest with inline skill bodies and `contentHash`.
    - Registry data is bundled into the worker at deploy (a deploy is the release). The worker makes **no outbound calls** in v1, so the template's `proxy` helper and its retry logic are unused here, and `secrets.required` is empty. [OPEN: confirm the template accepts a worker with no secrets; Q9.]
22. **No vendor credentials exist in v1; the guarantee is structural.** The registry is public information; the worker's value is the authenticated gate, one deploy source, and a place for later entitlement or telemetry. AC8 ("vendor credentials live only in the worker; the browser never receives them; unauthenticated calls rejected") is satisfied vacuously for credentials and proven for the gate, plus a structural guarantee: the pack schema has no field that can hold a credential, and a test scans the served registry and the page bundle for credential-shaped strings. A future pack that needs a vendor credential would add a vendor sub-worker under `providers/<vendor>/worker/` per #2. [OPEN, Q1: whether the owner would rather serve the registry as static files from the code bus and drop the worker; the client is built behind a small registry-client boundary so that swap is a one-module change.]
23. **Worker origin is a constant in the extension, never taken from the URL** (#2 Decision 13). The page sends the user's IMS token only to that fixed origin; a test proves a `?worker=` parameter is ignored. A local worker is only reachable on `ref=local`.
24. **Browser to DA goes through the SDK's `actions.daFetch`** to `https://admin.da.live`, as upstream's block editor does for config reads and writes ([document.js](https://github.com/adobe-rnd/ew-extensions/blob/main/tools/block-editor/document.js), `sdk.actions.daFetch(\`${admin}/config...\`)`; SDK exports `daFetch` in `actions`, [sdk.js](https://da.live/nx/utils/sdk.js)). The app never calls DA with a hand-built token. `daFetch` redirects the page to sign-in on a `401` ([daFetch.js](https://da.live/nx/utils/daFetch.js)); the app treats a `401` as "session expired" and tells the user. [ASSUMPTION: that redirect inside an iframe behaves acceptably; observe in M4.]
25. **Module shape.** Pure, side-effect-free modules (manifest validation and hashing, planner, ledger, DA-site adapter that takes an injected `daFetch`, registry client that takes an injected `fetch`) plus a thin bootstrap that awaits the SDK and wires them to the DOM. The manifest validation module is imported by the browser, by the worker and by the registry lint (one implementation, three callers).
26. **UI.** Vanilla DOM, matching the scaffold's convention (no framework). Card grid, detail panel, confirmation dialog, status area; every registry-provided string set with `textContent`; keyboard-operable, accessible roles. Not in scope: theming beyond the scaffold's basics.
27. **Tooling and CI are the scaffold's** (ESLint 8 + helix, Stylelint 16, WTR, Playwright, Node 22) plus the template's worker jobs. The only addition is one repo-check script for the registry (`check:registry`), wired into the `lint` job.
28. **Docs.** Extension README (setup; the `apps` sheet row; every sheet and path the app reads and writes; permissions; how to author and release a pack; worker deploy; verification notes) and a row in the root README extensions table (type `app`).

## Testing Decisions

**What makes a good test here.** Assert external behaviour only: what the admin sees (DOM text, roles) for a given registry and site state, which requests reach the fake DA Admin and fake worker and in what order, and what the resulting site config and files are. Never assert on internal helper names, module call order or CSS classes. The two properties tested hardest, across every path: (1) **round trip**: install then uninstall returns the site config and files to the exact pre-install state (deep equality), and (2) **non-interference**: nothing the pack does not own is ever changed (every other sheet, row, column and file is byte-identical). Tests never need network, IMS or EW.

**Proposed seams** (recorded here instead of asked, per #49). Existing scaffold and template seams are reused; **no new seam type**, two new fakes behind existing seams:

| # | Seam | Status | Used by | How the outside world is faked |
|---|------|--------|---------|--------------------------------|
| S1 (primary, highest) | Entry HTML page + SDK module boundary, with DA Admin (via `actions.daFetch`) and the registry worker behind it | from #1, extended | Playwright e2e | `page.route()` serves the SDK stub (with `actions.daFetch`); admin origin backed by the in-memory fake DA Admin; worker origin backed by a route-level fake worker that serves the real registry files; any other request aborted |
| S2 | Logic modules (manifest validation, planner, ledger, installer, registry client) with injected `daFetch`/`fetch` | from #1 | WTR unit and integration tests | injected `daFetch` wired straight to the fake DA Admin; injected `fetch` wired to the fake worker |
| W1 | The worker's HTTP boundary `worker.fetch(request, env, ctx)` | from #2 | Node unit tests in `worker/test/` | template test kit (fake IMS, token factory, env factory) |
| W2 | The worker in workerd via `wrangler dev` | from #2 | worker smoke tier | template smoke harness |
| S3 | Repo convention check, extended with `check:registry` (a pure function over registry files) | from #1, extended | CI `lint` job | filesystem fixtures in a temp dir |

New fakes: (a) the **in-memory fake DA Admin** with config and source endpoints (siblings' specs #36 and #19 already propose `test/support/fake-da-admin.js` for `list`/`source`; this extension needs `config` GET/POST in addition, see Testing Requirements 1.2; coordination in Q12), (b) the **fake worker** (a route handler serving the registry files). The real worker is contract-tested against the same shared registry-contract fixtures in W1, so the fake cannot drift unnoticed.

**The conformance oracle.** The ticket's key promise is "in the Skills Editor's format; the Skills Editor shows them afterwards". The highest-confidence automated proof available without logging into EW is to run **the Skills Editor's own parsing code** over what this app wrote. A pinned, attributed (Apache-2.0, [VERIFIED upstream licence](https://github.com/adobe-rnd/ew-extensions)) copy of the relevant pure upstream functions (`isSafeId`, `normaliseRowKey`, `parseSheetBoolean`, `skillsRowsToMapAndStatuses`, `rowHeadersToArray`, `parseSkillIndexEntry`, `validateSkillFrontmatter`, `syncConfigMeta`) lives under `test/fixtures/upstream-oracle/` with the upstream commit SHA in its header; it is used only by tests. A non-blocking scheduled job may re-run the same tests against upstream `main` to detect drift (Q11). The real Skills Editor UI is covered by manual step M5.

**Modules tested:** manifest validation and canonical hashing; registry lint; worker routes; planner; ledger; DA-site adapter (permission gate, harness flag, config read-modify-write, skill files); installer and uninstaller transactions; registry client; UI render and bootstrap; the fakes themselves (contract tests).

**Prior art.** Upstream `adobe-rnd/ew-extensions`: unit tests with an SDK fixture and injected `fetchImpl`/`storage`/`now` (`test/unit/brand-visibility/session-auth.test.js`, `test/unit/utils/skill-folder-api.test.js`, `test/unit/skills-editor-api.test.js`), Tier 1 e2e route stubbing (`test/e2e/utils/da-api-stubs.js`), `test/e2e/README.md`. Within this repo: `apps/hello-world/SPEC.md` (S1/S2/S3), `shared/worker-template/SPEC.md` (W1/W2 and the test kit), `apps/deep-clone/SPEC.md` and `apps/block-bulk-editor/SPEC.md` (fake DA Admin).

## Out of Scope

- Agent presets, memory, tool overrides and marketplace sources as pack content; any Skills Editor feature beyond what the three item types need.
- The upstream Marketplace tab's feature set: Claude-plugin (`.claude-plugin/marketplace.json`) sources, per-user CMA-bridge install state, custom GitHub sources. A compatible `marketplace.json` export of the registry is not built.
- Installing into the CMA bridge's personal settings or Agent Orchestrator (`/api/v1/overrides/user/settings/*`, `/api/v1/skills`). v1 writes the site config only.
- Third-party, user-submitted or auto-discovered packs, any submission or review workflow, pack signing, a pack review UI, telemetry or usage analytics, ratings.
- Pack items that need credentials: MCP `headers`, OAuth, per-site secrets. The pack schema forbids them in v1.
- Verifying or provisioning a pack's real-world prerequisites (Request Publish onboarding, the `publish-workflow-config` tab, the Request Publish plugin/app rows, user permissions). They are displayed, never performed. The pack also does not add the Request Publish plugin or app entries to the library/apps sheets.
- Further packs (schedule publish, permissions) whose skill text is not published in the docs (Q6), and any pack from `adobe/skills`.
- Registry version history, pinning an older version, rollback to a previous pack version (uninstall and reinstall instead).
- Cross-site or cross-org install in one operation; org-level (`/config/{org}/`) install. Target is one site.
- Online/CI deployment of the worker (manual per #2), custom domain for the worker.
- Authorisation beyond DA's own CONFIG ACL; the optional `authorize` hook of the template is unused.
- Visual design polish, theming, localisation, dark mode.

## Further Notes

1. **Overlap with first-party work is real and recent.** The upstream Skills Editor already has a Marketplace tab: PRs #66 (2026-09-30, curated skills list), #77 (2026-10-28, install/enable/disable), #79 (2026-10-29, tab, plugin CRUD, custom sources, config-write governance), #80 (2026-10-29, plugin detail) are merged ([upstream PR list](https://github.com/adobe-rnd/ew-extensions/pulls?q=is%3Apr+marketplace)). It browses `.claude-plugin/marketplace.json` from GitHub (built-in source `adobe/skills`), and installs by writing the *caller's personal* `settings.plugins.installed` on the CMA bridge; it is shown only when the site resolves to the CMA harness (`marketplaceAvailable`) ([skills-editor-api.js](https://github.com/adobe-rnd/ew-extensions/blob/main/blocks/skills/skills-editor-api.js), comments above `BUILT_IN_MARKETPLACE_SOURCES`). This spec's differentiation is therefore specific and narrow: site-level, shared config (not personal), the non-CMA harness, bundles that include MCP registrations and prompts, an ownership ledger with exact uninstall and in-place update. Ticket #11's own scoring ("first-party territory and moving fast", overlap risk 4/5) is confirmed by evidence, not just assumed. The owner should decide whether to coordinate with the upstream maintainers before building (Q2).
2. **"Skills Editor shows them afterwards" holds for the legacy harness.** The editor reads `skills`/`mcp-servers`/`prompts` from site config in that mode. On the CMA harness the skills list comes from the bridge and MCP servers from per-user bridge overrides, so site-config items may not show (Decision 14, R5).
3. **The apps-plugins doc says nothing about cross-repo target sites, config writes by apps, or backends.** Grepping the fetched page (2026-11-16) for `worker`, `cors`, `backend`, `secret`, `hash`, `daFetch` finds nothing; `config` appears only for the `apps` sheet (it says an app can be visited at `https://da.live/app/{ORG}/{SITE}/{PATH}`, i.e. org/site are the hosting coordinates). Everything in Decisions 15 and 24 comes from source reading and one precedent (block editor), not documentation.
4. **Why the connector and the skill are two packs.** The docs describe them as separate steps, and the connector serves three features (request publish, schedule publish, permissions) each switched on by its own skill ([agentic-plugins](https://www.aem.live/docs/ew/administering/agentic-plugins)). Modelling the connector as a base pack and each feature as a dependent pack matches the product and makes the ticket's "at least two real packs" literally true. If the owner reads the ticket's example as *one* pack ("the Request Publish skill + connector"), merging them is a content change, not an engineering change (Q5).
5. **The `SKILL.md` instruction text is behaviourally load-bearing** (it tells the assistant to confirm before publishing, act only as the current user, and so on). Installing it is installing agent policy, which is why the preview shows the full text and why registry freshness matters (R9).
6. **Naming.** The app is a "Pack Catalog", not a "marketplace", to avoid confusion with the upstream tab.
7. **Current repo state:** `apps/skills-mcp-catalog/` contains only this `SPEC.md`; `apps/hello-world/` (#1) and `shared/worker-template/` (#2) are specs only. Everything that says "reuses the scaffold/template" presumes they landed.

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live)  ->  Apps menu card  ->  /app/{host-org}/{host-site}/apps/skills-mcp-catalog/skills-mcp-catalog#/{org}/{site}
  └─ iframe: the app  (origin https://{ref}--{site}--{org}.aem.live | .preview.da.live | http://localhost:3000 on ref=local)
        │  SDK handshake: { token, context{org,repo,ref,hash,search,...}, actions{daFetch,...} }
        ├─ GET  {WORKER}/v1/registry, /v1/packs/{id}     Authorization: Bearer <IMS token>     ──► Worker (read-only, bundled registry)
        └─ actions.daFetch  ──►  https://admin.da.live
             GET  /config/{org}/{site}/        read sheets + x-da-actions (write gate) + flags
             GET  /list|source/{org}/{site}/.da/skills/...   read existing skills (conflicts, rollback copy)
             PUT  /source/{org}/{site}/.da/skills/{id}.md    write skill file
             DELETE /source/...                              uninstall / rollback
             POST /config/{org}/{site}/                      one full-document write (skills, mcp-servers, prompts, pack-installs)
```

| Concern | Browser app (static, public) | Worker (private runtime) | DA Admin (first-party) |
|---|---|---|---|
| Pack content | fetches, **re-validates, re-hashes**, previews, never executes | owns the bundled registry; computes `contentHash` | n/a |
| Auth | sends the SDK IMS token to the fixed worker origin; DA calls go through `actions.daFetch` | verifies token, enforces CORS (template) | enforces CONFIG ACL on writes (`403`) |
| Planning | all of it (plan, conflicts, drift, dependencies) | none (read-only) | n/a |
| Writes | the only writer (files, then one config POST) | never writes anything | stores |
| Secrets | none | none in v1 (`secrets.required` empty) | n/a |

## 2. EW integration points

- **Type and registration (AC6).** App: a row in the `apps` sheet of each site that should have it ([docs](https://www.aem.live/docs/ew/developing/apps-plugins)): `title` = `Skills & MCP Pack Catalog`, `description` = `Install curated packs of skills, MCP servers and prompts`, `path` = `/app/{host-org}/{host-site}/apps/skills-mcp-catalog/skills-mcp-catalog` (for this repo: `/app/jazhou-adobe/ew-extensions/apps/skills-mcp-catalog/skills-mcp-catalog`), `ref` blank. The docs show both full URLs and `/app/...` paths for `path`; the Request Publish row uses the `/app/...` form ([docs](https://www.aem.live/docs/ew/administering/request-publish)). Whether a `#/{org}/{site}` hash may be part of `path` (needed for cross-repo target resolution, Decision 15) is [OPEN, Q3].
- **Config the app reads/writes (all documented in the README, AC5):** reads `flags` (org + site), `skills`, `mcp-servers`, `prompts`, `pack-installs`, the `x-da-actions` header, `.da/skills/`; writes the same sheets except `flags`, and `.da/skills/{id}.md`.
- **SDK actions used:** `daFetch` only (plus the SDK `token` for the worker call, and `context`). No `sendText`/`closeLibrary` (not a library plugin).
- **`ref=local` loop:** `npm start` serves the app on `:3000` (#1); the local worker runs on `:8787` with `ALLOW_LOCALHOST` (#2); open `https://da.live/app/{org}/{site}/apps/skills-mcp-catalog/skills-mcp-catalog?ref=local`. Branch ref: same URL with `?ref=<branch>` against the deployed worker.
- **Trust prompt:** the first open per `org/repo/ref` shows EW's "trust this host" dialog; the app can write the site config, so the README says so ([shell.js](https://github.com/adobe/da-nx/blob/main/nx/blocks/shell/shell.js)).
- **Skills Editor interplay:** the editor and this app write the same sheets. See Decision 11 (sync resurrect rules) and Decision 12 (no locking).

## 3. External APIs and auth flows

| API | Use | Auth | Source |
|---|---|---|---|
| DA Admin `GET /config/{org}/{site}/` | read all sheets; `x-da-actions` for the write gate | IMS bearer via `actions.daFetch` | https://docs.da.live/developers/api/config ; header use: upstream `canWriteConfig` [VERIFIED] |
| DA Admin `POST /config/{org}/{site}/` | full-document replace; multipart `config`; `403` without CONFIG write; `400` if a `permissions` sheet is posted without a CONFIG-write row | same | https://github.com/adobe/da-admin/blob/main/src/routes/config.js , `.../src/storage/kv/put.js` [VERIFIED] |
| DA Admin `list`/`source` (`GET`, `PUT`, `DELETE`) on `.da/skills/` | read existing skills, write/delete pack skill files | same | upstream `writeSkillMdFile`, `deleteSkillMdFile`, `loadSkillsFromMdFiles` [VERIFIED]. The public docs page documents `POST` for create; upstream's editor uses `PUT` for skill files [OPEN, Q10: confirm `PUT` is a supported contract, not an accident] |
| Registry worker `GET /v1/registry`, `GET /v1/packs/{id}` | catalog and pack detail | IMS bearer to the fixed worker origin | this spec (new); runtime and auth per #2 |
| Request Publish and agentic-plugins docs | source of the two real packs | n/a | https://www.aem.live/docs/ew/administering/request-publish , `.../request-publish-skill` , `.../agentic-plugins` [VERIFIED 2026-11-16] |
| `aem-agentic-plugins.adobeaem.workers.dev/mcp` | the MCP URL a pack registers; the app itself never calls it | n/a (the assistant forwards identity) | doc-stated; liveness observed only (`405` to bare `GET`) |
| `SubtleCrypto.digest` | SHA-256 for `contentHash` and ledger hashes | n/a | https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest |

**Auth flows.** Browser to worker: the SDK-provided IMS token as `Authorization: Bearer`, verified by the template (#2 Decision 6). Browser to DA: `actions.daFetch` attaches the same user's token; da-admin decides per path/ACL. The worker never sees DA data and DA never sees the worker.

## 4. Data contracts

All behavioural, no code.

**Registry summary (list item):** id, name, description, version, publisher{name,url}, license, category, permissions[], capabilities[], requirements[], requires[{id,minVersion?}], contents{skills[{id,description}], mcpServers[{key,host,description}], prompts[{title}]}, contentHash. Envelope: `{ schemaVersion, registryHash, packs[] }`.

**Pack detail:** the manifest plus, per skill, the markdown `content` inline, plus `contentHash`.

**Config sheet rows written (the Skills Editor's format, Decision 3):**

| Sheet | Row written by install | Columns preserved on update | Match key |
|---|---|---|---|
| `skills` | `{ key: <id>, content: <markdown>, status: 'approved' }` | any other column; existing `status` on update | `key` (trailing `.md` stripped, as the editor does) |
| `mcp-servers` | `{ key, url, description }` | `enabled`, `headers`, any other column | `key` |
| `prompts` | `{ title, prompt, category, icon, status: 'approved' }` | existing `status`, any other column | `title` |
| `pack-installs` | `{ pack, version, type, id, hash, installedAt, installedBy }` per item | n/a (owned wholly by this app) | `pack` + `type` + `id` |

Every sheet keeps its `total`/`limit`/`offset` envelope; `:names` and `:type` are rebuilt; sheets and rows the app does not own are re-serialised unchanged.

**Plan (conceptual):** ordered list of `{ pack, type, id, action }` with `action` in `add`, `replace`, `replace-drifted` (needs choice), `overwrite-unowned` (needs explicit choice), `remove`, `remove-drifted` (needs choice), `noop`, `blocked` (reason). Computed purely from (pack detail, site state, ledger, harness flag, permission gate). Nothing is written until the admin confirms it; a second plan computed from fresh state right before the write must equal the confirmed one.

**Pack state per site:** `not-installed`, `installed`, `update-available`, `modified` (drift), `damaged` (ledger rows whose items are missing), `newer-than-registry`.

**Error contract (client-visible):** worker errors use the template's `{ error: { code, message, requestId } }`; the app maps `401` to "sign in again", `403` to "no access", `429/5xx/network/timeout` to a retryable message, schema or hash failures to "this pack looks invalid; not installed", and never shows a token, a stack trace or raw server text.

## 5. Folder layout (proposed; fits the #1 and #2 conventions)

```
apps/skills-mcp-catalog/
├─ SPEC.md                         this file
├─ README.md                       setup, apps row, sheets read/written, pack authoring, worker deploy, caveats
├─ skills-mcp-catalog.html         entry page: SDK <script type=module> + bootstrap
├─ skills-mcp-catalog.js           thin bootstrap (awaits SDK, wires modules to the DOM)
├─ skills-mcp-catalog.css
├─ src/                            pure modules (naming is the implementer's call): manifest (validate + canonical hash, shared with worker and lint),
│                                  planner, ledger, da-site (injected daFetch), registry-client (injected fetch), render
├─ worker/                         per #2: copied scaffold (wrangler config, entry, .dev.vars.example, README, test stub)
│  ├─ routes.js                    the two routes above
│  ├─ registry/packs/<id>/pack.json (+ skills/<skill-id>/SKILL.md)   the registry; hidden from the code bus by the worker/ ignore rule
│  └─ test/                        W1 tests (+ W2 smoke registration)
├─ scripts/check-registry.js       registry lint (S3 extension), pure function + CLI wrapper
├─ test/unit/  test/e2e/
└─ test/fixtures/                  registry-contract fixtures, config snapshots, upstream-oracle/ (pinned, attributed)
```

Shared harness: `test/support/` at the repo root holds the SDK stub and fetch guard (#1). The fake DA Admin goes in `test/support/fake-da-admin.js` (shared with #36/#19, Q12); the fake worker is local to this extension. Vendor sub-workers, if ever needed, go in `providers/<vendor>/worker/` (#2 Decision 3). No imports from other extensions; `worker/` importing this extension's own `src/manifest` is within the same folder (the bundler follows it).

## 6. Risks and unknowns

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Adobe outside-activity/IP policy** and redistributing Adobe documentation text (the `SKILL.md`) from a personal repo. Carries over from #1 R1/#2 R1. | High for publishing; blocks nothing technical | [OPEN, Q7] README note; owner clears policy before the repo or worker is shared. |
| R2 | **Upstream overlap**: first-party Marketplace tab exists and moves fast (Further Notes 1). Upstream could add site-level packs. | High | Narrow differentiation (site-level, non-CMA, ledger); owner decides whether to coordinate or contribute upstream (Q2). Packs are plain files, so porting is cheap. |
| R3 | **Config has no optimistic concurrency** (`POST` replaces the whole document; no ETag; `put.js` just stores). A concurrent editor save can be lost, or ours can overwrite theirs. | High | Fresh re-read immediately before the write, minimal patch of owned sheets, post-write verify, documented residual window. No way to remove it client-side. [OPEN: ask the DA team whether `If-Match` on config is planned, Q8.] |
| R4 | **Not transactional across files and config** (Decision 11); the editor's bidirectional sync can resurrect or recreate items. | Medium | Fixed write order, compensation, Repair flow, tests IN3-IN6. |
| R5 | **Harness mismatch**: on `cma` (and possibly `true`) site-config items are not what the assistant reads. | Medium | Read the flag, warn, require acknowledgement; manual M10; Q4. |
| R6 | **Supply chain**: a compromised registry or worker can push a skill (agent policy) or an MCP URL (an endpoint that receives user content, and possibly the forwarded IMS identity on trusted hosts) to every site that installs. | High | Curated registry through PR review; closed schema; no headers/credentials; https and host allowlist in lint; full preview and confirmation; per-pack `contentHash` shown and stored; text-only rendering. Signing deferred (Out of Scope). [OPEN: which hosts may a pack register, Q13.] |
| R7 | **Prompt-injection surface**: skill markdown is instructions to an LLM. A hostile pack could carry instructions that exfiltrate or destroy. | High | Same as R6; the preview shows full text; the lint flags nothing semantic (it cannot). Review is the control. |
| R8 | **Target-site ambiguity** for cross-repo hosting (Decision 15). | High if wrong | Hash/query/context/manual order; target shown in every confirmation; server ACL is the backstop; verified in M3; Q3. |
| R9 | **Registry content goes stale** relative to the Adobe docs it was copied from (the skill text is edited by Adobe). | Medium | `source` and `sourceCheckedAt` per pack; README release checklist; optional scheduled job diffing the doc page vs the registry copy [OPEN, Q14]. |
| R10 | **Format drift in upstream Skills Editor** (new required columns, new frontmatter rules). | Medium | Pinned oracle tests; optional non-blocking drift job (Q11). |
| R11 | **`ledger` sheet tolerance**: unknown sheet `pack-installs` accepted by da-admin and shown/edited safely in the EW config UI; no collision with future first-party sheet names. | Low-Med | [ASSUMPTION] verified in M4; the name is a constant. |
| R12 | **`PUT` vs documented `POST`** for skill files (Q10). | Low | Reuse the editor's verb; contract test with fake; M4. |
| R13 | **`daFetch` 401 triggers sign-in redirect** inside an iframe; token expiry mid-install. | Low-Med | Read-only precheck then short operation; treat 401 as session expired; observe in M4. |
| R14 | **IMS token claims/CORS origins** for the worker call (the #2 unknowns R2/R4): the worker's allowlist and client-id decisions are the template's. | Medium | Inherit #2's manual W2/W3 and re-observe from this app's origin in M1/M2. |
| R15 | **Worker adds little value in v1** (public data, no secrets). | Low | Honest rationale in Decision 22; client boundary makes it removable; Q1. |
| R16 | **MCP URL liveness/ownership**: `aem-agentic-plugins.adobeaem.workers.dev` is Adobe's, but its repo and stability guarantees are not public. A URL change breaks installed sites silently. | Medium | Update-in-place makes a fix a one-click update; README release checklist; Q6. |
| R17 | **Free-plan Workers limits** (10 ms CPU): hashing a few packs at isolate start. | Low | [ASSUMPTION] negligible; measure in smoke SM-C. |
| R18 | **Unknown first-party constraints**: sheet row-count limits (editor creates sheets with `limit: 1000`), maximum config size, `x-da-actions` header shape variations. | Low | Parse per the editor's `parseActionsHasWrite` semantics incl. fixtures; cap pack sizes. |

## 7. Ordered build plan (sized to #11's acceptance criteria)

0. **Prerequisites (owner):** #1 and #2 landed (tooling, hello app, CI, worker template, Cloudflare account); decide Q1, Q3, Q5, Q7 (they change scope) before step 1; sandbox site with config-write access exists (Testing Requirements 6).
1. **Manifest module, test-first:** validation, closed schema, derived permissions, canonical hash; tests RG1-RG10. Vendor the pinned upstream oracle with a failing "editor parses our rows" test first. (AC1, AC4 groundwork)
2. **Registry content + lint:** author the two real packs from the documentation; `check:registry`; golden test; wire into `lint`. (AC4)
3. **Worker (from the #2 scaffold), test-first:** routes, contract fixtures, W1 tests WK1-WK8, W2 registration; reuse template pipeline untouched. (AC1 backend, AC8)
4. **Test support:** fake DA Admin with config and source endpoints and failure/concurrency injection; SDK stub with `actions.daFetch`; fake worker; fakes' contract tests (DA1-DA6).
5. **DA-site adapter:** config read/write (preserving everything unowned), permission gate, harness flag, skill file I/O with captured previous content; tests IN8, IN9, IN12, IN14.
6. **Ledger + planner:** states, conflicts, drift, dependencies, monotonic skill version; tests PL1-PL14. (AC2, AC3 core)
7. **Installer/uninstaller transactions:** order, rollback, verify, idempotence, round trip; tests IN1-IN7, IN10, IN11. (AC2, AC3)
8. **Registry client + UI + entry page + CSS + bootstrap:** tests RC1-RC8, UI1-UI9; then hermetic e2e E2E1-E2E9. (AC1, AC2, AC3)
9. **README, root README table row, apps-row docs;** convention check passes. (AC5, AC6)
10. **CI wiring:** `check:registry` in `lint`; unit, worker-unit, worker-smoke, e2e green on push and PR; no secrets in CI. (AC9)
11. **Deploy the worker; run manual verification M0-M12** on a sandbox site with `ref=local` and a branch ref; record results in the PR; fix caveats in the README. (AC6, AC7, AC8)
12. **Hand-off notes:** pack authoring guide, release checklist, how to add the schedule-publish/permissions packs once their skill text is available (Q6).

---

# Testing Requirements

Runner and tooling follow the scaffold: `@web/test-runner` + Mocha + `@esm-bundle/chai` in real Chromium for unit tests, Playwright (Chromium) for hermetic e2e, tests inside the extension's `test/` folder, fetch guard on (any non-stubbed external request fails the test). Worker tests use the template's Node built-in runner and test kit. Everything under CI needs no credentials, no Cloudflare login and no EW.

## 1. Fixtures, mocks, helpers

### 1.1 Registry and pack fixtures
- **Shipped registry** (the real files) for golden tests; **minimal valid pack** and a family of **invalid mutants** (one defect each: missing field, unknown key, bad semver, bad id, bad frontmatter, nested `metadata.version` only, `headers` on an MCP, `http://` URL, URL with userinfo/query, host off the allowlist, undeclared derived permission, unknown capability, dependency cycle, missing dependency, duplicate item across packs, oversize skill, hostile strings: `<img onerror>`, `<script>`, `__proto__`, control characters, bidi characters).
- **Registry-contract fixtures** (`/v1/registry` envelope, `/v1/packs/{id}` detail): shared by W1 worker tests and the fake worker so they cannot drift.

### 1.2 Fake DA Admin (primary fixture)
In-memory, behind a `daFetch`-compatible function (S2) and `page.route()` handlers (S1). It reproduces as behaviours: `GET /config/{org}/{site}/` (multi-sheet JSON, `404` when absent, `x-da-actions` with a configurable grant such as `/{org}/{site}/=read,write`, missing header, read-only); `POST` config (multipart `config`, **full replace**, `403` without write grant, `400` when a posted `permissions` sheet lacks a CONFIG-write row, **no ETag**, returns the stored body with `201`); `list`, `GET`, `PUT`, `DELETE` of `.da/skills/{id}.md` with `404`/`403`; per-call failure injection (5xx, 429, network error, 401); a **concurrency hook** that mutates the config or a file between two chosen requests (simulates the Skills Editor saving at the wrong moment); a request log (method, path, body) so tests can assert "zero writes before confirm", ordering, request counts. Pre-seeded states: empty config; config with the editor's own items; config with unknown sheets and extra columns; org-level and site-level `flags`; ledger at v1 of a pack. **Fake contract test:** pins the fake to the documented/observed API shapes (status codes, full-replace semantics, header format) using a fixture of real responses recorded once from the sandbox [OPEN until the sandbox exists].
- Shared with #36/#19 (`test/support/fake-da-admin.js`); this extension adds the `config` endpoints and the concurrency hook (Q12).

### 1.3 SDK stub and fake worker
- SDK stub: the scaffold's stub (`context`, `token`, `actions`) **plus `actions.daFetch`**, composed locally if the shared stub lacks it (same proposal as #36; the scaffold's stub contract test should gain `daFetch`). `context.hash` and `context.search` settable.
- Fake worker: a route handler for the worker origin that checks the `Authorization` header (rejects with the template's `401` shape when absent or wrong), serves the contract fixtures, and can be told to be slow, `5xx`, malformed, hash-mismatched or hostile.
- Token hygiene: a distinctive test token; every test asserts it never appears in DOM text, console output or error messages.

### 1.4 Upstream conformance oracle
`test/fixtures/upstream-oracle/`: pinned, attributed copies of the upstream pure functions listed under Testing Decisions, with the commit SHA. Used only to judge our output.

## 2. Unit and contract tests (seams S2, S3)

### 2.1 Manifest and registry lint (RG)
| ID | Behaviour asserted |
|---|---|
| RG1 | Minimal valid pack passes; each missing required field yields a specific, human-readable error naming the field |
| RG2 | Closed schema: any unknown key at any level fails; `schemaVersion` other than 1 fails |
| RG3 | Skill: id charset, `name` equals id, single-line description, integer `version`, status value, size cap, via the oracle's `validateSkillFrontmatter` and `isSafeId`; nested-only `metadata.version` fails |
| RG4 | MCP: `https` only; userinfo, query, fragment rejected; `headers` rejected; host must be on the registry allowlist; key charset |
| RG5 | Prompts: non-empty title and prompt, title unique within the pack, category in the editor's list or empty |
| RG6 | Derived permissions (`da-config-write`, `da-skills-write` iff skills, `mcp-host:<host>` per server) must equal the declared set; capabilities from the closed vocabulary only |
| RG7 | `requires` resolves in the registry, satisfies `minVersion`, no cycles; no two packs own the same skill id, MCP key or prompt title |
| RG8 | Semver valid and compared correctly (`1.10.0 > 1.9.0`, pre-release rules per https://semver.org/); `sourceCheckedAt` is a date |
| RG9 | Hostile strings are rejected or carried as inert text (never interpreted); `__proto__`/`constructor` keys cannot pollute |
| RG10 | `contentHash` is deterministic (key order, line endings) and changes when any field or skill byte changes |
| RG11 | **Golden shipped registry:** contains exactly the two real packs; `aem-agentic-plugins` has MCP key `aem-agentic-plugins` and URL `https://aem-agentic-plugins.adobeaem.workers.dev/mcp`; `request-publish` has skill id `request-publish`, requires the connector, has the documented prompts; every skill passes the editor's frontmatter rules via the oracle. Fails if someone edits a golden value (forces a conscious change; protects AC4) |
| RG12 | The lint CLI exits non-zero with the file and field for each mutant, zero for the shipped registry (S3) |

### 2.2 Planner and ledger (PL), pure, table-driven over (pack, site state, ledger)
| ID | Behaviour asserted |
|---|---|
| PL1 | Clean site: every item `add`; ledger rows for every item; prerequisites first |
| PL2 | Existing **unowned** item with the same skill id / MCP key / prompt title: `blocked` conflict by default; explicit per-item overwrite choice turns it into `overwrite-unowned` and says it is not restorable |
| PL3 | Same version, no drift: all `noop`, empty write set |
| PL4 | Newer version: unchanged items `noop`; changed `replace`; new `add`; dropped (owned) `remove` |
| PL5 | Drifted owned item: needs a choice; "keep mine" leaves the row untouched; "take pack's" replaces it; drift detection ignores `status`/`enabled`/extra columns |
| PL6 | Admin toggles survive update: an MCP `enabled: false` and a skill `status: draft` stay as the admin left them and are not drift |
| PL7 | Unknown extra columns and unrelated rows/sheets are preserved in the planned result |
| PL8 | Missing prerequisite: plan includes it first; uninstalling a pack required by an installed pack is `blocked` |
| PL9 | Installed version newer than registry: state `newer-than-registry`, no action offered |
| PL10 | Ledger rows with missing items: state `damaged`; repair plan re-adds exactly the missing ones |
| PL11 | Skill `version` monotonic: registry version ≤ installed with changed content writes `installed + 1`; registry higher writes the registry value; unchanged content writes nothing |
| PL12 | Identity safety: ids or titles that could escape a path or collide after normalisation (`../x`, `X.md` vs `x`) are rejected before any request |
| PL13 | Ledger keys are `pack`+`type`+`id`; two packs' rows never merge; hash covers only pack-defined fields |
| PL14 | Plan is deterministic and identical for identical inputs (the pre-write re-plan comparison relies on it) |

### 2.3 Installer, uninstaller and DA-site adapter (IN), against the fake DA Admin
| ID | Behaviour asserted |
|---|---|
| IN1 | **AC2 core.** Install `request-publish` (with prerequisite): `PUT` of `.da/skills/request-publish.md`, then exactly one config `POST`; resulting rows in `skills`, `mcp-servers`, `prompts`, `pack-installs` match the Skills Editor format; the **oracle** parses them: `skillsRowsToMapAndStatuses` yields the skill as `approved`, the MCP row becomes an active configured server, `parseSkillIndexEntry` returns the frontmatter fields, prompts match by title |
| IN2 | **Non-interference.** All other sheets (including unknown ones and `permissions`), all other rows, all extra columns and all other files are deep-equal before and after; `:names`/`:type` rebuilt as the editor does |
| IN3 | Order and rollback: file written before config; a failing file `PUT` (403/500) leaves the site exactly as before with no config `POST`; a failing config `POST` (403/400/5xx) restores or deletes the files written in this run; final state deep-equals the start |
| IN4 | **AC3 uninstall.** Removes exactly the ledger's items and their `.md` files; an unowned item with a similar name, another pack's items, and other sheets are untouched; ledger rows removed; files deleted **before** the config write |
| IN5 | Uninstall config `POST` fails after files were deleted: files are restored; state deep-equals the start |
| IN6 | **AC3 update in place.** v1 installed then v2: same row positions, no duplicates, changed content replaced, added/removed items handled, ledger version updated; running the update again produces **zero writes** (request log has no `PUT`/`POST`/`DELETE`) |
| IN7 | **Round trip property.** For each shipped pack and for randomised synthetic packs: install then uninstall gives a config and file set deep-equal to the original; install v1, update v2, uninstall equals original |
| IN8 | Concurrency: the fake mutates the config between plan and pre-write re-read, so the plan changes: the app aborts with "site changed, review again", zero writes. A mutation after the re-read cannot be prevented; the test documents it by asserting the post-write verify detects a clobbered row and surfaces a warning |
| IN9 | Permission gate: `x-da-actions` read-only, missing or malformed header, or non-2xx, means no write (fail closed); zero writes; server `403` on `POST` shows a plain message and rolls back |
| IN10 | Config `404`: blocked with an explanation; no config is created as a side effect |
| IN11 | Verify step: post-write re-read mismatch (row missing/changed, file differs) is reported as a warning with a retry-verify action; never reported as success |
| IN12 | Harness flag: `ew.coworker` unset reads as legacy and shows no warning; `cma` (site) or `true` (org, overridden by site) shows the warning and requires acknowledgement; site overrides org |
| IN13 | `x-da-actions` parsing fixtures: `/o/s/=read,write`, multiple entries separated by space/semicolon, `=read`, empty, garbage, parity with the oracle-style `parseActionsHasWrite` behaviour |
| IN14 | Reads that fail transiently (429, 5xx, network) abort cleanly with a retryable message and no writes |
| IN15 | Token never appears in any message, log or thrown error |

### 2.4 Registry client (RC), injected `fetch`
| ID | Behaviour asserted |
|---|---|
| RC1 | Sends `Authorization: Bearer <SDK token>` to the configured worker origin only; shows entries returned |
| RC2 | `?worker=https://evil.example` (query or hash) is ignored; on `localhost` the loopback worker, otherwise the fixed deployed origin (inherits #2 HP5) |
| RC3 | `401` shows "sign in again"; `403`, `429`, `5xx`, network failure and slow response (bounded timeout) each show a short plain message and a retry; no stack, no server text |
| RC4 | Detail whose recomputed hash differs from `contentHash` is refused; schema-invalid detail is refused; summary and detail disagreeing on version or contents is refused |
| RC5 | `ETag`/`If-None-Match`: second load uses `304` and cached data |
| RC6 | Hostile strings in a (tampered) response are rendered as text only (see UI2) |

### 2.5 UI (UI), DOM-level
| ID | Behaviour asserted |
|---|---|
| UI1 | **AC1.** Catalog lists each pack with name, description, version, publisher, counts of skills/MCP servers/prompts, permissions, capabilities and requirements |
| UI2 | Detail shows full skill markdown, MCP URL and host, prompts as **text**: `<img onerror>`, `<script>`, `javascript:` links create no elements and execute nothing |
| UI3 | State badge per pack: not installed, installed vX, update available, modified, damaged, newer than catalog |
| UI4 | Read-only user: Install/Update/Uninstall disabled with the reason; standalone (no SDK) state; "waiting" then "not running inside Experience Workspace" with a short injectable timeout |
| UI5 | Confirmation lists exactly the plan (adds, replaces, removes, conflicts, drift choices, prerequisite, harness warning acknowledgement) and the resolved target site; Cancel produces zero writes |
| UI6 | Busy state; a second click or a second operation while one is in flight is ignored; failure state shows retry; success shows new state |
| UI7 | Target resolution order: hash > query > context > manual; malformed names rejected; the target is always displayed |
| UI8 | Keyboard operability and accessible roles/names for card, dialog, buttons (basic semantics only) |
| UI9 | Token never in DOM or console |

## 3. Worker tests (seam W1; Node built-in runner; template test kit)

Inherits #2's template tests (auth, CORS, retry, secrets) unchanged; they are not re-written here. This extension's route tests:

| ID | Behaviour asserted |
|---|---|
| WK1 | **AC8.** `GET /v1/registry` and `/v1/packs/{id}`: no token, malformed token, wrong-key token, expired token all `401` with the template's error shape and CORS headers for an allowed origin; handler never runs (spy) |
| WK2 | Valid token: `200` JSON equal to the contract fixture; summaries contain no skill bodies; detail contains them and `contentHash` |
| WK3 | Unknown pack id `404`; path traversal or oversize ids `400`/`404`; non-`GET` methods `405` (after auth); unknown routes `401` without a token and `404` with one (template UA12) |
| WK4 | `ETag` present; `If-None-Match` returns `304`; `Cache-Control` is private |
| WK5 | CORS smoke on these routes: `https://da.live`, the site's `aem.live`/`aem.page`/`preview.da.live` origins allowed; `https://evil.example` and look-alikes `403`; localhost only with `ALLOW_LOCALHOST` |
| WK6 | **Structural no-credentials:** with a canary secret in `env`, no response body or header contains it; no served field is credential-shaped (scan for `Authorization`, `apiKey`, `secret`, bearer-looking strings, high-entropy tokens) |
| WK7 | The served registry equals the bundled files byte for byte (golden hash); `contentHash` from the worker equals the browser module's recomputation (shared algorithm) |
| WK8 | Wrangler config has empty `secrets.required` and no secret-looking `vars` (template UR3/UR5 pass) |

**Smoke (seam W2):** SM-C1: the worker bundles (imports `src/manifest` from the extension), a bare request is `401`, a valid token returns the list, preflight from `https://evil.example` is `403`. SM-C2: records CPU/wall time for the registry hash at isolate start (informational, R17).

## 4. End-to-end tests (seam S1), hermetic Playwright, Chromium

Server: the scaffold's dev server on `:3000`. Stubs: SDK stub with `daFetch` forwarding to real `fetch`; `page.route()` for the admin origin backed by the fake DA Admin and for the worker origin backed by the fake worker; any other request aborted.

| ID | Behaviour asserted |
|---|---|
| E2E1 | Catalog loads from the fake worker, shows both real packs with counts and permissions |
| E2E2 | **AC2.** Install `request-publish`: confirmation lists prerequisite + items + target site; after confirm the fake DA Admin holds the expected rows and file, the oracle parses them, the UI shows both packs installed |
| E2E3 | **AC3.** Uninstall `request-publish` then the connector: fake state deep-equals the seeded initial state |
| E2E4 | **AC3.** Seed v1 installed, registry serves v2: UI says update available; update changes rows in place; request log shows one config `POST`; second update is a no-op |
| E2E5 | Admin edited an installed skill in the fake: update and uninstall prompt for a choice; "keep mine" preserves it |
| E2E6 | Read-only grant: buttons disabled; no write request was ever sent |
| E2E7 | Worker `401`/`5xx`/slow: plain message and retry; no unhandled errors; DA never contacted for writes |
| E2E8 | Only expected hosts were contacted (page, SDK stub, worker origin, admin origin); token appears in no DOM text or page source; standalone state when the SDK never resolves |
| E2E9 | Concurrent-edit injection between review and confirm: abort with a re-review message, zero writes |
| E2E-W | (reuses #2's `webServer` for the real worker on `:8787` with a test key and the fake IMS) The page on `localhost:3000` fetches the **real** local worker with a test-signed token: real cross-origin request with preflight succeeds; the same request without a token fails `401` readable by the page; a token signed by another key fails. Proves AC8's browser path hermetically |

## 5. Manual verification in EW (needs an interactive Adobe IMS login; cannot be automated)

**Accounts and credentials needed:** GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync, per #1); a Cloudflare account with Wrangler login (per #2); an Adobe IMS identity with **CONFIG write** on a **sandbox site** (the hosting site `jazhou-adobe/ew-extensions` can double as the sandbox) and `.da/skills` write; a **second identity with read-only** access to the same site; optionally a second sandbox site for the cross-repo target test; Chrome. No vendor sandbox accounts or API keys (the registry holds none). Optional, for real assistant behaviour of the Request Publish pack: onboarding by an AEM contact (Q6/Q14). Never paste a real IMS token into chat, issue comments or logs.

- **M0 (prereq):** #1's M0 passes; the worker is deployed (template W0) and its `workers.dev` URL set as the app's worker constant in a normal PR; `curl -i <worker>/v1/registry` returns `401`.
- **M1 (`ref=local`):** `npm start` and the local worker; open `https://da.live/app/jazhou-adobe/ew-extensions/apps/skills-mcp-catalog/skills-mcp-catalog?ref=local`; accept the trust prompt; the catalog shows the two packs; DevTools Network: worker preflight `204`, `Access-Control-Allow-Origin: http://localhost:3000`; no request carries the token to any host other than the worker and admin.da.live. Proves AC7 (local), AC1, AC8.
- **M2 (branch ref):** push `catalog-packs`; open the same URL with `?ref=catalog-packs`; the catalog loads from the deployed worker; record the page's actual `Origin` (aem.live or preview.da.live) and confirm the worker accepted it (re-observes #2 R2). Proves AC7 (branch).
- **M3 (Apps menu and target site):** add the `apps` row to the sandbox site's config; the card appears at `https://da.live/apps#/{org}/{site}` and opens the app (AC6). Then, if a second site is used, register the app in it with a path pointing at this repo and observe what `context` and `hash` the app receives (Decision 15, Q3); record the working registration form in the README.
- **M4 (install):** on the sandbox site open the catalog, install **Request Publish** (prerequisite offered); confirm the dialog names the right site. Then, in `https://da.live/config#/{org}/{site}/`, see sheets `skills`, `mcp-servers`, `prompts` and `pack-installs` with the expected rows; save the config once in the EW UI and reload to confirm the unknown `pack-installs` sheet survives (R11). Note the behaviour of `daFetch` on an expired session (R13). Proves AC2 (config half), R11/R12.
- **M5 (Skills Editor shows them):** open `https://da.live/apps/skills#/{org}/{site}`: Skills tab lists `request-publish` as approved with its description; MCPs tab lists `aem-agentic-plugins` with the URL; Prompts tab lists the pack prompts. Open the skill: frontmatter valid, no editor warning. Proves AC2 end to end.
- **M6 (assistant):** open the assistant on a page; confirm the connector's tools are available (the MCPs tab's tool view) and, if the site is onboarded, that "Request publish approval for this page" triggers the documented flow (previews, summary, asks for confirmation). If not onboarded, record that the tools list is present and the flow stops at the documented onboarding error. Proves the packs are *real*, not just well-formed (AC4).
- **M7 (idempotence and update):** click Install again: no changes. Edit the skill in the Skills Editor, then reinstall/update: the drift prompt appears. Bump a pack version on the branch, deploy the worker, reload: "update available"; update: the same rows change in place.
- **M8 (uninstall):** uninstall both packs; `config` and the Skills Editor tabs return to the pre-install state (compare screenshots/JSON); the `.da/skills/request-publish.md` file is gone and does not reappear after opening the Skills Editor (checks the editor-sync resurrect rule, Decision 11). Proves AC3.
- **M9 (read-only user):** with the second identity, open the catalog: install disabled with the explanation; `curl`/DevTools shows no write attempted. If forced via DevTools, da-admin returns `403`.
- **M10 (harness):** on a site with `ew.coworker=cma` in `flags`, open the catalog: warning and acknowledgement shown (AC unaffected; R5).
- **M11 (unauthenticated worker, deployed):** `curl -i <worker>/v1/registry` and `/v1/packs/request-publish` without a token: `401`; with `Origin: https://evil.example` and a valid token: `403`. Proves AC8.
- **M12 (docs):** follow the extension README from a clean clone on a scratch copy; the root README table lists `skills-mcp-catalog` (type `app`) with working paths.

Record screenshots and the JSON diffs in the PR description (the PR template asks for the branch-ref test URL).

## 6. CI additions (no credentials)

| Job | Steps | Notes |
|---|---|---|
| `lint` (existing, #1) | adds `check:registry` (RG12) and the convention check over this extension | `npm run check` |
| `unit` (existing) | RG, PL, IN, RC, UI, fake contract tests, oracle tests | fetch guard on |
| `worker-unit` / `worker-smoke` (from #2) | WK1-WK8; SM-C1/C2 | smoke may be non-blocking per #2 Q11 |
| `e2e` (existing) | E2E1-E2E9, E2E-W | Chromium only |
| `oracle-drift` (optional, scheduled, non-blocking) | re-run oracle tests against upstream `main` | Q11 |

## 7. Acceptance-criteria traceability (ticket #11)

| # | Acceptance criterion (#11) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | Catalog lists packs with description, contents, version and required permissions; packs come from a registry the worker serves | UI1, UI2, UI3 (render), RC1-RC6 (client), WK1-WK7 (worker serves the registry), RG1-RG11 (what a pack must contain incl. permissions), E2E1, E2E-W | **M1**, **M2** (catalog loads from the deployed worker); review: each card shows all five fields |
| AC2 | Install writes skills, MCP registrations and prompts into the site config in the Skills Editor's format; the Skills Editor shows them afterwards | IN1 (oracle parses the rows), IN2 (non-interference), IN3 (rollback), PL1-PL3, E2E2 | **M4** (config rows), **M5** (real Skills Editor shows skill, MCP, prompts) |
| AC3 | Uninstall removes exactly what the pack installed; reinstalling a newer version updates in place | IN4, IN5, IN6, IN7 (round trip), PL4-PL8, PL10, PL11, E2E3, E2E4, E2E5 | **M7** (update, drift), **M8** (uninstall, no resurrect) |
| AC4 | At least two real packs ship in the registry (for example Request Publish + `aem-agentic-plugins`) | RG11 (golden: both packs, exact documented values), RG12, WK7 (served = bundled) | **M6** (the packs actually work in the assistant, or stop at the documented onboarding step); review against https://www.aem.live/docs/ew/administering/request-publish |
| AC5 | All code in its own self-contained `skills-mcp-catalog` folder with a README (setup, EW config-sheet row, site config it reads) | Convention check S3 (entry page named after folder, README, tests in folder) on every `apps/<name>/` | **M12** (README walk-through); review: README lists the `apps` row, every sheet read/written, worker deploy, pack authoring |
| AC6 | Listed in the repo README extensions table and reachable from the EW Apps menu | S3 table-integrity check (row exists, resolves to folder and entry page) | **M3** (card at `https://da.live/apps#/{org}/{site}` opens the app); **M12** |
| AC7 | Works in EW with `ref=local` and with a branch ref | E2E1-E2E9 (hermetic, entry page), E2E-W (cross-origin local path) | **M1** (`ref=local`), **M2** (branch ref), recorded in the PR |
| AC8 | Vendor credentials only in this extension's worker (from the shared template); browser never receives them; unauthenticated calls rejected | WK1 (401 matrix), WK5 (CORS), WK6 (structural no-credentials), WK8 (empty `secrets.required`, clean `vars`), RG4 (schema forbids headers/credentials), RC2 (worker origin constant), E2E8 (token and hosts), E2E-W (browser to real worker, no-token and wrong-key fail), SM-C1; template tests from #2 | **M11** (`curl` unauthenticated on the deployed worker), **M1**/**M2** (Network panel). Note: no vendor credential exists in v1; the criterion is proven as "none can exist in the browser or registry, and the gate holds" (Decision 22, Q1) |
| AC9 | Core logic covered by unit tests; lint and CI green | All of sections 2 and 3 run in CI; RG12 in `lint` | Verify on GitHub: a pushed branch and an opened PR show `lint`, `unit`, `worker-unit`, `worker-smoke`, `e2e` green; break a rule on a scratch branch (e.g. drop a derived permission) and see RG6/RG12 fail |

Every acceptance criterion on #11 maps to at least one automated test or a numbered manual verification step above.

## 8. Open questions for the owner

1. **Is the worker worth it in v1 (R15)?** The registry is public data and holds no secret. The ticket (AC1, AC8) says the worker serves it, and the spec does that. Do you want to keep it (authenticated gate, one deploy source, room for entitlement later) or serve static files from the code bus (no infra, no template dependency, but unauthenticated and AC8 would need rewording)?
2. **Overlap with upstream (R2).** The first-party Marketplace tab shipped in late October. Do you want to contact the upstream Skills Editor maintainers before building (to avoid duplicating or to contribute site-level packs upstream), and is a narrow "site-level, non-CMA harness, with MCP + prompts + exact uninstall" positioning acceptable?
3. **Target site for cross-repo hosting (Decision 15, R8).** Do you know how EW tells an app registered from another hosting repo which site it was opened for (hash `#/{org}/{site}`, query, or something else)? Or are you happy to require that the catalog is hosted in (and registered from) the same repo that is the content site, as the sibling specs assume?
4. **Harness behaviour (R5).** Does the assistant read site-config skills and MCP servers when `ew.coworker` is `true` (Agent Orchestrator) or `cma`? The spec warns and requires acknowledgement for anything but "unset"; confirm that is the right posture or block outright.
5. **Pack granularity.** Confirm "connector = one pack, Request Publish = a dependent pack" (two real packs), or merge them into one Request Publish pack (skill + connector + prompts) and add a second unrelated real pack.
6. **Further real packs and the Request Publish dependency.** The skill text for schedule publish and permissions is not published (`/docs/ew/administering/schedule-publish-skill` and `permissions-skill` return `404`); can you obtain it from the AEM team (and the connector's source repo, which is not public) so more packs can ship? Is Request Publish onboarding available to you for manual step M6?
7. **IP and redistribution (R1).** May the `request-publish` `SKILL.md` text (Adobe documentation) be copied into a registry in a personal repo, and do the Adobe outside-activity/IP policy flags from #1 cover running this worker and registry under a personal name?
8. **Config concurrency (R3).** Is there a DA-team answer on `If-Match`/ETag or a patch API for config? Without one, simultaneous Skills Editor saves can lose data; is the documented re-read-and-verify mitigation acceptable?
9. **Worker template with no secrets.** Does #2's template accept a worker whose `secrets.required` is empty and whose handlers make no outbound calls (its `proxy`/retry unused)? Any template checks that assume a secret?
10. **`PUT` for `.da/skills/*.md`.** Upstream's editor uses `PUT` (the public source docs show `POST`); do you know whether `PUT` is a supported contract (R12)?
11. **Format drift protection (R10).** Include the non-blocking scheduled `oracle-drift` job that runs our conformance tests against upstream `main`?
12. **Shared fake DA Admin.** #36 and #19 already propose `test/support/fake-da-admin.js`; this ticket needs config endpoints and a concurrency hook added to it. Whoever lands first owns the file; should Main sequence that, or may each ticket keep a local fake?
13. **Which MCP hosts may a pack register (R6)?** v1 lint allowlist = Adobe-owned hosts only (`*.adobeaem.workers.dev`, `*.adobe.io`...)? Third-party MCP hosts in a pack need an explicit owner approval policy.
14. **Registry freshness (R9).** Should a scheduled job diff the registry copy of each skill against its documentation source page and open an issue on change? And who owns bumping versions when Adobe edits the docs?
15. **Install defaults.** Skills install as `approved` (so they work immediately, per the docs' own "make sure the status is not left as draft"); do you want an optional "install as draft for review" toggle in v1?
16. **Naming of the ledger sheet** (`pack-installs`) and whether first-party tooling may later claim a conflicting name; acceptable to namespace it (for example `x-pack-installs`)?
