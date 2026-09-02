import { binary as platformBinary } from "../../../runtime/platform/index.js";
import {
  getWikiGraphPlatform,
  readFile,
} from "../../../runtime/platform/index.js";
import { join } from "../../../runtime/platform/index.js";

import type {
  Entry,
  File,
  ZipFile as YauzlZipFile,
} from "../../../runtime/platform/index.js";

import { WIKG_MANIFEST_PATH, WIKG_MUTATION_TOKEN_PATH } from "./constants.js";
import {
  WIKG_SCHEMA_VERSION,
  parseWikgManifest,
  parseWikgMutationToken,
} from "./manifest.js";
import { isWikgArchivePath, normalizeArchivePath } from "./paths.js";
import { openIndexedArchive, readArchiveEntryBuffer } from "./zip.js";
import { ensureWikiGraphArchiveSchemaCurrent } from "../../schema-upgrade/index.js";

export class WikgArchiveReader {
  readonly #entryByPath: Map<string, Entry>;
  readonly #hostEntryByPath: ReadonlyMap<string, Uint8Array> | undefined;
  readonly #entries: readonly string[];
  readonly #path: string | File;
  readonly #zipFile: YauzlZipFile | undefined;

  public constructor(
    path: string | File,
    zipFile: YauzlZipFile | undefined,
    entries: readonly Entry[],
    hostEntryByPath?: ReadonlyMap<string, Uint8Array>,
  ) {
    this.#path = path;
    this.#zipFile = zipFile;
    this.#hostEntryByPath = hostEntryByPath;
    this.#entryByPath = new Map(
      entries
        .map(
          (entry: any) =>
            [normalizeArchivePath(entry.fileName), entry] as const,
        )
        .filter(([entryPath]) => entryPath !== "")
        .filter(([entryPath]) => isWikgArchivePath(entryPath)),
    );
    this.#entries = [
      ...(hostEntryByPath?.keys() ?? this.#entryByPath.keys()),
    ].sort((left, right) => left.localeCompare(right));
  }

  public static async open(
    inputPath: string | File,
  ): Promise<WikgArchiveReader> {
    if (typeof inputPath === "string") {
      await ensureWikiGraphArchiveSchemaCurrent(inputPath);
      const { entries, zipFile } = await openIndexedArchive(inputPath);
      return new WikgArchiveReader(inputPath, zipFile, entries);
    }
    const entries = new Map<string, Uint8Array>();
    for (const entry of await getWikiGraphPlatform().zip.read(inputPath)) {
      const entryPath = normalizeArchivePath(entry.name);
      if (entryPath !== "" && isWikgArchivePath(entryPath)) {
        entries.set(entryPath, entry.data);
      }
    }
    assertCurrentHostArchive(entries);
    return new WikgArchiveReader(inputPath, undefined, [], entries);
  }

  public close(): void {
    this.#zipFile?.close();
  }

  public listEntries(): readonly string[] {
    return this.#entries;
  }

  public async readEntry(
    entryPath: string,
  ): Promise<platformBinary | undefined> {
    const entry = this.#entryByPath.get(normalizeArchivePath(entryPath));

    if (this.#hostEntryByPath !== undefined) {
      return this.#hostEntryByPath.get(normalizeArchivePath(entryPath));
    }

    if (entry === undefined) {
      return undefined;
    }

    return await readArchiveEntryBuffer(this.#path, entry);
  }
}

export async function listWikgArchiveEntries(
  inputPath: string | File,
): Promise<readonly string[]> {
  const reader = await WikgArchiveReader.open(inputPath);

  try {
    return reader.listEntries();
  } finally {
    reader.close();
  }
}

export async function readWikgArchiveEntry(
  inputPath: string | File,
  entryPath: string,
): Promise<platformBinary | undefined> {
  const reader = await WikgArchiveReader.open(inputPath);

  try {
    return await reader.readEntry(entryPath);
  } finally {
    reader.close();
  }
}

export async function readWikgArchiveMutationToken(
  inputPath: string | File,
): Promise<string> {
  const reader = await WikgArchiveReader.open(inputPath);

  try {
    const content = await reader.readEntry(WIKG_MUTATION_TOKEN_PATH);

    if (content === undefined) {
      throw new Error(
        `Missing WIKG mutation token: ${WIKG_MUTATION_TOKEN_PATH}.`,
      );
    }

    return parseWikgMutationToken(decodeUtf8(content));
  } finally {
    reader.close();
  }
}

function assertCurrentHostArchive(
  entries: ReadonlyMap<string, Uint8Array>,
): void {
  const manifest = entries.get(WIKG_MANIFEST_PATH);
  if (manifest === undefined) {
    throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
  }
  const parsed = parseWikgManifest(decodeUtf8(manifest));
  if (parsed.schemaVersion !== WIKG_SCHEMA_VERSION) {
    throw new Error(
      `WIKG schema version ${parsed.schemaVersion} requires migration by a host that supports archive migration.`,
    );
  }
}

function decodeUtf8(content: Uint8Array): string {
  return new TextDecoder().decode(content);
}

export async function readWikgArchiveFormatVersion(
  documentDirectoryPath: string,
): Promise<number> {
  return parseWikgManifest(
    await readFile(join(documentDirectoryPath, WIKG_MANIFEST_PATH), "utf8"),
  ).formatVersion;
}

export async function readWikgArchiveSchemaVersion(
  documentDirectoryPath: string,
): Promise<number> {
  return parseWikgManifest(
    await readFile(join(documentDirectoryPath, WIKG_MANIFEST_PATH), "utf8"),
  ).schemaVersion;
}
