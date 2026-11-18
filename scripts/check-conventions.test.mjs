import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkConventions } from './check-conventions.mjs';

const TABLE = (rows) => `# Repo

## Extensions

| Name | Folder | Entry point | Type | Description |
| --- | --- | --- | --- | --- |
${rows}

## Policy

Check the Adobe outside-activity / IP policy. No public marketplace process found.
`;

const ROW = '| Foo | `apps/foo/` | `apps/foo/foo.html` | app | A foo. |';
const EXT_README = '# Foo\n\n### `apps` sheet row\n\n| title | path |\n';

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'conv-'));
  Object.entries(files).forEach(([path, content]) => {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  });
  return root;
}

const WORKER_CONFIG = `application:
  runtimeManifest:
    packages:
      foo:
        actions:
          api:
            function: actions/api/index.js
            web: raw
            runtime: nodejs:22
            inputs:
              FOO_SECRET: $FOO_SECRET
              ALLOWED_LOCAL_ORIGINS: $ALLOWED_LOCAL_ORIGINS
            annotations:
              web-custom-options: true
            limits:
              timeout: 25000
`;

const base = () => ({
  '.gitignore': 'node_modules/\n.env\n.env.*\n!.env.example\n.aio\n**/worker/dist/\n',
  '.hlxignore': '**/worker/\nshared/worker-template/\n',
});

const worker = () => ({
  'apps/foo/worker/app.config.yaml': WORKER_CONFIG,
  'apps/foo/worker/package.json': '{}',
  'apps/foo/worker/README.md': '# worker',
  'apps/foo/worker/.env.example': 'FOO_SECRET=\nALLOWED_LOCAL_ORIGINS=\n',
  'apps/foo/worker/test/api.test.js': '',
});

const good = () => ({
  ...base(),
  'README.md': TABLE(ROW),
  'apps/foo/foo.html': '<html></html>',
  'apps/foo/README.md': EXT_README,
  'apps/foo/test/unit/foo.test.js': '',
});

