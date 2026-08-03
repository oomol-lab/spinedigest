import type { Database } from "../../../document/database.js";
import type { Document } from "../../../document/index.js";
import { createSearchTokenPlan } from "./tokenizer.js";
import { createSearchIndexFingerprint } from "./fingerprint.js";
import {
  insertFtsRecord,
  insertTextSentenceEmbedding,
  insertSearchObjectPropertyRecord,
  insertTextSentenceRecord,
} from "./write.js";
import type {
  SearchIndexBuildOptions,
  SearchIndexEmbeddingProvider,
  SearchIndexInput,
  SearchIndexProgressReporter,
  SearchIndexSelection,
} from "./types.js";
import { SEARCH_INDEX_VERSION } from "./types.js";

export type ArchiveIndexProjection = SearchIndexInput;
export type SearchIndexWriteBatch = SearchIndexInput;
export interface SearchIndexWriteCounters {
  readonly denseDone: number;
  readonly objectDone: number;
  readonly textDone: number;
}

export async function writeArchiveIndexProjection(
  document: Document,
  projection: ArchiveIndexProjection,
  progress?: SearchIndexProgressReporter,
  options: SearchIndexBuildOptions = {},
): Promise<void> {
  await replaceSearchIndex(
    document,
    (async function* (): AsyncIterable<SearchIndexWriteBatch> {
      await Promise.resolve();
      yield projection;
    })(),
    createSearchIndexFingerprint(projection),
    progress,
    options,
  );
}

export async function ensureSearchIndex(
  document: Document,
  input: SearchIndexInput,
  progress?: SearchIndexProgressReporter,
  options: SearchIndexBuildOptions = {},
): Promise<void> {
  const chaptersRevision = await document.serials.getChaptersRevision();
  const resolved = resolveSearchIndexBuildOptions(options);

  await document.writeSearchIndexDatabase(async (database) => {
    const fingerprint = createSearchIndexFingerprint(input);

    await database.transaction(async () => {
      await progress?.({ phase: "clearing" });
      await database.run("DELETE FROM text_sentence_fts");
      await database.run("DELETE FROM text_sentence_embeddings");
      await database.run("DELETE FROM search_object_properties_fts");
      await database.run("DELETE FROM text_sentence_records");
      await database.run("DELETE FROM search_object_properties_records");
      await database.run("DELETE FROM index_dirty_chapters");
      await database.run("DELETE FROM search_index_state");

      let textDone = 0;
      const textSentenceRows: {
        readonly rowId: number;
        readonly text: string;
      }[] = [];
      for (const record of input.textSentences) {
        const plan = createSearchTokenPlan(record.text);
        const rowId = await insertTextSentenceRecord(database, record);

        await insertFtsRecord(database, "text_sentence_fts", rowId, plan);
        textSentenceRows.push({ rowId, text: record.text });
        textDone += 1;
        await progress?.({
          done: textDone,
          phase: "indexing-text",
          total: input.textSentences.length,
          unit: "sentence",
        });
      }

      if (resolved.indexes === "fts,dense") {
        await writeTextSentenceEmbeddings(database, textSentenceRows, {
          doneOffset: 0,
          embeddingProvider: resolved.embeddingProvider,
          ...(progress === undefined ? {} : { progress }),
        });
      }

      let objectDone = 0;
      for (const record of input.objectProperties) {
        const plan = createSearchTokenPlan(record.text);
        const rowId = await insertSearchObjectPropertyRecord(database, record);

        await insertFtsRecord(
          database,
          "search_object_properties_fts",
          rowId,
          plan,
        );
        objectDone += 1;
        await progress?.({
          done: objectDone,
          phase: "indexing-objects",
          total: input.objectProperties.length,
          unit: "object",
        });
      }

      await progress?.({ phase: "finalizing" });
      await database.run(
        `
          INSERT INTO search_index_state(key, value)
          VALUES ('version', ?)
        `,
        [SEARCH_INDEX_VERSION],
      );
      await database.run(
        `
          INSERT INTO search_index_state(key, value)
          VALUES ('fingerprint', ?)
        `,
        [fingerprint],
      );
      await database.run(
        `
          INSERT INTO search_index_state(key, value)
          VALUES ('chaptersRevision', ?)
        `,
        [String(chaptersRevision)],
      );
      await writeSearchIndexBuildState(database, resolved.indexes, resolved);
    });
  });
}

