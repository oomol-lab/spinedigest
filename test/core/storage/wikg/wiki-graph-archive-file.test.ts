import { createHash } from "crypto";
import { access, mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { setTimeout as sleep } from "timers/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  Database,
  DirectoryDocument,
} from "../../../../packages/core/src/document/index.js";
import {
  getWikiGraphStateDirectoryPathForTesting,
  setWikiGraphStateDirectoryPathForTesting,
} from "../../../../packages/core/src/runtime/common/wiki-graph/dir.js";
import {
  findArchiveObjects,
  rebuildArchiveSearchIndex,
} from "../../../../packages/core/src/retrieval/query/view.js";
import { replaceChapterFtsIndexArtifact } from "../../../../packages/core/src/retrieval/index-artifact/index.js";
import { isSearchIndexCurrent } from "../../../../packages/core/src/retrieval/search-index/index.js";
import { SEARCH_INDEX_VERSION } from "../../../../packages/core/src/retrieval/search-index/search/types.js";
import { WikiGraphArchive } from "../../../../packages/core/src/api/wiki-graph-archive.js";
import { WikiGraphArchiveFile } from "../../../../packages/core/src/storage/wikg/wiki-graph-archive-file.js";
import {
  readWikgArchiveEntry,
  writeWikgArchiveWithOverlays,
} from "../../../../packages/core/src/storage/wikg/archive/index.js";
import {
  createArchiveKey as createCoordinatorArchiveKey,
  createArchiveSignature,
} from "../../../../packages/core/src/storage/wikg/wikg-coordinator/archive-key.js";
import { withStateDatabase } from "../../../../packages/core/src/storage/wikg/wikg-coordinator/state.js";
import { withTempDir } from "../../../helpers/temp.js";

const originalStateDir = getWikiGraphStateDirectoryPathForTesting();

