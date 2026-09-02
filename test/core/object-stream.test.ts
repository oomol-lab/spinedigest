import { writeFile } from "fs/promises";
import { describe, expect, it } from "vitest";

import {
  collectChapterKnowledgeGraphObjects,
  parseWikgObject,
  readWikgObjectsFromJsonl,
  WIKG_OBJECT_SCHEMA_VERSION,
  writeWikgObjectsToJsonl,
  type WikgObject,
} from "../../packages/core/src/object-stream.js";
import { withTempDir } from "../helpers/temp.js";
import { NodeFile } from "../../packages/cli/src/runtime/node-platform.js";

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];

  for await (const item of items) {
    collected.push(item);
  }

  return collected;
}

describe("wikg object streams", () => {
  it("encodes, decodes, and streams JSONL records", async () => {
    await withTempDir("wikg-object-stream-", async (path) => {
      const objects: WikgObject[] = [
        {
          chapterId: 1,
          schemaVersion: WIKG_OBJECT_SCHEMA_VERSION,
          stream: "knowledge-graph",
          type: "meta",
        },
        {
          language: "zh",
          prompt: "Recall entities",
          scope: "knowledge-graph",
          type: "parameter",
        },
        {
          id: "m1",
          qid: "Q1",
          rangeEnd: 1,
          rangeStart: 0,
          sentenceIndex: 0,
          surface: "A",
          type: "mention",
        },
        {
          evidenceSentenceIndexes: [0],
          id: "l1",
          predicate: "mentions",
          sourceMentionId: "m1",
          targetMentionId: "m1",
          type: "mention-link",
        },
        { type: "end" },
      ];
      const filePath = `${path}/objects.jsonl`;
      const file = new NodeFile(filePath);

      await writeWikgObjectsToJsonl(file, objects);

      await expect(
        collect(readWikgObjectsFromJsonl(file)),
      ).resolves.toStrictEqual(objects);
      await expect(
        collectChapterKnowledgeGraphObjects(1, readWikgObjectsFromJsonl(file)),
      ).resolves.toMatchObject({
        mentionLinks: [
          {
            evidenceSentenceIds: [[1, 0]],
            id: "l1",
            predicate: "mentions",
            sourceMentionId: "m1",
            targetMentionId: "m1",
          },
        ],
        mentions: [
          {
            chapterId: 1,
            id: "m1",
            qid: "Q1",
            rangeEnd: 1,
            rangeStart: 0,
            sentenceIndex: 0,
            surface: "A",
          },
        ],
      });
    });
  });

  it("rejects malformed JSONL lines", async () => {
    await withTempDir("wikg-object-stream-", async (path) => {
      const filePath = `${path}/objects.jsonl`;
      const file = new NodeFile(filePath);

      await writeFile(filePath, "{bad json}\n", "utf8");

      await expect(collect(readWikgObjectsFromJsonl(file))).rejects.toThrow(
        "Invalid WikgObject JSONL record at objects.jsonl:1",
      );
    });
  });

  it("rejects unknown record types", () => {
    expect(() => parseWikgObject({ type: "mystery" })).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => parseWikgObject({ type: "mention", id: "m1" })).toThrow();
  });

  it("rejects schema validation errors", () => {
    expect(() =>
      parseWikgObject({
        id: "m1",
        qid: "not-a-qid",
        rangeEnd: 1,
        rangeStart: 0,
        surface: "A",
        type: "mention",
      }),
    ).toThrow();
  });
});
