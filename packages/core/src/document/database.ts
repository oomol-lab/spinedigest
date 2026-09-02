import { binary as platformBinary } from "../runtime/platform/index.js";
import {
  AsyncLocalStorage,
  getWikiGraphPlatform,
  getDatabaseCapability,
  resolve,
  stat,
} from "../runtime/platform/index.js";
import type {
  File,
  HostDatabaseConnection,
} from "../runtime/platform/index.js";

type SqliteDatabase = {
  run(
    sql: string,
    params: SqlBindValue[] | SqlBindValue,
    callback: (error?: Error | null) => void,
  ): void;
  all<T = any>(
    sql: string,
    params: SqlBindValue[] | SqlBindValue,
    callback: (error: Error | null, rows: T[]) => void,
  ): void;
  get<T = any>(
    sql: string,
    params: SqlBindValue[] | SqlBindValue,
    callback: (error: Error | null, row: T | undefined) => void,
  ): void;
  exec(sql: string, callback: (error?: Error | null) => void): any;
  close(callback: (error?: Error | null) => void): void;
};
interface DatabaseBackend {
  close(): Promise<void>;
  execute(sql: string): Promise<void>;
  queryAll(sql: string, params: SqlBindParams | undefined): Promise<SqlRow[]>;
  queryOne(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<SqlRow | undefined>;
  run(sql: string, params: SqlBindParams | undefined): Promise<void>;
}
type Sqlite3Module = {
  readonly OPEN_READONLY: number;
  readonly OPEN_READWRITE: number;
  readonly OPEN_CREATE: number;
  readonly OPEN_FULLMUTEX: number;
  readonly Database: new (
    path: string,
    flags: number,
    callback: (error?: Error | null) => void,
  ) => SqliteDatabase;
};
export type SqlBindValue = platformBinary | Uint8Array | number | string | null;
type SqlBindParams = readonly SqlBindValue[];
type SqlRowValue = SqlBindValue;

export type SqlRow = Record<string, SqlRowValue>;

const SQLITE_BUSY_TIMEOUT_MS = 15 * 60 * 1000;

type DatabaseOperationScope = symbol;

async function isMissingOrEmptyFile(path: File | string): Promise<boolean> {
  if (typeof path !== "string") {
    if (path.size !== undefined) return path.size === 0;
    if (path.getSize !== undefined) return (await path.getSize()) === 0;
    const content = await path.read();
    return typeof content === "string"
      ? content.length === 0
      : content.byteLength === 0;
  }
  const stats = await stat(path).catch((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }

    throw error;
  });

  return stats === undefined || stats.size === 0;
}

export class Database {
  readonly #database: DatabaseBackend;
  readonly #onWrite: (() => void) | undefined;
  readonly #operationScope = new AsyncLocalStorage<DatabaseOperationScope>();
  #activeTransactionScope: DatabaseOperationScope | undefined;
  #closed = false;
  #operationChain: Promise<void> = Promise.resolve();
  #transactionDepth = 0;

  public constructor(
    database: DatabaseBackend,
    options: { readonly onWrite?: () => void } = {},
  ) {
    this.#database = database;
    this.#onWrite = options.onWrite;
  }

  public static async open(
    databasePath: File | string,
    schemaSql = "",
    options: {
      readonly onWrite?: () => void;
      readonly readonly?: boolean;
    } = {},
  ): Promise<Database> {
    const resolvedDatabasePath =
      typeof databasePath === "string" ? resolve(databasePath) : databasePath;
    const shouldMarkSchemaWritten =
      options.readonly !== true &&
      schemaSql.trim() !== "" &&
      (await isMissingOrEmptyFile(resolvedDatabasePath));
    const database = await openSqliteDatabase(resolvedDatabasePath, options);
    const openedDatabase = new Database(database, options);

    await openedDatabase.#executeSql(
      `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`,
    );
    if (options.readonly !== true && schemaSql.trim() !== "") {
      await openedDatabase.#executeSql(schemaSql);
      if (shouldMarkSchemaWritten) {
        openedDatabase.#markWritten();
      }
    }