describe("wikg/wiki-graph-archive-file", () => {
  afterEach(() => {
    restoreCoordinatorEnv();
  });

  it("opens a saved archive for reading and exposes digest operations", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const document = await DirectoryDocument.open(`${path}/document`);

        try {
          await seedDocument(document);

          const archivePath = `${path}/fixture/book.wikg`;
          await new WikiGraphArchive(document, document.path).saveAs(
            archivePath,
          );

          const digestFile = new WikiGraphArchiveFile(archivePath);
          const exportedText = await digestFile.read(async (digest) => {
            const textPath = `${path}/exports/from-read.txt`;

            expect(await digest.readMeta()).toMatchObject({
              title: "Session Fixture",
            });
            expect(await digest.readToc()).toMatchObject({
              items: [
                {
                  title: "Recovered Chapter",
                  serialId: 1,
                },
              ],
            });

            await digest.exportText(textPath);
            return await readFile(textPath, "utf8");
          });

          expect(exportedText).toBe("Recovered Chapter\n\nRecovered summary\n");
        } finally {
          await document.release();
        }
      } finally {
        restoreStateDir();
      }
    });
  });

  it("keeps a custom extraction directory when one is provided", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const document = await DirectoryDocument.open(`${path}/document`);

        try {
          await seedDocument(document);

          const archivePath = `${path}/fixture/book.wikg`;
          const readDir = `${path}/opened-read`;

          await new WikiGraphArchive(document, document.path).saveAs(
            archivePath,
          );

          const digestFile = new WikiGraphArchiveFile(archivePath);
          await digestFile.read(
            async (digest) => {
              expect(await digest.readMeta()).toMatchObject({
                title: "Session Fixture",
              });
            },
            {
              documentDirPath: readDir,
            },
          );
        } finally {
          await document.release();
        }
      } finally {
        restoreStateDir();
      }
    });
  });

  it("keeps read-only sqlite materialization as coordinator cache", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new WikiGraphArchiveFile(archivePath).read(async (digest) => {
          expect(await digest.readMeta()).toMatchObject({
            title: "Session Fixture",
          });
        });

        const overlays = await readCoordinatorOverlays(path);

        expect(overlays).toHaveLength(1);
        expect(overlays[0]).toMatchObject({
          archivePath,
          entryPath: "database.db",
          kind: "file",
        });
        expect(overlays[0]?.workspacePath).toMatch(/\/database\.db$/u);
      } finally {
        restoreStateDir();
      }
    });
  });

  it("opens the same archive concurrently without reinitializing sqlite schema", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await Promise.all(
          Array.from(
            { length: 6 },
            async () =>
              await new WikiGraphArchiveFile(archivePath).read(
                async (digest) => {
                  expect(await digest.readMeta()).toMatchObject({
                    title: "Session Fixture",
                  });
                },
              ),
          ),
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("blocks search index cache writes while another session holds a read lease", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);
        await new WikiGraphArchiveFile(archivePath).write(
          async (document) => {
            await rebuildArchiveSearchIndex(document);
          },
          { searchIndexWritebackPolicy: "cache" },
        );
        let releaseReader!: () => void;
        let resolveReaderEntered!: () => void;
        let writerEntered = false;
        const readerEntered = new Promise<void>((resolveEntered) => {
          resolveReaderEntered = resolveEntered;
        });
        const reader = new WikiGraphArchiveFile(archivePath).readDocument(
          async (document) => {
            await document.readSearchIndexDatabase(async (database) => {
              await database.queryOne(
                "SELECT value FROM search_index_state WHERE key = 'version'",
                undefined,
                (row) => expectString(row.value),
              );
              resolveReaderEntered();
              await new Promise<void>((resolveReader) => {
                releaseReader = resolveReader;
              });
            });
          },
        );

        try {
          await readerEntered;

          const writer = new WikiGraphArchiveFile(archivePath).write(
            async (document) => {
              await document.writeSearchIndexDatabase(() => {
                writerEntered = true;
              });
            },
            { searchIndexWritebackPolicy: "cache" },
          );

          await sleep(250);
          expect(writerEntered).toBe(false);

          releaseReader();
          await expect(writer).resolves.toBeUndefined();
          await expect(reader).resolves.toBeUndefined();
          expect(writerEntered).toBe(true);
        } catch (error) {
          releaseReader?.();
          await reader.catch(() => undefined);
          throw error;
        }
      } finally {
        restoreStateDir();
      }
    });
  });

  it("flushes successful archive writes back to the archive", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new WikiGraphArchiveFile(archivePath).write(async (document) => {
          const meta = await document.readBookMeta();

          if (meta === undefined) {
            throw new Error("Missing test metadata.");
          }

          await document.replaceBookMeta({
            ...meta,
            title: "Flushed Title",
          });
        });

        await expect(readArchivedTitle(archivePath)).resolves.toBe(
          "Flushed Title",
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("keeps sqlite cache when write sessions only read the database", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new WikiGraphArchiveFile(archivePath).readDocument(
          async (document) => {
            await expect(document.peekNextSerialId()).resolves.toBe(2);
          },
        );

        await new WikiGraphArchiveFile(archivePath).write(async (document) => {
          await expect(document.peekNextSerialId()).resolves.toBe(2);
        });

        await expect(readCoordinatorOverlays(path)).resolves.toStrictEqual([
          expect.objectContaining({
            archivePath,
            entryPath: "database.db",
            kind: "file",
          }),
        ]);
      } finally {
        restoreStateDir();
      }
    });
  });

  it("flushes sqlite cache when write sessions mutate the database", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new WikiGraphArchiveFile(archivePath).readDocument(
          async (document) => {
            await expect(document.peekNextSerialId()).resolves.toBe(2);
          },
        );

        await new WikiGraphArchiveFile(archivePath).write(async (document) => {
          await document.createSerial();
        });

        await expect(readCoordinatorOverlays(path)).resolves.toStrictEqual([]);
        await new WikiGraphArchiveFile(archivePath).readDocument(
          async (document) => {
            await expect(document.peekNextSerialId()).resolves.toBe(3);
          },
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("drops legacy fts.db when flushing mutated database overlays", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);
        const legacyIndexPath = `${path}/legacy-fts.db`;
        const rewrittenPath = `${path}/legacy-search.wikg`;

        await writeFile(legacyIndexPath, "legacy-index", "utf8");
        await writeWikgArchiveWithOverlays(archivePath, rewrittenPath, [
          { entryPath: "fts.db", kind: "file", workspacePath: legacyIndexPath },
        ]);
        await rename(rewrittenPath, archivePath);

        await expect(
          readWikgArchiveEntry(archivePath, "fts.db"),
        ).resolves.toBeUndefined();

        await new WikiGraphArchiveFile(archivePath).write(async (document) => {
          await document.createSerial();
        });

        await expect(readWikgArchiveEntry(archivePath, "fts.db")).resolves.toBe(
          undefined,
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("clears cached archive searches after successful writes", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new WikiGraphArchiveFile(archivePath).write(
          async (document) => {
            await rebuildArchiveSearchIndex(document);
          },
          { searchIndexWritebackPolicy: "cache" },
        );

        await new WikiGraphArchiveFile(archivePath).readDocument(
          async (document) => {
            await expect(
              findArchiveObjects(document, "fresh source sentence", {
                archiveKey: archivePath,
              }),
            ).resolves.toMatchObject({
              items: [
                expect.objectContaining({
                  type: "source",
                }),
              ],
            });
          },
        );

        await new WikiGraphArchiveFile(archivePath).write(async (document) => {
          await document.openSession(async (openedDocument) => {
            const draft = await openedDocument
              .getSerialFragments(1)
              .createDraft();
            draft.addSentence("Updated cache source sentence.", 4);
            await draft.commit();
          });
        });
        await new WikiGraphArchiveFile(archivePath).write(
          async (document) => {
            await replaceChapterFtsIndexArtifact(document, 1);
            await rebuildArchiveSearchIndex(document);
          },
          { searchIndexWritebackPolicy: "cache" },
        );

        await new WikiGraphArchiveFile(archivePath).readDocument(
          async (document) => {
            await expect(
              findArchiveObjects(document, "updated cache source sentence", {
                archiveKey: archivePath,
              }),
            ).resolves.toMatchObject({
              items: [
                expect.objectContaining({
                  type: "source",
                }),
              ],
            });
          },
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("adopts orphaned external FTS cache after moving an archive", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);
        const movedArchivePath = `${path}/moved/book.wikg`;

        await new WikiGraphArchiveFile(archivePath).write(
          async (document) => {
            await rebuildArchiveSearchIndex(document);
          },
          { searchIndexWritebackPolicy: "cache" },
        );

        const beforeOverlays = await readCoordinatorOverlays(path);
        const oldFtsOverlay = beforeOverlays.find(
          (overlay) => overlay.entryPath === "index.db",
        );

        expect(oldFtsOverlay).toMatchObject({
          archivePath,
          entryPath: "index.db",
          kind: "file",
        });
        expect(oldFtsOverlay?.workspacePath).toContain(
          createArchiveKey(archivePath),
        );

        await mkdir(`${path}/moved`, { recursive: true });
        await rename(archivePath, movedArchivePath);
        await new WikiGraphArchiveFile(movedArchivePath).readDocument(
          async (document) => {
            await expect(isSearchIndexCurrent(document)).resolves.toBe(true);
          },
        );

        const afterOverlays = await readCoordinatorOverlays(path);
        const newFtsOverlay = afterOverlays.find(
          (overlay) =>
            overlay.entryPath === "index.db" &&
            overlay.archivePath === movedArchivePath,
        );

        expect(newFtsOverlay).toMatchObject({
          archivePath: movedArchivePath,
          entryPath: "index.db",
          kind: "file",
        });
        expect(newFtsOverlay?.workspacePath).toContain(
          createArchiveKey(movedArchivePath),
        );
        await expect(access(oldFtsOverlay!.workspacePath!)).rejects.toThrow();
      } finally {
        restoreStateDir();
      }
    });
  });

  it("treats an incompatible archive-backed index cache as missing on read", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await createIncompatibleSearchIndexOverlay(path, archivePath);
        await expect(readCoordinatorOverlays(path)).resolves.toContainEqual(
          expect.objectContaining({
            archivePath,
            entryPath: "index.db",
            kind: "file",
          }),
        );

        await expect(
          new WikiGraphArchiveFile(archivePath).readDocument(
            async (document) => await isSearchIndexCurrent(document),
            { searchIndexWritebackPolicy: "cache" },
          ),
        ).resolves.toBe(false);

        await expect(readCoordinatorOverlays(path)).resolves.toContainEqual(
          expect.objectContaining({
            archivePath,
            entryPath: "index.db",
            kind: "deleted",
          }),
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("reinitializes an incompatible archive-backed index cache on write", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await createIncompatibleSearchIndexOverlay(path, archivePath);

        await new WikiGraphArchiveFile(archivePath).write(
          async (document) => {
            await document.writeSearchIndexDatabase(async (database) => {
              await database.run(
                `
                  INSERT INTO search_index_state(key, value)
                  VALUES ('version', ?)
                `,
                [SEARCH_INDEX_VERSION],
              );
            });
            await expect(
              document.readSearchIndexDatabase(
                async (database) =>
                  await database.queryOne(
                    `
                      SELECT value
                      FROM search_index_state
                      WHERE key = 'version'
                    `,
                    undefined,
                    (row) => String(row.value),
                  ),
              ),
            ).resolves.toBe(SEARCH_INDEX_VERSION);
          },
          { searchIndexWritebackPolicy: "cache" },
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("does not let unrelated stale overlays fail archive writes", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);
        await createStaleOverlay(path);

        await new WikiGraphArchiveFile(archivePath).write(async (document) => {
          const meta = await document.readBookMeta();

          if (meta === undefined) {
            throw new Error("Missing test metadata.");
          }

          await document.replaceBookMeta({
            ...meta,
            title: "Fresh Title",
          });
        });

        await expect(readArchivedTitle(archivePath)).resolves.toBe(
          "Fresh Title",
        );
        await expect(readCoordinatorOverlays(path)).resolves.not.toContainEqual(
          expect.objectContaining({
            archivePath: `${path}/missing/book.wikg`,
            entryPath: "database.db",
            kind: "file",
          }),
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("settles failed archive writes when leaving the archive session", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await expect(
          new WikiGraphArchiveFile(archivePath).write(async (document) => {
            const meta = await document.readBookMeta();

            if (meta === undefined) {
              throw new Error("Missing test metadata.");
            }

            await document.replaceBookMeta({
              ...meta,
              title: "Unflushed Title",
            });
            throw new Error("stop before flush");
          }),
        ).rejects.toThrow("stop before flush");

        await expect(readArchivedTitle(archivePath)).resolves.toBe(
          "Unflushed Title",
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("reads materialized workspace state while flush is pending", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await new WikiGraphArchiveFile(archivePath).write(async (document) => {
          const meta = await document.readBookMeta();

          if (meta === undefined) {
            throw new Error("Missing test metadata.");
          }

          await document.replaceBookMeta({
            ...meta,
            title: "Workspace Title",
          });
        });

        await new WikiGraphArchiveFile(archivePath).read(async (digest) => {
          expect(await digest.readMeta()).toMatchObject({
            title: "Workspace Title",
          });
        });
        await expect(readArchivedTitle(archivePath)).resolves.toBe(
          "Workspace Title",
        );
      } finally {
        restoreStateDir();
      }
    });
  });

  it("runs concurrent writes to different archive entries", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);
        await Promise.all([
          new WikiGraphArchiveFile(archivePath).write(async (document) => {
            const meta = await document.readBookMeta();

            if (meta === undefined) {
              throw new Error("Missing test metadata.");
            }

            await document.replaceBookMeta({
              ...meta,
              title: "Concurrent Title",
            });
          }),
          new WikiGraphArchiveFile(archivePath).write(async (document) => {
            await document.replaceToc({
              items: [
                {
                  children: [],
                  serialId: 1,
                  title: "Concurrent Chapter",
                },
              ],
              version: 1,
            });
          }),
        ]);

        await new WikiGraphArchiveFile(archivePath).read(async (digest) => {
          expect(await digest.readMeta()).toMatchObject({
            title: "Concurrent Title",
          });
          expect(await digest.readToc()).toMatchObject({
            items: [
              {
                title: "Concurrent Chapter",
              },
            ],
          });
        });
      } finally {
        restoreStateDir();
      }
    });
  });

  it("preserves a failed write overlay for later reads", async () => {
    await withTempDir("wikigraph-facade-file-", async (path) => {
      const restoreStateDir = useCoordinatorStateDir(`${path}/state`);
      try {
        const archivePath = await createSeedArchive(path);

        await expect(
          new WikiGraphArchiveFile(archivePath).write(async (document) => {
            const meta = await document.readBookMeta();

            if (meta === undefined) {
              throw new Error("Missing test metadata.");
            }

            await document.replaceBookMeta({
              ...meta,
              title: "Failed Overlay Title",
            });
            throw new Error("keep overlay");
          }),
        ).rejects.toThrow("keep overlay");

        await new WikiGraphArchiveFile(archivePath).read(async (digest) => {
          expect(await digest.readMeta()).toMatchObject({
            title: "Failed Overlay Title",
          });
        });
      } finally {
        restoreStateDir();
      }
    });
  });
});

