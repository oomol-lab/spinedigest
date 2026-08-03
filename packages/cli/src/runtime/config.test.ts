import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { withWikiGraphStateDirectoryPathForTesting } from "../../../core/src/runtime/common/wiki-graph/dir.js";
import { putLocalConfigValue } from "./local-config.js";
import { loadCLIConfig } from "./config.js";

describe("runtime/config", () => {
  it("loads embedding config from local state", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "wikigraph-config-test-"));

    try {
      await withWikiGraphStateDirectoryPathForTesting(tempDir, async () => {
        await putLocalConfigValue(
          "embeddings",
          "provider",
          "openai-compatible",
        );
        await putLocalConfigValue("embeddings", "model", "embedding-model");
        await putLocalConfigValue(
          "embeddings",
          "baseURL",
          "https://api.example.com/v1",
        );
        await putLocalConfigValue("embeddings", "dimensions", 1536);

        await expect(loadCLIConfig()).resolves.toMatchObject({
          embedding: {
            baseURL: "https://api.example.com/v1",
            dimensions: 1536,
            model: "embedding-model",
            provider: "openai-compatible",
          },
        });
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
