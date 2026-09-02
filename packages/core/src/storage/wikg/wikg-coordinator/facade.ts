import { rm } from "../../../runtime/platform/index.js";
import {
  getPlatformFilePath,
  resolve,
  type File,
} from "../../../runtime/platform/index.js";

import { createWikiGraphTempDirectory } from "../../../runtime/common/wiki-graph/temp.js";
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
        : getPlatformFilePath(archivePath);
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
        ? await createWikiGraphTempDirectory("archive-open")
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
    const directoryPath = await createWikiGraphTempDirectory("archive-write");

    try {
      await extractWikgArchive(toArchivePath(archivePath), directoryPath);
      return await operation(directoryPath);
    } finally {
      await rm(directoryPath, { force: true, recursive: true });
    }
  }
}

function toArchivePath(archivePath: File | string): string {
  return typeof archivePath === "string"
    ? resolve(archivePath)
    : getPlatformFilePath(archivePath);
}
