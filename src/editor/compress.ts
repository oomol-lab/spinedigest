import { detect, validateISO2 } from "tinyld";
import { getLanguageDetectionCode, type Language } from "../language.js";
import type { LLMessage, LLM } from "../llm/index.js";
import type {
  ChunkRecord,
  SerialFragments,
  Workspace,
} from "../model/index.js";
import { extractCluesFromWorkspace, type Clue } from "./clue.js";
import {
  calculateScore,
  createRevisionFeedback,
  pickBestVersion,
} from "./feedback.js";
import { CompressionLog } from "./log.js";
import { formatChunksAsBook } from "./markup.js";
import { TEXT_COMPRESSOR_PROMPT_PATH } from "./prompt-paths.js";
import { CompressionReviewer, type ReviewerHistories } from "./review.js";
import type { CompressionVersion, ReviewResult } from "./types.js";

export interface EditorScopes<S extends string> {
  readonly compress: S;
  readonly review: S;
  readonly reviewGuide: S;
}

export interface CompressTextOptions<S extends string> {
  readonly compressionRatio?: number;
  readonly groupId: number;
  readonly llm: LLM<S>;
  readonly logDirPath?: string;
  readonly maxClues?: number;
  readonly maxIterations?: number;
  readonly scopes: EditorScopes<S>;
  readonly serialId: number;
  readonly userLanguage?: Language;
  readonly workspace: Workspace;
}

export async function compressText<S extends string>(
  options: CompressTextOptions<S>,
): Promise<string> {
  return await new CompressionOperation(options).run();
}

class CompressionOperation<S extends string> {
  readonly #compressionRatio: number;
  readonly #groupId: number;
  readonly #llm: LLM<S>;
  readonly #log: CompressionLog;
  readonly #maxClues: number;
  readonly #maxIterations: number;
  readonly #reviewer: CompressionReviewer<S>;
  readonly #scopes: EditorScopes<S>;
  readonly #serialFragments: SerialFragments;
  readonly #serialId: number;
  readonly #userLanguage: Language | undefined;
  readonly #workspace: Workspace;

