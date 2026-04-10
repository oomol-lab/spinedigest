import type { Language } from "../../language.js";
import type { LLM } from "../../llm/index.js";
import type { SentenceId } from "../../model/index.js";

export interface ChunkLink {
  readonly from: number | string;
  readonly strength?: string;
  readonly to: number | string;
}

export interface ChunkImportanceAnnotation {
  readonly chunkId: number;
  readonly importance: string;
}

export interface CognitiveChunk {
  id: number;
  generation: number;
  sentenceId: SentenceId;
  label: string;
  content: string;
  sentenceIds: SentenceId[];
  links: number[];
  retention?: string;
  importance?: string;
  tokens: number;
}

export interface ChunkBatch {
  readonly chunks: CognitiveChunk[];
  readonly tempIds: string[];
  readonly links: readonly ChunkLink[];
  readonly orderCorrect: boolean;
  readonly importanceAnnotations?: readonly ChunkImportanceAnnotation[];
}

export interface ChunkExtractionScopes<S extends string> {
  readonly choice: S;
  readonly extraction: S;
}

export interface SentenceTextSource {
  getSentence(sentenceId: SentenceId): Promise<string>;
}

export interface ChunkTranslationInput {
  readonly content: string;
  readonly id: number;
  readonly label: string;
  readonly sourceSentences: readonly string[];
}

export interface ChunkTranslationOutput {
  readonly content: string;
  readonly id: number;
  readonly label: string;
}

export interface ChunkBatchOptions<S extends string> {
  readonly extractionGuidance: string;
  readonly llm: LLM<S>;
  readonly scopes: ChunkExtractionScopes<S>;
  readonly sentenceTextSource: SentenceTextSource;
  readonly userLanguage?: Language;
}

export interface ChunkExtractionSentence {
  readonly sentenceId: SentenceId;
  readonly text: string;
  readonly tokenCount: number;
}

export interface ExtractUserFocusedInput {
  readonly text: string;
  readonly workingMemoryPrompt: string;
  readonly visibleChunkIds: readonly number[];
  readonly sentences: readonly ChunkExtractionSentence[];
}

export interface ExtractUserFocusedResult {
  readonly chunkBatch: ChunkBatch;
  readonly fragmentSummary: string;
}

export interface ExtractBookCoherenceInput {
  readonly text: string;
  readonly workingMemoryPrompt: string;
  readonly visibleChunkIds: readonly number[];
  readonly sentences: readonly ChunkExtractionSentence[];
  readonly userFocusedChunks: readonly CognitiveChunk[];
}
