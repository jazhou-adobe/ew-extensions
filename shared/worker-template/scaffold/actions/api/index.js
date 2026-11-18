import { createAction } from '__SHARED__/src/index.js';
import { routes } from '../../routes/index.js';

export const main = createAction({ name: '__EXT__', routes, secrets: ['VENDOR_API_KEY'] });
