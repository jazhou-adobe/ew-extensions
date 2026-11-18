import { createAction } from '../../../../../shared/worker-template/src/index.js';
import { createRoutes } from '../../shell/routes.js';
import { providers } from '../../providers.js';

export const main = createAction({
  name: 'multi-dam-picker',
  routes: createRoutes({ providers }),
  secrets: providers.flatMap((p) => p.config.secrets),
});
