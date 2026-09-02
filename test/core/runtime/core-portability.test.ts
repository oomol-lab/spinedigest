import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("core portability gate", () => {
  it("rejects CommonJS and global Node references", async () => {
    const fixture = await mkdtemp(
      join(tmpdir(), "wiki-graph-core-portability-"),
    );
    try {
      await writeFile(
        join(fixture, "forbidden.ts"),
        'const fs = require("fs");\nconsole.log(process.pid, Buffer.from("x"));\nlet x: NodeJS.Process;\n',
      );

      await expect(
        execFileAsync("node", ["scripts/check-core-portability.mjs", fixture], {
          cwd: process.cwd(),
        }),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects bare and global Node references", async () => {
    const fixture = await mkdtemp(
      join(tmpdir(), "wiki-graph-core-portability-"),
    );
    try {
      await writeFile(
        join(fixture, "forbidden.ts"),
        "const a = process; const b = globalThis.process; const c = new Buffer(1);\n",
      );

      await expect(
        execFileAsync("node", ["scripts/check-core-portability.mjs", fixture], {
          cwd: process.cwd(),
        }),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects computed dynamic imports and transitive package imports", async () => {
    const fixture = await mkdtemp(
      join(tmpdir(), "wiki-graph-core-portability-"),
    );
    try {
      await writeFile(
        join(fixture, "computed.ts"),
        'const prefix = "node:"; export const load = () => import(prefix + "fs");\n',
      );
      await expect(
        execFileAsync("node", ["scripts/check-core-portability.mjs", fixture], {
          cwd: process.cwd(),
        }),
      ).rejects.toMatchObject({ code: 1 });

      await writeFile(
        join(fixture, "package.json"),
        JSON.stringify({ dependencies: { "fixture-node-dependency": "1.0.0" } }),
      );
      await execFileAsync("mkdir", ["-p", join(fixture, "node_modules/fixture-node-dependency")]);
      await writeFile(
        join(fixture, "node_modules/fixture-node-dependency/package.json"),
        JSON.stringify({ name: "fixture-node-dependency", main: "index.js" }),
      );
      await writeFile(
        join(fixture, "node_modules/fixture-node-dependency/index.js"),
        'export * from "./nested.js";\n',
      );
      await writeFile(
        join(fixture, "node_modules/fixture-node-dependency/nested.js"),
        'import "node:fs";\n',
      );
      await expect(
        execFileAsync("node", ["scripts/check-core-portability.mjs", fixture], {
          cwd: process.cwd(),
        }),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
