import type { LLMessage, LLM } from "../llm/index.js";
import { TEXT_COMPRESSOR_PROMPT_PATH } from "./prompt-paths.js";

export class CompressionRequester<S extends string> {
  readonly #compressionRatio: number;
  readonly #llm: LLM<S>;
  readonly #scope: S;
  readonly #userLanguage: string | undefined;

  public constructor(input: {
    compressionRatio: number;
    llm: LLM<S>;
    scope: S;
    userLanguage?: string;
  }) {
    this.#compressionRatio = input.compressionRatio;
    this.#llm = input.llm;
    this.#scope = input.scope;
    this.#userLanguage = input.userLanguage;
  }

  public async request(input: {
    markedText: string;
    previousCompressedText?: string;
    revisionFeedback?: string;
    targetLength: number;
  }): Promise<string> {
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
      input.previousCompressedText,
      input.revisionFeedback,
    );

    return (
      await this.#llm.request(messages, {
        scope: this.#scope,
      })
    ).trim();
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
