import { mkdir, readdir, readFile, rename, rm, writeFile, copyFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export async function writeChunk(sessionDir: string, fileId: string, index: number, data: Buffer): Promise<void> {
  const chunkDir = join(sessionDir, 'chunks', fileId);
  await mkdir(chunkDir, { recursive: true });
  await writeFile(join(chunkDir, String(index)), data);
}

export async function reassembleFile(sessionDir: string, fileId: string, totalChunks: number, relativePath: string): Promise<string> {
  const chunkDir = join(sessionDir, 'chunks', fileId);
  const targetPath = join(sessionDir, 'files', relativePath);
  await mkdir(dirname(targetPath), { recursive: true });
  const parts: Buffer[] = [];
  for (let i = 0; i < totalChunks; i++) {
    parts.push(await readFile(join(chunkDir, String(i))));
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
