import {
  getWikiGraphPlatform,
  getWikiGraphStorage,
  installWikiGraphStorage,
  withWikiGraphStorage,
  type Directory,
  type File,
  type WikiGraphStorage,
  type HostAsyncContext,
} from "../../platform/index.js";

let testingStateDirectoryIdentity: string | undefined;
let defaultStorage: WikiGraphStorage | undefined;
let testingIdentityContext: HostAsyncContext<string | undefined> | undefined;

/**
 * Compatibility helper for tests that predate host-owned storage roots.
 * The supplied value is an opaque resource identity from Core's perspective.
 */
export function setWikiGraphStateDirectoryPathForTesting(
  identity: string | undefined,
): void {
  if (defaultStorage === undefined) defaultStorage = getWikiGraphStorage();
  testingStateDirectoryIdentity = identity;
  getTestingIdentityContext().enterWith(identity);
  installWikiGraphStorage(
    identity === undefined ? defaultStorage : storageForIdentity(identity),
  );
}

export async function withWikiGraphStateDirectoryPathForTesting<T>(
  identity: string | undefined,
  operation: () => Promise<T> | T,
): Promise<T> {
  const context = getTestingIdentityContext();
  return await context.run(
    identity,
    async () =>
      await withWikiGraphStorage(
        identity === undefined ? undefined : storageForIdentity(identity),
        operation,
      ),
  );
}

export function getWikiGraphStateDirectoryPathForTesting(): string | undefined {
  return (
    getTestingIdentityContext().getStore() ?? testingStateDirectoryIdentity
  );
}

/** @deprecated Core no longer owns a runtime state path. */
export function resolveWikiGraphHomeDirectoryPath(): string {
  const library = getWikiGraphStorage().library;
  return (
    getTestingIdentityContext().getStore() ??
    testingStateDirectoryIdentity ??
    (library instanceof ResolvedDirectory
      ? library.compatibilityIdentity
      : library.identity)
  );
}

function getTestingIdentityContext(): HostAsyncContext<string | undefined> {
  testingIdentityContext ??= getWikiGraphPlatform().asyncContext.create<
    string | undefined
  >();
  return testingIdentityContext;
}

/** @deprecated Pass WikiGraphStorage to the Core operation instead. */
export async function withWikiGraphRuntimeStateDirectoryPath<T>(
  identity: string | undefined,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await withWikiGraphStateDirectoryPathForTesting(identity, operation);
}

/** @deprecated Runtime environment objects are not a Core storage API. */
export async function withWikiGraphRuntimeEnvironment<T>(
  _environment: Record<string, string | undefined>,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await operation();
}

export function resolveWikiGraphCoreDatabasePath(): string {
  return logicalChild(resolveWikiGraphHomeDirectoryPath(), "core.sqlite");
}

export function resolveWikiGraphCacheDirectoryPath(): string {
  return logicalChild(resolveWikiGraphHomeDirectoryPath(), "cache");
}

export function resolveWikiGraphCacheDatabasePath(): string {
  return logicalChild(resolveWikiGraphCacheDirectoryPath(), "cache.sqlite");
}

export function resolveWikiGraphJobsDirectoryPath(): string {
  return logicalChild(resolveWikiGraphHomeDirectoryPath(), "jobs");
}

export function resolveWikiGraphStagingDirectoryPath(): string {
  return logicalChild(resolveWikiGraphHomeDirectoryPath(), "staging");
}

export function resolveWikiGraphTempRootDirectoryPath(): string {
  return logicalChild(resolveWikiGraphHomeDirectoryPath(), "tmp");
}

export function resolveWikiGraphLogsDirectoryPath(): string {
  return logicalChild(resolveWikiGraphHomeDirectoryPath(), "logs");
}

function storageForIdentity(identity: string): WikiGraphStorage {
  return {
    library: new ResolvedDirectory(identity, []),
    documentStore: new ResolvedDirectory(identity, ["documents"]),
  };
}

/** Lazily resolves a test-owned directory after the async host is installed. */
class ResolvedDirectory implements Directory {
  public readonly identity: string;
  public readonly name: string;
  readonly #rootIdentity: string;
  readonly #parts: readonly string[];

  public constructor(rootIdentity: string, parts: readonly string[]) {
    this.#rootIdentity = rootIdentity;
    this.#parts = parts;
    this.identity = `${rootIdentity}#${parts.join("/")}`;
    this.name = parts.at(-1) ?? "wikigraph";
  }

  public get compatibilityIdentity(): string {
    return this.#parts.length === 0
      ? this.#rootIdentity
      : `${this.#rootIdentity}/${this.#parts.join("/")}`;
  }

  public async getLastModified(): Promise<number | undefined> {
    return await (await this.#resolve(false))?.getLastModified?.();
  }

  public async getFile(name: string): Promise<File | undefined> {
    return await (await this.#resolve(false))?.getFile(name);
  }

  public async getDirectory(name: string): Promise<Directory | undefined> {
    const child = new ResolvedDirectory(this.#rootIdentity, [
      ...this.#parts,
      name,
    ]);
    return (await child.#resolve(false)) === undefined ? undefined : child;
  }

  public async list(): Promise<ReadonlyArray<File | Directory>> {
    return (await this.#resolve(false))?.list() ?? [];
  }

  public async createFile(name: string): Promise<File> {
    const directory = await this.#resolve(true);
    if (directory === undefined)
      throw new Error("Host directory is unavailable");
    return await directory.createFile(name);
  }

  public async createDirectory(name: string): Promise<Directory> {
    const directory = await this.#resolve(true);
    if (directory === undefined)
      throw new Error("Host directory is unavailable");
    return (
      (await directory.getDirectory(name)) ??
      (await directory.createDirectory(name))
    );
  }

  public async remove(
    name: string,
    options?: { readonly recursive?: boolean },
  ): Promise<void> {
    const directory = await this.#resolve(true);
    if (directory === undefined)
      throw new Error("Host directory is unavailable");
    await directory.remove(name, options);
  }

  async #resolve(create: boolean): Promise<Directory | undefined> {
    let directory = await getWikiGraphPlatform().resources.getDirectory(
      this.#rootIdentity,
    );
    if (directory === undefined) return undefined;
    for (const part of this.#parts) {
      directory =
        (await directory.getDirectory(part)) ??
        (create ? await directory.createDirectory(part) : undefined);
      if (directory === undefined) return undefined;
    }
    return directory;
  }
}

function logicalChild(parent: string, child: string): string {
  return `${parent.replace(/\/$/u, "")}/${child}`;
}
