import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { dirname, join, resolve } from "path";

import pino, {
  multistream,
  type Logger as PinoLogger,
  type StreamEntry,
} from "pino";
import pretty from "pino-pretty";

interface LoggingContext {
  readonly artifactRootDirPath?: string;
  readonly logger: PinoLogger;
  readonly rootLogDirPath?: string;
  readonly runId: string;
}

const loggingContext = new AsyncLocalStorage<LoggingContext>();
const silentLogger = pino({ enabled: false });

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
    rootLogDirPath === undefined
      ? undefined
      : join(rootLogDirPath, "runs", runId);
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
      : { eventLogPath: join(runDirPath, "events.jsonl") }),
  });

  return await loggingContext.run(
    {
      logger,
      runId,
      ...(artifactRootDirPath === undefined ? {} : { artifactRootDirPath }),
      ...(rootLogDirPath === undefined ? {} : { rootLogDirPath }),
    },
    operation,
  );
}

export function getLogger(bindings?: Record<string, unknown>): PinoLogger {
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
    context?.rootLogDirPath === rootLogDirPath &&
    context.artifactRootDirPath !== undefined
  ) {
    const categoryDirPath = join(context.artifactRootDirPath, input.category);

    mkdirSync(categoryDirPath, { recursive: true });

    return join(categoryDirPath, input.fileName);
  }

  mkdirSync(rootLogDirPath, { recursive: true });

  return join(rootLogDirPath, input.fileName);
}

function createLogger(input: {
  readonly eventLogPath?: string;
  readonly operation: string;
  readonly runId: string;
  readonly verbose: boolean;
}): PinoLogger {
  const streams: StreamEntry[] = [];

  if (input.eventLogPath !== undefined) {
    mkdirSync(dirname(input.eventLogPath), { recursive: true });
    streams.push({
      level: "info",
      stream: pino.destination({
        dest: input.eventLogPath,
        sync: false,
      }),
    });
  }

  if (input.verbose) {
    streams.push({
      level: "info",
      stream: pretty({
        colorize: false,
        destination: process.stderr,
        ignore: "pid,hostname",
        singleLine: true,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
      }),
    });
  }

  if (streams.length === 0) {
    return silentLogger;
  }

  return pino(
    {
      base: null,
      level: "info",
    },
    multistream(streams),
  ).child({
    operation: input.operation,
    runId: input.runId,
  });
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
