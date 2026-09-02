/**
 * Runtime primitives used by the portable core.
 *
 * The core deliberately does not import Node modules. A host (the CLI, a
 * browser application, or a test harness) installs implementations for these
 * primitives before opening a document.
 */

export type PlatformModule = Record<string, any>;

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

/** Resolve a logical relative file name inside a host-provided directory. */
export async function getRelativeFile(
  root: Directory,
  relativeName: string,
): Promise<File | undefined> {
  const parts = relativeName.replaceAll("\\", "/").split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new TypeError(`Directory path must remain relative: ${relativeName}`);
  }
  const fileName = parts.pop();
  if (!fileName) return undefined;
  let directory = root;
  for (const part of parts) {
    const next = await directory.getDirectory(part);
    if (!next) return undefined;
    directory = next;
  }
  return await directory.getFile(fileName);
}

/** Host storage roots. The names describe scope, never a concrete path. */
export interface WikiGraphStorage {
  readonly library: Directory;
  readonly documentStore: Directory;
}

export interface HostError extends Error {
  readonly code?: string;
  readonly errno?: number;
  readonly path?: string;
}
export type NodeError = HostError;

let installedPlatform: WikiGraphPlatform | undefined;
let installedStorage: WikiGraphStorage | undefined;

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

function capability<T = any>(name: string): T {
  return getWikiGraphPlatform()[name] as T;
}

export const access = (...args: any[]): any => capability("access")(...args);
export const spawn = (...args: any[]): any => capability("spawn")(...args);
export const runtimeContext: Record<string, any> = {
  get pid() {
    return capability("runtime_pid");
  },
  get stderr() {
    return capability("runtime_stderr");
  },
  get argv() {
    return capability("runtime_argv");
  },
  get env() {
    return capability("runtime_env");
  },
  get cwd() {
    return capability("runtime_cwd");
  },
  kill: (...args: any[]) => capability("runtime_kill")(...args),
  once: (...args: any[]) => capability("runtime_once")(...args),
  removeListener: (...args: any[]) =>
    capability("runtime_removeListener")(...args),
};
export const appendFile = (...args: any[]): any =>
  capability("appendFile")(...args);
export const chmod = (...args: any[]): any => capability("chmod")(...args);
export const copyFile = (...args: any[]): any =>
  capability("copyFile")(...args);
export const mkdir = (...args: any[]): any => capability("mkdir")(...args);
export const mkdtemp = (...args: any[]): any => capability("mkdtemp")(...args);
export const open = (...args: any[]): any => capability("open")(...args);
export const opendir = (...args: any[]): any => capability("opendir")(...args);
export const readFile = (...args: any[]): any =>
  capability("readFile")(...args);
export const readdir = (...args: any[]): any => capability("readdir")(...args);
export const realpath = (...args: any[]): any =>
  capability("realpath")(...args);
export const rename = (...args: any[]): any => capability("rename")(...args);
export const rm = (...args: any[]): any => capability("rm")(...args);
export const rmdir = (...args: any[]): any => capability("rmdir")(...args);
export const stat = (...args: any[]): any => capability("stat")(...args);
export const unlink = (...args: any[]): any => capability("unlink")(...args);
export const writeFile = (...args: any[]): any =>
  capability("writeFile")(...args);
export const openDatabase = (...args: any[]): any =>
  capability("database_open")(...args);

export const constants: Record<string, number> = {
  get O_RDONLY() {
    return capability("sync_constants").O_RDONLY;
  },
  get O_WRONLY() {
    return capability("sync_constants").O_WRONLY;
  },
  get O_CREAT() {
    return capability("sync_constants").O_CREAT;
  },
};
export const createReadStream = (...args: any[]): any =>
  capability("sync_createReadStream")(...args);
export const createWriteStream = (...args: any[]): any =>
  capability("sync_createWriteStream")(...args);
export const existsSync = (...args: any[]): any =>
  capability("sync_existsSync")(...args);
export const mkdirSync = (...args: any[]): any =>
  capability("sync_mkdirSync")(...args);
export const readFileSync = (...args: any[]): any =>
  capability("sync_readFileSync")(...args);
export const statSync = (...args: any[]): any =>
  capability("sync_statSync")(...args);

export const basename = (...args: any[]): any =>
  capability("path_basename")(...args);
export const dirname = (...args: any[]): any =>
  capability("path_dirname")(...args);
