import type { DuplicateStrategy } from './duplicate.js';

export type IngestStatus = 'pending' | 'validating' | 'needs_review' | 'imported' | 'skipped' | 'failed';

export interface IngestJob {
  id: string;
  sourcePath: string;
  status: IngestStatus;
  targetPath?: string;
  error?: string;
  duplicate?: boolean;
  duplicateStrategy?: DuplicateStrategy;
  createdAt: string;
  updatedAt: string;
}