async function seedDocument(document: DirectoryDocument): Promise<void> {
  await document.openSession(async (openedDocument) => {
    await openedDocument.createSerial();
    const draft = await openedDocument.getSerialFragments(1).createDraft();
    draft.addSentence("Fresh source sentence.", 3);
    await draft.commit();
    await openedDocument.writeBookMeta({
      authors: ["Ari Lantern"],
      description: null,
      identifier: "urn:test:wiki-graph-archive-file",
      language: "en",
      publishedAt: null,
      publisher: null,
      sourceFormat: "txt",
      title: "Session Fixture",
      version: 1,
    });
    await openedDocument.writeSummary(1, "Recovered summary");
    await openedDocument.writeToc({
      items: [
        {
          children: [],
          key: "a1b2c3d4e5f6",
          serialId: 1,
          title: "Recovered Chapter",
        },
      ],
      version: 1,
    });
  });
}

async function createSeedArchive(path: string): Promise<string> {
  const document = await DirectoryDocument.open(`${path}/document`);

  try {
    await seedDocument(document);
    await replaceChapterFtsIndexArtifact(document, 1);
    await rebuildArchiveSearchIndex(document);

    const archivePath = `${path}/fixture/book.wikg`;

    await new WikiGraphArchive(document, document.path).saveAs(archivePath);
    return archivePath;
  } finally {
    await document.release();
  }
}

