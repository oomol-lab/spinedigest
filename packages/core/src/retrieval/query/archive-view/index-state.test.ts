import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../../document/directory/index.js";
import { getNumber } from "../../../document/database.js";
import {
  querySearchIndex,
  readSearchIndexCapabilityStatus,
  TEXT_SENTENCE_KIND,
} from "../../search-index/index.js";
import { rebuildArchiveSearchIndex } from "./index-state.js";

describe("archive search index state", () => {
  it("writes dense text embedding segments when requested", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      const embeddedTexts: string[] = [];

      await rebuildArchiveSearchIndex(document, undefined, {
        embeddingProvider: {
          dimensions: 3,
          model: "test-embedding",
          embedTexts: async (texts) => {
            await Promise.resolve();
            embeddedTexts.push(...texts);
            return {
              embeddings: texts.map((text, index) => [text.length, index, 1]),
              tokens: 9,
            };
          },
        },
        indexes: "fts,dense",
      });

      expect(embeddedTexts).toStrictEqual([
        "Dense indexing writes vectors.\nFTS still indexes the same text.",
      ]);
      await expect(
        document.readSearchIndexDatabase(async (database) => ({
          embeddings: await database.queryOne(
            "SELECT COUNT(*) AS count FROM text_embedding_segments",
            undefined,
            (row) => getNumber(row, "count"),
          ),
          indexed: await database.queryOne(
            "SELECT value FROM search_index_state WHERE key = 'indexes'",
            undefined,
            (row) => String(row.value),
          ),
        })),
      ).resolves.toStrictEqual({
        embeddings: 1,
        indexed: "fts,dense",
      });
      await expect(
        readSearchIndexCapabilityStatus(document),
      ).resolves.toStrictEqual({
        dense: {
          current: true,
          dimensions: 3,
          model: "test-embedding",
        },
        indexes: "fts,dense",
      });
    });
  });

  it("removes dense embeddings when rebuilding fts only", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      await rebuildArchiveSearchIndex(document, undefined, {
        embeddingProvider: createFakeEmbeddingProvider(),
        indexes: "fts,dense",
      });
      await rebuildArchiveSearchIndex(document, undefined, { indexes: "fts" });

      await expect(
        readSearchIndexCapabilityStatus(document),
      ).resolves.toStrictEqual({
        dense: { current: false },
        indexes: "fts",
      });
      await expect(
        document.readSearchIndexDatabase(
          async (database) =>
            await database.queryOne(
              "SELECT COUNT(*) AS count FROM text_embedding_segments",
              undefined,
              (row) => getNumber(row, "count"),
            ),
        ),
      ).resolves.toBe(0);
    });
  });

  it("treats legacy current indexes without capability state as fts", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      await rebuildArchiveSearchIndex(document, undefined, { indexes: "fts" });
      await document.writeSearchIndexDatabase(async (database) => {
        await database.run(
          "DELETE FROM search_index_state WHERE key = 'indexes'",
        );
      });

      await expect(
        readSearchIndexCapabilityStatus(document),
      ).resolves.toStrictEqual({
        dense: { current: false },
        indexes: "fts",
      });
    });
  });

  it("does not report dense current when the index is dirty", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      await rebuildArchiveSearchIndex(document, undefined, {
        embeddingProvider: createFakeEmbeddingProvider(),
        indexes: "fts,dense",
      });
      await document.writeSearchIndexDatabase(async (database) => {
        await database.run(
          `
            INSERT INTO index_dirty_chapters(archive_id, chapter_id, updated_at)
            VALUES (1, 1, ?)
          `,
          [Date.now()],
        );
      });

      await expect(
        readSearchIndexCapabilityStatus(document),
      ).resolves.toStrictEqual({
        dense: {
          current: false,
          dimensions: 3,
          model: "test-embedding",
        },
        indexes: "fts,dense",
      });
    });
  });

  it("treats legacy dense state without segment table as not current", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      await rebuildArchiveSearchIndex(document, undefined, {
        embeddingProvider: createFakeEmbeddingProvider(),
        indexes: "fts,dense",
      });
      await document.writeSearchIndexDatabase(async (database) => {
        await database.run("DROP TABLE text_embedding_segments");
      });

      await expect(
        readSearchIndexCapabilityStatus(document),
      ).resolves.toStrictEqual({
        dense: {
          current: false,
          dimensions: 3,
          model: "test-embedding",
        },
        indexes: "fts,dense",
      });
    });
  });

  it("builds and queries a dense-only text index", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      const provider = createFakeEmbeddingProvider();

      await rebuildArchiveSearchIndex(document, undefined, {
        embeddingProvider: provider,
        indexes: "dense",
      });

      await expect(
        readSearchIndexCapabilityStatus(document),
      ).resolves.toStrictEqual({
        dense: {
          current: true,
          dimensions: 3,
          model: "test-embedding",
        },
        indexes: "dense",
      });
      await expect(
        document.readSearchIndexDatabase(async (database) => ({
          objectFtsRows: await database.queryOne(
            "SELECT COUNT(*) AS count FROM search_object_properties_fts",
            undefined,
            (row) => getNumber(row, "count"),
          ),
          textFtsRows: await database.queryOne(
            "SELECT COUNT(*) AS count FROM text_sentence_fts",
            undefined,
            (row) => getNumber(row, "count"),
          ),
        })),
      ).resolves.toStrictEqual({
        objectFtsRows: 0,
        textFtsRows: 0,
      });

      await expect(
        querySearchIndex(document, "semantic vectors", {
          embeddingProvider: provider,
          types: ["source"],
        }),
      ).resolves.toMatchObject({
        objectHits: [],
        textHits: [
          {
            archiveId: 0,
            chapterId: 1,
            kind: TEXT_SENTENCE_KIND.source,
            sentenceIndex: 0,
          },
          {
            archiveId: 0,
            chapterId: 1,
            kind: TEXT_SENTENCE_KIND.source,
            sentenceIndex: 1,
          },
        ],
      });
    });
  });

  it("falls back to fts when hybrid query embedding fails", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      await rebuildArchiveSearchIndex(document, undefined, {
        embeddingProvider: createFakeEmbeddingProvider(),
        indexes: "fts,dense",
      });

      await expect(
        querySearchIndex(document, "FTS", {
          embeddingProvider: {
            dimensions: 3,
            model: "broken-embedding",
            embedTexts: async () => {
              await Promise.resolve();
              throw new Error("embedding unavailable");
            },
          },
          types: ["source"],
        }),
      ).resolves.toMatchObject({
        textHits: [
          {
            archiveId: 0,
            chapterId: 1,
            kind: TEXT_SENTENCE_KIND.source,
            sentenceIndex: 1,
          },
        ],
      });
    });
  });

  it("falls back to fts when a legacy hybrid index has no segment table", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      await rebuildArchiveSearchIndex(document, undefined, {
        embeddingProvider: createFakeEmbeddingProvider(),
        indexes: "fts,dense",
      });
      await document.writeSearchIndexDatabase(async (database) => {
        await database.run("DROP TABLE text_embedding_segments");
      });

      await expect(
        querySearchIndex(document, "FTS", {
          embeddingProvider: createFakeEmbeddingProvider(),
          types: ["source"],
        }),
      ).resolves.toMatchObject({
        textHits: [
          {
            archiveId: 0,
            chapterId: 1,
            kind: TEXT_SENTENCE_KIND.source,
            sentenceIndex: 1,
          },
        ],
      });
    });
  });

  it("does not create a dense query embedding when text hits are disabled", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      await rebuildArchiveSearchIndex(document, undefined, {
        embeddingProvider: createFakeEmbeddingProvider(),
        indexes: "fts,dense",
      });
      let calls = 0;

      await expect(
        querySearchIndex(document, "FTS", {
          embeddingProvider: {
            dimensions: 3,
            model: "counting-embedding",
            embedTexts: async (texts) => {
              await Promise.resolve();
              calls += 1;
              return {
                embeddings: texts.map(() => [1, 0, 0]),
              };
            },
          },
          objectHitLimit: 32,
          textHitLimit: 0,
          types: null,
        }),
      ).resolves.toBeDefined();
      expect(calls).toBe(0);
    });
  });

  it("rejects dense-only query embedding dimension mismatch", async () => {
    await withTempDocument(async (document) => {
      await writeSourceChapter(document);
      await rebuildArchiveSearchIndex(document, undefined, {
        embeddingProvider: createFakeEmbeddingProvider(),
        indexes: "dense",
      });

      await expect(
        querySearchIndex(document, "semantic vectors", {
          embeddingProvider: {
            dimensions: 2,
            model: "wrong-size",
            embedTexts: async () => {
              await Promise.resolve();
              return { embeddings: [[1, 2]] };
            },
          },
          types: ["source"],
        }),
      ).rejects.toThrow(
        "Dense query embedding has 2 dimensions; index expects 3.",
      );
    });
  });
});

function createFakeEmbeddingProvider() {
  return {
    dimensions: 3,
    model: "test-embedding",
    embedTexts: async (texts: readonly string[]) => {
      await Promise.resolve();
      return {
        embeddings: texts.map((text, index) => [text.length, index, 1]),
        tokens: 9,
      };
    },
  };
}

async function writeSourceChapter(document: DirectoryDocument): Promise<void> {
  await document.openSession(async (openedDocument) => {
    await openedDocument.createSerial();
    const draft = await openedDocument.getSerialFragments(1).createDraft();
    draft.addSentence("Dense indexing writes vectors.", 4);
    draft.addSentence("FTS still indexes the same text.", 6);
    await draft.commit();
    await openedDocument.writeToc({
      items: [{ children: [], serialId: 1, title: "Dense" }],
      version: 1,
    });
  });
}

async function withTempDocument(
  operation: (document: DirectoryDocument) => Promise<void>,
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "wikigraph-index-test-"));
  const document = await DirectoryDocument.open(tempDir);

  try {
    await operation(document);
  } finally {
    await document.release();
    await rm(tempDir, { force: true, recursive: true });
  }
}
