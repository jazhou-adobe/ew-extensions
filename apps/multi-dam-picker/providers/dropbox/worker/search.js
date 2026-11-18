// Browse and search (SPEC D19). Dropbox search is cursor-only, the shell asks for page + pageSize, so the provider
// re-walks from the start: it collects at least page x pageSize matches (within a call cap, a window and the
// invocation's
// time budget), de-duplicates by file id, and slices. An empty query lists the root folder (newest first within the
// scanned window).
import { ProviderError } from '../../../worker/shell/provider.js';
import { rpc } from './client.js';
import { readFile, toSummary } from './mapping.js';
import { categoriesFor } from './types.js';
import { thumbnailsFor } from './thumbnails.js';

export const WINDOW = 300;
const SEARCH_PAGE = 100;
const LIST_PAGE = 200;
const MAX_SEARCH_CALLS = 3;
const MAX_LIST_CALLS = 3;
/** A further call is only started while at least this much of the invocation budget remains. */
const MIN_BUDGET_MS = 6000;

const ORDER = { relevance: 'relevance', modified: 'last_modified_time' };

/** Walks a cursor feed: `first()` then `next(cursor)` until enough, no more, the call cap or the time budget. */
async function walk(ctx, {
  first, next, read, needed, maxCalls,
}) {
  const seen = new Set();
  const files = [];
  let hasMore = false;
  let page = await first();
  for (let calls = 1; ; calls += 1) {
    read(page).forEach((file) => {
      if (!seen.has(file.id)) {
        seen.add(file.id);
        files.push(file);
      }
    });
    hasMore = page.has_more === true && typeof page.cursor === 'string';
    if (!hasMore || files.length >= needed || calls >= maxCalls || ctx.timeLeftMs() < MIN_BUDGET_MS) break;
    // eslint-disable-next-line no-await-in-loop
    page = await next(page.cursor);
  }
  return { files, hasMore };
}

async function searchFiles(ctx, query, needed) {
  const { config } = ctx;
  const options = {
    file_status: { '.tag': 'active' },
    filename_only: false,
    max_results: SEARCH_PAGE,
    order_by: { '.tag': ORDER[query.sort] },
    file_categories: categoriesFor(query.type),
    ...(config.root ? { path: config.root } : {}),
  };
  return walk(ctx, {
    first: () => rpc(ctx, 'files/search_v2', { query: query.q.trim(), options }),
    next: (cursor) => rpc(ctx, 'files/search/continue_v2', { cursor }),
    read: (page) => (Array.isArray(page.matches) ? page.matches.map((m) => readFile(m?.metadata)).filter(Boolean) : []),
    needed,
    maxCalls: MAX_SEARCH_CALLS,
  });
}

async function listFiles(ctx, query) {
  const { config } = ctx;
  const wanted = (file) => query.type === 'all' || file.type === query.type;
  const out = await walk(ctx, {
    first: () => rpc(ctx, 'files/list_folder', {
      path: config.root, recursive: false, include_non_downloadable_files: false, limit: LIST_PAGE,
    }),
    next: (cursor) => rpc(ctx, 'files/list_folder/continue', { cursor }),
    read: (page) => (Array.isArray(page.entries) ? page.entries.map(readFile).filter(Boolean) : []),
    // The type filter applies after the scan, so the cap, not `needed`, bounds the walk for a narrow type.
    needed: Number.POSITIVE_INFINITY,
    maxCalls: MAX_LIST_CALLS,
  });
  const files = out.files.filter(wanted)
    .sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')) || a.name.localeCompare(b.name));
  return { files, hasMore: out.hasMore };
}

export async function search(ctx, query) {
  if (!ORDER[query.sort]) throw new ProviderError('bad_request');
  const start = (query.page - 1) * query.pageSize;
  const end = Math.min(WINDOW, query.page * query.pageSize);
  if (start >= WINDOW) throw new ProviderError('bad_request');
  const found = query.q.trim() ? await searchFiles(ctx, query, end + 1) : await listFiles(ctx, query);
  const slice = found.files.slice(start, end);
  const thumbs = await thumbnailsFor(ctx, slice);
  const items = slice.map((file, i) => ({
    ...toSummary(file), ...(thumbs.has(i) ? { thumbnailUrl: thumbs.get(i) } : {}),
  }));
  // More exists when more were collected than shown or Dropbox has more; nothing beyond the window is reachable.
  return { items, hasMore: (found.files.length > end || found.hasMore) && end < WINDOW };
}
