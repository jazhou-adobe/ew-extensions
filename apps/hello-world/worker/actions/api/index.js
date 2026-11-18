import { createAction } from '../../../../../shared/worker-template/src/index.js';
import { routes } from '../../routes/hello.js';

export const main = createAction({ name: 'hello-world', routes, secrets: ['HELLO_SECRET'] });
