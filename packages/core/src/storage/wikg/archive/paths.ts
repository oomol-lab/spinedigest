import { posix, resolve, sep } from "../../../runtime/platform/index.js";

import {
  WIKG_ARCHIVE_PATTERNS,
  WIKG_MUTATION_TOKEN_PATH,
} from "./constants.js";

export function normalizeArchivePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").trim();
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error(`Path must remain relative to its host-provided root: ${path}`);
  }
  const withoutLeadingSlash = normalized.startsWith("/")
    ? normalized.slice(1)
    : normalized;

  const result = posix
    .normalize(withoutLeadingSlash)
    .replace(/^(\.\/)+/u, "")
    .replace(/^\/+/u, "");
  assertSafeRelativePath(result);
  return result;
}

/** Reject archive/workspace names that could escape their injected root. */
export function assertSafeRelativePath(path: string): void {
  if (path.startsWith("/") || path.split("/").some((part) => part === "..")) {
    throw new Error(`Path must remain relative to its host-provided root: ${path}`);
  }
}

export function isWikgArchivePath(archivePath: string): boolean {
  return WIKG_ARCHIVE_PATTERNS.some((pattern) => pattern.test(archivePath));
}

export function assertWithinDirectory(
  rootDirectoryPath: string,
  targetPath: string,
  archivePath: string,
): void {
  const resolvedRootDirectoryPath = resolve(rootDirectoryPath);
  const rootPrefix = resolvedRootDirectoryPath.endsWith(sep)
    ? resolvedRootDirectoryPath
    : `${resolvedRootDirectoryPath}${sep}`;

  if (
    targetPath === resolvedRootDirectoryPath ||
    targetPath.startsWith(rootPrefix)
  ) {
    return;
  }

  throw new Error(`Invalid archive entry path: ${archivePath}`);
}

export function sortArchiveEntriesForWrite<
  T extends { readonly archivePath: string },
>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) =>
    compareArchiveEntryPathsForWrite(left.archivePath, right.archivePath),
  );
}

export function sortArchiveEntryPathsForWrite(
  paths: Iterable<string>,
): string[] {
  return [...paths].sort(compareArchiveEntryPathsForWrite);
}

function compareArchiveEntryPathsForWrite(left: string, right: string): number {
  if (left === WIKG_MUTATION_TOKEN_PATH) {
    return right === WIKG_MUTATION_TOKEN_PATH ? 0 : -1;
  }
  if (right === WIKG_MUTATION_TOKEN_PATH) {
    return 1;
  }

  return left.localeCompare(right);
}
