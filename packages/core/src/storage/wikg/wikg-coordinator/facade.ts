import {
  getWikiGraphStorage,
  join,
  mkdir,
  randomUUID,
  rm,
} from "../../../runtime/platform/index.js";
import {
  resolve,
  resolveFilePath,
  type File,
} from "../../../runtime/platform/index.js";

import {
  createWikiGraphTempDirectory,
  type WikiGraphTempCategory,
} from "../../../runtime/common/wiki-graph/temp.js";
import type { DocumentFileStore } from "../../../document/directory/index.js";

import { extractWikgArchive } from "../archive/index.js";

import { WikgDocumentFileStore } from "./file-store.js";
import { WikgArchiveSession } from "./session.js";
import type { WorkspaceWritebackPolicy } from "./types.js";

export class WikgCoordinator {
  public createFileStore(
    archivePath: File | string,
    options: {
      readonly readonlyDatabase?: boolean;
      readonly searchIndexWritebackPolicy?: WorkspaceWritebackPolicy;
      readonly session?: WikgArchiveSession;
    } = {},
  ): DocumentFileStore {
    const path =
      typeof archivePath === "string"
        ? resolve(archivePath)
        : (archivePath as unknown as string);
    return new WikgDocumentFileStore(path, options);
  }

  public async withArchiveSession<T>(
    archivePath: File | string,
    operation: (session: WikgArchiveSession) => Promise<T> | T,
  ): Promise<T> {
    const session = await WikgArchiveSession.open(toArchivePath(archivePath));

    try {
      return await operation(session);
    } finally {
      await session.close();
    }
  }

  public async withReadWorkspace<T>(
    archivePath: File | string,
    operation: (documentDirectoryPath: string) => Promise<T> | T,
    options: {
      readonly documentDirPath?: string;
    } = {},
  ): Promise<T> {
    const directoryPath =
      options.documentDirPath === undefined
        ? await createWorkspaceDirectory("archive-open")
        : resolve(options.documentDirPath);

    try {
      await extractWikgArchive(toArchivePath(archivePath), directoryPath);
      return await operation(directoryPath);
    } finally {
      if (options.documentDirPath === undefined) {
        await rm(directoryPath, { force: true, recursive: true });
      }
    }
  }

  public async withWriteWorkspace<T>(
    archivePath: File | string,
    operation: (documentDirectoryPath: string) => Promise<T> | T,
  ): Promise<T> {
    const directoryPath = await createWorkspaceDirectory("archive-write");

    try {
      await extractWikgArchive(toArchivePath(archivePath), directoryPath);
      return await operation(directoryPath);
    } finally {
      await rm(directoryPath, { force: true, recursive: true });
    }
  }
}

async function createWorkspaceDirectory(
  prefix: Extract<WikiGraphTempCategory, "archive-open" | "archive-write">,
): Promise<string> {
  // Prefer the host-provided document store for transient materialization so
  // browser/extension hosts can scope all document I/O to one Directory.
  try {
    const root = getWikiGraphStorage().documentStore as unknown as string;
    const directoryPath = join(root, `.wikg-${prefix}-${randomUUID()}`);
    await mkdir(directoryPath, { recursive: true });
    return directoryPath;
  } catch {
    return await createWikiGraphTempDirectory(prefix);
  }
}

function toArchivePath(archivePath: File | string): string {
  return resolve(resolveFilePath(archivePath));
}
