import { appendFile, mkdir, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { detect, validateISO2 } from "tinyld";
import { z } from "zod";

import { requestGuaranteedJson } from "../guaranteed/index.js";
import { getLanguageDetectionCode, type Language } from "../language.js";
import type { LLMessage, LLM } from "../llm/index.js";
import type {
  ChunkRecord,
  SerialFragments,
  Workspace,
} from "../model/index.js";
import { extractCluesFromWorkspace, type Clue } from "./clue.js";
import { formatChunksAsBook, formatClueAsBook } from "./markup.js";

const MODULE_DIR_PATH = dirname(fileURLToPath(import.meta.url));
const DATA_DIR_PATH = resolve(MODULE_DIR_PATH, "..", "..", "data", "editor");
const CLUE_REVIEWER_PROMPT_PATH = resolve(DATA_DIR_PATH, "clue_reviewer.jinja");
const CLUE_REVIEWER_GENERATOR_PROMPT_PATH = resolve(
  DATA_DIR_PATH,
  "clue_reviewer_generator.jinja",
);
const REVISION_FEEDBACK_PROMPT_PATH = resolve(
  DATA_DIR_PATH,
  "revision_feedback.jinja",
);
const TEXT_COMPRESSOR_PROMPT_PATH = resolve(
  DATA_DIR_PATH,
  "text_compressor.jinja",
);
const REVIEW_SEVERITY_VALUE = Object.freeze({
  critical: 9,
  major: 3,
  minor: 1,
});
const reviewIssueSchema = z.object({
  problem: z.string(),
  severity: z.enum(["critical", "major", "minor"]),
  suggestion: z.string().default(""),
});
const reviewResponseSchema = z.object({
  issues: z.array(reviewIssueSchema),
});

interface ClueReviewerInfo {
  readonly clueId: number;
  readonly label: string;
  readonly reviewerInfo: string;
  readonly weight: number;
}

interface CompressionVersion {
  readonly iteration: number;
  readonly reviews: readonly ReviewResult[];
  readonly score: number;
  readonly text: string;
}

interface ReviewIssue {
  readonly problem: string;
  readonly severity: keyof typeof REVIEW_SEVERITY_VALUE;
  readonly suggestion: string;
}

interface ReviewResult {
  readonly clueId: number;
  readonly issues: readonly ReviewIssue[];
  readonly weight: number;
}

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
  readonly #logDirPath: string | undefined;
  readonly #maxClues: number;
  readonly #maxIterations: number;
  readonly #scopes: EditorScopes<S>;
  readonly #serialFragments: SerialFragments;
  readonly #serialId: number;
  readonly #userLanguage: Language | undefined;
  readonly #workspace: Workspace;
  #logFilePath: string | undefined;

  public constructor(options: CompressTextOptions<S>) {
    this.#compressionRatio = options.compressionRatio ?? 0.2;
    this.#groupId = options.groupId;
    this.#llm = options.llm;
    this.#logDirPath = options.logDirPath;
    this.#maxClues = options.maxClues ?? 10;
    this.#maxIterations = options.maxIterations ?? 5;
    this.#scopes = options.scopes;
    this.#serialFragments = options.workspace.getSerialFragments(
      options.serialId,
    );
    this.#serialId = options.serialId;
    this.#userLanguage = options.userLanguage;
    this.#workspace = options.workspace;
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

    await this.#initializeLog(clues);

    const markedOriginalText = await formatChunksAsBook({
      chunks: listClueChunks(clues),
      fragmentIds,
      serialFragments: this.#serialFragments,
      wrapHighRetention: true,
    });
    const clueReviewers = await this.#generateClueReviewers(clues);
    const targetLength = Math.floor(
      originalText.length * this.#compressionRatio,
    );
    const versions: CompressionVersion[] = [];
    const reviewerHistories = Object.create(null) as Record<
      string,
      readonly [compressedText: string, rawResponse: string] | undefined
    >;
    let previousCompressedText: string | undefined;
    let revisionFeedback: string | undefined;

    for (let iteration = 1; iteration <= this.#maxIterations; iteration += 1) {
      await this.#appendIterationHeader(iteration, revisionFeedback);

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

      await this.#appendCompressionLog(fullResponse, compressedText);

      const reviewOutput = await this.#reviewCompression(
        compressedText,
        clueReviewers,
        reviewerHistories,
      );
      const reviews = [...reviewOutput.reviews];
      const languageReview = this.#checkOutputLanguage(compressedText);

      if (languageReview !== undefined) {
        reviews.push(languageReview);
        await this.#appendLanguageMismatchLog(languageReview, compressedText);
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

      revisionFeedback = this.#collectFeedback(reviews);
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

    await this.#appendFinalSelection(bestVersion, originalText.length);

    return bestVersion.text;
  }

  async #appendCompressionLog(
    fullResponse: string,
    compressedText: string,
  ): Promise<void> {
    if (this.#logFilePath === undefined) {
      return;
    }

    const thinkingText = extractThinkingText(fullResponse);
    const parts: string[] = [];

    if (thinkingText !== "") {
      parts.push("Thinking:", "-".repeat(80), thinkingText, "-".repeat(80), "");
    }

    parts.push(
      `Compressed Text (${compressedText.length} characters):`,
      "-".repeat(80),
      compressedText,
      "-".repeat(80),
      "",
      "",
    );

    await appendFile(this.#logFilePath, `${parts.join("\n")}\n`, "utf8");
  }

  async #appendFinalSelection(
    bestVersion: CompressionVersion,
    originalLength: number,
  ): Promise<void> {
    if (this.#logFilePath === undefined) {
      return;
    }

    const parts = [
      "",
      "=".repeat(80),
      "FINAL SELECTION",
      "=".repeat(80),
      "",
      `Selected: Iteration ${bestVersion.iteration}/${this.#maxIterations}`,
      `Score: ${bestVersion.score.toFixed(2)}`,
      `Length: ${bestVersion.text.length} characters`,
      `Compression ratio: ${(bestVersion.text.length / originalLength).toFixed(1)}%`,
      "",
      "=".repeat(80),
      "",
    ];

    if (bestVersion.score > 0) {
      parts.push(
        "REMAINING UNRESOLVED ISSUES",
        "=".repeat(80),
        "",
        formatIssuesForLog(bestVersion.reviews),
        "=".repeat(80),
        "",
      );
    }

    await appendFile(this.#logFilePath, `${parts.join("\n")}\n`, "utf8");
  }

  async #appendIterationHeader(
    iteration: number,
    revisionFeedback: string | undefined,
  ): Promise<void> {
    if (this.#logFilePath === undefined) {
      return;
    }

    const parts = [
      "",
      "=".repeat(80),
      `ITERATION ${iteration}/${this.#maxIterations}`,
      "=".repeat(80),
      "",
    ];

    if (revisionFeedback !== undefined && revisionFeedback.trim() !== "") {
      parts.push(
        "Revision Feedback:",
        "-".repeat(80),
        revisionFeedback,
        "-".repeat(80),
        "",
      );
    }

    await appendFile(this.#logFilePath, `${parts.join("\n")}\n`, "utf8");
  }

  async #appendLanguageMismatchLog(
    review: ReviewResult,
    compressedText: string,
  ): Promise<void> {
    if (this.#logFilePath === undefined) {
      return;
    }

    const issue = review.issues[0];

    if (issue === undefined) {
      return;
    }

    const detectedLanguageCode =
      detectLanguageCode(compressedText) ?? "unknown";
    const targetLanguageCode = getLanguageDetectionCode(
      this.#userLanguage as Language,
    );

    const parts = [
      "",
      "!".repeat(80),
      "LANGUAGE MISMATCH DETECTED",
      "!".repeat(80),
      `Expected: ${targetLanguageCode} (${this.#userLanguage ?? "unknown"})`,
      `Detected: ${detectedLanguageCode}`,
      `Issue: ${issue.problem}`,
      `Suggestion: ${issue.suggestion}`,
      "!".repeat(80),
      "",
    ];

    await appendFile(this.#logFilePath, `${parts.join("\n")}\n`, "utf8");
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

  #collectFeedback(reviews: readonly ReviewResult[]): string {
    const allIssues = collectIssues(reviews);
    const visibleIssues = allIssues.slice(0, 9);
    const hiddenCount = allIssues.length - visibleIssues.length;
    const issueLines: string[] = [];

    for (let index = 0; index < visibleIssues.length; index += 1) {
      const issue = visibleIssues[index];

      if (issue === undefined) {
        continue;
      }

      issueLines.push(
        `${index + 1}. [${issue.severity.toUpperCase()}]`,
        `   Problem: ${issue.problem}`,
      );

      if (issue.suggestion !== "") {
        issueLines.push(`   Suggestion: ${issue.suggestion}`);
      }

      issueLines.push("");
    }

    if (hiddenCount > 0) {
      issueLines.push(
        `... and ${hiddenCount} more issues hidden (lower priority)`,
      );
    }

    return this.#llm.loadSystemPrompt(REVISION_FEEDBACK_PROMPT_PATH, {
      issues_description: issueLines.join("\n"),
    });
  }

  async #generateClueReviewers(
    clues: readonly Clue[],
  ): Promise<readonly ClueReviewerInfo[]> {
    return await Promise.all(
      clues.map(async (clue) => {
        const clueText = await formatClueAsBook({
          chunks: clue.chunks,
          fullMarkup: true,
          serialFragments: this.#serialFragments,
        });
        const messages: LLMessage[] = [
          {
            content: this.#llm.loadSystemPrompt(
              CLUE_REVIEWER_GENERATOR_PROMPT_PATH,
            ),
            role: "system",
          },
          {
            content: clueText,
            role: "user",
          },
        ];
        const reviewerInfo = await this.#llm.request(messages, {
          scope: this.#scopes.reviewGuide,
        });

        return {
          clueId: clue.clueId,
          label: clue.label,
          reviewerInfo: reviewerInfo.trim(),
          weight: clue.weight,
        };
      }),
    );
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

  async #initializeLog(clues: readonly Clue[]): Promise<void> {
    if (this.#logDirPath === undefined) {
      return;
    }

    const timestamp = formatTimestamp(new Date());

    await mkdir(this.#logDirPath, { recursive: true });
    this.#logFilePath = join(
      this.#logDirPath,
      `compression serial-${this.#serialId} group-${this.#groupId} ${timestamp}.log`,
    );

    const hierarchy = this.#formatChunkHierarchy(clues);

    await writeFile(
      this.#logFilePath,
      [
        "=== Text Compression Log ===",
        `Serial: ${this.#serialId}, Group: ${this.#groupId}`,
        `Started at: ${timestamp}`,
        `Compression ratio target: ${Math.round(this.#compressionRatio * 100)}%`,
        `Max iterations: ${this.#maxIterations}`,
        "",
        "",
        hierarchy,
        "",
      ].join("\n"),
      "utf8",
    );
  }

  #formatChunkHierarchy(clues: readonly Clue[]): string {
    const parts = [
      "=".repeat(80),
      `CHUNK HIERARCHY - Serial ${this.#serialId}, Group ${this.#groupId}`,
      "=".repeat(80),
      "",
    ];

    for (let clueIndex = 0; clueIndex < clues.length; clueIndex += 1) {
      const clue = clues[clueIndex];

      if (clue === undefined) {
        continue;
      }

      parts.push(
        `Clue #${clueIndex + 1} (ID: ${clue.clueId})`,
        `|- Weight: ${clue.weight.toFixed(4)}`,
        `|- Label: ${clue.label}`,
        `|- Source snakes: ${clue.sourceSnakeIds.join(", ")}`,
        `|- Merged: ${clue.isMerged ? "yes" : "no"}`,
        `\\- Chunks: ${clue.chunks.length}`,
        "",
      );

      for (
        let chunkIndex = 0;
        chunkIndex < clue.chunks.length;
        chunkIndex += 1
      ) {
        const chunk = clue.chunks[chunkIndex];

        if (chunk === undefined) {
          continue;
        }

        const contentPreview =
          chunk.content.length > 60
            ? `${chunk.content.slice(0, 60)}...`
            : chunk.content;

        parts.push(
          `  - Chunk ${chunkIndex + 1}/${clue.chunks.length} (ID: ${chunk.id})`,
          `    Label: ${chunk.label}`,
          `    Retention: ${chunk.retention ?? "N/A"}`,
          `    Importance: ${chunk.importance ?? "N/A"}`,
          `    Content: ${contentPreview}`,
          "",
        );
      }
    }

    parts.push("=".repeat(80), "");

    return parts.join("\n");
  }

  async #reviewCompression(
    compressedText: string,
    clueReviewers: readonly ClueReviewerInfo[],
    reviewerHistories: Record<
      string,
      readonly [compressedText: string, rawResponse: string] | undefined
    >,
  ): Promise<{
    readonly rawResponses: Readonly<Record<string, string | undefined>>;
    readonly reviews: readonly ReviewResult[];
  }> {
    const results = await Promise.all(
      clueReviewers.map(async (clueReviewer) => {
        const systemPrompt = this.#llm.loadSystemPrompt(
          CLUE_REVIEWER_PROMPT_PATH,
          {
            thread_info: clueReviewer.reviewerInfo,
            user_language: this.#userLanguage,
          },
        );
        const previousHistory = reviewerHistories[String(clueReviewer.clueId)];
        const messages = buildReviewMessages(
          {
            compressedText,
            systemPrompt,
          },
          previousHistory,
        );

        return await requestGuaranteedJson({
          messages,
          parse: (data) => ({
            rawResponse: JSON.stringify(data),
            review: {
              clueId: clueReviewer.clueId,
              issues: data.issues,
              weight: clueReviewer.weight,
            },
          }),
          request: async (retryMessages, retryIndex, retryMax) =>
            await this.#llm.request(retryMessages, {
              retryIndex,
              retryMax,
              scope: this.#scopes.review,
              useCache: false,
            }),
          schema: reviewResponseSchema,
        });
      }),
    );
    const rawResponses = Object.create(null) as Record<
      string,
      string | undefined
    >;

    for (const result of results) {
      rawResponses[String(result.review.clueId)] = result.rawResponse;
    }

    return {
      rawResponses,
      reviews: results.map((result) => result.review),
    };
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

