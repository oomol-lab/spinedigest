import { AsyncLocalStorage } from "async_hooks";

export interface WikiGraphCLIRuntimeContext {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stderr: NodeJS.WritableStream;
  readonly stderrIsTTY?: boolean | undefined;
  readonly stdin: NodeJS.ReadableStream & { isTTY?: boolean | undefined };
  readonly stdinIsTTY?: boolean | undefined;
  readonly stdout: NodeJS.WritableStream;
  readonly stdoutIsTTY?: boolean | undefined;
  exitCode: NodeJS.Process["exitCode"];
}

const cliRuntimeContext = new AsyncLocalStorage<WikiGraphCLIRuntimeContext>();

export async function withWikiGraphCLIRuntimeContext<T>(
  context: WikiGraphCLIRuntimeContext,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await cliRuntimeContext.run(context, operation);
}

export function getCLIArgv(): readonly string[] {
  return cliRuntimeContext.getStore()?.argv ?? process.argv.slice(2);
}

export function getCLICwd(): string {
  return cliRuntimeContext.getStore()?.cwd ?? process.cwd();
}

export function getCLIEnv(): NodeJS.ProcessEnv {
  return cliRuntimeContext.getStore()?.env ?? process.env;
}

export function getCLIEnvValue(name: string): string | undefined {
  return getCLIEnv()[name];
}

export function getCLIStdin(): NodeJS.ReadableStream & {
  isTTY?: boolean | undefined;
} {
  return (
    cliRuntimeContext.getStore()?.stdin ??
    (process.stdin as NodeJS.ReadableStream & { isTTY?: boolean | undefined })
  );
}

export function getCLIStdout(): NodeJS.WritableStream {
  return cliRuntimeContext.getStore()?.stdout ?? process.stdout;
}

export function getCLIStderr(): NodeJS.WritableStream {
  return cliRuntimeContext.getStore()?.stderr ?? process.stderr;
}

export function getCLIStdoutIsTTY(): boolean | undefined {
  const context = cliRuntimeContext.getStore();

  return (
    context?.stdoutIsTTY ??
    (getCLIStdout() as NodeJS.WritableStream & { isTTY?: boolean }).isTTY
  );
}

export function getCLIExitCode(): NodeJS.Process["exitCode"] {
  return cliRuntimeContext.getStore()?.exitCode ?? process.exitCode;
}

export function setCLIExitCode(exitCode: NodeJS.Process["exitCode"]): void {
  const context = cliRuntimeContext.getStore();

  if (context === undefined) {
    process.exitCode = exitCode;
    return;
  }

  context.exitCode = exitCode;
}
