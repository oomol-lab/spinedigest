import type {
  MentionLinkRecord,
  MentionRecord,
  ReadonlyDocument,
} from "../../../../document/index.js";

import { TEXT_SENTENCE_KIND } from "../../../search-index/search/index.js";
import {
  DEFAULT_FIND_LIMIT,
  compareNumbers,
  decodeFindCursor,
  encodeFindCursor,
} from "../helpers.js";
import { queryRequiredSearchIndex } from "../search/hydration.js";
import type {
  ArchiveEvidence,
  ArchiveEvidenceOptions,
  ArchiveFindEvidencePreview,
  ArchiveFindOrder,
  EvidenceReadContext,
  SourceEvidenceRange,
} from "../types.js";
import { DEFAULT_SOURCE_CONTEXT } from "../core.js";
import {
  createMentionEvidenceRanges,
  createMentionLinkEvidenceRanges,
} from "./ranges.js";
import {
  createSourceEvidenceCandidatePage,
  createSourceEvidenceCandidatePreview,
  createSourceEvidenceDisplayItems,
} from "./pagination.js";
import { createEvidenceReadContext } from "./read.js";

export { createEvidenceReadContext, createSourceEvidenceItem } from "./read.js";
export {
  createExpandedSourceEvidenceRanges,
  createMentionEvidenceRanges,
  createMentionLinkEvidenceRanges,
  createNodeEvidenceRanges,
} from "./ranges.js";

