import type { LLMCache } from "./cache.js";
import type {
  LLMessage,
  LLMContextRequest,
  LLMRequestOptions,
  PendingCacheEntry,
} from "./types.js";

export class LLMContext {
  readonly #cache: LLMCache | undefined;
  readonly #pendingCacheEntries = new Map<string, PendingCacheEntry>();
  readonly #requestFn: LLMContextRequest;
  readonly #logFiles: string[] = [];
  #finalized = false;
  public readonly sessionId: number;

  public constructor(
    sessionId: number,
    requestFn: LLMContextRequest,
    cache?: LLMCache,
  ) {
    this.sessionId = sessionId;
    this.#cache = cache;
    this.#requestFn = requestFn;
  }

  public async request(
    systemPrompt: string,
    userMessage: string,
    options: LLMRequestOptions = {},
  ): Promise<string> {
    return await this.requestWithHistory(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      options,
    );
  }

  public async requestWithHistory(
    messages: readonly LLMessage[],
    options: LLMRequestOptions = {},
  ): Promise<string> {
    this.#assertActive();

    return await this.#requestFn(
      messages,
      options,
      this.#pendingCacheEntries,
      this.#logFiles,
    );
  }

  public async commit(): Promise<void> {
    if (this.#finalized) {
      return;
    }

    for (const entry of this.#pendingCacheEntries.values()) {
      if (this.#cache !== undefined) {
        await this.#cache.write(entry);
      }
    }

    this.#pendingCacheEntries.clear();
    this.#finalized = true;
  }

  public rollback(): Promise<void> {
    if (!this.#finalized) {
      this.#pendingCacheEntries.clear();
      this.#finalized = true;
    }

    return Promise.resolve();
  }

  public async run<T>(
    operation: (context: LLMContext) => Promise<T>,
  ): Promise<T> {
    try {
      const result = await operation(this);
      await this.commit();
      return result;
    } catch (error) {
      await this.rollback();
      this.#printLogFiles();
      throw error;
    }
  }

  #assertActive(): void {
    if (this.#finalized) {
      throw new Error("LLMContext is already finalized");
    }
  }

  #printLogFiles(): void {
    if (this.#logFiles.length === 0) {
      return;
    }

    console.log(
      `\n[LLMContext] Failed with ${this.#logFiles.length} log file(s):`,
    );

    for (const [index, logFile] of this.#logFiles.entries()) {
      console.log(`  ${index + 1}. ${logFile}`);
    }
  }
}
