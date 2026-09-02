import { binary as platformBinary } from "../../../runtime/platform/index.js";
import { readFile } from "../../../runtime/platform/index.js";
import { join } from "../../../runtime/platform/index.js";

import type {
  Entry,
  File,
  ZipFile as YauzlZipFile,
} from "../../../runtime/platform/index.js";

import { WIKG_MANIFEST_PATH, WIKG_MUTATION_TOKEN_PATH } from "./constants.js";
import { parseWikgManifest, parseWikgMutationToken } from "./manifest.js";
import { isWikgArchivePath, normalizeArchivePath } from "./paths.js";
import { openIndexedArchive, readArchiveEntryBuffer } from "./zip.js";
import { ensureWikiGraphArchiveSchemaCurrent } from "../../schema-upgrade/index.js";

export class WikgArchiveReader {
  readonly #entryByPath: Map<string, Entry>;
  readonly #entries: readonly string[];
  readonly #path: string | File;
  readonly #zipFile: YauzlZipFile;

  public constructor(
    path: string | File,
    zipFile: YauzlZipFile,
    entries: readonly Entry[],
  ) {
    this.#path = path;
    this.#zipFile = zipFile;
    this.#entryByPath = new Map(
      entries
        .map(
          (entry: any) =>
            [normalizeArchivePath(entry.fileName), entry] as const,
        )
        .filter(([entryPath]) => entryPath !== "")
        .filter(([entryPath]) => isWikgArchivePath(entryPath)),
    );
    this.#entries = [...this.#entryByPath.keys()].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  public static async open(
    inputPath: string | File,
  ): Promise<WikgArchiveReader> {
    if (typeof inputPath === "string") {
      await ensureWikiGraphArchiveSchemaCurrent(inputPath);
    }
    const { entries, zipFile } = await openIndexedArchive(inputPath);

    return new WikgArchiveReader(inputPath, zipFile, entries);
  }

  public close(): void {
    this.#zipFile.close();
  }

  public listEntries(): readonly string[] {
    return this.#entries;
  }

  public async readEntry(
    entryPath: string,
  ): Promise<platformBinary | undefined> {
    const entry = this.#entryByPath.get(normalizeArchivePath(entryPath));

    if (entry === undefined) {
      return undefined;
    }

    return await readArchiveEntryBuffer(this.#path, entry);
  }
}

export async function listWikgArchiveEntries(
  inputPath: string,
): Promise<readonly string[]> {
  const reader = await WikgArchiveReader.open(inputPath);

  try {
    return reader.listEntries();
  } finally {
    reader.close();
  }
}

export async function readWikgArchiveEntry(
  inputPath: string,
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
  inputPath: string,
): Promise<string> {
  const reader = await WikgArchiveReader.open(inputPath);

  try {
    const content = await reader.readEntry(WIKG_MUTATION_TOKEN_PATH);

    if (content === undefined) {
      throw new Error(
        `Missing WIKG mutation token: ${WIKG_MUTATION_TOKEN_PATH}.`,
      );
    }

    return parseWikgMutationToken(content.toString("utf8"));
  } finally {
    reader.close();
  }
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
