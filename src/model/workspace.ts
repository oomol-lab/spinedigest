import { mkdir } from "fs/promises";
import { join, resolve } from "path";

import { Database } from "./database.js";
import { WorkspaceFragments } from "./fragments.js";
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

abstract class WorkspaceAccess {
  public readonly chapters: ChapterStore;
  public readonly chunks: ChunkStore;
  public readonly fragmentGroups: FragmentGroupStore;
  public readonly fragments: WorkspaceFragments;
  public readonly knowledgeEdges: KnowledgeEdgeStore;
  public readonly snakeChunks: SnakeChunkStore;
  public readonly snakeEdges: SnakeEdgeStore;
  public readonly snakes: SnakeStore;

  protected constructor(database: Database, fragments: WorkspaceFragments) {
    this.chapters = new ChapterStore(database);
    this.chunks = new ChunkStore(database);
    this.fragmentGroups = new FragmentGroupStore(database);
    this.fragments = fragments;
    this.knowledgeEdges = new KnowledgeEdgeStore(database);
    this.snakeChunks = new SnakeChunkStore(database);
    this.snakeEdges = new SnakeEdgeStore(database);
    this.snakes = new SnakeStore(database);
  }
}

export class WorkspaceSession extends WorkspaceAccess {
  readonly #database: Database;
  public readonly databasePath: string;
  public readonly fragmentsPath: string;
  public readonly path: string;

  public constructor(input: {
    database: Database;
    databasePath: string;
    fragments: WorkspaceFragments;
    fragmentsPath: string;
    path: string;
  }) {
    super(input.database, input.fragments);
    this.#database = input.database;
    this.databasePath = input.databasePath;
    this.fragmentsPath = input.fragmentsPath;
    this.path = input.path;
  }

  public getChapterFragments(chapterId: number): ChapterFragments {
    return this.fragments.getChapter(chapterId);
  }

  public async flush(): Promise<void> {
    await this.#database.flush();
  }
}

export class TopologizationWorkspace extends WorkspaceAccess {
  readonly #database: Database;
  public readonly databasePath: string;
  public readonly fragmentsPath: string;
  public readonly path: string;

  public constructor(input: {
    database: Database;
    databasePath: string;
    fragments: WorkspaceFragments;
    fragmentsPath: string;
    path: string;
  }) {
    super(input.database, input.fragments);
    this.#database = input.database;
    this.databasePath = input.databasePath;
    this.fragmentsPath = input.fragmentsPath;
    this.path = input.path;
  }

  public static async open(
    workspacePath: string,
  ): Promise<TopologizationWorkspace> {
    const resolvedWorkspacePath = resolve(workspacePath);
    const databasePath = join(resolvedWorkspacePath, "database.db");
    const fragments = new WorkspaceFragments(resolvedWorkspacePath);

    await mkdir(resolvedWorkspacePath, { recursive: true });
    await fragments.ensureCreated();

    return new TopologizationWorkspace({
      database: await Database.open(databasePath, SCHEMA_SQL),
      databasePath,
      fragments,
      fragmentsPath: fragments.path,
      path: resolvedWorkspacePath,
    });
  }

  public getChapterFragments(chapterId: number): ChapterFragments {
    return this.fragments.getChapter(chapterId);
  }

  public async flush(): Promise<void> {
    await this.#database.flush();
  }

  public async close(): Promise<void> {
    await this.flush();
    this.#database.close();
  }

  public async transaction<T>(
    operation: (session: WorkspaceSession) => Promise<T> | T,
  ): Promise<T> {
    return await this.#database.transaction(
      async () =>
        await operation(
          new WorkspaceSession({
            database: this.#database,
            databasePath: this.databasePath,
            fragments: this.fragments,
            fragmentsPath: this.fragmentsPath,
            path: this.path,
          }),
        ),
    );
  }
}