  public constructor(options: CompressTextOptions<S>) {
    this.#compressionRatio = options.compressionRatio ?? 0.2;
    this.#groupId = options.groupId;
    this.#llm = options.llm;
    this.#maxClues = options.maxClues ?? 10;
    this.#maxIterations = options.maxIterations ?? 5;
    this.#scopes = options.scopes;
    this.#serialFragments = options.workspace.getSerialFragments(
      options.serialId,
    );
    this.#serialId = options.serialId;
    this.#userLanguage = options.userLanguage;
    this.#workspace = options.workspace;
    this.#log = new CompressionLog({
      compressionRatio: this.#compressionRatio,
      groupId: this.#groupId,
      maxIterations: this.#maxIterations,
      serialId: this.#serialId,
      ...(options.logDirPath === undefined
        ? {}
        : {
            logDirPath: options.logDirPath,
          }),
    });
    this.#reviewer = new CompressionReviewer({
      llm: this.#llm,
      reviewGuideScope: this.#scopes.reviewGuide,
      reviewScope: this.#scopes.review,
      serialFragments: this.#serialFragments,
      ...(this.#userLanguage === undefined
        ? {}
        : {
            userLanguage: this.#userLanguage,
          }),
    });
  }

  public async run(): Promise<string> {
    const fragmentIds = this.#getGroupFragmentIds();

    if (fragmentIds.length === 0) {
      return "";
    }

    const clues = extractCluesFromWorkspace({
      groupId: this.#groupId,
      maxClues: this.#maxClues,
      serialId: this.#serialId,
      workspace: this.#workspace,
    });
    const originalText = await this.#getFullText(fragmentIds);

    if (originalText.trim() === "") {
      return "";
    }

    await this.#log.initialize(clues);

    const markedOriginalText = await formatChunksAsBook({
      chunks: listClueChunks(clues),
      fragmentIds,
      serialFragments: this.#serialFragments,
      wrapHighRetention: true,
    });
    const clueReviewers = await this.#reviewer.generateClueReviewers(clues);
    const targetLength = Math.floor(
      originalText.length * this.#compressionRatio,
    );
    const versions: CompressionVersion[] = [];
    const reviewerHistories = Object.create(null) as ReviewerHistories;
    let previousCompressedText: string | undefined;
    let revisionFeedback: string | undefined;

    for (let iteration = 1; iteration <= this.#maxIterations; iteration += 1) {
      await this.#log.appendIterationHeader(iteration, revisionFeedback);

      const fullResponse = await this.#compressIteration(
        {
          markedText: markedOriginalText,
          targetLength,
        },
        previousCompressedText,
        revisionFeedback,
      );
      const compressedText = cleanChunkTags(
        extractCompressedText(fullResponse),
      );
      const thinkingText = extractThinkingText(fullResponse);

      await this.#log.appendCompressionResult({
        compressedText,
        thinkingText,
      });

      const reviewOutput = await this.#reviewer.reviewCompression(
        compressedText,
        clueReviewers,
        reviewerHistories,
      );
      const reviews = [...reviewOutput.reviews];
      const languageReview = this.#checkOutputLanguage(compressedText);

      if (languageReview !== undefined) {
        reviews.push(languageReview);
        await this.#log.appendLanguageMismatch({
          detectedLanguageCode: detectLanguageCode(compressedText) ?? "unknown",
          review: languageReview,
          targetLanguageCode: getLanguageDetectionCode(
            this.#userLanguage as Language,
          ),
          userLanguage: this.#userLanguage,
        });
      }

      const score = calculateScore(reviews);

      versions.push({
        iteration,
        reviews,
        score,
        text: compressedText,
      });

      if (score === 0) {
        break;
      }

      if (iteration >= this.#maxIterations) {
        continue;
      }

      revisionFeedback = createRevisionFeedback({
        llm: this.#llm,
        reviews,
      });
      previousCompressedText = compressedText;

      for (const clueId of Object.keys(reviewOutput.rawResponses)) {
        const rawResponse = reviewOutput.rawResponses[clueId];

        if (rawResponse === undefined) {
          continue;
        }

        reviewerHistories[clueId] = [compressedText, rawResponse];
      }
    }

    const bestVersion = pickBestVersion(versions);

    await this.#log.appendFinalSelection(bestVersion, originalText.length);

    return bestVersion.text;
  }

  #checkOutputLanguage(compressedText: string): ReviewResult | undefined {
    if (this.#userLanguage === undefined) {
      return undefined;
    }

    const targetLanguageCode = getLanguageDetectionCode(this.#userLanguage);

    if (targetLanguageCode === "") {
      return undefined;
    }

    const detectedLanguageCode = detectLanguageCode(compressedText);

    if (
      detectedLanguageCode === undefined ||
      detectedLanguageCode === targetLanguageCode
    ) {
      return undefined;
    }

    return {
      clueId: -1,
      issues: [
        {
          problem: `Output language error: detected ${detectedLanguageCode}, but ${targetLanguageCode} (${this.#userLanguage}) is required.`,
          severity: "critical",
          suggestion: `Please translate the entire compressed text to ${this.#userLanguage}. Maintain all information integrity and ensure the translation sounds natural and native, not machine-translated.`,
        },
      ],
      weight: 1,
    };
  }

  async #compressIteration(
    input: {
      markedText: string;
      targetLength: number;
    },
    previousCompressedText?: string,
    revisionFeedback?: string,
  ): Promise<string> {
    const acceptableMin = Math.floor(input.targetLength * 0.85);
    const acceptableMax = Math.floor(input.targetLength * 1.15);
    const systemPrompt = this.#llm.loadSystemPrompt(
      TEXT_COMPRESSOR_PROMPT_PATH,
      {
        acceptable_max: acceptableMax,
        acceptable_min: acceptableMin,
        compression_ratio: Math.floor(this.#compressionRatio * 100),
        original_length: input.markedText.length,
        target_length: input.targetLength,
        user_language: this.#userLanguage,
      },
    );
    const messages = buildCompressionMessages(
      {
        markedText: input.markedText,
        systemPrompt,
      },
      previousCompressedText,
      revisionFeedback,
    );

    return (
      await this.#llm.request(messages, {
        scope: this.#scopes.compress,
      })
    ).trim();
  }

  #getGroupFragmentIds(): number[] {
    return this.#workspace.fragmentGroups
      .listBySerial(this.#serialId)
      .filter((record) => record.groupId === this.#groupId)
      .map((record) => record.fragmentId)
      .sort(compareNumber);
  }

  async #getFullText(fragmentIds: readonly number[]): Promise<string> {
    const fragments = await Promise.all(
      fragmentIds.map(
        async (fragmentId) =>
          await this.#serialFragments.getFragment(fragmentId),
      ),
    );

    return fragments
      .flatMap((fragment) =>
        fragment.sentences.map((sentence) => sentence.text),
      )
      .join(" ");
  }
}

