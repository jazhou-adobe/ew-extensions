import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { mountHelloPlugin } from './hello-plugin-render.js';

export const ready = mountHelloPlugin(document.getElementById('app'), DA_SDK);
