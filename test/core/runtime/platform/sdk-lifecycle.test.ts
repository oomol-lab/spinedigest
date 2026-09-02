import { execFile } from "child_process";
import { promisify } from "util";

import { describe, expect, it } from "vitest";

import { WikiGraph } from "../../../../packages/core/src/api/app.js";
import {
  getWikiGraphStorage,
  type Directory,
  type File,
  type WikiGraphStorage,
} from "../../../../packages/core/src/runtime/platform/index.js";

const execFileAsync = promisify(execFile);

describe("SDK host lifecycle", () => {
  it("binds async contexts when the host is installed after Core imports", async () => {
    const script = `
await import("./packages/core/src/index.ts");
const state = await import("./packages/core/src/runtime/common/wiki-graph/dir.ts");
const node = await import("./packages/cli/src/runtime/node-platform.ts");
node.installNodeWikiGraphPlatform();
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const observed = await Promise.all([
  state.withWikiGraphStateDirectoryPathForTesting("/context-a", async () => {
    await pause(20);
    return state.resolveWikiGraphHomeDirectoryPath();
  }),
  state.withWikiGraphStateDirectoryPathForTesting("/context-b", async () => {
    await pause(5);
    return state.resolveWikiGraphHomeDirectoryPath();
  }),
]);
console.log(JSON.stringify(observed));
`;

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { cwd: process.cwd() },
    );

    expect(JSON.parse(stdout.trim())).toEqual(["/context-a", "/context-b"]);
  });

  it("keeps per-instance storage out of process-default state", () => {
    const defaultStorage = getWikiGraphStorage();
    const first = createStorage("first");
    const second = createStorage("second");

    new WikiGraph({ storage: first });
    new WikiGraph({ storage: second });

    expect(getWikiGraphStorage()).toBe(defaultStorage);
  });
});

function createStorage(name: string): WikiGraphStorage {
  return {
    documentStore: new MemoryDirectory(`${name}-documents`),
    library: new MemoryDirectory(`${name}-library`),
  };
}

class MemoryDirectory implements Directory {
  public readonly identity: string;
  public readonly name: string;

  public constructor(name: string) {
    this.identity = `memory:${name}`;
    this.name = name;
  }

  public createDirectory(name: string): Promise<Directory> {
    return Promise.resolve(new MemoryDirectory(name));
  }

  public createFile(): Promise<File> {
    return Promise.reject(new Error("Not used by this lifecycle test"));
  }

  public getDirectory(): Promise<Directory | undefined> {
    return Promise.resolve(undefined);
  }

  public getFile(): Promise<File | undefined> {
    return Promise.resolve(undefined);
  }

  public list(): Promise<ReadonlyArray<File | Directory>> {
    return Promise.resolve([]);
  }

  public remove(): Promise<void> {
    return Promise.resolve();
  }
}
