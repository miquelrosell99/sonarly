import { copyFile, rename, open, rm } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function atomicTagRewrite(
  originalPath: string,
  mutate: (tmpPath: string) => Promise<void>
): Promise<void> {
  const dir = dirname(originalPath);
  const ext = extname(originalPath);
  const tmpPath = join(
    dir,
    `.sonarly-tmp-${Date.now()}-${randomBytes(4).toString('hex')}${ext}`
  );
  await copyFile(originalPath, tmpPath);
  try {
    await mutate(tmpPath);
    const fh = await open(tmpPath, 'r+');
    await fh.sync();
    await fh.close();
    await rename(tmpPath, originalPath);
  } catch (err) {
    await rm(tmpPath, { force: true });
    throw err;
  }
}
