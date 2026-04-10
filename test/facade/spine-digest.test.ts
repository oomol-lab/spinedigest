import { mkdir, readFile, writeFile } from "fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  DirectoryDocument,
  type ReadonlyDocument,
} from "../../src/document/index.js";
import { extractSdpubArchive } from "../../src/facade/archive.js";
import { SpineDigest } from "../../src/facade/spine-digest.js";
import { EPUB_SOURCE_ADAPTER } from "../../src/source/index.js";
import { collectSectionTitles, readStreamText } from "../helpers/fixtures.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/spine-digest", () => {
  it("reads document data and exports plain text plus epub", async () => {
    await withTempDir("spinedigest-facade-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedDocument(document);

        const digest = new SpineDigest(document, document.path);
        const textPath = `${path}/exports/book.txt`;
        const epubPath = `${path}/exports/book.epub`;

        expect(await digest.readMeta()).toMatchObject({
          identifier: "urn:test:facade",
          sourceFormat: "txt",
          title: "Facade Fixture",
        });
        expect(await digest.readCover()).toMatchObject({
          mediaType: "image/png",
          path: "images/cover.png",
        });
        expect(await digest.readToc()).toMatchObject({
          items: [
            {
              title: "Chapter 1",
              serialId: 1,
            },
          ],
        });

        await digest.exportText(textPath);
        expect(await readFile(textPath, "utf8")).toBe(
          "Chapter 1\n\nSummary one\n\nAppendix\n\nSummary two\n",
        );

        await digest.exportEpub(epubPath);
        await EPUB_SOURCE_ADAPTER.openSession(
          epubPath,
          async (sourceDocument) => {
            const sections = await sourceDocument.readSections();
            const cover = await sourceDocument.readCover();

            expect(await sourceDocument.readMeta()).toMatchObject({
              identifier: "urn:test:facade",
              title: "Facade Fixture",
            });
            expect(collectSectionTitles(sections)).toStrictEqual([
              "Chapter 1",
              "Appendix",
            ]);
            expect(await readStreamText(await sections[0]!.open())).toContain(
              "Summary one",
            );
            expect(
              await readStreamText(await sections[0]!.children[0]!.open()),
            ).toContain("Summary two");
            expect(cover).toMatchObject({
              mediaType: "image/png",
            });
            expect(cover?.data.byteLength).toBeGreaterThan(0);
          },
        );
      } finally {
        await document.release();
      }
    });
  });

  it("flushes flushable documents before saving an sdpub archive", async () => {
    await withTempDir("spinedigest-facade-", async (path) => {
      const sourceDir = `${path}/document`;
      const archivePath = `${path}/saved/book.sdpub`;
      const flush = vi.fn(async () => {});

      await mkdir(sourceDir, { recursive: true });
      await writeFile(`${sourceDir}/note.txt`, "saved", "utf8");

      const digest = new SpineDigest(
        {
          flush,
        } as unknown as ReadonlyDocument & { flush(): Promise<void> },
        sourceDir,
      );

      await digest.saveAs(archivePath);

      expect(flush).toHaveBeenCalledTimes(1);

      const extractDir = `${path}/extract`;
      await extractSdpubArchive(archivePath, extractDir);
      expect(await readFile(`${extractDir}/note.txt`, "utf8")).toBe("saved");
    });
  });
});

async function seedDocument(document: DirectoryDocument): Promise<void> {
  await document.openSession(async (openedDocument) => {
    await openedDocument.createSerial();
    await openedDocument.createSerial();
    await openedDocument.writeBookMeta({
      authors: ["Ari Lantern"],
      description: "Facade fixture",
      identifier: "urn:test:facade",
      language: "en",
      publishedAt: "2026-01-01",
      publisher: "Open Sample Press",
      sourceFormat: "txt",
      title: "Facade Fixture",
      version: 1,
    });
    await openedDocument.writeCover({
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]),
      mediaType: "image/png",
      path: "images/cover.png",
    });
    await openedDocument.writeSummary(1, "Summary one");
    await openedDocument.writeSummary(2, "Summary two");
    await openedDocument.writeToc({
      items: [
        {
          children: [
            {
              children: [],
              serialId: 2,
              title: "Appendix",
            },
          ],
          serialId: 1,
          title: "Chapter 1",
        },
      ],
      version: 1,
    });
  });
}
