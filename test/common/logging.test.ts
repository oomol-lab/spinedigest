import { readFile, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import {
  resolveArtifactPath,
  withLoggingContext,
} from "../../src/common/logging.js";
import { withTempDir } from "../helpers/temp.js";

describe("common/logging", () => {
  it("preserves flat artifact paths without an active logging context", async () => {
    await withTempDir("spinedigest-logging-", (path) => {
      const artifactPath = resolveArtifactPath({
        category: "llm",
        fileName: "request.log",
        logDirPath: path,
      });

      expect(artifactPath).toBe(`${path}/request.log`);
      return Promise.resolve();
    });
  });

  it("writes contextual artifacts under the run directory", async () => {
    await withTempDir("spinedigest-logging-", async (path) => {
      const artifactPath = await withLoggingContext(
        {
          logDirPath: path,
          operation: "digest-test",
          verbose: false,
        },
        async () => {
          const resolvedPath = resolveArtifactPath({
            category: "llm",
            fileName: "request.log",
            logDirPath: path,
          });

          expect(resolvedPath).toBeDefined();
          await writeFile(resolvedPath!, "request log", "utf8");
          return resolvedPath!;
        },
      );

      expect(artifactPath).toContain("/runs/");
      expect(artifactPath).toContain("/artifacts/llm/request.log");
      const content = await readFile(artifactPath, "utf8");

      expect(content).toBe("request log");
    });
  });
});
