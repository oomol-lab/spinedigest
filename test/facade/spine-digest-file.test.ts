import { access, readFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../src/document/index.js";
import { SpineDigest } from "../../src/facade/spine-digest.js";
import { SpineDigestFile } from "../../src/facade/spine-digest-file.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/spine-digest-file", () => {
  it("opens a saved archive in a temporary session and exposes digest operations", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedDocument(document);

        const archivePath = `${path}/fixture/book.sdpub`;
        await new SpineDigest(document, document.path).saveAs(archivePath);

        const digestFile = new SpineDigestFile(archivePath);
        const exportedText = await digestFile.openSession(async (digest) => {
          const textPath = `${path}/exports/from-session.txt`;

          expect(await digest.readMeta()).toMatchObject({
            title: "Session Fixture",
          });
          expect(await digest.readToc()).toMatchObject({
            items: [
              {
                title: "Recovered Chapter",
                serialId: 1,
              },
            ],
          });

          await digest.exportText(textPath);
          return await readFile(textPath, "utf8");
        });

        expect(exportedText).toBe("Recovered Chapter\n\nRecovered summary\n");
      } finally {
        await document.release();
      }
    });
  });

  it("keeps a custom extraction directory when one is provided", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedDocument(document);

        const archivePath = `${path}/fixture/book.sdpub`;
        const sessionDir = `${path}/opened-session`;

        await new SpineDigest(document, document.path).saveAs(archivePath);

        const digestFile = new SpineDigestFile(archivePath);
        await digestFile.openSession(
          async (digest) => {
            expect(await digest.readMeta()).toMatchObject({
              title: "Session Fixture",
            });
          },
          {
            documentDirPath: sessionDir,
          },
        );

        await expect(
          access(`${sessionDir}/book-meta.json`),
        ).resolves.toBeUndefined();
        expect(
          await readFile(`${sessionDir}/book-meta.json`, "utf8"),
        ).toContain("Session Fixture");
      } finally {
        await document.release();
      }
    });
  });

  it("emits archive-open and export progress events", async () => {
    await withTempDir("spinedigest-facade-file-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await seedDocument(document);

        const archivePath = `${path}/fixture/book.sdpub`;
        const events: Array<{
          readonly outputKind?: string;
          readonly type: string;
        }> = [];

        await new SpineDigest(document, document.path).saveAs(archivePath);

        const digestFile = new SpineDigestFile(archivePath);
        await digestFile.openSession(
          async (digest) => {
            await digest.exportText(`${path}/exports/progress.txt`);
          },
          {
            onProgress: async (event) => {
              events.push({
                type: event.type,
                ...(event.outputKind === undefined
                  ? {}
                  : { outputKind: event.outputKind }),
              });
            },
          },
        );

        expect(events).toStrictEqual([
          { type: "session-started" },
          { type: "archive-opened" },
          { outputKind: "text", type: "export-started" },
          { outputKind: "text", type: "export-completed" },
        ]);
      } finally {
        await document.release();
      }
    });
  });
});

async function seedDocument(document: DirectoryDocument): Promise<void> {
  await document.openSession(async (openedDocument) => {
    await openedDocument.createSerial();
    await openedDocument.writeBookMeta({
      authors: ["Ari Lantern"],
      description: null,
      identifier: "urn:test:spine-digest-file",
      language: "en",
      publishedAt: null,
      publisher: null,
      sourceFormat: "txt",
      title: "Session Fixture",
      version: 1,
    });
    await openedDocument.writeSummary(1, "Recovered summary");
    await openedDocument.writeToc({
      items: [
        {
          children: [],
          serialId: 1,
          title: "Recovered Chapter",
        },
      ],
      version: 1,
    });
  });
}
