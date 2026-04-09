import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { z } from "zod";

import {
  GuaranteedParseValidationError,
  ParsedJsonError,
  requestGuaranteedJson,
} from "../../guaranteed/index.js";
import type {
  LLMessage,
  LLM,
  LLMContext,
  LLMRequestOptions,
} from "../../llm/index.js";
import type { SentenceId } from "../../model/index.js";
import { EvidenceResolver } from "./evidence-resolver.js";
import { normalizeText } from "./text.js";
import type {
  ChunkBatch,
  ChunkExtractionSentence,
  ChunkExtractorOptions,
  ChunkImportanceAnnotation,
  ChunkLink,
  ChunkTranslationInput,
  CognitiveChunk,
  EvidenceResolutionFailure,
  ExtractBookCoherenceInput,
  ExtractUserFocusedInput,
  ExtractUserFocusedResult,
  RankedSentenceCandidate,
} from "./types.js";

const MAX_CHUNK_REGENERATIONS = 7;
const MAX_CHOICE_RETRIES = 3;
const REFUSAL_PATTERNS = [
  /\b(?:cannot|can't|unable to)\s+(?:answer|help|provide)\b/iu,
  /\bno\s+(?:relevant|related)\s+(?:result|results|content)\b/iu,
  /无法回答/u,
  /无法给到/u,
  /不能帮助/u,
  /没有找到相关/u,
  /未找到相关/u,
  /很遗憾不能帮助/u,
] as const;

const chunkLinkSchema = z.object({
  from: z.union([z.number().int(), z.string()]),
  strength: z.string().optional(),
  to: z.union([z.number().int(), z.string()]),
});

const userFocusedChunkSchema = z
  .object({
    content: z.string(),
    evidence: z.record(z.string(), z.unknown()).nullish(),
    label: z.string(),
    retention: z.enum(["verbatim", "detailed", "focused", "relevant"]),
    source_sentences: z.array(z.string()).optional(),
    temp_id: z.string(),
  })
  .passthrough();

const userFocusedResponseSchema = z.object({
  chunks: z.array(userFocusedChunkSchema),
  fragment_summary: z.string(),
  links: z.array(chunkLinkSchema),
});

const bookCoherenceChunkSchema = z
  .object({
    content: z.string(),
    evidence: z.record(z.string(), z.unknown()).nullish(),
    importance: z.enum(["critical", "important", "helpful"]),
    label: z.string(),
    source_sentences: z.array(z.string()).optional(),
    temp_id: z.string(),
  })
  .passthrough();

const importanceAnnotationSchema = z.object({
  chunk_id: z.number().int(),
  importance: z.enum(["critical", "important", "helpful"]),
});

const bookCoherenceResponseSchema = z.object({
  chunks: z.array(bookCoherenceChunkSchema),
  importance_annotations: z.array(importanceAnnotationSchema),
  links: z.array(chunkLinkSchema),
});

const choiceResponseSchema = z.object({
  choice: z.string(),
});

type UserFocusedResponseData = z.infer<typeof userFocusedResponseSchema>;
type BookCoherenceResponseData = z.infer<typeof bookCoherenceResponseSchema>;
type ExtractedChunkData =
  | z.infer<typeof userFocusedChunkSchema>
  | z.infer<typeof bookCoherenceChunkSchema>;
type RawChunkLink = z.infer<typeof chunkLinkSchema>;
type ChoiceFieldName = "start_anchor" | "end_anchor";

interface ParsedChunkBatch {
  readonly chunkBatch: ChunkBatch;
  readonly fragmentSummary?: string;
}

interface SentenceContext {
  readonly sentences: readonly ChunkExtractionSentence[];
  readonly exactTextToIds: ReadonlyMap<string, readonly SentenceId[]>;
  readonly normalizedTextToIds: ReadonlyMap<string, readonly SentenceId[]>;
  readonly textByKey: ReadonlyMap<string, string>;
  readonly tokenCountByKey: ReadonlyMap<string, number>;
}

interface ExtractionRequestInput<S extends string> {
  readonly context: LLMContext<S>;
  readonly messages: readonly LLMessage[];
  readonly index: number;
  readonly maxRetries: number;
  readonly stage: ExtractionStage;
}

interface ProcessChunksInput {
  readonly parsedData: UserFocusedResponseData | BookCoherenceResponseData;
  readonly sentenceContext: SentenceContext;
  readonly visibleChunkIds: readonly number[];
  readonly metadataField: "retention" | "importance";
  readonly requestChoice: GuaranteedChoiceRequest;
  readonly isLastGenerationAttempt: boolean;
  readonly validImportanceChunkIds?: ReadonlySet<number>;
}

interface ResolveChunkEvidenceInput {
  readonly data: ExtractedChunkData;
  readonly chunkIndex: number;
  readonly chunkLabel: string;
  readonly sentenceContext: SentenceContext;
  readonly metadataField: "retention" | "importance";
  readonly requestChoice: GuaranteedChoiceRequest;
  readonly isLastGenerationAttempt: boolean;
}

interface SelectAmbiguousCandidateInput {
  readonly chunkIndex: number;
  readonly chunkLabel: string;
  readonly chunkData: ExtractedChunkData;
  readonly fieldName: ChoiceFieldName;
  readonly candidates: readonly RankedSentenceCandidate[];
  readonly metadataField: "retention" | "importance";
  readonly requestChoice: GuaranteedChoiceRequest;
}

type GuaranteedChoiceRequest = (
  messages: readonly LLMessage[],
  index: number,
  maxRetries: number,
) => Promise<string>;

type ExtractionStage = "user_focused" | "book_coherence";

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
  readonly #evidenceResolver = new EvidenceResolver();
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

    const result = await this.#llm.withContext(
      async (context): Promise<ExtractUserFocusedResult> => {
        try {
          const parsedResult = await requestGuaranteedJson({
            maxRetries: MAX_CHUNK_REGENERATIONS,
            messages,
            parse: async (data, index, maxRetries) =>
              await this.#processParsedData({
                isLastGenerationAttempt: index >= maxRetries,
                metadataField: "retention",
                parsedData: data,
                requestChoice: async (choiceMessages, choiceIndex, choiceMax) =>
                  await context.request(choiceMessages, {
                    retryIndex: choiceIndex,
                    retryMax: choiceMax,
                    scope: this.#scopes.choice,
                    useCache: false,
                  }),
                sentenceContext,
                visibleChunkIds: input.visibleChunkIds,
              }),
            request: async (currentMessages, index, maxRetries) =>
              await this.#requestExtractionJson({
                context,
                index,
                maxRetries,
                messages: currentMessages,
                stage: "user_focused",
              }),
            schema: userFocusedResponseSchema,
          });

          return {
            chunkBatch: await this.#translateChunkBatch(
              parsedResult.chunkBatch,
              sentenceContext,
            ),
            fragmentSummary: parsedResult.fragmentSummary ?? "",
          };
        } catch (error) {
          if (isParsedJsonValidationFailure(error)) {
            return {
              chunkBatch: this.#buildEmptyChunkBatch(),
              fragmentSummary: "",
            };
          }

          throw error;
        }
      },
    );

    return result;
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

    return await this.#llm.withContext(async (context): Promise<ChunkBatch> => {
      try {
        const parsedResult = await requestGuaranteedJson({
          maxRetries: MAX_CHUNK_REGENERATIONS,
          messages,
          parse: async (data, index, maxRetries) =>
            await this.#processParsedData({
              isLastGenerationAttempt: index >= maxRetries,
              metadataField: "importance",
              parsedData: data,
              requestChoice: async (choiceMessages, choiceIndex, choiceMax) =>
                await context.request(choiceMessages, {
                  retryIndex: choiceIndex,
                  retryMax: choiceMax,
                  scope: this.#scopes.choice,
                  useCache: false,
                }),
              sentenceContext,
              validImportanceChunkIds,
              visibleChunkIds: input.visibleChunkIds,
            }),
          request: async (currentMessages, index, maxRetries) =>
            await this.#requestExtractionJson({
              context,
              index,
              maxRetries,
              messages: currentMessages,
              stage: "book_coherence",
            }),
          schema: bookCoherenceResponseSchema,
        });

        return await this.#translateChunkBatch(
          parsedResult.chunkBatch,
          sentenceContext,
        );
      } catch (error) {
        if (isParsedJsonValidationFailure(error)) {
          return this.#buildEmptyChunkBatch([]);
        }

        throw error;
      }
    });
  }

  async #requestExtractionJson(
    input: ExtractionRequestInput<S>,
  ): Promise<string> {
    const requestOptions: LLMRequestOptions<S> = {
      retryIndex: input.index,
      retryMax: input.maxRetries,
      scope: this.#scopes.extraction,
    };
    const response = await input.context.request(
      input.messages,
      requestOptions,
    );

    if (looksLikeRefusalResponse(response)) {
      return buildEmptyExtractionJson(input.stage);
    }

    return response;
  }

  async #processParsedData(
    input: ProcessChunksInput,
  ): Promise<ParsedChunkBatch> {
    const issues: string[] = [];
    const chunks: CognitiveChunk[] = [];
    const tempIds: string[] = [];
    const parsedChunks = input.parsedData.chunks;
    const importanceAnnotations =
      "importance_annotations" in input.parsedData
        ? this.#validateImportanceAnnotations(
            input.parsedData.importance_annotations,
            input.validImportanceChunkIds,
            issues,
          )
        : undefined;
    const fragmentSummary =
      "fragment_summary" in input.parsedData
        ? input.parsedData.fragment_summary
        : undefined;

    for (const [index, data] of parsedChunks.entries()) {
      const chunkIndex = index + 1;
      const chunkIssues: string[] = [];
      const label = data.label.trim();
      const content = data.content.trim();

      if (label === "") {
        chunkIssues.push(
          `Chunk #${chunkIndex}: Missing or empty "label" field`,
        );
      }

      if (content === "") {
        chunkIssues.push(
          `Chunk #${chunkIndex}: Missing or empty "content" field`,
        );
      }

      const [matchedSentenceIds, evidenceFailure] =
        await this.#resolveChunkEvidence({
          chunkIndex,
          chunkLabel: label,
          data,
          isLastGenerationAttempt: input.isLastGenerationAttempt,
          metadataField: input.metadataField,
          requestChoice: input.requestChoice,
          sentenceContext: input.sentenceContext,
        });

      const resolvedSentenceIds =
        matchedSentenceIds.length > 0
          ? matchedSentenceIds
          : this.#resolveLegacySourceSentences(data, input.sentenceContext);

      if (resolvedSentenceIds.length === 0) {
        if (evidenceFailure !== undefined) {
          chunkIssues.push(
            `Chunk #${chunkIndex} ("${label}"): ${evidenceFailure.message}`,
          );
        } else {
          chunkIssues.push(
            `Chunk #${chunkIndex} ("${label}"): Missing evidence or resolvable source_sentences`,
          );
        }
      }

      if (chunkIssues.length > 0) {
        issues.push(...chunkIssues);
        continue;
      }

      const primarySentenceId = resolvedSentenceIds[0];

      if (primarySentenceId === undefined) {
        issues.push(
          `Chunk #${chunkIndex} ("${label}"): Unable to resolve any sentence IDs`,
        );
        continue;
      }

      const totalTokens = resolvedSentenceIds.reduce((sum, sentenceId) => {
        return (
          sum +
          (input.sentenceContext.tokenCountByKey.get(
            getSentenceKey(sentenceId),
          ) ?? 0)
        );
      }, 0);

      if (input.metadataField === "retention") {
        const chunkData = data as z.infer<typeof userFocusedChunkSchema>;

        chunks.push({
          content,
          generation: 0,
          id: 0,
          label,
          links: [],
          retention: chunkData.retention,
          sentenceId: primarySentenceId,
          sentenceIds: [...resolvedSentenceIds],
          tokens: totalTokens,
        });
      } else {
        const chunkData = data as z.infer<typeof bookCoherenceChunkSchema>;

        chunks.push({
          content,
          generation: 0,
          id: 0,
          importance: chunkData.importance,
          label,
          links: [],
          sentenceId: primarySentenceId,
          sentenceIds: [...resolvedSentenceIds],
          tokens: totalTokens,
        });
      }
      tempIds.push(data.temp_id);
    }

    this.#validateLinks({
      issues,
      links: normalizeChunkLinks(input.parsedData.links),
      tempIds,
      visibleChunkIds: input.visibleChunkIds,
    });

    if (issues.length > 0) {
      throw new ParsedJsonError(issues);
    }

    return {
      chunkBatch: {
        chunks,
        links: normalizeChunkLinks(input.parsedData.links),
        orderCorrect: true,
        tempIds,
        ...(importanceAnnotations === undefined
          ? {}
          : { importanceAnnotations }),
      },
      ...(fragmentSummary === undefined ? {} : { fragmentSummary }),
    };
  }

  async #resolveChunkEvidence(
    input: ResolveChunkEvidenceInput,
  ): Promise<
    readonly [
      sentenceIds: readonly SentenceId[],
      failure: EvidenceResolutionFailure | undefined,
    ]
  > {
    const evidence = input.data.evidence;

    if (evidence === undefined || evidence === null) {
      return [[], undefined];
    }

    if (!isRecord(evidence)) {
      return [
        [],
        {
          candidates: [],
          code: "invalid_evidence",
          fieldName: "evidence",
          message: `Chunk #${input.chunkIndex} ("${input.chunkLabel}"): evidence must be an object`,
        },
      ];
    }

    const candidateSentenceIds = input.sentenceContext.sentences.map(
      (sentence) => sentence.sentenceId,
    );
    const candidateTexts = input.sentenceContext.sentences.map(
      (sentence) => sentence.text,
    );
    const [resolution, failure] = this.#evidenceResolver.resolve(
      evidence,
      candidateSentenceIds,
      candidateTexts,
    );

    if (resolution !== undefined) {
      return [resolution.sentenceIds, undefined];
    }

    if (failure === undefined) {
      return [[], undefined];
    }

    const shouldUseChoice =
      failure.code.startsWith("ambiguous") ||
      (failure.code === "low_confidence" &&
        input.isLastGenerationAttempt &&
        failure.candidates.length > 0);

    if (!shouldUseChoice) {
      return [[], failure];
    }

    const choiceFieldName = toChoiceFieldName(failure.fieldName);

    if (choiceFieldName === undefined) {
      return [[], failure];
    }

    const [choiceCandidate, choiceFailure] =
      await this.#chooseAmbiguousCandidate({
        candidates: failure.candidates,
        chunkData: input.data,
        chunkIndex: input.chunkIndex,
        chunkLabel: input.chunkLabel,
        fieldName: choiceFieldName,
        metadataField: input.metadataField,
        requestChoice: input.requestChoice,
      });

    if (choiceFailure !== undefined) {
      if (choiceFailure.code === "choice_parse_failed_full_fragment") {
        return [candidateSentenceIds, undefined];
      }

      return [[], choiceFailure];
    }

    if (choiceCandidate === undefined) {
      return [
        [],
        {
          candidates: failure.candidates,
          code: "choice_failed",
          fieldName: failure.fieldName,
          message: `Second-stage choice failed for ${failure.fieldName}: no candidate returned.`,
        },
      ];
    }

    if (input.isLastGenerationAttempt) {
      const [resolved, resolveFailure] =
        this.#evidenceResolver.resolveWithOverrides({
          candidateSentenceIds,
          candidateTexts,
          evidence,
          overrides: {
            [choiceFieldName]: choiceCandidate,
          },
        });

      if (resolved !== undefined) {
        return [resolved.sentenceIds, undefined];
      }

      return [[], resolveFailure];
    }

    const repairedEvidence: Record<string, unknown> = {
      ...evidence,
      [choiceFieldName]: {
        mode: "full",
        text: choiceCandidate.text,
      },
    };
    const [resolved, resolveFailure] = this.#evidenceResolver.resolve(
      repairedEvidence,
      candidateSentenceIds,
      candidateTexts,
    );

    if (resolved !== undefined) {
      return [resolved.sentenceIds, undefined];
    }

    return [[], resolveFailure];
  }

  async #chooseAmbiguousCandidate(
    input: SelectAmbiguousCandidateInput,
  ): Promise<
    readonly [
      candidate: RankedSentenceCandidate | undefined,
      failure: EvidenceResolutionFailure | undefined,
    ]
  > {
    const messages = this.#buildMessages({
      promptTemplatePath: EVIDENCE_CHOICE_PROMPT_PATH,
      templateContext: {
        selection_rules: this.#getChoiceSelectionRules(input.metadataField),
        user_language: this.#userLanguage,
      },
      text:
        `Previously generated chunk (do NOT rewrite it):\n` +
        `\`\`\`json\n${JSON.stringify(input.chunkData, null, 2)}\n\`\`\`\n\n` +
        `Resolve only this field: "${input.fieldName}" for chunk #${input.chunkIndex} [${input.chunkLabel}].\n` +
        "Choose exactly one candidate occurrence ID from the list below.\n\n" +
        input.candidates.map(formatChoiceCandidate).join("\n"),
    });
    const candidateIds = input.candidates.map(
      (candidate) => candidate.occurrenceId,
    );

    try {
      const choice = await requestGuaranteedJson({
        maxRetries: MAX_CHOICE_RETRIES,
        messages,
        parse: (data) => {
          const candidate = input.candidates.find(
            (item) => item.occurrenceId === data.choice,
          );

          if (candidate === undefined) {
            throw new ParsedJsonError([
              `Invalid choice "${data.choice}". Expected one of: ${candidateIds.join(", ")}`,
            ]);
          }

          return candidate;
        },
        request: input.requestChoice,
        schema: choiceResponseSchema,
      });

      return [choice, undefined];
    } catch (error) {
      if (isParsedJsonValidationFailure(error)) {
        return [
          undefined,
          {
            candidates: input.candidates,
            code: "choice_parse_failed_full_fragment",
            fieldName: input.fieldName,
            message:
              `Second-stage choice parse validation failed for ${input.fieldName}; ` +
              "falling back to the full fragment span.",
          },
        ];
      }

      return [
        undefined,
        {
          candidates: input.candidates,
          code: "choice_failed",
          fieldName: input.fieldName,
          message: `Second-stage choice failed for ${input.fieldName}: ${formatError(error)}`,
        },
      ];
    }
  }

  #validateImportanceAnnotations(
    annotations: readonly {
      readonly chunk_id: number;
      readonly importance: "critical" | "important" | "helpful";
    }[],
    validChunkIds: ReadonlySet<number> | undefined,
    issues: string[],
  ): ChunkImportanceAnnotation[] | undefined {
    if (annotations.length === 0) {
      return [];
    }

    if (validChunkIds === undefined) {
      return annotations.map((annotation) => ({
        chunkId: annotation.chunk_id,
        importance: annotation.importance,
      }));
    }

    const result: ChunkImportanceAnnotation[] = [];

    for (const annotation of annotations) {
      if (!validChunkIds.has(annotation.chunk_id)) {
        issues.push(
          `importance_annotations references unknown chunk_id ${annotation.chunk_id}`,
        );
        continue;
      }

      result.push({
        chunkId: annotation.chunk_id,
        importance: annotation.importance,
      });
    }

    return result;
  }

  #validateLinks(input: {
    issues: string[];
    links: readonly ChunkLink[];
    tempIds: readonly string[];
    visibleChunkIds: readonly number[];
  }): void {
    const validTempIds = new Set(input.tempIds);
    const validChunkIds = new Set(input.visibleChunkIds);

    for (const [index, link] of input.links.entries()) {
      this.#validateLinkReference({
        fieldName: "from",
        index: index + 1,
        issues: input.issues,
        reference: link.from,
        validChunkIds,
        validTempIds,
      });
      this.#validateLinkReference({
        fieldName: "to",
        index: index + 1,
        issues: input.issues,
        reference: link.to,
        validChunkIds,
        validTempIds,
      });
    }
  }

  #validateLinkReference(input: {
    fieldName: "from" | "to";
    index: number;
    issues: string[];
    reference: number | string;
    validChunkIds: ReadonlySet<number>;
    validTempIds: ReadonlySet<string>;
  }): void {
    if (typeof input.reference === "string") {
      if (!input.validTempIds.has(input.reference)) {
        input.issues.push(
          `Link #${input.index}: "${input.fieldName}" temp_id "${input.reference}" does not exist in extracted chunks`,
        );
      }

      return;
    }

    if (!input.validChunkIds.has(input.reference)) {
      input.issues.push(
        `Link #${input.index}: "${input.fieldName}" chunk_id ${input.reference} does not exist in visible chunks`,
      );
    }
  }

  #resolveLegacySourceSentences(
    data: ExtractedChunkData,
    sentenceContext: SentenceContext,
  ): SentenceId[] {
    const sourceSentences = getSourceSentences(data);

    if (sourceSentences.length === 0) {
      return [];
    }

    const matchedSentenceIds: SentenceId[] = [];
    const seen = new Set<string>();

    for (const sourceSentence of sourceSentences) {
      const matchedIds = this.#matchSourceSentence(
        sourceSentence,
        sentenceContext,
      );

      for (const sentenceId of matchedIds) {
        const sentenceKey = getSentenceKey(sentenceId);

        if (seen.has(sentenceKey)) {
          continue;
        }

        seen.add(sentenceKey);
        matchedSentenceIds.push(sentenceId);
      }
    }

    return matchedSentenceIds;
  }

  #matchSourceSentence(
    sourceSentence: string,
    sentenceContext: SentenceContext,
  ): readonly SentenceId[] {
    const raw = sourceSentence.trim();

    if (raw === "") {
      return [];
    }

    const exactMatch = sentenceContext.exactTextToIds.get(raw);

    if (exactMatch?.length === 1) {
      return exactMatch;
    }

    const normalized = normalizeText(raw);

    if (normalized === "") {
      return [];
    }

    const normalizedMatch = sentenceContext.normalizedTextToIds.get(normalized);

    if (normalizedMatch?.length === 1) {
      return normalizedMatch;
    }

    const contiguousMatch = this.#matchContiguousSentenceSpan(
      normalized,
      sentenceContext.sentences,
    );

    if (contiguousMatch.length > 0) {
      return contiguousMatch;
    }

    const substringMatches = sentenceContext.sentences.filter((sentence) =>
      normalizeText(sentence.text).includes(normalized),
    );

    if (substringMatches.length === 1) {
      const singleMatch = substringMatches[0];

      if (singleMatch !== undefined) {
        return [singleMatch.sentenceId];
      }
    }

    return [];
  }

  #matchContiguousSentenceSpan(
    targetNormalized: string,
    sentences: readonly ChunkExtractionSentence[],
  ): readonly SentenceId[] {
    const matches: SentenceId[][] = [];

    for (let start = 0; start < sentences.length; start += 1) {
      let combined = "";
      const sentenceIds: SentenceId[] = [];

      for (let end = start; end < sentences.length; end += 1) {
        const sentence = sentences[end];

        if (sentence === undefined) {
          break;
        }

        const normalizedSentence = normalizeText(sentence.text);

        if (normalizedSentence === "") {
          continue;
        }

        combined += normalizedSentence;
        sentenceIds.push(sentence.sentenceId);

        if (combined === targetNormalized) {
          matches.push([...sentenceIds]);
          break;
        }

        if (
          combined.length >= targetNormalized.length ||
          !targetNormalized.startsWith(combined)
        ) {
          break;
        }
      }
    }

    if (matches.length === 1) {
      return matches[0] ?? [];
    }

    return [];
  }

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

