import { randomUUID } from "crypto";
import { mkdtemp, rename, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";

import { Database, DirectoryDocument } from "../../document/index.js";
import { ensureChapterKeys } from "../../document/chapter/toc.js";
import type { MutableTocFile } from "../../document/chapter/tree.js";
import { TEXT_STREAM_KIND } from "../../document/text-streams/types.js";
import { ensureWikiGraphHomeSchemaCurrent } from "../../document/home-schema-upgrade.js";
import { replaceChapterFtsIndexArtifact } from "../../retrieval/index-artifact/index.js";
import {
  resolveWikiGraphHomeDirectoryPath,
  resolveWikiGraphStagingDirectoryPath,
} from "../../runtime/common/wiki-graph/dir.js";
import { countTextWords } from "../../utils/text-word-count.js";
import {
  SEARCH_INDEX_DATABASE_PATH,
  LEGACY_SEARCH_INDEX_DATABASE_PATH,
  WIKG_MANIFEST_PATH,
} from "../wikg/archive/constants.js";
import { DATABASE_ENTRY_PATH } from "../wikg/wikg-coordinator/constants.js";
import { extractWikgArchive } from "../wikg/archive/extract.js";
import { parseWikgManifest } from "../wikg/archive/manifest.js";
import { normalizeArchivePath } from "../wikg/archive/paths.js";
import {
  openIndexedArchive,
  readArchiveEntryText,
} from "../wikg/archive/zip.js";
import { writeWikgArchiveWithOverlays } from "../wikg/archive/write.js";
import { createArchiveKey } from "../wikg/wikg-coordinator/archive-key.js";
import { tocFileSchema, type TocFile } from "../../text/source/toc.js";

export {
  ensureWikiGraphHomeSchemaCurrent,
  readWikiGraphHomeSchemaVersion,
} from "../../document/home-schema-upgrade.js";

export const CURRENT_ARCHIVE_SCHEMA_VERSION = 3;
const LOCK_STALE_TIMEOUT_MS = 5 * 60 * 1000;

export interface WikiGraphArchiveSchemaUpgradeResult {
  readonly changed: boolean;
  readonly repairedToc: boolean;
  readonly repairedTextWords: boolean;
  readonly schemaChanged: boolean;
}

export async function ensureWikiGraphArchiveSchemaCurrent(
  archivePath: string,
): Promise<void> {
  const schemaVersion = await readWikiGraphArchiveSchemaVersion(archivePath);

  if (schemaVersion > CURRENT_ARCHIVE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Wiki Graph archive schema version: ${schemaVersion}.`,
    );
  }
  if (schemaVersion < CURRENT_ARCHIVE_SCHEMA_VERSION) {
    throw new Error(
      `This Wiki Graph archive uses schema v${schemaVersion} and must be upgraded before use.\nRun: wg maintenance upgrade ${archivePath}`,
    );
  }
}

export async function readWikiGraphArchiveSchemaVersion(
  archivePath: string,
): Promise<number> {
  const { entries, zipFile } = await openIndexedArchive(resolve(archivePath));

  try {
    const manifestEntry = entries.find(
      (entry) => normalizeArchivePath(entry.fileName) === WIKG_MANIFEST_PATH,
    );

    if (manifestEntry === undefined) {
      throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
    }

    return parseWikgManifest(
      await readArchiveEntryText(resolve(archivePath), manifestEntry),
    ).schemaVersion;
  } finally {
    zipFile.close();
  }
}

export async function upgradeWikiGraphArchiveSchema(
  archivePath: string,
): Promise<WikiGraphArchiveSchemaUpgradeResult> {
  const resolvedArchivePath = resolve(archivePath);
  const schemaVersion =
    await readWikiGraphArchiveSchemaVersion(resolvedArchivePath);

  if (schemaVersion > CURRENT_ARCHIVE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Wiki Graph archive schema version: ${schemaVersion}.`,
    );
  }

  const temporaryDirectories: string[] = [];

  try {
    const tocOverlay = await createChapterTocUpgradeOverlay(
      resolvedArchivePath,
      temporaryDirectories,
    );
    const schemaChanged = schemaVersion < CURRENT_ARCHIVE_SCHEMA_VERSION;
    const archiveDatabaseUpgrade = await createArchiveDatabaseUpgradeOverlay(
      resolvedArchivePath,
      temporaryDirectories,
      { refreshArtifacts: schemaChanged },
    );

    if (
      !schemaChanged &&
      tocOverlay === undefined &&
      archiveDatabaseUpgrade.overlay === undefined
    ) {
      return {
        changed: false,
        repairedToc: false,
        repairedTextWords: false,
        schemaChanged: false,
      };
    }

    await ensureWikiGraphHomeSchemaCurrent();

    const archiveKey = createArchiveKey(resolvedArchivePath);
    await assertArchiveUpgradeSafe(archiveKey);

    const temporaryPath = join(
      dirname(resolvedArchivePath),
      `.${getArchiveBasename(resolvedArchivePath)}.${process.pid}.${randomUUID()}.upgrade.tmp`,
    );

    await writeWikgArchiveWithOverlays(
      resolvedArchivePath,
      temporaryPath,
      [
        ...(schemaChanged
          ? [
              {
                entryPath: SEARCH_INDEX_DATABASE_PATH,
                kind: "deleted" as const,
              },
              {
                entryPath: LEGACY_SEARCH_INDEX_DATABASE_PATH,
                kind: "deleted" as const,
              },
            ]
          : []),
        ...(archiveDatabaseUpgrade.overlay === undefined
          ? []
          : [archiveDatabaseUpgrade.overlay]),
        ...(tocOverlay === undefined ? [] : [tocOverlay]),
      ],
      { preserveMutationToken: true },
    );
    await rename(temporaryPath, resolvedArchivePath);
    await cleanupArchiveDerivedData(archiveKey);

    return {
      changed: true,
      repairedToc: tocOverlay !== undefined,
      repairedTextWords: archiveDatabaseUpgrade.repairedTextWords,
      schemaChanged,
    };
  } finally {
    await Promise.all(
      temporaryDirectories.map(async (path) => {
        await deletePathIfExists(path);
      }),
    );
  }
}

