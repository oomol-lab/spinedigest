import type {
  ChunkRecord,
  FragmentRecord,
  ReadingEdgeRecord,
  SentenceGroupRecord,
  SerialRecord,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
} from "../../document/index.js";
import type { LLM } from "../../external/llm/index.js";
import type { Language } from "../../runtime/common/language.js";
import type { WikiGraphScope } from "../../runtime/common/llm-scope.js";
import type { Directory, File } from "../../runtime/platform/index.js";

export interface ChapterSummaryInputSnapshot {
  readonly file: File;
  readonly objectsFile: File;
}

export interface BuildChapterSummaryArtifactOptions {
  readonly llm: LLM<WikiGraphScope>;
  readonly logDirectory?: Directory;
  readonly readingGraphObjectsFile?: File;
  readonly snapshotFile?: File;
  readonly sourceDocumentDirectory?: Directory;
  readonly userLanguage?: Language;
  readonly workspace: Directory;
}

export interface SummaryInputSnapshotData {
  readonly chunks: readonly ChunkRecord[];
  readonly fragmentGroups: readonly SentenceGroupRecord[];
  readonly fragments: readonly FragmentRecord[];
  readonly readingEdges: readonly ReadingEdgeRecord[];
  readonly serial: SerialRecord;
  readonly snakeChunks: readonly SnakeChunkRecord[];
  readonly snakeEdges: readonly SnakeEdgeRecord[];
  readonly snakes: readonly SnakeRecord[];
}
