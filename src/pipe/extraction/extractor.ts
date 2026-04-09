import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import type { ZodType } from "zod";

import {
  GuaranteedParseValidationError,
  ParsedJsonError,
  requestGuaranteedJson,
} from "../../guaranteed/index.js";
import type { LLMessage, LLM } from "../../llm/index.js";
import {
  bookCoherenceResponseSchema,
  ChunkBatchParser,
  createSentenceContext,
  getSentenceKey,
  type BookCoherenceResponseData,
  type ExtractChunksResult,
  type SentenceContext,
  type UserFocusedResponseData,
  userFocusedResponseSchema,
} from "./chunk-batch-parser.js";
import type {
  ChunkBatch,
  ChunkExtractorOptions,
  ChunkImportanceAnnotation,
  ChunkTranslationInput,
  CognitiveChunk,
  ExtractBookCoherenceInput,
  ExtractUserFocusedInput,
  ExtractUserFocusedResult,
} from "./types.js";

const MAX_CHUNK_REGENERATIONS = 7;

interface ExtractChunksInput<
  TData extends UserFocusedResponseData | BookCoherenceResponseData,
> {
  readonly emptyChunkBatch: ChunkBatch;
  readonly messages: readonly LLMessage[];
  readonly metadataField: "retention" | "importance";
  readonly schema: ZodType<TData>;
  readonly sentenceContext: SentenceContext;
  readonly validImportanceChunkIds?: ReadonlySet<number>;
  readonly visibleChunkIds: readonly number[];
}

const MODULE_DIR_PATH = dirname(fileURLToPath(import.meta.url));
const DATA_DIR_PATH = resolve(
  MODULE_DIR_PATH,
  "..",
  "..",
  "..",
  "data",
  "topologization",
);
const USER_FOCUSED_PROMPT_PATH = resolve(
  DATA_DIR_PATH,
  "user_focused_extraction.jinja",
);
const BOOK_COHERENCE_PROMPT_PATH = resolve(
  DATA_DIR_PATH,
  "book_coherence_extraction.jinja",
);
const EVIDENCE_CHOICE_PROMPT_PATH = resolve(
  DATA_DIR_PATH,
  "evidence_choice.jinja",
);

export class ChunkExtractor<S extends string> {
  readonly #extractionGuidance: string;
  readonly #llm: LLM<S>;
  readonly #scopes: ChunkExtractorOptions<S>["scopes"];
  readonly #sentenceTextSource: ChunkExtractorOptions<S>["sentenceTextSource"];
  readonly #translator: ChunkExtractorOptions<S>["translator"];
  readonly #userLanguage: string | undefined;

  public constructor(options: ChunkExtractorOptions<S>) {
    this.#extractionGuidance = options.extractionGuidance;
    this.#llm = options.llm;
    this.#scopes = options.scopes;
    this.#sentenceTextSource = options.sentenceTextSource;
    this.#translator = options.translator;
    this.#userLanguage = options.userLanguage;
  }

