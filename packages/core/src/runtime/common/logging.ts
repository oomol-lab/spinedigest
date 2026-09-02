import {
  appendFileText,
  ensureRelativeDirectory,
  ensureRelativeFile,
  getWikiGraphPlatform,
  type Directory,
  type File,
  type HostAsyncContext,
} from "../platform/index.js";

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
  readonly artifactRoot?: Directory;
  readonly logger: CoreLogger;
  readonly root?: Directory;
}

let loggingContext: HostAsyncContext<LoggingContext> | undefined;
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
    readonly logDirectory?: Directory;
    readonly verbose?: boolean;
  },
  operation: () => Promise<T>,
): Promise<T> {
  let run: Directory | undefined;
  let artifacts: Directory | undefined;
  let eventLog: File | undefined;
  if (input.logDirectory !== undefined) {
    try {
      run = await input.logDirectory.createDirectory(createRunId());
      artifacts = await run.createDirectory("artifacts");
      eventLog = await run.createFile("run.log");
    } catch (error) {
      if (input.verbose === true) {
        globalThis.console.error("Failed to initialize host logging:", error);
      }
    }
  }
  const logger = createLogger(eventLog, input.verbose ?? false);
  loggingContext ??=
    getWikiGraphPlatform().asyncContext.create<LoggingContext>();
  try {
    return await loggingContext.run(
      {
        artifactCounters: new Map(),
        logger,
        ...(artifacts === undefined ? {} : { artifactRoot: artifacts }),
        ...(run === undefined || input.logDirectory === undefined
          ? {}
          : { root: input.logDirectory }),
      },
      operation,
    );
  } finally {
    await logger.flush();
  }
}

export function getLogger(bindings?: Record<string, unknown>): CoreLogger {
  const logger = loggingContext?.getStore()?.logger ?? silentLogger;
  return bindings === undefined ? logger : logger.child(bindings);
}

export async function resolveArtifactFile(input: {
  readonly category: string;
  readonly fileName: string;
  readonly logDirectory?: Directory;
}): Promise<File | undefined> {
  if (input.logDirectory === undefined) return undefined;
  const context = loggingContext?.getStore();
  const root =
    context?.root?.identity === input.logDirectory.identity &&
    context.artifactRoot
      ? context.artifactRoot
      : input.logDirectory;
  return await ensureRelativeFile(root, `${input.category}/${input.fileName}`);
}

export async function allocateArtifactFile(input: {
  readonly alwaysNumbered?: boolean;
  readonly category: string;
  readonly extension?: string;
  readonly logDirectory?: Directory;
  readonly prefix: string;
}): Promise<File | undefined> {
  if (input.logDirectory === undefined) return undefined;
  const context = loggingContext?.getStore();
  const counters = context?.artifactCounters ?? artifactCounters;
  const extension = input.extension ?? ".log";
  const key = `${input.logDirectory.identity}:${input.category}:${input.prefix}:${extension}`;
  let index = (counters.get(key) ?? 0) + 1;
  while (true) {
    const name =
      input.alwaysNumbered === true || index > 1
        ? `${input.prefix}-${index}${extension}`
        : `${input.prefix}${extension}`;
    const contextRoot =
      context?.root?.identity === input.logDirectory.identity
        ? context.artifactRoot
        : undefined;
    const root = contextRoot ?? input.logDirectory;
    const category = await ensureRelativeDirectory(root, input.category);
    if ((await category.getFile(name)) === undefined) {
      counters.set(key, index);
      return await category.createFile(name);
    }
    index += 1;
  }
}

class BufferedLogger implements CoreLogger {
  #pending = Promise.resolve();
  public constructor(
    private readonly file: File | undefined,
    private readonly verbose: boolean,
  ) {}
  public child(): CoreLogger {
    return this;
  }
  public debug(...args: unknown[]): void {
    this.write("DEBUG", args);
  }
  public error(...args: unknown[]): void {
    this.write("ERROR", args);
  }
  public info(...args: unknown[]): void {
    this.write("INFO", args);
  }
  public warn(...args: unknown[]): void {
    this.write("WARN", args);
  }
  public async flush(): Promise<void> {
    await this.#pending;
  }
  private write(level: string, args: readonly unknown[]): void {
    const line = `${level} ${formatLogArguments(args)}\n`;
    if (this.file !== undefined) {
      this.#pending = this.#pending
        .then(async () => await appendFileText(this.file!, line))
        .catch((error: unknown) => {
          if (this.verbose) {
            globalThis.console.error("Failed to write host log:", error);
          }
        });
    }
    if (this.verbose) globalThis.console.error(line.trimEnd());
  }
}

function createLogger(file: File | undefined, verbose: boolean): CoreLogger {
  return file === undefined && !verbose
    ? silentLogger
    : new BufferedLogger(file, verbose);
}

function formatLogArguments(args: readonly unknown[]): string {
  return args
    .map((value) => {
      if (typeof value === "string") return value;
      if (value instanceof Error) return value.stack ?? value.message;
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
  const timestamp = now.toISOString().replaceAll(/[-:]/gu, "").slice(0, 15);
  return `${timestamp}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
}
