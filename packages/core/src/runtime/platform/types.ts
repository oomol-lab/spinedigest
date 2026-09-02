/** A host-owned file whose identity remains opaque to Core. */
export interface File {
  /** Logical entry name only; never a URI or operating-system path. */
  readonly name: string;
  readonly size?: number;
  read(options?: { readonly encoding?: string }): Promise<Uint8Array | string>;
  openWriter(): Promise<FileWriter>;
}

/** Transactional writer supplied by the host file system. */
export interface FileWriter {
  write(data: Uint8Array | string): Promise<void>;
  commit(): Promise<void>;
  abort(): Promise<void>;
}

/** Directory tree supplied by the host. Only relative child names are used. */
export interface Directory {
  readonly name: string;
  getFile(name: string): Promise<File | undefined>;
  getDirectory(name: string): Promise<Directory | undefined>;
  list(): Promise<ReadonlyArray<File | Directory>>;
  createFile(name: string): Promise<File>;
  createDirectory(name: string): Promise<Directory>;
  remove(
    name: string,
    options?: { readonly recursive?: boolean },
  ): Promise<void>;
}

/** Host storage roots. Their backing locations are never visible to Core. */
export interface WikiGraphStorage {
  readonly library: Directory;
  readonly documentStore: Directory;
}

export interface HostAsyncContext<T> {
  run<R>(store: T, callback: () => R): R;
  enterWith(store: T): void;
  getStore(): T | undefined;
}

export interface HostAsyncContextProvider {
  create<T>(): HostAsyncContext<T>;
}

export type HostDatabaseValue = Uint8Array | number | string | null;
export type HostDatabaseRow = Readonly<Record<string, HostDatabaseValue>>;

export interface HostDatabaseConnection {
  close(): Promise<void>;
  execute(sql: string): Promise<void>;
  queryAll(
    sql: string,
    params?: readonly HostDatabaseValue[],
  ): Promise<readonly HostDatabaseRow[]>;
  queryOne(
    sql: string,
    params?: readonly HostDatabaseValue[],
  ): Promise<HostDatabaseRow | undefined>;
  run(sql: string, params?: readonly HostDatabaseValue[]): Promise<void>;
}

export interface HostDatabaseProvider {
  open(
    file: File,
    options?: { readonly readonly?: boolean },
  ): Promise<HostDatabaseConnection>;
}

export interface HostZipEntry {
  readonly data: Uint8Array;
  readonly name: string;
}

export interface HostZipProvider {
  read(file: File): Promise<readonly HostZipEntry[]>;
  write(
    file: File,
    entries: Iterable<HostZipEntry> | AsyncIterable<HostZipEntry>,
  ): Promise<void>;
}

/** Platform-neutral host services required before Core operations run. */
export interface WikiGraphPlatform {
  readonly asyncContext: HostAsyncContextProvider;
  readonly database: HostDatabaseProvider;
  readonly zip: HostZipProvider;
}

export interface HostError extends Error {
  readonly code?: string;
  readonly errno?: number;
  readonly path?: string;
}
