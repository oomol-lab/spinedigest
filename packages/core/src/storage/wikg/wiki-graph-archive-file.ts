import type { File } from "../../runtime/platform/index.js";

import { DirectoryDocument } from "../../document/index.js";
import { WikiGraphArchive } from "../../api/wiki-graph-archive.js";
import { deleteArchiveSearchSessions } from "../../retrieval/query/index.js";

import { WikgCoordinator } from "./coordinator.js";

/** A .wikg archive exposed to Core as an opaque host File capability. */
export class WikiGraphArchiveFile {
  readonly #file: File;
  readonly #coordinator = new WikgCoordinator();

  public constructor(file: File) {
    this.#file = file;
  }

  public async read<T>(
    operation: (archive: WikiGraphArchive) => Promise<T> | T,
  ): Promise<T> {
    return await this.readDocument(
      async (document) =>
        await operation(
          new WikiGraphArchive(document, this.#file, { sourceKind: "archive" }),
        ),
    );
  }

  public async readDocument<T>(
    operation: (document: DirectoryDocument) => Promise<T> | T,
    options: { readonly searchIndexWritebackPolicy?: "archive" | "cache" } = {},
  ): Promise<T> {
    return await this.#coordinator.withArchiveSession(
      this.#file,
      async (session) => {
        const fileStore = session.createFileStore({
          readonlyDatabase: true,
          ...(options.searchIndexWritebackPolicy === undefined
            ? {}
            : {
                searchIndexWritebackPolicy: options.searchIndexWritebackPolicy,
              }),
        });
        const document = await DirectoryDocument.openFileStore(fileStore);
        try {
          return await operation(document);
        } finally {
          await document.release();
        }
      },
    );
  }

  public async write<T>(
    operation: (document: DirectoryDocument) => Promise<T> | T,
    options: { readonly searchIndexWritebackPolicy?: "archive" | "cache" } = {},
  ): Promise<T> {
    return await this.#coordinator.withArchiveSession(
      this.#file,
      async (session) => {
        const fileStore = session.createFileStore({
          ...(options.searchIndexWritebackPolicy === undefined
            ? {}
            : {
                searchIndexWritebackPolicy: options.searchIndexWritebackPolicy,
              }),
        });
        const document = await DirectoryDocument.openFileStore(fileStore);
        try {
          return await operation(document);
        } finally {
          try {
            await document.release();
          } finally {
            await deleteArchiveSearchSessions(this.#file.identity);
          }
        }
      },
    );
  }
}