async function createChapterTocUpgradeOverlay(
  archivePath: string,
  temporaryDirectories: string[],
): Promise<
  | {
      readonly entryPath: "toc.json";
      readonly kind: "file";
      readonly workspacePath: string;
    }
  | undefined
> {
  const { entries, zipFile } = await openIndexedArchive(archivePath);

  try {
    const tocEntry = entries.find(
      (entry) => normalizeArchivePath(entry.fileName) === "toc.json",
    );

    if (tocEntry === undefined) {
      return undefined;
    }

    const tocText = await readArchiveEntryText(archivePath, tocEntry);
    let toc: TocFile;

    try {
      const parsed = tocFileSchema.safeParse(JSON.parse(tocText));
      if (!parsed.success) {
        return undefined;
      }
      toc = parsed.data;
    } catch {
      return undefined;
    }

    const mutableToc = JSON.parse(JSON.stringify(toc)) as MutableTocFile;
    if (!ensureChapterKeys(mutableToc.items)) {
      return undefined;
    }

    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "wikigraph-toc-upgrade-"),
    );
    temporaryDirectories.push(temporaryDirectory);
    const workspacePath = join(temporaryDirectory, "toc.json");
    await writeFile(
      workspacePath,
      `${JSON.stringify(mutableToc, null, 2)}\n`,
      "utf8",
    );

    return {
      entryPath: "toc.json",
      kind: "file",
      workspacePath,
    };
  } finally {
    zipFile.close();
  }
}

async function createArchiveDatabaseUpgradeOverlay(
  archivePath: string,
  temporaryDirectories: string[],
  options: { readonly refreshArtifacts: boolean },
): Promise<{
  readonly overlay:
    | {
        readonly entryPath: typeof DATABASE_ENTRY_PATH;
        readonly kind: "file";
        readonly workspacePath: string;
      }
    | undefined;
  readonly repairedTextWords: boolean;
}> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "wikigraph-archive-upgrade-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  await extractWikgArchive(archivePath, temporaryDirectory);

  const document = await DirectoryDocument.open(temporaryDirectory);
  let repairedTextWords = false;

  try {
    repairedTextWords = await repairTextSentenceWordCounts(document);
    if (options.refreshArtifacts) {
      await refreshChapterArtifacts(document);
    }
  } finally {
    await document.release();
  }

  const databasePath = join(temporaryDirectory, DATABASE_ENTRY_PATH);
  if (!(await pathExists(databasePath))) {
    return { overlay: undefined, repairedTextWords };
  }
  if (!options.refreshArtifacts && !repairedTextWords) {
    return { overlay: undefined, repairedTextWords: false };
  }

  return {
    overlay: {
      entryPath: DATABASE_ENTRY_PATH,
      kind: "file",
      workspacePath: databasePath,
    },
    repairedTextWords,
  };
}

