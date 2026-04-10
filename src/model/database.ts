import { AsyncLocalStorage } from "async_hooks";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";

import type initSqlJs from "sql.js";

type InitSqlJsStatic = typeof initSqlJs;
type SqlJsStatic = Awaited<ReturnType<InitSqlJsStatic>>;
type SqlDatabase = InstanceType<SqlJsStatic["Database"]>;
type SqlBindParams = NonNullable<Parameters<SqlDatabase["run"]>[1]>;
type SqlRowValue = number | string | Uint8Array | null;

export type SqlRow = Record<string, SqlRowValue>;

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

export class Database {
  readonly #database: SqlDatabase;
  readonly #databasePath: string;
  readonly #operationScope = new AsyncLocalStorage<boolean>();
  #closed = false;
  #dirty = false;
  #operationChain: Promise<void> = Promise.resolve();
  #transactionDepth = 0;

  public constructor(database: SqlDatabase, databasePath: string) {
    this.#database = database;
    this.#databasePath = databasePath;
  }

  public static async open(
    databasePath: string,
    schemaSql: string,
  ): Promise<Database> {
    const resolvedDatabasePath = resolve(databasePath);
    const SQL = await loadSqlJs();
    const databaseFile = await readDatabaseFile(resolvedDatabasePath);
    const database = new SQL.Database(databaseFile);
    const openedDatabase = new Database(database, resolvedDatabasePath);

    openedDatabase.#database.run(schemaSql);
    openedDatabase.#dirty = databaseFile === undefined;

    return openedDatabase;
  }

  public async queryAll<T>(
    sql: string,
    params: SqlBindParams | undefined,
    mapRow: (row: SqlRow) => T,
  ): Promise<T[]> {
    return await this.#runSerialized(() => {
      this.#assertOpen();

      const statement = this.#database.prepare(sql, params);

      try {
        const rows: T[] = [];

        while (statement.step()) {
          rows.push(mapRow(statement.getAsObject() as SqlRow));
        }

        return rows;
      } finally {
        statement.free();
      }
    });
  }

  public async queryOne<T>(
    sql: string,
    params: SqlBindParams | undefined,
    mapRow: (row: SqlRow) => T,
  ): Promise<T | undefined> {
    const rows = await this.queryAll(sql, params, mapRow);

    return rows[0];
  }

  public async run(sql: string, params?: SqlBindParams): Promise<void> {
    await this.#runSerialized(async () => {
      this.#assertOpen();
      this.#database.run(sql, params);
      this.#dirty = true;

      if (this.#transactionDepth === 0) {
        await this.flush();
      }
    });
  }

  public async transaction<T>(operation: () => Promise<T> | T): Promise<T> {
    return await this.#runSerialized(async () => {
      this.#assertOpen();
      const isRootTransaction = this.#transactionDepth === 0;

      if (isRootTransaction) {
        this.#database.run("BEGIN");
      }

      this.#transactionDepth += 1;

      try {
        const result = await operation();

        this.#transactionDepth -= 1;

        if (isRootTransaction) {
          this.#database.run("COMMIT");
          await this.flush();
        }

        return result;
      } catch (error) {
        this.#transactionDepth -= 1;

        if (isRootTransaction) {
          this.#database.run("ROLLBACK");
        }

        throw error;
      }
    });
  }

  public async flush(): Promise<void> {
    await this.#runSerialized(async () => {
      this.#assertOpen();

      if (!this.#dirty) {
        return;
      }

      await mkdir(dirname(this.#databasePath), { recursive: true });
      await writeFile(this.#databasePath, Buffer.from(this.#database.export()));
      this.#dirty = false;
    });
  }

  public async close(): Promise<void> {
    await this.#runSerialized(async () => {
      if (this.#closed) {
        return;
      }

      if (this.#dirty) {
        await this.flush();
      }

      this.#database.close();
      this.#closed = true;
    });
  }

  public async getLastInsertRowId(): Promise<number> {
    const row = await this.queryOne(
      "SELECT last_insert_rowid() AS row_id",
      undefined,
      (value) => getNumber(value, "row_id"),
    );

    if (row === undefined) {
      throw new Error("Could not read last_insert_rowid()");
    }

    return row;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error("Database is already closed");
    }
  }

  async #runSerialized<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.#operationScope.getStore() === true) {
      return await operation();
    }

    const queuedOperation = this.#operationChain.then(
      () => this.#operationScope.run(true, operation),
    );

    this.#operationChain = queuedOperation.then(
      () => undefined,
      () => undefined,
    );

    return await queuedOperation;
  }
}

export function getNumber(row: SqlRow, key: string): number {
  const value = row[key];

  if (typeof value !== "number") {
    throw new TypeError(`Expected ${key} to be a number`);
  }

  return value;
}

export function getString(row: SqlRow, key: string): string {
  const value = row[key];

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

export function getOptionalString(
  row: SqlRow,
  key: string,
): string | undefined {
  const value = row[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (sqlJsPromise !== undefined) {
    return await sqlJsPromise;
  }

  sqlJsPromise = import("sql.js").then(async (module) => {
    const initSqlJs = resolveInitSqlJs(module as unknown);
    return await initSqlJs();
  });

  return await sqlJsPromise;
}

function resolveInitSqlJs(module: unknown): InitSqlJsStatic {
  if (typeof module === "function") {
    return module as InitSqlJsStatic;
  }

  if (
    typeof module === "object" &&
    module !== null &&
    "default" in module &&
    typeof module.default === "function"
  ) {
    return module.default as InitSqlJsStatic;
  }

  throw new TypeError("Could not load sql.js");
}

async function readDatabaseFile(
  databasePath: string,
): Promise<Uint8Array | undefined> {
  try {
    return await readFile(databasePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
