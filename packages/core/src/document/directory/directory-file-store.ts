import type { Directory, File } from "../../runtime/platform/index.js";
import { getRelativeFile } from "../../runtime/platform/index.js";
import type { DocumentFileStore } from "./types.js";

/** Document file store backed exclusively by a host Directory tree. */
export class DirectoryFileStore implements DocumentFileStore {
  public constructor(private readonly root: Directory) {}

  public close(): Promise<void> { return Promise.resolve(); }
  public initializeDatabaseSchema(): boolean { return true; }
  public openDatabaseReadonly(): boolean { return false; }
  public markDatabaseDirty(): void { /* host transaction owns durability */ }
  public markSearchIndexDatabaseDirty(): void { /* host transaction owns durability */ }

  public async resolveDatabasePath(): Promise<File> {
    return await this.getOrCreateFile("database.db");
  }
  public async resolveSearchIndexDatabasePath(): Promise<File> {
    return await this.getOrCreateFile("index.db");
  }
  public async readFile(path: string): Promise<Uint8Array | undefined> {
    const file = await getRelativeFile(this.root, this.relative(path));
    if (!file) return undefined;
    const content = await file.read();
    return typeof content === "string" ? new TextEncoder().encode(content) : content;
  }
  public async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const file = await this.getOrCreateFile(this.relative(path));
    const writer = await file.openWriter();
    try { await writer.write(content); await writer.commit(); }
    catch (error) { await writer.abort(); throw error; }
  }
  public async deleteFile(path: string): Promise<void> {
    await this.removePath(this.relative(path), false);
  }
  public async deleteTree(path: string): Promise<void> {
    await this.removePath(this.relative(path), true);
  }
  public async ensureDirectory(path: string): Promise<void> {
    await this.getOrCreateDirectory(this.relative(path));
  }
  public async listFiles(path: string): Promise<readonly string[]> {
    const directory = await this.getOrCreateDirectory(this.relative(path));
    return (await directory.list()).filter((entry): entry is File => "read" in entry).map((entry) => entry.name);
  }

  private relative(path: string): string {
    const relative = path.replaceAll("\\", "/").replace(/^\.\//u, "");
    if (relative.startsWith("/") || relative.split("/").includes("..")) {
      throw new TypeError(`Document path must remain relative: ${path}`);
    }
    return relative;
  }
  private async getOrCreateDirectory(path: string): Promise<Directory> {
    let current = this.root;
    for (const part of path.split("/").filter(Boolean)) {
      current = await current.getDirectory(part) ?? await current.createDirectory(part);
    }
    return current;
  }
  private async getOrCreateFile(path: string): Promise<File> {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) throw new TypeError("File name must be relative");
    return await (await this.getOrCreateDirectory(parts.join("/"))).getFile(name)
      ?? await (await this.getOrCreateDirectory(parts.join("/"))).createFile(name);
  }
  private async removePath(path: string, recursive: boolean): Promise<void> {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) return;
    const parent = await this.getOrCreateDirectory(parts.join("/"));
    await parent.remove(name, { recursive });
  }
}
