import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import type { Document } from "./index.js";
import { DirectoryDocument } from "./index.js";
import { writeSerialSource } from "../../text/serial/source.js";

async function withDocument(
  operation: (document: DirectoryDocument) => Promise<void>,
): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "wikigraph-index-invalidation-"));

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

describe("DirectoryDocument index artifact invalidation", () => {
  it("deletes all index artifacts when source is cleared", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        const serialId = await openedDocument.createSerial();

        await seedKnowledgeGraph(openedDocument, serialId);
        await seedReadingGraph(openedDocument, serialId);
        await openedDocument.writeSummary(serialId, "Summary.");
        await saveAllArtifactKinds(openedDocument, serialId);
        const revision = await openedDocument.serials.getRevision(serialId);

        await openedDocument.clearSerialSource(serialId);

        expect(await openedDocument.indexArtifacts.list()).toStrictEqual([]);
        expect(
          await openedDocument.mentions.listByChapter(serialId),
        ).toStrictEqual([]);
        expect(
          await openedDocument.readingEdges.listBySerial(serialId),
        ).toStrictEqual([]);
        expect(await openedDocument.readSummary(serialId)).toBeUndefined();
        expect(await openedDocument.serials.getRevision(serialId)).toBe(
          revision + 1,
        );
      });
    });
  });

  it("deletes FTS and summary embedding when summary changes", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        const serialId = await openedDocument.createSerial();

        await saveAllArtifactKinds(openedDocument, serialId);
        await seedKnowledgeGraph(openedDocument, serialId);
        await seedReadingGraph(openedDocument, serialId);
        const revision = await openedDocument.serials.getRevision(serialId);

        await openedDocument.writeSummary(serialId, "A new summary.");

        expect(
          await openedDocument.indexArtifacts.get(serialId, "fts"),
        ).toBeUndefined();
        expect(
          await openedDocument.indexArtifacts.get(serialId, "embedding-source"),
        ).toBeDefined();
        expect(
          await openedDocument.indexArtifacts.get(
            serialId,
            "embedding-summary",
          ),
        ).toBeUndefined();
        expect(
          await openedDocument.mentions.listByChapter(serialId),
        ).toHaveLength(1);
        expect(
          await openedDocument.readingEdges.listBySerial(serialId),
        ).toHaveLength(1);
        expect(await openedDocument.serials.getRevision(serialId)).toBe(
          revision,
        );
      });
    });
  });

  it("keeps knowledge graph when reading graph is cleared", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        const serialId = await openedDocument.createSerial();

        await seedKnowledgeGraph(openedDocument, serialId);
        await seedReadingGraph(openedDocument, serialId);
        await openedDocument.writeSummary(serialId, "Summary.");
        await saveAllArtifactKinds(openedDocument, serialId);
        const revision = await openedDocument.serials.getRevision(serialId);

        await openedDocument.clearSerialReadingGraph(serialId);

        expect(
          await openedDocument.indexArtifacts.get(serialId, "fts"),
        ).toBeUndefined();
        expect(
          await openedDocument.indexArtifacts.get(serialId, "embedding-source"),
        ).toBeDefined();
        expect(
          await openedDocument.indexArtifacts.get(
            serialId,
            "embedding-summary",
          ),
        ).toBeUndefined();
        expect(
          await openedDocument.mentions.listByChapter(serialId),
        ).toHaveLength(1);
        expect(
          await openedDocument.readingEdges.listBySerial(serialId),
        ).toStrictEqual([]);
        expect(await openedDocument.readSummary(serialId)).toBeUndefined();
        expect(await openedDocument.serials.getRevision(serialId)).toBe(
          revision,
        );
      });
    });
  });

  it("keeps reading graph and summary when knowledge graph is cleared", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        const serialId = await openedDocument.createSerial();

        await seedKnowledgeGraph(openedDocument, serialId);
        await seedReadingGraph(openedDocument, serialId);
        await openedDocument.writeSummary(serialId, "Summary.");
        await saveAllArtifactKinds(openedDocument, serialId);
        const revision = await openedDocument.serials.getRevision(serialId);

        await openedDocument.clearSerialKnowledgeGraph(serialId);

        expect(
          await openedDocument.indexArtifacts.get(serialId, "fts"),
        ).toBeUndefined();
        expect(
          await openedDocument.indexArtifacts.get(serialId, "embedding-source"),
        ).toBeDefined();
        expect(
          await openedDocument.indexArtifacts.get(
            serialId,
            "embedding-summary",
          ),
        ).toBeDefined();
        expect(
          await openedDocument.mentions.listByChapter(serialId),
        ).toStrictEqual([]);
        expect(
          await openedDocument.readingEdges.listBySerial(serialId),
        ).toHaveLength(1);
        expect(await openedDocument.readSummary(serialId)).toBe("Summary.");
        expect(await openedDocument.serials.getRevision(serialId)).toBe(
          revision,
        );
      });
    });
  });

  it("deletes derived artifacts and bumps revision when source is replaced", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        const serialId = await openedDocument.createSerial();

        await saveAllArtifactKinds(openedDocument, serialId);
        await seedKnowledgeGraph(openedDocument, serialId);
        await seedReadingGraph(openedDocument, serialId);
        await openedDocument.writeSummary(serialId, "Summary.");
        const revision = await openedDocument.serials.getRevision(serialId);

        await writeSerialSource(openedDocument, serialId, ["Replacement."]);

        expect(await openedDocument.indexArtifacts.list()).toStrictEqual([]);
        expect(
          await openedDocument.mentions.listByChapter(serialId),
        ).toStrictEqual([]);
        expect(
          await openedDocument.readingEdges.listBySerial(serialId),
        ).toStrictEqual([]);
        expect(await openedDocument.readSummary(serialId)).toBeUndefined();
        expect(await openedDocument.serials.getRevision(serialId)).toBe(
          revision + 1,
        );
      });
    });
  });

  it("deletes all index artifacts when a serial is deleted", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        const serialId = await openedDocument.createSerial();

        await saveAllArtifactKinds(openedDocument, serialId);

        await openedDocument.deleteSerial(serialId);

        expect(await openedDocument.indexArtifacts.list()).toStrictEqual([]);
      });
    });
  });
});

