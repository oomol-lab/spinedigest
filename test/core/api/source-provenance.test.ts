import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../../packages/core/src/document/index.js";
import {
  addChapter,
  setChapterSource,
} from "../../../packages/core/src/api/chapter/index.js";
import { parseSourceTextJsonl } from "../../../packages/core/src/text/source/index.js";
import { withTempDir } from "../../helpers/temp.js";

describe("source provenance workflow", () => {
  it("imports a real EPUB fixture through JSONL and persists its map", async () => {
    await withTempDir("wikigraph-source-provenance-e2e-", async (path) => {
      const epubPath = resolve(
        "test/fixtures/sources/sample-observatory-guide.epub",
      );
      const epub = await readFile(epubPath);
      const digest = createHash("sha256").update(epub).digest("hex");
      const sourceText = "A real EPUB-backed source text.";
      const jsonl = [
        JSON.stringify({
          type: "artifact",
          digest,
          mediaType: "application/epub+zip",
          name: "sample-observatory-guide.epub",
          identifier: "fixture:sample-observatory-guide",
        }),
        JSON.stringify({
          type: "text",
          text: sourceText,
          locator: { cfi: "epubcfi(/6/2[body]!/4/2/1:0)" },
        }),
      ].join("\n");
      const parsed = parseSourceTextJsonl(jsonl);
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (opened) => {
          await opened.writeToc({ items: [], version: 1 });
        });
        const chapter = await addChapter(document, { title: "Fixture" });
        await setChapterSource(document, chapter.chapterId, [parsed.text], {
          provenance: parsed.provenance,
        });

        expect(
          await document.getSerialFragments(chapter.chapterId).readText(),
        ).toBe(sourceText);
        expect(
          await document.sourceProvenance.listMap(chapter.chapterId),
        ).toMatchObject([
          {
            artifact: {
              digest,
              identifier: "fixture:sample-observatory-guide",
              mediaType: "application/epub+zip",
            },
            locator: { cfi: "epubcfi(/6/2[body]!/4/2/1:0)" },
            sourceStart: 0,
            sourceEnd: sourceText.length,
          },
        ]);
      } finally {
        await document.release();
      }
    });
  });
});
