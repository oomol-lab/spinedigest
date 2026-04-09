import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { LLMessage, PendingCacheEntry } from "./types.js";

export function createCacheKey(input: {
  messages: readonly LLMessage[];
  temperature: number | undefined;
  topP: number | undefined;
  modelId: string;
}): string {
  const cacheData = JSON.stringify(
    {
      messages: input.messages.map((message) => ({
        content: message.content,
        role: message.role,
      })),
      modelId: input.modelId,
      temperature: input.temperature ?? null,
      topP: input.topP ?? null,
    },
    undefined,
    0,
  );

  return createHash("sha512").update(cacheData, "utf8").digest("hex");
}

export function getCacheFilePath(
  cacheDirPath: string,
  cacheKey: string,
): string {
  return join(cacheDirPath, `${cacheKey}.txt`);
}

export async function readCachedResponse(
  cacheDirPath: string,
  cacheKey: string,
): Promise<string | undefined> {
  try {
    return await readFile(getCacheFilePath(cacheDirPath, cacheKey), "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function writeCachedResponse(
  entry: PendingCacheEntry,
): Promise<void> {
  await writeFile(entry.path, entry.response, "utf8");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
