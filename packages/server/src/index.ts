import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { registerDefaultWriters } from './tags/index.js';

async function main() {
  registerDefaultWriters();
  const config = loadConfig();
  const app = await buildApp(config);

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
