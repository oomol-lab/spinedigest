import { describe, expect, it } from "vitest";

import { NodeDirectory } from "../../../../packages/cli/src/runtime/node-platform.js";
import { withTempDir } from "../../../helpers/temp.js";

describe("Node File/Directory adapter", () => {
  it("performs relative child operations and transactional file writes", async () => {
    await withTempDir("wikigraph-platform-", async (path) => {
      const root = new NodeDirectory(path);
      const directory = await root.createDirectory("documents");
      const file = await directory.createFile("chapter.txt");
      const writer = await file.openWriter();

      await writer.write("chapter ");
      await writer.write("one");
      await writer.commit();

      const stored = await directory.getFile("chapter.txt");
      expect(stored).toBeDefined();
      await expect(stored!.read({ encoding: "utf8" })).resolves.toBe(
        "chapter one",
      );
    });
  });

  it("rejects absolute and parent-directory child names", async () => {
    await withTempDir("wikigraph-platform-", async (path) => {
      const root = new NodeDirectory(path);
      await expect(root.getFile("../outside.txt")).rejects.toThrow(
        "relative name",
      );
      await expect(root.createDirectory("/tmp")).rejects.toThrow(
        "relative name",
      );
    });
  });
});
