import { getHostFileHandle, type File } from "../../runtime/platform/index.js";

import { DirectoryDocument } from "../../document/index.js";

import { WikgCoordinator } from "./coordinator.js";
import { deleteArchiveSearchSessions } from "../../retrieval/query/index.js";
import { WikiGraphArchive } from "../../api/wiki-graph-archive.js";

export class WikiGraphArchiveFile {
  readonly #file: File | string;
  readonly #coordinator = new WikgCoordinator();

  public constructor(file: File | string) {
    this.#file = file;
  }

  public async read<T>(
    operation: (digest: WikiGraphArchive) => Promise<T> | T,
    options: {
      readonly documentDirPath?: string;
    } = {},
  ): Promise<T> {
    return await this.readDocument(
      async (document, directoryPath) =>
        await operation(new WikiGraphArchive(document, directoryPath)),
      options,
    );
  }

  public async readDocument<T>(
    operation: (
      document: DirectoryDocument,
      directoryPath: string,
    ) => Promise<T> | T,
    options: {
      readonly documentDirPath?: string;
      readonly searchIndexWritebackPolicy?: "archive" | "cache";
    } = {},
  ): Promise<T> {
    return await this.#coordinator.withArchiveSession(
      this.#file,
      async (session) => {
        if (options.documentDirPath !== undefined) {
          return await session.materializeReadWorkspace(
            options.documentDirPath,
            async (directoryPath) => {
              const document = await DirectoryDocument.open(directoryPath);

              try {
                return await operation(document, directoryPath);
              } finally {
                await document.release();
              }
            },
          );
        }

        const document = await DirectoryDocument.open(
          toHostHandle(this.#file),
          {
            fileStore: session.createFileStore({
              readonlyDatabase: true,
              ...(options.searchIndexWritebackPolicy === undefined
                ? {}
                : {
                    searchIndexWritebackPolicy:
                      options.searchIndexWritebackPolicy,
                  }),
            }),
          },
        );

        try {
          return await operation(
            document,
            typeof this.#file === "string" ? this.#file : document.path,
          );
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
        const document = await DirectoryDocument.open(
          toHostHandle(this.#file),
          {
            fileStore: session.createFileStore({
              ...(options.searchIndexWritebackPolicy === undefined
                ? {}
                : {
                    searchIndexWritebackPolicy:
                      options.searchIndexWritebackPolicy,
                  }),
            }),
          },
        );

        try {
          return await operation(document);
        } finally {
          try {
            await document.release();
          } finally {
            await deleteArchiveSearchSessions(document.path);
          }
        }
      },
    );
  }
}

function toHostHandle(file: File | string): string {
  return typeof file === "string" ? file : getHostFileHandle(file);
}
