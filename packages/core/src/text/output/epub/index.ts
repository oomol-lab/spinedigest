import type { ReadonlyDocument } from "../../../document/index.js";
import type { File } from "../../../runtime/platform/index.js";

import { writeEpubArchive } from "./archive.js";
import { buildEpubBook } from "./book.js";
import { EPUB_OUTPUT_VERSION } from "./package.js";

export interface WriteEpubOptions {
  readonly document: ReadonlyDocument;
  readonly file: File;
}

export async function writeEpub(options: WriteEpubOptions): Promise<void> {
  const book = await options.document.openSession(async (document) => {
    return await buildEpubBook(document);
  });

  await writeEpubArchive(options.file, book);
}

export { EPUB_OUTPUT_VERSION };
