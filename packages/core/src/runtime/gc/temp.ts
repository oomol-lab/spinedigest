import {
  getHostEntryLastModified,
  getWikiGraphStorage,
  isDirectory,
  type Directory,
  type File,
} from "../platform/index.js";

import { readPathSize } from "./files.js";
import type { GcContext, GcJobResult } from "./types.js";

const TEMP_DIRECTORY_TTL_MS = 60 * 60 * 1000;

export async function runTempDirectoryGc(
  context: GcContext,
): Promise<GcJobResult> {
  const root = await getWikiGraphStorage().library.getDirectory("tmp");
  let scanned = 0;
  let removed = 0;
  let freedBytes = 0;

  if (root === undefined) return { freedBytes, removed, scanned };
  for (const entry of await listTempEntries(root)) {
    scanned += 1;
    const lastModified = await getHostEntryLastModified(entry.value);

    if (
      !context.force &&
      (lastModified === undefined ||
        context.now - lastModified < TEMP_DIRECTORY_TTL_MS)
    ) {
      continue;
    }

    const bytes = await readPathSize(entry.value);

    if (!context.dryRun) {
      await entry.parent.remove(entry.value.name, { recursive: true });
    }
    removed += 1;
    freedBytes += bytes;
  }

  return { freedBytes, removed, scanned };
}

async function listTempEntries(
  root: Directory,
): Promise<ReadonlyArray<{ parent: Directory; value: Directory | File }>> {
  const entries: Array<{ parent: Directory; value: Directory | File }> = [];
  for (const category of await root.list()) {
    if (!isDirectory(category)) continue;
    for (const value of await category.list()) {
      entries.push({ parent: category, value });
    }
  }
  return entries;
}
