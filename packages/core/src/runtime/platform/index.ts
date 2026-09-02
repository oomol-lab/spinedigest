/**
 * Runtime primitives used by the portable core.
 *
 * The core deliberately does not import Node modules. A host (the CLI, a
 * browser application, or a test harness) installs implementations for these
 * primitives before opening a document.
 */

export type PlatformModule = Record<string, any>;

export interface PlatformArchiveModule {
  readonly reader?: PlatformModule;
  readonly writer?: PlatformModule;
}

/**
 * Opaque host capability bag. Core only relies on capability names internally;
 * hosts are free to provide browser, extension, or Node implementations.
 */
export interface WikiGraphPlatform {
  readonly [capability: string]: unknown;
}

/** A host-owned file. Core never interprets its backing URI or path. */
export interface File {
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

/** Host storage roots. The names describe scope, never a concrete path. */
export interface WikiGraphStorage {
  readonly library: Directory;
  readonly documentStore: Directory;
}

export interface NodeError extends Error {
  readonly code?: string;
  readonly errno?: number;
  readonly path?: string;
}

let installedPlatform: WikiGraphPlatform | undefined;
let installedStorage: WikiGraphStorage | undefined;
const fileLocations = new WeakMap<object, string>();
const directoryLocations = new WeakMap<object, string>();

export function registerFileLocation(file: File, location: string): void {
  fileLocations.set(file, location);
}

export function registerDirectoryLocation(
  directory: Directory,
  location: string,
): void {
  directoryLocations.set(directory, location);
}

export function installWikiGraphPlatform(platform: WikiGraphPlatform): void {
  installedPlatform = platform;
}

export function getWikiGraphPlatform(): WikiGraphPlatform {
  if (installedPlatform === undefined) {
    throw new Error(
      "No WikiGraph runtime platform has been installed. Provide File/Directory and runtime adapters before using wiki-graph-core.",
    );
  }

  return installedPlatform;
}

export function installWikiGraphStorage(storage: WikiGraphStorage): void {
  installedStorage = storage;
}

export function getWikiGraphStorage(): WikiGraphStorage {
  if (installedStorage === undefined) {
    throw new Error(
      "No WikiGraph storage roots have been installed. Provide library and documentStore Directory implementations.",
    );
  }
  return installedStorage;
}

export function getHostFileHandle(file: File): string {
  const location = fileLocations.get(file);
  if (location === undefined) {
    throw new Error("The supplied File is not bound to this host runtime.");
  }
  return location;
}

export function getHostDirectoryHandle(directory: Directory): string {
  const location = directoryLocations.get(directory);
  if (location === undefined) {
    throw new Error(
      "The supplied Directory is not bound to this host runtime.",
    );
  }
  return location;
}

function moduleValue<T = any>(moduleName: string, key: string): T {
  return (getWikiGraphPlatform()[moduleName] as PlatformModule)[key] as T;
}

export const access = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "access")(...args);
export const spawn = (...args: any[]): any =>
  moduleValue("subprocess", "spawn")(...args);
export const process = new Proxy({} as Record<string, any>, {
  get(_target, property: string): unknown {
    return moduleValue("runtime", property);
  },
});
export const appendFile = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "appendFile")(...args);
export const chmod = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "chmod")(...args);
export const copyFile = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "copyFile")(...args);
export const mkdir = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "mkdir")(...args);
export const mkdtemp = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "mkdtemp")(...args);
export const open = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "open")(...args);
export const opendir = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "opendir")(...args);
export const readFile = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "readFile")(...args);
export const readdir = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "readdir")(...args);
export const realpath = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "realpath")(...args);
export const rename = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "rename")(...args);
export const rm = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "rm")(...args);
export const rmdir = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "rmdir")(...args);
export const stat = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "stat")(...args);
export const unlink = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "unlink")(...args);
export const writeFile = (...args: any[]): any =>
  moduleValue("fileSystemPromises", "writeFile")(...args);
export const openDatabase = (...args: any[]): any =>
  moduleValue("database", "open")(...args);

export const constants = new Proxy({} as Record<string, number>, {
  get(_target, property: string): unknown {
    return moduleValue("fileSystem", "constants")[property];
  },
});
export const createReadStream = (...args: any[]): any =>
  moduleValue("fileSystem", "createReadStream")(...args);
export const createWriteStream = (...args: any[]): any =>
  moduleValue("fileSystem", "createWriteStream")(...args);
export const existsSync = (...args: any[]): any =>
  moduleValue("fileSystem", "existsSync")(...args);
export const mkdirSync = (...args: any[]): any =>
  moduleValue("fileSystem", "mkdirSync")(...args);
export const readFileSync = (...args: any[]): any =>
  moduleValue("fileSystem", "readFileSync")(...args);
export const statSync = (...args: any[]): any =>
  moduleValue("fileSystem", "statSync")(...args);

export const basename = (...args: any[]): any =>
  moduleValue("pathTools", "basename")(...args);
export const dirname = (...args: any[]): any =>
  moduleValue("pathTools", "dirname")(...args);
