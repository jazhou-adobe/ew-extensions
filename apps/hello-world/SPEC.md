# Spec: Repo scaffold: per-extension folders, tooling, hello app + plugin

Ticket: jazhou-adobe/ew-extensions#1 (this spec: #39). Related: #2 (shared worker template), which #1 blocks.
Status: spec and build analysis only, no implementation. Research date: 2026-11-16.
Executor note: written to this file instead of being published to the tracker; proposed test seams are recorded below instead of asked.

Source-confidence legend used throughout: **[VERIFIED]** = read in a primary source (URL given); **[ASSUMPTION]** = inferred, not confirmed; **[OPEN]** = needs an owner decision or an Adobe answer.

---

## Problem Statement

The maintainer wants to build many Experience Workspace (EW) extensions (18 ideas, 19 tickets already blocked on this one). Today the repo is empty: no folder convention, no tooling, no CI, no local-dev loop, and no proof that code in this repo can actually be loaded into EW. If every extension ticket had to invent its own layout, linting, test setup and EW wiring, they would diverge, collide on shared files, and each would re-discover the same EW loading quirks (SDK handshake, `ref=local`, config-sheet rows, trust prompt).

The maintainer needs one prefactor that fixes the conventions and proves the whole path end to end, so every later ticket only adds its own folder.

## Solution

Set this repo up like upstream `adobe-rnd/ew-extensions`: a Node/ESM repo served as an AEM Edge Delivery Services (EDS) code site, where every extension is a self-contained folder with its own entry HTML page, JS, CSS, README and tests. Ship two deliberately small but real extensions that exercise both EW surfaces through the DA App SDK:

- a **hello app** (fullscreen) that opens at `https://da.live/app/{org}/{site}/...` and renders whatever `context` EW hands it;
- a **hello library plugin** that appears in the editor library and has buttons that insert text (`actions.sendText`) and close the library (`actions.closeLibrary`).

Around them: ESLint + Stylelint, a unit-test runner, hermetic Playwright e2e with a stubbed SDK, CI on every push and PR, husky pre-commit hooks, and a README that documents the folder convention, an "adding an extension" checklist, an extensions table later tickets append to, and the open policy items (Adobe outside-activity/IP policy; no public marketplace submission process found).

## User Stories

Extension author (the maintainer or an agent working a later ticket):

1. As an extension author, I want a documented folder convention, so that I know exactly where an app, a library plugin, its tests and (later) its worker go without asking.
2. As an extension author, I want an "adding an extension" checklist in the README, so that a new extension ticket is mechanical: copy, rename, register, verify.
3. As an extension author, I want each extension folder to be self-contained (entry page, JS, CSS, README, tests), so that I can work on one extension without touching another's files and conflicts between parallel tickets are minimal.
4. As an extension author, I want an extensions table in the README (name, folder, entry point, type, description), so that I can see what exists and append one row for mine.
5. As an extension author, I want a hello app to copy, so that I have a known-good fullscreen starting point that already imports the DA App SDK correctly.
6. As an extension author, I want a hello library plugin to copy, so that I have a known-good plugin starting point that already uses `sendText` and `closeLibrary`.
7. As an extension author, I want one command to run the dev server on the port EW expects for `ref=local`, so that I never debug "why does EW show a blank frame".
8. As an extension author, I want written steps for opening my extension in EW with `ref=local`, so that I can iterate on real EW without deploying.
9. As an extension author, I want written steps for opening my extension in EW with a branch ref, so that reviewers can try my branch before merge.
10. As an extension author, I want to run my extension standalone in a browser tab with a clear "not inside EW" message, so that I can do pure-UI work without EW.
11. As an extension author, I want a ready-made SDK stub for unit and e2e tests, so that I never write my own fake `DA_SDK` or need an IMS login in tests.
12. As an extension author, I want `npm run lint`, `npm test` and `npm run test:e2e` to exist and to pass on a fresh clone, so that I can verify my change before pushing.
13. As an extension author, I want pre-commit linting of staged files, so that style errors never reach CI.
14. As an extension author, I want the extension's README to explain how to register it (apps sheet row or library sheet row), so that enabling it in a site is copy-paste.
15. As an extension author, I want to know where a per-extension backend worker will live (inside my folder), so that I can plan for ticket #2 without a later restructuring.

Maintainer / reviewer:

16. As the maintainer, I want CI to run lint and tests on every push and every PR, so that a broken extension cannot merge unnoticed.
17. As the maintainer, I want the e2e tier to run in CI without credentials, so that regressions in how an extension uses the SDK are caught automatically.
18. As the maintainer, I want the README to state the open policy items (Adobe outside-activity/IP check; no public marketplace/monetisation process found), so that I do not publish under a personal name by accident.
19. As a reviewer, I want a PR template that asks for the issue number and the branch-ref EW test URL, so that I can verify a branch in EW in one click.
20. As the maintainer, I want unrelated extension folders to never import from each other, so that one extension can be moved to upstream or deleted without breakage.

EW end user (author inside Experience Workspace):

21. As a content author, I want to open the hello app from the Apps page or a direct URL and see the context EW supplied, so that I can tell the integration works.
22. As a content author, I want the hello plugin to appear in the editor library, so that I can use it while editing a document.
23. As a content author, I want a button in the plugin that inserts text at my cursor, so that the plugin visibly changes my document.
24. As a content author, I want a button that inserts text and closes the library palette, so that I can continue editing without a manual close.
25. As a content author opening an app from a new repo, I want the standard EW trust prompt to be explained in the README, so that I am not surprised by the warning dialog.
26. As a security-conscious maintainer, I want the hello extensions never to render or log the IMS token and to render context values as text (not HTML), so that the template everyone copies is safe by default.

## Implementation Decisions

