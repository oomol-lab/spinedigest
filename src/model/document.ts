import { mkdir, readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";

import { isNodeError } from "../utils/node-error.js";
import { Database } from "./database.js";
import {
  Fragments,
  type ReadonlySerialFragments,
  type SerialFragments,
} from "./fragments.js";
import { SCHEMA_SQL } from "./schema.js";
import {
  ChunkStore,
  FragmentGroupStore,
  KnowledgeEdgeStore,
  type ReadonlyChunkStore,
  type ReadonlyFragmentGroupStore,
  type ReadonlyKnowledgeEdgeStore,
  type ReadonlySerialStore,
  type ReadonlySnakeChunkStore,
  type ReadonlySnakeEdgeStore,
  type ReadonlySnakeStore,
  SerialStore,
  SnakeChunkStore,
  SnakeEdgeStore,
  SnakeStore,
} from "./stores.js";
import type { SentenceId } from "./types.js";

export interface ReadonlyDocument {
  readonly chunks: ReadonlyChunkStore;
  readonly fragmentGroups: ReadonlyFragmentGroupStore;
  readonly knowledgeEdges: ReadonlyKnowledgeEdgeStore;
  readonly serials: ReadonlySerialStore;
  readonly snakeChunks: ReadonlySnakeChunkStore;
  readonly snakeEdges: ReadonlySnakeEdgeStore;
  readonly snakes: ReadonlySnakeStore;

  getSentence(sentenceId: SentenceId): Promise<string>;
  getSerialFragments(serialId: number): ReadonlySerialFragments;
  readSummary(serialId: number): Promise<string | undefined>;
  release(): Promise<void>;
}

export interface Document extends ReadonlyDocument {
  readonly chunks: ChunkStore;
  readonly fragmentGroups: FragmentGroupStore;
  readonly knowledgeEdges: KnowledgeEdgeStore;
  readonly serials: SerialStore;
  readonly snakeChunks: SnakeChunkStore;
  readonly snakeEdges: SnakeEdgeStore;
  readonly snakes: SnakeStore;

  getSerialFragments(serialId: number): SerialFragments;
  createSerial(): Promise<number>;
  flush(): Promise<void>;
  writeSummary(serialId: number, summary: string): Promise<void>;
}

export class DirectoryDocument implements Document {
  public readonly chunks: ChunkStore;
  public readonly fragmentGroups: FragmentGroupStore;
  public readonly knowledgeEdges: KnowledgeEdgeStore;
  public readonly path: string;
  public readonly serials: SerialStore;
  public readonly snakeChunks: SnakeChunkStore;
  public readonly snakeEdges: SnakeEdgeStore;
  public readonly snakes: SnakeStore;

  readonly #database: Database;
  readonly #fragments: Fragments;

  public constructor(database: Database, fragments: Fragments, path: string) {
    this.#database = database;
    this.#fragments = fragments;
    this.chunks = new ChunkStore(database);
    this.fragmentGroups = new FragmentGroupStore(database);
    this.knowledgeEdges = new KnowledgeEdgeStore(database);
    this.path = path;
    this.serials = new SerialStore(database);
    this.snakeChunks = new SnakeChunkStore(database);
    this.snakeEdges = new SnakeEdgeStore(database);
    this.snakes = new SnakeStore(database);
  }

  public static async open(documentPath: string): Promise<DirectoryDocument> {
    const resolvedDocumentPath = resolve(documentPath);
    const databasePath = join(resolvedDocumentPath, "database.db");
    const fragments = new Fragments(resolvedDocumentPath);

    await mkdir(resolvedDocumentPath, { recursive: true });
    await fragments.ensureCreated();

    return new DirectoryDocument(
      await Database.open(databasePath, SCHEMA_SQL),
      fragments,
      resolvedDocumentPath,
    );
  }

  public getSerialFragments(serialId: number): SerialFragments {
    return this.#fragments.getSerial(serialId);
  }

  public async createSerial(): Promise<number> {
    return await this.serials.create();
  }

  public async getSentence(sentenceId: SentenceId): Promise<string> {
    return await this.#fragments.getSentence(sentenceId);
  }

  public async readSummary(serialId: number): Promise<string | undefined> {
    try {
      return await readFile(this.#getSummaryPath(serialId), "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  }

  public async writeSummary(serialId: number, summary: string): Promise<void> {
    await mkdir(this.#getSummariesPath(), { recursive: true });
    await writeFile(this.#getSummaryPath(serialId), summary, "utf8");
  }

  public async flush(): Promise<void> {
    await this.#database.flush();
  }

  public async release(): Promise<void> {
    await this.flush();
    await this.#database.close();
  }

  public async close(): Promise<void> {
    await this.release();
  }

  #getSummariesPath(): string {
    return join(this.path, "summaries");
  }

  #getSummaryPath(serialId: number): string {
    return join(this.#getSummariesPath(), `serial-${serialId}.txt`);
  }
}