async function readArchivedTitle(archivePath: string): Promise<string | null> {
  const meta = await new WikiGraphArchiveFile(archivePath).read(
    async (digest) => await digest.readMeta(),
  );

  return meta?.title ?? null;
}

async function readCoordinatorOverlays(path: string): Promise<
  Array<{
    readonly archivePath: string;
    readonly entryPath: string;
    readonly kind: string;
    readonly workspacePath?: string;
  }>
> {
  try {
    await access(`${path}/state/staging/staging.sqlite`);
  } catch {
    return [];
  }

  const { Database } =
    await import("../../../../packages/core/src/document/index.js");
  const database = await Database.open(
    `${path}/state/staging/staging.sqlite`,
    "",
    { readonly: true },
  );

  try {
    return await database.queryAll(
      `
SELECT archive_path, entry_path, kind, workspace_path
FROM entry_overlays
ORDER BY archive_path, entry_path
`,
      undefined,
      (row) => ({
        archivePath: expectString(row.archive_path),
        entryPath: expectString(row.entry_path),
        kind: expectString(row.kind),
        ...expectOptionalStringProperty(row.workspace_path, "workspacePath"),
      }),
    );
  } finally {
    await database.close();
  }
}

async function createIncompatibleSearchIndexOverlay(
  path: string,
  archivePath: string,
): Promise<void> {
  const archiveKey = createCoordinatorArchiveKey(archivePath);
  const workspacePath = `${path}/state/staging/work/${archiveKey}/index.db`;

  await mkdir(dirname(workspacePath), { recursive: true });
  const database = await Database.open(
    workspacePath,
    `
      CREATE TABLE search_index_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  );

  try {
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('version', 'old')
      `,
    );
  } finally {
    await database.close();
  }

  await withStateDatabase(async (state) => {
    await state.run(
      `
        INSERT INTO entry_overlays (
          archive_key,
          archive_path,
          entry_path,
          kind,
          workspace_path,
          archive_signature,
          mutation_token,
          updated_at
        )
        VALUES (?, ?, 'index.db', 'file', ?, ?, NULL, ?)
      `,
      [
        archiveKey,
        archivePath,
        workspacePath,
        await createArchiveSignature(archivePath),
        Date.now(),
      ],
    );
  });
}

