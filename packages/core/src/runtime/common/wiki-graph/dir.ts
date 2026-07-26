import { AsyncLocalStorage } from "async_hooks";
import { homedir } from "os";
import { join, resolve } from "path";

const testingStateDirectoryPath = new AsyncLocalStorage<{
  readonly path: string | undefined;
}>();
const runtimeEnvironment = new AsyncLocalStorage<NodeJS.ProcessEnv>();

export function resolveWikiGraphHomeDirectoryPath(): string {
  const testingStateDirPath = testingStateDirectoryPath.getStore()?.path;

  if (testingStateDirPath !== undefined && testingStateDirPath.trim() !== "") {
    return resolve(testingStateDirPath);
  }

  const environment = runtimeEnvironment.getStore() ?? process.env;
  const devStateDirPath = environment.WIKIGRAPH_DEV;

  if (devStateDirPath !== undefined && devStateDirPath.trim() !== "") {
    return resolve(devStateDirPath);
  }

  const legacyStateDirPath = environment.WIKIGRAPH_STATE_DIR;

  if (legacyStateDirPath !== undefined && legacyStateDirPath.trim() !== "") {
    return resolve(legacyStateDirPath);
  }

  return join(homedir(), ".wikigraph");
}

export function setWikiGraphStateDirectoryPathForTesting(
  path: string | undefined,
): void {
  testingStateDirectoryPath.enterWith({ path });

  if (path === undefined) {
    delete process.env.WIKIGRAPH_DEV;
    return;
  }

  process.env.WIKIGRAPH_DEV = path;
}

export async function withWikiGraphStateDirectoryPathForTesting<T>(
  path: string | undefined,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await testingStateDirectoryPath.run({ path }, operation);
}

export async function withWikiGraphRuntimeEnvironment<T>(
  environment: NodeJS.ProcessEnv,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await runtimeEnvironment.run(environment, operation);
}

export function getWikiGraphStateDirectoryPathForTesting(): string | undefined {
  return process.env.WIKIGRAPH_DEV;
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
