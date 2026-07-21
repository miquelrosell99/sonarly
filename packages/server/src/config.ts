import { z } from 'zod';
import path from 'node:path';

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SESSION_SECRET: z.string().min(32),
  DATA_DIR: z.string().default('/data'),
  LIBRARY_PATH: z.string().default('/data/library'),
  INGEST_PATH: z.string().default('/data/ingest'),
  SCAN_INTERVAL_MINUTES: z.coerce.number().default(60),
  WATCHER_USE_POLLING: z.coerce.boolean().default(false),
  PUID: z.coerce.number().default(1000),
  PGID: z.coerce.number().default(1000),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse(process.env);
}

export function getDbPath(config: Config): string {
  return path.join(config.DATA_DIR, 'sonarly.db');
}
