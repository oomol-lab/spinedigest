import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../index.js";

async function withDocument(
  operation: (document: DirectoryDocument) => Promise<void>,
): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "wikigraph-index-artifacts-"));

  try {
    const document = await DirectoryDocument.open(path);

    try {
      await operation(document);
    } finally {
      await document.release();
    }
  } finally {
    await rm(path, { force: true, recursive: true });
  }
}

describe("IndexArtifactStore", () => {
  it("replaces FTS lexical rows and reports revision coverage", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        const serialId = await openedDocument.createSerial();
        const revision = await openedDocument.serials.getRevision(serialId);

        await openedDocument.indexArtifacts.replaceFts({
          lexicalRows: [
            {
              metadata: { source: "sentence" },
              objectId: "1:0",
              objectKind: "sentence",
              rowId: "sentence:0",
              sentenceIndex: 0,
              text: "Alpha beta",
              tokens: ["alpha", "beta"],
            },
          ],
          metadata: { tokenizer: "test" },
          serialId,
          sourceRevision: revision,
        });

        expect(
          await openedDocument.indexArtifacts.get(serialId, "fts"),
        ).toMatchObject({
          kind: "fts",
          metadata: { tokenizer: "test" },
          serialId,
          sourceRevision: revision,
        });
        expect(
          await openedDocument.indexArtifacts.listLexicalRows(serialId),
        ).toStrictEqual([
          {
            metadata: { source: "sentence" },
            objectId: "1:0",
            objectKind: "sentence",
            rowId: "sentence:0",
            sentenceIndex: 0,
            text: "Alpha beta",
            tokens: ["alpha", "beta"],
          },
        ]);
        expect(
          await openedDocument.indexArtifacts.listCoverage("fts"),
        ).toStrictEqual([
          {
            current: true,
            kind: "fts",
            serialId,
            serialRevision: revision,
            sourceRevision: revision,
          },
        ]);

        await openedDocument.serials.bumpRevision(serialId);

        expect(
          await openedDocument.indexArtifacts.listCoverage("fts"),
        ).toStrictEqual([
          {
            current: false,
            kind: "fts",
            serialId,
            serialRevision: revision + 1,
            sourceRevision: revision,
          },
        ]);
      });
    });
  });

  it("replaces and deletes embedding artifacts independently", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        const serialId = await openedDocument.createSerial();

        await openedDocument.indexArtifacts.replaceEmbedding({
          kind: "embedding-source",
          metadata: {
            dimensions: 3,
            model: "test-embedding",
          },
          segments: [
            {
              endSentenceIndex: 2,
              segmentIndex: 0,
              startSentenceIndex: 0,
              text: "Alpha beta. Gamma.",
              vector: [0.1, 0.2, 0.3],
              wordsCount: 3,
            },
          ],
          serialId,
          sourceRevision: 0,
        });
        await openedDocument.indexArtifacts.replaceEmbedding({
          kind: "embedding-summary",
          segments: [
            {
              endSentenceIndex: 0,
              segmentIndex: 0,
              startSentenceIndex: 0,
              text: "Summary",
              vector: [1, 0, 0],
              wordsCount: 1,
            },
          ],
          serialId,
          sourceRevision: 0,
        });

        expect(
          await openedDocument.indexArtifacts.listEmbeddingSegments(
            serialId,
            "embedding-source",
          ),
        ).toStrictEqual([
          {
            endSentenceIndex: 2,
            segmentIndex: 0,
            startSentenceIndex: 0,
            text: "Alpha beta. Gamma.",
            vector: [0.1, 0.2, 0.3],
            wordsCount: 3,
          },
        ]);

        await openedDocument.indexArtifacts.delete(
          serialId,
          "embedding-source",
        );

        expect(
          await openedDocument.indexArtifacts.get(serialId, "embedding-source"),
        ).toBeUndefined();
        expect(
          await openedDocument.indexArtifacts.get(
            serialId,
            "embedding-summary",
          ),
        ).toBeDefined();

        await openedDocument.indexArtifacts.deleteBySerial(serialId);

        expect(await openedDocument.indexArtifacts.list()).toStrictEqual([]);
      });
    });
  });
});
