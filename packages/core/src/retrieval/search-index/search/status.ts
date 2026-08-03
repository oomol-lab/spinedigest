import { getNumber, type Database } from "../../../document/database.js";
import type { ReadonlyDocument } from "../../../document/index.js";
import { isMissingSearchIndexError } from "./errors.js";
import {
  createSearchIndexFingerprint,
  readSearchIndexFingerprintFromDatabase,
} from "./fingerprint.js";
import type {
  SearchIndexCapabilityStatus,
  SearchIndexInput,
  SearchIndexStatus,
} from "./types.js";

export async function isSearchIndexCurrent(
  document: ReadonlyDocument,
  input?: SearchIndexInput,
): Promise<boolean> {
  return (await readSearchIndexStatus(document, input)) === "current";
}

export async function readSearchIndexStatus(
  document: ReadonlyDocument,
  input?: SearchIndexInput,
): Promise<SearchIndexStatus> {
  const fingerprint =
    input === undefined ? undefined : createSearchIndexFingerprint(input);

  try {
    return await document.readSearchIndexDatabase(async (database) => {
      if (await hasDirtySearchIndexChapters(database)) {
        return "dirty";
      }

      const indexedFingerprint =
        await readSearchIndexFingerprintFromDatabase(database);

      if (indexedFingerprint === undefined) {
        return "dirty";
      }

      return fingerprint === undefined || indexedFingerprint === fingerprint
        ? "current"
        : "dirty";
    });
  } catch (error) {
    if (isMissingSearchIndexError(error)) {
      return "missing";
    }

    throw error;
  }
}

export async function readSearchIndexCapabilityStatus(document: {
  readSearchIndexDatabase<T>(
    operation: (database: Database) => Promise<T> | T,
  ): Promise<T>;
}): Promise<SearchIndexCapabilityStatus> {
  try {
    return await document.readSearchIndexDatabase(async (database) => {
      const indexes = await readStateValue(database, "indexes");
      const current = await isSearchIndexDatabaseCurrent(database);

      if (indexes !== "fts,dense") {
        return {
          dense: { current: false },
          indexes: indexes === "missing" ? "missing" : "fts",
        };
      }

      const [sentenceCount, vectorCount] = await Promise.all([
        countRows(database, "text_sentence_records"),
        countRows(database, "text_sentence_embeddings"),
      ]);
      const dimensions = parseOptionalPositiveInteger(
        await readStateValue(database, "embeddingDimensions"),
      );
      const model = await readStateValue(database, "embeddingModel");

      return {
        dense: {
          current: current && sentenceCount === vectorCount,
          ...(dimensions === undefined ? {} : { dimensions }),
          ...(model === undefined || model === "" ? {} : { model }),
        },
        indexes: "fts,dense",
      };
    });
  } catch (error) {
    if (isMissingSearchIndexError(error)) {
      return { dense: { current: false }, indexes: "missing" };
    }

    throw error;
  }
}

async function isSearchIndexDatabaseCurrent(
  database: Database,
): Promise<boolean> {
  if (await hasDirtySearchIndexChapters(database)) {
    return false;
  }

  return (await readSearchIndexFingerprintFromDatabase(database)) !== undefined;
}

export async function hasDirtySearchIndexChapters(
  database: Database,
): Promise<boolean> {
  if (!(await hasTable(database, "index_dirty_chapters"))) {
    return false;
  }

  const dirty = await database.queryOne(
    `
      SELECT 1 AS found
      FROM index_dirty_chapters
      LIMIT 1
    `,
    undefined,
    (row) => getNumber(row, "found"),
  );

  return dirty === 1;
}

async function hasTable(database: Database, table: string): Promise<boolean> {
  const row = await database.queryOne(
    `
      SELECT 1 AS found
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `,
    [table],
    (value) => getNumber(value, "found"),
  );

  return row === 1;
}

async function countRows(database: Database, table: string): Promise<number> {
  return (
    (await database.queryOne(
      `SELECT COUNT(*) AS count FROM ${table}`,
      undefined,
      (row) => getNumber(row, "count"),
    )) ?? 0
  );
}

async function readStateValue(
  database: Database,
  key: string,
): Promise<string | undefined> {
  return await database.queryOne(
    `
      SELECT value
      FROM search_index_state
      WHERE key = ?
    `,
    [key],
    (row) => String(row.value),
  );
}

function parseOptionalPositiveInteger(
  value: string | undefined,
): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function assertSearchIndexNotDirty(
  database: Database,
): Promise<void> {
  if (await hasDirtySearchIndexChapters(database)) {
    throw new Error(
      "Archive search index is dirty; rebuild the index before querying.",
    );
  }
}
