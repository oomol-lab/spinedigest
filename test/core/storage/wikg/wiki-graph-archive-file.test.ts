import { mkdir, rename } from "fs/promises";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../../../packages/core/src/document/index.js";
import { WikiGraphArchiveFile } from "../../../../packages/core/src/storage/wikg/wiki-graph-archive-file.js";
import {
  readWikgArchiveEntry,
  writeWikgArchive,
} from "../../../../packages/core/src/storage/wikg/archive/index.js";
import { replaceChapterFtsIndexArtifact } from "../../../../packages/core/src/retrieval/index-artifact/index.js";
import {
  isArchiveSearchIndexCurrent,
  rebuildArchiveSearchIndex,
} from "../../../../packages/core/src/retrieval/query/index.js";
import {
  installWikiGraphPlatform,
  withWikiGraphStorage,
} from "../../../../packages/core/src/runtime/platform/index.js";
import {
  createNodeWikiGraphStorage,
  installNodeWikiGraphPlatform,
  NodeDirectory,
  NodeFile,
  nodeWikiGraphPlatform,
} from "../../../../packages/cli/src/runtime/node-platform.js";
import { withTempDir } from "../../../helpers/temp.js";

afterEach(() => {
  installNodeWikiGraphPlatform();
});

describe("wikg/wiki-graph-archive-file", () => {
  it("reads and writes an archive through opaque File capabilities", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const file = new WikiGraphArchiveFile(archive);
      await expect(
        file.read(async (digest) => await digest.readToc()),
      ).resolves.toMatchObject({
        items: [{ serialId: 1, title: "Original" }],
      });

      await file.write(async (document) => {
        await document.replaceToc({
          items: [
            { children: [], key: "chapter", serialId: 1, title: "Updated" },
          ],
          version: 1,
        });
      });

      await expect(
        file.read(async (digest) => await digest.readToc()),
      ).resolves.toMatchObject({
        items: [{ serialId: 1, title: "Updated" }],
      });
    });
  });

  it("does not materialize unrelated ZIP entries during an ordinary read", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const initialReader = await nodeWikiGraphPlatform.zip.open(archive);
      const sentinel = (await initialReader.listEntries()).find((entry) =>
        entry.startsWith("texts/"),
      );
      await initialReader.close();
      expect(sentinel).toBeDefined();

      const readEntries: string[] = [];
      installWikiGraphPlatform({
        ...nodeWikiGraphPlatform,
        zip: {
          ...nodeWikiGraphPlatform.zip,
          open: async (file) => {
            const reader = await nodeWikiGraphPlatform.zip.open(file);
            return {
              close: async () => await reader.close(),
              listEntries: async () => await reader.listEntries(),
              readEntry: async (name) => {
                readEntries.push(name);
                if (name === sentinel) {
                  throw new Error(`Unrelated ZIP entry was read: ${name}`);
                }
                return await reader.readEntry(name);
              },
            };
          },
        },
      });

      await expect(
        new WikiGraphArchiveFile(archive).read(
          async (digest) => await digest.readToc(),
        ),
      ).resolves.toMatchObject({ items: [{ title: "Original" }] });
      expect(readEntries).not.toContain(sentinel);
    });
  });

  it("rolls back archive writes when the operation fails", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const file = new WikiGraphArchiveFile(archive);
      await expect(
        file.write(async (document) => {
          await document.replaceToc({ items: [], version: 1 });
          throw new Error("stop");
        }),
      ).rejects.toThrow("stop");
      await expect(
        file.read(async (digest) => await digest.readToc()),
      ).resolves.toMatchObject({
        items: [{ title: "Original" }],
      });
    });
  });

  it("serializes concurrent access by opaque file identity", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const file = new WikiGraphArchiveFile(archive);
      const order: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = file.write(async () => {
        order.push("first-start");
        await gate;
        order.push("first-end");
      });
      const second = file.read(() => {
        order.push("second");
      });
      await Promise.resolve();
      release();
      await Promise.all([first, second]);
      expect(order).toStrictEqual(["first-start", "first-end", "second"]);
    });
  });

  it("keeps an external search index cache across archive sessions", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const file = new WikiGraphArchiveFile(archive);

      await file.write(
        async (document) => {
          await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(
            false,
          );
          await rebuildArchiveSearchIndex(document);
          await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(
            true,
          );
        },
        { searchIndexWritebackPolicy: "cache" },
      );

      await file.readDocument(
        async (document) => {
          await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(
            true,
          );
        },
        { searchIndexWritebackPolicy: "cache" },
      );
      await expect(readWikgArchiveEntry(archive, "index.db")).resolves.toBe(
        undefined,
      );
    });
  });

  it("reuses an external search index cache after its archive moves", async () => {
    await withArchiveFixture(async ({ archive, root }) => {
      await new WikiGraphArchiveFile(archive).write(
        async (document) => {
          await rebuildArchiveSearchIndex(document);
        },
        { searchIndexWritebackPolicy: "cache" },
      );

      const movedPath = join(root, "moved.wikg");
      await rename(archive.path, movedPath);
      const movedArchive = new NodeFile(movedPath);

      await new WikiGraphArchiveFile(movedArchive).readDocument(
        async (document) => {
          await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(
            true,
          );
        },
        { searchIndexWritebackPolicy: "cache" },
      );
    });
  });

  it("rolls back an external search index cache when a session fails", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const file = new WikiGraphArchiveFile(archive);
      await file.write(
        async (document) => {
          await rebuildArchiveSearchIndex(document);
        },
        { searchIndexWritebackPolicy: "cache" },
      );

      await expect(
        file.write(
          async (document) => {
            await document.writeSearchIndexDatabase(async (database) => {
              await database.run("DELETE FROM search_index_state");
            });
            throw new Error("stop cache write");
          },
          { searchIndexWritebackPolicy: "cache" },
        ),
      ).rejects.toThrow("stop cache write");

      await file.readDocument(
        async (document) => {
          await expect(isArchiveSearchIndexCurrent(document)).resolves.toBe(
            true,
          );
        },
        { searchIndexWritebackPolicy: "cache" },
      );
    });
  });
});

async function withArchiveFixture(
  operation: (fixture: {
    readonly archive: NodeFile;
    readonly root: string;
  }) => Promise<void>,
): Promise<void> {
  await withTempDir("wikigraph-host-archive-", async (root) => {
    const stateRoot = join(root, "state");
    const documentPath = join(root, "document");
    await mkdir(documentPath, { recursive: true });
    await withWikiGraphStorage(
      createNodeWikiGraphStorage(stateRoot),
      async () => {
        const directory = new NodeDirectory(documentPath);
        const document = await DirectoryDocument.open(directory);
        try {
          await document.openSession(async (openedDocument) => {
            await openedDocument.createSerial();
            const draft = await openedDocument
              .getSerialFragments(1)
              .createDraft();
            draft.addSentence("Persistent archive cache source.", 4);
            await draft.commit();
          });
          await document.writeToc({
            items: [
              { children: [], key: "chapter", serialId: 1, title: "Original" },
            ],
            version: 1,
          });
          await replaceChapterFtsIndexArtifact(document, 1);
        } finally {
          await document.release();
        }
        const archive = new NodeFile(join(root, "book.wikg"));
        await writeWikgArchive(directory, archive);
        await operation({ archive, root });
      },
    );
  });
}
