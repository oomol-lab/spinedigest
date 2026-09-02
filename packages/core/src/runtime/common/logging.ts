import { AsyncLocalStorage } from "../platform/index.js";
import { appendFile, randomUUID } from "../platform/index.js";
import { existsSync, mkdirSync } from "../platform/index.js";
import { join, resolve } from "../platform/index.js";
import { process as platformProcess } from "../platform/index.js";

interface CoreLogger {
  child(bindings: Record<string, unknown>): CoreLogger;
  debug(...args: unknown[]): void;
  error(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  flush(): Promise<void>;
}

interface LoggingContext {
  readonly artifactCounters: Map<string, number>;
  readonly artifactRootDirPath?: string;
  readonly logger: CoreLogger;
  readonly rootLogDirPath?: string;
  readonly runId: string;
}

const loggingContext = new AsyncLocalStorage<LoggingContext>();
const artifactCounters = new Map<string, number>();
const silentLogger: CoreLogger = {
  child: () => silentLogger,
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  flush: async () => undefined,
};

export async function withLoggingContext<T>(
  input: {
    readonly operation: string;
    readonly logDirPath?: string;
    readonly verbose?: boolean;
  },
  operation: () => Promise<T>,
): Promise<T> {
  const rootLogDirPath =
    input.logDirPath === undefined ? undefined : resolve(input.logDirPath);
  const runId = createRunId();
  const runDirPath =
    rootLogDirPath === undefined ? undefined : join(rootLogDirPath, runId);
  const artifactRootDirPath =
    runDirPath === undefined ? undefined : join(runDirPath, "artifacts");

  if (runDirPath !== undefined) {
    mkdirSync(runDirPath, { recursive: true });
  }

  const logger = createLogger({
    operation: input.operation,
    runId,
    verbose: input.verbose ?? false,
    ...(runDirPath === undefined
      ? {}
      : { eventLogPath: join(runDirPath, "run.log") }),
  });

  try {
    return await loggingContext.run(
      {
        artifactCounters: new Map(),
        logger,
        runId,
        ...(artifactRootDirPath === undefined ? {} : { artifactRootDirPath }),
        ...(rootLogDirPath === undefined ? {} : { rootLogDirPath }),
      },
      operation,
    );
  } finally {
    await logger.flush();
  }
}

export function getLogger(bindings?: Record<string, unknown>): CoreLogger {
  const logger = loggingContext.getStore()?.logger ?? silentLogger;

  return bindings === undefined ? logger : logger.child(bindings);
}

export function resolveArtifactPath(input: {
  readonly category: string;
  readonly fileName: string;
  readonly logDirPath?: string;
}): string | undefined {
  if (input.logDirPath === undefined) {
    return undefined;
  }

  const rootLogDirPath = resolve(input.logDirPath);
  const context = loggingContext.getStore();

  if (
    context !== undefined &&
    context.rootLogDirPath === rootLogDirPath &&
    context.artifactRootDirPath !== undefined
  ) {
    const categoryDirPath = join(context.artifactRootDirPath, input.category);

    mkdirSync(categoryDirPath, { recursive: true });

    return join(categoryDirPath, input.fileName);
  }

  mkdirSync(rootLogDirPath, { recursive: true });

  return join(rootLogDirPath, input.fileName);
}

export function allocateArtifactPath(input: {
  readonly alwaysNumbered?: boolean;
  readonly category: string;
  readonly extension?: string;
  readonly logDirPath?: string;
  readonly prefix: string;
}): string | undefined {
  if (input.logDirPath === undefined) {
    return undefined;
  }

  const rootLogDirPath = resolve(input.logDirPath);
  const context = loggingContext.getStore();
  const extension = input.extension ?? ".log";
  const counterStore = context?.artifactCounters ?? artifactCounters;
  const counterKey = `${rootLogDirPath}:${input.category}:${input.prefix}:${extension}`;
  const nextIndex = counterStore.get(counterKey);
  const startIndex = nextIndex === undefined ? 1 : nextIndex + 1;

  for (let index = startIndex; ; index += 1) {
    const fileName =
      input.alwaysNumbered === true
        ? `${input.prefix}-${index}${extension}`
        : index === 1
          ? `${input.prefix}${extension}`
          : `${input.prefix}-${index}${extension}`;
    const resolvedPath = resolveArtifactPath({
      category: input.category,
      fileName,
      logDirPath: input.logDirPath,
    });

    if (resolvedPath === undefined) {
      return undefined;
    }

    if (!existsSync(resolvedPath)) {
      counterStore.set(counterKey, index);
      return resolvedPath;
    }
  }
}

function createLogger(input: {
  readonly eventLogPath?: string;
  readonly operation: string;
  readonly runId: string;
  readonly verbose: boolean;
}): CoreLogger {
  if (input.eventLogPath === undefined && !input.verbose) {
    return silentLogger;
  }

  return new BufferedLogger(input.eventLogPath, input.verbose);
}

/**
 * A tiny logger kept in core so logging does not pull a Node-only logger into
 * the portable package. Hosts provide the actual append implementation via
 * the platform adapter; writes are serialized and flushed at the end of a
 * logging context.
 */
class BufferedLogger implements CoreLogger {
  #pending: Promise<void> = Promise.resolve();

  public constructor(
    private readonly eventLogPath: string | undefined,
    private readonly verbose: boolean,
  ) {}

  public child(_bindings: Record<string, unknown>): CoreLogger {
    // Bindings are intentionally not rendered in the human-oriented run log.
    return this;
  }

  public debug(...args: unknown[]): void {
    this.#write("DEBUG", args);
  }

  public error(...args: unknown[]): void {
    this.#write("ERROR", args);
  }

  public info(...args: unknown[]): void {
    this.#write("INFO", args);
  }

  public warn(...args: unknown[]): void {
    this.#write("WARN", args);
  }

  public async flush(): Promise<void> {
    await this.#pending;
  }

  #write(level: string, args: readonly unknown[]): void {
    const line = `${level} ${formatLogArguments(args)}\n`;

    if (this.eventLogPath !== undefined) {
      this.#pending = this.#pending.then(async () => {
        await appendFile(this.eventLogPath!, line, "utf8");
      });
    }

    if (this.verbose) {
      const stderr = platformProcess.stderr;
      if (stderr !== undefined && typeof stderr.write === "function") {
        stderr.write(line);
      }
    }
  }
}

function formatLogArguments(args: readonly unknown[]): string {
  if (args.length === 0) {
    return "";
  }

  return args
    .map((value) => {
      if (typeof value === "string") {
        return value;
      }
      if (value instanceof Error) {
        return value.stack ?? value.message;
      }
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(" ");
}

function createRunId(): string {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = pad(now.getUTCMonth() + 1);
  const day = pad(now.getUTCDate());
  const hours = pad(now.getUTCHours());
  const minutes = pad(now.getUTCMinutes());
  const seconds = pad(now.getUTCSeconds());

  return `${year}${month}${day}-${hours}${minutes}${seconds}-${randomUUID().slice(0, 8)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