  public async extractUserFocused(
    input: ExtractUserFocusedInput,
  ): Promise<ExtractUserFocusedResult> {
    const sentenceContext = createSentenceContext(input.sentences);
    const messages = this.#buildMessages({
      promptTemplatePath: USER_FOCUSED_PROMPT_PATH,
      templateContext: {
        extraction_guidance: this.#extractionGuidance,
        user_language: this.#userLanguage,
        working_memory: input.workingMemoryPrompt,
      },
      text: input.text,
    });

    const result = await this.#extractChunks({
      emptyChunkBatch: this.#buildEmptyChunkBatch(),
      messages,
      metadataField: "retention",
      schema: userFocusedResponseSchema,
      sentenceContext,
      visibleChunkIds: input.visibleChunkIds,
    });

    return {
      chunkBatch: await this.#translateChunkBatch(
        result.chunkBatch,
        sentenceContext,
      ),
      fragmentSummary: result.fragmentSummary ?? "",
    };
  }

  public async extractBookCoherence(
    input: ExtractBookCoherenceInput,
  ): Promise<ChunkBatch> {
    const sentenceContext = createSentenceContext(input.sentences);
    const messages = this.#buildMessages({
      promptTemplatePath: BOOK_COHERENCE_PROMPT_PATH,
      templateContext: {
        user_focused_chunks: input.userFocusedChunks.map((chunk) => ({
          content: chunk.content,
          id: chunk.id,
          label: chunk.label,
        })),
        user_language: this.#userLanguage,
        working_memory: input.workingMemoryPrompt,
      },
      text: input.text,
    });
    const validImportanceChunkIds = new Set(
      input.userFocusedChunks.map((chunk) => chunk.id),
    );

    const result = await this.#extractChunks({
      emptyChunkBatch: this.#buildEmptyChunkBatch([]),
      messages,
      metadataField: "importance",
      schema: bookCoherenceResponseSchema,
      sentenceContext,
      validImportanceChunkIds,
      visibleChunkIds: input.visibleChunkIds,
    });

    return await this.#translateChunkBatch(result.chunkBatch, sentenceContext);
  }

  async #extractChunks<
    TData extends UserFocusedResponseData | BookCoherenceResponseData,
  >(input: ExtractChunksInput<TData>): Promise<ExtractChunksResult> {
    return await this.#llm.withContext(
      async (context): Promise<ExtractChunksResult> => {
        try {
          return await requestGuaranteedJson({
            maxRetries: MAX_CHUNK_REGENERATIONS,
            messages: input.messages,
            parse: async (data, index, maxRetries) =>
              await new ChunkBatchParser({
                choiceSystemPrompt: this.#llm.loadSystemPrompt(
                  EVIDENCE_CHOICE_PROMPT_PATH,
                  {
                    selection_rules: this.#getChoiceSelectionRules(
                      input.metadataField,
                    ),
                    user_language: this.#userLanguage,
                  },
                ),
                isLastGenerationAttempt: index >= maxRetries,
                metadataField: input.metadataField,
                requestChoice: async (choiceMessages, choiceIndex, choiceMax) =>
                  await context.request(choiceMessages, {
                    retryIndex: choiceIndex,
                    retryMax: choiceMax,
                    scope: this.#scopes.choice,
                    useCache: false,
                  }),
                sentenceContext: input.sentenceContext,
                visibleChunkIds: input.visibleChunkIds,
                ...(input.validImportanceChunkIds === undefined
                  ? {}
                  : {
                      validImportanceChunkIds: input.validImportanceChunkIds,
                    }),
              }).parse(data),
            request: async (messages, index, maxRetries) =>
              await context.request(messages, {
                retryIndex: index,
                retryMax: maxRetries,
                scope: this.#scopes.extraction,
              }),
            schema: input.schema,
          });
        } catch (error) {
          if (isParsedJsonValidationFailure(error)) {
            return {
              chunkBatch: input.emptyChunkBatch,
            };
          }
          throw error;
        }
      },
    );
  }

  /**
   * 对于 AI 来说，原本应该直接生成正确语言的文字和摘要，但因为
   * 强迫 AI 在不同语言之间切换非常困难，经常会出现语言不符合要求的情况。
   *
   * 所以我们的处理方案是：
   * 1. 通过程序找到那些与要求语言不一致的句子
   * 2. 直接再用 AI 把这些句子翻译过去
   *
   * 这是一个保底手段。
   */
  async #translateChunkBatch(
    chunkBatch: ChunkBatch,
    sentenceContext: SentenceContext,
  ): Promise<ChunkBatch> {
    if (
      this.#translator === undefined ||
      this.#userLanguage === undefined ||
      chunkBatch.chunks.length === 0
    ) {
      return chunkBatch;
    }
    const translationInput: ChunkTranslationInput[] = [];

    for (const chunk of chunkBatch.chunks) {
      translationInput.push({
        content: chunk.content,
        id: chunk.id,
        label: chunk.label,
        sourceSentences: await this.#getChunkSourceSentences(
          chunk,
          sentenceContext,
        ),
      });
    }

    const translatedChunks = await this.#translator.translate(
      translationInput,
      this.#userLanguage,
    );
    const translatedById = new Map(
      translatedChunks.map((chunk) => [chunk.id, chunk] as const),
    );

    return {
      ...chunkBatch,
      chunks: chunkBatch.chunks.map((chunk) => {
        const translated = translatedById.get(chunk.id);

        if (translated === undefined) {
          return chunk;
        }

        return {
          ...chunk,
          content: translated.content,
          label: translated.label,
        };
      }),
    };
  }

  async #getChunkSourceSentences(
    chunk: CognitiveChunk,
    sentenceContext: SentenceContext,
  ): Promise<string[]> {
    const sourceSentences: string[] = [];

    for (const sentenceId of chunk.sentenceIds) {
      const sentenceKey = getSentenceKey(sentenceId);
      const sentenceText = sentenceContext.textByKey.get(sentenceKey);

      if (sentenceText !== undefined) {
        sourceSentences.push(sentenceText);
        continue;
      }

      sourceSentences.push(
        await this.#sentenceTextSource.getSentence(sentenceId),
      );
    }

    return sourceSentences;
  }

  #buildMessages(input: {
    promptTemplatePath: string;
    templateContext: Record<string, unknown>;
    text: string;
  }): LLMessage[] {
    return [
      {
        content: this.#llm.loadSystemPrompt(
          input.promptTemplatePath,
          input.templateContext,
        ),
        role: "system",
      },
      {
        content: input.text,
        role: "user",
      },
    ];
  }

  #getChoiceSelectionRules(metadataField: "retention" | "importance"): string {
    if (metadataField === "retention") {
      return `User-focused extraction rules:\n${this.#extractionGuidance}`;
    }

    return [
      "Book-coherence extraction rules:",
      "- Extract only information essential for understanding the text's logic and flow.",
      "- Prefer first introductions, causal links, critical context, turning points, and definitions.",
      "- Do not duplicate information already covered by user-focused chunks.",
      "- Use this stage for connective tissue that is structurally necessary for comprehension.",
    ].join("\n");
  }

  #buildEmptyChunkBatch(
    importanceAnnotations?: readonly ChunkImportanceAnnotation[],
  ): ChunkBatch {
    return {
      chunks: [],
      ...(importanceAnnotations === undefined ? {} : { importanceAnnotations }),
      links: [],
      orderCorrect: true,
      tempIds: [],
    };
  }
}

function isParsedJsonValidationFailure(error: unknown): boolean {
  return (
    error instanceof GuaranteedParseValidationError &&
    error.cause instanceof ParsedJsonError
  );
}
