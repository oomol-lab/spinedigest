import type { LegacyRuntimePlatform, PlatformModule } from "./legacy.js";
import type {
  Directory,
  File,
  HostAsyncContext,
  HostError,
  WikiGraphPlatform,
  WikiGraphStorage,
} from "./types.js";

export type {
  Directory,
  File,
  FileWriter,
  HostAsyncContext,
  HostAsyncContextProvider,
  HostDatabaseConnection,
  HostDatabaseProvider,
  HostDatabaseRow,
  HostDatabaseValue,
  HostError,
  HostZipEntry,
  HostZipProvider,
  WikiGraphPlatform,
  WikiGraphStorage,
} from "./types.js";
export type { LegacyRuntimePlatform } from "./legacy.js";

export type NodeError = HostError;

let installedPlatform: WikiGraphPlatform | undefined;
let installedLegacyRuntime: LegacyRuntimePlatform | undefined;

/** Install the process-default platform services used by Core. */
export function installWikiGraphPlatform(platform: WikiGraphPlatform): void {
  installedPlatform = platform;
}

export function getWikiGraphPlatform(): WikiGraphPlatform {
  if (installedPlatform === undefined) {
    throw new Error(
      "No WikiGraph runtime platform has been installed. Provide a runtime adapter before using wiki-graph-core.",
    );
  }

  return installedPlatform;
}

/** Install compatibility services for Core modules awaiting host migration. */
export function installLegacyRuntimePlatform(
  platform: LegacyRuntimePlatform,
): void {
  installedLegacyRuntime = platform;
}

