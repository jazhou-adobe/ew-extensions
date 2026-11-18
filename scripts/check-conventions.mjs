// Repo conventions check: every extension folder under apps/ is self-contained and listed in the README.
import {
  existsSync, readdirSync, readFileSync, realpathSync, statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeConfig, parseEnv } from '../shared/worker-template/scripts/worker-config.mjs';

const TYPES = {
  app: [/^#+\s.*`apps` sheet row/im],
  'library plugin': [/^#+\s.*`library` sheet row/im],
  'app + library plugin': [/^#+\s.*`apps` sheet row/im, /^#+\s.*`library` sheet row/im],
};

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/** A folder holding nothing but SPEC.md files is a planned extension, not yet implemented. */
function isPlanned(dir) {
  return walk(dir).every((f) => f.endsWith('SPEC.md'));
}

function hasTests(dir) {
  const testDir = join(dir, 'test');
  return existsSync(testDir) && walk(testDir).some((f) => /\.(test|spec)\.m?js$/.test(f));
}

function parseTable(readme) {
  const section = readme.split(/^## Extensions\s*$/m)[1];
  if (!section) return null;
  const body = section.split(/^## /m)[0];
  return body.split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .slice(2) // header + separator
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim().replace(/`/g, '')))
    .filter((cells) => cells.length >= 5)
    .map(([name, folder, entry, type]) => ({
      name, folder: folder.replace(/\/$/, ''), entry, type,
    }));
}

const GITIGNORE_REQUIRED = ['.env', '.env.*', '!.env.example', '.aio'];
const HLXIGNORE_REQUIRED = ['**/worker/', 'shared/worker-template/'];
const WORKER_FILES = ['app.config.yaml', 'package.json', 'README.md', '.env.example'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'playwright-report', 'test-results']);
const CONFIG_NAMES = new Set(['app.config.yaml', 'app.config.yml']);
const isEnvFile = (name) => name === '.env' || (name.startsWith('.env.') && name !== '.env.example');

function lines(file) {
  return existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()) : [];
}

function walkRepo(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walkRepo(join(dir, e.name));
    return [join(dir, e.name)];
  });
}

/** Tracked files (git ls-files) when `root` is the top of a git repository; otherwise null. */
function trackedFiles(root) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (realpathSync(top) !== realpathSync(root)) return null;
    return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

/** Worker rules (SPEC Decision 19): App Builder app roots, secret hygiene, config location, ignore files. */
function checkWorkers(root, errors) {
  const gitignore = lines(join(root, '.gitignore'));
  GITIGNORE_REQUIRED.forEach((p) => {
    if (!gitignore.includes(p)) {
      errors.push(`.gitignore: missing "${p}" (worker secrets and CLI state must stay untracked)`);
    }
  });
  if (!gitignore.some((l) => /(^|\/)dist\/?$/.test(l))) errors.push('.gitignore: missing the aio build output (dist/)');
  const hlxignore = lines(join(root, '.hlxignore'));
  HLXIGNORE_REQUIRED.forEach((p) => {
    if (!hlxignore.includes(p)) errors.push(`.hlxignore: missing "${p}" (worker sources must not reach the code bus)`);
  });

  (trackedFiles(root) || []).forEach((f) => {
    const name = f.split('/').pop();
    if (isEnvFile(name) || name === '.aio') errors.push(`${f}: must not be tracked (secrets / CLI credentials)`);
  });

  walkRepo(root).forEach((file) => {
    if (!CONFIG_NAMES.has(file.split('/').pop())) return;
    const rel = relative(root, file).split('\\').join('/');
    const allowed = /^apps\/[^/]+\/worker\/app\.config\.ya?ml$/.test(rel)
      || rel === 'shared/worker-template/scaffold/app.config.yaml';
    if (!allowed) {
      errors.push(`${rel}: app configs are only allowed in apps/<ext>/worker/ and the template scaffold`);
    }
  });

  const appsDir = join(root, 'apps');
  if (!existsSync(appsDir)) return;
  readdirSync(appsDir).forEach((ext) => {
    const dir = join(appsDir, ext, 'worker');
    if (!existsSync(dir)) return;
    const where = `apps/${ext}/worker`;
    WORKER_FILES.forEach((f) => {
      if (!existsSync(join(dir, f))) errors.push(`${where}: missing ${f}`);
    });
    if (!hasTests(dir)) errors.push(`${where}: missing tests (*.test.js under test/)`);
    const configPath = ['app.config.yaml', 'app.config.yml'].map((f) => join(dir, f)).find(existsSync);
    if (!configPath) return;
    const { errors: configErrors, refs } = analyzeConfig(readFileSync(configPath, 'utf8'), { folderName: ext });
    configErrors.forEach((e) => errors.push(`${where}/app.config.yaml: ${e}`));
    const examplePath = join(dir, '.env.example');
    const example = existsSync(examplePath) ? parseEnv(readFileSync(examplePath, 'utf8')) : {};
    refs.forEach((name) => {
      if (!(name in example)) errors.push(`${where}/.env.example: missing $${name} referenced by app.config.yaml`);
    });
  });
}

// ---- provider-based extensions (SPEC multi-dam-picker, RC1-RC7) ----

const TEXT_FILE = /\.(?:m?js|cjs|css|html|json|ya?ml)$/;
const BASE_INPUTS = new Set([
  'ORG', 'SITE', 'IMS_ORIGIN', 'ALLOWED_IMS_CLIENT_IDS', 'STATE_REGION', 'ALLOWED_LOCAL_ORIGINS',
]);
const BROWSER_API = /\b(?:document|window|localStorage|sessionStorage)\.[A-Za-z_]/;
const README_SECTIONS = [
  ['setup', /^#+\s.*\bsetup\b/im],
  ['vendor-side setup', /^#+\s.*-side setup/im],
  ['`library` rows', /^#+\s.*`library` sheet row/im],
  ['site config read', /^#+\s.*site config/im],
  ['local dev', /^#+\s.*local dev/im],
  ['deploy and rotation', /^#+\s.*deploy/im],
  ['shared-credential model', /^#+\s.*shared[- ]credential/im],
  ['limits', /^#+\s.*\blimits\b/im],
  ['privacy', /^#+\s.*\bprivacy\b/im],
  ['add-a-provider checklist', /^#+\s.*add a provider/im],
];

// Vendor names may appear in the registry line and in config: app config, .env.example, optionalEnv in package.json.
const VENDOR_ALLOWED = ['worker/app.config.yaml', 'worker/.env.example', 'worker/providers.js', 'worker/package.json'];

const rel = (root, file) => relative(root, file).split('\\').join('/');
const parts = (path) => path.split('/');

/** Vendors of an extension: every `providers/<vendor>/` folder that has code (not just a SPEC.md). */
function vendorsOf(extDir) {
  const dir = join(extDir, 'providers');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((v) => statSync(join(dir, v)).isDirectory() && !isPlanned(join(dir, v)));
}

const NON_SHIPPED_DIRS = ['test', 'test-live', 'fixtures', 'dist', 'node_modules'];
const isTestPath = (path) => parts(path).some((p) => NON_SHIPPED_DIRS.includes(p));

/** README `library` rows: `| title | path | format | ref | icon | experience |`, as `{ path, ref }`. */
function libraryRows(readme) {
  const section = readme.split(/^#+\s.*`library` sheet row.*$/im)[1];
  if (!section) return [];
  const body = section.split(/^#+\s/m)[0];
  return body.split('\n')
    .filter((l) => l.trim().startsWith('|') && /\.html/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim().replace(/`/g, '')))
    .map((cells) => ({ path: cells[1], ref: cells[3] || '' }));
}

function checkProviderExtension(root, ext, errors) {
  const extDir = join(root, 'apps', ext);
  const vendors = vendorsOf(extDir);
  if (!vendors.length) return;
  const where = `apps/${ext}`;
  const names = (v) => new RegExp(v, 'i');

  // RC1: no vendor strings outside providers/<vendor>/, tests, fixtures, docs, the registry line and config
  walkRepo(extDir).forEach((file) => {
    const path = rel(extDir, file);
    if (!TEXT_FILE.test(path) && path !== 'worker/.env.example') return;
    if (path.startsWith('providers/') || isTestPath(path)) return;
    if (VENDOR_ALLOWED.includes(path)) return;
    const text = readFileSync(file, 'utf8');
    vendors.filter((v) => names(v).test(text)).forEach((v) => {
      errors.push(`${where}/${path}: mentions the vendor "${v}" outside providers/${v}/ `
        + '(vendor code must stay in its provider folder)');
    });
  });

  vendors.forEach((v) => {
    const dir = join(extDir, 'providers', v);
    const here = `${where}/providers/${v}`;
    // RC2: worker module, fixtures with a recording README, conformance registration, README section
    if (!existsSync(join(dir, 'worker', 'index.js'))) {
      errors.push(`${here}: missing worker/index.js (the provider module)`);
    }
    if (!existsSync(join(dir, 'worker', 'fixtures', 'README.md'))) {
      errors.push(`${here}: missing worker/fixtures/README.md (recording notes)`);
    }
    const registry = join(extDir, 'worker', 'providers.js');
    if (!existsSync(registry) || !readFileSync(registry, 'utf8').includes(`providers/${v}/`)) {
      errors.push(`${where}/worker/providers.js: provider "${v}" is not registered`);
    }
    const testDir = join(extDir, 'worker', 'test');
    const covered = existsSync(testDir) && walkRepo(testDir).some((f) => /\.test\.js$/.test(f)
      && readFileSync(f, 'utf8').includes(`providers/${v}/`));
    if (!covered) errors.push(`${where}/worker/test: no conformance test registers provider "${v}"`);
    const readme = existsSync(join(extDir, 'README.md')) ? readFileSync(join(extDir, 'README.md'), 'utf8') : '';
    if (!new RegExp(`^#+\\s.*${v}`, 'im').test(readme)) {
      errors.push(`${where}/README.md: missing a section for provider "${v}"`);
    }

    // RC6: a provider is a module of the extension's worker, not a second app
    walkRepo(dir).forEach((file) => {
      const path = rel(dir, file);
      const name = path.split('/').pop();
      if (name === 'package.json' || CONFIG_NAMES.has(name)) {
        errors.push(`${here}/${path}: a provider has no package.json or app config of its own`);
      }
      if (/\.(html|css)$/.test(name)) errors.push(`${here}/${path}: browser code does not belong in a provider`);
      if (/\.m?js$/.test(name) && BROWSER_API.test(readFileSync(file, 'utf8'))) {
        errors.push(`${here}/${path}: browser code does not belong in a provider`);
      }
    });
  });

  // RC5: README sections and documented inputs match the app config
  const readme = existsSync(join(extDir, 'README.md')) ? readFileSync(join(extDir, 'README.md'), 'utf8') : '';
  README_SECTIONS.forEach(([name, re]) => {
    if (!re.test(readme)) errors.push(`${where}/README.md: missing required section "${name}"`);
  });
  const configPath = join(extDir, 'worker', 'app.config.yaml');
  if (existsSync(configPath)) {
    const { inputs } = analyzeConfig(readFileSync(configPath, 'utf8'), { folderName: ext });
    const declared = new Set(inputs.map((i) => i.name).filter((n) => !BASE_INPUTS.has(n)));
    declared.forEach((n) => {
      if (!readme.includes(n)) errors.push(`${where}/README.md: does not document the input ${n}`);
    });
    vendors.forEach((v) => {
      const prefix = `${v.toUpperCase().replace(/-/g, '_')}_`;
      new Set(readme.match(new RegExp(`\\b${prefix}[A-Z0-9_]+\\b`, 'g')) || []).forEach((n) => {
        if (!declared.has(n)) errors.push(`${where}/README.md: documents ${n}, which the app config does not declare`);
      });
    });
  }

  // RC7: library rows are absolute code-site URLs, never a demo-site host; local and branch rows above main
  const rows = libraryRows(readme);
  if (!rows.length) errors.push(`${where}/README.md: no \`library\` rows listed`);
  rows.forEach((r) => {
    if (!/^https?:\/\//.test(r.path)) {
      errors.push(`${where}/README.md: library row path must be an absolute URL (got "${r.path}")`);
    }
    if (/ew-extensions-demo/.test(r.path)) {
      errors.push(`${where}/README.md: library row path must not use the demo site host (got "${r.path}")`);
    }
  });
  const mainAt = rows.findIndex((r) => r.ref === '' || r.ref === 'main');
  if (mainAt >= 0 && rows.slice(mainAt + 1).some((r) => r.ref !== '' && r.ref !== 'main')) {
    errors.push(`${where}/README.md: library rows for local and branch refs must be listed above the main row`);
  }
}

/** RC1 for the shared core: the template's source, scaffold, scripts and test kit know no vendor. */
function checkCoreIsVendorFree(root, errors) {
  const appsDir = join(root, 'apps');
  if (!existsSync(appsDir)) return;
  const vendors = [...new Set(readdirSync(appsDir).flatMap((e) => vendorsOf(join(appsDir, e))))];
  if (!vendors.length) return;
  ['src', 'scaffold', 'scripts', 'test-kit'].forEach((dir) => {
    const base = join(root, 'shared', 'worker-template', dir);
    if (!existsSync(base)) return;
    walkRepo(base).filter((f) => TEXT_FILE.test(f)).forEach((file) => {
      const text = readFileSync(file, 'utf8');
      vendors.filter((v) => new RegExp(v, 'i').test(text)).forEach((v) => {
        errors.push(`${rel(root, file)}: the shared template must not mention the vendor "${v}"`);
      });
    });
  });
}

export function checkConventions(root) {
  const errors = [];
  const readmePath = join(root, 'README.md');
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
  const rows = parseTable(readme);
  if (!rows) errors.push('README.md: missing "## Extensions" table');

  if (!/outside-activity/i.test(readme) || !/marketplace/i.test(readme)) {
    errors.push('README.md: policy notes (outside-activity / IP, marketplace) are missing');
  }

  const appsDir = join(root, 'apps');
  const folders = existsSync(appsDir)
    ? readdirSync(appsDir).filter((n) => statSync(join(appsDir, n)).isDirectory()) : [];

  folders.forEach((name) => {
    const dir = join(appsDir, name);
    if (isPlanned(dir)) return;
    if (!existsSync(join(dir, `${name}.html`))) errors.push(`apps/${name}: missing entry page ${name}.html`);
    if (!existsSync(join(dir, 'README.md'))) errors.push(`apps/${name}: missing README.md`);
    if (!hasTests(dir)) errors.push(`apps/${name}: missing tests (*.test.js / *.spec.js under test/)`);
    if (rows && !rows.some((r) => r.folder === `apps/${name}`)) {
      errors.push(`apps/${name}: not listed in the README extensions table`);
    }
  });

  (rows || []).forEach((row) => {
    const dir = join(root, row.folder);
    if (!existsSync(dir)) {
      errors.push(`README table: ${row.name}: folder ${row.folder} does not exist`);
      return;
    }
    if (!existsSync(join(root, row.entry))) {
      errors.push(`README table: ${row.name}: entry point ${row.entry} does not exist`);
    }
    const checks = TYPES[row.type];
    if (!checks) {
      errors.push(`README table: ${row.name}: unknown type "${row.type}" (use ${Object.keys(TYPES).join(' | ')})`);
      return;
    }
    const extReadmePath = join(dir, 'README.md');
    const extReadme = existsSync(extReadmePath) ? readFileSync(extReadmePath, 'utf8') : '';
    checks.forEach((re) => {
      if (!re.test(extReadme)) {
        errors.push(`${row.folder}/README.md: type "${row.type}" needs a registration row heading matching ${re}`);
      }
    });
  });

  checkWorkers(root, errors);
  folders.forEach((name) => checkProviderExtension(root, name, errors));
  checkCoreIsVendorFree(root, errors);
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = checkConventions(resolve(fileURLToPath(new URL('..', import.meta.url))));
  if (errors.length) {
    console.error(errors.map((e) => `✖ ${e}`).join('\n'));
    process.exit(1);
  }
  console.log('Conventions OK');
}
