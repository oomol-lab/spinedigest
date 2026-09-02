import {
  ensureRelativeFile,
  getRelativeFile,
  getWikiGraphStorage,
  type File,
} from "../runtime/platform/index.js";
import { Database } from "./database.js";

const CURRENT_HOME_SCHEMA_VERSION = 3;
const LOCK_STALE_TIMEOUT_MS = 5 * 60 * 1000;
const HOME_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS schema_versions (
    scope TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const homeSchemaUpgradesInFlight = new Map<string, Promise<void>>();

export async function ensureWikiGraphHomeSchemaCurrent(): Promise<void> {
  const root = getWikiGraphStorage().library;
  const existingUpgrade = homeSchemaUpgradesInFlight.get(root.identity);
  if (existingUpgrade !== undefined) {
    await existingUpgrade;
    return;
  }

  const upgrade = (async () => {
    const version = await readWikiGraphHomeSchemaVersion();
    if (version > CURRENT_HOME_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported Wiki Graph home schema version: ${version}.`,
      );
    }
    if (version < CURRENT_HOME_SCHEMA_VERSION && version > 0) {
      await assertHomeUpgradeSafe();
      await cleanupHomeDerivedData();
    }
    const file = await ensureRelativeFile(root, "core.sqlite");
    await writeHomeSchemaVersion(file, CURRENT_HOME_SCHEMA_VERSION);
  })();
  homeSchemaUpgradesInFlight.set(root.identity, upgrade);

  try {
    await upgrade;
  } finally {
    if (homeSchemaUpgradesInFlight.get(root.identity) === upgrade) {
      homeSchemaUpgradesInFlight.delete(root.identity);
    }
  }
}

export async function readWikiGraphHomeSchemaVersion(): Promise<number> {
  const file = await getRelativeFile(
    getWikiGraphStorage().library,
    "core.sqlite",
  );
  if (file === undefined || (await isEmpty(file))) return 0;
  const database = await Database.open(file, "", { readonly: true });
  try {
    if (!(await tableExists(database, "schema_versions"))) return 1;
    return (
      (await database.queryOne(
        "SELECT version FROM schema_versions WHERE scope = ?",
        ["home"],
        (row) => Number(row.version),
      )) ?? 1
    );
  } finally {
    await database.close();
  }
}

async function writeHomeSchemaVersion(
  file: File,
  version: number,
): Promise<void> {
  const database = await Database.open(file);
  try {
    await database.execute(HOME_SCHEMA_SQL);
    await database.run(
      `INSERT INTO schema_versions (scope, version, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(scope) DO UPDATE SET
         version = excluded.version,
         updated_at = excluded.updated_at`,
      ["home", version, new Date().toISOString()],
    );
  } finally {
    await database.close();
  }
}

async function cleanupHomeDerivedData(): Promise<void> {
  const root = getWikiGraphStorage().library;
  const cache = await root.getDirectory("cache");
  if (cache !== undefined) {
    await cache.remove("search-sessions.sqlite").catch(() => undefined);
    await cache.remove("continuation-cursors.sqlite").catch(() => undefined);
    await cache.remove("cache.sqlite").catch(() => undefined);
  }
  const staging = await root.getDirectory("staging");
  if (staging !== undefined) {
    await staging.remove("library", { recursive: true }).catch(() => undefined);
    await staging.remove("staging.sqlite").catch(() => undefined);
  }
  const temporary = await root.getDirectory("tmp");
  if (temporary !== undefined) {
    await temporary.remove("gc.sqlite").catch(() => undefined);
    await temporary.remove("gc.last-run").catch(() => undefined);
  }
  const jobs = await root.getDirectory("jobs");
  if (jobs !== undefined) {
    await jobs.remove("cache", { recursive: true }).catch(() => undefined);
    await jobs.remove("job.sqlite").catch(() => undefined);
  }
}

async function assertHomeUpgradeSafe(): Promise<void> {
  const root = getWikiGraphStorage().library;
  await assertNoFreshRows(await getRelativeFile(root, "core.sqlite"), [
    ["library_locks", "Cannot upgrade home with active library locks."],
    ["state_locks", "Cannot upgrade home with active state locks."],
  ]);
  await assertNoFreshRows(await getRelativeFile(root, "tmp/gc.sqlite"), [
    ["gc_locks", "Cannot upgrade home with an active GC lock."],
  ]);

  const jobsFile = await getRelativeFile(root, "jobs/job.sqlite");
  if (jobsFile !== undefined && !(await isEmpty(jobsFile))) {
    const database = await Database.open(jobsFile, "", { readonly: true });
    try {
      if (await tableExists(database, "build_jobs")) {
        const active = await database.queryOne(
          "SELECT 1 AS active FROM build_jobs WHERE state IN ('queued', 'running', 'canceling', 'paused') LIMIT 1",
          undefined,
          () => true,
        );
        if (active === true) {
          throw new Error("Cannot upgrade home with active build jobs.");
        }
      }
      if (await tableExists(database, "build_worker_lease")) {
        const heartbeat = await database.queryOne(
          "SELECT heartbeat_at FROM build_worker_lease WHERE id = 1",
          undefined,
          (row) => Number(row.heartbeat_at),
        );
        if (isFresh(heartbeat)) {
          throw new Error("Cannot upgrade home with an active build worker.");
        }
      }
    } finally {
      await database.close();
    }
  }
}

async function assertNoFreshRows(
  file: File | undefined,
  tables: readonly (readonly [string, string])[],
): Promise<void> {
  if (file === undefined || (await isEmpty(file))) return;
  const database = await Database.open(file, "", { readonly: true });
  try {
    for (const [table, message] of tables) {
      if (!(await tableExists(database, table))) continue;
      const heartbeat = await database.queryOne(
        `SELECT heartbeat_at FROM ${table} ORDER BY heartbeat_at DESC LIMIT 1`,
        undefined,
        (row) => Number(row.heartbeat_at),
      );
      if (isFresh(heartbeat)) throw new Error(message);
    }
  } finally {
    await database.close();
  }
}

function isFresh(heartbeat: number | undefined): boolean {
  return (
    heartbeat !== undefined && Date.now() - heartbeat <= LOCK_STALE_TIMEOUT_MS
  );
}

async function isEmpty(file: File): Promise<boolean> {
  if (file.getSize !== undefined) return (await file.getSize()) === 0;
  if (file.size !== undefined) return file.size === 0;
  const content = await file.read();
  return typeof content === "string"
    ? content.length === 0
    : content.byteLength === 0;
}

async function tableExists(database: Database, name: string): Promise<boolean> {
  return (
    (await database.queryOne(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
      [name],
      () => true,
    )) === true
  );
}
