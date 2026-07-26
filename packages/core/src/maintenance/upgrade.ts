import { rm } from "fs/promises";
import { homedir } from "os";
import { resolve } from "path";

import {
  listWikiGraphLibraryArchives,
  parseWikiGraphLibraryUri,
  resolveWikiGraphLibrary,
  withWikiGraphLibraryLock,
  type ParsedWikiGraphLibraryUri,
  type WikiGraphLibraryArchiveRecord,
  type WikiGraphLibraryRecord,
} from "../library/index.js";
import { resolveWikiGraphHomeDirectoryPath } from "../runtime/common/wiki-graph/dir.js";
import { migrateLegacySdpubToWikg } from "../storage/migration/legacy-sdpub/upgrade/index.js";
import { requireArchiveUri } from "../storage/wikg/index.js";
import {
  CURRENT_ARCHIVE_SCHEMA_VERSION,
  ensureWikiGraphHomeSchemaCurrent,
  readWikiGraphArchiveSchemaVersion,
  readWikiGraphHomeSchemaVersion,
  upgradeWikiGraphArchiveSchema,
} from "../storage/schema-upgrade/index.js";

export type WikiGraphMaintenanceUpgradeResult =
  | {
      readonly kind: "home";
      readonly path: string;
      readonly schemaVersionBefore: number;
      readonly schemaVersionAfter: number;
      readonly status: "already-current" | "upgraded";
    }
  | {
      readonly kind: "archive";
      readonly path: string;
      readonly schemaVersionBefore: number;
      readonly schemaVersionAfter: number;
      readonly status: "already-current" | "upgraded";
    }
  | {
      readonly kind: "sdpub";
      readonly inputPath: string;
      readonly outputPath: string;
      readonly status: "migrated";
    }
  | WikiGraphLibraryUpgradeResult;

export interface WikiGraphLibraryUpgradeResult {
  readonly kind: "lib";
  readonly library: {
    readonly id: number;
    readonly publicId: string;
    readonly uri: string;
    readonly folderPath: string;
    readonly stagingPath: string;
  };
  readonly upgraded: readonly WikiGraphLibraryArchiveUpgradeItem[];
  readonly skipped: readonly WikiGraphLibraryArchiveUpgradeItem[];
  readonly failed?: WikiGraphLibraryArchiveFailure | undefined;
  readonly status: "already-current" | "partial" | "upgraded";
}

export interface WikiGraphLibraryArchiveUpgradeItem {
  readonly publicId: string;
  readonly uri: string;
  readonly path: string;
  readonly schemaVersionBefore: number;
  readonly schemaVersionAfter: number;
}

export interface WikiGraphLibraryArchiveFailure {
  readonly publicId: string;
  readonly uri: string;
  readonly path: string;
  readonly message: string;
}

export async function upgradeWikiGraphMaintenanceTarget(
  target: string,
  options: { readonly outputPath?: string } = {},
): Promise<WikiGraphMaintenanceUpgradeResult> {
  if (isLegacySdpubTarget(target)) {
    const result = await migrateLegacySdpubToWikg(target, options.outputPath);
    return {
      kind: "sdpub",
      inputPath: result.inputPath,
      outputPath: result.outputPath,
      status: "migrated",
    };
  }

  if (options.outputPath !== undefined) {
    throw new Error("Only sdpub maintenance upgrade supports --output.");
  }

  if (isHomeTarget(target)) {
    const path = resolveWikiGraphHomeDirectoryPath();
    const schemaVersionBefore = await readWikiGraphHomeSchemaVersion();
    await ensureWikiGraphHomeSchemaCurrent();
    const schemaVersionAfter = await readWikiGraphHomeSchemaVersion();
    return {
      kind: "home",
      path,
      schemaVersionBefore,
      schemaVersionAfter,
      status:
        schemaVersionBefore === schemaVersionAfter
          ? "already-current"
          : "upgraded",
    };
  }

  if (target.startsWith("wikg://lib")) {
    const parsed = parseWikiGraphLibraryUri(target);
    if (parsed === undefined) {
      throw new Error(`Invalid Wiki Graph library upgrade target: ${target}`);
    }
    if (parsed.kind === "archive") {
      throw new Error(
        `Library archive URIs cannot be upgraded individually. Run: wg maintenance upgrade ${formatLibraryScopeUpgradeTarget(parsed)}`,
      );
    }
    return await upgradeWikiGraphLibrarySchema(parsed);
  }

  const archivePath = resolveArchiveUpgradeTarget(target);
  const schemaVersionBefore =
    await readWikiGraphArchiveSchemaVersion(archivePath);
  await upgradeWikiGraphArchiveSchema(archivePath);
  const schemaVersionAfter =
    await readWikiGraphArchiveSchemaVersion(archivePath);
  return {
    kind: "archive",
    path: archivePath,
    schemaVersionBefore,
    schemaVersionAfter,
    status:
      schemaVersionBefore === schemaVersionAfter
        ? "already-current"
        : "upgraded",
  };
}

