import {
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "../../runtime/platform/index.js";
import { join } from "../../runtime/platform/index.js";

import { isNodeError } from "../../utils/node-error.js";
import type { DocumentFileStore } from "./types.js";

export const LOCAL_DOCUMENT_FILE_STORE: DocumentFileStore = {
  close: () => Promise.resolve(),
  deleteFile: async (path) => {
    await unlink(path);
  },
  deleteTree: async (path) => {
    await rm(path, { force: true, recursive: true });
  },
  ensureDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  initializeDatabaseSchema: () => true,
  markDatabaseDirty: () => undefined,
  markSearchIndexDatabaseDirty: () => undefined,
  openDatabaseReadonly: () => false,
  listFiles: async (path) =>
    (await readdir(path, { withFileTypes: true }))
      .filter((entry: any) => entry.isFile())
      .map((entry: any) => entry.name),
  readFile: async (path) => {
    try {
      return await readFile(path);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  },
  resolveDatabasePath: (documentPath) =>
    Promise.resolve(join(documentPath, "database.db")),
  resolveSearchIndexDatabasePath: (documentPath) =>
    Promise.resolve(join(documentPath, "index.db")),
  writeFile: async (path, content, options) => {
    if (typeof content === "string") {
      await writeFile(path, content, {
        encoding: "utf8",
        flag: options.overwrite === true ? "w" : "wx",
      });
    } else {
      await writeFile(path, content, {
        flag: options.overwrite === true ? "w" : "wx",
      });
    }
  },
};
