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
