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

export interface SpineDigestAppOptions {
  readonly generationLogDirPath?: string;
  readonly llm: {
    readonly cacheDirPath?: string;
    readonly concurrent?: number;
    readonly logDirPath?: string;
    readonly model: string;
    readonly provider: {
      languageModel(modelId: string): LanguageModel;
    };
    readonly retryIntervalSeconds?: number;
    readonly retryTimes?: number;
    readonly temperature?: number | readonly number[];
    readonly timeout?: number;
    readonly topP?: number | readonly number[];
  };
}

export type SpineDigestOpenSessionOptions = DigestDocumentSessionOptions;

export interface SpineDigestSourceSessionOptions extends DigestDocumentSessionOptions {
  readonly extractionPrompt: string;
  readonly path: string;
  readonly userLanguage?: Language;
}

export interface SpineDigestTextSessionOptions extends DigestDocumentSessionOptions {
  readonly bookLanguage?: string | null;
  readonly extractionPrompt: string;
  readonly sourceFormat?: "markdown" | "txt";
  readonly stream: AsyncIterable<string> | Iterable<string>;
  readonly title?: string | null;
  readonly userLanguage?: Language;
}

export class SpineDigestApp {
  readonly #generationLogDirPath: string | undefined;
  readonly #llm: LLM<string>;

  public constructor(options: SpineDigestAppOptions) {
    this.#generationLogDirPath = options.generationLogDirPath;
    this.#llm = new LLM({
      dataDirPath: DATA_DIR_PATH,
      model: options.llm.provider.languageModel(options.llm.model),
      modelId: options.llm.model,
      ...(options.llm.cacheDirPath === undefined
        ? {}
        : { cacheDirPath: options.llm.cacheDirPath }),
      ...(options.llm.concurrent === undefined
        ? {}
        : { concurrent: options.llm.concurrent }),
      ...(options.llm.logDirPath === undefined
        ? {}
        : { logDirPath: options.llm.logDirPath }),
      ...(options.llm.retryIntervalSeconds === undefined
        ? {}
        : { retryIntervalSeconds: options.llm.retryIntervalSeconds }),
      ...(options.llm.retryTimes === undefined
        ? {}
        : { retryTimes: options.llm.retryTimes }),
      ...(options.llm.temperature === undefined
        ? {}
        : { temperature: options.llm.temperature }),
      ...(options.llm.timeout === undefined
        ? {}
        : { timeout: options.llm.timeout }),
      ...(options.llm.topP === undefined ? {} : { topP: options.llm.topP }),
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
        extractionPrompt: options.extractionPrompt,
        llm: this.#llm,
        stream: options.stream,
        ...(this.#generationLogDirPath === undefined
          ? {}
          : { logDirPath: this.#generationLogDirPath }),
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
      extractionPrompt: options.extractionPrompt,
      llm: this.#llm,
      path: options.path,
      ...(this.#generationLogDirPath === undefined
        ? {}
        : { logDirPath: this.#generationLogDirPath }),
      ...(options.documentDirPath === undefined
        ? {}
        : { documentDirPath: options.documentDirPath }),
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
    };
  }
}
