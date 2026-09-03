import { access, mkdir, readFile, writeFile } from "fs/promises";
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
import { assertWikiGraphLibrarySchemaCurrent } from "../../../../packages/core/src/maintenance/upgrade.js";
import {
  createWikiGraphLibrary,
  parseWikiGraphLibraryUri,
  scanWikiGraphLibrary,
} from "../../../../packages/core/src/library/index.js";
import { createPortableHash } from "../../../../packages/core/src/utils/crypto.js";
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
      const entries = await readZipEntries(archive);
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
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(4);
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
                await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(4);
              }),
          ),
        );
      });
    });
  });

  it("migrates a v3 home atomically while preserving important registry data", async () => {
    await withTempDir("wikigraph-home-v3-", async (root) => {
      const statePath = join(root, "state");
      const libraryPath = join(root, "library");
      await mkdir(libraryPath, { recursive: true });
      await createV3Home(statePath, libraryPath);
      const archivePath = join(libraryPath, "book.wikg");
      await writeFile(archivePath, "archive-v4-is-untouched");
      await createDerivedHomeState(statePath);

      await withWikiGraphStorage(
        createNodeWikiGraphStorage(statePath),
        async () => {
          await ensureWikiGraphHomeSchemaCurrent();
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(4);

          const database = await Database.open(
            new NodeFile(join(statePath, "core.sqlite")),
            "",
            { readonly: true },
          );
          try {
            const columns = await database.queryAll(
              "PRAGMA table_info(libraries)",
              undefined,
              (row) => String(row.name),
            );
            expect(columns).toContain("folder_identity");
            expect(columns).not.toContain("folder_path");
            await expect(
              database.queryOne(
                "SELECT folder_identity FROM libraries WHERE id = 7",
                undefined,
                (row) => String(row.folder_identity),
              ),
            ).resolves.toBe(new NodeDirectory(libraryPath).identity);
            await expect(
              database.queryOne(
                "SELECT folder_identity FROM libraries WHERE id = 8",
                undefined,
                (row) => String(row.folder_identity),
              ),
            ).resolves.toBe(
              new NodeDirectory(join(statePath, "default-library")).identity,
            );
            await expect(
              database.queryOne(
                "SELECT value_json FROM config_sections WHERE section = 'llm'",
                undefined,
                (row) => String(row.value_json),
              ),
            ).resolves.toBe('{"model":"test"}');
            await expect(
              database.queryOne(
                "SELECT value_json FROM library_metadata WHERE library_id = 7 AND key = 'label'",
                undefined,
                (row) => String(row.value_json),
              ),
            ).resolves.toBe('"Fixture"');
            await expect(
              database.queryOne(
                "SELECT relative_path FROM library_archives WHERE library_id = 7",
                undefined,
                (row) => String(row.relative_path),
              ),
            ).resolves.toBe("book.wikg");
          } finally {
            await database.close();
          }

          await expect(readFile(archivePath, "utf8")).resolves.toBe(
            "archive-v4-is-untouched",
          );
          await expectPathMissing(join(statePath, "cache/cache.sqlite"));
          await expectPathMissing(join(statePath, "jobs/job.sqlite"));
          await expectPathMissing(join(statePath, "staging/staging.sqlite"));
          await expectPathMissing(
            join(statePath, "tmp/wikg-coordinator.sqlite"),
          );
          await expectPathMissing(join(statePath, "documents/.wikg-work"));

          await ensureWikiGraphHomeSchemaCurrent();
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(4);
        },
      );
    });
  });

  it("keeps the v3 marker and important data when migration fails, then retries", async () => {
    await withTempDir("wikigraph-home-retry-", async (root) => {
      const statePath = join(root, "state");
      const libraryPath = join(root, "library");
      await mkdir(libraryPath, { recursive: true });
      await createV3Home(statePath, "relative-path-cannot-be-resolved");

      await withWikiGraphStorage(
        createNodeWikiGraphStorage(statePath),
        async () => {
          await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
            "Cannot migrate unavailable library Directory",
          );
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(3);

          const file = new NodeFile(join(statePath, "core.sqlite"));
          const database = await Database.open(file);
          try {
            await expect(
              database.queryOne(
                "SELECT value_json FROM config_sections WHERE section = 'llm'",
                undefined,
                (row) => String(row.value_json),
              ),
            ).resolves.toBe('{"model":"test"}');
            await database.run(
              "UPDATE libraries SET folder_path = ? WHERE id = 7",
              [libraryPath],
            );
          } finally {
            await database.close();
          }

          await ensureWikiGraphHomeSchemaCurrent();
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(4);
        },
      );
    });
  });

  it("blocks v3 home migration before writes when coordinator state is active", async () => {
    await withTempDir("wikigraph-home-active-", async (root) => {
      const statePath = join(root, "state");
      const libraryPath = join(root, "library");
      await mkdir(libraryPath, { recursive: true });
      await createV3Home(statePath, libraryPath);
      await seedCurrentCoordinator(statePath, {
        archiveIdentity: new NodeFile(join(root, "book.wikg")).identity,
        entryPath: "database.db",
        withActiveOwner: true,
      });

      await withWikiGraphStorage(
        createNodeWikiGraphStorage(statePath),
        async () => {
          await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
            "active coordinator state",
          );
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(3);
          const database = await Database.open(
            new NodeFile(join(statePath, "core.sqlite")),
            "",
            { readonly: true },
          );
          try {
            const columns = await database.queryAll(
              "PRAGMA table_info(libraries)",
              undefined,
              (row) => String(row.name),
            );
            expect(columns).toContain("folder_path");
          } finally {
            await database.close();
          }
        },
      );
    });
  });

  it("blocks v3 home migration before cleanup when a build job is queued", async () => {
    await withTempDir("wikigraph-home-build-active-", async (root) => {
      const statePath = join(root, "state");
      const libraryPath = join(root, "library");
      await mkdir(libraryPath, { recursive: true });
      await createV3Home(statePath, libraryPath);
      await mkdir(join(statePath, "cache"), { recursive: true });
      await writeFile(
        join(statePath, "cache/cache.sqlite"),
        "keep-before-gate",
      );
      await mkdir(join(statePath, "jobs"), { recursive: true });
      const jobs = await Database.open(
        new NodeFile(join(statePath, "jobs/job.sqlite")),
      );
      try {
        await jobs.execute(`
          CREATE TABLE build_jobs (state TEXT NOT NULL);
          CREATE TABLE build_worker_lease (
            id INTEGER PRIMARY KEY,
            owner_id TEXT,
            owner_pid INTEGER,
            heartbeat_at INTEGER
          );
        `);
        await jobs.run("INSERT INTO build_jobs VALUES ('queued')");
      } finally {
        await jobs.close();
      }

      await withWikiGraphStorage(
        createNodeWikiGraphStorage(statePath),
        async () => {
          await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
            "active build jobs",
          );
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(3);
          await expect(
            readFile(join(statePath, "cache/cache.sqlite"), "utf8"),
          ).resolves.toBe("keep-before-gate");
        },
      );
    });
  });

  it("rejects future home schema versions without rewriting their marker", async () => {
    await withTempDir("wikigraph-home-future-", async (root) => {
      const statePath = join(root, "state");
      await mkdir(statePath, { recursive: true });
      const database = await Database.open(
        new NodeFile(join(statePath, "core.sqlite")),
      );
      try {
        await database.execute(`
          CREATE TABLE schema_versions (
            scope TEXT PRIMARY KEY,
            version INTEGER NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        await database.run(
          "INSERT INTO schema_versions VALUES ('home', 99, 'future')",
        );
      } finally {
        await database.close();
      }

      await withWikiGraphStorage(
        createNodeWikiGraphStorage(statePath),
        async () => {
          await expect(ensureWikiGraphHomeSchemaCurrent()).rejects.toThrow(
            "Unsupported Wiki Graph home schema version: 99",
          );
          await expect(readWikiGraphHomeSchemaVersion()).resolves.toBe(99);
        },
      );
    });
  });

  it("blocks archive maintenance for active coordinator and non-derived overlays", async () => {
    await withFixture(async ({ archive, root }) => {
      await rewriteManifest(archive, 3, false);
      const statePath = join(root, "state");
      await seedCurrentCoordinator(statePath, {
        archiveIdentity: archive.identity,
        entryPath: "database.db",
        withActiveOwner: true,
      });
      await expect(upgradeWikiGraphArchiveSchema(archive)).rejects.toThrow(
        "active coordinator state",
      );
      await expect(readWikiGraphArchiveSchemaVersion(archive)).resolves.toBe(3);
    });

    await withFixture(async ({ archive, root }) => {
      await rewriteManifest(archive, 3, false);
      await seedCurrentCoordinator(join(root, "state"), {
        archiveIdentity: archive.identity,
        entryPath: "database.db",
        withActiveOwner: false,
      });
      await expect(upgradeWikiGraphArchiveSchema(archive)).rejects.toThrow(
        "non-derived overlay state",
      );
      await expect(readWikiGraphArchiveSchemaVersion(archive)).resolves.toBe(3);
    });
  });

  it("discards orphaned derived overlays after archive maintenance commits", async () => {
    await withFixture(async ({ archive, root }) => {
      await rewriteManifest(archive, 3, false);
      const statePath = join(root, "state");
      await seedCurrentCoordinator(statePath, {
        archiveIdentity: archive.identity,
        entryPath: "index.db",
        withActiveOwner: false,
      });

      await expect(
        upgradeWikiGraphArchiveSchema(archive),
      ).resolves.toMatchObject({ changed: true, schemaChanged: true });
      const coordinator = await Database.open(
        new NodeFile(join(statePath, "tmp/wikg-coordinator.sqlite")),
        "",
        { readonly: true },
      );
      try {
        await expect(
          coordinator.queryOne(
            "SELECT 1 AS present FROM entry_overlays LIMIT 1",
            undefined,
            () => true,
          ),
        ).resolves.toBeUndefined();
      } finally {
        await coordinator.close();
      }
    });
  });

  it("rejects a future archive during library preflight", async () => {
    await withFixture(async ({ archive, root }) => {
      const library = await createWikiGraphLibrary({
        folder: new NodeDirectory(root),
      });
      const target = parseWikiGraphLibraryUri(library.uri);
      expect(target).toBeDefined();
      await scanWikiGraphLibrary(target!);
      await rewriteManifest(archive, 99, false);
      await expect(
        assertWikiGraphLibrarySchemaCurrent(target!),
      ).rejects.toThrow("unsupported future archive schema v99");
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
  const entries = (await readZipEntries(archive))
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

async function readZipEntries(
  archive: NodeFile,
): Promise<Array<{ readonly data: Uint8Array; readonly name: string }>> {
  const reader = await nodeWikiGraphPlatform.zip.open(archive);
  try {
    const entries: Array<{ data: Uint8Array; name: string }> = [];
    for (const name of await reader.listEntries()) {
      const data = await reader.readEntry(name);
      if (data !== undefined) entries.push({ data, name });
    }
    return entries;
  } finally {
    await reader.close();
  }
}

async function createV3Home(
  statePath: string,
  libraryReference: string,
): Promise<void> {
  await mkdir(statePath, { recursive: true });
  const database = await Database.open(
    new NodeFile(join(statePath, "core.sqlite")),
  );
  try {
    await database.execute(`
      CREATE TABLE schema_versions (
        scope TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE config_sections (
        section TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE libraries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        folder_path TEXT NOT NULL UNIQUE,
        is_default INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE library_metadata (
        library_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (library_id, key)
      );
      CREATE TABLE library_archives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id INTEGER NOT NULL,
        public_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    await database.run("INSERT INTO schema_versions VALUES ('home', 3, 'v3')");
    await database.run(
      `INSERT INTO config_sections VALUES ('llm', '{"model":"test"}', 'v3')`,
    );
    await database.run(
      "INSERT INTO libraries VALUES (7, 'fixture-lib', ?, 0, 'created', 'updated')",
      [libraryReference],
    );
    await database.run(
      "INSERT INTO libraries VALUES (8, 'opaque-lib', ?, 1, 'created', 'updated')",
      [new NodeDirectory(join(statePath, "default-library")).identity],
    );
    await database.run(
      `INSERT INTO library_metadata VALUES (7, 'label', '"Fixture"', 'v3')`,
    );
    await database.run(
      "INSERT INTO library_archives VALUES (11, 7, 'fixture-archive', 'book.wikg', 'present', 'created', 'updated')",
    );
  } finally {
    await database.close();
  }
}

async function createDerivedHomeState(statePath: string): Promise<void> {
  for (const path of [
    "cache/cache.sqlite",
    "cache/search-sessions.sqlite",
    "staging/library/7/index/index.db",
    "documents/.wikg-work/orphan/snapshot",
  ]) {
    const filePath = join(statePath, path);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, "derived");
  }

  await mkdir(join(statePath, "jobs"), { recursive: true });
  const jobs = await Database.open(
    new NodeFile(join(statePath, "jobs/job.sqlite")),
  );
  try {
    await jobs.execute(`
      CREATE TABLE build_jobs (state TEXT NOT NULL);
      CREATE TABLE build_worker_lease (
        id INTEGER PRIMARY KEY,
        owner_id TEXT,
        owner_pid INTEGER,
        heartbeat_at INTEGER
      );
    `);
    await jobs.run("INSERT INTO build_jobs VALUES ('completed')");
  } finally {
    await jobs.close();
  }

  await mkdir(join(statePath, "staging"), { recursive: true });
  const legacy = await Database.open(
    new NodeFile(join(statePath, "staging/staging.sqlite")),
  );
  try {
    await legacy.execute(`
      CREATE TABLE archive_owners (
        owner_id TEXT PRIMARY KEY,
        heartbeat_at INTEGER NOT NULL
      );
      CREATE TABLE entry_overlays (entry_path TEXT NOT NULL);
    `);
    await legacy.run("INSERT INTO entry_overlays VALUES ('database.db')");
  } finally {
    await legacy.close();
  }

  await seedCurrentCoordinator(statePath, {
    archiveIdentity: "node-file:b3JwaGFu",
    entryPath: "database.db",
    withActiveOwner: false,
  });
}

async function seedCurrentCoordinator(
  statePath: string,
  input: {
    readonly archiveIdentity: string;
    readonly entryPath: string;
    readonly withActiveOwner: boolean;
  },
): Promise<void> {
  await mkdir(join(statePath, "tmp"), { recursive: true });
  const database = await Database.open(
    new NodeFile(join(statePath, "tmp/wikg-coordinator.sqlite")),
  );
  const archiveKey = createPortableHash("sha256")
    .update(input.archiveIdentity)
    .digest("hex");
  try {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS archive_owners (
        archive_key TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        host_instance_id TEXT NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (archive_key, owner_id)
      );
      CREATE TABLE IF NOT EXISTS entry_overlays (
        archive_key TEXT NOT NULL,
        archive_identity TEXT NOT NULL,
        entry_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        base_digest TEXT,
        workspace_identity TEXT,
        workspace_path TEXT,
        owner_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (archive_key, entry_path)
      );
      CREATE TABLE IF NOT EXISTS entry_locks (
        lock_id TEXT PRIMARY KEY,
        archive_key TEXT NOT NULL,
        entry_path TEXT NOT NULL,
        mode TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entry_sqlite_leases (
        archive_key TEXT NOT NULL,
        entry_path TEXT NOT NULL,
        mode TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (archive_key, entry_path, owner_id)
      );
      CREATE TABLE IF NOT EXISTS archive_commit_locks (
        archive_key TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    if (input.withActiveOwner) {
      await database.run(
        "INSERT INTO archive_owners VALUES (?, 'owner', ?, ?, ?)",
        [
          archiveKey,
          nodeWikiGraphPlatform.lifecycle.instanceId,
          Date.now(),
          Date.now(),
        ],
      );
    }
    await database.run(
      `INSERT INTO entry_overlays (
         archive_key, archive_identity, entry_path, kind, owner_id, updated_at
       ) VALUES (?, ?, ?, 'deleted', 'owner', ?)`,
      [archiveKey, input.archiveIdentity, input.entryPath, Date.now()],
    );
  } finally {
    await database.close();
  }
}

async function expectPathMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toThrow();
}