    return openedDatabase;
  }

  public static async initialize(
    databasePath: File | string,
    schemaSql: string,
  ): Promise<void> {
    const database = await Database.open(databasePath);

    try {
      if (schemaSql.trim() !== "") {
        await database.#executeSql(schemaSql);
      }
    } finally {
      await database.close();
    }
  }

  public async queryAll<T>(
    sql: string,
    params: SqlBindParams | undefined,
    mapRow: (row: SqlRow) => T,
  ): Promise<T[]> {
    return await this.#runSerialized(async () => {
      this.#assertOpen();
      const rows = await this.#queryAllRows(sql, params);

      return rows.map(mapRow);
    });
  }

  public async queryOne<T>(
    sql: string,
    params: SqlBindParams | undefined,
    mapRow: (row: SqlRow) => T,
  ): Promise<T | undefined> {
    return await this.#runSerialized(async () => {
      this.#assertOpen();
      const row = await this.#queryOneRow(sql, params);

      return row === undefined ? undefined : mapRow(row);
    });
  }

  public async run(sql: string, params?: SqlBindParams): Promise<void> {
    await this.#runSerialized(async () => {
      this.#assertOpen();
      await this.#runStatement(sql, params);
      this.#markWritten();
    });
  }

  public async transaction<T>(operation: () => Promise<T> | T): Promise<T> {
    return await this.#runSerialized(async () => {
      this.#assertOpen();
      const isRootTransaction = this.#transactionDepth === 0;
      const transactionScope =
        this.#activeTransactionScope ?? Symbol("database transaction scope");

      if (isRootTransaction) {
        await this.#executeSql("BEGIN IMMEDIATE");
        this.#activeTransactionScope = transactionScope;
      }

      this.#transactionDepth += 1;

      try {
        const result = await this.#operationScope.run(
          transactionScope,
          operation,
        );

        if (isRootTransaction) {
          await this.#executeSql("COMMIT");
        }

        return result;
      } catch (error) {
        if (isRootTransaction) {
          await this.#executeSql("ROLLBACK");
        }

        throw error;
      } finally {
        this.#transactionDepth -= 1;
        if (isRootTransaction) {
          this.#activeTransactionScope = undefined;
        }
      }
    });
  }

  public async flush(): Promise<void> {
    await this.#runSerialized(() => {
      this.#assertOpen();
    });
  }

  public async close(): Promise<void> {
    await this.#runSerialized(async () => {
      if (this.#closed) {
        return;
      }

      await this.#closeDatabase();
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
    const operationScope = this.#operationScope.getStore();

    if (
      operationScope !== undefined &&
      operationScope === this.#activeTransactionScope
    ) {
      return await operation();
    }

    const queuedOperation = this.#operationChain.then(operation);

    this.#operationChain = queuedOperation.then(
      () => undefined,
      () => undefined,
    );

    return await queuedOperation;
  }

  #markWritten(): void {
    this.#onWrite?.();
  }

  async #closeDatabase(): Promise<void> {
    await this.#database.close();
  }

  async #executeSql(sql: string): Promise<void> {
    await this.#database.execute(sql);
  }

  async #queryAllRows(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<SqlRow[]> {
    return await this.#database.queryAll(sql, params);
  }

  async #queryOneRow(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<SqlRow | undefined> {
    return await this.#database.queryOne(sql, params);
  }

  async #runStatement(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<void> {
    await this.#database.run(sql, params);
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

async function openSqliteDatabase(
  databasePath: File | string,
  options: { readonly readonly?: boolean } = {},
): Promise<DatabaseBackend> {
  if (typeof databasePath !== "string") {
    return new HostDatabaseBackend(
      await getWikiGraphPlatform().database.open(databasePath, options),
    );
  }

  const sqlite3 = await loadSqlite3();
  const flags =
    (options.readonly === true
      ? sqlite3.OPEN_READONLY
      : sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE) | sqlite3.OPEN_FULLMUTEX;

  const database = await new Promise<SqliteDatabase>(
    (resolveOpen, rejectOpen) => {
      const database = new sqlite3.Database(
        databasePath,
        flags,
        (error: any) => {
          if (error !== null) {
            rejectOpen(error);
            return;
          }

          resolveOpen(database);
        },
      );
    },
  );
  return new LegacyDatabaseBackend(database);
}

class HostDatabaseBackend implements DatabaseBackend {
  readonly #connection: HostDatabaseConnection;

  public constructor(connection: HostDatabaseConnection) {
    this.#connection = connection;
  }

  public async close(): Promise<void> {
    await this.#connection.close();
  }
  public async execute(sql: string): Promise<void> {
    await this.#connection.execute(sql);
  }
  public async queryAll(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<SqlRow[]> {
    return [...(await this.#connection.queryAll(sql, params))] as SqlRow[];
  }
  public async queryOne(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<SqlRow | undefined> {
    return (await this.#connection.queryOne(sql, params)) as SqlRow | undefined;
  }
  public async run(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<void> {
    await this.#connection.run(sql, params);
  }
}

class LegacyDatabaseBackend implements DatabaseBackend {
  readonly #database: SqliteDatabase;

  public constructor(database: SqliteDatabase) {
    this.#database = database;
  }

  public async close(): Promise<void> {
    await new Promise<void>((resolveClose, rejectClose) => {
      this.#database.close((error) => {
        if (error != null) rejectClose(error);
        else resolveClose();
      });
    });
  }
  public async execute(sql: string): Promise<void> {
    await new Promise<void>((resolveExec, rejectExec) => {
      this.#database.exec(sql, (error) => {
        if (error != null) rejectExec(error);
        else resolveExec();
      });
    });
  }
  public async queryAll(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<SqlRow[]> {
    return await new Promise((resolveAll, rejectAll) => {
      this.#database.all<SqlRow>(
        sql,
        normalizeSqlBindParams(params),
        (error, rows) => {
          if (error != null) rejectAll(error);
          else resolveAll(rows);
        },
      );
    });
  }
  public async queryOne(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<SqlRow | undefined> {
    return await new Promise((resolveGet, rejectGet) => {
      this.#database.get<SqlRow>(
        sql,
        normalizeSqlBindParams(params),
        (error, row) => {
          if (error != null) rejectGet(error);
          else resolveGet(row);
        },
      );
    });
  }
  public async run(
    sql: string,
    params: SqlBindParams | undefined,
  ): Promise<void> {
    await new Promise<void>((resolveRun, rejectRun) => {
      this.#database.run(sql, normalizeSqlBindParams(params), (error) => {
        if (error != null) rejectRun(error);
        else resolveRun();
      });
    });
  }
}

async function loadSqlite3(): Promise<Sqlite3Module> {
  return resolveSqlite3Module(getDatabaseCapability());
}

function resolveSqlite3Module(module: unknown): Sqlite3Module {
  if (
    typeof module === "object" &&
    module !== null &&
    "default" in module &&
    typeof module.default === "object" &&
    module.default !== null &&
    "Database" in module.default
  ) {
    return module.default as Sqlite3Module;
  }

  if (typeof module === "object" && module !== null && "Database" in module) {
    return module as Sqlite3Module;
  }

  throw new TypeError("Could not load sqlite3");
}

function normalizeSqlBindParams(
  params: SqlBindParams | undefined,
): SqlBindValue[] {
  return params === undefined ? [] : [...params];
}
