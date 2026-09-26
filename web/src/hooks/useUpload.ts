import { useCallback, useState } from 'react';
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
  uploadFiles: (files: UploadFile[], libraryId: string, duplicateStrategy?: DuplicateStrategy) => Promise<void>;
}

function generateFileId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Upload one chunk: PUT application/octet-stream, the body is the chunk
 * bytes exactly (see server/internal/modules/uploads/routes.go).
 * XHR (not fetch) because upload progress events have no fetch equivalent.
 */
async function uploadChunk(
  sessionId: string,
  fileId: string,
  index: number,
  chunk: Blob,
  onProgress?: (loaded: number, total: number) => void,
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
      } else {
        reject(new Error(xhr.statusText || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error while uploading chunk'));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total);
      }
    };
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

  const uploadFiles = useCallback(async (
    files: UploadFile[],
    libraryId: string,
    duplicateStrategy?: DuplicateStrategy,
  ): Promise<void> => {
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
        const { file, relativePath } = files[i];
        const fileId = generateFileId();
        const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

        setProgress((prev) => ({
          ...prev,
          currentFile: relativePath || file.name,
          currentFileProgress: 0,
        }));

        for (let index = 0; index < totalChunks; index++) {
          const start = index * CHUNK_SIZE;
          const end = Math.min(file.size, start + CHUNK_SIZE);
          const chunk = file.slice(start, end);

          await uploadChunk(sessionId, fileId, index, chunk, (loaded, total) => {
            const chunkProgress = total > 0 ? loaded / total : 0;
            const overallFileProgress = (index + chunkProgress) / totalChunks;
            setProgress((prev) => ({ ...prev, currentFileProgress: overallFileProgress * 100 }));
          });
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
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      throw err;
    } finally {
      setIsUploading(false);
    }
  }, []);

  return { progress, isUploading, error, uploadFiles };
}