export async function createMentionEvidencePreview(
  document: ReadonlyDocument,
  mentions: readonly MentionRecord[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  _order: ArchiveFindOrder = "doc-asc",
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidenceCandidatePreview(document, {
    candidates: mentions,
    context,
    createRanges: async (mention) =>
      await createMentionEvidenceRanges(document, [mention]),
    limit,
    sourceContext,
    total,
  });
}

export async function createMentionEvidencePagePreview(
  document: ReadonlyDocument,
  mentions: readonly MentionRecord[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidenceCandidatePreview(document, {
    candidates: mentions,
    context,
    createRanges: async (mention) =>
      await createMentionEvidenceRanges(document, [mention]),
    limit,
    sourceContext,
    total,
  });
}

export async function createMentionEvidencePage(
  document: ReadonlyDocument,
  mentions: readonly MentionRecord[],
  options: {
    readonly context: EvidenceReadContext;
    readonly limit: number;
    readonly offset: number;
    readonly sourceContext?: number | undefined;
    readonly total: number;
  },
): Promise<ArchiveEvidence> {
  return await createSourceEvidenceCandidatePage(document, {
    candidates: mentions,
    context: options.context,
    createRanges: async (mention) =>
      await createMentionEvidenceRanges(document, [mention]),
    limit: options.limit,
    offset: options.offset,
    sourceContext: options.sourceContext,
    total: options.total,
  });
}

export async function createRangeEvidencePreview(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidenceCandidatePreview(document, {
    candidates: ranges,
    context,
    createRanges: (range) => [range],
    limit,
    sourceContext,
    total,
  });
}

export async function createSortedRangeEvidencePreview(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  order: ArchiveFindOrder = "doc-asc",
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createRangeEvidencePreview(
    document,
    await sortSourceEvidenceRanges(document, ranges, order),
    limit,
    context,
    sourceContext,
    total,
  );
}

export async function createMentionLinkEvidencePreview(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  _order: ArchiveFindOrder = "doc-asc",
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidenceCandidatePreview(document, {
    candidates: links,
    context,
    createRanges: (link) => createMentionLinkEvidenceRanges(document, [link]),
    limit,
    sourceContext,
    total,
  });
}

export async function createMentionLinkEvidencePagePreview(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createSourceEvidenceCandidatePreview(document, {
    candidates: links,
    context,
    createRanges: (link) => createMentionLinkEvidenceRanges(document, [link]),
    limit,
    sourceContext,
    total,
  });
}

export async function createMentionLinkEvidencePage(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
  options: {
    readonly context: EvidenceReadContext;
    readonly limit: number;
    readonly offset: number;
    readonly sourceContext?: number | undefined;
    readonly total: number;
  },
): Promise<ArchiveEvidence> {
  return await createSourceEvidenceCandidatePage(document, {
    candidates: links,
    context: options.context,
    createRanges: (link) => createMentionLinkEvidenceRanges(document, [link]),
    limit: options.limit,
    offset: options.offset,
    sourceContext: options.sourceContext,
    total: options.total,
  });
}

export async function createSortedMentionLinkEvidencePreview(
  document: ReadonlyDocument,
  links: readonly MentionLinkRecord[],
  limit = 3,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  order: ArchiveFindOrder = "doc-asc",
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createRangeEvidencePreview(
    document,
    await sortSourceEvidenceRanges(
      document,
      createMentionLinkEvidenceRanges(document, links),
      order,
    ),
    limit,
    context,
    sourceContext,
    total,
  );
}

export async function createSourceEvidencePage(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  options: ArchiveEvidenceOptions,
): Promise<ArchiveEvidence> {
  const context = createEvidenceReadContext();
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const start = decodeFindCursor(options.cursor);
  const evidenceRanges = await filterAndSortSourceEvidenceRangesByFtsQuery(
    document,
    ranges,
    options.query,
    options.order ?? "doc-asc",
  );
  const pageRanges = evidenceRanges.slice(start, start + limit);
  const nextOffset = start + pageRanges.length;
  const items = await createSourceEvidenceDisplayItems(document, pageRanges, {
    context,
    sourceContext: options.sourceContext,
  });

  return {
    items,
    limit,
    nextCursor:
      nextOffset < evidenceRanges.length ? encodeFindCursor(nextOffset) : null,
  };
}

export async function filterAndSortSourceEvidenceRangesByFtsQuery(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  queryText: string | undefined,
  order: ArchiveFindOrder,
): Promise<readonly SourceEvidenceRange[]> {
  const documentOrders = await document.serials.listDocumentOrders();

  if (queryText === undefined) {
    return [...ranges].sort((left, right) =>
      compareSourceEvidenceRanges(left, right, documentOrders, order),
    );
  }

  const indexResult = await queryRequiredSearchIndex(document, queryText, {
    chapters: [...new Set(ranges.map((range) => range.chapterId))],
    types: ["source"],
  });

  if (indexResult === undefined) {
    return [];
  }

  const matchedRanges = new Map<string, SourceEvidenceRange>();
  const rangesByChapterId = new Map<number, SourceEvidenceRange[]>();

  for (const range of ranges) {
    const chapterRanges = rangesByChapterId.get(range.chapterId) ?? [];

    chapterRanges.push(range);
    rangesByChapterId.set(range.chapterId, chapterRanges);
  }

  for (const hit of indexResult.textHits) {
    if (hit.kind !== TEXT_SENTENCE_KIND.source) {
      continue;
    }

    for (const range of rangesByChapterId.get(hit.chapterId) ?? []) {
      if (
        hit.sentenceIndex < range.startSentenceIndex ||
        hit.sentenceIndex > range.endSentenceIndex
      ) {
        continue;
      }

      const key = formatSourceEvidenceRangeKey(range);
      const current = matchedRanges.get(key);

      matchedRanges.set(key, {
        ...range,
        score: Math.max(current?.score ?? 0, hit.score),
      });
    }
  }

  return [...matchedRanges.values()].sort((left, right) => {
    const scoreComparison = (right.score ?? 0) - (left.score ?? 0);

    if (scoreComparison !== 0) {
      return scoreComparison;
    }

    return compareSourceEvidenceRanges(left, right, documentOrders, "doc-asc");
  });
}

function formatSourceEvidenceRangeKey(range: SourceEvidenceRange): string {
  return `${range.chapterId}:${range.startSentenceIndex}:${range.endSentenceIndex}`;
}

function compareSourceEvidenceRanges(
  left: SourceEvidenceRange,
  right: SourceEvidenceRange,
  documentOrders: ReadonlyMap<number, number>,
  order: ArchiveFindOrder,
): number {
  const direction = order === "doc-asc" ? 1 : -1;

  return (
    (compareNumbers(
      documentOrders.get(left.chapterId) ?? left.chapterId,
      documentOrders.get(right.chapterId) ?? right.chapterId,
    ) ||
      compareNumbers(left.chapterId, right.chapterId) ||
      compareNumbers(left.startSentenceIndex, right.startSentenceIndex) ||
      compareNumbers(left.endSentenceIndex, right.endSentenceIndex)) * direction
  );
}

export async function createSourceEvidencePreview(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  limit: number,
  context: EvidenceReadContext = createEvidenceReadContext(),
  sourceContext = DEFAULT_SOURCE_CONTEXT,
  order: ArchiveFindOrder = "doc-asc",
  total?: number,
): Promise<ArchiveFindEvidencePreview> {
  return await createSortedRangeEvidencePreview(
    document,
    ranges,
    limit,
    context,
    sourceContext,
    order,
    total,
  );
}

async function sortSourceEvidenceRanges(
  document: ReadonlyDocument,
  ranges: readonly SourceEvidenceRange[],
  order: ArchiveFindOrder,
): Promise<readonly SourceEvidenceRange[]> {
  const documentOrders = await document.serials.listDocumentOrders();

  return [...ranges].sort((left, right) =>
    compareSourceEvidenceRanges(left, right, documentOrders, order),
  );
}