async function refreshChapterArtifacts(
  document: DirectoryDocument,
): Promise<void> {
  const serialIds = await document.readDatabase(async (database) =>
    database.queryAll(
      `
        SELECT id
        FROM serials
        ORDER BY document_order, id
      `,
      undefined,
      (row) => Number(row.id),
    ),
  );

  for (const serialId of serialIds) {
    await replaceChapterFtsIndexArtifact(document, serialId);
  }

  await document.readDatabase(async (database) => {
    await database.run("DROP TABLE IF EXISTS archive_index_settings");
  });
}

async function repairTextSentenceWordCounts(
  document: DirectoryDocument,
): Promise<boolean> {
  const rows = await document.readDatabase(async (database) =>
    database.queryAll(
      `
        SELECT kind, chapter_id, sentence_index, words_count, byte_offset, byte_length
        FROM text_sentence_records
        ORDER BY kind, chapter_id, sentence_index
      `,
      undefined,
      (row) => ({
        byteLength: Number(row.byte_length),
        byteOffset: Number(row.byte_offset),
        chapterId: Number(row.chapter_id),
        kind: Number(row.kind),
        sentenceIndex: Number(row.sentence_index),
        wordsCount: Number(row.words_count),
      }),
    ),
  );
  let cachedTextKey: string | undefined;
  let cachedTextBuffer: Buffer | undefined;
  const updates: Array<{
    readonly chapterId: number;
    readonly kind: number;
    readonly sentenceIndex: number;
    readonly wordsCount: number;
  }> = [];

  for (const row of rows) {
    const streamName = getTextStreamName(row.kind);
    if (streamName === undefined) {
      continue;
    }

    const textKey = `${streamName}:${row.chapterId}`;
    if (textKey !== cachedTextKey) {
      cachedTextKey = textKey;
      const text =
        streamName === "source"
          ? await document.getSerialFragments(row.chapterId).readText()
          : await document.getSummaryFragments(row.chapterId).readText();

      cachedTextBuffer =
        text === undefined ? undefined : Buffer.from(text, "utf8");
    }
    if (cachedTextBuffer === undefined) {
      continue;
    }

    const sentenceText = cachedTextBuffer
      .subarray(row.byteOffset, row.byteOffset + row.byteLength)
      .toString("utf8");
    const wordsCount = countTextWords(sentenceText);

    if (wordsCount === row.wordsCount) {
      continue;
    }

    updates.push({
      chapterId: row.chapterId,
      kind: row.kind,
      sentenceIndex: row.sentenceIndex,
      wordsCount,
    });
  }

  if (updates.length === 0) {
    return false;
  }

  await document.readDatabase(async (database) => {
    await database.transaction(async () => {
      for (const update of updates) {
        await database.run(
          `
            UPDATE text_sentence_records
            SET words_count = ?
            WHERE kind = ? AND chapter_id = ? AND sentence_index = ?
          `,
          [
            update.wordsCount,
            update.kind,
            update.chapterId,
            update.sentenceIndex,
          ],
        );
      }
    });
  });

  return true;
}

function getTextStreamName(kind: number): "source" | "summary" | undefined {
  if (kind === TEXT_STREAM_KIND.source) {
    return "source";
  }
  if (kind === TEXT_STREAM_KIND.summary) {
    return "summary";
  }

  return undefined;
}

async function cleanupArchiveDerivedData(archiveKey: string): Promise<void> {
  const cacheDirectoryPath = join(resolveWikiGraphHomeDirectoryPath(), "cache");
  await deletePathIfExists(join(cacheDirectoryPath, "search-sessions.sqlite"));
  await deletePathIfExists(
    join(cacheDirectoryPath, "continuation-cursors.sqlite"),
  );

  const stagingDatabasePath = join(
    resolveWikiGraphStagingDirectoryPath(),
    "staging.sqlite",
  );
  if (await pathExists(stagingDatabasePath)) {
    await removeArchiveSearchIndexOverlays(stagingDatabasePath, archiveKey);
  }
}

