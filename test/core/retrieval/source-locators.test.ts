import { describe, expect, it } from "vitest";

import {
  DirectoryDocument,
  type ReadonlyDocument,
} from "../../../packages/core/src/document/index.js";
import {
  addChapter,
  resetChapter,
  setChapterSource,
} from "../../../packages/core/src/api/chapter/index.js";
import {
  createSourceLocatorRanges,
  listArchiveSourceLocators,
} from "../../../packages/core/src/retrieval/query/archive-view/source-locators.js";
import { parseSourceTextJsonl } from "../../../packages/core/src/text/source/index.js";
import { withTempDir } from "../../helpers/temp.js";

describe("source locator ranges", () => {
  it("clips, rebases, merges adjacent locators, and preserves gaps", async () => {
    const digest = "a".repeat(64);
    const first = {
      artifact: { digest, mediaType: "application/pdf" },
      fragment: "page=1&bbox=0,0,1,1",
      locator: { bbox: [0, 0, 1, 1], pageIndex: 1 },
      sourceRevision: 3,
    } as const;
    const document = {
      serials: { getRevision: () => Promise.resolve(3) },
      sourceProvenance: {
        listMap: () =>
          Promise.resolve([
            { ...first, sourceEnd: 2, sourceStart: 0 },
            { ...first, sourceEnd: 4, sourceStart: 2 },
            {
              ...first,
              fragment: "page=2&bbox=0.1,0.2,0.9,1",
              locator: { bbox: [0.1, 0.2, 0.9, 1], pageIndex: 2 },
              sourceEnd: 8,
              sourceStart: 5,
            },
            { ...first, sourceEnd: 20, sourceRevision: 2, sourceStart: 10 },
          ]),
      },
    } as unknown as ReadonlyDocument;

    await expect(createSourceLocatorRanges(document, 7, 1, 7)).resolves.toEqual(
      [
        {
          range: [1, 3],
          uri: `wikg://artifact/${digest}#page=1&bbox=0,0,1,1`,
        },
        {
          range: [5, 6],
          uri: `wikg://artifact/${digest}#page=2&bbox=0.1,0.2,0.9,1`,
        },
      ],
    );
  });

  it("omits empty intersections", async () => {
    const document = {
      serials: { getRevision: () => Promise.resolve(1) },
      sourceProvenance: { listMap: () => Promise.resolve([]) },
    } as unknown as ReadonlyDocument;

    await expect(createSourceLocatorRanges(document, 1, 4, 4)).resolves.toEqual(
      [],
    );
  });

  it("lists and paginates locator ranges for whole or selected source text", async () => {
    await withTempDir("wikigraph-source-locator-list-", async (path) => {
      const digest = "b".repeat(64);
      const firstText = "Alpha. ";
      const secondText = "Beta.";
      const parsed = parseSourceTextJsonl(
        [
          JSON.stringify({
            digest,
            mediaType: "application/pdf",
            type: "artifact",
          }),
          JSON.stringify({
            locator: { bbox: [0, 0, 1, 0.5], pageIndex: 1 },
            text: firstText,
            type: "text",
          }),
          JSON.stringify({
            locator: { bbox: [0, 0.5, 1, 1], pageIndex: 1 },
            text: secondText,
            type: "text",
          }),
        ].join("\n"),
      );
      const document = await DirectoryDocument.open(path);

      try {
        const chapter = await addChapter(document, { title: "Fixture" });
        await setChapterSource(document, chapter.chapterId, [parsed.text], {
          provenance: parsed.provenance,
        });

        const firstPage = await listArchiveSourceLocators(
          document,
          `${chapter.uri}/source/locators`,
          { limit: 1 },
        );
        expect(firstPage).toMatchObject({
          items: [
            {
              range: [1, Array.from(firstText).length],
              uri: `wikg://artifact/${digest}#page=1&bbox=0,0,1,0.5`,
            },
          ],
          limit: 1,
        });
        expect(firstPage.nextCursor).not.toBeNull();
        const nextCursor = firstPage.nextCursor;
        if (nextCursor === null) {
          throw new Error("Expected a second source locator page.");
        }
        await expect(
          listArchiveSourceLocators(
            document,
            `${chapter.uri}/source/locators`,
            {
              cursor: nextCursor,
              limit: 1,
            },
          ),
        ).resolves.toMatchObject({
          items: [
            {
              range: [
                Array.from(firstText).length + 1,
                Array.from(firstText + secondText).length,
              ],
              uri: `wikg://artifact/${digest}#page=1&bbox=0,0.5,1,1`,
            },
          ],
          nextCursor: null,
        });
        await expect(
          listArchiveSourceLocators(
            document,
            `${chapter.uri}/source/locators#2`,
          ),
        ).resolves.toMatchObject({
          items: [
            {
              range: [1, Array.from(secondText).length],
              uri: `wikg://artifact/${digest}#page=1&bbox=0,0.5,1,1`,
            },
          ],
        });

        await resetChapter(document, chapter.chapterId, "planned");
        await setChapterSource(document, chapter.chapterId, ["Rewritten."]);
        await expect(
          listArchiveSourceLocators(
            document,
            `${chapter.uri}/source/locators`,
            {
              cursor: nextCursor,
              limit: 1,
            },
          ),
        ).rejects.toThrow("Invalid or stale source locator cursor");
      } finally {
        await document.release();
      }
    });
  });
});
