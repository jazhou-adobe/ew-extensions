// Alt text (SPEC D21): Dropbox has no description or alt field. The genuine metadata channel is a file property
// (a property template the team defines); otherwise the cleaned file name. Always plain text, always editable.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const ENTITY = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;

/** Plain text from a candidate: markup, entities and control characters removed, whitespace collapsed. */
export function cleanText(value, max = 300) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(ENTITY, ' ').replace(/[<>]/g, ' ').replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const nameWithoutExtension = (name) => name.replace(/\.[A-Za-z0-9]{1,16}$/, '');

/** `{ value, source }` for the shell: `property`, else `name`, else `none`. `description` is never produced. */
export function altFor(file, config) {
  if (config.alt) {
    const group = file.propertyGroups.find((g) => g?.template_id === config.alt.templateId);
    const field = Array.isArray(group?.fields) ? group.fields.find((f) => f?.name === config.alt.field) : undefined;
    const value = cleanText(field?.value);
    if (value) return { value, source: 'property' };
  }
  const name = cleanText(nameWithoutExtension(file.name).replace(/[_-]+/g, ' '));
  return name ? { value: name, source: 'name' } : { value: '', source: 'none' };
}
