import { AsyncLocalStorage } from "../../platform/index.js";
import { join, resolve } from "../../platform/index.js";

const testingStateDirectoryPath = new AsyncLocalStorage<{
  readonly path: string | undefined;
}>();
const runtimeStateDirectoryPath = new AsyncLocalStorage<{
  readonly path: string | undefined;
}>();

export function resolveWikiGraphHomeDirectoryPath(): string {
  const testingStateDirPath = testingStateDirectoryPath.getStore()?.path;

  if (testingStateDirPath !== undefined && testingStateDirPath.trim() !== "") {
    return resolve(testingStateDirPath);
  }

  const runtimeStateDirPath = runtimeStateDirectoryPath.getStore()?.path;

  if (runtimeStateDirPath !== undefined && runtimeStateDirPath.trim() !== "") {
    return resolve(runtimeStateDirPath);
  }

  // Core owns only a logical name. The host decides which Directory backs it.
  return ".wikigraph";
}

export function setWikiGraphStateDirectoryPathForTesting(
  path: string | undefined,
): void {
  testingStateDirectoryPath.enterWith({ path });
}

export async function withWikiGraphStateDirectoryPathForTesting<T>(
  path: string | undefined,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await testingStateDirectoryPath.run({ path }, operation);
}

export async function withWikiGraphRuntimeStateDirectoryPath<T>(
  path: string | undefined,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await runtimeStateDirectoryPath.run({ path }, operation);
}

/**
 * @deprecated Runtime state overrides are no longer read from platformRuntime-style
 * environment objects. Use `withWikiGraphRuntimeStateDirectoryPath` instead.
 */
export async function withWikiGraphRuntimeEnvironment<T>(
  _environment: Record<string, string | undefined>,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await operation();
}

export function getWikiGraphStateDirectoryPathForTesting(): string | undefined {
  return testingStateDirectoryPath.getStore()?.path;
}

export function resolveWikiGraphCoreDatabasePath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "core.sqlite");
}

export function resolveWikiGraphCacheDirectoryPath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "cache");
}

export function resolveWikiGraphCacheDatabasePath(): string {
  return join(resolveWikiGraphCacheDirectoryPath(), "cache.sqlite");
}

export function resolveWikiGraphJobsDirectoryPath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "jobs");
}

export function resolveWikiGraphStagingDirectoryPath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "staging");
}

export function resolveWikiGraphTempRootDirectoryPath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "tmp");
}

export function resolveWikiGraphLogsDirectoryPath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "logs");
}
