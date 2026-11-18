// Mapping of Dropbox file metadata to the shell's summary (SPEC D19, D20). Allow-list based: only the fields named
// here are read. Folders, Paper entries and non-downloadable files are not assets.
import { extensionOf, typeOfExtension } from './types.js';

export const ASSET_ID = /^id:[A-Za-z0-9_-]{1,64}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : undefined);

/** A usable file entry of a search match, a folder listing or `get_metadata`; undefined for everything else. */
export function readFile(entry) {
  const meta = isObject(entry) && entry['.tag'] === 'metadata' && isObject(entry.metadata) ? entry.metadata : entry;
  if (!isObject(meta) || meta['.tag'] !== 'file') return undefined;
  if (typeof meta.id !== 'string' || !ASSET_ID.test(meta.id)) return undefined;
  if (typeof meta.name !== 'string' || !meta.name) return undefined;
  if (meta.is_downloadable === false) return undefined;
  const extension = extensionOf(meta.name);
  return {
    id: meta.id,
    name: meta.name,
    extension,
    type: typeOfExtension(extension),
    size: int(meta.size),
    modified: typeof meta.server_modified === 'string' ? meta.server_modified : undefined,
    pathLower: typeof meta.path_lower === 'string' ? meta.path_lower : undefined,
    media: isObject(meta.media_info) ? meta.media_info : undefined,
    propertyGroups: Array.isArray(meta.property_groups) ? meta.property_groups : [],
  };
}

/** Image dimensions once Dropbox has processed the file (`pending` or absent: omitted). */
export function dimensionsOf(file) {
  const info = file.media?.['.tag'] === 'metadata' ? file.media.metadata : undefined;
  const d = isObject(info) && info['.tag'] === 'photo' ? info.dimensions : undefined;
  return isObject(d) && int(d.width) && int(d.height) ? { width: d.width, height: d.height } : {};
}

export function toSummary(file) {
  const out = {
    id: file.id, name: file.name, type: file.type, warnings: [],
  };
  if (file.extension) out.extension = file.extension;
  if (file.size !== undefined) out.fileSize = file.size;
  if (file.modified) out.dateModified = file.modified;
  return out;
}
