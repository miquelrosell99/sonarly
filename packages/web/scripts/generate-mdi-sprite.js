import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const mdiDir = path.join(packageRoot, 'node_modules', '@mdi', 'svg', 'svg');
const outputPath = path.join(packageRoot, 'public', 'mdi-sprite.svg');

const names = process.argv.slice(2);

if (names.length === 0) {
  console.error('Usage: node generate-mdi-sprite.js <icon-name> [...]');
  process.exit(1);
}

async function main() {
  const symbols = [];

  for (const name of names) {
    const fileName = name.replace(/^mdi-/, '');
    const filePath = path.join(mdiDir, `${fileName}.svg`);
    let svg;
    try {
      svg = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      console.error(`Missing icon: ${name} (${filePath})`);
      process.exit(1);
    }

    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24';

    // Strip the outer <svg> tags, keeping only its children.
    const inner = svg
      .replace(/<svg[^>]*>/i, '')
      .replace(/<\/svg\s*>/i, '')
      .trim();

    symbols.push(`  <symbol id="${name}" viewBox="${viewBox}">\n    ${inner}\n  </symbol>`);
  }

  const sprite = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" style="display:none;">\n${symbols.join('\n')}\n</svg>\n`;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, sprite, 'utf-8');
  console.log(`Generated ${outputPath} with ${names.length} icon(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
