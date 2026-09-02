/* eslint-disable no-restricted-syntax, @typescript-eslint/parameter-properties */
import * as asyncHooks from "node:async_hooks";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as pathModule from "node:path";
import * as process from "node:process";
import * as sqlite3 from "sqlite3";
import * as yauzl from "yauzl";
import * as yazl from "yazl";
import { Environment, Loader, type LoaderSource } from "nunjucks";

const nodeProcess =
  (process as unknown as { default?: typeof process }).default ?? process;

import {
  installWikiGraphPlatform,
  installWikiGraphStorage,
  withWikiGraphStorage,
  type Directory,
  type File,
  type FileWriter,
  type HostDatabaseConnection,
  type HostDatabaseRow,
  type HostDatabaseValue,
  type HostZipEntry,
  type WikiGraphPlatform,
  type WikiGraphStorage,
} from "../../../core/src/runtime/platform/index.js";
import { normalizeTemplateName } from "../../../core/src/runtime/common/template.js";

/** Install the Node implementation used by the CLI and its workers. */
export class NodeFile implements File {
  public readonly identity: string;
  public readonly name: string;

  public constructor(
    public readonly path: string,
    name = pathModule.basename(path),
  ) {
    this.identity = encodeNodeResourceIdentity("file", path);
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

  public async getSize(): Promise<number> {
    try {
      return (await fsPromises.stat(this.path)).size;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return 0;
      }
      throw error;
    }
  }

  public async getLastModified(): Promise<number | undefined> {
    try {
      return (await fsPromises.stat(this.path)).mtimeMs;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  }

  public async openWriter(): Promise<FileWriter> {
    await fsPromises.mkdir(pathModule.dirname(this.path), { recursive: true });
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
  public readonly identity: string;
  public readonly name: string;

  public constructor(public readonly path: string) {
    this.identity = encodeNodeResourceIdentity("directory", path);
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

  public async getLastModified(): Promise<number | undefined> {
    try {
      return (await fsPromises.stat(this.path)).mtimeMs;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
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
    await fsPromises.mkdir(this.path, { recursive: true });
    const file = new NodeFile(pathModule.join(this.path, name));
    await fsPromises.writeFile(file.path, "", { flag: "wx" });
    return file;
  }

  public async createDirectory(name: string): Promise<Directory> {
    assertChildName(name);
    await fsPromises.mkdir(this.path, { recursive: true });
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

function encodeNodeResourceIdentity(
  kind: "directory" | "file",
  path: string,
): string {
  return `node-${kind}:${Buffer.from(pathModule.resolve(path), "utf8").toString("base64url")}`;
}

function decodeNodeResourceIdentity(
  identity: string,
  kind: "directory" | "file",
): string | undefined {
  const prefix = `node-${kind}:`;
  if (!identity.startsWith(prefix)) {
    // State created before opaque resource identities stored native paths.
    return pathModule.isAbsolute(identity) ? identity : undefined;
  }
  try {
    return Buffer.from(identity.slice(prefix.length), "base64url").toString(
      "utf8",
    );
  } catch {
    return undefined;
  }
}

export function getNodeResourcePath(resource: File | Directory): string {
  if (resource instanceof NodeFile || resource instanceof NodeDirectory) {
    return resource.path;
  }
  if (
    typeof resource === "object" &&
    resource !== null &&
    "path" in resource &&
    typeof resource.path === "string"
  ) {
    return resource.path;
  }
  throw new TypeError("Expected a Node File or Directory resource");
}

function assertChildName(name: string): void {
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    pathModule.isAbsolute(name) ||
    name.includes("/") ||
    name.includes("\\")
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
    zipFile.addBuffer(Buffer.from(entry.data), entry.name, { compress: false });
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
  resources: {
    getDirectory: (identity) => {
      const path = decodeNodeResourceIdentity(identity, "directory");
      return Promise.resolve(
        path === undefined ? undefined : new NodeDirectory(path),
      );
    },
    getFile: (identity) => {
      const path = decodeNodeResourceIdentity(identity, "file");
      return Promise.resolve(
        path === undefined ? undefined : new NodeFile(path),
      );
    },
  },
  templates: {
    createEnvironment: (options) =>
      new Environment(new NodeTemplateLoader(), options),
  },
  zip: { read: readNodeZip, write: writeNodeZip },
};

class NodeTemplateLoader extends Loader {
  public getSource(templateName: string): LoaderSource {
    const name = normalizeTemplateName(templateName);
    const filePath = pathModule.join(resolveNodeDataDirectory(), name);
    return {
      noCache: false,
      path: name,
      src: fs.readFileSync(filePath, "utf8"),
    };
  }
}

function resolveNodeDataDirectory(): string {
  const injected = (globalThis as { __WIKIGRAPH_DATA_DIR__?: unknown })
    .__WIKIGRAPH_DATA_DIR__;
  if (typeof injected === "string" && injected !== "") return injected;
  let directory = nodeProcess.cwd();
  while (true) {
    for (const candidate of [
      pathModule.join(directory, "data"),
      pathModule.join(directory, "packages", "core", "data"),
    ]) {
      try {
        if (fs.statSync(candidate).isDirectory()) return candidate;
      } catch {
        // Keep looking toward the filesystem root.
      }
    }
    const parent = pathModule.dirname(directory);
    if (parent === directory)
      throw new Error("Could not locate data directory");
    directory = parent;
  }
}

export function createNodeWikiGraphStorage(
  stateRoot = pathModule.join(os.homedir(), ".wikigraph"),
): WikiGraphStorage {
  fs.mkdirSync(pathModule.join(stateRoot, "documents"), { recursive: true });
  return {
    library: new NodeDirectory(stateRoot),
    documentStore: new NodeDirectory(pathModule.join(stateRoot, "documents")),
  };
}

export function installNodeWikiGraphPlatform(stateRoot?: string): void {
  installWikiGraphPlatform(nodeWikiGraphPlatform);
  installWikiGraphStorage(createNodeWikiGraphStorage(stateRoot));
}

export async function withNodeWikiGraphStorage<T>(
  stateRoot: string | undefined,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await withWikiGraphStorage(
    stateRoot === undefined ? undefined : createNodeWikiGraphStorage(stateRoot),
    operation,
  );
}
