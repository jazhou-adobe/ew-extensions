/** Side-effect-free render logic for the hello library plugin. */

export const INSERT_TEXT = 'Hello from the Hello plugin!';

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
  root.replaceChildren(el('h1', 'Hello plugin'), el('p', message, { role: 'status' }));
}

function renderSdk(root, sdk) {
  const context = sdk?.context && typeof sdk.context === 'object' ? sdk.context : {};
  const actions = sdk?.actions || {};

  const summary = Object.entries(context).map(([k, v]) => `${k}: ${formatValue(v)}`).join(' · ');
  const insert = el('button', 'Insert text', { type: 'button' });
  insert.addEventListener('click', () => actions.sendText?.(INSERT_TEXT));
  const insertAndClose = el('button', 'Insert text and close', { type: 'button' });
  insertAndClose.addEventListener('click', () => {
    actions.sendText?.(INSERT_TEXT);
    actions.closeLibrary?.();
  });

  root.replaceChildren(
    el('h1', 'Hello plugin'),
    el('p', summary || 'No context.', { class: 'context' }),
    el('p', INSERT_TEXT, { class: 'preview' }),
    el('div', undefined, { class: 'buttons' }),
  );
  root.querySelector('.buttons').append(insert, insertAndClose);
}

/**
 * Renders the plugin into `root` from the SDK promise.
 * Resolves once the final state (buttons or standalone) is rendered.
 */
export async function mountHelloPlugin(root, sdkPromise, { timeoutMs = STANDALONE_TIMEOUT_MS } = {}) {
  renderStatus(root, 'Waiting for Experience Workspace…');
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const sdk = await Promise.race([sdkPromise, timeout]);
  clearTimeout(timer);
  if (sdk) renderSdk(root, sdk);
  else renderStatus(root, 'Not running inside Experience Workspace. Open the editor on da.live and use the library.');
}
