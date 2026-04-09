import { getNumber, getOptionalString, getString } from "./database.js";
import type { Database, SqlRow } from "./database.js";
import type {
  ChunkRecord,
  CreateSnakeRecord,
  FragmentGroupRecord,
  KnowledgeEdgeRecord,
  SerialRecord,
  SentenceId,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
} from "./types.js";

export class SerialStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(record: SerialRecord): Promise<void> {
    await this.#database.run(
      `
        INSERT OR REPLACE INTO serials (id)
        VALUES (?)
      `,
      [record.id],
    );
  }

  public getById(serialId: number): SerialRecord | undefined {
    return this.#database.queryOne(
      `
        SELECT id
        FROM serials
        WHERE id = ?
      `,
      [serialId],
      (row) => ({
        id: getNumber(row, "id"),
      }),
    );
  }

  public listIds(): number[] {
    return this.#database.queryAll(
      `
        SELECT id
        FROM serials
        ORDER BY id
      `,
      undefined,
      (row) => getNumber(row, "id"),
    );
  }
}

export class ChunkStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(record: ChunkRecord): Promise<void> {
    await this.#database.transaction(async () => {
      await this.#database.run(
        `
          INSERT OR REPLACE INTO chunks (
            id,
            generation,
            serial_id,
            fragment_id,
            sentence_index,
            label,
            content,
            retention,
            importance,
            tokens,
            weight
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          record.id,
          record.generation,
          record.sentenceId[0],
          record.sentenceId[1],
          record.sentenceId[2],
          record.label,
          record.content,
          record.retention ?? null,
          record.importance ?? null,
          record.tokens,
          record.weight,
        ],
      );

      await this.#database.run(
        `
          DELETE FROM chunk_sentences
          WHERE chunk_id = ?
        `,
        [record.id],
      );

      for (const sentenceId of record.sentenceIds) {
        await this.#database.run(
          `
            INSERT INTO chunk_sentences (
              chunk_id,
              serial_id,
              fragment_id,
              sentence_index
            )
            VALUES (?, ?, ?, ?)
          `,
          [record.id, sentenceId[0], sentenceId[1], sentenceId[2]],
        );
      }
    });
  }

  public getById(chunkId: number): ChunkRecord | undefined {
    const row = this.#database.queryOne(
      `
        SELECT
          id,
          generation,
          serial_id,
          fragment_id,
          sentence_index,
          label,
          content,
          retention,
          importance,
          tokens,
          weight
        FROM chunks
        WHERE id = ?
      `,
      [chunkId],
      (value) => value,
    );

    if (row === undefined) {
      return undefined;
    }

    return this.#mapChunkRow(row);
  }

  public listAll(): ChunkRecord[] {
    return this.#database
      .queryAll(
        `
          SELECT
            id,
            generation,
            serial_id,
            fragment_id,
            sentence_index,
            label,
            content,
            retention,
            importance,
            tokens,
            weight
          FROM chunks
          ORDER BY id
        `,
        undefined,
        (row) => row,
      )
      .map((row) => this.#mapChunkRow(row));
  }

  public listByFragments(
    serialId: number,
    fragmentIds: readonly number[],
  ): ChunkRecord[] {
    if (fragmentIds.length === 0) {
      return [];
    }

    const placeholders = fragmentIds.map(() => "?").join(", ");

    return this.#database
      .queryAll(
        `
          SELECT
            id,
            generation,
            serial_id,
            fragment_id,
            sentence_index,
            label,
            content,
            retention,
            importance,
            tokens,
            weight
          FROM chunks
          WHERE serial_id = ? AND fragment_id IN (${placeholders})
          ORDER BY id
        `,
        [serialId, ...fragmentIds],
        (row) => row,
      )
      .map((row) => this.#mapChunkRow(row));
  }

  public listFragmentPairs(): ReadonlyArray<readonly [number, number]> {
    return this.#database.queryAll(
      `
        SELECT DISTINCT serial_id, fragment_id
        FROM chunks
        ORDER BY serial_id, fragment_id
      `,
      undefined,
      (row) =>
        [getNumber(row, "serial_id"), getNumber(row, "fragment_id")] as const,
    );
  }

  #getSentenceIds(chunkId: number): SentenceId[] {
    return this.#database.queryAll(
      `
        SELECT serial_id, fragment_id, sentence_index
        FROM chunk_sentences
        WHERE chunk_id = ?
        ORDER BY serial_id, fragment_id, sentence_index
      `,
      [chunkId],
      (row) =>
        [
          getNumber(row, "serial_id"),
          getNumber(row, "fragment_id"),
          getNumber(row, "sentence_index"),
        ] as const,
    );
  }

  #mapChunkRow(row: SqlRow): ChunkRecord {
    const chunkId = getNumber(row, "id");
    const importance = getOptionalString(row, "importance");
    const retention = getOptionalString(row, "retention");

    return {
      content: getString(row, "content"),
      generation: getNumber(row, "generation"),
      id: chunkId,
      label: getString(row, "label"),
      sentenceId: [
        getNumber(row, "serial_id"),
        getNumber(row, "fragment_id"),
        getNumber(row, "sentence_index"),
      ] as const,
      sentenceIds: this.#getSentenceIds(chunkId),
      tokens: getNumber(row, "tokens"),
      weight: getNumber(row, "weight"),
      ...(importance === undefined ? {} : { importance }),
      ...(retention === undefined ? {} : { retention }),
    };
  }
}

export class KnowledgeEdgeStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(record: KnowledgeEdgeRecord): Promise<void> {
    await this.#database.run(
      `
        INSERT OR REPLACE INTO knowledge_edges (from_id, to_id, strength, weight)
        VALUES (?, ?, ?, ?)
      `,
      [record.fromId, record.toId, record.strength ?? null, record.weight],
    );
  }

  public listAll(): KnowledgeEdgeRecord[] {
    return this.#database.queryAll(
      `
        SELECT from_id, to_id, strength, weight
        FROM knowledge_edges
        ORDER BY from_id, to_id
      `,
      undefined,
      (row) => mapKnowledgeEdgeRow(row),
    );
  }

  public listIncoming(chunkId: number): KnowledgeEdgeRecord[] {
    return this.#listByDirection("to_id", chunkId);
  }

  public listOutgoing(chunkId: number): KnowledgeEdgeRecord[] {
    return this.#listByDirection("from_id", chunkId);
  }

  #listByDirection(
    column: "from_id" | "to_id",
    chunkId: number,
  ): KnowledgeEdgeRecord[] {
    return this.#database.queryAll(
      `
        SELECT from_id, to_id, strength, weight
        FROM knowledge_edges
        WHERE ${column} = ?
        ORDER BY from_id, to_id
      `,
      [chunkId],
      (row) => mapKnowledgeEdgeRow(row),
    );
  }
}

export class SnakeStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async create(record: CreateSnakeRecord): Promise<number> {
    await this.#database.run(
      `
        INSERT INTO snakes (
          serial_id,
          group_id,
          local_snake_id,
          size,
          first_label,
          last_label,
          tokens,
          weight
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.serialId,
        record.groupId,
        record.localSnakeId,
        record.size,
        record.firstLabel,
        record.lastLabel,
        record.tokens ?? 0,
        record.weight ?? 0,
      ],
    );

    return this.#database.getLastInsertRowId();
  }

  public getById(snakeId: number): SnakeRecord | undefined {
    return this.#database.queryOne(
      `
        SELECT
          id,
          serial_id,
          group_id,
          local_snake_id,
          size,
          first_label,
          last_label,
          tokens,
          weight
        FROM snakes
        WHERE id = ?
      `,
      [snakeId],
      (row) => ({
        serialId: getNumber(row, "serial_id"),
        firstLabel: getString(row, "first_label"),
        groupId: getNumber(row, "group_id"),
        id: getNumber(row, "id"),
        lastLabel: getString(row, "last_label"),
        localSnakeId: getNumber(row, "local_snake_id"),
        size: getNumber(row, "size"),
        tokens: getNumber(row, "tokens"),
        weight: getNumber(row, "weight"),
      }),
    );
  }

  public listIdsByGroup(serialId: number, groupId: number): number[] {
    return this.#database.queryAll(
      `
        SELECT id
        FROM snakes
        WHERE serial_id = ? AND group_id = ?
        ORDER BY id
      `,
      [serialId, groupId],
      (row) => getNumber(row, "id"),
    );
  }
}

