import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Library } from '@sonarly/shared';
import { cn } from '../lib/cn.js';
import { Button } from './ui/Button.js';
import { Icon } from './ui/Icon.js';
import { Modal } from './ui/Modal.js';
import { useUpload, type UploadFile } from '../hooks/useUpload.js';

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  libraries: Library[];
  currentLibraryId: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function getRelativePath(file: File): string {
  return (file as any).webkitRelativePath || file.name;
}

function readEntry(entry: FileSystemEntry, path = ''): Promise<UploadFile[]> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file((file) => {
        const relativePath = path ? `${path}/${file.name}` : file.name;
        resolve([{ file, relativePath }]);
      });
      return;
    }

    if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      const dirPath = path ? `${path}/${entry.name}` : entry.name;
      const allFiles: UploadFile[] = [];

      const readBatch = () => {
        dirReader.readEntries(async (entries) => {
          if (entries.length === 0) {
            resolve(allFiles);
            return;
          }
          const batch = await Promise.all(entries.map((e) => readEntry(e, dirPath)));
          batch.forEach((files) => allFiles.push(...files));
          readBatch();
        });
      };

      readBatch();
      return;
    }

    resolve([]);
  });
}

async function collectFiles(items: DataTransferItemList): Promise<UploadFile[]> {
  const files: UploadFile[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      const entries = await readEntry(entry);
      files.push(...entries);
    } else {
      const file = item.getAsFile();
      if (file) {
        files.push({ file, relativePath: getRelativePath(file) });
      }
    }
  }
  return files;
}

export function UploadModal({ open, onClose, libraries, currentLibraryId }: UploadModalProps) {
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>(currentLibraryId ?? '');
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const { progress, isUploading, error, uploadFiles } = useUpload();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSelectedLibraryId(currentLibraryId ?? '');
      setFiles([]);
    }
  }, [open, currentLibraryId]);

  const totalSize = useMemo(
    () => files.reduce((sum, { file }) => sum + file.size, 0),
    [files],
  );

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    const dropped = await collectFiles(items);
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.relativePath));
      return [...prev, ...dropped.filter((f) => !existing.has(f.relativePath))];
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.relativePath));
      return [
        ...prev,
        ...selected
          .map((file) => ({ file, relativePath: getRelativePath(file) }))
          .filter((f) => !existing.has(f.relativePath)),
      ];
    });
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const removeFile = useCallback((relativePath: string) => {
    setFiles((prev) => prev.filter((f) => f.relativePath !== relativePath));
  }, []);

  const clearFiles = useCallback(() => setFiles([]), []);

  const handleUpload = useCallback(async () => {
    if (!selectedLibraryId || files.length === 0) return;
    try {
      await uploadFiles(files, selectedLibraryId);
      onClose();
    } catch {
      // Error is already captured in hook state.
    }
  }, [files, selectedLibraryId, uploadFiles, onClose]);

  const canUpload = selectedLibraryId.length > 0 && files.length > 0 && !isUploading;

  const footer = (
    <div className="flex items-center justify-between gap-4">
      <div className="text-xs text-fg-secondary">
        {files.length > 0 && (
          <span>
            {files.length} file{files.length === 1 ? '' : 's'} · {formatBytes(totalSize)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onClose} disabled={isUploading}>
          Cancel
        </Button>
        <Button onClick={handleUpload} disabled={!canUpload}>
          {isUploading ? 'Uploading…' : 'Upload'}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Upload" footer={footer} className="max-w-2xl">
      <div className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="upload-library" className="block text-sm font-medium text-fg-secondary">
            Library <span className="text-danger">*</span>
          </label>
          <select
            id="upload-library"
            value={selectedLibraryId}
            onChange={(e) => setSelectedLibraryId(e.target.value)}
            disabled={isUploading}
            className="input w-full"
          >
            <option value="">Select a library</option>
            {libraries.map((library) => (
              <option key={library.id} value={library.id}>
                {library.name}
              </option>
            ))}
          </select>
        </div>

        <div
          data-upload-drop-zone
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            'relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition',
            isDragging
              ? 'border-accent bg-accent/10'
              : 'border-rule bg-surface hover:border-fg-secondary/40',
          )}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-hover text-accent">
            <Icon name="mdi-cloud-upload-outline" size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-fg-primary">Drop files or folders here</p>
            <p className="text-xs text-fg-secondary">or click to browse</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            // @ts-expect-error webkitdirectory is non-standard but widely supported
            webkitdirectory=""
            directory=""
            onChange={handleFileInput}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </div>

        {error && <p className="text-sm text-danger" role="alert">{error}</p>}

        {files.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-fg-primary">Files to upload</h4>
              <Button variant="ghost" onClick={clearFiles} disabled={isUploading} className="h-auto px-2 py-1 text-xs">
                Clear
              </Button>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-md border border-rule">
              <ul className="divide-y divide-rule">
                {files.map(({ file, relativePath }) => (
                  <li key={relativePath} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="truncate text-fg-primary" title={relativePath}>{relativePath}</span>
                    <span className="ml-2 shrink-0 text-xs text-fg-secondary">{formatBytes(file.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(relativePath)}
                      disabled={isUploading}
                      aria-label="Remove file"
                      className="ml-2 shrink-0 rounded p-1 text-fg-secondary transition hover:bg-surface-hover hover:text-danger disabled:opacity-50"
                    >
                      <Icon name="mdi-close" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {isUploading && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-fg-secondary">
              <span className="truncate" title={progress.currentFile}>{progress.currentFile}</span>
              <span>{progress.completedFiles} / {progress.totalFiles}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-hover">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${progress.currentFileProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
