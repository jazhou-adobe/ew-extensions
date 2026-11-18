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
const { actions } = config.application.runtimeManifest.packages['multi-dam-picker'];
const action = actions.api;
const oauthAction = actions.oauth;
const example = parseEnv(readFileSync(here('.env.example'), 'utf8'));

test('CF1: package multi-dam-picker, web actions api and oauth: raw, custom-options, nodejs:22, explicit timeout and memory', () => {
  assert.ok(config.application.runtimeManifest.packages['multi-dam-picker']);
  assert.equal(action.web, 'raw');
  assert.equal(action.runtime, 'nodejs:22');
  assert.equal(action.annotations['web-custom-options'], true);
  assert.ok(Number.isInteger(action.limits.timeout) && action.limits.timeout <= 30000);
  assert.ok(Number.isInteger(action.limits.memory));
  assert.deepEqual(Object.keys(actions).sort(), ['api', 'oauth']);
  assert.equal(oauthAction.web, 'raw');
  assert.equal(oauthAction.runtime, 'nodejs:22');
  assert.ok(Number.isInteger(oauthAction.limits.timeout) && oauthAction.limits.timeout <= 30000);
  assert.equal(oauthAction.annotations['require-adobe-auth'], false, 'the pop-up redirects carry no token');
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

test('CF4: the OAuth host and Dropbox inputs are $NAME references; the oauth action carries only what its two routes need', () => {
  ['OAUTH_PUBLIC_BASE_URL', 'TOKEN_ENC_KEY', 'TOKEN_ENC_KEY_PREVIOUS', 'OAUTH_STATE_KEY', 'DROPBOX_CLIENT_ID', 'DROPBOX_CLIENT_SECRET', 'DROPBOX_ROOT_PATH']
    .forEach((n) => {
      assert.equal(action.inputs[n], `$${n}`, `api ${n}`);
      assert.equal(oauthAction.inputs[n], `$${n}`, `oauth ${n}`);
      assert.ok(n in example, `.env.example has ${n}`);
    });
  ['ORG', 'SITE', 'STATE_REGION', 'ALLOWED_LOCAL_ORIGINS', 'DROPBOX_SCOPES', 'CONNECTION_TTL_DAYS'].forEach((n) => {
    assert.equal(String(oauthAction.inputs[n]), String(action.inputs[n]), n);
  });
  Object.keys(oauthAction.inputs).forEach((n) => assert.ok(n in action.inputs, `${n} is declared on api too`));
  assert.ok(!Object.keys(oauthAction.inputs).some((n) => /CLOUDINARY|IMS_/.test(n)), 'the oauth action has no Cloudinary or IMS input');
  assert.ok(!Object.keys(action.inputs).some((n) => /ORIGIN_OVERRIDE|TEST_|DROPBOX_(API|HOST|URL)/.test(n)), 'no input changes a host');
  ['OAUTH_PUBLIC_BASE_URL', 'TOKEN_ENC_KEY', 'OAUTH_STATE_KEY', 'DROPBOX_CLIENT_ID', 'DROPBOX_CLIENT_SECRET'].forEach((n) => assert.equal(example[n], '', n));
});

test('CF5: optional references (blank = provider off) are named in the worker package.json so the pre-deploy guard allows them', () => {
  const pkg = JSON.parse(readFileSync(here('package.json'), 'utf8'));
  assert.deepEqual([...pkg.optionalEnv].sort(), ['DROPBOX_CLIENT_ID', 'DROPBOX_CLIENT_SECRET', 'DROPBOX_ROOT_PATH', 'OAUTH_PUBLIC_BASE_URL', 'OAUTH_STATE_KEY', 'TOKEN_ENC_KEY', 'TOKEN_ENC_KEY_PREVIOUS']);
  ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CLOUDINARY_CLOUD_NAME'].forEach((n) => assert.ok(!pkg.optionalEnv.includes(n), `${n} stays required`));
});