export async function replaceSearchIndex(
  document: Document,
  batches: AsyncIterable<SearchIndexWriteBatch>,
  fingerprint: string,
  progress?: SearchIndexProgressReporter,
  options: SearchIndexBuildOptions = {},
): Promise<void> {
  const chaptersRevision = await document.serials.getChaptersRevision();
  const resolved = resolveSearchIndexBuildOptions(options);

  await document.writeSearchIndexDatabase(async (database) => {
    await prepareSearchIndexReplacement(database, progress);

    let counters: SearchIndexWriteCounters = {
      denseDone: 0,
      objectDone: 0,
      textDone: 0,
    };
    for await (const batch of batches) {
      counters = await writeSearchIndexBatch(
        database,
        batch,
        counters,
        progress,
        resolved,
      );
    }

    await finalizeSearchIndexReplacement(
      database,
      fingerprint,
      chaptersRevision,
      progress,
      resolved.indexes,
      resolved,
    );
  });
}

export async function prepareSearchIndexReplacement(
  database: Database,
  progress?: SearchIndexProgressReporter,
): Promise<void> {
  await database.transaction(async () => {
    await progress?.({ phase: "clearing" });
    await database.run("DELETE FROM text_sentence_fts");
    await database.run("DELETE FROM text_sentence_embeddings");
    await database.run("DELETE FROM search_object_properties_fts");
    await database.run("DELETE FROM text_sentence_records");
    await database.run("DELETE FROM search_object_properties_records");
    await database.run("DELETE FROM index_dirty_chapters");
    await database.run("DELETE FROM search_index_state");
    await database.run(
      `
        INSERT INTO index_dirty_chapters(archive_id, chapter_id, updated_at)
        VALUES (0, 0, ?)
      `,
      [Date.now()],
    );
  });
}

export async function writeSearchIndexBatch(
  database: Database,
  batch: SearchIndexWriteBatch,
  counters: SearchIndexWriteCounters,
  progress?: SearchIndexProgressReporter,
  options: SearchIndexBuildOptions = {},
): Promise<SearchIndexWriteCounters> {
  const resolved = resolveSearchIndexBuildOptions(options);
  let { denseDone, objectDone, textDone } = counters;

  const sentenceRecords: {
    readonly rowId: number;
    readonly text: string;
  }[] = [];

  await database.transaction(async () => {
    for (const record of batch.textSentences) {
      const plan = createSearchTokenPlan(record.text);
      const rowId = await insertReplacementTextSentenceRecord(database, record);

      await insertFtsRecord(database, "text_sentence_fts", rowId, plan);
      sentenceRecords.push({ rowId, text: record.text });
      textDone += 1;
      await progress?.({
        done: textDone,
        phase: "indexing-text",
        unit: "sentence",
      });
    }

    for (const record of batch.objectProperties) {
      const plan = createSearchTokenPlan(record.text);
      const rowId = await insertSearchObjectPropertyRecord(database, record);

      await insertFtsRecord(
        database,
        "search_object_properties_fts",
        rowId,
        plan,
      );
      objectDone += 1;
      await progress?.({
        done: objectDone,
        phase: "indexing-objects",
        unit: "object",
      });
    }
  });

  if (resolved.indexes === "fts,dense") {
    denseDone = await writeTextSentenceEmbeddings(database, sentenceRecords, {
      doneOffset: denseDone,
      embeddingProvider: resolved.embeddingProvider,
      ...(progress === undefined ? {} : { progress }),
    });
  }

  return { denseDone, objectDone, textDone };
}

async function insertReplacementTextSentenceRecord(
  database: Database,
  record: SearchIndexWriteBatch["textSentences"][number],
): Promise<number> {
  await database.run(
    `
      INSERT INTO text_sentence_records (
        archive_id, kind, chapter_id, sentence_index, words_count, byte_offset, byte_length
      )
      VALUES (?, ?, ?, ?, ?, 0, 0)
    `,
    [
      record.archiveId,
      record.kind,
      record.chapterId,
      record.sentenceIndex,
      record.wordsCount,
    ],
  );

  return await database.getLastInsertRowId();
}

