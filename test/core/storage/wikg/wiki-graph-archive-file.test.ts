import { mkdir } from "fs/promises";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../../../packages/core/src/document/index.js";
import { WikiGraphArchiveFile } from "../../../../packages/core/src/storage/wikg/wiki-graph-archive-file.js";
import { writeWikgArchive } from "../../../../packages/core/src/storage/wikg/archive/index.js";
import { withWikiGraphStorage } from "../../../../packages/core/src/runtime/platform/index.js";
import {
  createNodeWikiGraphStorage,
  NodeDirectory,
  NodeFile,
} from "../../../../packages/cli/src/runtime/node-platform.js";
import { withTempDir } from "../../../helpers/temp.js";

describe("wikg/wiki-graph-archive-file", () => {
  it("reads and writes an archive through opaque File capabilities", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const file = new WikiGraphArchiveFile(archive);
      await expect(
        file.read(async (digest) => await digest.readToc()),
      ).resolves.toMatchObject({
        items: [{ serialId: 1, title: "Original" }],
      });

      await file.write(async (document) => {
        await document.replaceToc({
          items: [
            { children: [], key: "chapter", serialId: 1, title: "Updated" },
          ],
          version: 1,
        });
      });

      await expect(
        file.read(async (digest) => await digest.readToc()),
      ).resolves.toMatchObject({
        items: [{ serialId: 1, title: "Updated" }],
      });
    });
  });

  it("rolls back archive writes when the operation fails", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const file = new WikiGraphArchiveFile(archive);
      await expect(
        file.write(async (document) => {
          await document.replaceToc({ items: [], version: 1 });
          throw new Error("stop");
        }),
      ).rejects.toThrow("stop");
      await expect(
        file.read(async (digest) => await digest.readToc()),
      ).resolves.toMatchObject({
        items: [{ title: "Original" }],
      });
    });
  });

  it("serializes concurrent access by opaque file identity", async () => {
    await withArchiveFixture(async ({ archive }) => {
      const file = new WikiGraphArchiveFile(archive);
      const order: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = file.write(async () => {
        order.push("first-start");
        await gate;
        order.push("first-end");
      });
      const second = file.read(() => {
        order.push("second");
      });
      await Promise.resolve();
      release();
      await Promise.all([first, second]);
      expect(order).toStrictEqual(["first-start", "first-end", "second"]);
    });
  });
});

async function withArchiveFixture(
  operation: (fixture: { readonly archive: NodeFile }) => Promise<void>,
): Promise<void> {
  await withTempDir("wikigraph-host-archive-", async (root) => {
    const stateRoot = join(root, "state");
    const documentPath = join(root, "document");
    await mkdir(documentPath, { recursive: true });
    await withWikiGraphStorage(
      createNodeWikiGraphStorage(stateRoot),
      async () => {
        const directory = new NodeDirectory(documentPath);
        const document = await DirectoryDocument.open(directory);
        try {
          await document.writeToc({
            items: [
              { children: [], key: "chapter", serialId: 1, title: "Original" },
            ],
            version: 1,
          });
        } finally {
          await document.release();
        }
        const archive = new NodeFile(join(root, "book.wikg"));
        await writeWikgArchive(directory, archive);
        await operation({ archive });
      },
    );
  });
}