async function saveAllArtifactKinds(
  document: Document,
  serialId: number,
): Promise<void> {
  await document.indexArtifacts.replaceFts({
    lexicalRows: [],
    serialId,
    sourceRevision: 0,
  });
  await document.indexArtifacts.replaceEmbedding({
    kind: "embedding-source",
    segments: [],
    serialId,
    sourceRevision: 0,
  });
  await document.indexArtifacts.replaceEmbedding({
    kind: "embedding-summary",
    segments: [],
    serialId,
    sourceRevision: 0,
  });
}

async function seedKnowledgeGraph(
  document: Document,
  serialId: number,
): Promise<void> {
  await document.mentions.save({
    chapterId: serialId,
    id: `mention-${serialId}`,
    qid: `entity-${serialId}`,
    rangeEnd: 5,
    rangeStart: 0,
    sentenceIndex: 0,
    surface: "Entity",
  });
  await document.serials.setKnowledgeGraphReady(serialId, true);
}

async function seedReadingGraph(
  document: Document,
  serialId: number,
): Promise<void> {
  await document.chunks.save({
    content: "Reading chunk",
    generation: 0,
    id: serialId * 100,
    label: "Chunk",
    sentenceId: [serialId, 0],
    sentenceIds: [[serialId, 0]],
    wordsCount: 2,
    weight: 1,
  });
  await document.chunks.save({
    content: "Next chunk",
    generation: 0,
    id: serialId * 100 + 1,
    label: "Next",
    sentenceId: [serialId, 1],
    sentenceIds: [[serialId, 1]],
    wordsCount: 2,
    weight: 1,
  });
  await document.readingEdges.save({
    fromId: serialId * 100,
    toId: serialId * 100 + 1,
    weight: 1,
  });
  await document.serials.setTopologyReady(serialId, true);
}