export const extname = (...args: any[]): any =>
  capability("path_extname")(...args);
export const isAbsolute = (...args: any[]): any =>
  capability("path_isAbsolute")(...args);
export const join = (...args: any[]): any => capability("path_join")(...args);
export const parse = (...args: any[]): any => capability("path_parse")(...args);
export const relative = (...args: any[]): any =>
  capability("path_relative")(...args);
export const resolve = (...args: any[]): any =>
  capability("path_resolve")(...args);
// Archive paths are normalized to POSIX separators by Core. Host path helpers
// still come from the injected provider; this constant is only used for
// comparisons and remains portable across browser and Node hosts.
export const sep = "/";
export const posix: Record<string, any> = {
  sep: "/",
  normalize: (...args: any[]) => capability("path_posix").normalize(...args),
  join: (...args: any[]) => capability("path_posix").join(...args),
  relative: (...args: any[]) => capability("path_posix").relative(...args),
  dirname: (...args: any[]) => capability("path_posix").dirname(...args),
  basename: (...args: any[]) => capability("path_posix").basename(...args),
  extname: (...args: any[]) => capability("path_posix").extname(...args),
};

export const homedir = (...args: any[]): any =>
  capability("system_homedir")(...args);
export const tmpdir = (...args: any[]): any =>
  capability("system_tmpdir")(...args);

export const createHash = (...args: any[]): any =>
  capability("crypto_createHash")(...args);
export const randomBytes = (...args: any[]): any =>
  capability("crypto_randomBytes")(...args);
export const randomUUID = (...args: any[]): any =>
  capability("crypto_randomUUID")(...args);
export const binary: Record<string, any> = {
  from: (...args: any[]) => capability("binary").from(...args),
  alloc: (...args: any[]) => capability("binary").alloc(...args),
  concat: (...args: any[]) => capability("binary").concat(...args),
  byteLength: (...args: any[]) => capability("binary").byteLength(...args),
  isBuffer: (...args: any[]) => capability("binary").isBuffer(...args),
};
export const inflateRaw = (...args: any[]): any =>
  capability("inflateRaw")(...args);
export const fileURLToPath = (...args: any[]): any =>
  capability("fileURLToPath")(...args);

export const PassThrough: any = function (this: any, ...args: any[]) {
  const delegate = new (capability("stream_PassThrough"))(...args);
  Object.setPrototypeOf(this, Object.getPrototypeOf(delegate));
  Object.assign(this, delegate);
};
export const Writable: any = function (this: any, ...args: any[]) {
  const delegate = new (capability("stream_Writable"))(...args);
  Object.setPrototypeOf(this, Object.getPrototypeOf(delegate));
  Object.assign(this, delegate);
};
export const finished = (...args: any[]): any =>
  capability("finished")(...args);
export const pipeline = (...args: any[]): any =>
  capability("pipeline")(...args);
export const readLines = (input: any): AsyncIterable<string> =>
  capability("readLines")(input);
export const sleep = (...args: any[]): any => capability("setTimeout")(...args);
export const setTimeout = sleep;

export class AsyncLocalStorage<T> {
  readonly #impl: any;
  #fallbackStore: T | undefined;

  public constructor() {
    try {
      const Constructor = capability("asyncLocalStorage");
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
  const open = getWikiGraphPlatform().zipOpen as
    | ((...args: any[]) => any)
    | undefined;
  if (typeof open !== "function") {
    throw new Error("No ZIP reader has been installed.");
  }
  return open(...args);
};
export const ZipFile = class {
  [key: string]: any;
  public constructor(...args: any[]) {
    const Constructor = getWikiGraphPlatform().zipWriter as any;
    if (Constructor === undefined)
      throw new Error("No ZIP writer has been installed.");
    return new Constructor(...args);
  }
};
export const YazlZipFile = ZipFile;
export type Entry = any;
export type YauzlZipFile = any;
export type ZipFile = any;
export type YazlZipFileType = any;
export type FileHandle = any;
export type Binary = any;
export type binary = any;
export type Readable = any;
export type Writable = any;
export type WritableStream = any;

export function getDatabaseCapability(): PlatformModule {
  const module = getWikiGraphPlatform().databaseModule as
    | PlatformModule
    | undefined;
  if (module === undefined)
    throw new Error("No database runtime has been installed.");
  return module;
}
