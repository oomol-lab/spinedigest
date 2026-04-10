import { mkdir, readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";

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

  public constructor(input: {
    database: Database;
    fragments: Fragments;
    path: string;
  }) {
    this.#database = input.database;
    this.#fragments = input.fragments;
    this.serials = new SerialStore(input.database);
    this.chunks = new ChunkStore(input.database);
    this.fragmentGroups = new FragmentGroupStore(input.database);
    this.knowledgeEdges = new KnowledgeEdgeStore(input.database);
    this.snakeChunks = new SnakeChunkStore(input.database);
    this.snakeEdges = new SnakeEdgeStore(input.database);
    this.snakes = new SnakeStore(input.database);
    this.path = input.path;
  }

  public static async open(workspacePath: string): Promise<Workspace> {
    const resolvedWorkspacePath = resolve(workspacePath);
    const databasePath = join(resolvedWorkspacePath, "database.db");
    const fragments = new Fragments(resolvedWorkspacePath);

    await mkdir(resolvedWorkspacePath, { recursive: true });
    await fragments.ensureCreated();

    return new Workspace({
      database: await Database.open(databasePath, SCHEMA_SQL),
      fragments,
      path: resolvedWorkspacePath,
    });
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
    this.#database.close();
  }

  #getSummariesPath(): string {
    return join(this.path, "summaries");
  }

  #getSummaryPath(serialId: number): string {
    return join(this.#getSummariesPath(), `serial-${serialId}.txt`);
  }
}

function isNodeError(
  error: unknown,
): error is NodeJS.ErrnoException & { readonly code: string } {
  return error instanceof Error && "code" in error;
}
