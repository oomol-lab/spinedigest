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
});