function buildReviewMessages(
  input: {
    compressedText: string;
    systemPrompt: string;
  },
  previousHistory?: readonly [compressedText: string, rawResponse: string],
): LLMessage[] {
  if (previousHistory === undefined) {
    return [
      {
        content: input.systemPrompt,
        role: "system",
      },
      {
        content: input.compressedText,
        role: "user",
      },
    ];
  }

  return [
    {
      content: input.systemPrompt,
      role: "system",
    },
    {
      content: previousHistory[0],
      role: "user",
    },
    {
      content: previousHistory[1],
      role: "assistant",
    },
    {
      content: input.compressedText,
      role: "user",
    },
  ];
}

function calculateScore(reviews: readonly ReviewResult[]): number {
  let totalScore = 0;

  for (const review of reviews) {
    for (const issue of review.issues) {
      totalScore += REVIEW_SEVERITY_VALUE[issue.severity] * review.weight;
    }
  }

  return totalScore;
}

function cleanChunkTags(text: string): string {
  return text.replace(/<chunk(?:\s+[^>]*)?>/g, "").replace(/<\/chunk>/g, "");
}

function collectIssues(
  reviews: readonly ReviewResult[],
): Array<ReviewIssue & { readonly weight: number }> {
  const issues = reviews.flatMap((review) =>
    review.issues.map((issue) => ({
      ...issue,
      weight: review.weight,
    })),
  );

  issues.sort((left, right) => {
    const severityDelta =
      REVIEW_SEVERITY_VALUE[right.severity] -
      REVIEW_SEVERITY_VALUE[left.severity];

    if (severityDelta !== 0) {
      return severityDelta;
    }

    return right.weight - left.weight;
  });

  return issues;
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

function formatIssuesForLog(reviews: readonly ReviewResult[]): string {
  const issues = collectIssues(reviews);

  if (issues.length === 0) {
    return "No issues found - all reviewers are satisfied.\n";
  }

  const lines: string[] = [];

  for (let index = 0; index < issues.length; index += 1) {
    const issue = issues[index];

    if (issue === undefined) {
      continue;
    }

    lines.push(
      `${index + 1}. [${issue.severity.toUpperCase()}]`,
      `   Problem: ${issue.problem}`,
    );

    if (issue.suggestion !== "") {
      lines.push(`   Suggestion: ${issue.suggestion}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}-${minutes}-${seconds}`;
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

function pickBestVersion(
  versions: readonly CompressionVersion[],
): CompressionVersion {
  const bestVersion = versions.reduce<CompressionVersion | undefined>(
    (currentBest, version) => {
      if (currentBest === undefined || version.score < currentBest.score) {
        return version;
      }

      return currentBest;
    },
    undefined,
  );

  if (bestVersion === undefined) {
    throw new Error("Compression failed: no versions generated");
  }

  return bestVersion;
}

function unwrapMarkdownCodeFence(text: string): string {
  const matchedFence = text.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```$/);

  return matchedFence?.[1]?.trim() ?? text;
}
