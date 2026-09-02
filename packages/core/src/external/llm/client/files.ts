import {
  existsSync,
  mkdirSync,
  statSync,
} from "../../../runtime/platform/index.js";
import { resolve } from "../../../runtime/platform/index.js";

import { LLMCache } from "../cache.js";

export function ensureDirectoryPath(dirPath?: string): string | undefined {
  if (dirPath === undefined) {
    return undefined;
  }

  const resolvedDirPath = resolve(dirPath);

  if (!existsSync(resolvedDirPath)) {
    mkdirSync(resolvedDirPath, { recursive: true });
    return resolvedDirPath;
  }

  if (!statSync(resolvedDirPath).isDirectory()) {
    return undefined;
  }

  return resolvedDirPath;
}

export function createCache(cacheDirPath?: string): LLMCache | undefined {
  const resolvedCacheDirPath = ensureDirectoryPath(cacheDirPath);

  if (resolvedCacheDirPath === undefined) {
    return undefined;
  }

  return new LLMCache(resolvedCacheDirPath);
}
