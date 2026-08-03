import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../document/index.js";
import type { SearchIndexEmbeddingProvider } from "../search-index/index.js";
import {
  buildChapterEmbeddingIndexArtifact,
  replaceChapterFtsIndexArtifact,
  replaceChapterSourceEmbeddingIndexArtifact,
  replaceChapterSummaryEmbeddingIndexArtifact,
} from "./index.js";

async function withDocument(
  operation: (document: DirectoryDocument) => Promise<void>,
): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "wikigraph-index-builder-"));

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

describe("index artifact builders", () => {
  it("builds and stores an FTS artifact from chapter lexical content", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        const serialId = await openedDocument.createSerial();

        await openedDocument
          .getSerialFragments(serialId)
          .writeTextStream("Alpha beta. 山海之间。");
        await openedDocument.writeSummary(serialId, "Summary row.");
        await openedDocument.chunks.save({
          content: "Chunk content row.",
          generation: 0,
          id: 10,
          label: "Chunk label",
          sentenceId: [serialId, 0],
          sentenceIds: [[serialId, 0]],
          weight: 1,
          wordsCount: 3,
        });
        await openedDocument.mentions.saveMany([
          {
            chapterId: serialId,
            id: "mention-alpha",
            qid: "Q1",
            rangeEnd: 5,
            rangeStart: 0,
            sentenceIndex: 0,
            surface: "Alpha",
          },
        ]);

        await replaceChapterFtsIndexArtifact(openedDocument, serialId);

        const rows =
          await openedDocument.indexArtifacts.listLexicalRows(serialId);

        expect(rows.map((row) => row.objectKind)).toStrictEqual([
          "chunk-content",
          "chunk-label",
          "mention-surface",
          "source-sentence",
          "source-sentence",
          "summary-sentence",
        ]);
        expect(rows[0]).toMatchObject({
          objectKind: "chunk-content",
          rowId: "chunk-content:10",
          text: "Chunk content row.",
        });
        expect(rows[3]).toMatchObject({
          objectKind: "source-sentence",
          rowId: "source-sentence:0",
          sentenceIndex: 0,
          text: "Alpha beta.",
        });
        expect(rows[3]?.tokens.some((token) => token.startsWith("le"))).toBe(
          true,
        );
        expect(rows[5]).toMatchObject({
          objectKind: "summary-sentence",
          rowId: "summary-sentence:0",
          sentenceIndex: 0,
          text: "Summary row.",
        });
      });
    });
  });

  it("builds source embedding artifact segments with provider metadata", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        const serialId = await openedDocument.createSerial();
        const provider = createFakeEmbeddingProvider();

        await openedDocument
          .getSerialFragments(serialId)
          .writeTextStream(
            [
              "Alpha beta gamma delta epsilon.",
              "One two three four five.",
              "山海之间有旧城。",
            ].join(" "),
          );

        await replaceChapterSourceEmbeddingIndexArtifact(
          openedDocument,
          serialId,
          provider,
        );

        expect(provider.requests).toStrictEqual([
          [
            "Alpha beta gamma delta epsilon.\n" +
              "One two three four five.\n" +
              "山海之间有旧城。",
          ],
        ]);
        expect(
          await openedDocument.indexArtifacts.get(serialId, "embedding-source"),
        ).toMatchObject({
          metadata: {
            dimensions: 3,
            identity: "provider=fake;model=test-embedding",
            model: "test-embedding",
            version: 1,
          },
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
            text:
              "Alpha beta gamma delta epsilon.\n" +
              "One two three four five.\n" +
              "山海之间有旧城。",
            vector: [1, 2, 3],
            wordsCount: 11,
          },
        ]);
      });
    });
  });

  it("uses summary text for summary embedding artifacts", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        const serialId = await openedDocument.createSerial();
        const provider = createFakeEmbeddingProvider();

        await openedDocument
          .getSerialFragments(serialId)
          .writeTextStream("Source only.");
        await openedDocument.writeSummary(serialId, "Summary sentence.");

        const artifact = await buildChapterEmbeddingIndexArtifact(
          openedDocument,
          {
            embeddingProvider: provider,
            kind: "embedding-summary",
            serialId,
          },
        );

        expect(artifact.segments).toStrictEqual([
          {
            endSentenceIndex: 0,
            segmentIndex: 0,
            startSentenceIndex: 0,
            text: "Summary sentence.",
            vector: [1, 2, 3],
            wordsCount: 2,
          },
        ]);

        await replaceChapterSummaryEmbeddingIndexArtifact(
          openedDocument,
          serialId,
          provider,
        );

        expect(
          await openedDocument.indexArtifacts.get(
            serialId,
            "embedding-summary",
          ),
        ).toBeDefined();
      });
    });
  });
});

function createFakeEmbeddingProvider(): SearchIndexEmbeddingProvider & {
  readonly requests: string[][];
} {
  const requests: string[][] = [];

  return {
    dimensions: 3,
    identity: "provider=fake;model=test-embedding",
    model: "test-embedding",
    requests,
    embedTexts(texts) {
      requests.push([...texts]);
      return Promise.resolve({
        embeddings: texts.map(() => [1, 2, 3]),
      });
    },
  };
}
