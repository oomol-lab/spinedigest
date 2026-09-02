import { describe, expect, it } from "vitest";

import {
  NodeDirectory,
  nodeWikiGraphPlatform,
} from "../../../../packages/cli/src/runtime/node-platform.js";
import { DirectoryFileStore } from "../../../../packages/core/src/document/directory/directory-file-store.js";
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
      expect(stored!.name).toBe("chapter.txt");
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

  it("uses a Directory root for document-relative files", async () => {
    await withTempDir("wikigraph-directory-store-", async (path) => {
      const store = new DirectoryFileStore(new NodeDirectory(path));
      await store.writeFile("texts/source/1", "hello", { overwrite: true });
      const value = await store.readFile("texts/source/1");
      expect(Array.from(value ?? [])).toEqual([104, 101, 108, 108, 111]);
      await expect(store.writeFile("texts/source/1", "again")).rejects.toThrow(
        "already exists",
      );
      await store.writeFile("texts/source/1", "again", { overwrite: true });
    });
  });

  it("provides database and ZIP services over opaque File values", async () => {
    await withTempDir("wikigraph-host-services-", async (path) => {
      const root = new NodeDirectory(path);
      const databaseFile = await root.createFile("host.sqlite");
      const database = await nodeWikiGraphPlatform.database.open(databaseFile);
      try {
        await database.execute("CREATE TABLE records (value TEXT NOT NULL)");
        await database.run("INSERT INTO records (value) VALUES (?)", ["ok"]);
        await expect(
          database.queryOne("SELECT value FROM records"),
        ).resolves.toMatchObject({ value: "ok" });
      } finally {
        await database.close();
      }

      const zipFile = await root.createFile("host.zip");
      await nodeWikiGraphPlatform.zip.write(zipFile, [
        { data: new TextEncoder().encode("alpha"), name: "a.txt" },
        { data: new TextEncoder().encode("beta"), name: "nested/b.txt" },
      ]);
      const entries = await nodeWikiGraphPlatform.zip.read(zipFile);

      expect(
        entries.map((entry) => [
          entry.name,
          new TextDecoder().decode(entry.data),
        ]),
      ).toEqual([
        ["a.txt", "alpha"],
        ["nested/b.txt", "beta"],
      ]);
    });
  });

  it("restores persisted opaque capabilities without exposing a path to Core", async () => {
    await withTempDir("wikigraph-host-resources-", async (path) => {
      const directory = new NodeDirectory(path);
      const file = await directory.createFile("archive.wikg");

      const restoredDirectory =
        await nodeWikiGraphPlatform.resources.getDirectory(directory.identity);
      const restoredFile = await nodeWikiGraphPlatform.resources.getFile(
        file.identity,
      );

      expect(restoredDirectory?.identity).toBe(directory.identity);
      expect(restoredFile?.identity).toBe(file.identity);
      expect(restoredDirectory).not.toHaveProperty("absolutePath");
      expect(restoredFile).not.toHaveProperty("absolutePath");
    });
  });
});
