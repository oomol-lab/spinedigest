import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { Environment } from "nunjucks";

import { createEnv } from "../common/template.js";

import { AsyncSemaphore } from "./async-semaphore.js";
import {
  createCacheKey,
  getCacheFilePath,
  readCachedResponse,
  writeCachedResponse,
} from "./cache.js";
import { LLMContext } from "./context.js";
import { createRequestLog } from "./request-log.js";
import {
  getScopeDefaults,
  resolveSamplingSetting,
} from "./sampling.js";
import type {
  LLMessage,
  LLMOptions,
  LLMRequestOptions,
  PendingCacheEntry,
  SamplingScopeConfig,
  TemperatureSetting,
} from "./types.js";

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504, 524, 529]);

let contextIdCounter = 0;

export interface OpenAIClientLike {
  chat: {
    completions: {
      create(input: {
        model: string;
        messages: ChatCompletionMessageParam[];
        temperature?: number;
        top_p?: number;
      }): Promise<{
        choices: Array<{
          message: {
            content: string | null;
          };
        }>;
      }>;
    };
  };
}

export class LLM {
  readonly #cacheDirPath: string | undefined;
  readonly #dataDirPath: string;
  readonly #logDirPath: string | undefined;
  readonly #model: string;
  readonly #requestLimiter: AsyncSemaphore;
  readonly #retryIntervalSeconds: number;
  readonly #retryTimes: number;
  readonly #sampling: SamplingScopeConfig;
  readonly #templateEnvironment: Environment;
  readonly #temperature: TemperatureSetting;
  readonly #topP: TemperatureSetting;

  readonly config: {
    apiKey: string;
    baseURL: string;
    model: string;
    timeout: number;
    temperature: TemperatureSetting;
    topP: TemperatureSetting;
    sampling: SamplingScopeConfig;
  };

  client: OpenAIClientLike;

  constructor(options: LLMOptions) {
    const concurrent = options.concurrent ?? 1;
    const timeout = options.timeout ?? 360;
    const temperature = options.temperature ?? 0.6;
    const topP = options.topP ?? 0.6;
    const sampling = options.sampling ?? {};

    this.config = {
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      model: options.model,
      sampling,
      temperature,
      timeout,
      topP,
    };

    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: timeout * 1000,
    });
    this.#cacheDirPath = ensureDirectoryPath(options.cacheDirPath);
    this.#dataDirPath = resolve(options.dataDirPath);
    this.#logDirPath = ensureDirectoryPath(options.logDirPath);
    this.#model = options.model;
    this.#requestLimiter = new AsyncSemaphore(concurrent);
    this.#retryIntervalSeconds = options.retryIntervalSeconds ?? 6;
    this.#retryTimes = options.retryTimes ?? 5;
    this.#sampling = sampling;
    this.#templateEnvironment = createEnv(this.#dataDirPath);
    this.#temperature = temperature;
    this.#topP = topP;
  }

  context(): LLMContext {
    contextIdCounter += 1;
    const sessionId = contextIdCounter;

    return new LLMContext(
      sessionId,
      async (messages, requestOptions, pendingCacheEntries, logFiles) =>
        await this.#requestWithSession({
          logFiles,
          messages,
          pendingCacheEntries,
          sessionId,
          ...requestOptions,
        }),
    );
  }

  async withContext<T>(
    operation: (context: LLMContext) => Promise<T>,
  ): Promise<T> {
    return await this.context().run(operation);
  }

  async request(
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

  async requestWithHistory(
    messages: readonly LLMessage[],
    options: LLMRequestOptions = {},
  ): Promise<string> {
    return await this.#requestWithSession({
      messages,
      ...options,
    });
  }

  loadSystemPrompt(
    promptTemplatePath: string,
    templateContext: Record<string, unknown> = {},
  ): string {
    const resolvedPromptPath = resolve(promptTemplatePath);
    const templateName = this.#resolveTemplateName(resolvedPromptPath);

    return this.#templateEnvironment.render(templateName, templateContext);
  }

  async #requestWithSession(input: {
    messages: readonly LLMessage[];
    temperature?: TemperatureSetting | undefined;
    topP?: TemperatureSetting | undefined;
    scope?: string | undefined;
    retryIndex?: number | undefined;
    retryMax?: number | undefined;
    sessionId?: number | undefined;
    pendingCacheEntries?: Map<string, PendingCacheEntry> | undefined;
    logFiles?: string[] | undefined;
    useCache?: boolean | undefined;
  }): Promise<string> {
    const defaultSampling = getScopeDefaults(
      input.scope,
      this.#sampling,
      this.#temperature,
      this.#topP,
    );
    const temperature = input.temperature ?? defaultSampling.temperature;
    const topP = input.topP ?? defaultSampling.topP;
    const resolvedTemperature = resolveSamplingSetting(
      temperature,
      "temperature",
      input.retryIndex,
      input.retryMax,
    );
    const resolvedTopP = resolveSamplingSetting(
      topP,
      "top_p",
      input.retryIndex,
      input.retryMax,
    );
    const useCache = input.useCache ?? true;
    const cacheKey =
      this.#cacheDirPath !== undefined && useCache
        ? createCacheKey({
            messages: input.messages,
            model: this.#model,
            temperature: resolvedTemperature,
            topP: resolvedTopP,
          })
        : undefined;
    const requestLog = createRequestLog(this.#logDirPath);

    if (requestLog.filePath !== undefined && input.logFiles !== undefined) {
      input.logFiles.push(requestLog.filePath);
    }

    await requestLog.append(
      formatRequestParameters({
        cacheKey,
        resolvedTemperature,
        resolvedTopP,
        retryIndex: input.retryIndex,
        retryMax: input.retryMax,
        scope: input.scope,
        sessionId: input.sessionId,
        temperature,
        topP,
      }),
    );
    await requestLog.append(formatRequestMessages(input.messages));

    if (cacheKey !== undefined && this.#cacheDirPath !== undefined && useCache) {
      const cachedResponse = await readCachedResponse(this.#cacheDirPath, cacheKey);

      if (cachedResponse !== undefined) {
        console.log(
          `[Cache Hit] Using cached response (key: ${cacheKey.slice(0, 12)}...)`,
        );
        await requestLog.append(`[[Response]] (from cache):\n${cachedResponse}\n\n`);
        return cachedResponse;
      }
    }

    let response = "";
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.#retryTimes; attempt += 1) {
      try {
        response = await this.#requestLimiter.use(async () => {
          const completionInput: Parameters<
            OpenAIClientLike["chat"]["completions"]["create"]
          >[0] = {
            messages: input.messages.map(toChatCompletionMessage),
            model: this.#model,
          };

          if (resolvedTemperature !== undefined) {
            completionInput.temperature = resolvedTemperature;
          }

          if (resolvedTopP !== undefined) {
            completionInput.top_p = resolvedTopP;
          }

          const completion = await this.client.chat.completions.create(
            completionInput,
          );

          return completion.choices[0]?.message.content ?? "";
        });

        await requestLog.append(`[[Response]]:\n${response}\n\n`);
        break;
      } catch (error) {
        lastError = error;

        if (!isRetryableError(error)) {
          await requestLog.append(`[[Error]]:\n${formatError(error)}\n\n`);
          throw error;
        }

        await requestLog.append(
          `[[Warning]]:\nRequest failed with connection error, retrying... (${attempt + 1} times)\n\n`,
        );

        if (attempt < this.#retryTimes && this.#retryIntervalSeconds > 0) {
          await sleep(this.#retryIntervalSeconds * 1000);
        }
      }
    }

    if (response.length === 0) {
      await requestLog.append(`[[Error]]:\n${formatError(lastError)}\n\n`);

      throw new Error(
        lastError === undefined
          ? `LLM request failed after ${this.#retryTimes + 1} attempts`
          : `LLM request failed after ${this.#retryTimes + 1} attempts: ${formatError(lastError)}`,
      );
    }

    if (cacheKey !== undefined && this.#cacheDirPath !== undefined && useCache) {
      const entry = {
        path: getCacheFilePath(this.#cacheDirPath, cacheKey),
        response,
      };

      if (input.sessionId !== undefined && input.pendingCacheEntries !== undefined) {
        input.pendingCacheEntries.set(entry.path, entry);
      } else {
        await writeCachedResponse(entry);
      }
    }

    return response;
  }

  #resolveTemplateName(promptTemplatePath: string): string {
    const relativePath = relative(this.#dataDirPath, promptTemplatePath);
    const rootPrefix = this.#dataDirPath.endsWith(sep)
      ? this.#dataDirPath
      : `${this.#dataDirPath}${sep}`;

    if (
      promptTemplatePath === this.#dataDirPath ||
      promptTemplatePath.startsWith(rootPrefix)
    ) {
      return relativePath.split(sep).join("/");
    }

    return basename(promptTemplatePath);
  }
}

