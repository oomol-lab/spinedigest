import type { ChunkRecord, KnowledgeEdgeRecord } from "../model/index.js";

const MIN_EDGE_WEIGHT = 0.1;

const IMPORTANCE_WEIGHTS: Readonly<Record<string, number>> = {
  critical: 9,
  helpful: 1,
  important: 3,
};

const LINK_STRENGTH_WEIGHTS: Readonly<Record<string, number>> = {
  critical: 9,
  helpful: 1,
  important: 3,
};

const RETENTION_WEIGHTS: Readonly<Record<string, number>> = {
  detailed: 9,
  focused: 3,
  relevant: 1,
  verbatim: 27,
};

export function computeChunkWeights(
  chunks: readonly ChunkRecord[],
): Readonly<Record<string, number>> {
  const weights = createNumberRecord();

  for (const chunk of chunks) {
    weights[String(chunk.id)] = computeChunkWeight(chunk);
  }

  return weights;
}

export function computeKnowledgeEdgeWeights(input: {
  chunkWeights: Readonly<Record<string, number>>;
  edges: readonly KnowledgeEdgeRecord[];
}): Readonly<Record<string, number>> {
  const strengthsByChunkId = createNumberRecord();

  for (const edge of input.edges) {
    const strengthWeight = getLinkStrengthWeight(edge.strength);

    strengthsByChunkId[String(edge.fromId)] =
      (strengthsByChunkId[String(edge.fromId)] ?? 0) + strengthWeight;
    strengthsByChunkId[String(edge.toId)] =
      (strengthsByChunkId[String(edge.toId)] ?? 0) + strengthWeight;
  }

  const edgeWeights = createNumberRecord();

  for (const edge of input.edges) {
    const strengthWeight = getLinkStrengthWeight(edge.strength);
    const fromChunkWeight = input.chunkWeights[String(edge.fromId)] ?? 0;
    const toChunkWeight = input.chunkWeights[String(edge.toId)] ?? 0;
    const fromTotalStrength = strengthsByChunkId[String(edge.fromId)] ?? 0;
    const toTotalStrength = strengthsByChunkId[String(edge.toId)] ?? 0;
    const fromHalfWeight =
      fromTotalStrength === 0
        ? 0
        : fromChunkWeight * (strengthWeight / fromTotalStrength);
    const toHalfWeight =
      toTotalStrength === 0
        ? 0
        : toChunkWeight * (strengthWeight / toTotalStrength);

    edgeWeights[getKnowledgeEdgeKey(edge.fromId, edge.toId)] = Math.max(
      fromHalfWeight + toHalfWeight,
      MIN_EDGE_WEIGHT,
    );
  }

  return edgeWeights;
}

export function getKnowledgeEdgeKey(fromId: number, toId: number): string {
  return `${fromId}:${toId}`;
}

function computeChunkWeight(chunk: ChunkRecord): number {
  return (
    getRetentionWeight(chunk.retention) + getImportanceWeight(chunk.importance)
  );
}

function getImportanceWeight(importance: string | undefined): number {
  if (importance === undefined) {
    return 0;
  }

  return IMPORTANCE_WEIGHTS[importance] ?? 0;
}

function getLinkStrengthWeight(strength: string | undefined): number {
  if (strength === undefined) {
    return 1;
  }

  return LINK_STRENGTH_WEIGHTS[strength] ?? 1;
}

function getRetentionWeight(retention: string | undefined): number {
  if (retention === undefined) {
    return 0;
  }

  return RETENTION_WEIGHTS[retention] ?? 0;
}

function createNumberRecord(): Record<string, number> {
  return Object.create(null) as Record<string, number>;
}
