import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { registerDefaultWriters } from './features/tags/index.js';

// Hard ceiling for graceful shutdown; covers a stuck connection or a worker
// that ignores the shutdown message so `docker stop` never hangs forever.
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  registerDefaultWriters();
  const config = loadConfig();
  const app = await buildApp(config);

  let shuttingDown = false;
  const shutdown = (signal: 'SIGTERM' | 'SIGINT') => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Received ${signal}, shutting down`);
    const forceExit = setTimeout(() => {
      console.error(`Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms; forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    app.close()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error('Error during graceful shutdown:', err);
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
