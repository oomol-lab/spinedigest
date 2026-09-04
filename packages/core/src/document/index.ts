export { Database } from "./database.js";
export {
  ensureSharedStateDatabaseInitialized,
  openSharedStateDatabase,
  openWikiGraphStateDatabase,
} from "./shared-state-database.js";
export { TextStreams, SerialTextStream } from "./text-streams/index.js";
export {
  FragmentDraft,
  Fragments,
  SerialFragments,
} from "./fragments/index.js";
export type {
  ReadonlySerialTextStream,
  ReadonlySerialTextStream as ReadonlySerialFragments,
  ReadonlyTextStreams,
  ReadonlyTextStreams as ReadonlyFragments,
} from "./text-streams/index.js";
export { DirectoryDocument } from "./directory/index.js";
export { createFragmentBackedDocument } from "./fragment-backed.js";
export type {
  Document,
  DocumentContext,
  ReadonlyDocument,
} from "./directory/index.js";
export { SCHEMA_SQL } from "./schema.js";
export {
  createSourceArtifactShortUid,
  formatSourceArtifactUri,
  formatSourceLocatorFragment,
  normalizeSourceArtifactDigest,
  normalizeSourceArtifactReference,
  parseSourceLocatorFragment,
  SOURCE_ARTIFACT_SHORT_UID_LENGTH,
} from "./source-locator.js";
export type { ParsedSourceLocatorFragment } from "./source-locator.js";
export {
  ChunkStore,
  FragmentGroupStore,
  GraphBuildParameterStore,
  IndexArtifactStore,
  ReadingEdgeStore,
  MentionLinkStore,
  MentionStore,
  ObjectMetadataStore,
  SerialStore,
  SourceProvenanceStore,
  SnakeChunkStore,
  SnakeEdgeStore,
  SnakeStore,
} from "./stores/index.js";
export type {
  ReadonlyChunkStore,
  ReadonlyFragmentGroupStore,
  ReadonlyGraphBuildParameterStore,
  ReadonlyIndexArtifactStore,
  ReadonlyReadingEdgeStore,
  ReadonlyMentionLinkStore,
  ReadonlyMentionStore,
  ReadonlyObjectMetadataStore,
  ReadonlySerialStore,
  ReadonlySourceProvenanceStore,
  ReadonlySnakeChunkStore,
  ReadonlySnakeEdgeStore,
  ReadonlySnakeStore,
} from "./stores/index.js";
export {
  ChunkImportance,
  ChunkRetention,
  INDEX_ARTIFACT_KINDS,
  expectChunkImportance,
  expectChunkRetention,
  isChunkImportance,
  isChunkRetention,
  ObjectMetadataKind,
} from "./types.js";
export type {
  ChunkRecord,
  CreateSnakeRecord,
  FragmentRecord,
  GraphBuildParameterRecord,
  IndexArtifactCoverageRecord,
  IndexArtifactEmbeddingSegment,
  IndexArtifactKind,
  IndexArtifactLexicalRow,
  IndexArtifactRecord,
  ReadingEdgeRecord,
  ReplaceEmbeddingIndexArtifactInput,
  ReplaceFtsIndexArtifactInput,
  MentionLinkRecord,
  MentionRecord,
  ObjectMetadataTarget,
  SerialRecord,
  SourceArtifactInput,
  SourceArtifactRecord,
  SourceLocatorRecord,
  SourceTextMapRecord,
  SourceTextMappingInput,
  SourceTextProvenanceInput,
  SentenceId,
  SentenceGroupRecord,
  SentenceRecord,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
} from "./types.js";
