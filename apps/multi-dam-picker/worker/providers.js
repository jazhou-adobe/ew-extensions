// The provider registry: one line per DAM module. A later DAM adds its module under providers/<vendor>/worker/
// and one entry here; the shell is not touched.
import cloudinary from '../providers/cloudinary/worker/index.js';
import dropbox from '../providers/dropbox/worker/index.js';

export const providers = [cloudinary, dropbox];
