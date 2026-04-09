import type {
  ChunkGraphDelta as AttentionChunkGraphDelta,
  ChunkGraphEdge as AttentionChunkGraphEdge,
} from "./attention/attention.js";
import type {
  ChunkBatchOptions,
  ChunkExtractionSentence,
  ChunkImportanceAnnotation,
  CognitiveChunk,
} from "./chunk-batch/types.js";
import type {
  SentenceStreamAdapter,
  SentenceStreamItem,
  TextStream,
} from "./segment/types.js";

export type PipeTextStream = TextStream;

export type PipeSegment = SentenceStreamItem;

export type PipeSegmenter = SentenceStreamAdapter;

export type PipeSentence = ChunkExtractionSentence;

export type PipeChunk = CognitiveChunk;

export type PipeGraphEdge = AttentionChunkGraphEdge;

export type PipeImportanceAnnotation = ChunkImportanceAnnotation;

export type PipeGraphDelta = AttentionChunkGraphDelta;

export interface PipeOptions<S extends string> extends ChunkBatchOptions<S> {
  readonly attention: {
    readonly capacity: number;
    readonly generationDecayFactor: number;
    readonly idGenerator: () => Promise<number>;
  };
  readonly segmenter?: PipeSegmenter;
}
