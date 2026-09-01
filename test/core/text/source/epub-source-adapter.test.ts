import { Readable } from "stream";
import { createHash } from "crypto";
import { readFile } from "fs/promises";

import { describe, expect, it } from "vitest";
import { parseDocument } from "../../../../packages/core/node_modules/htmlparser2/dist/index.js";

import {
  analyzeSectionTargets,
  EpubContentLoader,
} from "../../../../packages/core/src/text/source/epub/content.js";
import { EpubArchive } from "../../../../packages/core/src/text/source/epub/archive.js";
import { EPUB_SOURCE_ADAPTER } from "../../../../packages/core/src/text/source/index.js";
import {
  collectSectionTitles,
  getFixturePath,
  readStreamText,
} from "../../../helpers/fixtures.js";
import { parseSourceTextJsonl } from "../../../../packages/core/src/text/source/provenance.js";

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
          identifier: "urn:wiki-graph:sample-observatory-guide",
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

  it("returns source text provenance for imported EPUB sections", async () => {
    const epubPath = getFixturePath("Cambridge.epub");
    const digest = createHash("sha256")
      .update(await readFile(epubPath))
      .digest("hex");
    const archive = await EpubArchive.open(epubPath);
    const xhtml = await archive.readText("OEBPS/Text/chapter_05.xhtml");
    await archive.close();

    await EPUB_SOURCE_ADAPTER.openSession(epubPath, async (document) => {
      const section = (await document.readSections())[0]!;
      const content = await section.openWithProvenance!();
      const text = await readStreamText(content.stream);
      const mappings = content.provenance?.mappings ?? [];

      expect(text).toContain("Joan Robinson’s first complaint");
      expect(content.provenance?.artifacts).toMatchObject([
        {
          digest,
          mediaType: "application/epub+zip",
          name: "Cambridge.epub",
        },
      ]);
      expect(mappings.length).toBeGreaterThan(0);
      expect(mappings[0]?.sourceStart).toBe(0);
      expect(mappings.at(-1)?.sourceEnd).toBe(Array.from(text).length);
      expect(
        mappings.every((mapping) => mapping.sourceEnd > mapping.sourceStart),
      ).toBe(true);
      expect(
        mappings.every(
          (mapping, index) =>
            index === 0 ||
            mapping.sourceStart === mappings[index - 1]!.sourceEnd,
        ),
      ).toBe(true);
      expect(
        mappings.every((mapping) => typeof mapping.locator.cfi === "string"),
      ).toBe(true);
      expect(
        resolveCfiText(xhtml, mappings[0]!.locator.cfi as string),
      ).toContain("Joan Robinson");
      expect(() =>
        parseSourceTextJsonl(
          [
            JSON.stringify({
              type: "artifact",
              digest,
              mediaType: "application/epub+zip",
            }),
            JSON.stringify({
              type: "text",
              text: "x",
              locator: mappings[0]?.locator,
            }),
          ].join("\n"),
        ),
      ).not.toThrow();
    });
  });

  it("resolves CFI paths from an XHTML root and counts UTF-16 offsets", async () => {
    const loader = new EpubContentLoader(
      {
        readText: () =>
          Promise.resolve(
            [
              '<?xml version="1.0"?>',
              "<!DOCTYPE html>",
              '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>',
              '<section id="first">\n<p>A😀B</p>\n</section>',
              '<section id="second"><p>Second</p></section>',
              "</body></html>",
            ].join(""),
          ),
        openReadStream: () => Promise.reject(new Error("unused")),
      } as never,
      new Map([
        [
          "chapter.xhtml",
          [
            {
              fragment: "first",
              id: "first",
              path: "chapter.xhtml",
              spineIndex: 0,
            },
            {
              fragment: "second",
              id: "second",
              path: "chapter.xhtml",
              spineIndex: 0,
            },
          ],
        ],
      ]),
    );
    const artifact = {
      digest: "a".repeat(64),
      mediaType: "application/epub+zip",
    };

    const first = await loader.openSectionWithProvenance("first", artifact);
    const second = await loader.openSectionWithProvenance("second", artifact);
    const firstText = await readStreamText(first.stream);
    const secondText = await readStreamText(second.stream);
    const firstCfi = first.provenance?.mappings[0]?.locator.cfi;
    const secondCfi = second.provenance?.mappings[0]?.locator.cfi;

    expect(firstText).toBe("A😀B");
    expect(secondText).toBe("Second");
    expect(firstCfi).toContain("/4/2[first]/2/1:0");
    expect(firstCfi).toContain("/4/2[first]/2/1:4)");
    expect(secondCfi).toContain("/4/4[second]/2/1:0");
  });

  it("reopens the underlying xhtml entry for repeated section reads", async () => {
    let openReadStreamCount = 0;
    const loader = new EpubContentLoader(
      {
        openReadStream: () => {
          openReadStreamCount += 1;
          return Promise.resolve(
            Readable.from(["<html><body><p>Alpha beta.</p></body></html>"]),
          );
        },
      } as never,
      new Map([
        [
          "chapter.xhtml",
          [
            {
              fragment: undefined,
              id: "chapter.xhtml",
              path: "chapter.xhtml",
            },
          ],
        ],
      ]),
    );

    expect(
      await readStreamText(await loader.openSection("chapter.xhtml")),
    ).toBe("Alpha beta.");
    expect(
      await readStreamText(await loader.openSection("chapter.xhtml")),
    ).toBe("Alpha beta.");
    expect(openReadStreamCount).toBe(2);
  });

  it("marks empty section targets as structure-only during analysis", async () => {
    const analyses = await analyzeSectionTargets(
      {
        openReadStream: () =>
          Promise.resolve(
            Readable.from([
              [
                "<html><body>",
                '<section id="empty"></section>',
                '<section id="filled"><p>Alpha beta.</p></section>',
                "</body></html>",
              ].join(""),
            ]),
          ),
      } as never,
      new Map([
        [
          "chapter.xhtml",
          [
            {
              fragment: "empty",
              id: "empty",
              path: "chapter.xhtml",
            },
            {
              fragment: "filled",
              id: "filled",
              path: "chapter.xhtml",
            },
          ],
        ],
      ]),
    );

    expect(analyses.get("empty")).toStrictEqual({
      hasContent: false,
      wordsCount: 0,
    });
    expect(analyses.get("filled")).toStrictEqual({
      hasContent: true,
      wordsCount: 2,
    });
  });

  it("rejects encrypted epub inputs", async () => {
    await expect(
      EPUB_SOURCE_ADAPTER.openSession(
        getFixturePath("sample-observatory-guide-encrypted.epub"),
        () => Promise.resolve(undefined),
      ),
    ).rejects.toThrow(
      "Encrypted EPUB is not supported: found META-INF/encryption.xml.",
    );
  });
});

