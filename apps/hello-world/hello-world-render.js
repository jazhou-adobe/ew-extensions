/** Side-effect-free render logic for the hello app (everything is rendered as text, never HTML). */
import { callWorker, describe, workerFor } from './hello-world-worker.js';

const STANDALONE_TIMEOUT_MS = 5000;

function el(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

function formatValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** "Call worker" / "Call without token" buttons and their result line. */
function renderWorker({
  sdk, hostname, fetchImpl, workerTimeoutMs,
}) {
  const worker = workerFor(hostname);
  const token = sdk?.token;
  const enabled = Boolean(sdk && token && worker);
  const result = el('p', undefined, { role: 'status', 'aria-live': 'polite' });
  const run = async (withToken) => {
    result.textContent = 'Calling the worker…';
    result.textContent = describe(await callWorker({
      fetchImpl, base: worker.base, token: withToken ? token : undefined, timeoutMs: workerTimeoutMs,
    }));
  };
  const attrs = enabled ? { type: 'button' } : { type: 'button', disabled: '' };
  const withTokenButton = el('button', 'Call worker', attrs);
  const withoutTokenButton = el('button', 'Call without token (expect 401)', attrs);
  withTokenButton.addEventListener('click', () => run(true));
  withoutTokenButton.addEventListener('click', () => run(false));
  let note;
  if (!sdk) note = 'Open this app from Experience Workspace to call the worker.';
  else if (!worker) note = 'No worker is configured for this page address.';
  else if (!token) note = 'No token available to call the worker.';
  return [
    el('h2', 'Worker'),
    withTokenButton,
    withoutTokenButton,
    ...(note ? [el('p', note)] : []),
    result,
  ];
}

function renderStatus(root, message, workerOptions) {
  root.replaceChildren(
    el('h1', 'Hello world'),
    el('p', message, { role: 'status' }),
    ...renderWorker(workerOptions),
  );
}

function renderSdk(root, sdk, workerOptions) {
  const context = sdk?.context && typeof sdk.context === 'object' ? sdk.context : {};
  const list = el('dl', undefined, { 'aria-label': 'Experience Workspace context' });
  Object.entries(context).forEach(([key, value]) => {
    list.append(el('dt', key), el('dd', formatValue(value)));
  });
  root.replaceChildren(
    el('h1', 'Hello world'),
    el('p', sdk?.token ? 'Token present' : 'Token absent', { role: 'status' }),
    el('h2', 'Context'),
    list,
    ...renderWorker({ ...workerOptions, sdk }),
  );
}

/**
 * Renders the hello app into `root` from the SDK promise.
 * Resolves once the final state (context or standalone) is rendered.
 */
export async function mountHelloWorld(root, sdkPromise, {
  timeoutMs = STANDALONE_TIMEOUT_MS,
  fetchImpl = (...args) => fetch(...args),
  hostname = window.location.hostname,
  workerTimeoutMs = 15000,
} = {}) {
  const workerOptions = { hostname, fetchImpl, workerTimeoutMs };
  renderStatus(root, 'Waiting for Experience Workspace…', workerOptions);
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const sdk = await Promise.race([sdkPromise, timeout]);
  clearTimeout(timer);
  if (sdk) renderSdk(root, sdk, workerOptions);
  else renderStatus(root, 'Not running inside Experience Workspace. Open this app from da.live.', workerOptions);
}