export class SnakeChunkStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(record: SnakeChunkRecord): Promise<void> {
    await this.#database.run(
      `
        INSERT OR REPLACE INTO snake_chunks (snake_id, chunk_id, position)
        VALUES (?, ?, ?)
      `,
      [record.snakeId, record.chunkId, record.position],
    );
  }

  public listChunkIds(snakeId: number): number[] {
    return this.#database.queryAll(
      `
        SELECT chunk_id
        FROM snake_chunks
        WHERE snake_id = ?
        ORDER BY position
      `,
      [snakeId],
      (row) => getNumber(row, "chunk_id"),
    );
  }
}

export class SnakeEdgeStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(record: SnakeEdgeRecord): Promise<void> {
    await this.#database.run(
      `
        INSERT OR REPLACE INTO snake_edges (from_snake_id, to_snake_id, weight)
        VALUES (?, ?, ?)
      `,
      [record.fromSnakeId, record.toSnakeId, record.weight],
    );
  }

  public listIncoming(snakeId: number): SnakeEdgeRecord[] {
    return this.#listByDirection("to_snake_id", snakeId);
  }

  public listOutgoing(snakeId: number): SnakeEdgeRecord[] {
    return this.#listByDirection("from_snake_id", snakeId);
  }

  public listWithin(snakeIds: readonly number[]): SnakeEdgeRecord[] {
    if (snakeIds.length === 0) {
      return [];
    }

    const placeholders = snakeIds.map(() => "?").join(", ");

    return this.#database.queryAll(
      `
        SELECT from_snake_id, to_snake_id, weight
        FROM snake_edges
        WHERE from_snake_id IN (${placeholders})
          AND to_snake_id IN (${placeholders})
        ORDER BY from_snake_id, to_snake_id
      `,
      [...snakeIds, ...snakeIds],
      (row) => ({
        fromSnakeId: getNumber(row, "from_snake_id"),
        toSnakeId: getNumber(row, "to_snake_id"),
        weight: getNumber(row, "weight"),
      }),
    );
  }

  #listByDirection(
    column: "from_snake_id" | "to_snake_id",
    snakeId: number,
  ): SnakeEdgeRecord[] {
    return this.#database.queryAll(
      `
        SELECT from_snake_id, to_snake_id, weight
        FROM snake_edges
        WHERE ${column} = ?
        ORDER BY from_snake_id, to_snake_id
      `,
      [snakeId],
      (row) => ({
        fromSnakeId: getNumber(row, "from_snake_id"),
        toSnakeId: getNumber(row, "to_snake_id"),
        weight: getNumber(row, "weight"),
      }),
    );
  }
}

