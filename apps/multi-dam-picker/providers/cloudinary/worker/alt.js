// Alt text policy (SPEC D15): property -> description -> name -> none, always cleaned to plain text.

const MAX_ALT = 500;

/** Plain text: markup, entities and control characters removed, whitespace collapsed. */
export function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ALT);
}

/** `Hero_Banner-2024.jpg` -> `Hero Banner 2024`. */
export function nameToAlt(name) {
  if (typeof name !== 'string') return '';
  return cleanText(name.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/[_-]+/g, ' '));
}

function contextValue(context, field) {
  if (!context || typeof context !== 'object') return '';
  const custom = context.custom && typeof context.custom === 'object' ? context.custom[field] : undefined;
  const direct = context[field];
  if (typeof custom === 'string' && cleanText(custom)) return cleanText(custom);
  return typeof direct === 'string' ? cleanText(direct) : '';
}

/** @returns {{ alt: { value: string, source: string }, description: string }} */
export function altFor(detail, config, name) {
  const caption = contextValue(detail.context, config.captionContextField);
  let property = '';
  if (config.altMetadataField && detail.metadata && typeof detail.metadata === 'object') {
    const meta = detail.metadata[config.altMetadataField];
    if (typeof meta === 'string') property = cleanText(meta);
  }
  if (!property) property = contextValue(detail.context, config.altContextField);
  if (property) return { alt: { value: property, source: 'property' }, description: caption };
  if (caption) return { alt: { value: caption, source: 'description' }, description: caption };
  const fromName = nameToAlt(name);
  if (fromName) return { alt: { value: fromName, source: 'name' }, description: '' };
  return { alt: { value: '', source: 'none' }, description: '' };
}