async function createStaleOverlay(path: string): Promise<void> {
  const { Database } =
    await import("../../../../packages/core/src/document/index.js");

  await mkdir(`${path}/state/staging`, { recursive: true });
  const database = await Database.open(
    `${path}/state/staging/staging.sqlite`,
    `
CREATE TABLE IF NOT EXISTS entry_overlays (
  archive_key TEXT NOT NULL,
  archive_path TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  workspace_path TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (archive_key, entry_path)
);
`,
  );

  try {
    await database.run(
      `
INSERT INTO entry_overlays (
  archive_key, archive_path, entry_path, kind, workspace_path, updated_at
) VALUES (?, ?, ?, ?, ?, ?)
`,
      [
        "missing-archive-key",
        `${path}/missing/book.wikg`,
        "database.db",
        "file",
        `${path}/missing/database.db`,
        Date.now(),
      ],
    );
  } finally {
    await database.close();
  }
}

function createArchiveKey(archivePath: string): string {
  return createHash("sha256").update(resolve(archivePath)).digest("hex");
}

function useCoordinatorStateDir(path: string): () => void {
  const previousStateDir = getWikiGraphStateDirectoryPathForTesting();

  setWikiGraphStateDirectoryPathForTesting(path);

  return () => {
    restoreWikiGraphStateDir(previousStateDir);
  };
}

function restoreCoordinatorEnv(): void {
  restoreWikiGraphStateDir(originalStateDir);
}

function restoreWikiGraphStateDir(value: string | undefined): void {
  setWikiGraphStateDirectoryPathForTesting(value);
}

function expectString(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Expected string.");
  }

  return value;
}

function expectOptionalStringProperty(
  value: unknown,
  key: "workspacePath",
): { readonly workspacePath?: string } {
  if (value === null || value === undefined) {
    return {};
  }

  return { [key]: expectString(value) };
}
