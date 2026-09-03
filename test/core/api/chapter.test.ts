import { rm, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../../packages/core/src/document/index.js";
import {
  addChapter,
  advanceChapterStages,
  applyChapterTree,
  getChapterDetails,
  getChapterTree,
  listChapters,
  moveChapter,
  parseChapterTreeInput,
  removeChapter,
  resetChapter,
  setChapterSource,
  setChapterSummary,
  setChapterTitle,
} from "../../../packages/core/src/api/chapter/index.js";
import { withTempDir } from "../../helpers/temp.js";

describe("facade/chapter", () => {
  it("adds planned chapters into a tree and lists their stages", async () => {
    await withTempDir("wikigraph-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.writeToc({
            items: [],
            version: 1,
          });
        });

        const parent = await addChapter(document, {
          title: "Part I",
        });
        const child = await addChapter(document, {
          parentChapterId: parent.chapterId,
          title: "Chapter 1",
        });

        expect(parent).toMatchObject({
          chapterId: 1,
          stage: "planned",
          title: "Part I",
        });
        expect(child).toMatchObject({
          chapterId: 2,
          stage: "planned",
          title: "Chapter 1",
        });
        expect(parent.key).toMatch(/^(?!\d+$)[0-9a-f]{12}$/u);
        expect(parent.key).not.toBe("part-i");
        expect(parent.path).toBe(parent.key);
        expect(child.key).toMatch(/^(?!\d+$)[0-9a-f]{12}$/u);
        expect(child.key).not.toBe("chapter-1");
        expect(child.path).toBe(`${parent.key}/${child.key}`);
        expect(await listChapters(document)).toMatchObject([
          {
            chapterId: 1,
            depth: 0,
            stage: "planned",
            title: "Part I",
          },
          {
            chapterId: 2,
            depth: 1,
            stage: "planned",
            title: "Chapter 1",
          },
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("rejects missing chapter keys on read-only chapter paths", async () => {
    await withTempDir("wikigraph-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
        });
        await writeFile(
          `${path}/toc.json`,
          `${JSON.stringify({
            items: [
              {
                children: [
                  {
                    children: [],
                    serialId: 1,
                    title: "Chapter 1",
                  },
                ],
                title: "Part I",
              },
            ],
            version: 1,
          })}\n`,
          "utf8",
        );

        await expect(listChapters(document)).rejects.toThrow(
          "Missing chapter key in TOC.",
        );
        await expect(getChapterTree(document)).rejects.toThrow(
          "Missing chapter key in TOC.",
        );
        expect(await document.readToc()).toStrictEqual({
          items: [
            {
              children: [
                {
                  children: [],
                  serialId: 1,
                  title: "Chapter 1",
                },
              ],
              title: "Part I",
            },
          ],
          version: 1,
        });
      } finally {
        await document.release();
      }
    });
  });

  it("rejects duplicate chapter keys on read-only chapter paths", async () => {
    await withTempDir("wikigraph-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          await openedDocument.createSerial();
        });
        await writeFile(
          `${path}/toc.json`,
          `${JSON.stringify({
            items: [
              {
                children: [],
                key: "a1b2c3d4e5f6",
                serialId: 1,
                title: "First",
              },
              {
                children: [],
                key: "a1b2c3d4e5f6",
                serialId: 2,
                title: "Second",
              },
            ],
            version: 1,
          })}\n`,
          "utf8",
        );

        await expect(listChapters(document)).rejects.toThrow(
          "Duplicate chapter key: a1b2c3d4e5f6.",
        );
        await expect(getChapterTree(document)).rejects.toThrow(
          "Duplicate chapter key: a1b2c3d4e5f6.",
        );
      } finally {
        await document.release();
      }
    });
  });

  it("normalizes serial-less grouping nodes before chapter writes", async () => {
    await withTempDir("wikigraph-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          await openedDocument.writeToc({
            items: [
              {
                children: [
                  {
                    children: [],
                    serialId: 1,
                    title: "Chapter 1",
                  },
                ],
                title: "Part I",
              },
            ],
            version: 1,
          });
        });

        const added = await addChapter(document, { title: "Chapter 2" });

        expect(added.chapterId).toBe(3);
        expect(await listChapters(document)).toMatchObject([
          {
            chapterId: 2,
            depth: 0,
            stage: "planned",
            title: "Part I",
          },
          {
            chapterId: 1,
            depth: 1,
            stage: "planned",
            title: "Chapter 1",
          },
          {
            chapterId: 3,
            depth: 0,
            stage: "planned",
            title: "Chapter 2",
          },
        ]);
        const toc = await document.readToc();
        expect(toc).toMatchObject({
          items: [
            {
              serialId: 2,
              title: "Part I",
            },
            {
              serialId: 3,
              title: "Chapter 2",
            },
          ],
        });
        expect(toc?.items[0]?.key).toMatch(/^(?!\d+$)[0-9a-f]{12}$/u);
        expect(toc?.items[0]?.children[0]?.key).toMatch(
          /^(?!\d+$)[0-9a-f]{12}$/u,
        );
        expect(toc?.items[1]?.key).toMatch(/^(?!\d+$)[0-9a-f]{12}$/u);
      } finally {
        await document.release();
      }
    });
  });

  it("uses unique opaque keys for duplicate and non-latin chapter titles", async () => {
    await withTempDir("wikigraph-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const first = await addChapter(document, { title: "Repeat" });
        const second = await addChapter(document, { title: "Repeat" });
        const nonLatin = await addChapter(document, { title: "中文标题" });

        expect(new Set([first.key, second.key, nonLatin.key]).size).toBe(3);
        for (const chapter of [first, second, nonLatin]) {
          expect(chapter.key).toMatch(/^(?!\d+$)[0-9a-f]{12}$/u);
        }
        expect(second.key).not.toBe("repeat-2");
        expect(nonLatin.key).not.toBe("chapter");
        expect(nonLatin.key).not.toBe("chapter-2");
      } finally {
        await document.release();
      }
    });
  });

  it("sets source and summary through explicit stages", async () => {
    await withTempDir("wikigraph-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const chapter = await addChapter(document, {
          title: "Chapter 1",
        });
        const sourced = await setChapterSource(document, chapter.chapterId, [
          "Alpha beta.",
        ]);

        expect(sourced.stage).toBe("sourced");
        await document.serials.setTopologyReady(chapter.chapterId);

        expect(
          await getChapterDetails(document, chapter.chapterId),
        ).toMatchObject({
          stage: "graphed",
        });

        const summarized = await setChapterSummary(
          document,
          chapter.chapterId,
          "Summary",
        );

        expect(summarized.stage).toBe("summarized");

        const resetToGraph = await resetChapter(
          document,
          chapter.chapterId,
          "graphed",
        );

        expect(resetToGraph.stage).toBe("graphed");

        const resetToSource = await resetChapter(
          document,
          chapter.chapterId,
          "sourced",
        );

        expect(resetToSource.stage).toBe("sourced");

        const resetToPlanned = await resetChapter(
          document,
          chapter.chapterId,
          "planned",
        );

        expect(resetToPlanned.stage).toBe("planned");
      } finally {
        await document.release();
      }
    });
  });

  it("clears all chapter data when resetting directly to planned", async () => {
    await withTempDir("wikigraph-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const chapter = await addChapter(document, {
          title: "Chapter 1",
        });
        const sourceText = "Alpha beta. Gamma delta.";
        const artifactDigest = "a".repeat(64);
        await setChapterSource(document, chapter.chapterId, [sourceText], {
          provenance: {
            artifacts: [
              {
                digest: artifactDigest,
                mediaType: "application/pdf",
              },
            ],
            mappings: [
              {
                artifactDigest,
                locator: { bbox: [0, 0, 1, 1], pageIndex: 1 },
                sourceEnd: sourceText.length,
                sourceStart: 0,
              },
            ],
          },
        });
        await document.chunks.save({
          content: "Reading chunk",
          generation: 0,
          id: 100,
          label: "Chunk",
          sentenceId: [chapter.chapterId, 0],
          sentenceIds: [[chapter.chapterId, 0]],
          wordsCount: 2,
          weight: 1,
        });
        await document.mentions.save({
          chapterId: chapter.chapterId,
          id: "mention-1",
          qid: "Q1",
          rangeEnd: 5,
          rangeStart: 0,
          sentenceIndex: 0,
          surface: "Alpha",
        });
        await document.serials.setTopologyReady(chapter.chapterId);
        await document.serials.setKnowledgeGraphReady(chapter.chapterId, true);
        await setChapterSummary(document, chapter.chapterId, "Summary");
        const sourceRevision = await document.serials.getRevision(
          chapter.chapterId,
        );
        await document.indexArtifacts.replaceFts({
          lexicalRows: [],
          serialId: chapter.chapterId,
          sourceRevision,
        });
        await document.indexArtifacts.replaceEmbedding({
          kind: "embedding-source",
          segments: [],
          serialId: chapter.chapterId,
          sourceRevision,
        });
        await document.indexArtifacts.replaceEmbedding({
          kind: "embedding-summary",
          segments: [],
          serialId: chapter.chapterId,
          sourceRevision,
        });

        const reset = await resetChapter(
          document,
          chapter.chapterId,
          "planned",
        );

        expect(reset).toMatchObject({
          fragmentCount: 0,
          graphReady: false,
          hasSummary: false,
          stage: "planned",
        });
        expect(
          await document.getSerialFragments(chapter.chapterId).readText(),
        ).toBeUndefined();
        expect(await document.readSummary(chapter.chapterId)).toBeUndefined();
        expect(
          await document.sourceProvenance.listMap(chapter.chapterId),
        ).toStrictEqual([]);
        expect(await document.sourceProvenance.listArtifacts()).toStrictEqual(
          [],
        );
        expect(await document.chunks.listBySerial(chapter.chapterId)).toEqual(
          [],
        );
        expect(
          await document.mentions.listByChapter(chapter.chapterId),
        ).toEqual([]);
        expect(await document.indexArtifacts.list()).toEqual([]);
        expect(await document.serials.getById(chapter.chapterId)).toMatchObject(
          {
            knowledgeGraphReady: false,
            topologyReady: false,
          },
        );
      } finally {
        await document.release();
      }
    });
  });

  it("reads one chapter details without scanning unrelated chapter fragments", async () => {
    await withTempDir("wikigraph-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const first = await addChapter(document, {
          title: "Chapter 1",
        });
        const second = await addChapter(document, {
          title: "Chapter 2",
        });

        await setChapterSource(document, first.chapterId, ["Alpha beta."]);
        await setChapterSource(document, second.chapterId, ["Gamma delta."]);
        await rm(document.getSerialFragments(second.chapterId).path, {
          force: true,
          recursive: true,
        });

        await expect(
          getChapterDetails(document, first.chapterId),
        ).resolves.toMatchObject({
          chapterId: first.chapterId,
          stage: "sourced",
          words: 2,
        });
      } finally {
        await document.release();
      }
    });
  });

  it("updates and clears chapter titles in the TOC", async () => {
    await withTempDir("wikigraph-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const chapter = await addChapter(document, {
          title: "Original",
        });
        const originalKey = chapter.key;
        const originalUri = chapter.uri;

        await expect(
          setChapterTitle(document, chapter.chapterId, "  Renamed  "),
        ).resolves.toMatchObject({
          chapterId: chapter.chapterId,
          title: "Renamed",
        });
        await expect(listChapters(document)).resolves.toMatchObject([
          {
            chapterId: chapter.chapterId,
            title: "Renamed",
            tocPath: ["Renamed"],
          },
        ]);
        await expect(document.readToc()).resolves.toMatchObject({
          items: [
            {
              serialId: chapter.chapterId,
              title: "Renamed",
            },
          ],
        });

        await expect(
          setChapterTitle(document, chapter.chapterId, "   "),
        ).resolves.toMatchObject({
          chapterId: chapter.chapterId,
          title: null,
        });
        await expect(listChapters(document)).resolves.toMatchObject([
          {
            chapterId: chapter.chapterId,
            title: null,
            tocPath: [`Chapter ${chapter.chapterId}`],
          },
        ]);
        expect(await document.readToc()).toStrictEqual({
          items: [
            {
              children: [],
              key: originalKey,
              serialId: chapter.chapterId,
            },
          ],
          version: 1,
        });
        await expect(
          getChapterDetails(document, chapter.chapterId),
        ).resolves.toMatchObject({
          key: originalKey,
          uri: originalUri,
        });
      } finally {
        await document.release();
      }
    });
  });

  it("requires recursive removal for chapters with children", async () => {
    await withTempDir("wikigraph-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const parent = await addChapter(document, {
          title: "Part I",
        });
        await addChapter(document, {
          parentChapterId: parent.chapterId,
          title: "Chapter 1",
        });

        await expect(removeChapter(document, parent.chapterId)).rejects.toThrow(
          "has child chapters",
        );

        await removeChapter(document, parent.chapterId, {
          recursive: true,
        });

        await expect(listChapters(document)).resolves.toStrictEqual([]);
        await expect(document.serials.listIds()).resolves.toStrictEqual([]);
      } finally {
        await document.release();
      }
    });
  });

  it("moves chapters across parents and sibling positions", async () => {
    await withTempDir("wikigraph-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const part = await addChapter(document, { title: "Part" });
        const first = await addChapter(document, {
          parentChapterId: part.chapterId,
          title: "First",
        });
        const second = await addChapter(document, {
          parentChapterId: part.chapterId,
          title: "Second",
        });
        const root = await addChapter(document, { title: "Root" });

        await moveChapter(document, root.chapterId, {
          first: true,
          parentChapterId: part.chapterId,
        });
        await expect(listChapters(document)).resolves.toMatchObject([
          { chapterId: part.chapterId, depth: 0 },
          { chapterId: root.chapterId, depth: 1, title: "Root" },
          { chapterId: first.chapterId, depth: 1, title: "First" },
          { chapterId: second.chapterId, depth: 1, title: "Second" },
        ]);

        await moveChapter(document, first.chapterId, {
          afterChapterId: second.chapterId,
        });
        await expect(listChapters(document)).resolves.toMatchObject([
          { chapterId: part.chapterId, depth: 0 },
          { chapterId: root.chapterId, depth: 1 },
          { chapterId: second.chapterId, depth: 1 },
          { chapterId: first.chapterId, depth: 1 },
        ]);

        await moveChapter(document, second.chapterId, {
          root: true,
        });
        await expect(listChapters(document)).resolves.toMatchObject([
          { chapterId: part.chapterId, depth: 0 },
          { chapterId: root.chapterId, depth: 1 },
          { chapterId: first.chapterId, depth: 1 },
          { chapterId: second.chapterId, depth: 0 },
        ]);

        await expect(
          moveChapter(document, part.chapterId, {
            parentChapterId: root.chapterId,
          }),
        ).rejects.toThrow("own descendant");
      } finally {
        await document.release();
      }
    });
  });

  it("exports and applies complete chapter trees", async () => {
    await withTempDir("wikigraph-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const part = await addChapter(document, { title: "Part" });
        const first = await addChapter(document, {
          parentChapterId: part.chapterId,
          title: "First",
        });
        const second = await addChapter(document, {
          parentChapterId: part.chapterId,
        });
        const secondRootUri = `wikg://chapter/${second.key}`;

        await expect(getChapterTree(document)).resolves.toStrictEqual({
          chapters: [
            {
              children: [
                {
                  children: [],
                  title: "First",
                  uri: first.uri,
                },
                {
                  children: [],
                  uri: second.uri,
                  title: null,
                },
              ],
              title: "Part",
              uri: part.uri,
            },
          ],
        });

        const dryRun = await applyChapterTree(
          document,
          parseChapterTreeInput({
            chapters: [
              {
                children: [],
                uri: secondRootUri,
                title: "Second",
              },
              {
                children: [
                  {
                    children: [],
                    uri: first.uri,
                    title: null,
                  },
                ],
                uri: part.uri,
              },
            ],
          }),
          { dryRun: true },
        );

        expect(dryRun.changed).toBe(true);
        expect(dryRun.moved.map((move) => move.oldUri)).toContain(second.uri);
        expect(dryRun.renamed).toHaveLength(2);
        expect(dryRun.renamed).toStrictEqual(
          expect.arrayContaining([
            {
              uri: secondRootUri,
              newTitle: "Second",
              oldTitle: null,
            },
            {
              uri: first.uri,
              newTitle: null,
              oldTitle: "First",
            },
          ]),
        );
        await expect(listChapters(document)).resolves.toMatchObject([
          { chapterId: part.chapterId, title: "Part" },
          { chapterId: first.chapterId, title: "First" },
          { chapterId: second.chapterId, title: null },
        ]);

        await applyChapterTree(
          document,
          parseChapterTreeInput({
            chapters: [
              {
                children: [],
                uri: secondRootUri,
                title: "Second",
              },
              {
                children: [
                  {
                    children: [],
                    uri: first.uri,
                    title: null,
                  },
                ],
                uri: part.uri,
              },
            ],
          }),
        );

        await expect(listChapters(document)).resolves.toMatchObject([
          { chapterId: second.chapterId, depth: 0, title: "Second" },
          { chapterId: part.chapterId, depth: 0, title: "Part" },
          { chapterId: first.chapterId, depth: 1, title: null },
        ]);

        await expect(
          applyChapterTree(
            document,
            parseChapterTreeInput({
              chapters: [
                {
                  children: [],
                  uri: second.uri,
                },
              ],
            }),
          ),
        ).rejects.toThrow("does not match its JSON parent path");
        expect(() =>
          parseChapterTreeInput({
            chapters: [
              {
                children: [],
                uri: secondRootUri,
                summary: "not allowed",
              },
            ],
          }),
        ).toThrow();
      } finally {
        await document.release();
      }
    });
  });

  it("advances stages idempotently without resetting planned chapters", async () => {
    await withTempDir("wikigraph-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const chapter = await addChapter(document, {
          title: "Draft",
        });

        const noop = await advanceChapterStages(document, {
          extractionPrompt: "Keep key beats",
          llm: {} as never,
          targetStage: "planned",
        });

        expect(noop.advanced).toStrictEqual([]);
        expect(noop.pending).toMatchObject([
          {
            chapterId: chapter.chapterId,
            stage: "planned",
          },
        ]);
        expect(
          await getChapterDetails(document, chapter.chapterId),
        ).toMatchObject({
          stage: "planned",
        });

        const skipped = await advanceChapterStages(document, {
          extractionPrompt: "Keep key beats",
          llm: {} as never,
          targetStage: "summarized",
        });

        expect(skipped.advanced).toStrictEqual([]);
        expect(skipped.pending).toMatchObject([
          {
            chapterId: chapter.chapterId,
            stage: "planned",
          },
        ]);
        expect(skipped.skipped).toMatchObject([
          {
            chapterId: chapter.chapterId,
            stage: "planned",
          },
        ]);
      } finally {
        await document.release();
      }
    });
  });

  it("reports advance progress without making progress callbacks fatal", async () => {
    await withTempDir("wikigraph-chapter-", async (path) => {
      const document = await DirectoryDocument.open(path);

      try {
        const chapter = await addChapter(document, {
          title: "Draft",
        });
        const events: unknown[] = [];

        const skipped = await advanceChapterStages(document, {
          extractionPrompt: "Keep key beats",
          llm: {} as never,
          onProgress: (event) => {
            events.push(event);
            throw new Error("progress failed");
          },
          targetStage: "summarized",
        });

        expect(skipped.advanced).toStrictEqual([]);
        expect(skipped.pending).toMatchObject([
          {
            chapterId: chapter.chapterId,
            stage: "planned",
          },
        ]);
        expect(events).toMatchObject([
          {
            targetStage: "summarized",
            totalChapters: 1,
            type: "selected",
          },
          {
            chapter: {
              chapterId: chapter.chapterId,
              title: "Draft",
            },
            reason: "planned",
            targetStage: "summarized",
            type: "skipped",
          },
        ]);
      } finally {
        await document.release();
      }
    });
  });
});
