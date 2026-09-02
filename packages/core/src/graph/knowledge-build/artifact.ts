import { mkdir, rm } from "../../runtime/platform/index.js";
import { join } from "../../runtime/platform/index.js";

import { LanguageCode } from "../../runtime/common/language.js";
import {
  createChapterKnowledgeGraphObjectStream,
  writeWikgObjectsToJsonl,
} from "../../object-stream.js";
import {
  parseMentionLinkRecord,
  parseMentionRecord,
  writeJsonl,
} from "./artifact-io.js";
import type {
  BuildChapterKnowledgeGraphArtifactOptions,
  ChapterKnowledgeGraphBuildArtifact,
} from "./types.js";

export async function buildChapterKnowledgeGraphArtifact(
  chapterId: number,
  options: BuildChapterKnowledgeGraphArtifactOptions,
): Promise<ChapterKnowledgeGraphBuildArtifact> {
  const workspacePath = join(
    options.workspacePath,
    "knowledge-graph",
    `chapter-${chapterId}`,
  );
  const mentionsPath = join(workspacePath, "mentions.jsonl");
  const mentionLinksPath = join(workspacePath, "mention-links.jsonl");
  const objectsPath = join(workspacePath, "wikg-objects.jsonl");
  const parameter = options.parameter ?? {
    language: LanguageCode.Chinese,
    prompt: "",
  };

  await rm(workspacePath, { force: true, recursive: true });
  await mkdir(workspacePath, { recursive: true });
  const mentions = await collectParsedRecords(
    options.mentions,
    parseMentionRecord,
  );
  const mentionLinks = await collectParsedRecords(
    options.mentionLinks,
    parseMentionLinkRecord,
  );

  await writeWikgObjectsToJsonl(
    objectsPath,
    createChapterKnowledgeGraphObjectStream({
      chapterId,
      mentionLinks,
      mentions,
      parameter,
    }),
  );
  await writeJsonl(mentionsPath, mentions, parseMentionRecord);
  await writeJsonl(mentionLinksPath, mentionLinks, parseMentionLinkRecord);

  return {
    chapterId,
    mentionLinksPath,
    mentionsPath,
    objectsPath,
    parameter,
    workspacePath,
  };
}

async function collectParsedRecords<T>(
  records: AsyncIterable<T> | Iterable<T>,
  parseRecord: (record: unknown) => T,
): Promise<T[]> {
  const parsedRecords: T[] = [];

  for await (const record of records) {
    parsedRecords.push(parseRecord(record));
  }

  return parsedRecords;
}