function ensureDirectoryPath(dirPath?: string): string | undefined {
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

function toChatCompletionMessage(
  message: LLMessage,
): ChatCompletionMessageParam {
  return {
    content: message.content,
    role: message.role,
  } as ChatCompletionMessageParam;
}

function formatRequestParameters(input: {
  cacheKey?: string | undefined;
  resolvedTemperature: number | undefined;
  resolvedTopP: number | undefined;
  retryIndex?: number | undefined;
  retryMax?: number | undefined;
  scope?: string | undefined;
  sessionId?: number | undefined;
  temperature: TemperatureSetting;
  topP: TemperatureSetting;
}): string {
  const lines = [
    "[[Parameters]]:",
    `\ttemperature=${String(input.resolvedTemperature)}`,
    `\ttop_p=${String(input.resolvedTopP)}`,
  ];

  if (input.scope !== undefined) {
    lines.push(`\tscope=${input.scope}`);
  }

  if (Array.isArray(input.temperature)) {
    lines.push(`\ttemperature_schedule=${JSON.stringify(input.temperature)}`);
  }

  if (Array.isArray(input.topP)) {
    lines.push(`\ttop_p_schedule=${JSON.stringify(input.topP)}`);
  }

  if (input.retryIndex !== undefined && input.retryMax !== undefined) {
    lines.push(`\tretry_progress=${input.retryIndex}/${input.retryMax}`);
  }

  if (input.cacheKey !== undefined) {
    lines.push(`\tcache_key=${input.cacheKey}`);
  }

  if (input.sessionId !== undefined) {
    lines.push(`\tsession_id=${input.sessionId}`);
  }

  return `${lines.join("\n")}\n\n`;
}

function formatRequestMessages(messages: readonly LLMessage[]): string {
  const body = messages
    .map(
      (message) =>
        `${capitalize(message.role)}:\n${message.content}`,
    )
    .join("\n\n");

  return `[[Request]]:\n${body}\n\n`;
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }

  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRetryableError(error: unknown): boolean {
  if (hasRetryableStatus(error)) {
    return RETRYABLE_STATUS_CODES.has(error.status);
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const errorMessage = error.message.toLowerCase();

  return ["connection", "timeout", "network", "rate limit"].some((keyword) =>
    errorMessage.includes(keyword),
  );
}

function hasRetryableStatus(error: unknown): error is { status: number } {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }

  const { status } = error as { status: unknown };

  return typeof status === "number";
}
