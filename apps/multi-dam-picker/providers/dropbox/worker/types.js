// Dropbox metadata has no mime type and search results carry no category, so the provider owns this table (SPEC D20):
// extension -> the shell's asset type, whether the file can be inserted as an `<img>`, and whether Dropbox can
// make a thumbnail of it.
const group = (type, list) => list.split(' ').map((ext) => [ext, type]);

const TYPES = new Map([
  ...group('image', 'jpg jpeg jpe png gif webp avif svg heic heif tif tiff bmp ico psd ai eps'),
  ...group('image', 'raw cr2 cr3 nef arw dng orf rw2 raf srw pef'),
  ...group('video', 'mp4 mov m4v avi mkv webm wmv flv mpg mpeg 3gp ogv mts'),
  ...group('audio', 'mp3 wav aac flac ogg oga m4a opus aiff aif wma amr'),
  ...group('document', 'pdf doc docx odt rtf txt md pages xls xlsx ods csv numbers ppt pptx odp key epub'),
]);

/** Formats a browser shows in an `<img>` (the shared link is followed by the visitor's browser). */
const IMAGE_INSERTABLE = new Set(['jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'avif', 'svg']);
/** Formats `get_thumbnail_batch` converts. */
const THUMBNAILABLE = new Set(['jpg', 'jpeg', 'jpe', 'png', 'tif', 'tiff', 'gif', 'webp', 'ppm', 'bmp']);
const LOSSLESS = new Set(['png', 'gif', 'webp']);

/** Lower-case last extension of a file name, or undefined. */
export function extensionOf(name) {
  const m = /\.([A-Za-z0-9]{1,16})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : undefined;
}

export const typeOfExtension = (ext) => TYPES.get(ext) || 'other';
export const isImageInsertable = (ext) => IMAGE_INSERTABLE.has(ext);
export const canThumbnail = (ext) => THUMBNAILABLE.has(ext);
export const thumbnailFormat = (ext) => (LOSSLESS.has(ext) ? 'png' : 'jpeg');

/** The `file_categories` sent to `search_v2` for a shell type (never `folder` or `paper`). */
export function categoriesFor(type) {
  const map = {
    image: ['image'],
    video: ['video'],
    audio: ['audio'],
    document: ['document', 'pdf', 'spreadsheet', 'presentation'],
  };
  const list = map[type] || [...map.image, ...map.video, ...map.audio, ...map.document, 'others'];
  return list.map((tag) => ({ '.tag': tag }));
}
