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
  installWikiGraphPlatform,
  installWikiGraphStorage,
  type Directory,
  type File,
  type FileWriter,
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

export const nodeWikiGraphPlatform: WikiGraphPlatform = {
  fileSystem: fs,
  subprocess: childProcess,
  runtime: process,
  binary: buffer,
  fileSystemPromises: fsPromises,
  pathTools: pathModule,
  system: os,
  cryptography: crypto,
  stream,
  streamPromises,
  timers,
  asyncContext: asyncHooks,
  compression: zlib,
  urlTools: url,
  database: {
    ...sqlite3,
    open: async (file: File, flags: number) =>
      await new Promise((resolve, reject) => {
        const database = new sqlite3.Database(
          (file as NodeFile).path,
          flags,
          (error) => (error === null ? resolve(database) : reject(error)),
        );
      }),
  },
  databaseModule: sqlite3,
  archive: { reader: yauzl, writer: yazl },
};

// Flatten the Node implementation into the neutral capability names consumed
// by core. Core receives these functions, never Node module objects.
Object.assign(nodeWikiGraphPlatform, {
  access: fsPromises.access,
  appendFile: fsPromises.appendFile,
  chmod: fsPromises.chmod,
  copyFile: fsPromises.copyFile,
  mkdir: fsPromises.mkdir,
  mkdtemp: fsPromises.mkdtemp,
  open: fsPromises.open,
  opendir: fsPromises.opendir,
  readFile: fsPromises.readFile,
  readdir: fsPromises.readdir,
  realpath: fsPromises.realpath,
  rename: fsPromises.rename,
  rm: fsPromises.rm,
  rmdir: fsPromises.rmdir,
  stat: fsPromises.stat,
  unlink: fsPromises.unlink,
  writeFile: fsPromises.writeFile,
  spawn: childProcess.spawn,
  runtime_pid: nodeProcess.pid,
  runtime_stderr: nodeProcess.stderr,
  runtime_argv: nodeProcess.argv,
  runtime_env: nodeProcess.env,
  runtime_cwd: nodeProcess.cwd.bind(nodeProcess),
  runtime_kill: nodeProcess.kill.bind(nodeProcess),
  runtime_once: nodeProcess.once.bind(nodeProcess),
  runtime_removeListener: nodeProcess.removeListener.bind(nodeProcess),
  sync_constants: fs.constants,
  sync_createReadStream: fs.createReadStream,
  sync_createWriteStream: fs.createWriteStream,
  sync_existsSync: fs.existsSync,
  sync_mkdirSync: fs.mkdirSync,
  sync_readFileSync: fs.readFileSync,
  sync_statSync: fs.statSync,
  path_basename: pathModule.basename,
  path_dirname: pathModule.dirname,
  path_extname: pathModule.extname,
  path_isAbsolute: pathModule.isAbsolute,
  path_join: pathModule.join,
  path_parse: pathModule.parse,
  path_relative: pathModule.relative,
  path_resolve: pathModule.resolve,
  path_posix: pathModule.posix,
  system_homedir: os.homedir,
  system_tmpdir: os.tmpdir,
  crypto_createHash: crypto.createHash,
  crypto_randomBytes: crypto.randomBytes,
  crypto_randomUUID: crypto.randomUUID,
  binary: buffer.Buffer,
  inflateRaw: zlib.inflateRaw,
  fileURLToPath: url.fileURLToPath,
  stream_PassThrough: stream.PassThrough,
  stream_Writable: stream.Writable,
  finished: streamPromises.finished,
  pipeline: streamPromises.pipeline,
  setTimeout: timers.setTimeout,
  asyncLocalStorage: asyncHooks.AsyncLocalStorage,
  readLines: (input: NodeJS.ReadableStream) =>
    createInterface({ input, crlfDelay: Infinity }),
  zipOpen: yauzl.open,
  zipWriter: yazl.ZipFile,
  database_open: async (file: File, flags: number) =>
    await new Promise((resolve, reject) => {
      const database = new sqlite3.Database(
        (file as NodeFile).path,
        flags,
        (error) => (error === null ? resolve(database) : reject(error)),
      );
    }),
});

export function installNodeWikiGraphPlatform(): void {
  installWikiGraphPlatform(nodeWikiGraphPlatform);
  const stateRoot = pathModule.join(os.homedir(), ".wikigraph");
  installWikiGraphStorage({
    library: new NodeDirectory(stateRoot),
    documentStore: new NodeDirectory(pathModule.join(stateRoot, "documents")),
  });
}
