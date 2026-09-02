import { join } from "path";

import {
  getWikiGraphPlatform,
  getWikiGraphStorage,
  installWikiGraphStorage,
  withWikiGraphStorage,
  type HostAsyncContext,
  type WikiGraphStorage,
} from "../../packages/core/src/runtime/platform/index.js";
import { createNodeWikiGraphStorage } from "../../packages/cli/src/runtime/node-platform.js";

let defaultStorage: WikiGraphStorage | undefined;
let stateDirectoryPath: string | undefined;
let pathContext: HostAsyncContext<string | undefined> | undefined;

/** Node-only compatibility helpers for tests that still select storage by path. */
export function setWikiGraphStateDirectoryPathForTesting(
  path: string | undefined,
): void {
  defaultStorage ??= getWikiGraphStorage();
  stateDirectoryPath = path;
  getPathContext().enterWith(path);
  installWikiGraphStorage(
    path === undefined ? defaultStorage : createNodeWikiGraphStorage(path),
  );
}

export async function withWikiGraphStateDirectoryPathForTesting<T>(
  path: string | undefined,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await getPathContext().run(
    path,
    async () =>
      await withWikiGraphStorage(
        path === undefined ? undefined : createNodeWikiGraphStorage(path),
        operation,
      ),
  );
}

export function getWikiGraphStateDirectoryPathForTesting(): string | undefined {
  return getPathContext().getStore() ?? stateDirectoryPath;
}

export function resolveWikiGraphHomeDirectoryPath(): string {
  const path = getWikiGraphStateDirectoryPathForTesting();
  if (path === undefined) {
    throw new Error("No Node test state directory is active");
  }
  return path;
}

export function resolveWikiGraphCoreDatabasePath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "core.sqlite");
}

export async function withWikiGraphRuntimeStateDirectoryPath<T>(
  path: string | undefined,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await withWikiGraphStateDirectoryPathForTesting(path, operation);
}

function getPathContext(): HostAsyncContext<string | undefined> {
  pathContext ??= getWikiGraphPlatform().asyncContext.create<
    string | undefined
  >();
  return pathContext;
}
