import { resolve } from "path";

export function resolveDevProjectRoot(stateDirPath: string): string {
  return resolve(stateDirPath, "..", "..");
}

export function resolveDevStateDirectoryPath(): string {
  return resolve(import.meta.dirname, "../../../../.wikigraph/state");
}
