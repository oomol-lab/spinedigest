import type {
  Document,
  IndexArtifactLexicalRow,
  ReadonlyDocument,
} from "../../../document/index.js";
import { listChapters } from "../../../document/chapter/index.js";
import {
  createSearchIndexFingerprint,
  finalizeStoredSearchIndexReplacement,
  insertFtsRecord,
  insertSearchObjectPropertyRecord,
  insertTextEmbeddingSegment,
  insertTextSentenceRecord,
  readSearchIndexStatus,
  SEARCH_OBJECT_PROPERTY_KIND,
  SEARCH_OBJECT_PROPERTY_OWNER_KIND,
  SINGLE_ARCHIVE_INDEX_ID,
  TEXT_SENTENCE_KIND,
  prepareSearchIndexReplacement,
  type SearchIndexInput,
  type SearchIndexBuildOptions,
  type SearchIndexStoredEmbeddingState,
  type SearchIndexProgressReporter,
  type SearchIndexWriteBatch,
} from "../../search-index/search/index.js";
import { createSearchTokenPlan } from "../../search-index/search/tokenizer.js";

const SEARCH_INDEX_REBUILD_ATTEMPTS = 2;
const ARCHIVE_INDEX_BATCH_RECORDS = 512;

export async function rebuildArchiveSearchIndex(
  document: Document,
  progress?: SearchIndexProgressReporter,
  _options: SearchIndexBuildOptions = {},
): Promise<void> {
  for (let attempt = 0; attempt < SEARCH_INDEX_REBUILD_ATTEMPTS; attempt += 1) {
    await assertArchiveIndexArtifactsReady(document);
    const input = await buildArchiveIndexProjection(document, progress);
    const fingerprint = createSearchIndexFingerprint(input);

    if ((await readSearchIndexStatus(document, input)) === "dirty") {
      const beforeDeleteInput = await buildArchiveIndexProjection(document);

      if (createSearchIndexFingerprint(beforeDeleteInput) !== fingerprint) {
        continue;
      }

      await document.deleteSearchIndexDatabase();
    }

    await writeArchiveIndexProjectionFromArtifacts(document, progress);

    const verifiedInput = await buildArchiveIndexProjection(document);
    if (
      createSearchIndexFingerprint(verifiedInput) === fingerprint &&
      (await readSearchIndexStatus(document, verifiedInput)) === "current"
    ) {
      return;
    }

    await document.deleteSearchIndexDatabase();
  }

  throw new Error("Archive changed while rebuilding search index; retry.");
}

export async function isArchiveSearchIndexCurrent(
  document: ReadonlyDocument,
): Promise<boolean> {
  return (await readArchiveSearchIndexStatus(document)) === "current";
}

export async function readArchiveSearchIndexStatus(
  document: ReadonlyDocument,
): Promise<"current" | "dirty" | "missing"> {
  try {
    await assertArchiveIndexArtifactsReady(document);
  } catch {
    return "dirty";
  }

  return await readSearchIndexStatus(
    document,
    await buildArchiveIndexProjection(document),
  );
}

export async function clearDirtyArchiveSearchIndex(
  document: Document,
): Promise<void> {
  if ((await readArchiveSearchIndexStatus(document)) === "dirty") {
    await document.deleteSearchIndexDatabase();
  }
}

export async function createArchiveSearchIndexFingerprint(
  document: ReadonlyDocument,
): Promise<string> {
  return createSearchIndexFingerprint(
    await buildArchiveIndexProjection(document),
  );
}

export async function buildArchiveIndexProjection(
  document: ReadonlyDocument,
  progress?: SearchIndexProgressReporter,
): Promise<SearchIndexInput> {
  const objectProperties: SearchIndexInput["objectProperties"][number][] = [];
  const textSentences: SearchIndexInput["textSentences"][number][] = [];

  for await (const batch of streamArchiveIndexProjection(
    document,
    SINGLE_ARCHIVE_INDEX_ID,
    progress,
  )) {
    objectProperties.push(...batch.objectProperties);
    textSentences.push(...batch.textSentences);
  }

  return { objectProperties, textSentences };
}

