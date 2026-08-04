import { mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "./index.js";

async function withDocument(
  operation: (document: DirectoryDocument, path: string) => Promise<void>,
): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "wikigraph-search-index-"));

  try {
    const document = await DirectoryDocument.open(path);

    try {
      await operation(document, path);
    } finally {
      await document.release();
    }
  } finally {
    await rm(path, { force: true, recursive: true });
  }
}

describe("DirectoryDocument search index cache", () => {
  it("deletes incompatible cache on read", async () => {
    await withDocument(async (document, path) => {
      await writeIncompatibleCache(document);

      await expect(
        document.readSearchIndexDatabase(async () => "unreachable"),
      ).rejects.toThrow("Search index cache is missing: index.db");
      await expect(stat(join(path, "index.db"))).rejects.toThrow();
    });
  });

  it("reinitializes incompatible cache on write", async () => {
    await withDocument(async (document) => {
      await writeIncompatibleCache(document);

      const version = await document.writeSearchIndexDatabase(
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
      );

      expect(version).toBeUndefined();
    });
  });
});

async function writeIncompatibleCache(
  document: DirectoryDocument,
): Promise<void> {
  await document.writeSearchIndexDatabase(async (database) => {
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('version', 'old')
      `,
    );
  });
}
