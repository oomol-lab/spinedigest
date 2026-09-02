import type { File } from "../../../runtime/platform/index.js";
import type { DocumentFileStore } from "../../../document/directory/index.js";

import {
  DATABASE_ENTRY_PATH,
  SEARCH_INDEX_DATABASE_ENTRY_PATH,
} from "./constants.js";
import { normalizeArchivePath } from "../archive/paths.js";
import type { HostWikgArchiveSession } from "./host-session.js";
import type { WorkspaceWritebackPolicy } from "./types.js";

export class HostWikgDocumentFileStore implements DocumentFileStore {
  readonly #readonlyDatabase: boolean;
  readonly #searchIndexWritebackPolicy: WorkspaceWritebackPolicy;
  readonly #session: HostWikgArchiveSession;
  #database: File | undefined;
  #searchIndexDatabase: File | undefined;

  public constructor(
    session: HostWikgArchiveSession,
    options: {
      readonly readonlyDatabase?: boolean;
      readonly searchIndexWritebackPolicy?: WorkspaceWritebackPolicy;
    },
  ) {
    this.#session = session;
    this.#readonlyDatabase = options.readonlyDatabase === true;
    this.#searchIndexWritebackPolicy =
      options.searchIndexWritebackPolicy ?? "cache";
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }
  public ensureDirectory(): Promise<void> {
    return Promise.resolve();
  }
  public initializeDatabaseSchema(): boolean {
    return false;
  }
  public openDatabaseReadonly(): boolean {
    return this.#readonlyDatabase;
  }
  public documentIdentity(): string {
    return this.#session.archiveIdentity;
  }
  public searchIndexLockKey(): object {
    return this.#session;
  }

  public async resolveDatabasePath(): Promise<File> {
    this.#database ??= await this.#session.materializeDatabase(
      DATABASE_ENTRY_PATH,
      { createIfMissing: !this.#readonlyDatabase },
    );
    return this.#database;
  }

  public async resolveSearchIndexDatabasePath(): Promise<File> {
    this.#searchIndexDatabase ??= await this.#session.materializeDatabase(
      SEARCH_INDEX_DATABASE_ENTRY_PATH,
      { createIfMissing: !this.#readonlyDatabase },
    );
    return this.#searchIndexDatabase;
  }

  public markDatabaseDirty(): void {
    if (!this.#readonlyDatabase && this.#database !== undefined) {
      this.#session.markDatabaseDirty(DATABASE_ENTRY_PATH, this.#database);
    }
  }

  public markSearchIndexDatabaseDirty(): void {
    if (
      !this.#readonlyDatabase &&
      this.#searchIndexWritebackPolicy === "archive" &&
      this.#searchIndexDatabase !== undefined
    ) {
      this.#session.markDatabaseDirty(
        SEARCH_INDEX_DATABASE_ENTRY_PATH,
        this.#searchIndexDatabase,
      );
    }
  }

  public async readFile(path: string): Promise<Uint8Array | undefined> {
    return await this.#session.readEntry(toEntryPath(path));
  }

  public async writeFile(
    path: string,
    content: string | Uint8Array,
    options: { readonly overwrite?: boolean },
  ): Promise<void> {
    const entryPath = toEntryPath(path);
    if (
      options.overwrite !== true &&
      (await this.#session.readEntry(entryPath)) !== undefined
    ) {
      throw new Error(`File already exists: ${path}`);
    }
    await this.#session.writeEntry(entryPath, content);
  }

  public async deleteFile(path: string): Promise<void> {
    this.#session.deleteEntry(toEntryPath(path));
  }

  public async deleteTree(path: string): Promise<void> {
    const root = toEntryPath(path);
    const prefix = root === "" ? "" : `${root}/`;
    for (const entry of this.#session.listEntries()) {
      if (entry === root || entry.startsWith(prefix)) {
        this.#session.deleteEntry(entry);
      }
    }
  }

  public async listFiles(path: string): Promise<readonly string[]> {
    const root = toEntryPath(path);
    const prefix = root === "" ? "" : `${root}/`;
    return this.#session
      .listEntries()
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => entry.slice(prefix.length))
      .filter((entry) => entry !== "" && !entry.includes("/"))
      .sort((left, right) => left.localeCompare(right));
  }

  public async listFileContents(
    path: string,
  ): Promise<ReadonlyMap<string, Uint8Array>> {
    const result = new Map<string, Uint8Array>();
    for (const name of await this.listFiles(path)) {
      const root = toEntryPath(path);
      const content = await this.#session.readEntry(
        root === "" ? name : `${root}/${name}`,
      );
      if (content !== undefined) result.set(name, content);
    }
    return result;
  }
}

function toEntryPath(path: string): string {
  if (path === "" || path === ".") return "";
  return normalizeArchivePath(path);
}
