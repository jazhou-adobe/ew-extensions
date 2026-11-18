import assert from 'node:assert/strict';
import { resolveConfig } from '../../config.js';

const defaultConfig = () => resolveConfig({ CLOUDINARY_CLOUD_NAME: 'yifoe45l', CLOUDINARY_ROOT_FOLDER: 'samples/' });
export const FIXED = 'type=upload AND (asset_folder=samples OR asset_folder:samples/*)';

/** Test-side tokenizer: quoted literals, parentheses and bare words; fails on unbalanced quotes or parentheses. */
export function tokenize(expression) {
  const tokens = [];
  let depth = 0;
  let i = 0;
  while (i < expression.length) {
    const c = expression[i];
    if (c === '"') {
      const j = expression.indexOf('"', i + 1);
      if (j < 0) return { ok: false, tokens };
      tokens.push({ quoted: expression.slice(i + 1, j) });
      i = j + 1;
    } else if (c === '(' || c === ')') {
      depth += c === '(' ? 1 : -1;
      if (depth < 0) return { ok: false, tokens };
      tokens.push(c);
      i += 1;
    } else if (/\s/.test(c)) {
      i += 1;
    } else {
      let j = i;
      while (j < expression.length && !/[\s()"]/.test(expression[j])) j += 1;
      tokens.push(expression.slice(i, j));
      i = j;
    }
  }
  return { ok: depth === 0, tokens };
}

const BARE = /^(?:AND|OR|NOT|type=upload|resource_type=(?:image|video|raw)|format=[a-z0-9]+|asset_folder[=:][A-Za-z0-9_./*-]+)$/;

/** The structural proof: balanced, one type=upload, fixed prefix and root, every unquoted word from the fixed grammar. */
export function assertStructure(expression, config = defaultConfig()) {
  const { ok, tokens } = tokenize(expression);
  assert.ok(ok, `unbalanced: ${expression}`);
  assert.ok(expression.startsWith(FIXED), `prefix lost: ${expression}`);
  assert.equal(tokens.filter((t) => t === 'type=upload').length, 1);
  tokens.filter((t) => typeof t === 'string' && !['(', ')'].includes(t))
    .forEach((t) => assert.match(t, BARE, `unquoted user text: ${t}`));
  // quoted literals are only the keyword words, after the fixed part
  const { root } = config;
  tokens.filter((t) => typeof t === 'object').forEach((t) => {
    assert.doesNotMatch(t.quoted, /["\\*]/);
    assert.notEqual(t.quoted, root);
  });
}