function createSentenceContext(
  sentences: readonly ChunkExtractionSentence[],
): SentenceContext {
  const exactTextToIds = new Map<string, SentenceId[]>();
  const normalizedTextToIds = new Map<string, SentenceId[]>();
  const textByKey = new Map<string, string>();
  const tokenCountByKey = new Map<string, number>();

  for (const sentence of sentences) {
    appendValue(exactTextToIds, sentence.text, sentence.sentenceId);

    const normalizedText = normalizeText(sentence.text);

    if (normalizedText !== "") {
      appendValue(normalizedTextToIds, normalizedText, sentence.sentenceId);
    }

    const sentenceKey = getSentenceKey(sentence.sentenceId);
    textByKey.set(sentenceKey, sentence.text);
    tokenCountByKey.set(sentenceKey, sentence.tokenCount);
  }

  return {
    exactTextToIds,
    normalizedTextToIds,
    sentences,
    textByKey,
    tokenCountByKey,
  };
}

function appendValue<TKey, TValue>(
  map: Map<TKey, TValue[]>,
  key: TKey,
  value: TValue,
): void {
  const values = map.get(key);

  if (values === undefined) {
    map.set(key, [value]);
    return;
  }

  values.push(value);
}

function looksLikeRefusalResponse(response: string): boolean {
  const stripped = response.trim();

  if (stripped === "" || stripped.includes("{") || stripped.includes("[")) {
    return false;
  }

  if (stripped.length > 120) {
    return false;
  }

  return REFUSAL_PATTERNS.some((pattern) => pattern.test(stripped));
}

