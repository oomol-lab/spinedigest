import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("core portability gate", () => {
  it("rejects a static Node import in isolation", async () => {
    await expectRejected({ "forbidden.ts": 'import "node:fs";\n' });
  });

  it("rejects a dynamic Node import in isolation", async () => {
    await expectRejected({
      "forbidden.ts": 'export const load = () => import("node:fs");\n',
    });
  });

  it("rejects a computed dynamic import in isolation", async () => {
    await expectRejected({
      "forbidden.ts":
        'const prefix = "node:"; export const load = () => import(prefix + "fs");\n',
    });
  });

  it.each([
    ["direct", 'export const fs = require("fs");\n'],
    ["aliased", 'const load = require; export const fs = load("fs");\n'],
    [
      "property",
      'const loader = { require }; export const fs = loader.require("fs");\n',
    ],
  ])("rejects %s CommonJS require in isolation", async (_name, source) => {
    await expectRejected({ "forbidden.ts": source });
  });

  it.each([
    ["process", "export const runtime = process;\n"],
    ["globalThis.process", "export const runtime = globalThis.process;\n"],
    [
      "aliased globalThis.process",
      "const host = globalThis; export const runtime = host.process;\n",
    ],
    ["Buffer", "export const bytes = new Buffer(1);\n"],
    ["NodeJS type", "export type Runtime = NodeJS.Process;\n"],
    ["__dirname", "export const directory = __dirname;\n"],
    ["__filename", "export const filename = __filename;\n"],
  ])("rejects the Node-only global %s in isolation", async (_name, source) => {
    await expectRejected({ "forbidden.ts": source });
  });

  it.each(["sqlite3", "yauzl", "yazl"])(
    "rejects the Node-only dependency %s from package.json in isolation",
    async (dependency) => {
      await expectRejected({
        "package.json": JSON.stringify({
          dependencies: { [dependency]: "1.0.0" },
        }),
      });
    },
  );

  it("does not exempt platform implementation folders", async () => {
    await expectRejected({
      "runtime/platform/escape.ts":
        'export const load = () => capability("readFile");\n',
    });
  });

  it("rejects a Node-only declaration in built artifacts", async () => {
    await expectRejected(
      { "leak.d.ts": "export type Runtime = NodeJS.Process;\n" },
      true,
    );
  });

  it("rejects a static Node import reached through a dependency", async () => {
    await withFixture(async (fixture) => {
      await writeFixture(fixture, {
        "entry.ts": 'import "fixture-dependency";\n',
        "package.json": JSON.stringify({
          dependencies: { "fixture-dependency": "1.0.0" },
        }),
        "node_modules/fixture-dependency/package.json": JSON.stringify({
          exports: "./index.js",
          name: "fixture-dependency",
          version: "1.0.0",
        }),
        "node_modules/fixture-dependency/index.js": 'import "node:fs";\n',
      });
      await expectGateFailure(fixture, false);
    });
  });
});

async function expectRejected(
  files: Readonly<Record<string, string>>,
  artifact = false,
): Promise<void> {
  await withFixture(async (fixture) => {
    await writeFixture(fixture, files);
    await expectGateFailure(fixture, artifact);
  });
}

async function expectGateFailure(
  fixture: string,
  artifact: boolean,
): Promise<void> {
  await expect(
    execFileAsync(
      "node",
      [
        "scripts/check-core-portability.mjs",
        fixture,
        ...(artifact ? ["--artifact"] : []),
      ],
      { cwd: process.cwd() },
    ),
  ).rejects.toMatchObject({ code: 1 });
}

async function withFixture(
  operation: (fixture: string) => Promise<void>,
): Promise<void> {
  const fixture = await mkdtemp(join(tmpdir(), "wiki-graph-portability-"));
  try {
    await operation(fixture);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

async function writeFixture(
  fixture: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(fixture, relativePath);
    const directory = path.slice(0, path.lastIndexOf("/"));
    await mkdir(directory, { recursive: true });
    await writeFile(path, content);
  }
}