export async function assertArchiveIndexArtifactsReady(
  document: ReadonlyDocument,
): Promise<void> {
  const chapterIds = new Set(
    (await listChapters(document)).map((chapter) => chapter.chapterId),
  );
  const [ftsCoverage, sourceEmbeddingCoverage] = await Promise.all([
    document.indexArtifacts.listCoverage("fts"),
    document.indexArtifacts.listCoverage("embedding-source"),
  ]);
  const sourceEmbeddingBySerial = new Map(
    sourceEmbeddingCoverage.map((record) => [record.serialId, record]),
  );
  const blocked = ftsCoverage.filter(
    (record) =>
      chapterIds.has(record.serialId) &&
      !record.current &&
      sourceEmbeddingBySerial.get(record.serialId)?.current !== true,
  );

  if (blocked.length === 0) {
    return;
  }

  const serials = blocked.map((record) => record.serialId).join(", ");
  throw new Error(
    `Wiki Graph query is not ready. Chapters ${serials} need a current FTS artifact or source embedding artifact before query.`,
  );
}

export async function writeArchiveIndexProjectionFromArtifacts(
  document: Document,
  progress?: SearchIndexProgressReporter,
): Promise<void> {
  const chaptersRevision = await document.serials.getChaptersRevision();
  const fingerprint = createSearchIndexFingerprint(
    await buildArchiveIndexProjection(document),
  );
  const embeddingState = await readArchiveEmbeddingState(document);
  const hasFts = (await document.indexArtifacts.list("fts")).length > 0;

  await document.writeSearchIndexDatabase(async (database) => {
    await prepareSearchIndexReplacement(database, progress);

    let textDone = 0;
    let vectorDone = 0;

    for (const chapter of await listChapters(document)) {
      for (const record of await streamIndexArtifactProjectionRecords(
        document,
        SINGLE_ARCHIVE_INDEX_ID,
        chapter.chapterId,
      )) {
        if (record.kind === "text") {
          const rowId = await insertTextSentenceRecord(database, record.value);

          if (record.value.text !== "") {
            await insertFtsRecord(
              database,
              "text_sentence_fts",
              rowId,
              createSearchTokenPlan(record.value.text),
            );
          }
          textDone += 1;
          await progress?.({
            done: textDone,
            phase: "indexing-text",
            unit: "sentence",
          });
          continue;
        }

        const rowId = await insertSearchObjectPropertyRecord(
          database,
          record.value,
        );

        await insertFtsRecord(
          database,
          "search_object_properties_fts",
          rowId,
          createSearchTokenPlan(record.value.text),
        );
      }
    }

    for (const artifactKind of [
      "embedding-source",
      "embedding-summary",
    ] as const) {
      for (const artifact of await document.indexArtifacts.list(artifactKind)) {
        const segments = await document.indexArtifacts.listEmbeddingSegments(
          artifact.serialId,
          artifactKind,
        );
        const dimensions = readEmbeddingDimensions(artifact.metadata);
        const model = readEmbeddingModel(artifact.metadata);
        const label =
          artifactKind === "embedding-source" ? "Source" : "Summary";
        const textKind =
          artifactKind === "embedding-source"
            ? TEXT_SENTENCE_KIND.source
            : TEXT_SENTENCE_KIND.summary;

        if (
          segments.length > 0 &&
          (dimensions === undefined || model === undefined)
        ) {
          throw new Error(
            `${label} embedding artifact for chapter ${artifact.serialId} is missing embedding metadata.`,
          );
        }

        for (const segment of segments) {
          const vectorDimensions = dimensions ?? segment.vector.length;

          if (segment.vector.length !== vectorDimensions) {
            throw new Error(
              `${label} embedding artifact for chapter ${artifact.serialId} has ${segment.vector.length} dimensions; expected ${vectorDimensions}.`,
            );
          }
          for (
            let sentenceIndex = segment.startSentenceIndex;
            sentenceIndex <= segment.endSentenceIndex;
            sentenceIndex += 1
          ) {
            await insertTextSentenceRecord(database, {
              archiveId: SINGLE_ARCHIVE_INDEX_ID,
              chapterId: artifact.serialId,
              kind: textKind,
              sentenceIndex,
              text: "",
              wordsCount: 0,
            });
          }
          await insertTextEmbeddingSegment(database, {
            archiveId: SINGLE_ARCHIVE_INDEX_ID,
            chapterId: artifact.serialId,
            dimensions: vectorDimensions,
            endSentenceIndex: segment.endSentenceIndex,
            kind: textKind,
            model: model ?? "",
            startSentenceIndex: segment.startSentenceIndex,
            vector: segment.vector,
            wordsCount: segment.wordsCount,
          });
          vectorDone += 1;
          await progress?.({
            done: vectorDone,
            phase: "indexing-dense",
            unit: "vector",
          });
        }
      }
    }

    await finalizeStoredSearchIndexReplacement(database, {
      chaptersRevision,
      ...(embeddingState === undefined ? {} : { embedding: embeddingState }),
      fingerprint,
      hasFts,
      ...(progress === undefined ? {} : { progress }),
    });
  });
}

