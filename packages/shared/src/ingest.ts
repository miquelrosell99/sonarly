export type IngestStatus = 'pending' | 'validating' | 'needs_review' | 'imported' | 'failed';

export interface IngestJob {
  id: string;
  sourcePath: string;
  status: IngestStatus;
  targetPath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
