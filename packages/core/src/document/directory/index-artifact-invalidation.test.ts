import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import type { Document } from "./index.js";
import { DirectoryDocument } from "./index.js";

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

        await saveAllArtifactKinds(openedDocument, serialId);

        await openedDocument.clearSerialSource(serialId);

        expect(await openedDocument.indexArtifacts.list()).toStrictEqual([]);
      });
    });
  });

  it("deletes only summary embedding when summary changes", async () => {
    await withDocument(async (document) => {
      await document.openSession(async (openedDocument) => {
        const serialId = await openedDocument.createSerial();

        await saveAllArtifactKinds(openedDocument, serialId);

        await openedDocument.writeSummary(serialId, "A new summary.");

        expect(
          await openedDocument.indexArtifacts.get(serialId, "fts"),
        ).toBeDefined();
        expect(
          await openedDocument.indexArtifacts.get(serialId, "embedding-source"),
        ).toBeDefined();
        expect(
          await openedDocument.indexArtifacts.get(
            serialId,
            "embedding-summary",
          ),
        ).toBeUndefined();
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