export async function assertWikiGraphLibrarySchemaCurrent(
  target: ParsedWikiGraphLibraryUri,
): Promise<void> {
  const library = await resolveWikiGraphLibrary(target);
  const archives = await listWikiGraphLibraryArchives({
    isDefault: library.isDefault,
    kind: "scope",
    ...(library.isDefault ? {} : { publicId: library.publicId }),
  });
  for (const archive of archives) {
    if (!isUpgradeableLibraryArchive(archive)) {
      continue;
    }
    const schemaVersion = await readWikiGraphArchiveSchemaVersion(archive.path);
    if (schemaVersion < CURRENT_ARCHIVE_SCHEMA_VERSION) {
      throw new Error(
        `This Wiki Graph library must be upgraded before use.\nRun: wg maintenance upgrade ${library.uri}`,
      );
    }
  }
}

export async function upgradeWikiGraphLibrarySchema(
  target: ParsedWikiGraphLibraryUri,
): Promise<WikiGraphLibraryUpgradeResult> {
  await ensureWikiGraphHomeSchemaCurrent();
  const library = await resolveWikiGraphLibrary(target);
  return await withWikiGraphLibraryLock(library.id, "write", async () => {
    await clearLibraryDerivedData(library);
    const archives = (
      await listWikiGraphLibraryArchives({
        isDefault: library.isDefault,
        kind: "scope",
        ...(library.isDefault ? {} : { publicId: library.publicId }),
      })
    ).filter(isUpgradeableLibraryArchive);

    const upgraded: WikiGraphLibraryArchiveUpgradeItem[] = [];
    const skipped: WikiGraphLibraryArchiveUpgradeItem[] = [];

    for (const archive of archives) {
      const schemaVersionBefore = await readWikiGraphArchiveSchemaVersion(
        archive.path,
      );
      if (schemaVersionBefore === CURRENT_ARCHIVE_SCHEMA_VERSION) {
        skipped.push({
          path: archive.path,
          publicId: archive.publicId,
          schemaVersionAfter: schemaVersionBefore,
          schemaVersionBefore,
          uri: archive.uri,
        });
        continue;
      }
      try {
        await upgradeWikiGraphArchiveSchema(archive.path);
      } catch (error) {
        return {
          failed: {
            message: formatErrorMessage(error),
            path: archive.path,
            publicId: archive.publicId,
            uri: archive.uri,
          },
          kind: "lib",
          library: formatLibraryResult(library),
          skipped,
          status: "partial",
          upgraded,
        };
      }
      upgraded.push({
        path: archive.path,
        publicId: archive.publicId,
        schemaVersionAfter: await readWikiGraphArchiveSchemaVersion(
          archive.path,
        ),
        schemaVersionBefore,
        uri: archive.uri,
      });
    }

    return {
      kind: "lib",
      library: formatLibraryResult(library),
      skipped,
      status: upgraded.length === 0 ? "already-current" : "upgraded",
      upgraded,
    };
  });
}

function resolveArchiveUpgradeTarget(target: string): string {
  if (target.startsWith("wikg://")) {
    return requireArchiveUri(target);
  }
  if (!target.endsWith(".wikg")) {
    throw new Error(
      `Unsupported maintenance upgrade target: ${target}. Expected home, a .wikg archive, a .sdpub archive, or wikg://lib.`,
    );
  }
  return resolveHomeShorthand(target);
}

function isLegacySdpubTarget(target: string): boolean {
  return target.toLowerCase().endsWith(".sdpub");
}

function isHomeTarget(target: string): boolean {
  const resolved = resolveHomeShorthand(target).replace(/[\\/]+$/u, "");
  return (
    target === "home" ||
    target === "~/.wikigraph" ||
    resolved === resolveWikiGraphHomeDirectoryPath().replace(/[\\/]+$/u, "")
  );
}

function resolveHomeShorthand(path: string): string {
  return path.startsWith("~/")
    ? resolve(homedir(), path.slice(2))
    : resolve(path);
}

function isUpgradeableLibraryArchive(
  archive: WikiGraphLibraryArchiveRecord,
): boolean {
  return archive.exists && archive.status === "present";
}

async function clearLibraryDerivedData(
  library: WikiGraphLibraryRecord,
): Promise<void> {
  await rm(library.stagingPath, { force: true, recursive: true });
}

function formatLibraryScopeUpgradeTarget(
  target: ParsedWikiGraphLibraryUri,
): string {
  return target.isDefault
    ? "wikg://lib"
    : `wikg://lib/${target.publicId ?? "<lib-id>"}`;
}

function formatLibraryResult(library: WikiGraphLibraryRecord): {
  readonly id: number;
  readonly publicId: string;
  readonly uri: string;
  readonly folderPath: string;
  readonly stagingPath: string;
} {
  return {
    folderPath: library.folderPath,
    id: library.id,
    publicId: library.publicId,
    stagingPath: library.stagingPath,
    uri: library.uri,
  };
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
