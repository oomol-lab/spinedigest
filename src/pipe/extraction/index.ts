export { EvidenceResolver } from "./evidence-resolver.js";
export { ChunkExtractor } from "./extractor.js";
export { splitTextIntoSentences, normalizeText } from "./text.js";
export { WorkingMemory } from "./working-memory.js";
export type {
  ChunkBatch,
  ChunkExtractionScopes,
  ChunkExtractionSentence,
  ChunkExtractorOptions,
  ChunkImportanceAnnotation,
  ChunkLink,
  ChunkTranslationInput,
  ChunkTranslationOutput,
  ChunkTranslator,
  CognitiveChunk,
  EvidenceResolutionFailure,
  EvidenceResolutionResult,
  ExtractBookCoherenceInput,
  ExtractUserFocusedInput,
  ExtractUserFocusedResult,
  RankedSentenceCandidate,
  SentenceTextSource,
} from "./types.js";
