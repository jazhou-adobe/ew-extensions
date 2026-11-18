// Inline thumbnails (SPEC D20). Dropbox has no thumbnail URL an `<img>` could load without a bearer header, so the
// worker asks for base64 thumbnails in batches and returns them as small `data:` URIs on the summary. A thumbnail
// failure never fails the search.
import { ProviderError } from '../../../worker/shell/provider.js';
import { CONTENT_HOST, rpc } from './client.js';
import { canThumbnail, thumbnailFormat } from './types.js';

const BATCH = 25;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_DATA_URI = 64 * 1024;
/** All thumbnails of one response together stay below this (the platform limit is 1 MB for the whole response). */
export const RESPONSE_BUDGET = 500 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function toDataUri(base64, format) {
  if (typeof base64 !== 'string' || !BASE64.test(base64)) return undefined;
  const uri = `data:image/${format};base64,${base64}`;
  return uri.length <= MAX_DATA_URI ? uri : undefined;
}

/**
 * The thumbnails of `files` as `Map(index -> data URI)`; the caller puts them on the summaries. Any failure leaves
 * the affected files without one.
 */
export async function thumbnailsFor(ctx, files) {
  const found = new Map();
  const wanted = files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => canThumbnail(file.extension) && (file.size === undefined || file.size <= MAX_FILE_BYTES));
  let used = 0;
  for (let from = 0; from < wanted.length && ctx.timeLeftMs() >= 3000; from += BATCH) {
    const batch = wanted.slice(from, from + BATCH);
    try {
      // eslint-disable-next-line no-await-in-loop
      const answer = await rpc(ctx, 'files/get_thumbnail_batch', {
        entries: batch.map(({ file }) => ({
          path: file.id,
          format: { '.tag': thumbnailFormat(file.extension) },
          size: { '.tag': 'w128h128' },
          mode: { '.tag': 'strict' },
        })),
      }, { host: CONTENT_HOST });
      const entries = Array.isArray(answer.entries) ? answer.entries : [];
      for (let i = 0; i < batch.length; i += 1) {
        const { file, index } = batch[i];
        const uri = entries[i]?.['.tag'] === 'success'
          ? toDataUri(entries[i].thumbnail, thumbnailFormat(file.extension)) : undefined;
        if (uri && used + uri.length <= RESPONSE_BUDGET) {
          used += uri.length;
          found.set(index, uri);
        }
      }
    } catch (e) {
      ctx.log('thumbnails_failed', { class: e instanceof ProviderError ? e.kind : 'error' });
    }
  }
  return found;
}
