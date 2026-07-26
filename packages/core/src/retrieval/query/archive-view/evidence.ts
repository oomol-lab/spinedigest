import type { ReadonlyDocument } from "../../../document/index.js";

import { parseWikiGraphReference } from "./references.js";
import type { ArchiveEvidence, ArchiveEvidenceOptions } from "./types.js";
import { requireNode } from "./core.js";
import { DEFAULT_FIND_LIMIT, decodeFindCursor } from "./helpers.js";
import {
  filterMentionLinksByChapter,
  filterMentionsByChapter,
} from "./knowledge.js";
import {
  createMentionEvidenceRanges,
  createMentionEvidencePage,
  createMentionLinkEvidenceRanges,
  createMentionLinkEvidencePage,
  createNodeEvidenceRanges,
  createSourceEvidencePage,
  createEvidenceReadContext,
} from "./source.js";

export async function listArchiveEvidence(
  document: ReadonlyDocument,
  uri: string,
  options: ArchiveEvidenceOptions = {},
): Promise<ArchiveEvidence> {
  let reference: ReturnType<typeof parseWikiGraphReference>;
  try {
    reference = parseWikiGraphReference(uri);
  } catch (error) {
    if (
      /^wikg:\/\/chapter\/.+\/(?:source|summary|title|state)(?:[#/]|$)/u.test(
        uri,
      )
    ) {
      throw new Error(`Evidence is not available for ${uri}.`);
    }
    throw error;
  }

  switch (reference.type) {
    case "chapter":
    case "chapter-title":
    case "chapter-state":
    case "chapter-tree":
    case "entity-wikipage":
    case "meta":
    case "text-stream":
      throw new Error(`Evidence is not available for ${uri}.`);
    case "chunk": {
      const { chapterId, node } = await requireNode(document, reference.id);

      if (
        reference.chapterId !== undefined &&
        reference.chapterId !== chapterId
      ) {
        throw new Error(`Chunk ${uri} was not found in this archive.`);
      }

      return await createSourceEvidencePage(
        document,
        createNodeEvidenceRanges(node),
        options,
      );
    }
    case "entity": {
      if (options.query === undefined) {
        const limit = options.limit ?? DEFAULT_FIND_LIMIT;
        const offset = decodeFindCursor(options.cursor);
        const chapterFilter =
          reference.chapterId === undefined
            ? {}
            : { chapterId: reference.chapterId };
        const [total, mentions] = await Promise.all([
          document.mentions.countByQid(reference.qid, chapterFilter),
          document.mentions.listByQid(reference.qid, {
            ...chapterFilter,
            limit,
            offset,
            order: options.order === "doc-desc" ? "desc" : "asc",
          }),
        ]);

        return await createMentionEvidencePage(document, mentions, {
          context: createEvidenceReadContext(),
          limit,
          offset,
          sourceContext: options.sourceContext,
          total,
        });
      }

      return await createSourceEvidencePage(
        document,
        await createMentionEvidenceRanges(
          document,
          filterMentionsByChapter(
            await document.mentions.listByQid(reference.qid),
            reference.chapterId,
          ),
        ),
        options,
      );
    }
    case "triple": {
      if (options.query === undefined) {
        const limit = options.limit ?? DEFAULT_FIND_LIMIT;
        const offset = decodeFindCursor(options.cursor);
        const tripleQuery = {
          ...(reference.chapterId === undefined
            ? {}
            : { chapterId: reference.chapterId }),
          objectQid: reference.objectQid,
          predicate: reference.predicate,
          subjectQid: reference.subjectQid,
        };
        const [total, links] = await Promise.all([
          document.mentionLinks.countByTriple(tripleQuery),
          document.mentionLinks.listByTriple({
            ...tripleQuery,
            limit,
            offset,
            order: options.order === "doc-desc" ? "desc" : "asc",
          }),
        ]);

        return await createMentionLinkEvidencePage(document, links, {
          context: createEvidenceReadContext(),
          limit,
          offset,
          sourceContext: options.sourceContext,
          total,
        });
      }

      return await createSourceEvidencePage(
        document,
        createMentionLinkEvidenceRanges(
          document,
          await filterMentionLinksByChapter(
            document,
            await document.mentionLinks.listByTriple({
              objectQid: reference.objectQid,
              predicate: reference.predicate,
              subjectQid: reference.subjectQid,
            }),
            reference.chapterId,
          ),
        ),
        options,
      );
    }
  }
}

export {
  createFindEvidenceHydrationOptions,
  hydrateFindHitEvidence,
} from "./evidence-hydration.js";
