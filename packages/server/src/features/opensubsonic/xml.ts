import { js2xml } from 'xml-js';

export function toXml(obj: unknown): string {
  return js2xml(obj as any, { compact: true, ignoreComment: true, spaces: 2 });
}
