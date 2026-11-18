import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDeploy } from '../scripts/pre-deploy-guard.mjs';
import { analyzeConfig, parseEnv } from '../scripts/worker-config.mjs';

const HELLO = fileURLToPath(new URL('../../../apps/hello-world/worker', import.meta.url));

function worker(env, config = readFileSync(join(HELLO, 'app.config.yaml'), 'utf8')) {
  const root = mkdtempSync(join(tmpdir(), 'guard-'));
  const dir = join(root, 'apps', 'hello-world', 'worker');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'app.config.yaml'), config);
  if (env !== undefined) writeFileSync(join(dir, '.env'), env);
  return { dir, done: () => rmSync(root, { recursive: true, force: true }) };
}

function check(env, config) {
  const w = worker(env, config);
  try {
    return checkDeploy(w.dir);
  } finally {
    w.done();
  }
}

test('UR7: Stage with all values present passes', () => {
  assert.deepEqual(check('HELLO_SECRET=abc\nALLOWED_LOCAL_ORIGINS=http://localhost:3000\nAIO_runtime_namespace=281295-ewextensions-stage\n'), []);
});

test('UR7: Production with an empty ALLOWED_LOCAL_ORIGINS passes', () => {
  assert.deepEqual(check('HELLO_SECRET=abc\nALLOWED_LOCAL_ORIGINS=\nAIO_runtime_namespace=281295-ewextensions\n'), []);
});

test('UR7: a missing or empty secret fails', () => {
  assert.match(check('ALLOWED_LOCAL_ORIGINS=\n').join('\n'), /HELLO_SECRET is not set/);
  assert.match(check('HELLO_SECRET=\nALLOWED_LOCAL_ORIGINS=\n').join('\n'), /HELLO_SECRET is empty/);
  assert.match(check(undefined).join('\n'), /HELLO_SECRET is not set/);
});

test('UR7: local origins outside Stage fail (Production-shaped or unknown namespace)', () => {
  const prod = check('HELLO_SECRET=abc\nALLOWED_LOCAL_ORIGINS=http://localhost:3000\nAIO_runtime_namespace=281295-ewextensions\n');
  assert.match(prod.join('\n'), /must be empty outside Stage/);
  const unknown = check('HELLO_SECRET=abc\nALLOWED_LOCAL_ORIGINS=http://localhost:3000\n');
  assert.match(unknown.join('\n'), /AIO_runtime_namespace/);
});

test('guard also enforces the config rules', () => {
  const config = readFileSync(join(HELLO, 'app.config.yaml'), 'utf8').replace('web-custom-options: true', 'web-custom-options: false');
  assert.match(check('HELLO_SECRET=abc\nALLOWED_LOCAL_ORIGINS=\n', config).join('\n'), /web-custom-options/);
});

test('HW8: the committed hello worker config passes the worker rules', () => {
  const { errors, refs } = analyzeConfig(readFileSync(join(HELLO, 'app.config.yaml'), 'utf8'), { folderName: 'hello-world' });
  assert.deepEqual(errors, []);
  assert.ok(refs.has('HELLO_SECRET'));
  const example = parseEnv(readFileSync(join(HELLO, '.env.example'), 'utf8'));
  refs.forEach((r) => assert.ok(r in example, `${r} missing from .env.example`));
});

test('analyzeConfig: UR3/UR6 violations', () => {
  const base = (over = '') => `application:
  runtimeManifest:
    packages:
      hello-world:
        actions:
          api:
            function: a.js
            web: raw
            runtime: nodejs:22
            inputs:
              HELLO_SECRET: $HELLO_SECRET
${over}
            annotations:
              web-custom-options: true
            limits:
              timeout: 25000
`;
  assert.deepEqual(analyzeConfig(base(), { folderName: 'hello-world' }).errors, []);
  assert.match(analyzeConfig(base('              API_KEY: literal-value')).errors.join(), /API_KEY.*\$NAME/);
  assert.match(analyzeConfig(base(), { folderName: 'other' }).errors.join(), /must equal the extension folder name/);
  assert.match(analyzeConfig(base().replace('web: raw', 'web: true')).errors.join(), /web: raw/);
  assert.match(analyzeConfig(base().replace('nodejs:22', 'nodejs:18')).errors.join(), /runtime/);
  assert.match(analyzeConfig(base().replace('25000', '60000')).errors.join(), /timeout/);
  assert.match(analyzeConfig(base().replace(/ {12}limits:\n {14}timeout: 25000\n/, '')).errors.join(), /timeout/);
  assert.match(analyzeConfig('{{{').errors.join(), /valid YAML/);
});

test('optionalEnv in the worker package.json exempts named references from the missing/empty checks', () => {
  const root = mkdtempSync(join(tmpdir(), 'guard-'));
  try {
    const dir = join(root, 'apps', 'hello-world', 'worker');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'app.config.yaml'), readFileSync(join(HELLO, 'app.config.yaml'), 'utf8'));
    writeFileSync(join(dir, '.env'), 'ALLOWED_LOCAL_ORIGINS=\nHELLO_SECRET=\n');
    assert.ok(checkDeploy(dir).some((e) => e.includes('HELLO_SECRET')));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ optionalEnv: ['HELLO_SECRET'] }));
    assert.deepEqual(checkDeploy(dir), []);
    writeFileSync(join(dir, '.env'), 'ALLOWED_LOCAL_ORIGINS=\n');
    assert.deepEqual(checkDeploy(dir), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
