export type SentenceId = readonly [
  chapterId: number,
  fragmentId: number,
  sentenceIndex: number,
];

export interface SentenceRecord {
  readonly text: string;
  readonly tokenCount: number;
}

export interface FragmentRecord {
  readonly chapterId: number;
  readonly fragmentId: number;
  readonly summary: string;
  readonly sentences: readonly SentenceRecord[];
}

export interface ChapterRecord {
  readonly id: number;
  readonly title: string;
}

export interface ChunkRecord {
  readonly id: number;
  readonly generation: number;
  readonly sentenceId: SentenceId;
  readonly label: string;
  readonly content: string;
  readonly sentenceIds: readonly SentenceId[];
  readonly retention?: string;
  readonly importance?: string;
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
  readonly chapterId: number;
  readonly groupId: number;
  readonly localSnakeId: number;
  readonly size: number;
  readonly firstLabel: string;
  readonly lastLabel: string;
  readonly tokens: number;
  readonly weight: number;
}

export interface CreateSnakeRecord {
  readonly chapterId: number;
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
  readonly chapterId: number;
  readonly groupId: number;
  readonly fragmentId: number;
}
