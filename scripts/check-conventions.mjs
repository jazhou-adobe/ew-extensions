// Repo conventions check: every extension folder under apps/ is self-contained and listed in the README.
import {
  existsSync, readdirSync, readFileSync, statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
