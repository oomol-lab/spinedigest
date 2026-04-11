import type { ReadonlyDocument } from "../document/index.js";
import type { DigestProgressTracker } from "../progress/index.js";
import { writeEpub, writePlainText } from "../output/index.js";
import type { BookMeta, SourceAsset, TocFile } from "../source/index.js";

import { writeSdpubArchive } from "./archive.js";

export class SpineDigest {
  readonly #document: ReadonlyDocument;
  readonly #documentDirectoryPath: string;
  readonly #progressTracker: DigestProgressTracker | undefined;

  public constructor(
    document: ReadonlyDocument,
    documentDirectoryPath: string,
    progressTracker?: DigestProgressTracker,
  ) {
    this.#document = document;
    this.#documentDirectoryPath = documentDirectoryPath;
    this.#progressTracker = progressTracker;
  }

  public async exportEpub(path: string): Promise<void> {
    await this.#progressTracker?.emitExportStarted("epub", path);
    await writeEpub({
      document: this.#document,
      path,
    });
    await this.#progressTracker?.emitExportCompleted("epub", path);
  }

  public async exportText(path: string): Promise<void> {
    await this.#progressTracker?.emitExportStarted("text", path);
    await writePlainText({
      document: this.#document,
      path,
    });
    await this.#progressTracker?.emitExportCompleted("text", path);
  }

  public async readCover(): Promise<SourceAsset | undefined> {
    return await this.#document.readCover();
  }

  public async readMeta(): Promise<BookMeta | undefined> {
    return await this.#document.readBookMeta();
  }

  public async readToc(): Promise<TocFile | undefined> {
    return await this.#document.readToc();
  }

  public async saveAs(path: string): Promise<void> {
    await this.#progressTracker?.emitExportStarted("sdpub", path);
    await flushDocument(this.#document);
    await writeSdpubArchive(this.#documentDirectoryPath, path);
    await this.#progressTracker?.emitExportCompleted("sdpub", path);
  }
}

async function flushDocument(document: ReadonlyDocument): Promise<void> {
  if (!isFlushableDocument(document)) {
    return;
  }

  await document.flush();
}

function isFlushableDocument(
  document: ReadonlyDocument,
): document is ReadonlyDocument & { flush(): Promise<void> } {
  return "flush" in document && typeof document.flush === "function";
}
