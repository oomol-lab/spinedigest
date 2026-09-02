import { rm } from "../../../runtime/platform/index.js";
import { resolve, type File } from "../../../runtime/platform/index.js";

import {
  createWikiGraphTempDirectory,
  type WikiGraphTempCategory,
} from "../../../runtime/common/wiki-graph/temp.js";
import type { DocumentFileStore } from "../../../document/directory/index.js";

import { extractWikgArchive } from "../archive/index.js";

import { WikgDocumentFileStore } from "./file-store.js";
import { WikgArchiveSession } from "./session.js";
import {
  HostWikgArchiveSession,
  withHostArchiveSession,
} from "./host-session.js";
import type { WorkspaceWritebackPolicy } from "./types.js";

export class WikgCoordinator {
  public createFileStore(
    archivePath: File | string,
    options: {
      readonly readonlyDatabase?: boolean;
      readonly searchIndexWritebackPolicy?: WorkspaceWritebackPolicy;
      readonly session?: WikgArchiveSession | HostWikgArchiveSession;
    } = {},
  ): DocumentFileStore {
    if (typeof archivePath !== "string") {
      if (!(options.session instanceof HostWikgArchiveSession)) {
        throw new Error("Opaque archive files require an active session.");
      }
      return options.session.createFileStore(options);
    }
    return new WikgDocumentFileStore(resolve(archivePath), {
      ...(options.readonlyDatabase === undefined
        ? {}
        : { readonlyDatabase: options.readonlyDatabase }),
      ...(options.searchIndexWritebackPolicy === undefined
        ? {}
        : { searchIndexWritebackPolicy: options.searchIndexWritebackPolicy }),
      ...(options.session instanceof WikgArchiveSession
        ? { session: options.session }
        : {}),
    });
  }

  public async withArchiveSession<T>(
    archivePath: File | string,
    operation: (
      session: WikgArchiveSession | HostWikgArchiveSession,
    ) => Promise<T> | T,
  ): Promise<T> {
    if (typeof archivePath !== "string") {
      return await withHostArchiveSession(archivePath, operation);
    }
    const session = await WikgArchiveSession.open(resolve(archivePath));

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
    if (typeof archivePath !== "string") {
      throw new Error(
        "Opaque archive files cannot be materialized to an operating-system path.",
      );
    }
    const directoryPath =
      options.documentDirPath === undefined
        ? await createWorkspaceDirectory("archive-open")
        : resolve(options.documentDirPath);

    try {
      await extractWikgArchive(resolve(archivePath), directoryPath);
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
    if (typeof archivePath !== "string") {
      throw new Error(
        "Opaque archive files cannot be materialized to an operating-system path.",
      );
    }
    const directoryPath = await createWorkspaceDirectory("archive-write");

    try {
      await extractWikgArchive(resolve(archivePath), directoryPath);
      return await operation(directoryPath);
    } finally {
      await rm(directoryPath, { force: true, recursive: true });
    }
  }
}

async function createWorkspaceDirectory(
  prefix: Extract<WikiGraphTempCategory, "archive-open" | "archive-write">,
): Promise<string> {
  return await createWikiGraphTempDirectory(prefix);
}