export async function finalizeSearchIndexReplacement(
  database: Database,
  fingerprint: string,
  chaptersRevision: number,
  progress?: SearchIndexProgressReporter,
  indexes?: SearchIndexSelection,
  options: SearchIndexBuildOptions = {},
): Promise<void> {
  const resolved = resolveSearchIndexBuildOptions(
    indexes === undefined ? options : { ...options, indexes },
  );

  await database.transaction(async () => {
    await progress?.({ phase: "finalizing" });
    await database.run("DELETE FROM index_dirty_chapters");
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('version', ?)
      `,
      [SEARCH_INDEX_VERSION],
    );
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('fingerprint', ?)
      `,
      [fingerprint],
    );
    await database.run(
      `
        INSERT INTO search_index_state(key, value)
        VALUES ('chaptersRevision', ?)
      `,
      [String(chaptersRevision)],
    );
    await writeSearchIndexBuildState(database, resolved.indexes, resolved);
  });
}

type ResolvedSearchIndexBuildOptions =
  | {
      readonly indexes: "fts";
    }
  | {
      readonly embeddingProvider: SearchIndexEmbeddingProvider;
      readonly indexes: "fts,dense";
    };

function resolveSearchIndexBuildOptions(
  options: SearchIndexBuildOptions,
): ResolvedSearchIndexBuildOptions {
  switch (options.indexes ?? "auto") {
    case "fts":
      return { indexes: "fts" };
    case "fts,dense": {
      if (options.embeddingProvider === undefined) {
        throw new Error(
          "Embeddings configuration is required for --indexes fts,dense.",
        );
      }
      return {
        embeddingProvider: options.embeddingProvider,
        indexes: "fts,dense",
      };
    }
    case "auto":
      return options.embeddingProvider === undefined
        ? { indexes: "fts" }
        : {
            embeddingProvider: options.embeddingProvider,
            indexes: "fts,dense",
          };
  }
}

async function writeTextSentenceEmbeddings(
  database: Database,
  records: readonly { readonly rowId: number; readonly text: string }[],
  input: {
    readonly doneOffset: number;
    readonly embeddingProvider: SearchIndexEmbeddingProvider;
    readonly progress?: SearchIndexProgressReporter;
  },
): Promise<number> {
  if (records.length === 0) {
    return input.doneOffset;
  }

  const result = await input.embeddingProvider.embedTexts(
    records.map((record) => record.text),
  );

  if (result.embeddings.length !== records.length) {
    throw new Error(
      `Embedding provider returned ${result.embeddings.length} vectors for ${records.length} texts.`,
    );
  }

  let done = input.doneOffset;
  for (const [index, record] of records.entries()) {
    const vector = result.embeddings[index]!;
    const dimensions =
      input.embeddingProvider.dimensions ?? result.embeddings[index]!.length;

    if (vector.length !== dimensions) {
      throw new Error(
        `Embedding provider returned ${vector.length} dimensions; expected ${dimensions}.`,
      );
    }

    await insertTextSentenceEmbedding(database, {
      dimensions,
      model: input.embeddingProvider.model,
      sentenceRecordId: record.rowId,
      vector,
    });
    done += 1;
    await input.progress?.({
      done,
      phase: "indexing-dense",
      unit: "vector",
    });
  }

  return done;
}

async function writeSearchIndexBuildState(
  database: Database,
  indexes: SearchIndexSelection,
  options: ResolvedSearchIndexBuildOptions,
): Promise<void> {
  await database.run(
    `
      INSERT INTO search_index_state(key, value)
      VALUES ('indexes', ?)
    `,
    [indexes],
  );
  if (options.indexes !== "fts,dense") {
    return;
  }
  await database.run(
    `
      INSERT INTO search_index_state(key, value)
      VALUES ('embeddingModel', ?)
    `,
    [options.embeddingProvider.model],
  );
  await database.run(
    `
      INSERT INTO search_index_state(key, value)
      VALUES ('embeddingDimensions', ?)
    `,
    [String(options.embeddingProvider.dimensions ?? "")],
  );
}
