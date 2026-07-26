import type { Database } from "../database.js";
import { getNumber, getString } from "../database.js";
import type { MentionRecord } from "../types.js";
import { escapeLikePattern, mapMentionRow } from "./helpers.js";
import type { ReadonlyMentionStore } from "./types.js";

export class MentionStore implements ReadonlyMentionStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(record: MentionRecord): Promise<void> {
    await this.#database.run(
      `
        INSERT OR REPLACE INTO mentions (
          id,
          chapter_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.chapterId,
        record.sentenceIndex ?? null,
        record.rangeStart,
        record.rangeEnd,
        record.surface,
        record.qid,
        record.confidence ?? null,
        record.note ?? null,
      ],
    );
  }

  public async saveMany(records: readonly MentionRecord[]): Promise<void> {
    await this.#database.transaction(async () => {
      for (const record of records) {
        await this.save(record);
      }
    });
  }

  public async getById(mentionId: string): Promise<MentionRecord | undefined> {
    return await this.#database.queryOne(
      `
        SELECT
          id,
          chapter_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        WHERE id = ?
      `,
      [mentionId],
      mapMentionRow,
    );
  }

  public async listAll(): Promise<MentionRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT
          id,
          chapter_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        ORDER BY chapter_id, sentence_index, range_start, range_end, id
      `,
      undefined,
      mapMentionRow,
    );
  }

  public async countByQid(
    qid: string,
    options: { readonly chapterId?: number } = {},
  ): Promise<number> {
    return (
      (await this.#database.queryOne(
        `
          SELECT count(*) AS count
          FROM mentions
          WHERE qid = ?
          ${options.chapterId === undefined ? "" : "AND chapter_id = ?"}
        `,
        options.chapterId === undefined ? [qid] : [qid, options.chapterId],
        (row) => getNumber(row, "count"),
      )) ?? 0
    );
  }

  public async listByQid(
    qid: string,
    options: {
      readonly chapterId?: number;
      readonly limit?: number;
      readonly offset?: number;
      readonly order?: "asc" | "desc";
    } = {},
  ): Promise<MentionRecord[]> {
    const direction = options.order === "desc" ? "DESC" : "ASC";

    return await this.#database.queryAll(
      `
        SELECT
          mentions.id AS id,
          mentions.chapter_id AS chapter_id,
          mentions.sentence_index AS sentence_index,
          mentions.range_start AS range_start,
          mentions.range_end AS range_end,
          mentions.surface AS surface,
          mentions.qid AS qid,
          mentions.confidence AS confidence,
          mentions.note AS note
        FROM mentions
        INNER JOIN serials
          ON serials.id = mentions.chapter_id
        WHERE mentions.qid = ?
        ${options.chapterId === undefined ? "" : "AND mentions.chapter_id = ?"}
        ORDER BY
          serials.document_order ${direction},
          mentions.chapter_id ${direction},
          mentions.sentence_index ${direction},
          mentions.range_start ${direction},
          mentions.range_end ${direction},
          mentions.id ${direction}
        ${options.limit === undefined ? "" : "LIMIT ?"}
        ${options.offset === undefined ? "" : "OFFSET ?"}
      `,
      [
        qid,
        ...(options.chapterId === undefined ? [] : [options.chapterId]),
        ...(options.limit === undefined ? [] : [options.limit]),
        ...(options.offset === undefined ? [] : [options.offset]),
      ],
      mapMentionRow,
    );
  }

  public async listLabelsByQid(
    qid: string,
    options: { readonly chapterId?: number } = {},
  ): Promise<string[]> {
    return await this.#database.queryAll(
      `
        SELECT surface
        FROM mentions
        WHERE qid = ?
        ${options.chapterId === undefined ? "" : "AND chapter_id = ?"}
        GROUP BY surface
        ORDER BY count(*) DESC, surface
      `,
      options.chapterId === undefined ? [qid] : [qid, options.chapterId],
      (row) => getString(row, "surface"),
    );
  }

  public async listBySurfaces(
    surfaces: readonly string[],
  ): Promise<MentionRecord[]> {
    const normalizedSurfaces = [
      ...new Set(surfaces.map((surface) => surface.trim())),
    ].filter((surface) => surface !== "");

    if (normalizedSurfaces.length === 0) {
      return [];
    }

    return await this.#database.queryAll(
      `
        SELECT
          id,
          chapter_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        WHERE surface IN (${normalizedSurfaces.map(() => "?").join(", ")})
        ORDER BY chapter_id, sentence_index, range_start, range_end, id
      `,
      normalizedSurfaces,
      mapMentionRow,
    );
  }

  public async listBySurfaceTerms(
    terms: readonly string[],
  ): Promise<MentionRecord[]> {
    const normalizedTerms = [
      ...new Set(terms.map((term) => term.trim().toLowerCase())),
    ].filter((term) => term !== "");

    if (normalizedTerms.length === 0) {
      return [];
    }

    const filters = normalizedTerms
      .map(() => "lower(surface) LIKE ? ESCAPE '\\'")
      .join(" OR ");

    return await this.#database.queryAll(
      `
        SELECT
          id,
          chapter_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        WHERE ${filters}
        ORDER BY chapter_id, sentence_index, range_start, range_end, id
      `,
      normalizedTerms.map((term) => `%${escapeLikePattern(term)}%`),
      mapMentionRow,
    );
  }

  public async listByChapter(chapterId: number): Promise<MentionRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT
          id,
          chapter_id,
          sentence_index,
          range_start,
          range_end,
          surface,
          qid,
          confidence,
          note
        FROM mentions
        WHERE chapter_id = ?
        ORDER BY sentence_index, range_start, range_end, id
      `,
      [chapterId],
      mapMentionRow,
    );
  }

  public async deleteByChapter(chapterId: number): Promise<void> {
    await this.#database.run(
      `
        DELETE FROM mentions
        WHERE chapter_id = ?
      `,
      [chapterId],
    );
  }
}
