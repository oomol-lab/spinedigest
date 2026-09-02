import type {
  Directory,
  File,
  HostZipEntry,
} from "../../../runtime/platform/index.js";
import {
  getWikiGraphPlatform,
  getWikiGraphStorage,
} from "../../../runtime/platform/index.js";
import type { DocumentFileStore } from "../../../document/directory/index.js";

import {
  WIKG_MANIFEST_CONTENT,
  WIKG_SCHEMA_VERSION,
  createWikgMutationTokenBytes,
  parseWikgManifest,
} from "../archive/manifest.js";
import {
  WIKG_MANIFEST_PATH,
  WIKG_MUTATION_TOKEN_PATH,
} from "../archive/constants.js";
import {
  isWikgArchivePath,
  normalizeArchivePath,
  sortArchiveEntryPathsForWrite,
} from "../archive/paths.js";
import {
  DATABASE_ENTRY_PATH,
  LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH,
  SEARCH_INDEX_DATABASE_ENTRY_PATH,
} from "./constants.js";
import { HostWikgDocumentFileStore } from "./host-file-store.js";
import type { WorkspaceWritebackPolicy } from "./types.js";

type Overlay =
  | { readonly kind: "deleted" }
  | { readonly file: File; readonly kind: "file" };

const archiveQueues = new Map<string, Promise<void>>();
let sessionSequence = 0;

/** Serialize use of one opaque host file without inspecting its implementation. */
export async function withHostArchiveSession<T>(
  archive: File,
  operation: (session: HostWikgArchiveSession) => Promise<T> | T,
): Promise<T> {
  const previous = archiveQueues.get(archive.identity) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  archiveQueues.set(archive.identity, queued);
  await previous;

  try {
    const session = await HostWikgArchiveSession.open(archive);
    try {
      return await operation(session);
    } catch (error) {
      session.abort();
      throw error;
    } finally {
      await session.close();
    }
  } finally {
    release();
    if (archiveQueues.get(archive.identity) === queued) {
      archiveQueues.delete(archive.identity);
    }
  }
}

/** Host-neutral archive transaction rooted in the injected document store. */
export class HostWikgArchiveSession {
  readonly #archive: File;
  readonly #entries: Map<string, Uint8Array>;
  readonly #overlays = new Map<string, Overlay>();
  readonly #workspaceName: string;
  readonly #workspace: Directory;
  #closed = false;
  #aborted = false;

  public constructor(
    archive: File,
    entries: Map<string, Uint8Array>,
    workspaceName: string,
    workspace: Directory,
  ) {
    this.#archive = archive;
    this.#entries = entries;
    this.#workspaceName = workspaceName;
    this.#workspace = workspace;
  }

  public static async open(archive: File): Promise<HostWikgArchiveSession> {
    const entries = new Map<string, Uint8Array>();
    for (const entry of await getWikiGraphPlatform().zip.read(archive)) {
      const path = normalizeArchivePath(entry.name);
      if (path !== "" && isWikgArchivePath(path)) entries.set(path, entry.data);
    }
    const manifestContent = entries.get(WIKG_MANIFEST_PATH);
    if (manifestContent === undefined) {
      throw new Error(`Missing WIKG manifest: ${WIKG_MANIFEST_PATH}.`);
    }
    const manifest = parseWikgManifest(
      new TextDecoder().decode(manifestContent),
    );
    if (manifest.schemaVersion !== WIKG_SCHEMA_VERSION) {
      throw new Error(
        `WIKG schema version ${manifest.schemaVersion} requires migration by a host that supports archive migration.`,
      );
    }

    const root = getWikiGraphStorage().documentStore;
    const workspaceName = await createWorkspaceName(root);
    const workspace = await root.createDirectory(workspaceName);
    return new HostWikgArchiveSession(
      archive,
      entries,
      workspaceName,
      workspace,
    );
  }

  public createFileStore(
    options: {
      readonly readonlyDatabase?: boolean;
      readonly searchIndexWritebackPolicy?: WorkspaceWritebackPolicy;
    } = {},
  ): DocumentFileStore {
    return new HostWikgDocumentFileStore(this, options);
  }

  public get archiveIdentity(): string {
    return this.#archive.identity;
  }

