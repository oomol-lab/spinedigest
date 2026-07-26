import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  withWikiGraphCLIRuntimeContext,
  type WikiGraphCLIRuntimeContext,
} from "./context.js";
import { createInternalChildCommandForTesting } from "./internal-child.js";

describe("runtime/internal-child", () => {
  it("uses source worker entries from the development runtime context", async () => {
    await withRuntimeContext(
      {
        devProjectRoot: "/repo",
        stateDir: join("/repo", ".wikigraph", "state"),
      },
      () => {
        expect(
          createInternalChildCommandForTesting("queue-worker", ["--flag"]),
        ).toStrictEqual({
          args: [
            join("/repo", "node_modules", "tsx", "dist", "cli.mjs"),
            join("/repo", "packages", "cli", "src", "bin", "queue-worker.ts"),
            "--wikigraph-internal-child",
            "queue-worker",
            "--wikigraph-state-dir",
            join("/repo", ".wikigraph", "state"),
            "--flag",
          ],
          command: process.execPath,
        });
        expect(createInternalChildCommandForTesting("gc-worker").args[1]).toBe(
          join("/repo", "packages", "cli", "src", "bin", "gc-worker.ts"),
        );
      },
    );
  });

  it("uses production worker entries when no development project root is set", async () => {
    await withRuntimeContext({}, () => {
      const queueCommand = createInternalChildCommandForTesting("queue-worker");
      expect(queueCommand.args[0]).toBe(
        join(process.cwd(), "packages", "cli", "dist", "queue-worker.js"),
      );
      expect(queueCommand.args.slice(1)).toStrictEqual([
        "--wikigraph-internal-child",
        "queue-worker",
      ]);
      expect(createInternalChildCommandForTesting("gc-worker").args[0]).toBe(
        join(process.cwd(), "packages", "cli", "dist", "gc-worker.js"),
      );
    });
  });
});

async function withRuntimeContext(
  overrides: Partial<WikiGraphCLIRuntimeContext>,
  operation: () => void,
): Promise<void> {
  await withWikiGraphCLIRuntimeContext(
    {
      argv: [],
      cwd: process.cwd(),
      env: process.env,
      envPolicy: "production",
      exitCode: 0,
      queueAutostart: true,
      stderr: process.stderr,
      stdin: process.stdin,
      stdout: process.stdout,
      ...overrides,
    },
    operation,
  );
}
