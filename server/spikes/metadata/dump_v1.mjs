// Gold-standard dump: run the retired server's actual tag reader (npm music-metadata@11.14.0,
// the exact version pnpm-locked in the main checkout) against the spike corpus.
//
// Usage (from anywhere):
//   node dump_v1.mjs <corpus-dir> <out.json>
//
// Importing the pnpm-store copy by absolute path keeps the main checkout
// read-only; this script is a spike artifact, not production code.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , corpusDir, outPath] = process.argv;
if (!corpusDir || !outPath) {
  console.error("usage: node dump_v1.mjs <corpus-dir> <out.json>");
  process.exit(1);
}

const mm = await import(
  "/etc/periphery/stacks/sonarly/node_modules/.pnpm/music-metadata@11.14.0/node_modules/music-metadata/lib/index.js"
);

const files = (await import("node:fs/promises")).readdir(corpusDir);
const out = {};

for (const name of await files) {
  const p = join(corpusDir, name);
  try {
    const md = await mm.parseFile(p, { duration: true });
    out[name] = JSON.parse(
      JSON.stringify(md, (k, v) => {
        // shrink embedded picture data to a descriptor (Uint8Array serializes
        // as an object with numeric keys)
        if (v && typeof v === "object" && v.format && v.data != null) {
          const n = Array.isArray(v.data) ? v.data.length : Object.keys(v.data).length;
          return { format: v.format, dataBytes: n };
        }
        if (typeof v === "bigint") return Number(v);
        return v;
      })
    );
  } catch (e) {
    out[name] = { error: String(e.message || e) };
  }
}

writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log("wrote", outPath);
