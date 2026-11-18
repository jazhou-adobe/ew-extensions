/** Side-effect-free render logic for the hello app (everything is rendered as text, never HTML). */

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

function renderStatus(root, message) {
  root.replaceChildren(el('h1', 'Hello world'), el('p', message, { role: 'status' }));
}

function renderSdk(root, sdk) {
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
  );
}

/**
 * Renders the hello app into `root` from the SDK promise.
 * Resolves once the final state (context or standalone) is rendered.
 */
export async function mountHelloWorld(root, sdkPromise, { timeoutMs = STANDALONE_TIMEOUT_MS } = {}) {
  renderStatus(root, 'Waiting for Experience Workspace…');
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const sdk = await Promise.race([sdkPromise, timeout]);
  clearTimeout(timer);
  if (sdk) renderSdk(root, sdk);
  else renderStatus(root, 'Not running inside Experience Workspace. Open this app from da.live.');
}
