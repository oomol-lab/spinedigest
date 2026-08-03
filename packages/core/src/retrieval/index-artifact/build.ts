import type {
  Document,
  IndexArtifactEmbeddingSegment,
  IndexArtifactLexicalRow,
  ReadonlyDocument,
  ReplaceEmbeddingIndexArtifactInput,
  ReplaceFtsIndexArtifactInput,
  SentenceRecord,
} from "../../document/index.js";
import type { TocItem } from "../../text/source/index.js";
import {
  DENSE_SEGMENT_MAX_WORDS,
  DENSE_SEGMENT_MIN_WORDS,
  DENSE_SEGMENT_OVERLAP_WORDS,
  DENSE_SEGMENT_TARGET_WORDS,
  type SearchIndexEmbeddingProvider,
} from "../search-index/index.js";
import { createSearchTokenPlan } from "../search-index/search/tokenizer.js";

export type EmbeddingIndexArtifactKind =
  | "embedding-source"
  | "embedding-summary";

export async function replaceChapterFtsIndexArtifact(
  document: Document,
  serialId: number,
): Promise<void> {
  const artifact = await buildChapterFtsIndexArtifact(document, serialId);

  await document.indexArtifacts.replaceFts(artifact);
}

export async function refreshChapterFtsIndexArtifactIfPresent(
  document: Document,
  serialId: number,
): Promise<void> {
  if ((await document.indexArtifacts.get(serialId, "fts")) === undefined) {
    return;
  }

  await replaceChapterFtsIndexArtifact(document, serialId);
}

export async function replaceChapterSourceEmbeddingIndexArtifact(
  document: Document,
  serialId: number,
  embeddingProvider: SearchIndexEmbeddingProvider,
): Promise<void> {
  const artifact = await buildChapterEmbeddingIndexArtifact(document, {
    embeddingProvider,
    kind: "embedding-source",
    serialId,
  });

  await document.indexArtifacts.replaceEmbedding(artifact);
}

export async function replaceChapterSummaryEmbeddingIndexArtifact(
  document: Document,
  serialId: number,
  embeddingProvider: SearchIndexEmbeddingProvider,
): Promise<void> {
  const artifact = await buildChapterEmbeddingIndexArtifact(document, {
    embeddingProvider,
    kind: "embedding-summary",
    serialId,
  });

  await document.indexArtifacts.replaceEmbedding(artifact);
}

export async function buildChapterFtsIndexArtifact(
  document: ReadonlyDocument,
  serialId: number,
): Promise<ReplaceFtsIndexArtifactInput> {
  const sourceRevision = await document.serials.getRevision(serialId);
  const sentences = await listTextStreamSentences(
    document.getSerialFragments(serialId),
  );
  const summarySentences = await listTextStreamSentences(
    document.getSummaryFragments(serialId),
  );

  return createFtsIndexArtifactInput({
    chapterTitles: await readChapterTitles(document, serialId),
    chunks: await document.chunks.listBySerial(serialId),
    mentions: await document.mentions.listByChapter(serialId),
    sentences,
    serialId,
    sourceRevision,
    summarySentences,
  });
}

export function createFtsIndexArtifactInput(input: {
  readonly chapterTitles?: readonly {
    readonly id: number;
    readonly title: string;
  }[];
  readonly chunks?: readonly {
    readonly content: string;
    readonly id: number;
    readonly label: string;
    readonly wordsCount: number;
  }[];
  readonly mentions?: readonly {
    readonly id: string;
    readonly qid: string;
    readonly surface: string;
  }[];
  readonly sentences: readonly SentenceRecord[];
  readonly serialId: number;
  readonly sourceRevision: number;
  readonly summarySentences?: readonly SentenceRecord[];
}): ReplaceFtsIndexArtifactInput {
  return {
    lexicalRows: [
      ...(input.chapterTitles ?? []).map((chapter) =>
        createObjectLexicalRow({
          objectId: String(chapter.id),
          objectKind: "chapter-title",
          rowId: `chapter-title:${chapter.id}`,
          text: chapter.title,
        }),
      ),
      ...input.sentences.map((sentence, sentenceIndex) =>
        createTextSentenceLexicalRow({
          objectKind: "source-sentence",
          rowPrefix: "source-sentence",
          sentence,
          sentenceIndex,
          serialId: input.serialId,
        }),
      ),
      ...(input.summarySentences ?? []).map((sentence, sentenceIndex) =>
        createTextSentenceLexicalRow({
          objectKind: "summary-sentence",
          rowPrefix: "summary-sentence",
          sentence,
          sentenceIndex,
          serialId: input.serialId,
        }),
      ),
      ...(input.chunks ?? []).flatMap((chunk) => [
        createObjectLexicalRow({
          metadata: { wordsCount: chunk.wordsCount },
          objectId: String(chunk.id),
          objectKind: "chunk-label",
          rowId: `chunk-label:${chunk.id}`,
          text: chunk.label,
        }),
        createObjectLexicalRow({
          metadata: { wordsCount: chunk.wordsCount },
          objectId: String(chunk.id),
          objectKind: "chunk-content",
          rowId: `chunk-content:${chunk.id}`,
          text: chunk.content,
        }),
      ]),
      ...(input.mentions ?? []).map((mention) =>
        createObjectLexicalRow({
          objectId: mention.qid,
          objectKind: "mention-surface",
          rowId: `mention-surface:${mention.id}`,
          text: mention.surface,
        }),
      ),
    ],
    metadata: {
      source: "chapter-lexical",
      version: 1,
    },
    serialId: input.serialId,
    sourceRevision: input.sourceRevision,
  };
}

