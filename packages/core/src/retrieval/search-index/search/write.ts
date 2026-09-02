import { binary as platformBinary } from "../../../runtime/platform/index.js";
import { getNumber, type Database } from "../../../document/database.js";
import { serializeTokens } from "./helpers.js";
import type { SearchTokenPlan } from "./tokenizer.js";
import type {
  SearchObjectPropertyRecordInput,
  TextSentenceRecordInput,
} from "./types.js";

export async function insertTextSentenceRecord(
  database: Database,
  record: TextSentenceRecordInput,
): Promise<number> {
  const rowId = await database.queryOne(
    `
      SELECT id
      FROM text_sentence_records
      WHERE archive_id = ? AND kind = ? AND chapter_id = ? AND sentence_index = ?
    `,
    [record.archiveId, record.kind, record.chapterId, record.sentenceIndex],
    (row) => getNumber(row, "id"),
  );

  if (rowId !== undefined) {
    return rowId;
  }

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

export async function insertSearchObjectPropertyRecord(
  database: Database,
  record: SearchObjectPropertyRecordInput,
): Promise<number> {
  await database.run(
    `
      INSERT INTO search_object_properties_records (
        archive_id, owner_kind, owner_id, property_kind, chapter_id
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      record.archiveId,
      record.ownerKind,
      record.ownerId,
      record.propertyKind,
      record.chapterId ?? null,
    ],
  );

  return await database.getLastInsertRowId();
}

export async function insertFtsRecord(
  database: Database,
  table: "search_object_properties_fts" | "text_sentence_fts",
  rowId: number,
  plan: SearchTokenPlan,
): Promise<void> {
  await database.run(
    `
      INSERT INTO ${table}(rowid, tier1, tier2, tier3)
      VALUES (?, ?, ?, ?)
    `,
    [
      rowId,
      serializeTokens(plan.tier1),
      serializeTokens(plan.tier2),
      serializeTokens(plan.tier3),
    ],
  );
}

export async function insertTextEmbeddingSegment(
  database: Database,
  record: {
    readonly archiveId: number;
    readonly chapterId: number;
    readonly dimensions: number;
    readonly endSentenceIndex: number;
    readonly kind: number;
    readonly model: string;
    readonly startSentenceIndex: number;
    readonly vector: readonly number[];
    readonly wordsCount: number;
  },
): Promise<void> {
  await database.run(
    `
      INSERT INTO text_embedding_segments (
        archive_id, kind, chapter_id, start_sentence_index, end_sentence_index,
        words_count, model, dimensions, vector
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      record.archiveId,
      record.kind,
      record.chapterId,
      record.startSentenceIndex,
      record.endSentenceIndex,
      record.wordsCount,
      record.model,
      record.dimensions,
      serializeFloat32Vector(record.vector),
    ],
  );
}

export function deserializeFloat32Vector(
  buffer: platformBinary,
): readonly number[] {
  const vector: number[] = [];

  for (let offset = 0; offset < buffer.length; offset += 4) {
    vector.push(buffer.readFloatLE(offset));
  }

  return vector;
}

function serializeFloat32Vector(vector: readonly number[]): platformBinary {
  const buffer = platformBinary.alloc(vector.length * 4);

  for (const [index, value] of vector.entries()) {
    buffer.writeFloatLE(value, index * 4);
  }

  return buffer;
}
