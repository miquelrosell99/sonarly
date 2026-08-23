import { js2xml } from 'xml-js';

/**
 * Converts a Subsonic JSON-style payload into the xml-js compact format.
 *
 * Subsonic XML serializes entity fields as ATTRIBUTES
 * (`<subsonic-response status="ok">`, `<song id="1" .../>`), not child
 * elements. Scalars therefore become `_attributes`, nested objects/arrays
 * become child elements, and a scalar `value` key becomes `_text` so genres
 * render as `<genre songCount="3">Rock</genre>`.
 */
function toCompact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toCompact);
  }
  if (value !== null && typeof value === 'object') {
    const attributes: Record<string, unknown> = {};
    const children: Record<string, unknown> = {};
    let text: unknown;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) || typeof v === 'object') {
        children[key] = toCompact(v);
      } else if (key === 'value') {
        text = v;
      } else {
        attributes[key] = v;
      }
    }
    const result: Record<string, unknown> = {};
    if (Object.keys(attributes).length > 0) result._attributes = attributes;
    if (text !== undefined) result._text = text;
    return Object.assign(result, children);
  }
  return value;
}

// xml-js only escapes `"` in attribute values; XML requires `&` and `<` too.
// The fn runs after the built-in `"` -> `&quot;` pass, so undo it first to
// avoid double-escaping, then escape the full set.
function escapeAttributeValue(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toXml(obj: unknown): string {
  return js2xml(toCompact(obj) as any, {
    compact: true,
    ignoreComment: true,
    spaces: 2,
    attributeValueFn: escapeAttributeValue,
  });
}
