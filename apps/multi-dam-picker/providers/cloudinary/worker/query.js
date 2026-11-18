// Search request construction (SPEC D9, D10, D12). User text can only ever become quoted literals: every character
// with a meaning inside a quoted literal (`"`, `\`, `*`) and every control character is replaced by a space before
// quoting, so nothing depends on escape semantics.
import { ProviderError } from '../../../worker/shell/provider.js';

export const WINDOW = 500;
export const MAX_WORDS = 8;
export const MAX_QUERY_CHARS = 200;
const MAX_WORD_CHARS = 100;

export const SEARCH_FIELDS = Object.freeze([
  'public_id', 'asset_id', 'asset_folder', 'display_name', 'filename', 'format', 'resource_type', 'type',
  'version', 'width', 'height', 'bytes', 'secure_url', 'created_at', 'uploaded_at', 'access_control',
  'moderation_status', 'status',
]);

export const AUDIO_FORMATS = Object.freeze([
  'mp3', 'wav', 'aac', 'flac', 'ogg', 'oga', 'm4a', 'opus', 'aiff', 'aif', 'amr', 'wma',
]);
const anyFormat = (list) => `(${list.map((f) => `format=${f}`).join(' OR ')})`;

/** Splits user text into at most MAX_WORDS safe words (no quote, backslash, wildcard or control character). */
export function keywordWords(q) {
  const cleaned = String(q ?? '')
    .slice(0, MAX_QUERY_CHARS)
    // eslint-disable-next-line no-control-regex
    .replace(/["\\*\u0000-\u001f\u007f-\u009f]/gu, ' ');
  return cleaned.split(/\s+/u).filter(Boolean).slice(0, MAX_WORDS).map((w) => w.slice(0, MAX_WORD_CHARS));
}

const needsQuotes = (v) => !/^[A-Za-z0-9_./-]+$/.test(v);
const quoted = (v) => (needsQuotes(v) ? `"${v}"` : v);

/** The root clause: the folder itself or anything below it. Dynamic mode uses `asset_folder`, fixed mode `folder`. */
export function rootClause(config) {
  if (!config.root) return '';
  const field = config.folderMode === 'fixed' ? 'folder' : 'asset_folder';
  const exact = `${field}=${quoted(config.root)}`;
  const below = needsQuotes(config.root) ? `${field}:"${config.root}/*"` : `${field}:${config.root}/*`;
  return `(${exact} OR ${below})`;
}

const TYPE_CLAUSES = {
  image: 'resource_type=image AND NOT format=pdf',
  video: `resource_type=video AND NOT ${anyFormat(AUDIO_FORMATS)}`,
  audio: `resource_type=video AND ${anyFormat(AUDIO_FORMATS)}`,
  document: '((resource_type=image AND format=pdf) OR resource_type=raw)',
};

/** The complete expression: fixed prefix AND root AND type AND keywords. */
export function buildExpression(config, { q, type }) {
  if (type !== 'all' && !TYPE_CLAUSES[type]) throw new ProviderError('bad_request');
  const parts = ['type=upload'];
  const root = rootClause(config);
  if (root) parts.push(root);
  if (type !== 'all') parts.push(TYPE_CLAUSES[type]);
  const words = keywordWords(q);
  if (words.length) parts.push(`(${words.map((w) => `"${w}"`).join(' AND ')})`);
  return parts.join(' AND ');
}

const SORTS = {
  newest: () => undefined,
  oldest: () => [{ created_at: 'asc' }],
  name: () => [{ public_id: 'asc' }],
  relevance: () => [{ score: 'desc' }],
};

/** The request body for `resources/search` plus the slice bounds for the requested page. */
export function buildSearch(config, {
  q, type, sort, page, pageSize,
}) {
  if (!SORTS[sort]) throw new ProviderError('bad_request');
  const words = keywordWords(q);
  if (sort === 'relevance' && !words.length) throw new ProviderError('bad_request');
  const start = (page - 1) * pageSize;
  if (start >= WINDOW) throw new ProviderError('bad_request');
  const body = { expression: buildExpression(config, { q, type }) };
  const sortBy = SORTS[sort]();
  if (sortBy) body.sort_by = sortBy;
  body.max_results = Math.min(WINDOW, page * pageSize);
  body.fields = [...SEARCH_FIELDS];
  return { body, start, end: start + pageSize };
}

/** `hasMore` only while the end of the page is below both the total and the window. */
export function hasMore(end, total) {
  return end < Math.min(WINDOW, Number.isInteger(total) ? total : 0);
}