Repo-level decisions (paths appear in the Build Analysis; this section stays at the decision level):

1. **Hosting model.** The repo is an EDS code site on the default `main` branch; every extension is a static page + ES modules served from `{ref}--{site}--{org}.aem.live` and iframed by EW. No build step; browser-native ES modules only (mirrors upstream). [VERIFIED upstream has no bundler: package.json scripts are lint/test only.]
2. **Folder convention (decided by owner).** EVERY extension lives in its own folder `apps/<name>/`, whether it is a fullscreen app or a library plugin; there is no `plugins/` folder. The extension type (app vs library plugin) is not encoded in the path: it comes from where the extension is registered in the EW config (a row in the `apps` sheet = fullscreen app; a row in the `library` tab = library plugin). An extension may be registered in both with two entry pages. The extensions table `type` column mirrors the config sheet (`app`, `library plugin`, or `app + library plugin`). The folder is the unit of ownership: entry page, JS, CSS, README, unit tests and e2e tests live inside it. A per-extension worker lives in a `worker/` subfolder (ticket #2 AC4). Extensions that support several vendors/providers (the vendor follow-up tickets: DAM pickers, translation connectors, marketing sync, etc.) add one subfolder per vendor at `apps/<extension>/providers/<vendor>/`, so a vendor ticket only adds a folder inside the shared extension. The hello app is `apps/hello-world/` and the hello plugin is its own extension, `apps/hello-plugin/`.
3. **Naming.** Folder name = kebab-case extension name = ticket `ext:*` label slug where one exists; the entry page is named after the folder, so the EW app URL tail is predictable.
4. **Shared code is not an extension.** Test harness support (SDK stub, page helpers) and configs sit at repo root; extensions never import from other extensions. The shared worker template (ticket #2) lives at `shared/worker-template/`, outside the extension folders, and is copied or imported into each extension's `worker/`.
5. **SDK access.** Always `import DA_SDK from 'https://da.live/nx/utils/sdk.js'` and `await` it; also include the SDK `<script type="module">` tag in the entry HTML so the postMessage listener registers as early as possible, as the official docs recommend. Do not use the bare `DA_SDK` global shown in the docs' app example (see Further Notes).
6. **Two small, separable modules per extension:** a side-effect-free render/logic module exported for tests, and a thin bootstrap that wires the awaited SDK into it. This is the unit-test seam.
7. **Hello app behaviour.** Awaits the SDK; renders every key/value of `context` generically as text (no hard-coded key list); shows a boolean "token present" indicator but never the token; shows a clear "waiting for Experience Workspace" then "not running inside Experience Workspace" state if the SDK never resolves (standalone tab).
8. **Hello plugin behaviour.** Awaits the SDK; shows a short context summary; offers two buttons: insert text (`actions.sendText`) and insert text then close (`actions.sendText` followed by `actions.closeLibrary`). Same standalone-state behaviour as the app.
9. **Tooling mirrors upstream, pinned (decided by owner):** ESLint 8 + `@adobe/eslint-config-helix` 2.x (legacy `.eslintrc.cjs`), Stylelint 16 + standard config, WTR 0.20, Playwright 1.x, husky 9 + lint-staged, Node >= 22, so extensions can later be upstreamed with identical rules. ESLint 9 / flat config is not used (see Out of Scope).
10. **CI.** One workflow, triggered on `push` and `pull_request`, no path filter that could skip a PR; jobs: lint, unit tests, e2e (Chromium only, stub tier). Upstream's workflow has no `pull_request` trigger and a path filter, so it cannot be copied verbatim.
11. **Do not serve repo plumbing.** An ignore file for the EDS code bus keeps tests, tooling configs and worker sources out of the public site. [ASSUMPTION: `.hlxignore` semantics as documented at https://www.aem.live/developer/anatomy-of-a-project.]
12. **README is the contract**: folder convention, adding-an-extension checklist, extensions table, local-dev loop (`ref=local` and branch ref), config-sheet registration rows, trust prompt note, policy notes.
13. **No secrets in #1.** The hello extensions need no backend, vendor credentials or tokens beyond what the SDK hands the page. (Ticket #2 owns the worker, IMS-token validation and CORS.)

## Testing Decisions

**What makes a good test here:** assert external behaviour only: what appears in the DOM given an SDK result, and which SDK actions are invoked when the user clicks. Never assert on internal helper names, DOM structure beyond accessible roles/text, or CSS classes. Tests must not need network, IMS, or EW.

**Proposed seams** (recorded here instead of asked, per ticket #39). The single boundary that matters is the **DA App SDK module** (`https://da.live/nx/utils/sdk.js`), whose default export is a promise resolving to `{ context, token, actions, ... }`.

| # | Seam | Used by | How it is stubbed |
|---|------|---------|-------------------|
| S1 (primary, highest) | Entry HTML page + SDK module boundary | Playwright e2e | `page.route()` intercepts the SDK URL and serves a stub module; an init script supplies the context and records every action call |
| S2 | Render/logic module + SDK result object | WTR unit tests | Import-map scope remaps the SDK URL to a fixture (prior art below), or the render function is called with a hand-built SDK result |
| S3 | Repo convention (folders, README table) | CI lint job | Node script that reads the filesystem and README |

Existing seams preferred over new ones: S1 and S2 reuse upstream's patterns (e2e `stubDaApi` route interception; unit-test import-map SDK fixture). S3 is the only new seam and is justified by AC1/AC5 being otherwise unverifiable by machine. The real EW boundary is covered only by manual verification (needs an interactive Adobe IMS login; cannot run in CI).

**Modules tested:** hello-app render + bootstrap; hello-plugin render + bootstrap; the shared SDK stub itself (contract test that it has the same shape as the real SDK result); the convention-check script.

**Prior art (upstream adobe-rnd/ew-extensions):**
- Unit: `test/unit/block-editor/fixtures/utils/sdk.js` + import-map scope in `web-test-runner.config.mjs` remap `https://da.live/nx/utils/sdk.js` to a fixture; `test/unit/brand-visibility/session-auth.test.js` injects `fetchImpl`/`storage`/`now` as the seam.
- E2E: `test/e2e/utils/da-api-stubs.js` (`stubDaApi`) stubs all network before `page.goto()`; `test/e2e/README.md` defines Tier 1 (stub-only, CI) vs Tier 2 (real session, local).

## Out of Scope

- The shared backend worker template and anything Cloudflare (ticket #2); only the reserved `worker/` folder name and CORS/IMS notes are mentioned.
- Any real extension (Brand Visibility, Skills Editor, pickers, connectors, etc.).
- Marketplace publishing, monetisation, or the Adobe IP/outside-activity decision itself (README only flags them).
- ESLint 9 / flat-config migration, TypeScript, bundlers, Lit/web-component frameworks (hello extensions are vanilla DOM).
- Full cross-browser e2e (Firefox/WebKit) and Tier-2 real-session e2e in CI.
- Running da.live / da-nx locally (the upstream three-server setup); #1 targets production `da.live` with `ref=local`.
- Visual design, theming against the EW design system, accessibility audit beyond basic semantics.
- Repo license choice and CLA (flagged as open question).

## Further Notes

- The official docs' app example uses a bare `DA_SDK` global, but the SDK source exports only a default and does not assign a global (observed 2026-11-16 in https://da.live/nx/utils/sdk.js). The plugin example imports it. This spec standardises on the import. Mark as [VERIFIED by source reading; docs may lag].
- The `SPEC.md` in `apps/hello-world/` is a planning artefact; when the hello app is built, decide whether to keep it (README in the folder links to it) or delete it. [OPEN, low stakes]

---

# Build Analysis

## 1. Architecture and responsibilities

```
Experience Workspace (da.live, prod IMS)          This repo (EDS code site)
 ├─ /app/{org}/{site}/{path}  (shell)  --iframe-->  https://{ref}--{site}--{org}.aem.live/{path}.html
 ├─ editor library (canvas)     --iframe-->         https://{ref}--{site}--{org}.aem.live{plugin path}
 └─ postMessage handshake: parent -> {ready, token, context, capabilities, MessagePort} ; iframe -> actions over the port
```

- **Browser extension code (this repo, #1):** static HTML + ES modules, no backend. Responsibility: import the SDK, render UI from `context`, call `actions.*`.
- **Worker (ticket #2, not in #1):** holds secrets, validates the IMS token, proxies vendors. Lives in `<extension>/worker/`. #1 only reserves the convention and keeps CORS/auth notes in the README.
- **EW (host):** loads the page into an iframe and posts the init message; ref/branch selection, trust prompt, config-sheet lookup.

## 2. How EW loads an extension (verified against primary sources)

### 2.1 The App SDK contract

Primary sources: https://www.aem.live/docs/ew/developing/apps-plugins (docs), https://da.live/nx/utils/sdk.js (source, read 2026-11-16).

- [VERIFIED] SDK is built on `postMessage`; importing it in the HTML is recommended so the page is ready for messages.
- [VERIFIED, source] `DA_SDK` is a promise that resolves **only** after the parent sends a message that has `ready: true` **and** a transferred `MessagePort`; stray messages are ignored. It resolves to `{ ...e.data, actions }`, i.e. `ready`, `token`, `context` (and for the shell: `email`; for the library: `project`, `capabilities`) plus `actions`.
- [VERIFIED, source] `actions` contains `sendText(text)`, `sendHTML(html, opts)`, `setHref`, `setHash`, `closeLibrary()`, `setPrompt`, `showPanel`, `daFetch`, `setTitle` is called automatically with `document.title` on init, plus capability-gated extras (`getSelection`, `saveDocument`, `subscribeLiveDocument`, `makeDraggable`, ...). `sendText` and `closeLibrary` are fire-and-forget `postMessage` calls: no return value, no error signal.
- [VERIFIED, source] If the page is opened outside EW, the promise never resolves (no timeout in the SDK). The hello extensions must therefore time out their own "waiting" UI.
- [VERIFIED, source] The parent posts the init message ~750 ms after the iframe `load` event (`setTimeout(..., 750)` in both the shell and the library channel), so a visible "waiting" state is normal, not a bug.
- Docs list for plugins: `actions.sendText`, `actions.sendHTML`, `actions.closeLibrary` (https://www.aem.live/docs/ew/developing/apps-plugins).

### 2.2 Context payloads (not documented as a contract; observed in source)

- App shell (https://github.com/adobe/da-nx/blob/main/nx/blocks/shell/shell.js): `context = { view: 'fullscreen', org, repo, ref, path, search, hash, daOrigin, imsOrigin }`, plus top-level `token` and `email`.
- Library plugin (https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/iframe-protocol.js): `context` (also exposed as `project`) = `{ org, repo, site, ref, path, view, hash, branch }`; capabilities `{ liveDocument, sendHTMLReplace, chatTurnCompleted, dragDrop }`.
- Consequence: the shapes differ between surfaces and may change without notice, so the hello extensions render `context` **generically** (iterate keys) and tests use arbitrary key sets. [ASSUMPTION: no versioned contract exists; confirm with the EW team.]

### 2.3 URL mapping (app)

Source: shell.js above.
- App URL: `https://da.live/app/{org}/{site}/{path}`; `org`/`site`/`path` are read from path segments; `ref` from `?ref=` (default `main`).
- Iframe URL: `ref=local` -> `http://localhost:3000/{path}.html{search}{hash}`; otherwise `https://{ref}--{site}--{org}.aem.live/{path}.html{search}{hash}` (or the authenticated `preview.da.live` proxy when the preview login handshake succeeds; falls back to `aem.live`).
- Hence an entry page at `apps/hello-world/hello-world.html` is opened at `https://da.live/app/jazhou-adobe/ew-extensions/apps/hello-world/hello-world`. The docs confirm EW "obfuscates" the `.html` (https://www.aem.live/docs/ew/developing/apps-plugins).
- `ref=local` is **hard-coded to port 3000** (also in the library path resolver in helpers.js). The dev server must run on 3000. [VERIFIED, source]
- The shell uses the raw `ref` in the hostname with no sanitisation; the library code sanitises it (`sanitizeName`). Use branch names without `/` (e.g. `scaffold-hello`) to avoid mismatches with EDS's branch-to-hostname rule. [VERIFIED in source; EDS sanitisation rule itself is ASSUMPTION]

### 2.4 Trust prompt (important for manual verification)

Source: shell.js. Apps from orgs other than the trusted list (`adobe`, plus two `org/repo` exceptions) show a modal warning ("Make sure you trust the host ...") the first time per `org/repo/ref`, stored in `localStorage.trustedApps`. A dev branch additionally shows a "development version" note. Manual steps and the README must mention it; Playwright against real EW would hit it too (another reason e2e uses stubs). [VERIFIED, source]

### 2.5 Registering extensions (config sheets)

- **Fullscreen apps:** `apps` sheet in the site config (`https://da.live/config#/{org}/{site}/`) with columns `title`, `description`, `image`, `path`, `ref`; saving puts a card at `https://da.live/apps#/{org}/{site}`. Also reachable directly at `https://da.live/app/{org}/{site}/{path}`. [VERIFIED: https://www.aem.live/docs/ew/developing/apps-plugins]. The docs' `path` examples are full `https://da.live/app/...` URLs. What the `ref` column does for apps is undocumented. [OPEN]
- **Library plugins:** a `library` tab in the site (or org) config with columns `title`, `path`, `format`, `ref`, `icon`, `experience`. [VERIFIED: https://www.aem.live/docs/ew/administering/set-up-library for the columns; behaviour below from https://github.com/adobe/da-live/blob/main/blocks/canvas/ew-panel-extensions/helpers.js]:
  - `path` starting with `/` resolves to `http://localhost:3000{path}` when the editor URL has `?ref=local`, else to `https://{branch}--{site}--{org}.aem.live{path}`; absolute URLs are used as-is.
  - The row's `ref` column filters: blank or `main` always shows; a non-main value shows only when the editor's `?ref=` equals it, or the editor is on `ref=local`.
  - `experience` defaults to `inline`; other values seen in source: `window`, `fullsize-dialog` (semantics beyond that undocumented [OPEN, not needed for hello]).
  - Site-level rows override org-level rows by title; the same title is de-duplicated.
  - Reserved library names `blocks`, `templates`, `icons`, `placeholders`, `aem-assets*` map to first-party panels; do not reuse them as plugin titles.
  - The page has to be a plugin *entry page* (full `.html` path); upstream's Brand Visibility README registers it with the `.html` URL (https://github.com/adobe-rnd/ew-extensions/blob/main/tools/brand-visibility/README.md).
- Both sheet types are edited via https://da.live/config#/{org}/{site}/ and require config permission (https://www.aem.live/docs/ew/administering/configs).

### 2.6 Serving from EDS

- Code lands on the code bus through the **AEM Code Sync** GitHub app; a new repo needs the app installed and the site registered in the Configuration Service. Primary: https://www.aem.live/docs/ew/developing/micro-frontends/1-create-your-project (install steps), https://www.aem.live/docs/config-service-setup, https://www.aem.live/developer/anatomy-of-a-project (code connection, `.hlxignore`).
- Upstream has no `fstab.yaml` and no `.hlxignore` (checked via GitHub API 2026-11-16: 404 for both); config is in the Configuration Service. [VERIFIED]
- **This is a prerequisite that an agent cannot do**: the repo owner must install Code Sync on `jazhou-adobe/ew-extensions` and register the site, otherwise `https://main--ew-extensions--jazhou-adobe.aem.live/...` will 404 and no branch-ref verification is possible. [OPEN: owner action; also confirm DA org/site names equal the GitHub owner/repo, otherwise repoless mapping is needed.]

## 3. How upstream `adobe-rnd/ew-extensions` is structured (read 2026-11-16, default branch `main`)

Repo: https://github.com/adobe-rnd/ew-extensions (Apache-2.0, "A repo to host Experience Workspace ecosystem extensions and apps").

| Concern | Upstream | Observation / decision for this repo |
|---|---|---|
| Layout | `blocks/skills/` (Skills Editor), `tools/brand-visibility/`, `tools/block-editor/`, `tools/ew-setup/`; entry page named after folder (e.g. `tools/brand-visibility/brand-visibility.html`) | README claims `apps/{ext}/` + `tools/{ext}.html` and lists `apps/skills/`, but the actual tree has no `apps/` dir: upstream docs lag mid-migration. We adopt a single `apps/<name>/` for every extension (apps and library plugins alike) per ticket #39 and the owner decision, and keep the "entry page named after folder" habit. [VERIFIED discrepancy] |
| Per-extension README | `tools/brand-visibility/README.md` (setup, registration row, auth, usage) | Adopt: README per extension with registration row |
| Tests | Root `test/unit/**`, `test/e2e/**`, `test/mocks/` | #1 AC1 wants tests inside the extension folder; keep a small shared harness at root |
| Unit runner | `@web/test-runner` + `@esm-bundle/chai` + puppeteer launcher + import maps (`web-test-runner.config.mjs`), blocks external fetches in tests ("external fetch disallowed" shim) | Adopt incl. the fetch guard |
| E2E | Playwright (`playwright.config.cjs`): chromium/firefox/webkit, `retries: 2` + `workers: 1` + `github` reporter in CI, `trace: on-first-retry`; `test/e2e/utils/env.js` derives base URL (`E2E_BASE_URL`, `GITHUB_HEAD_REF=local`, or `{branch}--{repo}--{owner}.aem.live`) | Adopt config; base URL is a local server for CI (hermetic) |
| E2E tiers | Tier 1 stub-only (CI), Tier 2 needs real IMS (`DA_AUTH_OK=1`, local) per `test/e2e/README.md` | Adopt tier idea; #1 ships Tier 1 only. Upstream README says CI runs Tier 1 but `main.yaml` has no e2e job: inconsistency [VERIFIED] |
| Lint | `.eslintrc.cjs` (extends `@adobe/helix`; relaxed rules e.g. `import/extensions: always`, `no-unused-vars` warn with `_` prefix, `max-len` 120 warn), `.eslintignore` (`node_modules/`, `test/`), `.stylelintrc.json` (`stylelint-config-standard` + 3 rules off), `.editorconfig` (2 spaces, single quotes, LF) | Adopt verbatim; note upstream ignores `test/` for ESLint — we should lint tests with the same config but allow chai/mocha globals [OPEN small] |
| Hooks | husky 9 `prepare: husky`; `.husky/pre-commit` = `npx lint-staged`; `lint-staged`: `*.js eslint --fix`, `*.css stylelint --fix` | Adopt |
| CI | `.github/workflows/main.yaml` "Build": triggers on `push` with `paths` filter (`blocks/**`, `test/unit/**`, wtr config, workflow); jobs `lint` and `unit tests`, Node 22, `npm install`; `vibe.yaml` updates a "vibe coded" badge after Build on main | Adopt Node 22 and job split; add `pull_request`, drop the path filter, use `npm ci`, add e2e job; vibe badge is out of scope |
| PR template | Asks for issue and before/after `aem.live` URLs | Adopt (branch-ref URLs are the review mechanism) |
| CSP / head | `head.html` sets a CSP meta for content pages | Not needed for extension entry pages [ASSUMPTION; extension pages load SDK from da.live as in upstream samples] |
| Local dev | Three servers (da-live :3000, da-nx :6456, ew-extensions :3001) using `?nx=local&nxver=2` | Too heavy for #1: we use prod `da.live` + `ref=local` -> one server on :3000 |
| Versions | eslint ^8.57, `@adobe/eslint-config-helix` ^2.0.8, stylelint ^16.20, stylelint-config-standard ^38, wtr ^0.20.2, `@web/test-runner-puppeteer` ^0.18, playwright ^1.57, husky ^9.1.7, lint-staged ^17, node >=22 | Mirror majors (decided). `npm view` today shows newer majors (stylelint 18, wtr 1.0, helix config 3.x which requires ESLint ^9 — peer-dep checked), so unpinned latest would break; pin upstream's majors. |

Other signals from upstream: README links to the older doc path `https://docs.da.live/developers/guides/developing-apps-and-plugins`, which now 301-redirects to https://www.aem.live/docs/ew/developing/apps-plugins (checked with `curl -I`). Upstream also has marketplace-related PRs (e.g. #79, #80, #83) but these concern an in-extension "Marketplace tab" for skills/MCP plugins and an extension "for marketplace"; they do not describe a public submission process. [VERIFIED PR titles/body; interpretation ASSUMPTION]

## 4. Proposed folder convention

```
/                         repo root: tooling only (package.json, eslint/stylelint, wtr + playwright configs, .husky, .hlxignore, README.md, CI)
├─ apps/<name>/           ONE folder per extension: fullscreen app or library plugin (type comes from its EW config-sheet row)
│   ├─ <name>.html        entry page: SDK <script type=module> + extension script
│   ├─ <name>.js          bootstrap (awaits SDK, calls render)       } thin / testable split
│   ├─ <name>-render.js   side-effect-free render + logic            } (naming is the implementer's call)
│   ├─ <name>.css
│   ├─ README.md          what it does, registration row(s), local dev, auth
│   ├─ test/unit/*.test.js, test/e2e/*.spec.js
│   ├─ worker/            (ticket #2) per-extension worker; not created in #1
│   └─ providers/<vendor>/  (vendor follow-up tickets) one subfolder per vendor, added by the vendor ticket
├─ shared/worker-template/  (ticket #2) reusable worker template; not an extension, not created in #1
├─ test/support/          shared harness: SDK stub module, page/env helpers, fetch-guard shim
└─ scripts/               repo conventions checks (S3)
```

Rules: no cross-extension imports; entry page named after folder; extension type is declared by the config-sheet row documented in the extension's README, never by its path; vendor-specific code goes under `apps/<extension>/providers/<vendor>/`; the `.hlxignore` hides `**/test/`, `**/worker/`, `shared/worker-template/`, `scripts/`, `test/`, tool configs, `node_modules`; the README of each extension documents its registration row.

Hello extensions (two separate extensions): `apps/hello-world/` registered in the `apps` sheet (fullscreen app) and `apps/hello-plugin/` registered in the `library` tab (library plugin). The EW URLs are `.../app/{org}/{site}/apps/hello-world/hello-world` for the app; the plugin's library row path is `/apps/hello-plugin/hello-plugin.html`.

Alternatives considered: (a) a separate `plugins/` folder — rejected by the owner because type is already declared by the config sheet and one convention is simpler for the checker, README table and CI; (b) upstream's literal `tools/` + `blocks/` — `blocks/` collides with EDS block terminology and `tools/` is not self-describing; (c) tests at root like upstream — contradicts #1 AC1.

## 5. Local-dev loop

1. `npm install` (also installs husky hooks via `prepare`).
2. `aem up --no-open` (AEM CLI, `npm i -g @adobe/aem-cli`; default port **3000**, which `ref=local` requires). Provide `npm start`. Source: https://www.aem.live/developer/cli-reference. [VERIFIED flags]
3. Standalone sanity check: `http://localhost:3000/apps/hello-world/hello-world.html` shows the "not inside EW" state.
4. In real EW (Chrome): `https://da.live/app/jazhou-adobe/ew-extensions/apps/hello-world/hello-world?ref=local`; accept the trust prompt once (per `org/repo/ref`).
5. Plugin: open any document in the EW editor with `?ref=local` on the editor URL, open the library, pick **Hello plugin** (requires the `library` row in the site config, see 2.5).
6. Branch ref: push a branch (simple name), wait for code sync, use `?ref=<branch>` on the same URLs; each such open prints the dev-branch note.
7. Unit: `npm test`; e2e: `npm run test:e2e`; lint: `npm run lint`.

Caveats: `ref=local` iframes plain `http://localhost:3000` from `https://da.live`: Chromium treats localhost as potentially trustworthy; Safari/Brave may block it as mixed content [ASSUMPTION, document "use Chrome"]. Running upstream's da-live/da-nx locally is not needed (and would conflict on port 3000). Whether `aem up` works headless without a site token or network on a fresh repo (it normally proxies content from the `.aem.page` origin) is [OPEN]; fallback is a plain static server on 3000 for the e2e job only.

## 6. External APIs, auth flows, data contracts

- **IMS token:** EW hands the user's IMS access token in `token` (shell: `IMS_DETAILS.accessToken.token`; library: `ims.accessToken.token`). `da.live` uses prod IMS (https://github.com/adobe/da-live README). #1 never uses the token except to show "present/absent". It must never be rendered, logged, or put into test snapshots.
- **Data contract between hello pages and EW:** only the SDK promise result (2.1/2.2). No network calls from the hello extensions.
- **Trust model:** the app can act with the user's rights (shell warning text); README must say so.

## 7. Risks and open questions

| # | Risk / question | Severity | Plan |
|---|---|---|---|
| R1 | **Adobe outside-activity / IP policy** — repo lives under a personal GitHub account (`jazhou-adobe`) building on Adobe's internal ecosystem. #1 AC6 requires the README to flag it. | High, blocking for any publication | [OPEN] README note only; maintainer must check policy and, if needed, get approval before publishing/making public/monetising. Spec makes no legal claim. |
| R2 | **No public marketplace submission/monetisation process found.** Searched aem.live developing/administering docs and upstream repo; only an in-extension marketplace for skills/MCP plugins (upstream PRs #79/#80/#83) exists. | Medium | README states "none found; confirm with the EW team". [OPEN: who to ask] |
| R3 | **Code Sync + site registration** needed before anything is reachable. | High, blocks AC2/AC3 manual verification | Owner action; first item of build plan. |
| R4 | **Docs vs source drift:** docs app example uses bare `DA_SDK` global; SDK source exports default only; context shapes are undocumented and differ per surface. | Medium | Import the SDK, render context generically, add a stub contract test; consider a non-blocking scheduled "SDK canary" job that fetches the live `sdk.js` and asserts `sendText`/`closeLibrary` still exist [OPEN: include?]. |
| R5 | **`ref=local` port 3000 and mixed content** | Low-Med | Document; Chrome only. |
| R6 | **Trusted-app prompt** on first open | Low | Document in README and verification steps. |
| R7 | **Public code bus exposes everything not in `.hlxignore`** (tests, worker sources) | Medium for #2 | `.hlxignore` now; secrets only in platform store (#2). |
| R8 | **Tooling version drift** (helix config 3.x needs ESLint 9) | Low | Decided: pin upstream majors (ESLint 8); migration deferred. |
| R9 | **Licence:** repo has no LICENSE; upstream is Apache-2.0 and its configs are copied. | Low-Med | [OPEN] choose a licence (Apache-2.0 recommended for compatibility), keep attribution for copied configs. |
| R10 | **DA org/site naming:** assumed `jazhou-adobe`/`ew-extensions` in both GitHub and DA. | Med | [OPEN] confirm DA org/site exist and permissions on the config sheets. |
| R11 | `apps` sheet `ref` column semantics and `experience` values beyond `inline` undocumented | Low | Leave `ref` blank for hello; document as unknown. |
| R12 | Library plugin iframe is routed through a preview proxy for non-local sources (`toPreviewProxyUrl`) — effect on unauthenticated/private sites unverified | Low | Verify during manual step M4; note result in README. [ASSUMPTION] |

## 8. Ordered build plan (sized to #1's acceptance criteria)

0. **Owner prerequisite (R3, R10):** install AEM Code Sync on the repo; register site; create the DA org/site and confirm config access; make a first commit so `main` exists. Check `https://main--ew-extensions--jazhou-adobe.aem.live/` responds for a pushed static file.
1. **Tooling skeleton** (AC4): `package.json` (scripts: `start`, `lint`, `lint:js`, `lint:css`, `test`, `test:e2e`, `check`), ESLint/Stylelint/editorconfig/gitignore, husky + lint-staged, `.hlxignore`. Green on an empty extension set.
2. **Shared harness:** SDK stub module + page-load helper + fetch guard in `test/support/`; WTR config (import map for the SDK URL; external-fetch guard); Playwright config (chromium; local static server `webServer`). First, a stub contract test.
3. **Hello app, test-first** (AC2): failing unit tests (renders context keys as text, escapes HTML, hides token, standalone state), then render + bootstrap + entry page + CSS + README with the `apps` row; then e2e.
4. **Hello plugin, test-first** (AC3): failing unit + e2e for the two buttons (sendText payload; sendText then closeLibrary order), then implementation + README with the `library` row.
5. **CI workflow** (AC4): lint, unit, e2e jobs on `push` + `pull_request`, Node 22, cached `npm ci`, Playwright Chromium install; verify with a deliberately failing throwaway branch.
6. **Convention check script (S3)** (AC1, AC5): every folder directly under `apps/` has entry page, README and tests; README table row exists for each folder and vice versa; the stated `type` is consistent with the folder's README registration row (`apps` or `library`).
7. **Root README** (AC1, AC5, AC6): folder convention (including `worker/` and `providers/<vendor>/`), "adding an extension" checklist, extensions table (rows: `hello-world` app, `hello-plugin` library plugin), local-dev loop, registration rows, trust prompt, policy notes (R1, R2).
8. **PR template** with issue + branch-ref test URLs.
9. **Manual verification in EW** (M1-M5 below), record results in the PR; update README with caveats found (R4, R12).
10. Hand-off notes for #2: reserved `worker/` convention and IMS/CORS expectations; no code.

---

# Testing Requirements

## 1. Unit tests (S2)

- **Runner decision:** `@web/test-runner` with Mocha + `@esm-bundle/chai`, real Chromium via the Puppeteer launcher, mirroring upstream (https://github.com/adobe-rnd/ew-extensions `web-test-runner.config.mjs`). Rationale: extensions are browser-native ES modules importing from `https://da.live/...`; a real browser needs no jsdom polyfills, and import maps can remap the SDK URL (proven upstream). Alternatives considered: Vitest + jsdom (needs URL-import aliasing and misses real DOM/CSS behaviour), `node:test` (no DOM). Minor open question: use `@web/test-runner-playwright` instead of puppeteer to avoid downloading two browsers, since Playwright is already a dev dependency [OPEN, low stakes].
- **Config rules:** glob covers every extension's `test/unit` dir; import map remaps `https://da.live/nx/utils/sdk.js` to the shared stub; a fetch guard fails any test that calls an external URL; CI retries 1.
- **Hello app unit cases (behaviour):**
  - given an SDK result with arbitrary `context` keys, every key and value is visible as text;
  - values containing `<img src=x onerror=...>` or `<script>` render as literal text and create no elements;
  - the token string never appears in the DOM; "token present/absent" indicator reflects its presence;
  - empty/missing `context` renders without throwing;
  - SDK promise that never resolves: waiting state, then "not running inside Experience Workspace" after the timeout (use a short injectable timeout/fake timers).
- **Hello plugin unit cases:**
  - click "insert" -> `actions.sendText` called exactly once with the displayed text; `closeLibrary` not called;
  - click "insert and close" -> `sendText` then `closeLibrary`, in that order, once each;
  - standalone state as above; `actions` missing a function does not throw at render.
- **SDK stub contract test:** the stub's resolved value has the same top-level shape as the real SDK result (`ready`, `token`, `context`, `actions.sendText/closeLibrary`) per the source read in 2.1. Guards R4 drift locally.
- **Fixtures/mocks:** a single stub-SDK factory in `test/support/` returning `{ context, token: 'stub-token', actions }` with recorded calls; reused by e2e.

## 2. Convention check (S3)

A Node script (run in the CI lint job and via `npm run check`) fails when: a folder directly under `apps/` lacks an entry page named after the folder, a README, or any test; a folder is missing from the README extensions table; a table row points to a missing folder or entry page; or a table `type` has no matching registration row documented in that extension's README. It treats `apps/<extension>/providers/<vendor>/` as sub-structure, not as an extension. It has its own happy/sad fixture tests via a temp dir. Proves AC1 (convention enforced) and AC5 (table integrity).

## 3. End-to-end tests (S1) — hermetic, Playwright

Prior art: upstream `playwright.config.cjs`, `test/e2e/utils/da-api-stubs.js`, `test/e2e/README.md` (Tier 1 stub-only, runs in CI). Differences: upstream's e2e hits the deployed site and drives the full `da.live/apps/...` shell with only DA Admin stubbed; ours serves the repo locally and stubs the SDK, so it needs no EW, no network, no credentials.

- **Server:** Playwright `webServer` runs `aem up --no-open --no-livereload --port 3000` (the dev loop under test); fallback to a plain static server if `aem up` needs network/auth in CI [OPEN, R5/5].
- **Stub mechanism:** before `page.goto()`, `page.addInitScript` seeds `window.__sdkStub = { context, token }` and a call log; `page.route('https://da.live/nx/utils/sdk.js', ...)` fulfils a JS module whose default export is a promise of `{ ready: true, token, context, actions }` where `sendText`/`closeLibrary` push to the call log; any other external request is aborted (hermetic guard).
- **Project:** Chromium only in CI; `npm run test:e2e:all` available locally (as upstream).
- **Hello app e2e:** opens entry page with stubbed context -> context keys visible; standalone (SDK route unfulfilled/never resolves) -> standalone message; no external requests other than the stubbed SDK URL; token never in page text/HTML.
- **Hello plugin e2e:** page loads in a narrow viewport (library panel width) -> both buttons visible; click insert -> call log `[['sendText', text]]`; click insert and close -> `['sendText', text]` then `['closeLibrary']`.
- **Tier 2 (not in #1):** real-session e2e against EW stays manual (below), consistent with upstream's local-only Tier 2.

## 4. CI jobs

Workflow triggers: `push` (all branches) and `pull_request`; no path filters; concurrency cancel-in-progress per ref.

| Job | Steps | Notes |
|---|---|---|
| `lint` | checkout, setup-node 22 with npm cache, `npm ci`, `npm run lint` (ESLint + Stylelint), `npm run check` (S3) | |
| `unit` | same setup, `npm test` | `--no-sandbox` Chromium args on GitHub Actions, as upstream's WTR config |
| `e2e` | same setup, `npx playwright install --with-deps chromium`, `npm run test:e2e` | stub tier only; upload `playwright-report`/traces on failure |

No secrets required. Branch protection requiring the three checks is an owner repo-setting [OPEN, not automatable by the scaffold].

## 5. Manual verification in EW (needs interactive Adobe login; cannot be automated)

Credentials/accounts: GitHub admin on `jazhou-adobe/ew-extensions` (Code Sync); an Adobe IMS identity with access to the DA org/site and permission to edit site config; Chrome. No vendor sandbox accounts, no API keys.

- **M0 (prereq):** `curl -I https://main--ew-extensions--jazhou-adobe.aem.live/apps/hello-world/hello-world.html` returns 200 after first merge/push.
- **M1 (app, `ref=local`):** run `npm start`; open `https://da.live/app/jazhou-adobe/ew-extensions/apps/hello-world/hello-world?ref=local`; accept the trust prompt; expect the context list (`view`, `org`, `repo`, `ref=local`, `path`, ...) after roughly one second; no token visible; edit CSS, reload, see the change.
- **M2 (app, branch ref):** push branch `scaffold-hello`; open the same URL with `?ref=scaffold-hello`; expect the dev-branch note in the trust prompt (first time), then identical rendering with `ref=scaffold-hello`.
- **M3 (apps card):** add the `apps` sheet row in `https://da.live/config#/jazhou-adobe/ew-extensions/`; check the card appears at `https://da.live/apps#/jazhou-adobe/ew-extensions` and opens the app.
- **M4 (plugin, local):** add the `library` sheet row (path `/apps/hello-plugin/hello-plugin.html`); open a document in the EW editor with `?ref=local`; library shows **Hello plugin**; click "insert": text appears at the cursor; click "insert and close": text inserted and the library palette closes. Repeat with a branch `?ref=` (row `ref` blank). Note whether the preview-proxy route affects loading (R12).
- **M5 (standalone):** open `http://localhost:3000/apps/hello-world/hello-world.html` directly; expect the "not inside Experience Workspace" state.
- **M6 (negative):** open the editor *without* `?ref=local` while the dev server is down and the plugin row has `ref=local`: plugin must not appear (row filter) — optional.

Record screenshots/notes in the PR description (the PR template asks for the test URLs).

## 6. Acceptance-criteria traceability (ticket #1)

| # | Acceptance criterion (#1) | Automated proof | Manual / review verification |
|---|---|---|---|
| AC1 | README documents the folder convention (one folder per extension: entry page, JS, CSS, README, tests) and an "adding an extension" checklist | S3 convention check enforces the structure on every folder under `apps/` and its fixture tests; CI `lint` job runs it | Review: README sections exist; follow the checklist once to add a throwaway `apps/x` copy of hello-world on a scratch branch and confirm the check script passes |
| AC2 | Hello app opens at `https://da.live/app/{org}/{site}/...` with `ref=local` and with a branch ref, and renders the SDK `context` | Unit: context rendering cases; e2e: hello-app page with stubbed context renders keys, standalone state, no external requests | **M1** (`ref=local`), **M2** (branch ref), **M3** (apps card), **M5** |
| AC3 | Hello plugin appears in the editor library; a button inserts text via `actions.sendText` and closes the library via `actions.closeLibrary` | Unit: button cases; e2e: call-log assertions for `sendText` payload and `closeLibrary` order | **M4** (appears in library, text lands in the document, palette closes) |
| AC4 | ESLint + Stylelint and a unit-test runner are wired; CI runs lint and tests on every push and PR | `npm run lint`, `npm test`, `npm run test:e2e` pass locally; the three CI jobs pass | Verify on GitHub: a pushed branch and an opened PR each show the three checks; a deliberately failing lint/test commit on a throwaway branch turns the check red (not merged); pre-commit hook blocks a staged lint error |
| AC5 | README has an extensions table (name, folder, entry point, type, description) that later tickets append to | S3: every extension folder has a table row and every row resolves to a real folder/entry page | Review: table has `hello-world` (app, `apps/hello-world/`) and `hello-plugin` (library plugin, `apps/hello-plugin/`) rows with all five columns |
| AC6 | README notes the open policy items: Adobe outside-activity/IP policy check before publishing under a personal name; no public third-party EW marketplace submission/monetisation process found (confirm with the EW team) | None (prose requirement); optionally a grep in the S3 script for the two headings to prevent silent deletion [OPEN: include?] | Review checklist: both items present, worded as unresolved, with who to confirm with |

Every #1 acceptance criterion maps to at least one automated test or a numbered manual verification step above.

## 7. Open questions needing the owner's input (summary)

1. **Adobe outside-activity/IP policy (R1):** has the maintainer cleared building/publishing these extensions under `jazhou-adobe`? Spec only flags it.
2. **Marketplace/monetisation (R2):** who on the EW team can confirm there is no third-party submission process?
3. **Code Sync + site registration + DA org/site names (R3, R10):** will the owner install the app and confirm `jazhou-adobe/ew-extensions` as both GitHub repo and DA org/site, and grant config-sheet access?
4. **Licence:** which licence (Apache-2.0 to match upstream)? Add CLA/CONTRIBUTING from upstream?
5. **Nice-to-haves:** include the non-blocking live-SDK canary job (R4); include a README-markers grep for AC6; branch-protection rules requiring the three CI jobs; Playwright launcher vs Puppeteer for WTR.
6. **`aem up` in CI:** needs validation on the empty repo (network/site-token behaviour); otherwise fall back to a static server for e2e.
