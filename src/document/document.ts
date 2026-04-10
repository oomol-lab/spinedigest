import { AsyncLocalStorage } from "async_hooks";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
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
  openSession<T>(
    operation: (document: ReadonlyDocument) => Promise<T> | T,
  ): Promise<T>;
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
  openSession<T>(operation: (document: Document) => Promise<T> | T): Promise<T>;
  writeSummary(serialId: number, summary: string): Promise<void>;
}

interface DocumentSessionState {
  readonly createdFilePaths: string[];
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
  readonly #sessionScope = new AsyncLocalStorage<DocumentSessionState>();

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

    const database = await Database.open(databasePath, SCHEMA_SQL);
    let document: DirectoryDocument;

    document = new DirectoryDocument(
      database,
      new Fragments(resolvedDocumentPath, {
        write: async (path, content) =>
          await document.#writeNewFile(path, content),
      }),
      resolvedDocumentPath,
    );

    return document;
  }

  public static async openSession<T>(
    documentPath: string,
    operation: (document: DirectoryDocument) => Promise<T> | T,
  ): Promise<T> {
    const document = await DirectoryDocument.open(documentPath);

    try {
      return await document.openSession(operation);
    } finally {
      await document.release();
    }
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

  public async openSession<T>(
    operation: (document: Document) => Promise<T> | T,
  ): Promise<T> {
    const activeSession = this.#sessionScope.getStore();

    if (activeSession !== undefined) {
      return await operation(this);
    }

    const session = {
      createdFilePaths: [],
    } satisfies DocumentSessionState;

    try {
      return await this.#database.transaction(async () =>
        await this.#sessionScope.run(session, async () => await operation(this)),
      );
    } catch (error) {
      await this.#rollbackCreatedFiles(session);
      throw error;
    }
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
    await this.#writeNewFile(this.#getSummaryPath(serialId), summary);
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

  async #rollbackCreatedFiles(session: DocumentSessionState): Promise<void> {
    for (const path of [...session.createdFilePaths].reverse()) {
      try {
        await unlink(path);
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          continue;
        }

        throw error;
      }
    }
  }

  async #writeNewFile(path: string, content: string): Promise<void> {
    try {
      await writeFile(path, content, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        throw new Error(`File already exists: ${path}`);
      }

      throw error;
    }

    this.#sessionScope.getStore()?.createdFilePaths.push(path);
  }

  #getSummariesPath(): string {
    return join(this.path, "summaries");
  }

  #getSummaryPath(serialId: number): string {
    return join(this.#getSummariesPath(), `serial-${serialId}.txt`);
  }
}
