// Creates apps/<ext>/worker/ from the scaffold: `node shared/worker-template/scripts/new-worker.mjs <ext> [destDir]`.
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import {
  basename, dirname, join, relative, resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCAFFOLD = join(TEMPLATE, 'scaffold');
const REPO = resolve(TEMPLATE, '../..');

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const rel = (fromDir, to) => relative(fromDir, to).split('\\').join('/') || '.';

/** Copies the scaffold, substituting __EXT__ and the relative paths to the shared template. */
export function createWorker(ext, dest = join(REPO, 'apps', ext, 'worker')) {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(ext)) {
    throw new Error(`"${ext}" must be a kebab-case extension folder name`);
  }
  const target = resolve(dest);
  if (basename(dirname(target)) !== ext) throw new Error(`destination must be <...>/${ext}/worker`);
  if (existsSync(target)) throw new Error(`${target} already exists`);
  walk(SCAFFOLD).forEach((file) => {
    const out = join(target, relative(SCAFFOLD, file));
    mkdirSync(dirname(out), { recursive: true });
    const text = readFileSync(file, 'utf8')
      .replaceAll('__SHARED__', rel(dirname(out), TEMPLATE))
      .replaceAll('__GUARD__', rel(target, join(TEMPLATE, 'scripts/pre-deploy-guard.mjs')))
      .replaceAll('__EXT__', ext);
    writeFileSync(out, text);
  });
  return target;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [ext, dest] = process.argv.slice(2);
  if (!ext) {
    console.error('usage: node shared/worker-template/scripts/new-worker.mjs <extension-folder-name> [destDir]');
    process.exit(2);
  }
  console.log(`Created ${createWorker(ext, dest)}`);
}
