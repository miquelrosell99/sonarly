import { mkdir, readdir, readFile, rename, rm, writeFile, copyFile, unlink } from 'node:fs/promises';
import { join, dirname, isAbsolute, resolve, sep } from 'node:path';

export const FILE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
// Chunked uploads are audio files; cap reassembly size so a malicious
// totalChunks cannot exhaust memory via Buffer.concat.
export const MAX_TOTAL_CHUNKS = 10_000;
export const MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GiB

export function isSafeRelativePath(relativePath: string): boolean {
  if (relativePath.length === 0 || isAbsolute(relativePath)) return false;
  if (relativePath.split(/[\\/]+/).some((segment) => segment === '..')) return false;
  return true;
}

export function isValidFileId(fileId: string): boolean {
  return FILE_ID_PATTERN.test(fileId);
}

export async function writeChunk(sessionDir: string, fileId: string, index: number, data: Buffer): Promise<void> {
  if (!isValidFileId(fileId)) throw new Error('Invalid file id');
  if (!Number.isInteger(index) || index < 0 || index >= MAX_TOTAL_CHUNKS) throw new Error('Invalid chunk index');
  const chunkDir = join(sessionDir, 'chunks', fileId);
  await mkdir(chunkDir, { recursive: true });
  await writeFile(join(chunkDir, String(index)), data);
}

export async function reassembleFile(sessionDir: string, fileId: string, totalChunks: number, relativePath: string): Promise<string> {
  if (!isValidFileId(fileId)) throw new Error('Invalid file id');
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_TOTAL_CHUNKS) {
    throw new Error('Invalid chunk count');
  }
  if (!isSafeRelativePath(relativePath)) throw new Error('Invalid relative path');

  const filesDir = join(sessionDir, 'files');
  const targetPath = resolve(filesDir, relativePath);
  const resolvedFilesDir = resolve(filesDir);
  if (targetPath !== resolvedFilesDir && !targetPath.startsWith(resolvedFilesDir + sep)) {
    throw new Error('Invalid relative path');
  }

  const chunkDir = join(sessionDir, 'chunks', fileId);
  await mkdir(dirname(targetPath), { recursive: true });
  const parts: Buffer[] = [];
  let totalBytes = 0;
  for (let i = 0; i < totalChunks; i++) {
    const part = await readFile(join(chunkDir, String(i)));
    totalBytes += part.length;
    if (totalBytes > MAX_FILE_BYTES) throw new Error('File too large');
    parts.push(part);
  }
  await writeFile(targetPath, Buffer.concat(parts));
  return targetPath;
}

export async function moveSessionFilesToIngest(sessionDir: string, ingestDir: string): Promise<void> {
  const filesDir = join(sessionDir, 'files');
  await mkdir(ingestDir, { recursive: true });
  await moveDirectoryContents(filesDir, ingestDir);
}

async function moveDirectoryContents(sourceDir: string, targetDir: string): Promise<void> {
  const entries = await readdir(sourceDir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const sourcePath = join(entry.parentPath ?? sourceDir, entry.name);
    const relativePath = sourcePath.slice(sourceDir.length + 1);
    const targetPath = join(targetDir, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await moveFile(sourcePath, targetPath);
  }
}

async function moveFile(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await rename(sourcePath, targetPath);
  } catch (err) {
    if (isExdev(err)) {
      await unlink(targetPath).catch(() => undefined);
      await copyFile(sourcePath, targetPath);
      await unlink(sourcePath);
    } else {
      throw err;
    }
  }
}

function isExdev(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'EXDEV';
}

export async function removeSessionDirectory(sessionDir: string): Promise<void> {
  await rm(sessionDir, { recursive: true, force: true });
}