function buildCompressionMessages(
  input: {
    markedText: string;
    systemPrompt: string;
  },
  previousCompressedText?: string,
  revisionFeedback?: string,
): LLMessage[] {
  const messages: LLMessage[] = [
    {
      content: input.systemPrompt,
      role: "system",
    },
    {
      content: input.markedText,
      role: "user",
    },
  ];

  if (previousCompressedText !== undefined && revisionFeedback !== undefined) {
    messages.push(
      {
        content: previousCompressedText,
        role: "assistant",
      },
      {
        content: revisionFeedback,
        role: "user",
      },
    );
  }

  return messages;
}

function cleanChunkTags(text: string): string {
  return text.replace(/<chunk(?:\s+[^>]*)?>/g, "").replace(/<\/chunk>/g, "");
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function detectLanguageCode(text: string): string | undefined {
  const normalizedText = text.trim();

  if (normalizedText === "") {
    return undefined;
  }

  try {
    return normalizeLanguageCode(detect(normalizedText));
  } catch {
    return undefined;
  }
}

function extractCompressedText(fullResponse: string): string {
  const matchedCompressedSection = fullResponse.match(
    /##\s*(?:Compressed\s+Text|压缩文本)\s*\n+(.*?)(?:\n+---|\*\*CRITICAL\*\*|$)/is,
  );

  if (matchedCompressedSection?.[1] !== undefined) {
    return unwrapMarkdownCodeFence(matchedCompressedSection[1].trim());
  }

  return unwrapMarkdownCodeFence(fullResponse.trim());
}

function extractThinkingText(fullResponse: string): string {
  const matchedCompressedSection = fullResponse.match(
    /##\s*(?:Compressed\s+Text|压缩文本)\s*/i,
  );

  if (matchedCompressedSection?.index === undefined) {
    return "";
  }

  return fullResponse.slice(0, matchedCompressedSection.index).trim();
}

function listClueChunks(clues: readonly Clue[]): ChunkRecord[] {
  return clues.flatMap((clue) => clue.chunks);
}

function normalizeLanguageCode(languageCode: string): string | undefined {
  const normalizedLanguageCode = languageCode.trim().toLowerCase();
  const directLanguageCode = validateISO2(normalizedLanguageCode);

  if (directLanguageCode !== "") {
    return directLanguageCode;
  }

  const baseLanguageCode = normalizedLanguageCode.split("-")[0];

  if (baseLanguageCode === undefined) {
    return undefined;
  }

  const validatedBaseLanguageCode = validateISO2(baseLanguageCode);

  return validatedBaseLanguageCode === ""
    ? undefined
    : validatedBaseLanguageCode;
}

function unwrapMarkdownCodeFence(text: string): string {
  const matchedFence = text.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```$/);

  return matchedFence?.[1]?.trim() ?? text;
}