export async function* streamArchiveIndexProjection(
  document: ReadonlyDocument,
  archiveId: number,
  progress?: SearchIndexProgressReporter,
): AsyncIterable<SearchIndexWriteBatch> {
  const chapters = await listChapters(document);
  let chapterDone = 0;
  let batch = createEmptySearchIndexBatch();

  for (const chapter of chapters) {
    for (const record of await streamIndexArtifactProjectionRecords(
      document,
      archiveId,
      chapter.chapterId,
    )) {
      batch =
        record.kind === "text"
          ? appendTextSentence(batch, record.value)
          : appendObjectProperty(batch, record.value);
      if (countSearchIndexBatchRecords(batch) >= ARCHIVE_INDEX_BATCH_RECORDS) {
        yield batch;
        batch = createEmptySearchIndexBatch();
      }
    }

    chapterDone += 1;
    await progress?.({
      done: chapterDone,
      phase: "collecting",
      total: chapters.length,
      unit: "chapter",
    });
  }

  if (countSearchIndexBatchRecords(batch) > 0) {
    yield batch;
  }
}

async function streamIndexArtifactProjectionRecords(
  document: ReadonlyDocument,
  archiveId: number,
  serialId: number,
): Promise<
  readonly (
    | {
        readonly kind: "object";
        readonly value: SearchIndexWriteBatch["objectProperties"][number];
      }
    | {
        readonly kind: "text";
        readonly value: SearchIndexWriteBatch["textSentences"][number];
      }
  )[]
> {
  const records: (
    | {
        readonly kind: "object";
        readonly value: SearchIndexWriteBatch["objectProperties"][number];
      }
    | {
        readonly kind: "text";
        readonly value: SearchIndexWriteBatch["textSentences"][number];
      }
  )[] = [];

  for (const row of await document.indexArtifacts.listLexicalRows(
    serialId,
    "fts",
  )) {
    const textRecord = mapLexicalRowToTextSentence(archiveId, serialId, row);

    if (textRecord !== undefined) {
      records.push({ kind: "text", value: textRecord });
      continue;
    }

    const objectRecord = mapLexicalRowToObjectProperty(
      archiveId,
      serialId,
      row,
    );
    if (objectRecord !== undefined) {
      records.push({ kind: "object", value: objectRecord });
    }
  }

  for (const artifactKind of [
    "embedding-source",
    "embedding-summary",
  ] as const) {
    const artifact = await document.indexArtifacts.get(serialId, artifactKind);
    if (artifact === undefined) {
      continue;
    }
    const textKind =
      artifactKind === "embedding-source"
        ? TEXT_SENTENCE_KIND.source
        : TEXT_SENTENCE_KIND.summary;
    for (const segment of await document.indexArtifacts.listEmbeddingSegments(
      serialId,
      artifactKind,
    )) {
      for (
        let sentenceIndex = segment.startSentenceIndex;
        sentenceIndex <= segment.endSentenceIndex;
        sentenceIndex += 1
      ) {
        records.push({
          kind: "text",
          value: {
            archiveId,
            chapterId: serialId,
            kind: textKind,
            sentenceIndex,
            text: "",
            wordsCount: 0,
          },
        });
      }
    }
  }

  return records;
}

function mapLexicalRowToTextSentence(
  archiveId: number,
  serialId: number,
  row: IndexArtifactLexicalRow,
): SearchIndexWriteBatch["textSentences"][number] | undefined {
  if (
    row.objectKind !== "source-sentence" &&
    row.objectKind !== "summary-sentence"
  ) {
    return undefined;
  }
  if (row.sentenceIndex === undefined) {
    return undefined;
  }

  return {
    archiveId,
    chapterId: serialId,
    kind:
      row.objectKind === "source-sentence"
        ? TEXT_SENTENCE_KIND.source
        : TEXT_SENTENCE_KIND.summary,
    sentenceIndex: row.sentenceIndex,
    text: row.text,
    wordsCount: readWordsCount(row.metadata),
  };
}

