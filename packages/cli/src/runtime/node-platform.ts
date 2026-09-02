/* eslint-disable no-restricted-syntax, @typescript-eslint/parameter-properties */
import * as asyncHooks from "node:async_hooks";
import * as buffer from "node:buffer";
import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as pathModule from "node:path";
import * as process from "node:process";
import * as stream from "node:stream";
import * as streamPromises from "node:stream/promises";
import * as timers from "node:timers/promises";
import * as url from "node:url";
import * as zlib from "node:zlib";
import * as sqlite3 from "sqlite3";
import * as yauzl from "yauzl";
import * as yazl from "yazl";
import { createInterface } from "node:readline";

const nodeProcess =
  (process as unknown as { default?: typeof process }).default ?? process;

import {
  installLegacyRuntimePlatform,
  installWikiGraphPlatform,
  installWikiGraphStorage,
  type Directory,
  type File,
  type FileWriter,
  type HostDatabaseConnection,
  type HostDatabaseRow,
  type HostDatabaseValue,
  type HostZipEntry,
  type LegacyRuntimePlatform,
  type WikiGraphPlatform,
} from "../../../core/src/runtime/platform/index.js";

/** Install the Node implementation used by the CLI and its workers. */
export class NodeFile implements File {
  public readonly name: string;

  public constructor(
    public readonly path: string,
    name = pathModule.basename(path),
  ) {
    this.name = name;
  }

  public async read(options?: {
    readonly encoding?: string;
  }): Promise<Uint8Array | string> {
    return await fsPromises.readFile(
      this.path,
      options?.encoding === undefined
        ? undefined
        : { encoding: options.encoding as BufferEncoding },
    );
  }

  public async openWriter(): Promise<FileWriter> {
    const temporary = `${this.path}.tmp-${crypto.randomUUID()}`;
    const handle = await fsPromises.open(temporary, "wx");
    let closed = false;
    return {
      write: async (data) => {
        if (closed) throw new Error("Cannot write to a closed FileWriter");
        if (typeof data === "string") await handle.write(data);
        else await handle.write(Buffer.from(data));
      },
      commit: async () => {
        if (!closed) {
          await handle.close();
          await fsPromises.rename(temporary, this.path);
        }
        closed = true;
      },
      abort: async () => {
        if (!closed) {
          await handle.close();
          await fsPromises.rm(temporary, { force: true });
        }
        closed = true;
      },
    };
  }
}

export class NodeDirectory implements Directory {
  public readonly name: string;

  public constructor(public readonly path: string) {
    this.name = pathModule.basename(path);
  }

  public async getFile(name: string): Promise<File | undefined> {
    assertChildName(name);
    const file = new NodeFile(pathModule.join(this.path, name));
    try {
      return (await fsPromises.stat(file.path)).isFile() ? file : undefined;
    } catch {
      return undefined;
    }
  }

  public async getDirectory(name: string): Promise<Directory | undefined> {
    assertChildName(name);
    const directory = new NodeDirectory(pathModule.join(this.path, name));
    try {
      return (await fsPromises.stat(directory.path)).isDirectory()
        ? directory
        : undefined;
    } catch {
      return undefined;
    }
  }

  public async list(): Promise<ReadonlyArray<File | Directory>> {
    const entries = await fsPromises.readdir(this.path, {
      withFileTypes: true,
    });
    return entries.map((entry) =>
      entry.isDirectory()
        ? new NodeDirectory(pathModule.join(this.path, entry.name))
        : new NodeFile(pathModule.join(this.path, entry.name), entry.name),
    );
  }

  public async createFile(name: string): Promise<File> {
    assertChildName(name);
    const file = new NodeFile(pathModule.join(this.path, name));
    await fsPromises.writeFile(file.path, "", { flag: "wx" });
    return file;
  }

  public async createDirectory(name: string): Promise<Directory> {
    assertChildName(name);
    const directory = new NodeDirectory(pathModule.join(this.path, name));
    await fsPromises.mkdir(directory.path);
    return directory;
  }

