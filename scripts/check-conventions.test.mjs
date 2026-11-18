import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync,
} from 'node:fs';
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

const good = () => ({
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

test('providers/<vendor> is not treated as an extension', async () => {
  assert.deepEqual(await run({ ...good(), 'apps/foo/providers/acme/acme.js': '' }), []);
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
