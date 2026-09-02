import { mkdir } from "fs/promises";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  Database,
  DirectoryDocument,
} from "../../../../packages/core/src/document/index.js";
import {
  ensureWikiGraphArchiveSchemaCurrent,
  ensureWikiGraphHomeSchemaCurrent,
  readWikiGraphArchiveSchemaVersion,
  readWikiGraphHomeSchemaVersion,
  upgradeWikiGraphArchiveSchema,
} from "../../../../packages/core/src/storage/schema-upgrade/index.js";
import {
  readWikgArchiveEntry,
  readWikgArchiveMutationToken,
  writeWikgArchive,
} from "../../../../packages/core/src/storage/wikg/index.js";
import {
  SEARCH_INDEX_DATABASE_PATH,
  WIKG_MANIFEST_PATH,
} from "../../../../packages/core/src/storage/wikg/archive/constants.js";
import { withWikiGraphStorage } from "../../../../packages/core/src/runtime/platform/index.js";
import {
  createNodeWikiGraphStorage,
  nodeWikiGraphPlatform,
  NodeDirectory,
  NodeFile,
} from "../../../../packages/cli/src/runtime/node-platform.js";
import { withTempDir } from "../../../helpers/temp.js";

describe("schema-upgrade", () => {
  it("upgrades a v3 archive in place and preserves its mutation token", async () => {
    await withFixture(async ({ archive, root }) => {
      await rewriteManifest(archive, 3, true);
      const before = await readWikgArchiveMutationToken(archive);
      await expect(
        ensureWikiGraphArchiveSchemaCurrent(archive),
      ).rejects.toThrow("must be upgraded");

      await expect(
        upgradeWikiGraphArchiveSchema(archive),
      ).resolves.toMatchObject({
        changed: true,
        schemaChanged: true,
      });
      await expect(readWikiGraphArchiveSchemaVersion(archive)).resolves.toBe(4);
      await expect(readWikgArchiveMutationToken(archive)).resolves.toBe(before);
      await expect(
        readWikgArchiveEntry(archive, SEARCH_INDEX_DATABASE_PATH),
      ).resolves.toBeUndefined();

      const extracted = new NodeDirectory(join(root, "extracted"));
      await mkdir(extracted.path, { recursive: true });
      const databaseBytes = await readWikgArchiveEntry(archive, "database.db");
      expect(databaseBytes).toBeDefined();
      const databaseFile = await extracted.createFile("database.db");
      const writer = await databaseFile.openWriter();
      await writer.write(databaseBytes!);
      await writer.commit();
      const database = await Database.open(databaseFile, "", {
        readonly: true,
      });
      try {
        const provenanceTable = await database.queryOne(
          "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'source_artifacts'",
          undefined,
          () => true,
        );
        expect(provenanceTable).toBe(true);
      } finally {
        await database.close();
      }
    });
  });

  it("repairs missing chapter keys even when the schema is current", async () => {
    await withFixture(async ({ archive }) => {
      const entries = await nodeWikiGraphPlatform.zip.read(archive);
      await nodeWikiGraphPlatform.zip.write(
        archive,
        entries.map((entry) =>
          entry.name === "toc.json"
            ? {
                data: new TextEncoder().encode(
                  `${JSON.stringify({ items: [{ serialId: 1, title: "Chapter" }], version: 1 })}\n`,
                ),
                name: entry.name,
              }
            : entry,
        ),
      );
      await expect(
        upgradeWikiGraphArchiveSchema(archive),
      ).resolves.toMatchObject({
        changed: true,
        repairedToc: true,
        schemaChanged: false,
      });
      const toc = await readWikgArchiveEntry(archive, "toc.json");
      expect(JSON.parse(new TextDecoder().decode(toc))).toMatchObject({
        items: [{ key: expect.any(String), serialId: 1 }],
      });
    });
  });

  it("rejects future archive schema versions without rewriting the file", async () => {
    await withFixture(async ({ archive }) => {
      await rewriteManifest(archive, 99, false);
      await expect(upgradeWikiGraphArchiveSchema(archive)).rejects.toThrow(
        "Unsupported Wiki Graph archive schema version: 99",
      );
      await expect(readWikiGraphArchiveSchemaVersion(archive)).resolves.toBe(
        99,
      );
    });
  });

  it("upgrades home schema under the injected library root", async () => {
    await withTempDir("wikigraph-home-schema-", async (root) => {
      await withWikiGraphStorage(
        createNodeWikiGraphStorage(join(root, "state")),
        async () => {
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(0);
          await ensureWikiGraphHomeSchemaCurrent();
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(3);
        },
      );
    });
  });

  it("upgrades concurrent host storage roots independently", async () => {
    await withTempDir("wikigraph-home-schema-a-", async (firstRoot) => {
      await withTempDir("wikigraph-home-schema-b-", async (secondRoot) => {
        const storages = [firstRoot, secondRoot].map((root) =>
          createNodeWikiGraphStorage(join(root, "state")),
        );

        await Promise.all(
          storages.map(
            async (storage) =>
              await withWikiGraphStorage(storage, async () => {
                await ensureWikiGraphHomeSchemaCurrent();
                await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(3);
              }),
          ),
        );
      });
    });
  });
});

async function withFixture(
  operation: (fixture: {
    readonly archive: NodeFile;
    readonly root: string;
  }) => Promise<void>,
): Promise<void> {
  await withTempDir("wikigraph-schema-upgrade-", async (root) => {
    await withWikiGraphStorage(
      createNodeWikiGraphStorage(join(root, "state")),
      async () => {
        const documentPath = join(root, "document");
        await mkdir(documentPath, { recursive: true });
        const directory = new NodeDirectory(documentPath);
        const document = await DirectoryDocument.open(directory);
        try {
          await document.writeToc({
            items: [
              { children: [], key: "chapter", serialId: 1, title: "Chapter" },
            ],
            version: 1,
          });
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

async function rewriteManifest(
  archive: NodeFile,
  schemaVersion: number,
  addDerivedIndex: boolean,
): Promise<void> {
  const entries = [...(await nodeWikiGraphPlatform.zip.read(archive))]
    .filter((entry) => entry.name !== WIKG_MANIFEST_PATH)
    .map((entry) => ({ data: entry.data, name: entry.name }));
  entries.push({
    data: new TextEncoder().encode(
      `${JSON.stringify({ formatVersion: 1, schemaVersion })}\n`,
    ),
    name: WIKG_MANIFEST_PATH,
  });
  if (addDerivedIndex) {
    entries.push({
      data: new Uint8Array([1, 2, 3]),
      name: SEARCH_INDEX_DATABASE_PATH,
    });
  }
  await nodeWikiGraphPlatform.zip.write(archive, entries);
}
