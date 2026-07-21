import chokidar from 'chokidar';
import { Config } from '../config.js';
import Database from 'better-sqlite3';
import { pushJob } from './queue.js';

export function startLibraryWatcher(config: Config, db: Database.Database): () => Promise<void> {
  const watcher = chokidar.watch(config.LIBRARY_PATH, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    usePolling: config.WATCHER_USE_POLLING,
  });

  let debounceTimer: NodeJS.Timeout | null = null;

  const scheduleResync = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      pushJob(db, 'resync', config.LIBRARY_PATH);
    }, 2000);
  };

  watcher.on('add', scheduleResync)
         .on('change', scheduleResync)
         .on('unlink', scheduleResync)
         .on('addDir', scheduleResync)
         .on('unlinkDir', scheduleResync);

  return () => watcher.close();
}

export function startIngestWatcher(config: Config, db: Database.Database): () => Promise<void> {
  const watcher = chokidar.watch(config.INGEST_PATH, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    usePolling: config.WATCHER_USE_POLLING,
  });

  let debounceTimer: NodeJS.Timeout | null = null;

  const scheduleIngest = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      pushJob(db, 'ingest', config.INGEST_PATH);
    }, 2000);
  };

  watcher.on('add', scheduleIngest).on('addDir', scheduleIngest);
  return () => watcher.close();
}