export const extname = (...args: any[]): any =>
  moduleValue("pathTools", "extname")(...args);
export const isAbsolute = (...args: any[]): any =>
  moduleValue("pathTools", "isAbsolute")(...args);
export const join = (...args: any[]): any =>
  moduleValue("pathTools", "join")(...args);
export const parse = (...args: any[]): any =>
  moduleValue("pathTools", "parse")(...args);
export const relative = (...args: any[]): any =>
  moduleValue("pathTools", "relative")(...args);
export const resolve = (...args: any[]): any =>
  moduleValue("pathTools", "resolve")(...args);
// Archive paths are normalized to POSIX separators by Core. Host path helpers
// still come from the injected provider; this constant is only used for
// comparisons and remains portable across browser and Node hosts.
export const sep = "/";
export const posix = new Proxy({} as Record<string, any>, {
  get(_target, property: string): unknown {
    return moduleValue("pathTools", "posix")[property];
  },
}) as any;

export const homedir = (...args: any[]): any =>
  moduleValue("system", "homedir")(...args);
export const tmpdir = (...args: any[]): any =>
  moduleValue("system", "tmpdir")(...args);

export const createHash = (...args: any[]): any =>
  moduleValue("cryptography", "createHash")(...args);
export const randomBytes = (...args: any[]): any =>
  moduleValue("cryptography", "randomBytes")(...args);
export const randomUUID = (...args: any[]): any =>
  moduleValue("cryptography", "randomUUID")(...args);
export const Buffer = new Proxy(function () {}, {
  construct(_target, args): object {
    const Constructor = moduleValue("binary", "Buffer");
    return Reflect.construct(Constructor, args);
  },
  get(_target, property: string): unknown {
    return moduleValue("binary", "Buffer")[property];
  },
}) as any;
export const inflateRaw = (...args: any[]): any =>
  moduleValue("compression", "inflateRaw")(...args);
export const fileURLToPath = (...args: any[]): any =>
  moduleValue("urlTools", "fileURLToPath")(...args);

export const PassThrough = new Proxy(function () {}, {
  construct(_target, args): object {
    return Reflect.construct(moduleValue("stream", "PassThrough"), args);
  },
}) as any;
export const Writable = new Proxy(function () {}, {
  construct(_target, args): object {
    return Reflect.construct(moduleValue("stream", "Writable"), args);
  },
}) as any;
export const finished = (...args: any[]): any =>
  moduleValue("streamPromises", "finished")(...args);
export const pipeline = (...args: any[]): any =>
  moduleValue("streamPromises", "pipeline")(...args);
export const sleep = (...args: any[]): any =>
  moduleValue("timers", "setTimeout")(...args);
export const setTimeout = sleep;

export class AsyncLocalStorage<T> {
  readonly #impl: any;
  #fallbackStore: T | undefined;

  public constructor() {
    try {
      const Constructor = moduleValue("asyncContext", "AsyncLocalStorage");
      this.#impl = new Constructor();
    } catch {
      // Importing the neutral core must not require a host runtime to have
      // been installed already. The host implementation takes over once it
      // is installed; this tiny fallback keeps pure parsing/type utilities
      // usable before that point.
      this.#impl = undefined;
    }
  }

  public run<R>(store: T, callback: () => R): R {
    if (this.#impl !== undefined) {
      return this.#impl.run(store, callback);
    }
    const previous = this.#fallbackStore;
    this.#fallbackStore = store;
    try {
      return callback();
    } finally {
      this.#fallbackStore = previous;
    }
  }

  public enterWith(store: T): void {
    if (this.#impl !== undefined) {
      this.#impl.enterWith(store);
    } else {
      this.#fallbackStore = store;
    }
  }

  public getStore(): T | undefined {
    return this.#impl === undefined
      ? this.#fallbackStore
      : this.#impl.getStore();
  }
}

export const finishedStream = finished;

export const openZip = (...args: any[]): any => {
  const open = (
    getWikiGraphPlatform().archive as PlatformArchiveModule | undefined
  )?.reader?.open;
  if (typeof open !== "function") {
    throw new Error("No ZIP reader has been installed.");
  }
  return open(...args);
};
export const ZipFile = new Proxy(function () {}, {
  construct(_target, args): object {
    const Constructor = (
      getWikiGraphPlatform().archive as PlatformArchiveModule | undefined
    )?.writer?.ZipFile;
    if (Constructor === undefined) {
      throw new Error("No ZIP writer has been installed.");
    }
    return Reflect.construct(Constructor, args);
  },
}) as any;
export const YazlZipFile = ZipFile;
export type Entry = any;
export type YauzlZipFile = any;
export type ZipFile = any;
export type YazlZipFileType = any;
export type FileHandle = any;
export type Buffer = any;
export type Readable = any;
export type Writable = any;
export type WritableStream = any;

export function getSqlite3Module(): PlatformModule {
  const module = getWikiGraphPlatform().database as PlatformModule | undefined;
  if (module === undefined) {
    throw new Error("No SQLite runtime has been installed.");
  }
  return module;
}
