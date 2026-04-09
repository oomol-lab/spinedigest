import { z } from "zod";

import { requestGuaranteedJson } from "../guaranteed/index.js";
import type { Language } from "../language.js";
import type { LLMessage, LLM } from "../llm/index.js";
import type { SerialFragments } from "../model/index.js";
import type { Clue } from "./clue.js";
import {
  CLUE_REVIEWER_GENERATOR_PROMPT_PATH,
  CLUE_REVIEWER_PROMPT_PATH,
} from "./prompt-paths.js";
import { formatClueAsBook } from "./markup.js";
import type { ClueReviewerInfo, ReviewResult } from "./types.js";

const reviewIssueSchema = z.object({
  problem: z.string(),
  severity: z.enum(["critical", "major", "minor"]),
  suggestion: z.string().default(""),
});
const reviewResponseSchema = z.object({
  issues: z.array(reviewIssueSchema),
});

export type ReviewerHistories = Record<
  string,
  readonly [compressedText: string, rawResponse: string] | undefined
>;

export class CompressionReviewer<S extends string> {
  readonly #llm: LLM<S>;
  readonly #reviewGuideScope: S;
  readonly #reviewScope: S;
  readonly #serialFragments: SerialFragments;
  readonly #userLanguage: Language | undefined;

  public constructor(input: {
    llm: LLM<S>;
    reviewGuideScope: S;
    reviewScope: S;
    serialFragments: SerialFragments;
    userLanguage?: Language;
  }) {
    this.#llm = input.llm;
    this.#reviewGuideScope = input.reviewGuideScope;
    this.#reviewScope = input.reviewScope;
    this.#serialFragments = input.serialFragments;
    this.#userLanguage = input.userLanguage;
  }

  public async generateClueReviewers(
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
          scope: this.#reviewGuideScope,
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

  public async reviewCompression(
    compressedText: string,
    clueReviewers: readonly ClueReviewerInfo[],
    reviewerHistories: ReviewerHistories,
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
              scope: this.#reviewScope,
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
