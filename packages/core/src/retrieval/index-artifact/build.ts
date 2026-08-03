import type {
  Document,
  IndexArtifactEmbeddingSegment,
  IndexArtifactLexicalRow,
  ReadonlyDocument,
  ReplaceEmbeddingIndexArtifactInput,
  ReplaceFtsIndexArtifactInput,
  SentenceRecord,
} from "../../document/index.js";
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

  return createFtsIndexArtifactInput({
    sentences,
    serialId,
    sourceRevision,
  });
}

export function createFtsIndexArtifactInput(input: {
  readonly sentences: readonly SentenceRecord[];
  readonly serialId: number;
  readonly sourceRevision: number;
}): ReplaceFtsIndexArtifactInput {
  return {
    lexicalRows: input.sentences.map((sentence, sentenceIndex) =>
      createSourceSentenceLexicalRow(input.serialId, sentenceIndex, sentence),
    ),
    metadata: {
      source: "source",
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
  readonly sourceRevision: number;
}): Promise<ReplaceEmbeddingIndexArtifactInput> {
  const segments = createEmbeddingSegments(input.sentences);
  const embeddings =
    segments.length === 0
      ? []
      : (
          await input.embeddingProvider.embedTexts(
            segments.map((segment) => segment.text),
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

function createSourceSentenceLexicalRow(
  serialId: number,
  sentenceIndex: number,
  sentence: SentenceRecord,
): IndexArtifactLexicalRow {
  const plan = createSearchTokenPlan(sentence.text);
  const tiers = {
    tier1: plan.tier1.map((token) => token.encoded),
    tier2: plan.tier2.map((token) => token.encoded),
    tier3: plan.tier3.map((token) => token.encoded),
  };

  return {
    metadata: { tiers, wordsCount: sentence.wordsCount },
    objectId: `${serialId}:${sentenceIndex}`,
    objectKind: "source-sentence",
    rowId: `source-sentence:${sentenceIndex}`,
    sentenceIndex,
    text: sentence.text,
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

function createEmbeddingSegments(
  sentences: readonly SentenceRecord[],
): readonly Omit<IndexArtifactEmbeddingSegment, "vector">[] {
  const records = sentences
    .map((sentence, sentenceIndex) => ({
      sentenceIndex,
      text: sentence.text,
      wordsCount: sentence.wordsCount,
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

    if (end <= start) {
      end = start + 1;
      wordsCount = Math.max(0, records[start]!.wordsCount);
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