function legacyRuntime(): LegacyRuntimePlatform {
  if (installedLegacyRuntime === undefined) {
    throw new Error(
      "This operation still requires the legacy runtime adapter. Use the Node CLI adapter until this Core module has migrated to File/Directory.",
    );
  }
  return installedLegacyRuntime;
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

export const access = (...args: any[]): any =>
  legacyRuntime().files.access(...args);
export const spawn = (...args: any[]): any =>
  legacyRuntime().subprocess.spawn(...args);
export const runtimeContext: Record<string, any> = {
  get pid() {
    return legacyRuntime().execution.pid;
  },
  get stderr() {
    return legacyRuntime().execution.stderr;
  },
  get argv() {
    return legacyRuntime().execution.argv;
  },
  get env() {
    return legacyRuntime().execution.env;
  },
  get cwd() {
    return legacyRuntime().execution.cwd;
  },
  kill: (...args: any[]) => legacyRuntime().execution.kill(...args),
  once: (...args: any[]) => legacyRuntime().execution.once(...args),
  removeListener: (...args: any[]) =>
    legacyRuntime().execution.removeListener(...args),
};
export const appendFile = (...args: any[]): any =>
  legacyRuntime().files.appendFile(...args);
export const chmod = (...args: any[]): any =>
  legacyRuntime().files.chmod(...args);
export const copyFile = (...args: any[]): any =>
  legacyRuntime().files.copyFile(...args);
export const mkdir = (...args: any[]): any =>
  legacyRuntime().files.mkdir(...args);
export const mkdtemp = (...args: any[]): any =>
  legacyRuntime().files.mkdtemp(...args);
export const open = (...args: any[]): any =>
  legacyRuntime().files.open(...args);
export const opendir = (...args: any[]): any =>
  legacyRuntime().files.opendir(...args);
export const readFile = (...args: any[]): any =>
  legacyRuntime().files.readFile(...args);
export const readdir = (...args: any[]): any =>
  legacyRuntime().files.readdir(...args);
export const realpath = (...args: any[]): any =>
  legacyRuntime().files.realpath(...args);
export const rename = (...args: any[]): any =>
  legacyRuntime().files.rename(...args);
export const rm = (...args: any[]): any => legacyRuntime().files.rm(...args);
export const rmdir = (...args: any[]): any =>
  legacyRuntime().files.rmdir(...args);
export const stat = (...args: any[]): any =>
  legacyRuntime().files.stat(...args);
export const unlink = (...args: any[]): any =>
  legacyRuntime().files.unlink(...args);
export const writeFile = (...args: any[]): any =>
  legacyRuntime().files.writeFile(...args);
export const openDatabase = (file: File, flags: number): Promise<any> =>
  legacyRuntime().database.open(file, flags);

export const constants: Record<string, number> = {
  get O_RDONLY() {
    return legacyRuntime().files.constants.O_RDONLY;
  },
  get O_WRONLY() {
    return legacyRuntime().files.constants.O_WRONLY;
  },
  get O_CREAT() {
    return legacyRuntime().files.constants.O_CREAT;
  },
};
export const createReadStream = (...args: any[]): any =>
  legacyRuntime().files.createReadStream(...args);
export const createWriteStream = (...args: any[]): any =>
  legacyRuntime().files.createWriteStream(...args);
export const existsSync = (...args: any[]): any =>
  legacyRuntime().files.existsSync(...args);
export const mkdirSync = (...args: any[]): any =>
  legacyRuntime().files.mkdirSync(...args);
export const readFileSync = (...args: any[]): any =>
  legacyRuntime().files.readFileSync(...args);
export const statSync = (...args: any[]): any =>
  legacyRuntime().files.statSync(...args);

export const basename = (...args: any[]): any =>
  legacyRuntime().paths.basename(...args);
export const dirname = (...args: any[]): any =>
  legacyRuntime().paths.dirname(...args);
export const extname = (...args: any[]): any =>
  legacyRuntime().paths.extname(...args);
export const isAbsolute = (...args: any[]): any =>
  legacyRuntime().paths.isAbsolute(...args);
export const join = (...args: any[]): any =>
  legacyRuntime().paths.join(...args);
export const parse = (...args: any[]): any =>
  legacyRuntime().paths.parse(...args);
export const relative = (...args: any[]): any =>
  legacyRuntime().paths.relative(...args);
export const resolve = (...args: any[]): any =>
  legacyRuntime().paths.resolve(...args);
export const sep = "/";
export const posix: Record<string, any> = {
  sep: "/",
  normalize: (...args: any[]) => legacyRuntime().paths.posix.normalize(...args),
  join: (...args: any[]) => legacyRuntime().paths.posix.join(...args),
  relative: (...args: any[]) => legacyRuntime().paths.posix.relative(...args),
  dirname: (...args: any[]) => legacyRuntime().paths.posix.dirname(...args),
  basename: (...args: any[]) => legacyRuntime().paths.posix.basename(...args),
  extname: (...args: any[]) => legacyRuntime().paths.posix.extname(...args),
};

export const homedir = (...args: any[]): any =>
  legacyRuntime().system.homedir(...args);
export const tmpdir = (...args: any[]): any =>
  legacyRuntime().system.tmpdir(...args);

export const createHash = (...args: any[]): any =>
  legacyRuntime().crypto.createHash(...args);
export const randomBytes = (...args: any[]): any =>
  legacyRuntime().crypto.randomBytes(...args);
export const randomUUID = (...args: any[]): any =>
  legacyRuntime().crypto.randomUUID(...args);
export const binary: Record<string, any> = {
  from: (...args: any[]) => legacyRuntime().binary.from(...args),
  alloc: (...args: any[]) => legacyRuntime().binary.alloc(...args),
  concat: (...args: any[]) => legacyRuntime().binary.concat(...args),
  byteLength: (...args: any[]) => legacyRuntime().binary.byteLength(...args),
  isBuffer: (...args: any[]) => legacyRuntime().binary.isBuffer(...args),
};
export const inflateRaw = (...args: any[]): any =>
  legacyRuntime().compression.inflateRaw(...args);
export const fileURLToPath = (...args: any[]): any =>
  legacyRuntime().url.fileURLToPath(...args);

export const PassThrough: any = function (this: any, ...args: any[]) {
  const Constructor = legacyRuntime().streams.PassThrough;
  const delegate = new Constructor(...args);
  Object.setPrototypeOf(this, Object.getPrototypeOf(delegate));
  Object.assign(this, delegate);
};
export const Writable: any = function (this: any, ...args: any[]) {
  const Constructor = legacyRuntime().streams.Writable;
  const delegate = new Constructor(...args);
  Object.setPrototypeOf(this, Object.getPrototypeOf(delegate));
  Object.assign(this, delegate);
};
export const finished = (...args: any[]): any =>
  legacyRuntime().streams.finished(...args);
export const pipeline = (...args: any[]): any =>
  legacyRuntime().streams.pipeline(...args);
export const readLines = (input: any): AsyncIterable<string> =>
  legacyRuntime().streams.readLines(input);
export const sleep = (...args: any[]): any =>
  legacyRuntime().timers.sleep(...args);
export const setTimeout = sleep;

export class AsyncLocalStorage<T> {
  #impl: HostAsyncContext<T> | undefined;
  #fallbackStore: T | undefined;

  public run<R>(store: T, callback: () => R): R {
    const implementation = this.#implementation();
    if (implementation !== undefined) {
      return implementation.run(store, callback);
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
    const implementation = this.#implementation();
    if (implementation !== undefined) {
      implementation.enterWith(store);
    } else {
      this.#fallbackStore = store;
    }
  }

  public getStore(): T | undefined {
    return this.#implementation()?.getStore() ?? this.#fallbackStore;
  }

  #implementation(): HostAsyncContext<T> | undefined {
    if (this.#impl !== undefined) {
      return this.#impl;
    }
    if (installedPlatform === undefined) {
      return undefined;
    }

    this.#impl = installedPlatform.asyncContext.create<T>();
    if (this.#fallbackStore !== undefined) {
      this.#impl.enterWith(this.#fallbackStore);
      this.#fallbackStore = undefined;
    }
    return this.#impl;
  }
}

const storageContext = new AsyncLocalStorage<WikiGraphStorage>();
let installedStorage: WikiGraphStorage | undefined;

/** Install process-default storage, primarily for CLI bootstrap. */
export function installWikiGraphStorage(storage: WikiGraphStorage): void {
  installedStorage = storage;
}

export async function withWikiGraphStorage<T>(
  storage: WikiGraphStorage | undefined,
  operation: () => Promise<T> | T,
): Promise<T> {
  if (storage === undefined) {
    return await operation();
  }
  return await storageContext.run(storage, operation);
}

export function getWikiGraphStorage(): WikiGraphStorage {
  const storage = storageContext.getStore() ?? installedStorage;
  if (storage === undefined) {
    throw new Error(
      "No WikiGraph storage roots have been configured. Pass storage to WikiGraph or install process-default storage.",
    );
  }
  return storage;
}

export const finishedStream = finished;

export const openZip = (...args: any[]): any =>
  legacyRuntime().zip.open(...args);
export const ZipFile = class {
  [key: string]: any;
  public constructor(...args: any[]) {
    const Constructor = legacyRuntime().zip.Writer;
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
  return legacyRuntime().database.module;
}
