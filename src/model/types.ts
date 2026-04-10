export enum ChunkRetention {
  Verbatim = "verbatim",
  Detailed = "detailed",
  Focused = "focused",
  Relevant = "relevant",
}

const CHUNK_RETENTION_SET = new Set<string>(Object.values(ChunkRetention));

export function isChunkRetention(value: string): value is ChunkRetention {
  return CHUNK_RETENTION_SET.has(value);
}

export enum ChunkImportance {
  Critical = "critical",
  Important = "important",
  Helpful = "helpful",
}

const CHUNK_IMPORTANCE_SET = new Set<string>(Object.values(ChunkImportance));

export function isChunkImportance(value: string): value is ChunkImportance {
  return CHUNK_IMPORTANCE_SET.has(value);
}

export type SentenceId = readonly [
  serialId: number,
  fragmentId: number,
  sentenceIndex: number,
];

export interface SentenceRecord {
  readonly text: string;
  readonly tokenCount: number;
}

export interface FragmentRecord {
  readonly serialId: number;
  readonly fragmentId: number;
  readonly summary: string;
  readonly sentences: readonly SentenceRecord[];
}

export interface SerialRecord {
  readonly id: number;
  readonly topologyReady: boolean;
}

export interface ChunkRecord {
  readonly id: number;
  readonly generation: number;
  readonly sentenceId: SentenceId;
  readonly label: string;
  readonly content: string;
  readonly sentenceIds: readonly SentenceId[];
  readonly retention?: ChunkRetention;
  readonly importance?: ChunkImportance;
  readonly tokens: number;
  readonly weight: number;
}

export interface KnowledgeEdgeRecord {
  readonly fromId: number;
  readonly toId: number;
  readonly strength?: string;
  readonly weight: number;
}

export interface SnakeRecord {
  readonly id: number;
  readonly serialId: number;
  readonly groupId: number;
  readonly localSnakeId: number;
  readonly size: number;
  readonly firstLabel: string;
  readonly lastLabel: string;
  readonly tokens: number;
  readonly weight: number;
}

export interface CreateSnakeRecord {
  readonly serialId: number;
  readonly groupId: number;
  readonly localSnakeId: number;
  readonly size: number;
  readonly firstLabel: string;
  readonly lastLabel: string;
  readonly tokens?: number;
  readonly weight?: number;
}

export interface SnakeChunkRecord {
  readonly snakeId: number;
  readonly chunkId: number;
  readonly position: number;
}

export interface SnakeEdgeRecord {
  readonly fromSnakeId: number;
  readonly toSnakeId: number;
  readonly weight: number;
}

export interface FragmentGroupRecord {
  readonly serialId: number;
  readonly groupId: number;
  readonly fragmentId: number;
}
