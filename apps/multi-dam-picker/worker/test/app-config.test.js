import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { analyzeConfig, parseEnv } from '../../../../shared/worker-template/scripts/worker-config.mjs';
import { providers } from '../providers.js';

const here = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));
const configText = readFileSync(here('app.config.yaml'), 'utf8');
const config = parse(configText);
const action = config.application.runtimeManifest.packages['multi-dam-picker'].actions.api;
const example = parseEnv(readFileSync(here('.env.example'), 'utf8'));

test('CF1: package multi-dam-picker, web action api: raw, custom-options, nodejs:22, explicit timeout and memory', () => {
  assert.ok(config.application.runtimeManifest.packages['multi-dam-picker']);
  assert.equal(action.web, 'raw');
  assert.equal(action.runtime, 'nodejs:22');
  assert.equal(action.annotations['web-custom-options'], true);
  assert.ok(Number.isInteger(action.limits.timeout) && action.limits.timeout <= 30000);
  assert.ok(Number.isInteger(action.limits.memory));
  assert.deepEqual(analyzeConfig(configText, { folderName: 'multi-dam-picker' }).errors, []);
});

test('CF2: credentials and environment inputs are $NAME references; no secret-looking name holds a literal; every $NAME is in .env.example', () => {
  const { inputs } = action;
  ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_ROOT_FOLDER', 'CLOUDINARY_FOLDER_MODE', 'CLOUDINARY_SIGN_URLS']
    .forEach((n) => assert.equal(inputs[n], `$${n}`));
  Object.entries(inputs).filter(([n]) => /KEY|SECRET|TOKEN|PASSWORD/i.test(n)).forEach(([n, v]) => assert.match(v, /^\$[A-Z_]+$/, n));
  ['CLOUDINARY_ALT_CONTEXT_FIELD', 'CLOUDINARY_CAPTION_CONTEXT_FIELD', 'CLOUDINARY_ALT_METADATA_FIELD'].forEach((n) => assert.doesNotMatch(n, /KEY/));
  const { refs } = analyzeConfig(configText);
  refs.forEach((name) => assert.ok(name in example, `${name} missing from .env.example`));
  providers.flatMap((p) => [...p.config.required, ...p.config.secrets]).forEach((n) => assert.ok(n in action.inputs, n));
});

test('CF3: .env.example carries the non-secret test values and blank credentials; nothing credential-like; no tracked .env or .aio', () => {
  assert.equal(example.CLOUDINARY_CLOUD_NAME, 'yifoe45l');
  assert.equal(example.CLOUDINARY_ROOT_FOLDER, 'samples/');
  assert.equal(example.CLOUDINARY_FOLDER_MODE, 'dynamic');
  assert.equal(example.CLOUDINARY_SIGN_URLS, 'false');
  assert.equal(example.CLOUDINARY_API_KEY, '');
  assert.equal(example.CLOUDINARY_API_SECRET, '');
  Object.values(example).forEach((v) => assert.doesNotMatch(v, /^[A-Za-z0-9_-]{24,}$/));
  const tracked = execFileSync('git', ['ls-files', 'apps/multi-dam-picker'], { encoding: 'utf8', cwd: here('../../..') }).split('\n');
  tracked.forEach((f) => assert.ok(!/(^|\/)(\.env|\.env\.(?!example$).+|\.aio)$/.test(f), f));
});