async function run(files) {
  const root = fixture(files);
  try {
    return checkConventions(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('happy path: no errors', async () => {
  assert.deepEqual(await run(good()), []);
});

test('planned folders containing only SPEC.md are ignored', async () => {
  assert.deepEqual(await run({ ...good(), 'apps/later/SPEC.md': '# spec', 'apps/later/providers/x/SPEC.md': '' }), []);
});

const without = (files, ...keys) => Object.fromEntries(Object.entries(files).filter(([k]) => !keys.includes(k)));
const withRow = (files, row) => ({ ...files, 'README.md': TABLE(row) });

const sad = [
  ['missing entry page', (f) => ({ ...without(f, 'apps/foo/foo.html'), 'apps/foo/other.js': '' }), /entry page/],
  ['missing README', (f) => without(f, 'apps/foo/README.md'), /README/],
  [
    'missing tests',
    (f) => ({ ...without(f, 'apps/foo/test/unit/foo.test.js'), 'apps/foo/test/.keep': '' }),
    /test/,
  ],
  ['missing table row', (f) => withRow(f, ''), /not listed/],
  [
    'row points to missing folder',
    (f) => withRow(f, `${ROW}\n| Bar | \`apps/bar/\` | \`apps/bar/bar.html\` | app | B. |`),
    /apps\/bar/,
  ],
  [
    'row points to missing entry page',
    (f) => withRow(f, '| Foo | `apps/foo/` | `apps/foo/nope.html` | app | A. |'),
    /entry/,
  ],
  ['type without registration row', (f) => ({ ...f, 'apps/foo/README.md': '# Foo\n' }), /registration/],
  ['library type needs library row', (f) => withRow(f, ROW.replace('| app |', '| library plugin |')), /library/],
  ['unknown type', (f) => withRow(f, ROW.replace('| app |', '| widget |')), /type/],
  ['policy notes removed', (f) => ({ ...f, 'README.md': TABLE(ROW).split('## Policy')[0] }), /policy/i],
];

sad.forEach(([name, mutate, pattern]) => {
  test(`sad path: ${name}`, async () => {
    const errors = await run(mutate(good()));
    assert.ok(errors.length > 0, 'expected errors');
    assert.match(errors.join('\n'), pattern);
  });
});

const withWorker = () => ({ ...good(), ...worker() });

test('worker: a complete App Builder worker passes (UR1)', async () => {
  assert.deepEqual(await run(withWorker()), []);
});

const workerSad = [
  ['missing app config', (f) => without(f, 'apps/foo/worker/app.config.yaml'), /missing app\.config\.yaml/],
  ['missing package manifest', (f) => without(f, 'apps/foo/worker/package.json'), /missing package\.json/],
  ['missing worker README', (f) => without(f, 'apps/foo/worker/README.md'), /worker: missing README/],
  ['missing .env.example', (f) => without(f, 'apps/foo/worker/.env.example'), /missing \.env\.example/],
  ['missing worker tests', (f) => without(f, 'apps/foo/worker/test/api.test.js'), /worker: missing tests/],
  ['.gitignore lacks .env', (f) => ({ ...f, '.gitignore': 'node_modules/\n.aio\ndist/\n' }), /\.gitignore: missing "\.env"/],
  ['.gitignore lacks .aio', (f) => ({ ...f, '.gitignore': '.env\n.env.*\n!.env.example\ndist/\n' }), /missing "\.aio"/],
  ['.gitignore lacks build output', (f) => ({ ...f, '.gitignore': '.env\n.env.*\n!.env.example\n.aio\n' }), /dist/],
  [
    'secret-looking input with a literal (UR3)',
    (f) => ({ ...f, 'apps/foo/worker/app.config.yaml': WORKER_CONFIG.replace('$FOO_SECRET', 'abc123') }),
    /FOO_SECRET.*\$NAME/,
  ],
  [
    'config outside apps/*/worker (UR4)',
    (f) => ({ ...f, 'apps/foo/app.config.yaml': WORKER_CONFIG }),
    /app configs are only allowed/,
  ],
  [
    '$NAME missing from .env.example (UR5)',
    (f) => ({ ...f, 'apps/foo/worker/.env.example': 'ALLOWED_LOCAL_ORIGINS=\n' }),
    /missing \$FOO_SECRET/,
  ],
  [
    'no custom-options annotation (UR6)',
    (f) => ({ ...f, 'apps/foo/worker/app.config.yaml': WORKER_CONFIG.replace('web-custom-options: true', 'x: 1') }),
    /web-custom-options/,
  ],
  [
    'not raw web mode (UR6)',
    (f) => ({ ...f, 'apps/foo/worker/app.config.yaml': WORKER_CONFIG.replace('web: raw', 'web: true') }),
    /web: raw/,
  ],
  [
    'timeout above 30s (UR6)',
    (f) => ({ ...f, 'apps/foo/worker/app.config.yaml': WORKER_CONFIG.replace('25000', '60000') }),
    /timeout/,
  ],
  [
    'package name differs from the folder (UR6)',
    (f) => ({ ...f, 'apps/foo/worker/app.config.yaml': WORKER_CONFIG.replace('      foo:', '      bar:') }),
    /must equal the extension folder name/,
  ],
  ['.hlxignore stops hiding workers (UR8)', (f) => ({ ...f, '.hlxignore': 'shared/worker-template/\n' }), /\.hlxignore: missing "\*\*\/worker\/"/],
  ['.hlxignore stops hiding the template (UR8)', (f) => ({ ...f, '.hlxignore': '**/worker/\n' }), /missing "shared\/worker-template\/"/],
];

workerSad.forEach(([name, mutate, pattern]) => {
  test(`worker sad path: ${name}`, async () => {
    const errors = await run(mutate(withWorker()));
    assert.match(errors.join('\n'), pattern);
  });
});

test('worker: the template scaffold may hold an app config', async () => {
  assert.deepEqual(await run({ ...withWorker(), 'shared/worker-template/scaffold/app.config.yaml': WORKER_CONFIG }), []);
});

test('worker: tracked .env, .env.<name> and .aio fail; .env.example and untracked ones pass (UR2)', async () => {
  const files = withWorker();
  const root = fixture({ ...files, 'apps/foo/worker/.env': 'FOO_SECRET=1', 'apps/foo/worker/.aio': '{}' });
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    git('init', '-q');
    assert.deepEqual(checkConventions(root), [], 'untracked .env/.aio are fine');
    git('add', '-f', '.');
    const errors = checkConventions(root).join('\n');
    assert.match(errors, /apps\/foo\/worker\/\.env: must not be tracked/);
    assert.match(errors, /apps\/foo\/worker\/\.aio: must not be tracked/);
    assert.ok(!/\.env\.example: must not/.test(errors));
    writeFileSync(join(root, 'apps/foo/worker/.env.stage'), 'x');
    git('add', '-f', 'apps/foo/worker/.env.stage');
    assert.match(checkConventions(root).join('\n'), /\.env\.stage: must not be tracked/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- provider-based extensions (RC1-RC7) ----

const PROVIDER_README = `# Foo

### \`apps\` sheet row

| title | path |

## Setup

Set FOO_SECRET in .env.

## Acme-side setup

Get the key from Acme.

### \`library\` sheet row

| title | path | format | ref | icon | experience |
| --- | --- | --- | --- | --- | --- |
| Foo | http://localhost:3000/apps/foo/foo.html | | local | | inline |
| Foo | https://BRANCH--ew-extensions--jazhou-adobe.aem.live/apps/foo/foo.html | | BRANCH | | inline |
| Foo | https://main--ew-extensions--jazhou-adobe.aem.live/apps/foo/foo.html | | | | inline |

## Site config read

None.

## Local development

npm start

## Deploy and rotation

aio app deploy

## Shared-credential model

Everyone sees the same assets.

## Limits

Some.

## Privacy

None kept.

## Add a provider

Checklist.
`;

const withProvider = () => ({
  ...withWorker(),
  'apps/foo/README.md': PROVIDER_README,
  'apps/foo/providers/acme/worker/index.js': 'export default {};',
  'apps/foo/providers/acme/worker/fixtures/README.md': '# fixtures',
  'apps/foo/worker/providers.js': "import acme from '../providers/acme/worker/index.js';\nexport default [acme];\n",
  'apps/foo/worker/test/conformance.test.js': "import '../../providers/acme/worker/index.js';\n",
});

test('providers: a complete provider extension passes; vendor names in allowed places are fine (RC1)', async () => {
  assert.deepEqual(await run(withProvider()), []);
  assert.deepEqual(await run({
    ...withProvider(),
    'apps/foo/worker/test/acme.test.js': "const x = 'acme';",
    'apps/foo/worker/test/fixtures/acme.json': '{"vendor":"Acme"}',
    'apps/foo/worker/package.json': '{"optionalEnv":["ACME_CLIENT_ID"]}',
  }), []);
});

test('providers: a vendor folder holding only SPEC.md is planned and ignored', async () => {
  assert.deepEqual(await run({ ...withWorker(), 'apps/foo/providers/later/SPEC.md': '' }), []);
});

const providerSad = [
  ['vendor string in browser code (RC1)', (f) => ({ ...f, 'apps/foo/foo-render.js': "const label = 'Acme';" }), /foo-render\.js: mentions the vendor "acme"/],
  ['vendor string in shell code (RC1)', (f) => ({ ...f, 'apps/foo/worker/shell/routes.js': '// acme special case' }), /shell\/routes\.js: mentions the vendor/],
  ['vendor string in the shared core (RC1)', (f) => ({ ...f, 'shared/worker-template/src/x.js': 'const acme = 1;' }), /shared\/worker-template\/src\/x\.js: the shared template must not mention/],
  ['provider without a worker module (RC2)', (f) => without(f, 'apps/foo/providers/acme/worker/index.js'), /missing worker\/index\.js/],
  ['provider without a fixtures README (RC2)', (f) => without(f, 'apps/foo/providers/acme/worker/fixtures/README.md'), /missing worker\/fixtures\/README\.md/],
  ['provider not in the registry (RC2)', (f) => ({ ...f, 'apps/foo/worker/providers.js': 'export default [];\n' }), /provider "acme" is not registered/],
  ['provider without a conformance test (RC2)', (f) => without(f, 'apps/foo/worker/test/conformance.test.js'), /no conformance test registers provider "acme"/],
  ['provider without a README section (RC2)', (f) => ({ ...f, 'apps/foo/README.md': PROVIDER_README.replace('Acme-side setup', 'Vendor-side setup') }), /missing a section for provider "acme"/],
  ['README lacks a required section (RC5)', (f) => ({ ...f, 'apps/foo/README.md': PROVIDER_README.replace('## Privacy', '## Other') }), /missing required section "privacy"/],
  ['README does not document an input (RC5)', (f) => ({ ...f, 'apps/foo/README.md': PROVIDER_README.replace('FOO_SECRET', 'it') }), /does not document the input FOO_SECRET/],
  ['README documents an undeclared input (RC5)', (f) => ({ ...f, 'apps/foo/README.md': `${PROVIDER_README}\nACME_TOKEN is also used.\n` }), /documents ACME_TOKEN, which the app config does not declare/],
  ['provider with a package.json (RC6)', (f) => ({ ...f, 'apps/foo/providers/acme/worker/package.json': '{}' }), /no package\.json or app config of its own/],
  ['provider with an app config (RC6)', (f) => ({ ...f, 'apps/foo/providers/acme/app.config.yaml': WORKER_CONFIG }), /no package\.json or app config of its own/],
  ['provider with browser code (RC6)', (f) => ({ ...f, 'apps/foo/providers/acme/worker/ui.js': 'document.body.append(1);' }), /browser code does not belong in a provider/],
  ['provider with an html file (RC6)', (f) => ({ ...f, 'apps/foo/providers/acme/page.html': '<html></html>' }), /browser code does not belong/],
  ['relative library row path (RC7)', (f) => ({ ...f, 'apps/foo/README.md': PROVIDER_README.replace('http://localhost:3000/apps/foo/foo.html', '/apps/foo/foo.html') }), /must be an absolute URL/],
  ['demo site host in a library row (RC7)', (f) => ({ ...f, 'apps/foo/README.md': PROVIDER_README.replace('main--ew-extensions--', 'main--ew-extensions-demo--') }), /must not use the demo site host/],
  ['main row listed above the local row (RC7)', (f) => ({
    ...f,
    'apps/foo/README.md': PROVIDER_README.replace(
      /(\| Foo \| http:\/\/localhost[^\n]*\n)([^\n]*BRANCH[^\n]*\n)([^\n]*main--[^\n]*\n)/,
      '$3$1$2',
    ),
  }), /above the main row/],
  ['no library rows (RC7)', (f) => ({ ...f, 'apps/foo/README.md': PROVIDER_README.replace(/\| Foo \|[^\n]*\n/g, '') }), /no `library` rows listed/],
];

providerSad.forEach(([name, mutate, pattern]) => {
  test(`providers sad path: ${name}`, async () => {
    const errors = await run(mutate(withProvider()));
    assert.match(errors.join('\n'), pattern);
  });
});
