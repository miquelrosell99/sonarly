// Regenerates src/contract/schema.ts from the v2 OpenAPI spec and stamps the
// header that marks the file as generated. Run with: pnpm contract:gen
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const spec = resolve(here, '../../../v2/api/openapi.yaml');
const out = resolve(here, '../src/contract/schema.ts');
const header =
  '// GENERATED from v2/api/openapi.yaml — do not edit; regenerate with pnpm contract:gen\n';

execFileSync('npx', ['openapi-typescript', spec, '-o', out], { stdio: 'inherit' });

const generated = readFileSync(out, 'utf8');
if (!generated.startsWith(header)) {
  writeFileSync(out, header + generated);
}
