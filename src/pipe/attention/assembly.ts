import type {
  ChunkBatch,
  ChunkImportanceAnnotation,
  CognitiveChunk,
} from "../chunk-batch/types.js";

export interface ChunkGraphEdge {
  readonly fromId: number;
  readonly strength?: string;
  readonly toId: number;
}

export interface ChunkGraphDelta {
  readonly chunks: CognitiveChunk[];
  readonly edges: readonly ChunkGraphEdge[];
  readonly importanceAnnotations?: readonly ChunkImportanceAnnotation[];
}

export async function assembleChunkBatch(input: {
  chunkBatch: ChunkBatch;
  generation: number;
  idGenerator: () => Promise<number>;
  visibleChunks: readonly CognitiveChunk[];
}): Promise<ChunkGraphDelta> {
  const tempIdRecord: Record<string, CognitiveChunk> = Object.create(
    null,
  ) as Record<string, CognitiveChunk>;

  for (const [index, chunk] of input.chunkBatch.chunks.entries()) {
    chunk.id = await input.idGenerator();
    chunk.generation = input.generation;

    const tempId = input.chunkBatch.tempIds[index];

    if (tempId === undefined || tempId === "") {
      continue;
    }

    tempIdRecord[tempId] = chunk;
  }

  const visibleChunks = [...input.visibleChunks, ...input.chunkBatch.chunks];
  const edges: ChunkGraphEdge[] = [];

  for (const link of input.chunkBatch.links) {
    const fromChunk = resolveChunkReference(
      link.from,
      tempIdRecord,
      visibleChunks,
    );
    const toChunk = resolveChunkReference(link.to, tempIdRecord, visibleChunks);

    if (fromChunk === undefined || toChunk === undefined) {
      continue;
    }

    const [edgeFromId, edgeToId] =
      fromChunk.id > toChunk.id
        ? ([fromChunk.id, toChunk.id] as const)
        : ([toChunk.id, fromChunk.id] as const);

    attachLink(visibleChunks, edgeToId, edgeFromId);
    if (link.strength === undefined) {
      edges.push({
        fromId: edgeFromId,
        toId: edgeToId,
      });
      continue;
    }

    edges.push({
      fromId: edgeFromId,
      strength: link.strength,
      toId: edgeToId,
    });
  }

  return {
    chunks: input.chunkBatch.chunks,
    edges,
    ...(input.chunkBatch.importanceAnnotations === undefined
      ? {}
      : {
          importanceAnnotations: input.chunkBatch.importanceAnnotations,
        }),
  };
}

function resolveChunkReference(
  reference: number | string,
  tempIdRecord: Readonly<Record<string, CognitiveChunk>>,
  visibleChunks: readonly CognitiveChunk[],
): CognitiveChunk | undefined {
  if (typeof reference === "string") {
    return tempIdRecord[reference];
  }

  return visibleChunks.find((chunk) => chunk.id === reference);
}

function attachLink(
  visibleChunks: readonly CognitiveChunk[],
  targetChunkId: number,
  sourceChunkId: number,
): void {
  for (const chunk of visibleChunks) {
    if (chunk.id !== targetChunkId) {
      continue;
    }

    if (!chunk.links.includes(sourceChunkId)) {
      chunk.links.push(sourceChunkId);
    }

    return;
  }
}
