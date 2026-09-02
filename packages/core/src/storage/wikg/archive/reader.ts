import {
  getRelativeFile,
  getWikiGraphPlatform,
  readFileText,
  resolveHostDirectory,
  resolveHostFile,
  type Directory,
  type File,
} from "../../../runtime/platform/index.js";
import { ensureWikiGraphArchiveSchemaCurrent } from "../../schema-upgrade/index.js";
import { WIKG_MANIFEST_PATH, WIKG_MUTATION_TOKEN_PATH } from "./constants.js";
import {
  WIKG_SCHEMA_VERSION,
  parseWikgManifest,
  parseWikgMutationToken,
} from "./manifest.js";
import { isWikgArchivePath, normalizeArchivePath } from "./paths.js";

export class WikgArchiveReader {
  readonly #entries: ReadonlyMap<string, Uint8Array>;

  // eslint-disable-next-line no-restricted-syntax -- constructors cannot use JavaScript #private syntax.
  private constructor(entries: ReadonlyMap<string, Uint8Array>) {
    this.#entries = entries;
  }

  public static async open(fileRef: File | string): Promise<WikgArchiveReader> {
    const file = await resolveHostFile(fileRef);
    await ensureWikiGraphArchiveSchemaCurrent(file);
    const entries = new Map<string, Uint8Array>();
    for (const entry of await getWikiGraphPlatform().zip.read(file)) {
      const name = normalizeArchivePath(entry.name);
      if (name !== "" && isWikgArchivePath(name)) entries.set(name, entry.data);
    }
    assertCurrentArchive(entries);
    return new WikgArchiveReader(entries);
  }

  public close(): void {
    // The host owns archive reader resources.
  }

  public listEntries(): readonly string[] {
    return [...this.#entries.keys()].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  public async readEntry(entryPath: string): Promise<Uint8Array | undefined> {
    return this.#entries.get(normalizeArchivePath(entryPath));
  }
}

export async function listWikgArchiveEntries(
  file: File | string,
): Promise<readonly string[]> {
  const reader = await WikgArchiveReader.open(file);
  return reader.listEntries();
}

export async function readWikgArchiveEntry(
  file: File | string,
  entryPath: string,
): Promise<Uint8Array | undefined> {
  const reader = await WikgArchiveReader.open(file);
  return await reader.readEntry(entryPath);
}

export async function readWikgArchiveMutationToken(
  file: File | string,
): Promise<string> {
  const resolved = await resolveHostFile(file);
  const tokenEntry = (await getWikiGraphPlatform().zip.read(resolved)).find(
    (entry) => normalizeArchivePath(entry.name) === WIKG_MUTATION_TOKEN_PATH,
  );
  const content = tokenEntry?.data;
  if (content === undefined) {
    throw new Error(
      `Missing WIKG mutation token: ${WIKG_MUTATION_TOKEN_PATH}.`,
    );
  }
  return parseWikgMutationToken(new TextDecoder().decode(content));
}

function assertCurrentArchive(entries: ReadonlyMap<string, Uint8Array>): void {
  const manifest = entries.get(WIKG_MANIFEST_PATH);
  if (manifest === undefined) {
    throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
  }
  const parsed = parseWikgManifest(new TextDecoder().decode(manifest));
  if (parsed.schemaVersion !== WIKG_SCHEMA_VERSION) {
    throw new Error(
      `WIKG schema version ${parsed.schemaVersion} requires migration.`,
    );
  }
}

export async function readWikgArchiveFormatVersion(
  documentDirectoryRef: Directory | string,
): Promise<number> {
  return (
    await readDocumentManifest(await resolveHostDirectory(documentDirectoryRef))
  ).formatVersion;
}

export async function readWikgArchiveSchemaVersion(
  documentDirectoryRef: Directory | string,
): Promise<number> {
  return (
    await readDocumentManifest(await resolveHostDirectory(documentDirectoryRef))
  ).schemaVersion;
}

async function readDocumentManifest(directory: Directory) {
  const file = await getRelativeFile(directory, WIKG_MANIFEST_PATH);
  if (file === undefined) {
    throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
  }
  return parseWikgManifest(await readFileText(file));
}
