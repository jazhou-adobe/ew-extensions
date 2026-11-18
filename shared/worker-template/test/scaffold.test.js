import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, readFileSync, realpathSync, rmSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorker } from '../scripts/new-worker.mjs';
import { analyzeConfig } from '../scripts/worker-config.mjs';

const { NODE_TEST_CONTEXT: _ctx, ...childEnv } = process.env;

test('the scaffold generates a complete worker whose config passes the rules and whose tests pass', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'scaffold-')));
  try {
    const dest = createWorker('demo-ext', join(root, 'apps', 'demo-ext', 'worker'));
    const files = readdirSync(dest, { recursive: true, withFileTypes: false });
    ['app.config.yaml', 'package.json', 'README.md', '.env.example'].forEach((f) => assert.ok(files.includes(f), f));
    const { errors } = analyzeConfig(readFileSync(join(dest, 'app.config.yaml'), 'utf8'), { folderName: 'demo-ext' });
    assert.deepEqual(errors, []);
    files.filter((f) => /\.[a-z]+$|\.env\.example$/.test(f)).forEach((f) => {
      assert.doesNotMatch(readFileSync(join(dest, f), 'utf8'), /__(EXT|SHARED|GUARD)__/, f);
    });
    const out = execFileSync(process.execPath, ['--test', join(dest, 'test', 'api.test.js')], {
      encoding: 'utf8', env: childEnv,
    });
    assert.match(out, /# pass 1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createWorker rejects bad names and existing folders', () => {
  assert.throws(() => createWorker('Bad_Name', '/tmp/x/Bad_Name/worker'), /kebab-case/);
  assert.throws(() => createWorker('a-b', '/tmp/wrong/worker'), /destination/);
});
