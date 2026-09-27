import { useCallback, useRef, useState } from 'react';
import type { DuplicateStrategy } from '../types';
import { api } from '../lib/api.js';

// Chunks are 5 MiB: the server caps one chunk at 10 MiB, so 5 MiB stays
// safely under the limit while keeping per-request memory small.
const CHUNK_SIZE = 5 * 1024 * 1024;

export interface UploadFile {
  file: File;
  relativePath: string;
}

export interface UploadProgress {
  totalFiles: number;
  completedFiles: number;
  currentFile: string;
  currentFileProgress: number;
}

export interface UseUploadReturn {
  progress: UploadProgress;
  isUploading: boolean;
  error: string | null;
  uploadFiles: (
    files: UploadFile[],
    libraryId: string,
    duplicateStrategy?: DuplicateStrategy,
    options?: UploadOptions,
  ) => Promise<void>;
  /** Abort the in-flight upload (if any). Subsequent chunks are not sent. */
  abort: () => void;
}

export interface UploadOptions {
  signal?: AbortSignal;
}

/** Rejection marker for user-initiated cancels (distinct from a failed chunk). */
export class UploadAbortedError extends Error {
  readonly aborted = true;

  constructor() {
    super('Upload cancelled');
    this.name = 'UploadAbortedError';
  }
}

function generateFileId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Upload one chunk: PUT application/octet-stream, the body is the chunk
 * bytes exactly (see server/internal/modules/uploads/routes.go).
 * XHR (not fetch) because upload progress events have no fetch equivalent.
 * Non-2xx bodies are parsed as the server's `{error}` JSON envelope; a 401
 * additionally dispatches `sonarly:unauthorized` (same contract as lib/api).
 */
async function uploadChunk(
  sessionId: string,
  fileId: string,
  index: number,
  chunk: Blob,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const url = `/api/upload/sessions/${sessionId}/files/${fileId}/chunks/${index}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let message = xhr.statusText || `Upload failed (${xhr.status})`;
      try {
        const parsed = JSON.parse(xhr.responseText) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        // Not a JSON body; surface the statusText fallback.
      }
      if (xhr.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('sonarly:unauthorized'));
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Network error while uploading chunk'));
    xhr.onabort = () => reject(new UploadAbortedError());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total);
      }
    };
    if (signal) {
      if (signal.aborted) {
        reject(new UploadAbortedError());
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(chunk);
  });
}

export function useUpload(): UseUploadReturn {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress>({
    totalFiles: 0,
    completedFiles: 0,
    currentFile: '',
    currentFileProgress: 0,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const uploadFiles = useCallback(async (
    files: UploadFile[],
    libraryId: string,
    duplicateStrategy?: DuplicateStrategy,
    options?: UploadOptions,
  ): Promise<void> => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }
    const signal = controller.signal;

    setIsUploading(true);
    setError(null);
    setProgress({
      totalFiles: files.length,
      completedFiles: 0,
      currentFile: '',
      currentFileProgress: 0,
    });

    try {
      const body: { libraryId: string; duplicateStrategy?: DuplicateStrategy } = { libraryId };
      if (duplicateStrategy) {
        body.duplicateStrategy = duplicateStrategy;
      }
      const { sessionId } = await api<{ sessionId: string }>('/upload/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      for (let i = 0; i < files.length; i++) {
        if (signal.aborted) throw new UploadAbortedError();
        const { file, relativePath } = files[i];
        const fileId = generateFileId();
        const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

        setProgress((prev) => ({
          ...prev,
          currentFile: relativePath || file.name,
          currentFileProgress: 0,
        }));

        for (let index = 0; index < totalChunks; index++) {
          if (signal.aborted) throw new UploadAbortedError();
          const start = index * CHUNK_SIZE;
          const end = Math.min(file.size, start + CHUNK_SIZE);
          const chunk = file.slice(start, end);

          await uploadChunk(sessionId, fileId, index, chunk, (loaded, total) => {
            const chunkProgress = total > 0 ? loaded / total : 0;
            const overallFileProgress = (index + chunkProgress) / totalChunks;
            setProgress((prev) => ({ ...prev, currentFileProgress: overallFileProgress * 100 }));
          }, signal);
        }

        await api(`/upload/sessions/${sessionId}/files/${fileId}/complete`, {
          method: 'POST',
          body: JSON.stringify({ totalChunks, relativePath: relativePath || file.name }),
        });

        setProgress((prev) => ({
          ...prev,
          completedFiles: prev.completedFiles + 1,
          currentFileProgress: 100,
        }));
      }

      await api(`/upload/sessions/${sessionId}/complete`, { method: 'POST' });
    } catch (err) {
      if (err instanceof UploadAbortedError) {
        // User cancel: no error state; the caller keeps its file list so the
        // upload can be retried.
        setError(null);
      } else {
        const message = err instanceof Error ? err.message : 'Upload failed';
        setError(message);
      }
      throw err;
    } finally {
      setIsUploading(false);
      abortControllerRef.current = null;
    }
  }, []);

  return { progress, isUploading, error, uploadFiles, abort };
}
