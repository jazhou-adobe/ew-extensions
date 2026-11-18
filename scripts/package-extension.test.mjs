import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { packageExtension } from './package-extension.mjs';

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'pkg-'));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

const EXT = {
  'apps/x/x.html': '<script src="/apps/x/x.js" type="module"></script>',
  'apps/x/x.js': "import { a } from './lib/a.js';\nimport DA_SDK from 'https://da.live/nx/utils/sdk.js';",
  'apps/x/lib/a.js': 'export const a = 1;',
  'apps/x/x.css': 'body {}',
  'apps/x/README.md': '# x',
  'apps/x/SPEC.md': '# spec',
  'apps/x/test/unit/x.test.js': '',
  'apps/x/worker/actions/api/index.js': 'secret stuff',
  'apps/x/providers/v/worker/index.js': 'vendor backend',
};

test('PK1: copies browser files only, replaces the destination folder, records provenance', () => {
  const root = tree(EXT);
  const dest = tree({ 'head.html': '', 'apps/x/stale.js': 'old' });
  const { files } = packageExtension({ root, name: 'x', dest });
  assert.deepEqual(files, ['lib/a.js', 'x.css', 'x.html', 'x.js']);
  assert.equal(readFileSync(join(dest, 'apps/x/lib/a.js'), 'utf8'), 'export const a = 1;');
  for (const gone of ['stale.js', 'README.md', 'SPEC.md', 'test', 'worker', 'providers']) {
    assert.equal(existsSync(join(dest, 'apps/x', gone)), false, gone);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(dest, 'apps/x/.vendored.json'), 'utf8')).files, files);
});

test('PK2: refuses a relative import that leaves the extension folder', () => {
  const root = tree({ ...EXT, 'apps/x/x.js': "import { s } from '../../shared/s.js';" });
  const dest = tree({ 'head.html': '' });
  assert.throws(() => packageExtension({ root, name: 'x', dest }), /outside the extension folder[\s\S]*x\.js -> \.\.\/\.\.\/shared\/s\.js/);
  assert.equal(existsSync(join(dest, 'apps/x')), false);
});

test('PK3: refuses an unknown extension or a destination that is not a site repo', () => {
  const root = tree(EXT);
  assert.throws(() => packageExtension({ root, name: 'nope', dest: tree({ 'head.html': '' }) }), /No extension entry page/);
  assert.throws(() => packageExtension({ root, name: 'x', dest: tree({ 'a.txt': '' }) }), /does not look like an EDS site repo/);
});
