import { Buffer as platformBuffer } from "../../../runtime/platform/index.js";
import {
  open as openFile,
  type FileHandle,
} from "../../../runtime/platform/index.js";
import type { File } from "../../../runtime/platform/index.js";
import { inflateRaw } from "../../../runtime/platform/index.js";

import {
  openZip,
  type Entry,
  type ZipFile as YauzlZipFile,
} from "../../../runtime/platform/index.js";

import { WIKG_MANIFEST_PATH, WIKG_MUTATION_TOKEN_PATH } from "./constants.js";
import { parseWikgManifest, parseWikgMutationToken } from "./manifest.js";
import { normalizeArchivePath } from "./paths.js";

export async function openIndexedArchive(inputPath: string | File): Promise<{
  readonly entries: readonly Entry[];
  readonly zipFile: YauzlZipFile;
}> {
  const zipFile = await openArchive(inputPath);

  try {
    const entries = await indexArchiveEntries(zipFile);

    await validateArchiveManifest(inputPath, entries);
    return { entries, zipFile };
  } catch (error) {
    zipFile.close();
    throw error;
  }
}

export async function indexArchiveEntries(
  zipFile: YauzlZipFile,
): Promise<readonly Entry[]> {
  return await new Promise((resolve, reject) => {
    const entries: Entry[] = [];

    zipFile.on("entry", (entry: Entry) => {
      if (entry.fileName.endsWith("/")) {
        zipFile.readEntry();
        return;
      }

      entries.push(entry);
      zipFile.readEntry();
    });
    zipFile.once("end", () => {
      resolve(entries);
    });
    zipFile.once("error", (error: Error) => {
      reject(error);
    });

    zipFile.readEntry();
  });
}

export async function readArchiveEntryText(
  inputPath: string | File,
  entry: Entry,
): Promise<string> {
  return (await readArchiveEntryBuffer(inputPath, entry)).toString("utf8");
}

export async function readArchiveEntryBuffer(
  inputPath: string | File,
  entry: Entry,
): Promise<platformBuffer> {
  const file =
    typeof inputPath === "string"
      ? await openFile(inputPath, "r")
      : new MemoryFileHandle(await inputPath.read());

  try {
    return await readArchiveEntryBufferFromFile(file, entry);
  } finally {
    await file.close();
  }
}

export async function readArchiveEntryBufferFromFile(
  file: FileHandle,
  entry: Entry,
): Promise<platformBuffer> {
  const compressed = await readCompressedArchiveEntryBuffer(file, entry);

  if (entry.compressionMethod === 0) {
    return compressed;
  }
  if (entry.compressionMethod === 8) {
    return await inflateRawBuffer(compressed);
  }

  throw new Error(`Unsupported ZIP compression method: ${entry.fileName}`);
}

async function openArchive(path: string | File): Promise<YauzlZipFile> {
  const source =
    typeof path === "string"
      ? path
      : platformBuffer.from((await path.read()) as Uint8Array);
  return await new Promise((resolve, reject) => {
    openZip(
      source,
      { autoClose: false, lazyEntries: true },
      (error: any, zipFile: any) => {
        if (error !== null || zipFile === undefined) {
          reject(error ?? new Error("Cannot open archive"));
          return;
        }

        resolve(zipFile);
      },
    );
  });
}

class MemoryFileHandle {
  readonly #data: platformBuffer;

  public constructor(data: Uint8Array | string) {
    this.#data =
      typeof data === "string"
        ? platformBuffer.from(data, "utf8")
        : platformBuffer.from(data);
  }

  public async read(
    target: platformBuffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesRead: number; readonly buffer: platformBuffer }> {
    const bytesRead = Math.max(
      0,
      Math.min(length, this.#data.length - position),
    );
    if (bytesRead > 0) {
      this.#data.copy(target, offset, position, position + bytesRead);
    }
    return { bytesRead, buffer: target };
  }

  public async close(): Promise<void> {
    // Nothing to release for an in-memory host file.
  }
}

async function validateArchiveManifest(
  inputPath: string | File,
  entries: readonly Entry[],
): Promise<void> {
  await validateArchiveMutationToken(inputPath, entries);

  const entry = entries.find(
    (candidate) =>
      normalizeArchivePath(candidate.fileName) === WIKG_MANIFEST_PATH,
  );

  if (entry === undefined) {
    throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
  }

  parseWikgManifest(await readArchiveEntryText(inputPath, entry));
}

async function validateArchiveMutationToken(
  inputPath: string | File,
  entries: readonly Entry[],
): Promise<void> {
  const firstEntryPath = normalizeArchivePath(entries[0]?.fileName ?? "");

  if (firstEntryPath !== WIKG_MUTATION_TOKEN_PATH) {
    throw new Error(
      `Missing WIKG mutation token: ${WIKG_MUTATION_TOKEN_PATH}.`,
    );
  }

  parseWikgMutationToken(await readArchiveEntryText(inputPath, entries[0]!));
}

async function readCompressedArchiveEntryBuffer(
  file: FileHandle,
  entry: Entry,
): Promise<platformBuffer> {
  const header = platformBuffer.alloc(30);

  await file.read(header, 0, header.length, entry.relativeOffsetOfLocalHeader);
  if (header.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`Invalid ZIP local file header: ${entry.fileName}`);
  }

  const fileNameLength = header.readUInt16LE(26);
  const extraFieldLength = header.readUInt16LE(28);
  const dataOffset =
    entry.relativeOffsetOfLocalHeader + 30 + fileNameLength + extraFieldLength;
  const compressed = platformBuffer.alloc(entry.compressedSize);

  await file.read(compressed, 0, compressed.length, dataOffset);
  return compressed;
}

async function inflateRawBuffer(
  input: platformBuffer,
): Promise<platformBuffer> {
  return await new Promise((resolveInflate, rejectInflate) => {
    inflateRaw(input, (error: any, output: any) => {
      if (error !== null) {
        rejectInflate(error);
        return;
      }

      resolveInflate(output);
    });
  });
}
