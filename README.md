# ew-extensions

Experience Workspace (EW) extensions, each in its own self-contained folder. The repo is an
[AEM Edge Delivery Services](https://www.aem.live) code site: static HTML + browser-native ES modules (no build step),
served from `https://{ref}--ew-extensions--jazhou-adobe.aem.live`, iframed by EW and wired to it through the
[DA App SDK](https://www.aem.live/docs/ew/developing/apps-plugins). Modelled on
[adobe-rnd/ew-extensions](https://github.com/adobe-rnd/ew-extensions) (same lint rules, so extensions can be upstreamed).

## Folder convention

**Every extension lives in its own folder `apps/<name>/`**, whether it is a fullscreen app or a library plugin. There is
no `plugins/` folder: the extension *type* is not encoded in the path, it comes from where the extension is registered
in the EW config (a row in the `apps` sheet = fullscreen app; a row in the `library` tab = library plugin; an extension
may be both, with two entry pages).

```
apps/<name>/
├── <name>.html          entry page (named after the folder): SDK <script type=module> + extension script
├── <name>.js            thin bootstrap: awaits the SDK, calls the render module
├── <name>-render.js     side-effect-free render/logic module (the unit-test seam)
├── <name>.css
├── README.md            what it does, registration row(s), local dev, auth
├── test/unit/*.test.js  WTR unit tests
├── test/e2e/*.spec.js   Playwright e2e tests (stubbed SDK)
├── worker/              per-extension backend: an Adobe App Builder app root (see Worker below)
└── providers/<vendor>/  (vendor follow-up tickets) vendor-specific code, not an extension of its own
shared/worker-template/  reusable App Builder worker template (core, scaffold, test kit); not an extension
test/support/            shared test harness: SDK stub (sdk-stub.js), e2e helper (e2e.js)
scripts/                 conventions check, static dev/e2e server
```

Rules:

- No imports between extension folders. Shared code is test support only (`test/support/`).
- The entry page is named after the folder, so the EW app URL tail is predictable.
- Always `import DA_SDK from 'https://da.live/nx/utils/sdk.js'` and await it; also include it as a `<script type="module">`
  in the entry HTML. Do not use the bare `DA_SDK` global from the docs example (the SDK does not assign one).
- Render context values as text, never HTML. Never render or log the IMS token.
- `.hlxignore` keeps tests, workers, configs and `SPEC.md` files off the public code bus.
- Folders containing only a `SPEC.md` are planned extensions: the conventions check ignores them until code is added.
  `npm run check` enforces the rest (entry page, README, tests, table row, registration row).

## Adding an extension

1. Copy `apps/hello-world/` (app) or `apps/hello-plugin/` (library plugin) to `apps/<name>/` and rename the files
   (`<name>.html`, `<name>.js`, `<name>-render.js`, `<name>.css`, tests); fix the paths inside the entry page.
2. Write the tests first (unit for the render module, e2e for the entry page with `stubSdk`).
3. Write the extension README with its registration row heading(s): `` ### `apps` sheet row `` and/or
   `` ### `library` sheet row `` (the type must match, see the hello READMEs).
4. Append one row to the [extensions table](#extensions) (name, folder, entry point, type, description).
5. `npm run lint && npm run check && npm test && npm run test:e2e`.
6. Push a branch (simple name, no `/`), open a PR, and test it in EW with `?ref=<branch>`.

## Extensions

| Name | Folder | Entry point | Type | Description |
| --- | --- | --- | --- | --- |
| Hello world | `apps/hello-world/` | `apps/hello-world/hello-world.html` | app | Fullscreen hello app that renders the SDK `context`. |
| Hello plugin | `apps/hello-plugin/` | `apps/hello-plugin/hello-plugin.html` | library plugin | Library plugin with buttons that insert text and close the library. |

`type` is one of `app`, `library plugin`, `app + library plugin`.

## Local development

Requires Node >= 22 and Chrome.

```sh
npm ci
npm start        # aem up on http://localhost:3000 (EW's ref=local is hard-coded to port 3000)
npm run serve    # fallback: plain static server on port 3000 (what e2e uses)
npm run lint     # ESLint 8 (helix config) + Stylelint 16
npm run check    # conventions check
npm test         # unit tests (WTR + Playwright Chromium) and conventions-check tests
npm run test:worker  # worker template + every apps/*/worker (node:test, no login, no network)
npm run test:e2e # Playwright e2e on port 3100 (E2E_PORT), Chromium, hermetic (stubbed SDK); test:e2e:all adds Firefox/WebKit
```

First `npx playwright install chromium`. A husky pre-commit hook runs lint-staged (ESLint/Stylelint on staged files).

### Open an extension in EW

- Standalone: `http://localhost:3000/apps/hello-world/hello-world.html` shows "not running inside Experience Workspace".
- App, `ref=local`: `https://da.live/app/jazhou-adobe/ew-extensions/apps/hello-world/hello-world?ref=local` (the
  `da.live/app/{org}/{repo}` path names the *code* repo, not the content site)
- App, branch: same URL with `?ref=<branch>` (use branch names without `/`; push first and wait for Code Sync).
- Library plugin: open a document in the EW editor with `?ref=local` (or `?ref=<branch>`), open the library, pick the plugin.
  It needs a row in the site's `library` config tab.
- `ref=local` iframes plain `http://localhost:3000` from `https://da.live`; use Chrome (Safari/Brave may block it as mixed content).
- The EW shell posts the init message about 750 ms after the iframe loads, so a brief "waiting" state is normal.

### Trust prompt

The first time an app from an org that is not on EW's trusted list is opened for a given `org/repo/ref`, EW shows a
warning dialog ("Make sure you trust the host ..."), stored in `localStorage.trustedApps`; dev branches add a "development
version" note. Apps act with the signed-in user's rights, so only accept it for code you trust.

### Registering extensions

The DA test site is `https://da.live/#/jazhou-adobe/ew-extensions-demo` (code repo `jazhou-adobe/ew-extensions-demo`).
Extension code stays in this repo, so the demo site's config rows use **absolute** URLs on this repo's code site
(`https://main--ew-extensions--jazhou-adobe.aem.live/...`); a path starting with `/` would resolve against the demo
site's own code. Edit `https://da.live/config#/jazhou-adobe/ew-extensions-demo/` (requires config permission):

- `apps` sheet (columns `title`, `description`, `image`, `path`, `ref`) for fullscreen apps. The card shows at
  `https://da.live/apps#/jazhou-adobe/ew-extensions-demo`.
- `library` tab (columns `title`, `path`, `format`, `ref`, `icon`, `experience`) for library plugins; `path` is the
  absolute entry page URL. Avoid the reserved titles `blocks`, `templates`, `icons`, `placeholders`, `aem-assets*`.
- [ASSUMPTION] an absolute library `path` is not rewritten to `localhost:3000` by `?ref=local`; for local plugin work,
  add a second row pointing at `http://localhost:3000/...` or test on a branch.

The exact rows are in each extension's README.

## Hosting prerequisites (owner actions)

Install the [AEM Code Sync](https://www.aem.live/docs/ew/developing/micro-frontends/1-create-your-project) GitHub app on
this repo and register the site in the Configuration Service. Until then
`https://main--ew-extensions--jazhou-adobe.aem.live/...` returns 404. The DA test site `jazhou-adobe/ew-extensions-demo`
already exists.

## Worker (backend) for extensions that hold secrets

Extensions that need a vendor credential, a CORS bypass or server-side token exchange get a backend in `apps/<name>/worker/`:
one Adobe App Builder (I/O Runtime) raw web action built from [`shared/worker-template/`](shared/worker-template/README.md)
(`node shared/worker-template/scripts/new-worker.mjs <name>` creates it). The template validates the caller's IMS token before
anything else, allows only `https://da.live` and this code site's origins, keeps secrets in an untracked `.env` /
platform-encrypted action inputs, and ships a retrying outbound proxy and a test kit. The worker folder is itself an App Builder
app root (`app.config.yaml`, `package.json`, untracked `.env`/`.aio`). `aio` is a global CLI (11.x), run as `env -u CI aio ...`;
deploys are manual (`aio app deploy` from the worker folder). `apps/hello-world/worker/` is the reference worker. `npm run check`
enforces the worker rules (no tracked `.env`/`.aio`, secrets as `$NAME` references, annotations, folder-name = package name).

## Policy notes (open items)

- **Outside-activity / IP policy: unresolved.** This repo lives under a personal GitHub account (`jazhou-adobe`) and builds on
  Adobe's ecosystem. Check Adobe's outside-activity / IP policy (and get approval if needed) before publishing under a
  personal name, making the repo public, or monetising. This README makes no legal claim.
- **Marketplace / monetisation: nothing found.** No public third-party EW marketplace submission or monetisation process was
  found in the aem.live docs or upstream repo (upstream's "marketplace" concerns an in-extension skills/MCP catalogue).
  Confirm with the EW team.

## Licence

Apache-2.0 (see [LICENSE](LICENSE)), matching upstream; copied lint/tooling configs follow upstream's conventions.
