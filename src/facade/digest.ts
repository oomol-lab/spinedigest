import { mkdtemp, rm } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";

import { BOOK_META_VERSION, TOC_FILE_VERSION } from "../source/index.js";
import {
  EPUB_SOURCE_ADAPTER,
  MARKDOWN_SOURCE_ADAPTER,
  TXT_SOURCE_ADAPTER,
  type SourceFormat,
  type SourceAdapter,
} from "../source/index.js";
import { DirectoryDocument } from "../document/index.js";
import type { Language } from "../common/language.js";
import type { ReaderSegmenter, ReaderTextStream } from "../reader/index.js";
import type { LLM } from "../llm/index.js";
import { SerialGeneration } from "../serial.js";

import { importSource } from "./import.js";
import { SpineDigest } from "./spine-digest.js";

interface DigestSessionOptions {
  readonly documentDirPath?: string;
  readonly extractionPrompt: string;
  readonly llm: LLM<string>;
  readonly logDirPath?: string;
  readonly segmenter?: ReaderSegmenter;
  readonly userLanguage?: Language;
}

export interface DigestDocumentSessionOptions {
  readonly documentDirPath?: string;
}

export interface DigestSourceSessionOptions extends DigestSessionOptions {
  readonly path: string;
}

export interface DigestTextSessionOptions extends DigestSessionOptions {
  readonly bookLanguage?: string | null;
  readonly sourceFormat?: Extract<SourceFormat, "markdown" | "txt">;
  readonly stream: ReaderTextStream;
  readonly title?: string | null;
}

export async function digestEpubSession<T>(
  options: DigestSourceSessionOptions,
  operation: (digest: SpineDigest) => Promise<T> | T,
): Promise<T> {
  return await digestSourceSession(EPUB_SOURCE_ADAPTER, options, operation);
}

export async function digestMarkdownSession<T>(
  options: DigestSourceSessionOptions,
  operation: (digest: SpineDigest) => Promise<T> | T,
): Promise<T> {
  return await digestSourceSession(MARKDOWN_SOURCE_ADAPTER, options, operation);
}

export async function digestTextSession<T>(
  options: DigestTextSessionOptions,
  operation: (digest: SpineDigest) => Promise<T> | T,
): Promise<T> {
  return await withTemporaryDocumentSession(async (document, directoryPath) => {
    await document.openSession(async (openedDocument) => {
      const generation = new SerialGeneration({
        document: openedDocument,
        llm: options.llm,
        ...(options.logDirPath === undefined
          ? {}
          : { logDirPath: options.logDirPath }),
        ...(options.segmenter === undefined
          ? {}
          : { segmenter: options.segmenter }),
      });
      const serial = await generation.generate(options.stream, {
        extractionPrompt: options.extractionPrompt,
        ...(options.userLanguage === undefined
          ? {}
          : { userLanguage: options.userLanguage }),
      });
      const normalizedTitle = normalizeTitle(options.title);

      await openedDocument.writeBookMeta({
        version: BOOK_META_VERSION,
        sourceFormat: options.sourceFormat ?? "txt",
        title: normalizedTitle ?? null,
        authors: [],
        description: null,
        identifier: null,
        language: options.bookLanguage ?? null,
        publishedAt: null,
        publisher: null,
      });
      await openedDocument.writeToc({
        version: TOC_FILE_VERSION,
        items: [
          {
            title: normalizedTitle ?? "Section 1",
            serialId: serial.id,
            children: [],
          },
        ],
      });
    });

    return await operation(new SpineDigest(document, directoryPath));
  }, options.documentDirPath);
}

export async function digestTxtSession<T>(
  options: DigestSourceSessionOptions,
  operation: (digest: SpineDigest) => Promise<T> | T,
): Promise<T> {
  return await digestSourceSession(TXT_SOURCE_ADAPTER, options, operation);
}

async function digestSourceSession<T>(
  adapter: SourceAdapter,
  options: DigestSourceSessionOptions,
  operation: (digest: SpineDigest) => Promise<T> | T,
): Promise<T> {
  return await withTemporaryDocumentSession(async (document, directoryPath) => {
    await importSource({
      adapter,
      document,
      extractionPrompt: options.extractionPrompt,
      llm: options.llm,
      path: options.path,
      ...(options.logDirPath === undefined
        ? {}
        : { logDirPath: options.logDirPath }),
      ...(options.segmenter === undefined
        ? {}
        : { segmenter: options.segmenter }),
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
    });

    return await operation(new SpineDigest(document, directoryPath));
  }, options.documentDirPath);
}

async function withTemporaryDocumentSession<T>(
  operation: (
    document: DirectoryDocument,
    directoryPath: string,
  ) => Promise<T> | T,
  documentDirPath?: string,
): Promise<T> {
  const directoryPath =
    documentDirPath === undefined
      ? await mkdtemp(join(tmpdir(), "spinedigest-digest-"))
      : resolve(documentDirPath);
  const document = await DirectoryDocument.open(directoryPath);

  try {
    return await operation(document, directoryPath);
  } finally {
    await document.release();
    if (documentDirPath === undefined) {
      await rm(directoryPath, { force: true, recursive: true });
    }
  }
}

function normalizeTitle(title: string | null | undefined): string | undefined {
  const normalized = title?.trim();

  return normalized === undefined || normalized === "" ? undefined : normalized;
}
