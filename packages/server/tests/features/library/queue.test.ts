import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../../src/db/migrate.js';
import {
  pushJob,
  popPendingJob,
  markJobRunning,
  markJobCompleted,
  markJobFailed,
  updateJobStats,
} from '../../../src/features/library/queue.js';

describe('scan job queue', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
  });

  it('pushes and pops a pending job', () => {
    pushJob(db, 'scan', '/data/library');

    const job = popPendingJob(db);

    expect(job).toBeDefined();
    expect(job!.type).toBe('scan');
    expect(job!.payload).toBe('/data/library');
  });

  it('returns undefined when no pending jobs exist', () => {
    expect(popPendingJob(db)).toBeUndefined();
  });

  it('pops jobs in FIFO order', () => {
    pushJob(db, 'scan', '/first');
    pushJob(db, 'resync', '/second');

    const first = popPendingJob(db);
    expect(first?.payload).toBe('/first');
    markJobRunning(db, first!.id);

    const second = popPendingJob(db);
    expect(second?.payload).toBe('/second');
  });

  it('does not pop running jobs', () => {
    pushJob(db, 'scan', '/data/library');
    const job = popPendingJob(db);
    markJobRunning(db, job!.id);

    expect(popPendingJob(db)).toBeUndefined();
  });

  it('marks jobs as completed with stats', () => {
    pushJob(db, 'scan', '/data/library');
    const job = popPendingJob(db);
    markJobRunning(db, job!.id);
    markJobCompleted(db, job!.id, { scanned: 5, added: 2 });

    const row = db.prepare('SELECT status, stats FROM scan_jobs WHERE id = ?').get(job!.id) as any;
    expect(row.status).toBe('completed');
    expect(JSON.parse(row.stats)).toEqual({ scanned: 5, added: 2 });
  });

  it('marks jobs as failed with an error', () => {
    pushJob(db, 'ingest', '/data/ingest');
    const job = popPendingJob(db);
    markJobRunning(db, job!.id);
    markJobFailed(db, job!.id, 'something went wrong');

    const row = db.prepare('SELECT status, error FROM scan_jobs WHERE id = ?').get(job!.id) as any;
    expect(row.status).toBe('failed');
    expect(row.error).toBe('something went wrong');
  });

  it('updates job stats mid-run', () => {
    pushJob(db, 'organize', '');
    const job = popPendingJob(db);
    markJobRunning(db, job!.id);

    updateJobStats(db, job!.id, { total: 5, done: 2, currentPath: '/a.mp3' });

    const row = db.prepare('SELECT stats FROM scan_jobs WHERE id = ?').get(job!.id) as any;
    expect(JSON.parse(row.stats)).toEqual({ total: 5, done: 2, currentPath: '/a.mp3' });
  });

  it('pushes an organize job and returns its id', () => {
    const id = pushJob(db, 'organize', '');

    const row = db.prepare('SELECT id, type FROM scan_jobs WHERE id = ?').get(id) as any;
    expect(row.type).toBe('organize');
  });
});
