import type { Directory } from "../../../runtime/platform/index.js";
import { LLMCache } from "../cache.js";

export function createCache(directory?: Directory): LLMCache | undefined {
  return directory === undefined ? undefined : new LLMCache(directory);
}
