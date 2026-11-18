import { createAction } from '../../../../../shared/worker-template/src/index.js';
import { createOAuthRoutes } from '../../shell/oauth.js';
import { providers } from '../../providers.js';

// The only action without an IMS token: the two browser navigations of the sign-in pop-up (begin, callback). Each
// route authenticates itself with sealed values; CORS is never enabled.
export const main = createAction({
  name: 'multi-dam-picker',
  mode: 'public',
  routes: createOAuthRoutes({ providers }),
  secrets: providers.flatMap((p) => p.config.secrets),
});
