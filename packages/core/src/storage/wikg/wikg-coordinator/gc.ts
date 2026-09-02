import {
  getHostEntryLastModified,
  getWikiGraphStorage,
  isDirectory,
  readHostEntrySize,
} from "../../../runtime/platform/index.js";
import type { GcContext, GcJobResult } from "../../../runtime/gc/index.js";

const ABANDONED_SESSION_TTL_MS = 60 * 60 * 1000;

/** Removes only abandoned workspaces owned by Core below documentStore. */
export async function runWikgCoordinatorGc(
  context: GcContext,
): Promise<GcJobResult> {
  const root = getWikiGraphStorage().documentStore;
  let scanned = 0;
  let removed = 0;
  let freedBytes = 0;
  for (const entry of await root.list()) {
    if (!isDirectory(entry) || !entry.name.startsWith(".wikg-session-")) {
      continue;
    }
    scanned += 1;
    const modifiedAt = await getHostEntryLastModified(entry);
    if (
      !context.force &&
      (modifiedAt === undefined ||
        context.now - modifiedAt < ABANDONED_SESSION_TTL_MS)
    ) {
      continue;
    }
    freedBytes += await readHostEntrySize(entry);
    if (!context.dryRun) await root.remove(entry.name, { recursive: true });
    removed += 1;
  }
  const searchCaches = await root.getDirectory(".wikg-cache");
  if (searchCaches !== undefined) {
    for (const entry of await searchCaches.list()) {
      if (!isDirectory(entry)) continue;
      scanned += 1;
      if (!context.force) continue;
      freedBytes += await readHostEntrySize(entry);
      if (!context.dryRun) {
        await searchCaches.remove(entry.name, { recursive: true });
      }
      removed += 1;
    }
  }
  return { freedBytes, removed, scanned };
}
