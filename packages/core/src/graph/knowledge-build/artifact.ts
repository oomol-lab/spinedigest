import {
  ensureRelativeDirectory,
  ensureRelativeFile,
} from "../../runtime/platform/index.js";

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
  const knowledgeGraphDirectory = await ensureRelativeDirectory(
    options.workspace,
    "knowledge-graph",
  );
  const chapterDirectoryName = `chapter-${chapterId}`;
  if (
    (await knowledgeGraphDirectory.getDirectory(chapterDirectoryName)) !==
    undefined
  ) {
    await knowledgeGraphDirectory.remove(chapterDirectoryName, {
      recursive: true,
    });
  }
  const workspace =
    await knowledgeGraphDirectory.createDirectory(chapterDirectoryName);
  const mentionsFile = await ensureRelativeFile(workspace, "mentions.jsonl");
  const mentionLinksFile = await ensureRelativeFile(
    workspace,
    "mention-links.jsonl",
  );
  const objectsFile = await ensureRelativeFile(workspace, "wikg-objects.jsonl");
  const parameter = options.parameter ?? {
    language: LanguageCode.Chinese,
    prompt: "",
  };

  const mentions = await collectParsedRecords(
    options.mentions,
    parseMentionRecord,
  );
  const mentionLinks = await collectParsedRecords(
    options.mentionLinks,
    parseMentionLinkRecord,
  );

  await writeWikgObjectsToJsonl(
    objectsFile,
    createChapterKnowledgeGraphObjectStream({
      chapterId,
      mentionLinks,
      mentions,
      parameter,
    }),
  );
  await writeJsonl(mentionsFile, mentions, parseMentionRecord);
  await writeJsonl(mentionLinksFile, mentionLinks, parseMentionLinkRecord);

  return {
    chapterId,
    mentionLinksFile,
    mentionsFile,
    objectsFile,
    parameter,
    workspace,
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
