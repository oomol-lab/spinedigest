import type { TextStreamFileAccess } from "./types.js";

function unavailable(): never {
  throw new Error("Text stream storage requires a host Directory adapter.");
}

/** Compatibility sentinel; production documents always inject host storage. */
export const DEFAULT_FILE_ACCESS: TextStreamFileAccess = {
  deleteTree: async () => unavailable(),
  ensureDirectory: async () => unavailable(),
  listFiles: async () => unavailable(),
  readFile: async () => unavailable(),
  writeFile: async () => unavailable(),
};
