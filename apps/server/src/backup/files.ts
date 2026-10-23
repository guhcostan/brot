import { chmod, copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The filesystem operations the backup core needs. The default wraps `node:fs/promises`; tests may inject. */
export interface BackupFs {
  mkdir(path: string, options: { recursive: boolean; mode?: number }): Promise<unknown>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean; size: number }>;
  copyFile(from: string, to: string): Promise<void>;
  cp(from: string, to: string, options: { recursive: boolean }): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string, options?: { mode?: number }): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  rm(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void>;
}

export const NODE_FS: BackupFs = {
  mkdir: (path, options) => mkdir(path, options),
  readdir: (path) => readdir(path),
  stat: (path) => stat(path),
  copyFile: (from, to) => copyFile(from, to),
  cp: (from, to, options) => cp(from, to, options),
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, data, options) => writeFile(path, data, options),
  chmod: (path, mode) => chmod(path, mode),
  rm: (path, options) => rm(path, options),
};

export async function exists(fs: BackupFs, path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function fileExists(fs: BackupFs, path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function directoryExists(fs: BackupFs, path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Sum of the sizes of every file under `dir`, as the size estimate shown by the CLI and API. */
export async function directorySize(fs: BackupFs, dir: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.readdir(dir)) {
    const path = join(dir, entry);
    const info = await fs.stat(path);
    total += info.isDirectory() ? await directorySize(fs, path) : info.size;
  }
  return total;
}
