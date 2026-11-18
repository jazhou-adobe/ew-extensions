import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { mountHelloWorld } from './hello-world-render.js';

export const ready = mountHelloWorld(document.getElementById('app'), DA_SDK);
