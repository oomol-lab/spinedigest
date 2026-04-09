import { Attention } from "./attention/attention.js";
import {
  extractBookCoherenceChunkBatch,
  extractUserFocusedChunkBatch,
} from "./chunk-batch/extract.js";
import { segmentTextStream } from "./segment/segment.js";
import type { ChunkBatchOptions } from "./chunk-batch/types.js";
import type {
  PipeChunk,
  PipeGraphDelta,
  PipeOptions,
  PipeSegment,
  PipeSentence,
  PipeTextStream,
} from "./types.js";

export class Pipe<S extends string> {
  readonly #attention: Attention;
  readonly #chunkBatchOptions: ChunkBatchOptions<S>;
  readonly #segmenter: PipeOptions<S>["segmenter"];

  public constructor(options: PipeOptions<S>) {
    this.#attention = new Attention(options.attention);
    this.#chunkBatchOptions = {
      extractionGuidance: options.extractionGuidance,
      llm: options.llm,
      scopes: options.scopes,
      sentenceTextSource: options.sentenceTextSource,
      ...(options.translator === undefined
        ? {}
        : {
            translator: options.translator,
          }),
      ...(options.userLanguage === undefined
        ? {}
        : {
            userLanguage: options.userLanguage,
          }),
    };
    this.#segmenter = options.segmenter;
  }

  public get capacity(): number {
    return this.#attention.capacity;
  }

  public segment(stream: PipeTextStream): AsyncIterable<PipeSegment> {
    if (this.#segmenter === undefined) {
      return segmentTextStream(stream);
    }

    return segmentTextStream(stream, {
      adapter: this.#segmenter,
    });
  }

  public async extractUserFocused(input: {
    readonly sentences: readonly PipeSentence[];
    readonly text: string;
  }): Promise<{
    readonly delta: PipeGraphDelta;
    readonly fragmentSummary: string;
  }> {
    const context = this.#attention.createChunkBatchContext();
    const result = await extractUserFocusedChunkBatch(this.#chunkBatchOptions, {
      sentences: input.sentences,
      text: input.text,
      visibleChunkIds: context.visibleChunkIds,
      workingMemoryPrompt: context.workingMemoryPrompt,
    });

    return {
      delta: await this.#attention.acceptChunkBatch(result.chunkBatch),
      fragmentSummary: result.fragmentSummary,
    };
  }

  public async extractBookCoherence(input: {
    readonly sentences: readonly PipeSentence[];
    readonly text: string;
    readonly userFocusedChunks: readonly PipeChunk[];
  }): Promise<PipeGraphDelta> {
    const context = this.#attention.createChunkBatchContext();
    const chunkBatch = await extractBookCoherenceChunkBatch(
      this.#chunkBatchOptions,
      {
        sentences: input.sentences,
        text: input.text,
        userFocusedChunks: input.userFocusedChunks,
        visibleChunkIds: context.visibleChunkIds,
        workingMemoryPrompt: context.workingMemoryPrompt,
      },
    );

    return await this.#attention.acceptChunkBatch(chunkBatch);
  }

  public completeFragment(input: {
    readonly allChunks: readonly PipeChunk[];
    readonly getSuccessorChunkIds: (chunkId: number) => readonly number[];
  }): void {
    this.#attention.completeFragment(input);
  }

  public clear(): void {
    this.#attention.clear();
  }
}
