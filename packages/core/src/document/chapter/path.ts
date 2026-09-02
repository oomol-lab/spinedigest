import { bytesToHex } from "../../utils/bytes.js";
import { randomBytes } from "../../utils/crypto.js";

import type { TocItem } from "../../text/source/index.js";

export const RESERVED_CHAPTER_KEYS = new Set([
  "tree",
  "source",
  "summary",
  "title",
  "state",
  "chunk",
  "entity",
  "triple",
  "cover",
  "meta",
  "job",
  "help",
]);

const CHAPTER_KEY_RANDOM_BYTES = 6;
const CREATE_CHAPTER_KEY_MAX_ATTEMPTS = 100;

export function formatChapterUri(path: string): string {
  return `wikg://chapter/${path}`;
}

export function parseChapterPath(
  value: string,
  label = "chapter path",
): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new Error(`Invalid ${label}: expected an absolute chapter path.`);
  }
  if (/^\d+$/u.test(normalized)) {
    throw new Error(
      `Invalid ${label}: numeric chapter ids are internal and are not accepted.`,
    );
  }
  if (normalized.startsWith("/") || normalized.endsWith("/")) {
    throw new Error(
      `Invalid ${label}: use <key>[/<key>]* without leading or trailing slash.`,
    );
  }
  const parts = normalized.split("/");
  for (const part of parts) {
    validateChapterKey(part, label);
  }
  return parts.join("/");
}

export function parseChapterUriPath(uri: string): string | undefined {
  const match = /^wikg:\/\/chapter\/(.+)$/u.exec(uri.trim());
  if (match?.[1] === undefined) {
    return undefined;
  }
  return parseChapterPath(match[1], "chapter URI");
}

export function validateChapterKey(key: string, label = "chapter key"): string {
  if (key === "" || key === "." || key === ".." || key.includes("/")) {
    throw new Error(
      `Invalid ${label}: chapter paths do not support empty, '.', '..', or relative segments.`,
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(key)) {
    throw new Error(
      `Invalid ${label}: ${key}. Use lowercase letters, numbers, and hyphens.`,
    );
  }
  if (/^\d+$/u.test(key)) {
    throw new Error(`Invalid ${label}: numeric chapter keys are not accepted.`);
  }
  if (RESERVED_CHAPTER_KEYS.has(key)) {
    throw new Error(`Invalid ${label}: ${key} is reserved.`);
  }
  return key;
}

export function createChapterKey(existingKeys: ReadonlySet<string>): string {
  for (
    let attempt = 0;
    attempt < CREATE_CHAPTER_KEY_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const candidate = bytesToHex(randomBytes(CHAPTER_KEY_RANDOM_BYTES));

    try {
      validateChapterKey(candidate);
    } catch {
      continue;
    }
    if (!existingKeys.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to create a unique chapter key after ${CREATE_CHAPTER_KEY_MAX_ATTEMPTS} attempts.`,
  );
}

export function resolveChapterIdByPath(
  items: readonly TocItem[],
  chapterPath: string,
): number | undefined {
  const parts = parseChapterPath(chapterPath).split("/");
  let siblings = items;
  let current: TocItem | undefined;
  for (const part of parts) {
    current = siblings.find((item) => item.key === part);
    if (current === undefined) {
      return undefined;
    }
    siblings = current.children;
  }
  return current?.serialId;
}

export function collectChapterKeys(
  items: readonly TocItem[],
  keys = new Set<string>(),
): Set<string> {
  for (const item of items) {
    if (item.key !== undefined) {
      keys.add(item.key);
    }
    collectChapterKeys(item.children, keys);
  }
  return keys;
}

export function collectChapterPathById(
  items: readonly TocItem[],
  chapterId: number,
  prefix: readonly string[] = [],
): string | undefined {
  for (const item of items) {
    if (item.key === undefined) {
      continue;
    }
    const path = [...prefix, item.key];
    if (item.serialId === chapterId) {
      return path.join("/");
    }
    const childPath = collectChapterPathById(item.children, chapterId, path);
    if (childPath !== undefined) {
      return childPath;
    }
  }
  return undefined;
}
