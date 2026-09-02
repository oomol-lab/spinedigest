import { mkdtemp, rm } from "fs/promises";
import { join } from "path";

import {
  DirectoryDocument,
  TOC_FILE_VERSION,
  writeWikgArchive,
} from "../../../core/src/index.js";
import { NodeDirectory, NodeFile } from "../runtime/node-platform.js";

export async function createEmptyArchive(input: {
  readonly tempDir: string;
  readonly path: string;
}): Promise<void> {
  const sourceDir = await mkdtemp(join(input.tempDir, "wikg-source-"));
  const directory = new NodeDirectory(sourceDir);
  const document = await DirectoryDocument.open(directory);

  try {
    try {
      await document.openSession(async (openedDocument) => {
        await openedDocument.writeToc({ items: [], version: TOC_FILE_VERSION });
      });
    } finally {
      await document.release();
    }
    await writeWikgArchive(directory, new NodeFile(input.path));
  } finally {
    await rm(sourceDir, { force: true, recursive: true });
  }
}
