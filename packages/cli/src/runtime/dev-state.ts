import { resolve } from "path";

export function resolveDevProjectRootPath(): string {
  return resolve(import.meta.dirname, "../../../..");
}

export function resolveDevStateDirectoryPath(): string {
  return resolve(resolveDevProjectRootPath(), ".wikigraph/state");
}