function mapLexicalRowToObjectProperty(
  archiveId: number,
  serialId: number,
  row: IndexArtifactLexicalRow,
): SearchIndexWriteBatch["objectProperties"][number] | undefined {
  switch (row.objectKind) {
    case "chapter-title":
      return {
        archiveId,
        chapterId: serialId,
        ownerId: row.objectId,
        ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chapter,
        propertyKind: SEARCH_OBJECT_PROPERTY_KIND.title,
        text: row.text,
      };
    case "chunk-label":
      return {
        archiveId,
        chapterId: serialId,
        ownerId: row.objectId,
        ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
        propertyKind: SEARCH_OBJECT_PROPERTY_KIND.label,
        text: row.text,
      };
    case "chunk-content":
      return {
        archiveId,
        chapterId: serialId,
        ownerId: row.objectId,
        ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.chunk,
        propertyKind: SEARCH_OBJECT_PROPERTY_KIND.content,
        text: row.text,
      };
    case "mention-surface":
      return {
        archiveId,
        chapterId: serialId,
        ownerId: row.objectId,
        ownerKind: SEARCH_OBJECT_PROPERTY_OWNER_KIND.entity,
        propertyKind: SEARCH_OBJECT_PROPERTY_KIND.surface,
        text: row.text,
      };
    default:
      return undefined;
  }
}

function createEmptySearchIndexBatch(): SearchIndexWriteBatch {
  return { objectProperties: [], textSentences: [] };
}

function appendTextSentence(
  batch: SearchIndexWriteBatch,
  record: SearchIndexWriteBatch["textSentences"][number],
): SearchIndexWriteBatch {
  (
    batch.textSentences as SearchIndexWriteBatch["textSentences"][number][]
  ).push(record);
  return batch;
}

function appendObjectProperty(
  batch: SearchIndexWriteBatch,
  record: SearchIndexWriteBatch["objectProperties"][number],
): SearchIndexWriteBatch {
  (
    batch.objectProperties as SearchIndexWriteBatch["objectProperties"][number][]
  ).push(record);
  return batch;
}

function countSearchIndexBatchRecords(batch: SearchIndexWriteBatch): number {
  return batch.objectProperties.length + batch.textSentences.length;
}

async function readArchiveEmbeddingState(
  document: ReadonlyDocument,
): Promise<SearchIndexStoredEmbeddingState | undefined> {
  let state: SearchIndexStoredEmbeddingState | undefined;

  for (const artifactKind of [
    "embedding-source",
    "embedding-summary",
  ] as const) {
    for (const artifact of await document.indexArtifacts.list(artifactKind)) {
      const dimensions = readEmbeddingDimensions(artifact.metadata);
      const model = readEmbeddingModel(artifact.metadata);
      const label = artifactKind === "embedding-source" ? "Source" : "Summary";

      if (dimensions === undefined || model === undefined) {
        throw new Error(
          `${label} embedding artifact for chapter ${artifact.serialId} is missing embedding metadata.`,
        );
      }

      const identity = readEmbeddingIdentity(artifact.metadata);
      const next: SearchIndexStoredEmbeddingState = {
        dimensions,
        ...(identity === undefined ? {} : { identity }),
        model,
      };

      if (
        state !== undefined &&
        (state.dimensions !== next.dimensions ||
          state.model !== next.model ||
          state.identity !== next.identity)
      ) {
        throw new Error(
          "Embedding artifacts use different embedding providers or dimensions; rebuild them with one embeddings configuration.",
        );
      }
      state = next;
    }
  }

  return state;
}

function readWordsCount(metadata: Readonly<Record<string, unknown>>): number {
  const value = metadata.wordsCount;

  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readEmbeddingDimensions(
  metadata: Readonly<Record<string, unknown>>,
): number | undefined {
  const value = metadata.dimensions;

  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}

function readEmbeddingIdentity(
  metadata: Readonly<Record<string, unknown>>,
): string | undefined {
  const value = metadata.identity;

  return typeof value === "string" && value !== "" ? value : undefined;
}

function readEmbeddingModel(
  metadata: Readonly<Record<string, unknown>>,
): string | undefined {
  const value = metadata.model;

  return typeof value === "string" && value !== "" ? value : undefined;
}
