import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import type { LanguageModel } from "ai";

import type { Language } from "../common/language.js";
import { LLM } from "../llm/index.js";

import {
  digestEpubSession,
  digestMarkdownSession,
  digestTextSession,
  digestTxtSession,
  type DigestDocumentSessionOptions,
  type DigestSourceSessionOptions,
  type DigestTextSessionOptions,
} from "./digest.js";
import { SpineDigestFile } from "./spine-digest-file.js";
import type { SpineDigest } from "./spine-digest.js";

const DATA_DIR_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../data",
);

const DEFAULT_EXTRACTION_PROMPT =
  "Focus on the main storyline and key character developments. Preserve important dialogues and critical plot points. Background descriptions and minor details can be compressed significantly.";

export interface SpineDigestLLMOptions {
  readonly cacheDirPath?: string;
  readonly concurrent?: number;
  readonly logDirPath?: string;
  readonly model: LanguageModel;
  readonly retryIntervalSeconds?: number;
  readonly retryTimes?: number;
  readonly temperature?: number | readonly number[];
  readonly timeout?: number;
  readonly topP?: number | readonly number[];
}

export interface SpineDigestAppOptions {
  readonly debugLogDirPath?: string;
  readonly llm?: LanguageModel | SpineDigestLLMOptions;
}

export type SpineDigestOpenSessionOptions = DigestDocumentSessionOptions;

export interface SpineDigestSourceSessionOptions extends DigestDocumentSessionOptions {
  readonly extractionPrompt?: string;
  readonly path: string;
  readonly userLanguage?: Language;
}

export interface SpineDigestTextSessionOptions extends DigestDocumentSessionOptions {
  readonly bookLanguage?: string | null;
  readonly extractionPrompt?: string;
  readonly sourceFormat?: "markdown" | "txt";
  readonly stream: AsyncIterable<string> | Iterable<string>;
  readonly title?: string | null;
  readonly userLanguage?: Language;
}

export class SpineDigestApp {
  readonly #debugLogDirPath: string | undefined;
  readonly #llm: LLM<string> | undefined;

  public constructor(options: SpineDigestAppOptions) {
    this.#debugLogDirPath = options.debugLogDirPath;
    this.#llm =
      options.llm === undefined
        ? undefined
        : new LLM({
            dataDirPath: DATA_DIR_PATH,
            ...normalizeLLMOptions(options.llm),
          });
  }

  public async digestEpubSession<T>(
    options: SpineDigestSourceSessionOptions,
    operation: (digest: SpineDigest) => Promise<T> | T,
  ): Promise<T> {
    return await digestEpubSession(
      this.#createSourceOptions(options),
      operation,
    );
  }

  public async digestMarkdownSession<T>(
    options: SpineDigestSourceSessionOptions,
    operation: (digest: SpineDigest) => Promise<T> | T,
  ): Promise<T> {
    return await digestMarkdownSession(
      this.#createSourceOptions(options),
      operation,
    );
  }

  public async digestTextSession<T>(
    options: SpineDigestTextSessionOptions,
    operation: (digest: SpineDigest) => Promise<T> | T,
  ): Promise<T> {
    return await digestTextSession(
      {
        extractionPrompt: resolveExtractionPrompt(options.extractionPrompt),
        llm: this.#requireLLM(),
        stream: options.stream,
        ...(this.#debugLogDirPath === undefined
          ? {}
          : { logDirPath: this.#debugLogDirPath }),
        ...(options.bookLanguage === undefined
          ? {}
          : { bookLanguage: options.bookLanguage }),
        ...(options.documentDirPath === undefined
          ? {}
          : { documentDirPath: options.documentDirPath }),
        ...(options.sourceFormat === undefined
          ? {}
          : { sourceFormat: options.sourceFormat }),
        ...(options.title === undefined ? {} : { title: options.title }),
        ...(options.userLanguage === undefined
          ? {}
          : { userLanguage: options.userLanguage }),
      } satisfies DigestTextSessionOptions,
      operation,
    );
  }

  public async digestTxtSession<T>(
    options: SpineDigestSourceSessionOptions,
    operation: (digest: SpineDigest) => Promise<T> | T,
  ): Promise<T> {
    return await digestTxtSession(
      this.#createSourceOptions(options),
      operation,
    );
  }

  public async openSession<T>(
    path: string,
    operation: (digest: SpineDigest) => Promise<T> | T,
    options: SpineDigestOpenSessionOptions = {},
  ): Promise<T> {
    return await new SpineDigestFile(path).openSession(operation, {
      ...(options.documentDirPath === undefined
        ? {}
        : { documentDirPath: options.documentDirPath }),
    });
  }

  #createSourceOptions(
    options: SpineDigestSourceSessionOptions,
  ): DigestSourceSessionOptions {
    return {
      extractionPrompt: resolveExtractionPrompt(options.extractionPrompt),
      llm: this.#requireLLM(),
      path: options.path,
      ...(this.#debugLogDirPath === undefined
        ? {}
        : { logDirPath: this.#debugLogDirPath }),
      ...(options.documentDirPath === undefined
        ? {}
        : { documentDirPath: options.documentDirPath }),
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
    };
  }

  #requireLLM(): LLM<string> {
    if (this.#llm === undefined) {
      throw new Error(
        "LLM is required for digest operations. Configure `llm` when constructing SpineDigestApp.",
      );
    }

    return this.#llm;
  }
}

function normalizeLLMOptions(
  llm: NonNullable<SpineDigestAppOptions["llm"]>,
): SpineDigestLLMOptions {
  if (isSpineDigestLLMOptions(llm)) {
    return llm;
  }

  return { model: llm };
}

function isSpineDigestLLMOptions(
  llm: NonNullable<SpineDigestAppOptions["llm"]>,
): llm is SpineDigestLLMOptions {
  return typeof llm === "object" && llm !== null && "model" in llm;
}

function resolveExtractionPrompt(prompt: string | undefined): string {
  const normalizedPrompt = prompt?.trim();

  return normalizedPrompt === undefined || normalizedPrompt === ""
    ? DEFAULT_EXTRACTION_PROMPT
    : normalizedPrompt;
}
