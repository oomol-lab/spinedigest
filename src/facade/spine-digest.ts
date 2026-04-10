import type { ReadonlyDocument } from "../document/index.js";
import { writeEpub, writePlainText } from "../output/index.js";
import type { BookMeta, SourceAsset, TocFile } from "../source/index.js";

import { writeSdpubArchive } from "./archive.js";

export class SpineDigest {
  readonly #document: ReadonlyDocument;
  readonly #documentDirectoryPath: string;

  public constructor(
    document: ReadonlyDocument,
    documentDirectoryPath: string,
  ) {
    this.#document = document;
    this.#documentDirectoryPath = documentDirectoryPath;
  }

  public async exportEpub(path: string): Promise<void> {
    await writeEpub({
      document: this.#document,
      path,
    });
  }

  public async exportText(path: string): Promise<void> {
    await writePlainText({
      document: this.#document,
      path,
    });
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
    await flushDocument(this.#document);
    await writeSdpubArchive(this.#documentDirectoryPath, path);
  }
}

async function flushDocument(document: ReadonlyDocument): Promise<void> {
  if (!("flush" in document) || typeof document.flush !== "function") {
    return;
  }

  await document.flush();
}
