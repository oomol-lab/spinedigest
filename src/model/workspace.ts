import { mkdir } from "fs/promises";
import { join, resolve } from "path";

import { Database } from "./database.js";
import { Fragments } from "./fragments.js";
import type { ChapterFragments } from "./fragments.js";
import { SCHEMA_SQL } from "./schema.js";
import {
  ChapterStore,
  ChunkStore,
  FragmentGroupStore,
  KnowledgeEdgeStore,
  SnakeChunkStore,
  SnakeEdgeStore,
  SnakeStore,
} from "./stores.js";

export class Workspace {
  public readonly chapters: ChapterStore;
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
    this.chapters = new ChapterStore(input.database);
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

  public getChapterFragments(chapterId: number): ChapterFragments {
    return this.#fragments.getChapter(chapterId);
  }

  public async flush(): Promise<void> {
    await this.#database.flush();
  }

  public async close(): Promise<void> {
    await this.flush();
    this.#database.close();
  }
}
