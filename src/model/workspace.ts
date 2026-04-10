import { mkdir, readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";

import { isNodeError } from "../utils/node-error.js";
import { Database } from "./database.js";
import { Fragments } from "./fragments.js";
import type { SerialFragments } from "./fragments.js";
import { SCHEMA_SQL } from "./schema.js";
import type { SentenceId } from "./types.js";
import {
  ChunkStore,
  FragmentGroupStore,
  KnowledgeEdgeStore,
  SerialStore,
  SnakeChunkStore,
  SnakeEdgeStore,
  SnakeStore,
} from "./stores.js";

export class Workspace {
  public readonly serials: SerialStore;
  public readonly chunks: ChunkStore;
  public readonly fragmentGroups: FragmentGroupStore;
  public readonly knowledgeEdges: KnowledgeEdgeStore;
  public readonly snakeChunks: SnakeChunkStore;
  public readonly snakeEdges: SnakeEdgeStore;
  public readonly snakes: SnakeStore;
  public readonly path: string;

  readonly #database: Database;
  readonly #fragments: Fragments;

  public constructor(database: Database, fragments: Fragments, path: string) {
    this.#database = database;
    this.#fragments = fragments;
    this.serials = new SerialStore(database);
    this.chunks = new ChunkStore(database);
    this.fragmentGroups = new FragmentGroupStore(database);
    this.knowledgeEdges = new KnowledgeEdgeStore(database);
    this.snakeChunks = new SnakeChunkStore(database);
    this.snakeEdges = new SnakeEdgeStore(database);
    this.snakes = new SnakeStore(database);
    this.path = path;
  }

  public static async open(workspacePath: string): Promise<Workspace> {
    const resolvedWorkspacePath = resolve(workspacePath);
    const databasePath = join(resolvedWorkspacePath, "database.db");
    const fragments = new Fragments(resolvedWorkspacePath);

    await mkdir(resolvedWorkspacePath, { recursive: true });
    await fragments.ensureCreated();

    return new Workspace(
      await Database.open(databasePath, SCHEMA_SQL),
      fragments,
      resolvedWorkspacePath,
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

  public async close(): Promise<void> {
    await this.flush();
    await this.#database.close();
  }

  #getSummariesPath(): string {
    return join(this.path, "summaries");
  }

  #getSummaryPath(serialId: number): string {
    return join(this.#getSummariesPath(), `serial-${serialId}.txt`);
  }
}
