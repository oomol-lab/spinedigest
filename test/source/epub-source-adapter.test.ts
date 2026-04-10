import { describe, expect, it } from "vitest";

import { EPUB_SOURCE_ADAPTER } from "../../src/source/index.js";
import {
  collectSectionTitles,
  getFixturePath,
  readStreamText,
} from "../helpers/fixtures.js";

describe("source/epub", () => {
  it("reads metadata and cover from the sample epub fixture", async () => {
    await EPUB_SOURCE_ADAPTER.openSession(
      getFixturePath("sample-observatory-guide.epub"),
      async (document) => {
        const meta = await document.readMeta();
        const cover = await document.readCover();

        expect(meta).toMatchObject({
          sourceFormat: "epub",
          title: "The Pocket Observatory Manual",
          authors: ["Ari Lantern"],
          language: "en",
          publisher: "Open Sample Press",
          identifier: "urn:spinedigest:sample-observatory-guide",
        });
        expect(cover).toMatchObject({
          mediaType: "image/png",
          path: "EPUB/images/cover.png",
        });
        expect(cover?.data.byteLength).toBeGreaterThan(32);
      },
    );
  });

  it("builds nested sections from nav anchors and spine fallbacks", async () => {
    await EPUB_SOURCE_ADAPTER.openSession(
      getFixturePath("sample-observatory-guide.epub"),
      async (document) => {
        const sections = await document.readSections();

        expect(sections).toHaveLength(2);
        expect(sections[0]?.title).toBe("Dawn Brief");
        expect(sections[0]?.children[0]?.title).toBe("Maintenance Checklist");
        expect(sections[1]?.title).toBe("chapter-2-log");
        expect(collectSectionTitles(sections)).not.toContain("Cover");
      },
    );
  });

  it("splits section text by anchor within the same xhtml file", async () => {
    await EPUB_SOURCE_ADAPTER.openSession(
      getFixturePath("sample-observatory-guide.epub"),
      async (document) => {
        const sections = await document.readSections();
        const dawnBrief = sections[0]!;
        const checklist = dawnBrief.children[0]!;
        const stormLedger = sections[1]!;

        const dawnText = await readStreamText(await dawnBrief.open());
        const checklistText = await readStreamText(await checklist.open());
        const stormLedgerText = await readStreamText(await stormLedger.open());

        expect(dawnText).toContain("Mira opened the shutters");
        expect(dawnText).not.toContain("Warm the lens ring");
        expect(checklistText).toContain(
          "Warm the lens ring for sixty seconds.",
        );
        expect(checklistText).toContain("最后一盏灯必须最后关闭");
        expect(stormLedgerText).toContain("west stair sounded hollow");
      },
    );
  });
});