export class FragmentGroupStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(record: FragmentGroupRecord): Promise<void> {
    await this.#database.run(
      `
        INSERT OR REPLACE INTO fragment_groups (serial_id, group_id, fragment_id)
        VALUES (?, ?, ?)
      `,
      [record.serialId, record.groupId, record.fragmentId],
    );
  }

  public async saveMany(
    records: readonly FragmentGroupRecord[],
  ): Promise<void> {
    await this.#database.transaction(async () => {
      for (const record of records) {
        await this.save(record);
      }
    });
  }

  public listBySerial(serialId: number): FragmentGroupRecord[] {
    return this.#database.queryAll(
      `
        SELECT serial_id, group_id, fragment_id
        FROM fragment_groups
        WHERE serial_id = ?
        ORDER BY group_id, fragment_id
      `,
      [serialId],
      (row) => ({
        serialId: getNumber(row, "serial_id"),
        fragmentId: getNumber(row, "fragment_id"),
        groupId: getNumber(row, "group_id"),
      }),
    );
  }

  public listSerialIds(): number[] {
    return this.#database.queryAll(
      `
        SELECT DISTINCT serial_id
        FROM fragment_groups
        ORDER BY serial_id
      `,
      undefined,
      (row) => getNumber(row, "serial_id"),
    );
  }

  public listGroupIdsForSerial(serialId: number): number[] {
    return this.#database.queryAll(
      `
        SELECT DISTINCT group_id
        FROM fragment_groups
        WHERE serial_id = ?
        ORDER BY group_id
      `,
      [serialId],
      (row) => getNumber(row, "group_id"),
    );
  }
}

function mapKnowledgeEdgeRow(row: SqlRow): KnowledgeEdgeRecord {
  const strength = getOptionalString(row, "strength");

  return {
    fromId: getNumber(row, "from_id"),
    toId: getNumber(row, "to_id"),
    weight: getNumber(row, "weight"),
    ...(strength === undefined ? {} : { strength }),
  };
}
