import { joinRelativePath } from "../../utils/relative-path.js";

/** Preserve logical archive names without asking the host to resolve a path. */
export function resolveDocumentPath(path: string): string {
  return path === "" ? "" : joinRelativePath(path);
}

/** Join relative document names; OS paths remain a legacy string concern. */
export function joinDocumentPath(root: string, ...parts: string[]): string {
  return joinRelativePath(root, ...parts);
}
