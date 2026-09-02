import {
  getHostEntryLastModified,
  isDirectory,
  readHostEntrySize,
  type Directory,
  type File,
} from "../platform/index.js";

const DISPOSABLE_DIRECTORY_ENTRIES = new Set([".DS_Store"]);
const DISPOSABLE_DIRECTORY_TTL_MS = 60_000;

export function isDisposableDirectoryEntry(name: string): boolean {
  return DISPOSABLE_DIRECTORY_ENTRIES.has(name);
}

export async function removeDisposableDirectory(
  parent: Directory,
  directory: Directory,
): Promise<number> {
  const entries = await directory.list();
  if (entries.some((entry) => !isDisposableDirectoryEntry(entry.name))) {
    return 0;
  }
  const freedBytes = await readPathSize(directory);
  await parent.remove(directory.name, { recursive: true });
  return freedBytes;
}

export async function removeDisposableChildDirectories(
  root: Directory,
): Promise<{
  readonly freedBytes: number;
  readonly removed: number;
  readonly scanned: number;
}> {
  let freedBytes = 0;
  let removed = 0;
  let scanned = 0;
  for (const entry of await root.list()) {
    if (!isDirectory(entry)) continue;
    scanned += 1;
    const modifiedAt = await getHostEntryLastModified(entry);
    if (
      modifiedAt === undefined ||
      Date.now() - modifiedAt < DISPOSABLE_DIRECTORY_TTL_MS
    ) {
      continue;
    }
    const bytes = await removeDisposableDirectory(root, entry);
    if (bytes > 0 || (await root.getDirectory(entry.name)) === undefined) {
      freedBytes += bytes;
      removed += 1;
    }
  }
  return { freedBytes, removed, scanned };
}

export async function removeDisposableDescendantDirectories(
  root: Directory,
): Promise<{
  readonly freedBytes: number;
  readonly removed: number;
  readonly scanned: number;
}> {
  let freedBytes = 0;
  let removed = 0;
  let scanned = 0;
  for (const entry of await root.list()) {
    if (!isDirectory(entry)) continue;
    const child = await removeDisposableDescendantDirectories(entry);
    freedBytes += child.freedBytes;
    removed += child.removed;
    scanned += child.scanned + 1;
    const bytes = await removeDisposableDirectory(root, entry);
    if (bytes > 0 || (await root.getDirectory(entry.name)) === undefined) {
      freedBytes += bytes;
      removed += 1;
    }
  }
  return { freedBytes, removed, scanned };
}

export async function readPathSize(entry: File | Directory): Promise<number> {
  return await readHostEntrySize(entry);
}
