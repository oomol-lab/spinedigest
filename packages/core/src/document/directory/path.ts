import { join, resolve } from "../../runtime/platform/index.js";

/** Preserve logical archive names without asking the host to resolve a path. */
export function resolveDocumentPath(path: string): string {
  return path === "" ? "" : resolve(path);
}

/** Join relative document names; OS paths remain a legacy string concern. */
export function joinDocumentPath(root: string, ...parts: string[]): string {
  return isLogicalRoot(root)
    ? [root, ...parts].filter((part) => part !== "").join("/")
    : join(root, ...parts);
}

function isLogicalRoot(root: string): boolean {
  return (
    root === "" || (!root.startsWith("/") && !/^[A-Za-z]:[\\/]/u.test(root))
  );
}
