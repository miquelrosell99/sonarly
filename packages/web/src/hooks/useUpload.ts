import { useCallback, useRef, useState } from 'react';
import { api } from '../api.js';

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
  uploadFiles: (files: UploadFile[], libraryId: string) => Promise<void>;
}

function generateFileId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function uploadChunk(
  sessionId: string,
  fileId: string,
  index: number,
  chunk: Blob,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const formData = new FormData();
  formData.append('file', chunk, `${fileId}-${index}`);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload/sessions/${sessionId}/files/${fileId}/chunks/${index}`);
    xhr.withCredentials = true;
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
    xhr.send(formData);
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
  const abortRef = useRef(false);

  const uploadFiles = useCallback(async (files: UploadFile[], libraryId: string): Promise<void> => {
    setIsUploading(true);
    setError(null);
    setProgress({
      totalFiles: files.length,
      completedFiles: 0,
      currentFile: '',
      currentFileProgress: 0,
    });
    abortRef.current = false;

    try {
      const { sessionId } = await api<{ sessionId: string }>('/upload/sessions', {
        method: 'POST',
        body: JSON.stringify({ libraryId }),
      });

      for (let i = 0; i < files.length; i++) {
        if (abortRef.current) throw new Error('Upload cancelled');

        const { file, relativePath } = files[i];
        const fileId = generateFileId();
        const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

        setProgress((prev) => ({
          ...prev,
          currentFile: relativePath || file.name,
          currentFileProgress: 0,
        }));

        for (let index = 0; index < totalChunks; index++) {
          if (abortRef.current) throw new Error('Upload cancelled');

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

export function abortUpload(): void {
  // Reserved for future use; current implementation does not expose abort from hook result.
}
