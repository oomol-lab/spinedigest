import { mkdtemp, rm } from "fs/promises";
import { join } from "path";

import {
  DirectoryDocument,
  TOC_FILE_VERSION,
  writeWikgArchive,
} from "../../../core/src/index.js";

export async function createEmptyArchive(input: {
  readonly tempDir: string;
  readonly path: string;
}): Promise<void> {
  const sourceDir = await mkdtemp(join(input.tempDir, "wikg-source-"));
  const document = await DirectoryDocument.open(sourceDir);

  try {
    try {
      await document.openSession(async (openedDocument) => {
        await openedDocument.writeToc({ items: [], version: TOC_FILE_VERSION });
      });
    } finally {
      await document.release();
    }
    await writeWikgArchive(sourceDir, input.path);
  } finally {
    await rm(sourceDir, { force: true, recursive: true });
  }
}
