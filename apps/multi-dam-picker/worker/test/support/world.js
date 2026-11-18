import { makeWorld, canary } from '../../../../../shared/worker-template/test-kit/index.js';
import cloudinary from '../../../providers/cloudinary/worker/index.js';
import { fakeCloudinary } from '../../../providers/cloudinary/worker/test/support/fake-cloudinary.js';
import { createRoutes } from '../../shell/routes.js';

export const KEY = canary('cld-key');
export const SECRET = canary('cld-secret');
export const BASIC = `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString('base64')}`;
export const ID = (n) => n.toString(16).padStart(32, '0');

/** Worker inputs of the test environment (non-secret values as in `.env.example`, canary secrets). */
export const cloudInputs = (overrides = {}) => ({
  CLOUDINARY_CLOUD_NAME: 'yifoe45l',
  CLOUDINARY_ROOT_FOLDER: 'samples/',
  CLOUDINARY_FOLDER_MODE: 'dynamic',
  CLOUDINARY_SIGN_URLS: 'false',
  CLOUDINARY_API_KEY: KEY,
  CLOUDINARY_API_SECRET: SECRET,
  ...overrides,
});

/**
 * The real action behind the template kit with `fakeCloudinary` as the vendor.
 * `call({ path, query })` hits the router; `cloud.requests` has what Cloudinary received.
 */
export async function pickerWorld({
  providers = [cloudinary], inputs = {}, cloud: cloudOptions = {}, deps, hostedKinds, now,
} = {}) {
  const merged = cloudInputs(inputs);
  const cloud = fakeCloudinary({
    key: merged.CLOUDINARY_API_KEY, secret: merged.CLOUDINARY_API_SECRET, now: now ? () => now : undefined, ...cloudOptions,
  });
  const world = await makeWorld({
    name: 'multi-dam-picker',
    routes: createRoutes({ providers, hostedKinds }),
    secrets: providers.flatMap((p) => p.config.secrets),
    inputs: merged,
    vendor: cloud,
    deps,
    ...(now ? { now } : {}),
  });
  return Object.assign(world, {
    cloud,
    search: (query = {}, rest = {}) => world.call({ path: '/dam/cloudinary/assets', query, ...rest }),
    detail: (id, rest = {}) => world.call({ path: `/dam/cloudinary/assets/${id}`, ...rest }),
  });
}
