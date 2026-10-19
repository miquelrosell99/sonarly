import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DuplicateStrategy, Library } from '../types';
import { DUPLICATE_STRATEGY_LABELS } from '../types';
import { cn } from '../lib/cn.js';
import { api } from '../lib/api.js';
import { Button } from './ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import { Icon } from './ui/Icon.js';
import { Modal } from './ui/Modal.js';
import { Table, type TableColumn } from './ui/Table.js';
import { useUpload, type UploadFile } from '../hooks/useUpload.js';
import { useNotification } from '../contexts/NotificationContext.js';

export interface UploadSummary {
  fileCount: number;
  totalSize: number;
  libraryName: string;
}

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  libraries: Library[];
  currentLibraryId: string | null;
  onComplete?: (summary: UploadSummary) => void;
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

export function UploadModal({ open, onClose, libraries, currentLibraryId, onComplete }: UploadModalProps) {
  const defaultLibraryId = useMemo(
    () => libraries.find((l) => l.isDefault)?.id ?? libraries[0]?.id ?? '',
    [libraries],
  );
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>(currentLibraryId ?? defaultLibraryId);
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy | ''>('');
  const [settingsError, setSettingsError] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const { progress, isUploading, error, uploadFiles, abort } = useUpload();
  const { notify } = useNotification();
  const inputRef = useRef<HTMLInputElement>(null);

  const isUsingDefaultLibrary = !currentLibraryId && Boolean(defaultLibraryId);

  useEffect(() => {
    if (open) {
      setSelectedLibraryId(currentLibraryId ?? defaultLibraryId);
      setFiles([]);
      setSettingsError(false);
      api<{ duplicateStrategy: DuplicateStrategy }>('/settings/media')
        .then((data) => setDuplicateStrategy(data.duplicateStrategy))
        .catch(() => {
          // Keep the select empty (upload stays gated) but never silently:
          // notify + an inline explanation next to the strategy field.
          setDuplicateStrategy('');
          setSettingsError(true);
          notify('Could not load upload settings', 'error');
        });
    }
  }, [open, currentLibraryId, defaultLibraryId, notify]);

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
    if (!selectedLibraryId || files.length === 0 || !duplicateStrategy) return;
    try {
      await uploadFiles(files, selectedLibraryId, duplicateStrategy);
      const libraryName = libraries.find((l) => l.id === selectedLibraryId)?.name ?? '';
      onComplete?.({ fileCount: files.length, totalSize, libraryName });
      onClose();
    } catch {
      // Error is already captured in hook state.
    }
  }, [files, selectedLibraryId, duplicateStrategy, uploadFiles, libraries, totalSize, onComplete, onClose]);

  const canUpload = selectedLibraryId.length > 0 && duplicateStrategy.length > 0 && files.length > 0 && !isUploading;

  // One bar for the whole batch: completed files plus the in-flight file's
  // share. The per-file percentage lived here once and read as noise next to
  // the batch counter.
  const totalProgress =
    progress.totalFiles > 0
      ? ((progress.completedFiles + progress.currentFileProgress / 100) / progress.totalFiles) * 100
      : 0;

  const fileColumns: TableColumn<UploadFile>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'File name',
        render: ({ relativePath }) => (
          <span className="truncate text-on-surface" title={relativePath}>
            {relativePath}
          </span>
        ),
      },
      {
        key: 'size',
        header: 'Size',
        className: 'w-24 text-right',
        render: ({ file, relativePath }) => (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-on-surface-variant">{formatBytes(file.size)}</span>
            <button
              type="button"
              onClick={() => removeFile(relativePath)}
              disabled={isUploading}
              aria-label="Remove file"
              className="shrink-0 rounded-item p-1 text-on-surface-variant transition hover:bg-surface-container-high hover:text-error disabled:opacity-50"
            >
              <Icon name="mdi-close" size={16} />
            </button>
          </div>
        ),
      },
    ],
    [isUploading, removeFile],
  );

  const footer = (
    <div className="flex items-center justify-between gap-4">
      <div className="text-xs text-on-surface-variant">
        {isUploading ? (
          <span>
            Uploading {progress.completedFiles} of {progress.totalFiles} file{progress.totalFiles === 1 ? '' : 's'}…
          </span>
        ) : (
          files.length > 0 && (
            <span>
              {files.length} file{files.length === 1 ? '' : 's'} · {formatBytes(totalSize)}
            </span>
          )
        )}
      </div>
      <div className="flex items-center gap-2">
        {isUploading ? (
          <Button variant="ghost" onClick={abort}>Cancel</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleUpload} disabled={!canUpload}>
              Upload
            </Button>
          </>
        )}
      </div>
    </div>
  );

  const modalOnClose = isUploading ? () => {} : onClose;

  return (
    <Modal open={open} onClose={modalOnClose} title="Upload" footer={footer} className="max-w-2xl" closeDisabled={isUploading}>
      <div className="space-y-4">
        {isUploading ? (
          <div className="flex flex-col items-center justify-center gap-5 py-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon name="mdi-cloud-upload-outline" size={28} className="animate-pulse" />
            </div>
            <div className="w-full max-w-md space-y-1">
              <div className="flex justify-between gap-2 text-xs text-on-surface-variant">
                <span className="min-w-0 flex-1 truncate" title={progress.currentFile}>{progress.currentFile}</span>
                <span className="shrink-0">{Math.round(totalProgress)}%</span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(totalProgress)}
                aria-label="Upload progress"
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${totalProgress}%` }}
                />
              </div>
              <p className="text-xs text-on-surface-variant">Uploading… use Cancel in the footer to stop.</p>
            </div>
          </div>
        ) : (
          <>
        <div className="space-y-1">
          <label htmlFor="upload-library" className="block text-sm font-medium text-on-surface-variant">
            Library <span className="text-error">*</span>
          </label>
          <Select
            value={selectedLibraryId}
            onValueChange={setSelectedLibraryId}
            disabled={isUploading}
          >
            <SelectTrigger id="upload-library" className="w-full">
              <SelectValue placeholder="Select a library" />
            </SelectTrigger>
            <SelectContent>
              {libraries.map((library) => (
                <SelectItem key={library.id} value={library.id}>
                  {library.name} {library.isDefault ? '(default)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isUsingDefaultLibrary && (
            <p className="text-xs text-on-surface-variant">
              No library selected in the UI; files will be uploaded to the default library.
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="upload-duplicate-strategy" className="block text-sm font-medium text-on-surface-variant">
            Duplicate strategy <span className="text-error">*</span>
          </label>
          <Select
            value={duplicateStrategy}
            onValueChange={(value) => setDuplicateStrategy(value as DuplicateStrategy)}
            disabled={isUploading}
          >
            <SelectTrigger id="upload-duplicate-strategy" className="w-full">
              <SelectValue placeholder="Select a strategy" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DUPLICATE_STRATEGY_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-on-surface-variant">
            Used when an uploaded song matches an existing song by title, album, and artists.
          </p>
          {settingsError && (
            <p className="text-xs text-error" role="alert">
              Upload settings could not be loaded, so uploading is unavailable. Close and reopen this dialog to retry.
            </p>
          )}
        </div>

        <div
          data-upload-drop-zone
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            'relative flex flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed p-8 text-center transition',
            isDragging
              ? 'border-primary bg-surface-container-high'
              : 'border-outline bg-surface hover:border-on-surface-variant/40',
          )}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-high text-primary">
            <Icon name="mdi-cloud-upload-outline" size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-on-surface">Drop files or folders here</p>
            <p className="text-xs text-on-surface-variant">or click to browse</p>
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

        {error && <p className="text-sm text-error" role="alert">{error}</p>}

        {files.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-on-surface">
                Files to upload <span className="text-on-surface-variant">({files.length})</span>
              </h4>
              <Button variant="ghost" onClick={clearFiles} disabled={isUploading} className="h-auto px-2 py-1 text-xs">
                Clear
              </Button>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-item border border-outline">
              <Table
                columns={fileColumns}
                rows={files}
                rowKey={(f) => f.relativePath}
                className="table-fixed"
              />
            </div>
          </div>
        )}

        </>
        )}
      </div>
    </Modal>
  );
}

interface UploadResultsModalProps {
  open: boolean;
  onClose: () => void;
  summary: UploadSummary | null;
}

export function UploadResultsModal({ open, onClose, summary }: UploadResultsModalProps) {
  const footer = (
    <div className="flex justify-end">
      <Button onClick={onClose}>Close</Button>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Upload complete" footer={footer} className="max-w-md">
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-success">
          <Icon name="mdi-check-circle-outline" size={20} />
          <span className="font-medium">Upload successful</span>
        </div>
        {summary && (
          <div className="rounded-item border border-outline bg-surface p-3 text-sm">
            <p className="text-on-surface">
              <span className="font-medium">{summary.fileCount}</span> file
              {summary.fileCount === 1 ? '' : 's'} uploaded
              {summary.libraryName && (
                <span> to <span className="font-medium">{summary.libraryName}</span></span>
              )}
            </p>
            <p className="text-on-surface-variant">Total size: {formatBytes(summary.totalSize)}</p>
          </div>
        )}
        <p className="text-sm text-on-surface-variant">
          Files will be processed and appear in the library shortly. Duplicates will be handled according to the selected strategy.
        </p>
      </div>
    </Modal>
  );
}
