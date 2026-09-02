/**
 * Runtime primitives used by the portable core.
 *
 * The core deliberately does not import Node modules. A host (the CLI, a
 * browser application, or a test harness) installs implementations for these
 * primitives before opening a document.
 */

export type PlatformModule = Record<string, any>;

export interface PlatformZipModule {
  readonly yauzl?: PlatformModule;
  readonly yazl?: PlatformModule;
}

export interface WikiGraphPlatform {
  readonly fs: PlatformModule;
  readonly childProcess: PlatformModule;
  readonly fsPromises: PlatformModule;
  readonly path: PlatformModule;
  readonly os: PlatformModule;
  readonly crypto: PlatformModule;
  readonly streams: PlatformModule;
  readonly streamPromises: PlatformModule;
  readonly timers: PlatformModule;
  readonly asyncHooks: PlatformModule;
  readonly zlib: PlatformModule;
  readonly url: PlatformModule;
  readonly sqlite3?: PlatformModule;
  readonly zip?: PlatformZipModule;
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

function moduleValue<T = any>(
  moduleName: keyof WikiGraphPlatform,
  key: string,
): T {
  return (getWikiGraphPlatform()[moduleName] as PlatformModule)[key] as T;
}

export const access = (...args: any[]): any =>
  moduleValue("fsPromises", "access")(...args);
export const spawn = (...args: any[]): any =>
  moduleValue("childProcess", "spawn")(...args);
export const appendFile = (...args: any[]): any =>
  moduleValue("fsPromises", "appendFile")(...args);
export const chmod = (...args: any[]): any =>
  moduleValue("fsPromises", "chmod")(...args);
export const copyFile = (...args: any[]): any =>
  moduleValue("fsPromises", "copyFile")(...args);
export const mkdir = (...args: any[]): any =>
  moduleValue("fsPromises", "mkdir")(...args);
export const mkdtemp = (...args: any[]): any =>
  moduleValue("fsPromises", "mkdtemp")(...args);
export const open = (...args: any[]): any =>
  moduleValue("fsPromises", "open")(...args);
export const opendir = (...args: any[]): any =>
  moduleValue("fsPromises", "opendir")(...args);
export const readFile = (...args: any[]): any =>
  moduleValue("fsPromises", "readFile")(...args);
export const readdir = (...args: any[]): any =>
  moduleValue("fsPromises", "readdir")(...args);
export const realpath = (...args: any[]): any =>
  moduleValue("fsPromises", "realpath")(...args);
export const rename = (...args: any[]): any =>
  moduleValue("fsPromises", "rename")(...args);
export const rm = (...args: any[]): any =>
  moduleValue("fsPromises", "rm")(...args);
export const rmdir = (...args: any[]): any =>
  moduleValue("fsPromises", "rmdir")(...args);
export const stat = (...args: any[]): any =>
  moduleValue("fsPromises", "stat")(...args);
export const unlink = (...args: any[]): any =>
  moduleValue("fsPromises", "unlink")(...args);
export const writeFile = (...args: any[]): any =>
  moduleValue("fsPromises", "writeFile")(...args);

export const constants = new Proxy({} as Record<string, number>, {
  get(_target, property: string): unknown {
    return moduleValue("fs", "constants")[property];
  },
});
export const createReadStream = (...args: any[]): any =>
  moduleValue("fs", "createReadStream")(...args);
export const createWriteStream = (...args: any[]): any =>
  moduleValue("fs", "createWriteStream")(...args);
export const existsSync = (...args: any[]): any =>
  moduleValue("fs", "existsSync")(...args);
export const mkdirSync = (...args: any[]): any =>
  moduleValue("fs", "mkdirSync")(...args);
export const readFileSync = (...args: any[]): any =>
  moduleValue("fs", "readFileSync")(...args);
export const statSync = (...args: any[]): any =>
  moduleValue("fs", "statSync")(...args);

export const basename = (...args: any[]): any =>
  moduleValue("path", "basename")(...args);
export const dirname = (...args: any[]): any =>
  moduleValue("path", "dirname")(...args);
export const extname = (...args: any[]): any =>
  moduleValue("path", "extname")(...args);
export const isAbsolute = (...args: any[]): any =>
  moduleValue("path", "isAbsolute")(...args);
export const join = (...args: any[]): any =>
  moduleValue("path", "join")(...args);
export const parse = (...args: any[]): any =>
  moduleValue("path", "parse")(...args);
export const relative = (...args: any[]): any =>
  moduleValue("path", "relative")(...args);
export const resolve = (...args: any[]): any =>
  moduleValue("path", "resolve")(...args);
// Archive paths are normalized to POSIX separators by Core. Host path helpers
// still come from the injected provider; this constant is only used for
// comparisons and remains portable across browser and Node hosts.
export const sep = "/";
export const posix = new Proxy({} as Record<string, any>, {
  get(_target, property: string): unknown {
    return moduleValue("path", "posix")[property];
  },
}) as any;

export const homedir = (...args: any[]): any =>
  moduleValue("os", "homedir")(...args);
export const tmpdir = (...args: any[]): any =>
  moduleValue("os", "tmpdir")(...args);

export const createHash = (...args: any[]): any =>
  moduleValue("crypto", "createHash")(...args);
export const randomBytes = (...args: any[]): any =>
  moduleValue("crypto", "randomBytes")(...args);
export const randomUUID = (...args: any[]): any =>
  moduleValue("crypto", "randomUUID")(...args);
export const inflateRaw = (...args: any[]): any =>
  moduleValue("zlib", "inflateRaw")(...args);
export const fileURLToPath = (...args: any[]): any =>
  moduleValue("url", "fileURLToPath")(...args);

export const PassThrough = new Proxy(function () {}, {
  construct(_target, args): object {
    return Reflect.construct(moduleValue("streams", "PassThrough"), args);
  },
}) as any;
export const Writable = new Proxy(function () {}, {
  construct(_target, args): object {
    return Reflect.construct(moduleValue("streams", "Writable"), args);
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

  public constructor() {
    const Constructor = moduleValue("asyncHooks", "AsyncLocalStorage");
    this.#impl = new Constructor();
  }

  public run<R>(store: T, callback: () => R): R {
    return this.#impl.run(store, callback);
  }

  public enterWith(store: T): void {
    this.#impl.enterWith(store);
  }

  public getStore(): T | undefined {
    return this.#impl.getStore();
  }
}

export const finishedStream = finished;

export const openZip = (...args: any[]): any => {
  const open = getWikiGraphPlatform().zip?.yauzl?.open;
  if (typeof open !== "function") {
    throw new Error("No ZIP reader has been installed.");
  }
  return open(...args);
};
export const ZipFile = new Proxy(function () {}, {
  construct(_target, args): object {
    const Constructor = getWikiGraphPlatform().zip?.yazl?.ZipFile;
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
export type Readable = any;
export type Writable = any;
export type WritableStream = any;

export function getSqlite3Module(): PlatformModule {
  const module = getWikiGraphPlatform().sqlite3;
  if (module === undefined) {
    throw new Error("No SQLite runtime has been installed.");
  }
  return module;
}
