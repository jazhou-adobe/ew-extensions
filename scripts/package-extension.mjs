#!/usr/bin/env node
/**
 * Packages an extension's browser files into another EDS site repo, e.g. the DA test site:
 *
 *   npm run package:extension -- multi-dam-picker ../ew-extensions-demo
 *
 * Copies `apps/<name>/` to `<dest>/apps/<name>/` (same path, so the entry page's absolute `/apps/<name>/...` URLs keep
 * working), leaving out backend code (`worker/`), tests, specs and READMEs. The destination folder is replaced, and a
 * `.vendored.json` (dotfile, not served by EDS) records the source commit. Fails if a packaged module imports a
 * relative path outside the extension folder, since that file would not exist in the destination.
 */
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import {
  dirname, join, relative, resolve, sep,
} from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set(['worker', 'test', 'node_modules', 'dist']);
const SKIP_FILES = /\.(md|test\.js)$|^\./;
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Lists the files to package, relative to the extension folder. */
export function collect(srcDir, base = srcDir) {
  const out = [];
  for (const entry of readdirSync(srcDir)) {
    const full = join(srcDir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) out.push(...collect(full, base));
    } else if (!SKIP_FILES.test(entry)) {
      out.push(relative(base, full));
    }
  }
  return out.sort();
}

/** Returns relative imports in packaged JS files that resolve outside the extension folder. */
export function escapingImports(srcDir, files) {
  const bad = [];
  for (const file of files.filter((f) => f.endsWith('.js'))) {
    const text = readFileSync(join(srcDir, file), 'utf8');
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] || m[2];
      if (spec.startsWith('.')) {
        const target = resolve(srcDir, dirname(file), spec);
        if (!target.startsWith(resolve(srcDir) + sep)) bad.push(`${file} -> ${spec}`);
      }
    }
  }
  return bad;
}

export function packageExtension({ root, name, dest }) {
  const srcDir = join(root, 'apps', name);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || !existsSync(join(srcDir, `${name}.html`))) {
    throw new Error(`No extension entry page apps/${name}/${name}.html`);
  }
  const hasSiteMarker = ['.git', 'fstab.yaml', 'head.html'].some((f) => existsSync(join(dest, f)));
  if (!hasSiteMarker) {
    throw new Error(`${dest} does not look like an EDS site repo`);
  }
  const files = collect(srcDir);
  const bad = escapingImports(srcDir, files);
  if (bad.length) throw new Error(`Imports outside the extension folder:\n  ${bad.join('\n  ')}`);

  const outDir = join(dest, 'apps', name);
  rmSync(outDir, { recursive: true, force: true });
  for (const file of files) {
    mkdirSync(dirname(join(outDir, file)), { recursive: true });
    cpSync(join(srcDir, file), join(outDir, file));
  }
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch { /* not a git checkout */ }
  writeFileSync(join(outDir, '.vendored.json'), `${JSON.stringify({
    source: 'https://github.com/jazhou-adobe/ew-extensions', path: `apps/${name}`, commit, files,
  }, null, 2)}\n`);
  return { outDir, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [name, dest] = process.argv.slice(2);
  if (!name || !dest) {
    console.error('Usage: npm run package:extension -- <name> <dest-site-repo>');
    process.exit(2);
  }
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const { outDir, files } = packageExtension({ root, name, dest: resolve(dest) });
    console.log(`Packaged ${files.length} files into ${outDir}`);
    files.forEach((f) => console.log(`  ${f}`));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