function buildEmptyExtractionJson(stage: ExtractionStage): string {
  if (stage === "user_focused") {
    return JSON.stringify(
      {
        chunks: [],
        fragment_summary: "",
        links: [],
      },
      undefined,
      2,
    );
  }

  return JSON.stringify(
    {
      chunks: [],
      importance_annotations: [],
      links: [],
    },
    undefined,
    2,
  );
}

function normalizeChunkLinks(links: readonly RawChunkLink[]): ChunkLink[] {
  return links.map((link) => {
    if (link.strength === undefined) {
      return {
        from: link.from,
        to: link.to,
      };
    }

    return {
      from: link.from,
      strength: link.strength,
      to: link.to,
    };
  });
}

function getSourceSentences(data: ExtractedChunkData): readonly string[] {
  const sourceSentences = data.source_sentences;

  if (Array.isArray(sourceSentences)) {
    return sourceSentences;
  }

  const typoValue = (data as Record<string, unknown>).source_sences;

  if (
    Array.isArray(typoValue) &&
    typoValue.every((value) => typeof value === "string")
  ) {
    return typoValue;
  }

  const alternateTypoValue = (data as Record<string, unknown>).source_sentances;

  if (
    Array.isArray(alternateTypoValue) &&
    alternateTypoValue.every((value) => typeof value === "string")
  ) {
    return alternateTypoValue;
  }

  return [];
}

function formatChoiceCandidate(candidate: RankedSentenceCandidate): string {
  return [
    candidate.occurrenceId,
    `prev: ${formatChoiceText(candidate.prevText)}`,
    `text: ${formatChoiceText(candidate.text)}`,
    `next: ${formatChoiceText(candidate.nextText)}`,
  ].join("\n");
}

function formatChoiceText(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();

  return collapsed === "" ? "(none)" : collapsed;
}

function toChoiceFieldName(value: string): ChoiceFieldName | undefined {
  return value === "start_anchor" || value === "end_anchor" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isParsedJsonValidationFailure(error: unknown): boolean {
  return (
    error instanceof GuaranteedParseValidationError &&
    error.cause instanceof ParsedJsonError
  );
}

function getSentenceKey(sentenceId: SentenceId): string {
  return sentenceId.join(":");
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
