import { readdir } from "fs/promises";
import { join, posix, relative, sep } from "path";

import {
  LEGACY_SEARCH_INDEX_DATABASE_PATH,
  SEARCH_INDEX_DATABASE_PATH,
} from "./constants.js";
import { isWikgArchivePath } from "./paths.js";

export async function listDocumentFiles(
  rootDirectoryPath: string,
  currentDirectoryPath = rootDirectoryPath,
): Promise<Array<{ absolutePath: string; archivePath: string }>> {
  const entries = await readdir(currentDirectoryPath, { withFileTypes: true });
  const files: Array<{ absolutePath: string; archivePath: string }> = [];

  for (const entry of [...entries].sort(compareDirEntryName)) {
    const absolutePath = join(currentDirectoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listDocumentFiles(rootDirectoryPath, absolutePath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    files.push({
      absolutePath,
      archivePath: relative(rootDirectoryPath, absolutePath)
        .split(sep)
        .join(posix.sep),
    });
  }

  return files.filter((file) => isWikgArchivePath(file.archivePath));
}

export function shouldWriteDocumentFile(input: {
  readonly archivePath: string;
}): boolean {
  if (input.archivePath === "manifest.json") {
    return false;
  }
  if (input.archivePath === ".wikg-mutation-token") {
    return false;
  }
  if (input.archivePath === LEGACY_SEARCH_INDEX_DATABASE_PATH) {
    return false;
  }
  if (input.archivePath === SEARCH_INDEX_DATABASE_PATH) {
    return false;
  }

  return true;
}

function compareDirEntryName(
  left: { readonly name: string },
  right: { readonly name: string },
): number {
  return left.name.localeCompare(right.name);
}
