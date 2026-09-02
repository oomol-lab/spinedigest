import {
  getWikiGraphPlatform,
  resolveHostDirectory,
  resolveHostFile,
  type Directory,
  type File,
  type HostZipEntry,
} from "../../../runtime/platform/index.js";
import {
  LEGACY_SEARCH_INDEX_DATABASE_PATH,
  WIKG_MANIFEST_PATH,
  WIKG_MUTATION_TOKEN_PATH,
} from "./constants.js";
import { shouldWriteDocumentFile } from "./document-files.js";
import {
  createWikgMutationTokenContent,
  WIKG_MANIFEST_CONTENT,
} from "./manifest.js";
import {
  isWikgArchivePath,
  normalizeArchivePath,
  sortArchiveEntryPathsForWrite,
} from "./paths.js";
import type { WikgArchiveOverlay } from "./types.js";

export async function writeWikgArchive(
  documentDirectoryRef: Directory | string,
  outputFileRef: File | string,
): Promise<void> {
  await writeWikgArchiveFromDirectory(documentDirectoryRef, outputFileRef);
}

export async function writeWikgArchiveFromDirectory(
  documentDirectoryRef: Directory | string,
  outputFileRef: File | string,
): Promise<void> {
  const documentDirectory = await resolveHostDirectory(documentDirectoryRef);
  const outputFile = await resolveHostFile(outputFileRef);
  const entries = new Map<string, Uint8Array>();
  entries.set(WIKG_MUTATION_TOKEN_PATH, createWikgMutationTokenContent());
  entries.set(
    WIKG_MANIFEST_PATH,
    new TextEncoder().encode(WIKG_MANIFEST_CONTENT),
  );
  for (const entry of await listHostDocumentFiles(documentDirectory)) {
    if (
      isWikgArchivePath(entry.name) &&
      shouldWriteDocumentFile({ archivePath: entry.name })
    ) {
      entries.set(entry.name, entry.data);
    }
  }
  await writeEntries(outputFile, entries);
}

export async function writeWikgArchiveWithOverlays(
  inputFileRef: File | string,
  outputFileRef: File | string,
  overlays: readonly WikgArchiveOverlay[],
  options: { readonly preserveMutationToken?: boolean } = {},
): Promise<void> {
  const inputFile = await resolveHostFile(inputFileRef);
  const outputFile = await resolveHostFile(outputFileRef);
  const entries = new Map<string, Uint8Array>();
  for (const entry of await getWikiGraphPlatform().zip.read(inputFile)) {
    const name = normalizeArchivePath(entry.name);
    if (name !== "" && isWikgArchivePath(name)) entries.set(name, entry.data);
  }
  for (const overlay of overlays) {
    const name = normalizeArchivePath(overlay.entryPath);
    if (!isWikgArchivePath(name)) continue;
    if (overlay.kind === "deleted") entries.delete(name);
    else {
      const content = await overlay.file.read();
      entries.set(
        name,
        typeof content === "string"
          ? new TextEncoder().encode(content)
          : content,
      );
    }
  }
  entries.delete(LEGACY_SEARCH_INDEX_DATABASE_PATH);
  entries.set(
    WIKG_MUTATION_TOKEN_PATH,
    options.preserveMutationToken === true &&
      entries.has(WIKG_MUTATION_TOKEN_PATH)
      ? (entries.get(WIKG_MUTATION_TOKEN_PATH) as Uint8Array)
      : createWikgMutationTokenContent(),
  );
  entries.set(
    WIKG_MANIFEST_PATH,
    new TextEncoder().encode(WIKG_MANIFEST_CONTENT),
  );
  await writeEntries(outputFile, entries);
}

async function writeEntries(
  outputFile: File,
  entries: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  await getWikiGraphPlatform().zip.write(
    outputFile,
    sortArchiveEntryPathsForWrite(entries.keys()).map((name) => ({
      data: entries.get(name) as Uint8Array,
      name,
    })),
  );
}

async function listHostDocumentFiles(
  directory: Directory,
  prefix = "",
): Promise<HostZipEntry[]> {
  const output: HostZipEntry[] = [];
  const children = [...(await directory.list())].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const child of children) {
    const name = prefix === "" ? child.name : `${prefix}/${child.name}`;
    if ("read" in child) {
      const content = await child.read();
      output.push({
        data:
          typeof content === "string"
            ? new TextEncoder().encode(content)
            : content,
        name,
      });
    } else {
      output.push(...(await listHostDocumentFiles(child, name)));
    }
  }
  return output;
}