function resolveCfiText(html: string, cfi: string): string {
  const body = cfi.slice("epubcfi(".length, -1);
  const indirection = body.indexOf("!");
  const localPath = indirection < 0 ? body : body.slice(indirection + 1);
  const [startPath, endPath] = localPath.split(",", 3);
  if (startPath === undefined || endPath === undefined) {
    throw new Error("Test CFI does not contain a range.");
  }
  const steps = [...startPath.matchAll(/\/(\d+)(?:\[[^\]]*\])?/gu)].map(
    (match) => Number(match[1]),
  );
  const offset = Number(startPath.match(/:(\d+)$/u)?.[1] ?? 0);
  const endOffset = Number(endPath.match(/:(\d+)$/u)?.[1] ?? 0);
  const root = parseDocument(html) as unknown as TestHtmlNode;
  const rootElement = (root.children ?? []).find(isTestElement);
  if (rootElement === undefined) {
    throw new Error("Test XHTML has no root element.");
  }

  let node: TestHtmlNode = rootElement;
  for (const step of steps) {
    if (step % 2 === 0) {
      const elements = (node.children ?? []).filter(isTestElement);
      node = elements[step / 2 - 1]!;
    } else {
      const chunks = collectTextChunks(node);
      const text = chunks[(step - 1) / 2] ?? "";
      expect(endOffset).toBeLessThanOrEqual(text.length);
      return text.slice(offset);
    }
  }

  return node.data ?? "";
}

interface TestHtmlNode {
  readonly children?: readonly TestHtmlNode[];
  readonly data?: string;
  readonly name?: string;
  readonly type?: string;
}

function isTestElement(node: TestHtmlNode): boolean {
  return node.name !== undefined && node.type !== "directive";
}

function collectTextChunks(node: TestHtmlNode): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const child of node.children ?? []) {
    if (isTestElement(child)) {
      chunks.push(current);
      current = "";
    } else if (child.type === "text") {
      current += child.data ?? "";
    }
  }

  chunks.push(current);
  return chunks;
}
