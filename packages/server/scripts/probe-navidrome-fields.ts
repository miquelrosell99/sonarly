import Database from 'better-sqlite3';

const db = new Database('/etc/periphery/stacks/navidrome/config/navidrome.db', { readonly: true });
const rows = db.prepare(
  "SELECT id, name, rules FROM playlist WHERE rules IS NOT NULL AND rules <> ''"
).all() as Array<{ id: string; name: string; rules: Buffer }>;

const fields = new Set<string>();
const operators = new Set<string>();
const sorts = new Set<string>();

function walk(obj: unknown) {
  if (Array.isArray(obj)) {
    obj.forEach(walk);
    return;
  }
  if (typeof obj !== 'object' || obj === null) return;
  const o = obj as Record<string, unknown>;
  if ('all' in o && Array.isArray(o.all)) walk(o.all);
  if ('any' in o && Array.isArray(o.any)) walk(o.any);
  for (const [op, val] of Object.entries(o)) {
    if (op === 'all' || op === 'any') continue;
    if (op === 'sort') {
      sorts.add(String(val));
      continue;
    }
    operators.add(op);
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      Object.keys(val).forEach((f) => fields.add(f));
    }
  }
}

for (const row of rows) {
  const rules = JSON.parse(row.rules.toString('utf-8'));
  walk(rules);
}

console.log('Fields:', [...fields].sort().join(', '));
console.log('Operators:', [...operators].sort().join(', '));
console.log('Sorts:', [...sorts].sort().join(', '));
console.log('Smart playlists count:', rows.length);
