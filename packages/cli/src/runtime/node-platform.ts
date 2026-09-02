/* eslint-disable no-restricted-syntax, @typescript-eslint/parameter-properties, @typescript-eslint/require-await */
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

import {
  installWikiGraphPlatform,
  installWikiGraphStorage,
  registerDirectoryLocation,
  registerFileLocation,
  type Directory,
  type File,
  type FileWriter,
  type WikiGraphPlatform,
} from "../../../core/src/runtime/platform/index.js";

/** Install the Node implementation used by the CLI and its workers. */
export class NodeFile implements File {
  public readonly name: string;

  public constructor(public readonly path: string) {
    this.name = pathModule.basename(path);
    registerFileLocation(this, path);
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
    let closed = false;
    return {
      write: async (data) => await fsPromises.writeFile(temporary, data),
      commit: async () => {
        if (!closed) await fsPromises.rename(temporary, this.path);
        closed = true;
      },
      abort: async () => {
        if (!closed) await fsPromises.rm(temporary, { force: true });
        closed = true;
      },
    };
  }
}

export class NodeDirectory implements Directory {
  public readonly name: string;

  public constructor(public readonly path: string) {
    this.name = pathModule.basename(path);
    registerDirectoryLocation(this, path);
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
        : new NodeFile(pathModule.join(this.path, entry.name)),
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
  fs,
  childProcess,
  process,
  buffer,
  fsPromises,
  path: pathModule,
  os,
  crypto,
  streams: stream,
  streamPromises,
  timers,
  asyncHooks,
  zlib,
  url,
  sqlite3,
  zip: { yauzl, yazl },
};

export function installNodeWikiGraphPlatform(): void {
  installWikiGraphPlatform(nodeWikiGraphPlatform);
  const stateRoot = pathModule.join(os.homedir(), ".wikigraph");
  installWikiGraphStorage({
    library: new NodeDirectory(stateRoot),
    documentStore: new NodeDirectory(pathModule.join(stateRoot, "documents")),
  });
}
