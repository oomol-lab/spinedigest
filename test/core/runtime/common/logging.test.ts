import { readFile, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import {
  allocateArtifactFile,
  getLogger,
  resolveArtifactFile,
  withLoggingContext,
} from "../../../../packages/core/src/runtime/common/logging.js";
import { withTempDir } from "../../../helpers/temp.js";
import {
  getNodeResourcePath,
  NodeDirectory,
} from "../../../../packages/cli/src/runtime/node-platform.js";

describe("common/logging", () => {
  it("preserves flat artifact paths without an active logging context", async () => {
    await withTempDir("wikigraph-logging-", async (path) => {
      const directory = new NodeDirectory(path);
      const artifact = await resolveArtifactFile({
        category: "llm",
        fileName: "request.log",
        logDirectory: directory,
      });
      expect(getNodeResourcePath(artifact!)).toBe(`${path}/llm/request.log`);
    });
  });

  it("writes contextual artifacts under the run directory", async () => {
    await withTempDir("wikigraph-logging-", async (path) => {
      const directory = new NodeDirectory(path);
      const { artifactPath, runDirPath } = await withLoggingContext(
        {
          logDirectory: directory,
          operation: "digest-test",
          verbose: false,
        },
        async () => {
          getLogger({ component: "test" }).info("hello event log");
          const resolved = await resolveArtifactFile({
            category: "llm",
            fileName: "request.log",
            logDirectory: directory,
          });
          expect(resolved).toBeDefined();
          const resolvedPath = getNodeResourcePath(resolved!);
          await writeFile(resolvedPath, "request log", "utf8");
          return {
            artifactPath: resolvedPath,
            runDirPath: resolvedPath.split("/artifacts/")[0]!,
          };
        },
      );

      expect(artifactPath.startsWith(`${path}/`)).toBe(true);
      expect(artifactPath).toContain("/artifacts/llm/request.log");
      expect(artifactPath).not.toContain("/runs/");
      const content = await readFile(artifactPath, "utf8");
      const eventLog = await readFile(`${runDirPath}/run.log`, "utf8");

      expect(content).toBe("request log");
      expect(eventLog).toContain("INFO");
      expect(eventLog).toContain("hello event log");
      expect(eventLog).not.toContain('{"level":');
      expect(eventLog).not.toContain('{"operation":');
      expect(eventLog).not.toContain("[digest-test");
    });
  });

  it("allocates stable artifact names with numeric suffixes when needed", async () => {
    await withTempDir("wikigraph-logging-", async (path) => {
      const directory = new NodeDirectory(path);
      const first = await allocateArtifactFile({
        category: "llm",
        logDirectory: directory,
        prefix: "request",
      });
      const second = await allocateArtifactFile({
        category: "llm",
        logDirectory: directory,
        prefix: "request",
      });

      expect(first?.name).toBe("request.log");
      expect(second?.name).toBe("request-2.log");
    });
  });

  it("can allocate numbered artifact names starting at one", async () => {
    await withTempDir("wikigraph-logging-", async (path) => {
      const directory = new NodeDirectory(path);
      const first = await allocateArtifactFile({
        alwaysNumbered: true,
        category: "llm",
        logDirectory: directory,
        prefix: "request",
      });
      const second = await allocateArtifactFile({
        alwaysNumbered: true,
        category: "llm",
        logDirectory: directory,
        prefix: "request",
      });

      expect(first?.name).toBe("request-1.log");
      expect(second?.name).toBe("request-2.log");
    });
  });
});