async function assertArchiveUpgradeSafe(archiveKey: string): Promise<void> {
  const stagingDatabasePath = join(
    resolveWikiGraphStagingDirectoryPath(),
    "staging.sqlite",
  );

  if (!(await pathExists(stagingDatabasePath))) {
    return;
  }

  const database = await Database.open(stagingDatabasePath, "", {
    readonly: true,
  });

  try {
    for (const tableName of [
      "archive_owners",
      "entry_locks",
      "entry_sqlite_leases",
      "archive_commit_locks",
    ]) {
      if (!(await tableExists(database, tableName))) {
        continue;
      }

      const rows = await database.queryAll(
        `
          SELECT owner_pid, heartbeat_at
          FROM ${tableName}
          WHERE archive_key = ?
        `,
        [archiveKey],
        (row) => ({
          heartbeatAt: Number(row.heartbeat_at),
          ownerPid: Number(row.owner_pid),
        }),
      );

      if (rows.some((row) => isActiveLock(row.ownerPid, row.heartbeatAt))) {
        throw new Error(
          `Cannot upgrade archive with active coordinator state: ${archiveKey}.`,
        );
      }
    }

    if (await tableExists(database, "entry_overlays")) {
      const overlays = await database.queryAll(
        `
          SELECT entry_path
          FROM entry_overlays
          WHERE archive_key = ?
        `,
        [archiveKey],
        (row) => String(row.entry_path),
      );

      const problematicOverlay = overlays.find(
        (entryPath) => !isDerivedSearchIndexPath(entryPath),
      );
      if (problematicOverlay !== undefined) {
        throw new Error(
          `Cannot upgrade archive with non-derived overlay state: ${archiveKey}.`,
        );
      }
    }
  } finally {
    await database.close();
  }
}

async function removeArchiveSearchIndexOverlays(
  stagingDatabasePath: string,
  archiveKey?: string,
): Promise<void> {
  const database = await Database.open(stagingDatabasePath);

  try {
    if (!(await tableExists(database, "entry_overlays"))) {
      return;
    }

    const whereClause =
      archiveKey === undefined
        ? "WHERE entry_path IN (?, ?)"
        : "WHERE archive_key = ? AND entry_path IN (?, ?)";
    const parameters =
      archiveKey === undefined
        ? [SEARCH_INDEX_DATABASE_PATH, LEGACY_SEARCH_INDEX_DATABASE_PATH]
        : [
            archiveKey,
            SEARCH_INDEX_DATABASE_PATH,
            LEGACY_SEARCH_INDEX_DATABASE_PATH,
          ];
    const overlays = await database.queryAll(
      `
        SELECT archive_key, workspace_path
        FROM entry_overlays
        ${whereClause}
      `,
      parameters,
      (row) => ({
        archiveKey: String(row.archive_key),
        workspacePath:
          row.workspace_path === null ? undefined : String(row.workspace_path),
      }),
    );

    for (const overlay of overlays) {
      if (overlay.workspacePath !== undefined) {
        await deletePathIfExists(overlay.workspacePath);
      }
    }

    await database.run(
      `
        DELETE FROM entry_overlays
        ${whereClause}
      `,
      parameters,
    );
  } finally {
    await database.close();
  }
}

function isDerivedSearchIndexPath(entryPath: string): boolean {
  return (
    entryPath === SEARCH_INDEX_DATABASE_PATH ||
    entryPath === LEGACY_SEARCH_INDEX_DATABASE_PATH
  );
}

async function tableExists(
  database: Database,
  tableName: string,
): Promise<boolean> {
  const row = await database.queryOne(
    `
      SELECT 1 AS present
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `,
    [tableName],
    () => true,
  );

  return row === true;
}

function isActiveLock(ownerPid: number, heartbeatAt: number): boolean {
  return (
    Date.now() - heartbeatAt <= LOCK_STALE_TIMEOUT_MS &&
    isProcessAlive(ownerPid)
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function deletePathIfExists(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function getArchiveBasename(archivePath: string): string {
  return archivePath.split(/[\\/]/u).pop() ?? "archive.wikg";
}
