import chokidar from 'chokidar';
import { Config } from '../../config.js';
import Database from 'better-sqlite3';
import { pushJob } from './queue.js';

export interface LibraryWatcher {
  stop: () => Promise<void>;
  restart: () => Promise<void>;
}

function getLibraryPaths(db: Database.Database, fallbackPath: string): string[] {
  const rows = db.prepare('SELECT path FROM libraries').pluck().all() as string[];
  return rows.length > 0 ? rows : [fallbackPath];
}

export function startLibraryWatcher(config: Config, db: Database.Database): LibraryWatcher {
  let watcher = createWatcher(config, db);
  let debounceTimer: NodeJS.Timeout | null = null;

  function scheduleResync() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      pushJob(db, 'resync', '');
    }, 2000);
  }

  function bindWatcher(w: ReturnType<typeof chokidar.watch>) {
    w.on('add', scheduleResync)
      .on('change', scheduleResync)
      .on('unlink', scheduleResync)
      .on('addDir', scheduleResync)
      .on('unlinkDir', scheduleResync);
  }

  function createWatcher(cfg: Config, database: Database.Database) {
    const paths = getLibraryPaths(database, cfg.LIBRARY_PATH);
    const w = chokidar.watch(paths, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      usePolling: cfg.WATCHER_USE_POLLING,
    });
    bindWatcher(w);
    return w;
  }

  async function stop(): Promise<void> {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    watcher.off('add', scheduleResync)
      .off('change', scheduleResync)
      .off('unlink', scheduleResync)
      .off('addDir', scheduleResync)
      .off('unlinkDir', scheduleResync);
    await watcher.close();
  }

  async function restart(): Promise<void> {
    await stop();
    watcher = createWatcher(config, db);
  }

  return { stop, restart };
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
  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    watcher.off('add', scheduleIngest).off('addDir', scheduleIngest);
    return watcher.close();
  };
}