  public async remove(
    name: string,
    options?: { readonly recursive?: boolean },
  ): Promise<void> {
    assertChildName(name);
    await fsPromises.rm(pathModule.join(this.path, name), {
      force: true,
      recursive: options?.recursive === true,
    });
  }
}

function assertChildName(name: string): void {
  if (
    name.length === 0 ||
    pathModule.isAbsolute(name) ||
    name.split(pathModule.sep).some((part) => part === "..")
  ) {
    throw new TypeError(`Directory child must be a relative name: ${name}`);
  }
}

class NodeDatabaseConnection implements HostDatabaseConnection {
  public constructor(private readonly database: sqlite3.Database) {}

  public async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.database.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  public async execute(sql: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.database.exec(sql, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  public async queryAll(
    sql: string,
    params: readonly HostDatabaseValue[] = [],
  ): Promise<readonly HostDatabaseRow[]> {
    return await new Promise((resolve, reject) => {
      this.database.all(sql, [...params], (error, rows: HostDatabaseRow[]) => {
        if (error) reject(error);
        else resolve(rows);
      });
    });
  }

  public async queryOne(
    sql: string,
    params: readonly HostDatabaseValue[] = [],
  ): Promise<HostDatabaseRow | undefined> {
    return await new Promise((resolve, reject) => {
      this.database.get(sql, [...params], (error, row: HostDatabaseRow) => {
        if (error) reject(error);
        else resolve(row);
      });
    });
  }

  public async run(
    sql: string,
    params: readonly HostDatabaseValue[] = [],
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.database.run(sql, [...params], (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

async function openNodeDatabase(
  file: File,
  options: { readonly readonly?: boolean } = {},
): Promise<NodeDatabaseConnection> {
  const flags =
    (options.readonly === true
      ? sqlite3.OPEN_READONLY
      : sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE) | sqlite3.OPEN_FULLMUTEX;
  return new NodeDatabaseConnection(await openNativeNodeDatabase(file, flags));
}

async function openNativeNodeDatabase(
  file: File,
  flags: number,
): Promise<sqlite3.Database> {
  if (!(file instanceof NodeFile)) {
    throw new TypeError("The Node database adapter requires a NodeFile");
  }
  return await new Promise((resolve, reject) => {
    const database = new sqlite3.Database(file.path, flags, (error) => {
      if (error) reject(error);
      else resolve(database);
    });
  });
}

async function readNodeZip(file: File): Promise<readonly HostZipEntry[]> {
  const content = await file.read();
  const source =
    typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(source, { lazyEntries: true }, (error, opened) => {
      if (error || opened === undefined)
        reject(error ?? new Error("Cannot open ZIP"));
      else resolve(opened);
    });
  });

  return await new Promise((resolve, reject) => {
    const entries: HostZipEntry[] = [];
    zipFile.on("entry", (entry: yauzl.Entry) => {
      if (entry.fileName.endsWith("/")) {
        zipFile.readEntry();
        return;
      }
      zipFile.openReadStream(entry, (error, stream) => {
        if (error || stream === undefined) {
          reject(
            error ?? new Error(`Cannot read ZIP entry: ${entry.fileName}`),
          );
          return;
        }
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.once("error", reject);
        stream.once("end", () => {
          entries.push({ data: Buffer.concat(chunks), name: entry.fileName });
          zipFile.readEntry();
        });
      });
    });
    zipFile.once("error", reject);
    zipFile.once("end", () => resolve(entries));
    zipFile.readEntry();
  });
}

async function writeNodeZip(
  file: File,
  entries: Iterable<HostZipEntry> | AsyncIterable<HostZipEntry>,
): Promise<void> {
  const zipFile = new yazl.ZipFile();
  const output = collectNodeStream(zipFile.outputStream);
  for await (const entry of entries) {
    zipFile.addBuffer(Buffer.from(entry.data), entry.name);
  }
  zipFile.end();

  const writer = await file.openWriter();
  try {
    await writer.write(await output);
    await writer.commit();
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

async function collectNodeStream(
  input: NodeJS.ReadableStream,
): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    input.on("data", (chunk: Buffer) => chunks.push(chunk));
    input.once("error", reject);
    input.once("end", () => resolve(Buffer.concat(chunks)));
  });
}

export const nodeWikiGraphPlatform: WikiGraphPlatform = {
  asyncContext: {
    create: <T>() => new asyncHooks.AsyncLocalStorage<T>(),
  },
  database: { open: openNodeDatabase },
  zip: { read: readNodeZip, write: writeNodeZip },
};

const nodeLegacyRuntimePlatform: LegacyRuntimePlatform = {
  binary: buffer.Buffer,
  compression: { inflateRaw: zlib.inflateRaw },
  crypto: {
    createHash: crypto.createHash,
    randomBytes: crypto.randomBytes,
    randomUUID: crypto.randomUUID,
  },
  database: {
    module: sqlite3,
    open: openNativeNodeDatabase,
  },
  files: {
    access: fsPromises.access,
    appendFile: fsPromises.appendFile,
    chmod: fsPromises.chmod,
    constants: fs.constants,
    copyFile: fsPromises.copyFile,
    createReadStream: fs.createReadStream,
    createWriteStream: fs.createWriteStream,
    existsSync: fs.existsSync,
    mkdir: fsPromises.mkdir,
    mkdirSync: fs.mkdirSync,
    mkdtemp: fsPromises.mkdtemp,
    open: fsPromises.open,
    opendir: fsPromises.opendir,
    readFile: fsPromises.readFile,
    readFileSync: fs.readFileSync,
    readdir: fsPromises.readdir,
    realpath: fsPromises.realpath,
    rename: fsPromises.rename,
    rm: fsPromises.rm,
    rmdir: fsPromises.rmdir,
    stat: fsPromises.stat,
    statSync: fs.statSync,
    unlink: fsPromises.unlink,
    writeFile: fsPromises.writeFile,
  },
  paths: {
    basename: pathModule.basename,
    dirname: pathModule.dirname,
    extname: pathModule.extname,
    isAbsolute: pathModule.isAbsolute,
    join: pathModule.join,
    parse: pathModule.parse,
    posix: pathModule.posix,
    relative: pathModule.relative,
    resolve: pathModule.resolve,
  },
  execution: {
    argv: nodeProcess.argv,
    cwd: nodeProcess.cwd.bind(nodeProcess),
    env: nodeProcess.env,
    kill: nodeProcess.kill.bind(nodeProcess),
    once: nodeProcess.once.bind(nodeProcess),
    pid: nodeProcess.pid,
    removeListener: nodeProcess.removeListener.bind(nodeProcess),
    stderr: nodeProcess.stderr,
  },
  streams: {
    finished: streamPromises.finished,
    PassThrough: stream.PassThrough,
    pipeline: streamPromises.pipeline,
    readLines: (input: NodeJS.ReadableStream) =>
      createInterface({ input, crlfDelay: Infinity }),
    Writable: stream.Writable,
  },
  subprocess: { spawn: childProcess.spawn },
  system: { homedir: os.homedir, tmpdir: os.tmpdir },
  timers: { sleep: timers.setTimeout },
  url: { fileURLToPath: url.fileURLToPath },
  zip: { open: yauzl.open, Writer: yazl.ZipFile },
};

export function installNodeWikiGraphPlatform(): void {
  installWikiGraphPlatform(nodeWikiGraphPlatform);
  installLegacyRuntimePlatform(nodeLegacyRuntimePlatform);
  const stateRoot = pathModule.join(os.homedir(), ".wikigraph");
  installWikiGraphStorage({
    library: new NodeDirectory(stateRoot),
    documentStore: new NodeDirectory(pathModule.join(stateRoot, "documents")),
  });
}