  public listEntries(): readonly string[] {
    const paths = new Set(this.#entries.keys());
    for (const [path, overlay] of this.#overlays) {
      if (overlay.kind === "deleted") paths.delete(path);
      else paths.add(path);
    }
    return [...paths].sort((left, right) => left.localeCompare(right));
  }

  public async readEntry(path: string): Promise<Uint8Array | undefined> {
    const entryPath = normalizeArchivePath(path);
    const overlay = this.#overlays.get(entryPath);
    if (overlay?.kind === "deleted") return undefined;
    if (overlay?.kind === "file") return await readBytes(overlay.file);
    return this.#entries.get(entryPath);
  }

  public async writeEntry(
    path: string,
    content: string | Uint8Array,
  ): Promise<void> {
    const entryPath = normalizeArchivePath(path);
    const file = await this.#workspaceFile(entryPath);
    await replaceFile(file, content);
    this.#overlays.set(entryPath, { file, kind: "file" });
  }

  public deleteEntry(path: string): void {
    this.#overlays.set(normalizeArchivePath(path), { kind: "deleted" });
  }

  public async materializeDatabase(
    path: string,
    options: { readonly createIfMissing: boolean },
  ): Promise<File> {
    const entryPath = normalizeArchivePath(path);
    const existing = this.#overlays.get(entryPath);
    if (existing?.kind === "file") return existing.file;

    const content =
      (await this.readEntry(entryPath)) ??
      (entryPath === SEARCH_INDEX_DATABASE_ENTRY_PATH
        ? await this.readEntry(LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH)
        : undefined);
    if (content === undefined && !options.createIfMissing) {
      throw new Error(`Archive SQLite entry is missing: ${entryPath}`);
    }
    const file = await this.#workspaceFile(entryPath);
    await replaceFile(file, content ?? new Uint8Array());
    return file;
  }

  public markDatabaseDirty(path: string, file: File): void {
    const entryPath = normalizeArchivePath(path);
    this.#overlays.set(entryPath, { file, kind: "file" });
    if (
      entryPath === DATABASE_ENTRY_PATH ||
      entryPath === SEARCH_INDEX_DATABASE_ENTRY_PATH
    ) {
      this.#overlays.set(LEGACY_SEARCH_INDEX_DATABASE_ENTRY_PATH, {
        kind: "deleted",
      });
    }
  }

  public async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      if (!this.#aborted && this.#overlays.size > 0) await this.#commit();
    } finally {
      await getWikiGraphStorage()
        .documentStore.remove(this.#workspaceName, { recursive: true })
        .catch(() => undefined);
    }
  }

  public abort(): void {
    this.#aborted = true;
  }

  async #workspaceFile(path: string): Promise<File> {
    const parts = normalizeArchivePath(path).split("/");
    const name = parts.pop();
    if (name === undefined || name === "") throw new TypeError("Invalid file");
    let directory = this.#workspace;
    for (const part of parts) {
      directory =
        (await directory.getDirectory(part)) ??
        (await directory.createDirectory(part));
    }
    return (
      (await directory.getFile(name)) ?? (await directory.createFile(name))
    );
  }

  async #commit(): Promise<void> {
    const paths = new Set(this.#entries.keys());
    for (const [path, overlay] of this.#overlays) {
      if (overlay.kind === "deleted") paths.delete(path);
      else paths.add(path);
    }
    paths.add(WIKG_MANIFEST_PATH);
    paths.add(WIKG_MUTATION_TOKEN_PATH);

    const entries: HostZipEntry[] = [];
    for (const path of sortArchiveEntryPathsForWrite(paths)) {
      if (path === WIKG_MUTATION_TOKEN_PATH) {
        entries.push({ data: createWikgMutationTokenBytes(), name: path });
        continue;
      }
      if (path === WIKG_MANIFEST_PATH) {
        entries.push({
          data: new TextEncoder().encode(WIKG_MANIFEST_CONTENT),
          name: path,
        });
        continue;
      }
      const content = await this.readEntry(path);
      if (content !== undefined) entries.push({ data: content, name: path });
    }
    await getWikiGraphPlatform().zip.write(this.#archive, entries);
  }
}

async function createWorkspaceName(root: Directory): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    sessionSequence += 1;
    const name = `.wikg-session-${Date.now().toString(36)}-${sessionSequence.toString(36)}`;
    if ((await root.getDirectory(name)) === undefined) return name;
  }
  throw new Error("Could not allocate a document-store workspace");
}

async function replaceFile(
  file: File,
  content: string | Uint8Array,
): Promise<void> {
  const writer = await file.openWriter();
  try {
    await writer.write(content);
    await writer.commit();
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

async function readBytes(file: File): Promise<Uint8Array> {
  const content = await file.read();
  return typeof content === "string"
    ? new TextEncoder().encode(content)
    : content;
}
