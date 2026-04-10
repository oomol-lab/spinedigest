import type {
  ChunkRecord,
  KnowledgeEdgeRecord,
  Workspace,
} from "../model/index.js";
import type { ReaderChunk, ReaderGraphDelta } from "../reader/index.js";
import { groupFragments } from "./grouping.js";
import {
  computeChunkWeights,
  computeKnowledgeEdgeWeights,
  getKnowledgeEdgeKey,
} from "./weights.js";

export class Topology {
  readonly #chunkIds: number[] = [];
  readonly #chunksById = createChunkRecord();
  readonly #edgeKeys: string[] = [];
  readonly #edgesByKey = createEdgeRecord();
  readonly #groupTokensCount: number;
  readonly #serialId: number;
  readonly #workspace: Workspace;

  public constructor(
    workspace: Workspace,
    serialId: number,
    groupTokensCount: number,
  ) {
    this.#groupTokensCount = groupTokensCount;
    this.#serialId = serialId;
    this.#workspace = workspace;
  }

  public accept(delta: ReaderGraphDelta): void {
    for (const chunk of delta.chunks) {
      this.#saveChunk(chunk);
    }

    if (delta.importanceAnnotations !== undefined) {
      for (const annotation of delta.importanceAnnotations) {
        const chunk = this.#chunksById[String(annotation.chunkId)];

        if (chunk === undefined) {
          continue;
        }

        this.#chunksById[String(annotation.chunkId)] = {
          ...chunk,
          importance: annotation.importance,
        };
      }
    }

    for (const edge of delta.edges) {
      this.#saveEdge(edge);
    }
  }

  public async finalize(): Promise<void> {
    const chunks = this.#listChunks();
    const edges = this.#listEdges();
    const chunkWeights = computeChunkWeights(chunks);
    const edgeWeights = computeKnowledgeEdgeWeights({
      chunkWeights,
      edges,
    });

    await this.#workspace.serials.ensure(this.#serialId);

    for (const chunk of chunks) {
      await this.#workspace.chunks.save({
        ...chunk,
        weight: chunkWeights[String(chunk.id)] ?? 0,
      });
    }

    for (const edge of edges) {
      await this.#workspace.knowledgeEdges.save({
        ...edge,
        weight: edgeWeights[getKnowledgeEdgeKey(edge.fromId, edge.toId)] ?? 0,
      });
    }

    await this.#workspace.fragmentGroups.saveMany(
      await groupFragments({
        chunks: chunks.map((chunk) => ({
          ...chunk,
          weight: chunkWeights[String(chunk.id)] ?? 0,
        })),
        edges: edges.map((edge) => ({
          ...edge,
          weight: edgeWeights[getKnowledgeEdgeKey(edge.fromId, edge.toId)] ?? 0,
        })),
        fragments: this.#workspace.getSerialFragments(this.#serialId),
        groupTokensCount: this.#groupTokensCount,
        serialId: this.#serialId,
      }),
    );
  }

  #listChunks(): ChunkRecord[] {
    return [...this.#chunkIds]
      .sort(compareNumber)
      .map((chunkId) => this.#chunksById[String(chunkId)])
      .filter((chunk): chunk is ChunkRecord => chunk !== undefined);
  }

  #listEdges(): KnowledgeEdgeRecord[] {
    return [...this.#edgeKeys]
      .sort(compareEdgeKey)
      .map((edgeKey) => this.#edgesByKey[edgeKey])
      .filter((edge): edge is KnowledgeEdgeRecord => edge !== undefined);
  }

  #saveChunk(chunk: ReaderChunk): void {
    const chunkId = String(chunk.id);

    if (this.#chunksById[chunkId] === undefined) {
      this.#chunkIds.push(chunk.id);
    }

    const importance = chunk.importance;
    const retention = chunk.retention;

    this.#chunksById[chunkId] = {
      content: chunk.content,
      generation: chunk.generation,
      id: chunk.id,
      label: chunk.label,
      sentenceId: chunk.sentenceId,
      sentenceIds: [...chunk.sentenceIds],
      tokens: chunk.tokens,
      weight: 0,
      ...(importance === undefined ? {} : { importance }),
      ...(retention === undefined ? {} : { retention }),
    };
  }

  #saveEdge(edge: ReaderGraphDelta["edges"][number]): void {
    const edgeKey = getKnowledgeEdgeKey(edge.fromId, edge.toId);

    if (this.#edgesByKey[edgeKey] === undefined) {
      this.#edgeKeys.push(edgeKey);
    }

    const strength = edge.strength;

    this.#edgesByKey[edgeKey] = {
      fromId: edge.fromId,
      toId: edge.toId,
      weight: 0,
      ...(strength === undefined ? {} : { strength }),
    };
  }
}

function compareEdgeKey(left: string, right: string): number {
  const [leftFromIdText = "", leftToIdText = ""] = left.split(":");
  const [rightFromIdText = "", rightToIdText = ""] = right.split(":");
  const leftFromId = Number(leftFromIdText);
  const rightFromId = Number(rightFromIdText);

  if (leftFromId !== rightFromId) {
    return leftFromId - rightFromId;
  }

  return Number(leftToIdText) - Number(rightToIdText);
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function createChunkRecord(): Record<string, ChunkRecord | undefined> {
  return Object.create(null) as Record<string, ChunkRecord | undefined>;
}

function createEdgeRecord(): Record<string, KnowledgeEdgeRecord | undefined> {
  return Object.create(null) as Record<string, KnowledgeEdgeRecord | undefined>;
}
