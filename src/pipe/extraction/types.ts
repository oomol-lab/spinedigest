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

export interface ChunkExtractionPromptPaths {
  readonly bookCoherence: string;
  readonly evidenceChoice: string;
  readonly userFocused: string;
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

export interface ChunkTranslator {
  translate(
    chunks: readonly ChunkTranslationInput[],
    userLanguage: string,
  ): Promise<readonly ChunkTranslationOutput[]>;
}

export interface ChunkExtractorOptions<S extends string> {
  readonly extractionGuidance: string;
  readonly llm: LLM<S>;
  readonly prompts: ChunkExtractionPromptPaths;
  readonly scopes: ChunkExtractionScopes<S>;
  readonly sentenceTextSource: SentenceTextSource;
  readonly translator?: ChunkTranslator;
  readonly userLanguage?: string;
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

export interface RankedSentenceCandidate {
  readonly occurrenceId: string;
  readonly sentenceId: SentenceId;
  readonly index: number;
  readonly text: string;
  readonly prevText: string;
  readonly nextText: string;
  readonly score: number;
  readonly exactRaw: boolean;
  readonly exactNormalized: boolean;
  readonly exactSubstring: boolean;
}

export interface EvidenceResolutionResult {
  readonly sentenceIds: SentenceId[];
  readonly strategy: string;
  readonly confidence: number;
}

export interface EvidenceResolutionFailure {
  readonly fieldName: string;
  readonly code: string;
  readonly message: string;
  readonly candidates: readonly RankedSentenceCandidate[];
}
