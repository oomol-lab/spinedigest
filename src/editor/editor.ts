import type { Language } from "../language.js";
import type { LLM } from "../llm/index.js";
import type {
  ChunkRecord,
  SerialFragments,
  Workspace,
} from "../model/index.js";
import { extractCluesFromWorkspace, type Clue } from "./clue.js";
import { CompressionRequester } from "./compressor.js";
import {
  calculateScore,
  createRevisionFeedback,
  pickBestVersion,
} from "./feedback.js";
import { checkOutputLanguage } from "./language-review.js";
import { CompressionLog } from "./log.js";
import { formatChunksAsBook } from "./markup.js";
import {
  cleanChunkTags,
  extractCompressedText,
  extractThinkingText,
} from "./response.js";
import { CompressionReviewer, type ReviewerHistories } from "./review.js";
import type { CompressionVersion } from "./types.js";

export interface EditorScopes<S extends string> {
  readonly compress: S;
  readonly review: S;
  readonly reviewGuide: S;
}

export interface EditorOptions<S extends string> {
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
  options: EditorOptions<S>,
): Promise<string> {
  return await new EditorOperation(options).run();
}

class EditorOperation<S extends string> {
  readonly #compressionRatio: number;
  readonly #groupId: number;
  readonly #llm: LLM<S>;
  readonly #log: CompressionLog;
  readonly #maxClues: number;
  readonly #maxIterations: number;
  readonly #compressor: CompressionRequester<S>;
  readonly #reviewer: CompressionReviewer<S>;
  readonly #reviewScope: EditorScopes<S>;
  readonly #serialFragments: SerialFragments;
  readonly #serialId: number;
  readonly #userLanguage: Language | undefined;
  readonly #workspace: Workspace;

  public constructor(options: EditorOptions<S>) {
    this.#compressionRatio = options.compressionRatio ?? 0.2;
    this.#groupId = options.groupId;
    this.#llm = options.llm;
    this.#maxClues = options.maxClues ?? 10;
    this.#maxIterations = options.maxIterations ?? 5;
    this.#reviewScope = options.scopes;
    this.#serialFragments = options.workspace.getSerialFragments(
      options.serialId,
    );
    this.#serialId = options.serialId;
    this.#userLanguage = options.userLanguage;
    this.#workspace = options.workspace;
    this.#compressor = new CompressionRequester({
      compressionRatio: this.#compressionRatio,
      llm: this.#llm,
      scope: options.scopes.compress,
      ...(this.#userLanguage === undefined
        ? {}
        : {
            userLanguage: this.#userLanguage,
          }),
    });
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
      reviewGuideScope: this.#reviewScope.reviewGuide,
      reviewScope: this.#reviewScope.review,
      serialFragments: this.#serialFragments,
      ...(this.#userLanguage === undefined
        ? {}
        : {
            userLanguage: this.#userLanguage,
          }),
    });
  }

  public async run(): Promise<string> {
    const fragmentIds = await this.#getGroupFragmentIds();

    if (fragmentIds.length === 0) {
      return "";
    }

    const clues = await extractCluesFromWorkspace({
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

      const fullResponse = await this.#compressor.request({
        markedText: markedOriginalText,
        targetLength,
        ...(previousCompressedText === undefined
          ? {}
          : {
              previousCompressedText,
            }),
        ...(revisionFeedback === undefined
          ? {}
          : {
              revisionFeedback,
            }),
      });
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
      const languageReview = checkOutputLanguage({
        compressedText,
        ...(this.#userLanguage === undefined
          ? {}
          : {
              userLanguage: this.#userLanguage,
            }),
      });

      if (languageReview !== undefined) {
        reviews.push(languageReview.review);
        await this.#log.appendLanguageMismatch({
          detectedLanguageCode: languageReview.detectedLanguageCode,
          review: languageReview.review,
          targetLanguageCode: languageReview.targetLanguageCode,
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

  async #getGroupFragmentIds(): Promise<number[]> {
    return (await this.#workspace.fragmentGroups.listBySerial(this.#serialId))
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

function compareNumber(left: number, right: number): number {
  return left - right;
}

function listClueChunks(clues: readonly Clue[]): ChunkRecord[] {
  return clues.flatMap((clue) => clue.chunks);
}