export async function buildChapterEmbeddingIndexArtifact(
  document: ReadonlyDocument,
  input: {
    readonly embeddingProvider: SearchIndexEmbeddingProvider;
    readonly kind: EmbeddingIndexArtifactKind;
    readonly serialId: number;
  },
): Promise<ReplaceEmbeddingIndexArtifactInput> {
  const sourceRevision = await document.serials.getRevision(input.serialId);
  const sentences =
    input.kind === "embedding-source"
      ? await listTextStreamSentences(
          document.getSerialFragments(input.serialId),
        )
      : await listTextStreamSentences(
          document.getSummaryFragments(input.serialId),
        );
  return await createEmbeddingIndexArtifactInput({
    embeddingProvider: input.embeddingProvider,
    kind: input.kind,
    sentences,
    serialId: input.serialId,
    sourceRevision,
  });
}

export async function createEmbeddingIndexArtifactInput(input: {
  readonly embeddingProvider: SearchIndexEmbeddingProvider;
  readonly kind: EmbeddingIndexArtifactKind;
  readonly sentences: readonly SentenceRecord[];
  readonly serialId: number;
  readonly signal?: AbortSignal;
  readonly sourceRevision: number;
}): Promise<ReplaceEmbeddingIndexArtifactInput> {
  const segments = createEmbeddingSegments(input.sentences);
  const embeddings =
    segments.length === 0
      ? []
      : (
          await input.embeddingProvider.embedTexts(
            segments.map((segment) => segment.text),
            input.signal === undefined ? undefined : { signal: input.signal },
          )
        ).embeddings;

  if (embeddings.length !== segments.length) {
    throw new Error(
      `Embedding provider returned ${embeddings.length} vectors for ${segments.length} segments.`,
    );
  }

  const dimensions =
    input.embeddingProvider.dimensions ?? embeddings[0]?.length ?? 0;

  if (segments.length > 0 && dimensions <= 0) {
    throw new Error("Embedding provider returned no usable vector dimensions.");
  }

  return {
    kind: input.kind,
    metadata: {
      dimensions,
      ...(input.embeddingProvider.identity === undefined
        ? {}
        : { identity: input.embeddingProvider.identity }),
      model: input.embeddingProvider.model,
      version: 1,
    },
    segments: segments.map((segment, index) => {
      const vector = embeddings[index] ?? [];

      if (vector.length !== dimensions) {
        throw new Error(
          `Embedding provider returned ${vector.length} dimensions; expected ${dimensions}.`,
        );
      }

      return {
        ...segment,
        vector,
      };
    }),
    serialId: input.serialId,
    sourceRevision: input.sourceRevision,
  };
}

function createTextSentenceLexicalRow(input: {
  readonly objectKind: "source-sentence" | "summary-sentence";
  readonly rowPrefix: string;
  readonly sentence: SentenceRecord;
  readonly sentenceIndex: number;
  readonly serialId: number;
}): IndexArtifactLexicalRow {
  const sentence = input.sentence;
  const plan = createSearchTokenPlan(sentence.text);
  const tiers = {
    tier1: plan.tier1.map((token) => token.encoded),
    tier2: plan.tier2.map((token) => token.encoded),
    tier3: plan.tier3.map((token) => token.encoded),
  };

  return {
    metadata: { tiers, wordsCount: sentence.wordsCount },
    objectId: `${input.serialId}:${input.sentenceIndex}`,
    objectKind: input.objectKind,
    rowId: `${input.rowPrefix}:${input.sentenceIndex}`,
    sentenceIndex: input.sentenceIndex,
    text: sentence.text,
    tokens: [...tiers.tier1, ...tiers.tier2, ...tiers.tier3],
  };
}

function createObjectLexicalRow(input: {
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly objectId: string;
  readonly objectKind: string;
  readonly rowId: string;
  readonly text: string;
}): IndexArtifactLexicalRow {
  const plan = createSearchTokenPlan(input.text);
  const tiers = {
    tier1: plan.tier1.map((token) => token.encoded),
    tier2: plan.tier2.map((token) => token.encoded),
    tier3: plan.tier3.map((token) => token.encoded),
  };

  return {
    metadata: { ...(input.metadata ?? {}), tiers },
    objectId: input.objectId,
    objectKind: input.objectKind,
    rowId: input.rowId,
    text: input.text,
    tokens: [...tiers.tier1, ...tiers.tier2, ...tiers.tier3],
  };
}

