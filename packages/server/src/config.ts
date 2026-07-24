import { z } from 'zod';
import path from 'node:path';

function booleanEnv(defaultValue: boolean) {
  return z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => ['true', '1'].includes(v));
}

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SESSION_SECRET: z.string().min(32),
  SESSION_COOKIE_SECURE: booleanEnv(false),
  USE_CRYPTO: booleanEnv(false),
  DATA_DIR: z.string().default('/data'),
  LIBRARY_PATH: z.string().default('/data/library'),
  INGEST_PATH: z.string().default('/data/ingest'),
  ORGANIZE_PATTERN: z.string().default('{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}'),
  SCAN_INTERVAL_MINUTES: z.coerce.number().default(60),
  ARTIST_IMAGE_INTERVAL_MINUTES: z.coerce.number().default(1440),
  REVIEW_RETENTION_DAYS: z.coerce.number().min(1).max(365).default(30),
  WATCHER_USE_POLLING: booleanEnv(false),
  PUID: z.coerce.number().default(1000),
  PGID: z.coerce.number().default(1000),
});

export type Config = z.infer<typeof configSchema>;

export type WorkerConfig = Pick<Config, 'DATA_DIR' | 'LIBRARY_PATH' | 'INGEST_PATH' | 'ORGANIZE_PATTERN' | 'SCAN_INTERVAL_MINUTES' | 'ARTIST_IMAGE_INTERVAL_MINUTES' | 'REVIEW_RETENTION_DAYS' | 'WATCHER_USE_POLLING' | 'PUID' | 'PGID'>;

export function loadConfig(): Config {
  return configSchema.parse(process.env);
}

export function getDbPath(config: Config): string {
  return path.join(config.DATA_DIR, 'sonarly.db');
}