async function listTextStreamSentences(stream: {
  readonly listSentences?: () => Promise<readonly SentenceRecord[]>;
}): Promise<readonly SentenceRecord[]> {
  if (stream.listSentences === undefined) {
    throw new Error("Text stream does not expose sentence listing.");
  }

  return await stream.listSentences();
}

async function readChapterTitles(
  document: ReadonlyDocument,
  serialId: number,
): Promise<readonly { readonly id: number; readonly title: string }[]> {
  const toc = await readDocumentToc(document);
  if (toc === undefined) {
    return [];
  }

  const items = collectTocItems(toc.items);
  const chapter = items.find((item) => item.serialId === serialId);

  if (chapter === undefined || typeof chapter.title !== "string") {
    return [];
  }

  return [{ id: serialId, title: chapter.title }];
}

async function readDocumentToc(
  document: ReadonlyDocument,
): Promise<{ readonly items: readonly TocItem[] } | undefined> {
  const reader = document as ReadonlyDocument & {
    readonly readToc?: () => Promise<
      { readonly items: readonly TocItem[] } | undefined
    >;
  };

  return await reader.readToc?.();
}

function collectTocItems(items: readonly TocItem[]): readonly TocItem[] {
  return items.flatMap((item) => [item, ...collectTocItems(item.children)]);
}

function createEmbeddingSegments(
  sentences: readonly SentenceRecord[],
): readonly Omit<IndexArtifactEmbeddingSegment, "vector">[] {
  assertDenseSegmentConstants();
  const records = sentences
    .map((sentence, sentenceIndex) => ({
      sentenceIndex,
      text: sentence.text,
      wordsCount: requireNonNegativeWordsCount(sentence.wordsCount),
    }))
    .filter((record) => record.text.trim() !== "");
  const segments: Omit<IndexArtifactEmbeddingSegment, "vector">[] = [];
  let start = 0;

  while (start < records.length) {
    let end = start;
    let wordsCount = 0;

    while (end < records.length) {
      const nextWords = Math.max(0, records[end]!.wordsCount);

      if (
        end > start &&
        wordsCount >= DENSE_SEGMENT_MIN_WORDS &&
        wordsCount + nextWords > DENSE_SEGMENT_MAX_WORDS
      ) {
        break;
      }
      wordsCount += nextWords;
      end += 1;
      if (wordsCount >= DENSE_SEGMENT_TARGET_WORDS) {
        break;
      }
    }

    const segmentRecords = records.slice(start, end);
    const segment = createEmbeddingSegment(segmentRecords, segments.length);

    if (segment.wordsCount < DENSE_SEGMENT_MIN_WORDS && segments.length > 0) {
      const previous = segments.pop()!;
      const mergedRecords = records.filter(
        (record) =>
          record.sentenceIndex >= previous.startSentenceIndex &&
          record.sentenceIndex <= segment.endSentenceIndex,
      );

      segments.push(createEmbeddingSegment(mergedRecords, segments.length));
      break;
    }

    segments.push(segment);

    if (end >= records.length) {
      break;
    }
    const nextStart = findSegmentOverlapStart(records, start, end);

    start = nextStart <= start ? end : nextStart;
  }

  return segments.map((segment, segmentIndex) => ({
    ...segment,
    segmentIndex,
  }));
}

function assertDenseSegmentConstants(): void {
  if (
    DENSE_SEGMENT_MIN_WORDS < 0 ||
    DENSE_SEGMENT_OVERLAP_WORDS < 0 ||
    DENSE_SEGMENT_TARGET_WORDS < DENSE_SEGMENT_MIN_WORDS ||
    DENSE_SEGMENT_MAX_WORDS < DENSE_SEGMENT_TARGET_WORDS
  ) {
    throw new Error("Invalid Dense segment word-count configuration.");
  }
}

function requireNonNegativeWordsCount(wordsCount: number): number {
  if (!Number.isFinite(wordsCount) || wordsCount < 0) {
    throw new Error("Sentence word count must be non-negative.");
  }

  return wordsCount;
}

function createEmbeddingSegment(
  records: readonly {
    readonly sentenceIndex: number;
    readonly text: string;
    readonly wordsCount: number;
  }[],
  segmentIndex: number,
): Omit<IndexArtifactEmbeddingSegment, "vector"> {
  const first = records[0];
  const last = records.at(-1);

  if (first === undefined || last === undefined) {
    throw new Error("Cannot create an empty embedding segment.");
  }

  return {
    endSentenceIndex: last.sentenceIndex,
    segmentIndex,
    startSentenceIndex: first.sentenceIndex,
    text: records.map((record) => record.text).join("\n"),
    wordsCount: records.reduce((sum, record) => sum + record.wordsCount, 0),
  };
}

function findSegmentOverlapStart(
  records: readonly {
    readonly wordsCount: number;
  }[],
  start: number,
  end: number,
): number {
  let wordsCount = 0;

  for (let index = end - 1; index > start; index -= 1) {
    wordsCount += Math.max(0, records[index]!.wordsCount);
    if (wordsCount >= DENSE_SEGMENT_OVERLAP_WORDS) {
      return index;
    }
  }

  return end;
}
