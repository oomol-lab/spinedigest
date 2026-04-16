import type {
  ChunkRecord,
  Document,
  FragmentGroupRecord,
  KnowledgeEdgeRecord,
} from "../document/index.js";
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
  readonly #document: Document;
  readonly #edgeKeys: string[] = [];
  readonly #edgesByKey = createEdgeRecord();
  readonly #groupWordsCount: number;
  readonly #serialId: number;

  public constructor(
    document: Document,
    serialId: number,
    groupWordsCount: number,
  ) {
    this.#document = document;
    this.#groupWordsCount = groupWordsCount;
    this.#serialId = serialId;
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
    const weightedChunks = chunks.map((chunk) => ({
      ...chunk,
      weight: chunkWeights[String(chunk.id)] ?? 0,
    }));
    const weightedEdges = edges.map((edge) => ({
      ...edge,
      weight: edgeWeights[getKnowledgeEdgeKey(edge.fromId, edge.toId)] ?? 0,
    }));
    const fragmentGroups = await groupFragments({
      chunks: weightedChunks,
      edges: weightedEdges,
      fragments: this.#document.getSerialFragments(this.#serialId),
      groupWordsCount: this.#groupWordsCount,
      serialId: this.#serialId,
    });
    const snakeTopology = buildSnakeTopology({
      chunks: weightedChunks,
      edges: weightedEdges,
      fragmentGroups,
      serialId: this.#serialId,
    });

    await this.#document.serials.ensure(this.#serialId);

    for (const chunk of weightedChunks) {
      await this.#document.chunks.save(chunk);
    }

    for (const edge of weightedEdges) {
      await this.#document.knowledgeEdges.save(edge);
    }

    await this.#document.fragmentGroups.saveMany(fragmentGroups);

    const snakeIds: number[] = [];

    for (const snake of snakeTopology.snakes) {
      snakeIds.push(
        await this.#document.snakes.create({
          firstLabel: snake.firstLabel,
          groupId: snake.groupId,
          lastLabel: snake.lastLabel,
          localSnakeId: snake.localSnakeId,
          serialId: this.#serialId,
          size: snake.size,
          weight: snake.weight,
          wordsCount: snake.wordsCount,
        }),
      );
    }

    for (const snakeChunk of snakeTopology.snakeChunks) {
      const snakeId = snakeIds[snakeChunk.snakeIndex];

      if (snakeId === undefined) {
        continue;
      }

      await this.#document.snakeChunks.save({
        chunkId: snakeChunk.chunkId,
        position: snakeChunk.position,
        snakeId,
      });
    }

    for (const snakeEdge of snakeTopology.snakeEdges) {
      const fromSnakeId = snakeIds[snakeEdge.fromSnakeIndex];
      const toSnakeId = snakeIds[snakeEdge.toSnakeIndex];

      if (fromSnakeId === undefined || toSnakeId === undefined) {
        continue;
      }

      await this.#document.snakeEdges.save({
        fromSnakeId,
        toSnakeId,
        weight: snakeEdge.weight,
      });
    }
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
      wordsCount: chunk.wordsCount,
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

interface SnakeDraft {
  readonly firstLabel: string;
  readonly groupId: number;
  readonly lastLabel: string;
  readonly localSnakeId: number;
  readonly size: number;
  readonly weight: number;
  readonly wordsCount: number;
}

interface SnakeChunkDraft {
  readonly chunkId: number;
  readonly position: number;
  readonly snakeIndex: number;
}

interface SnakeEdgeDraft {
  readonly fromSnakeIndex: number;
  readonly toSnakeIndex: number;
  readonly weight: number;
}

function buildSnakeTopology(input: {
  chunks: readonly ChunkRecord[];
  edges: readonly KnowledgeEdgeRecord[];
  fragmentGroups: readonly FragmentGroupRecord[];
  serialId: number;
}): {
  readonly snakeChunks: readonly SnakeChunkDraft[];
  readonly snakeEdges: readonly SnakeEdgeDraft[];
  readonly snakes: readonly SnakeDraft[];
} {
  const chunksById = createChunkRecord();
  const chunkIdsByGroupId = createNumberListRecord();
  const groupIdByFragmentId = createOptionalNumberRecord();
  const adjacentChunkIdsByChunkId = createNumberListRecord();

  for (const fragmentGroup of input.fragmentGroups) {
    if (fragmentGroup.serialId !== input.serialId) {
      continue;
    }

    groupIdByFragmentId[String(fragmentGroup.fragmentId)] = fragmentGroup.groupId;
  }

  for (const chunk of input.chunks) {
    const groupId = groupIdByFragmentId[String(chunk.sentenceId[1])];

    chunksById[String(chunk.id)] = chunk;
    if (groupId === undefined) {
      continue;
    }
    if (chunkIdsByGroupId[String(groupId)] === undefined) {
      chunkIdsByGroupId[String(groupId)] = [];
    }
    chunkIdsByGroupId[String(groupId)]?.push(chunk.id);
  }

  for (const edge of input.edges) {
    const fromChunk = chunksById[String(edge.fromId)];
    const toChunk = chunksById[String(edge.toId)];

    if (fromChunk === undefined || toChunk === undefined) {
      continue;
    }

    const fromGroupId = groupIdByFragmentId[String(fromChunk.sentenceId[1])];
    const toGroupId = groupIdByFragmentId[String(toChunk.sentenceId[1])];

    if (fromGroupId === undefined || toGroupId === undefined) {
      continue;
    }
    if (fromGroupId !== toGroupId) {
      continue;
    }

    attachChunkAdjacency(adjacentChunkIdsByChunkId, edge.fromId, edge.toId);
    attachChunkAdjacency(adjacentChunkIdsByChunkId, edge.toId, edge.fromId);
  }

  const snakes: SnakeDraft[] = [];
  const snakeChunks: SnakeChunkDraft[] = [];
  const snakeIndexByChunkId = createOptionalNumberRecord();

  for (const groupId of listSortedRecordNumbers(chunkIdsByGroupId)) {
    const groupChunkIds = (chunkIdsByGroupId[String(groupId)] ?? []).sort(
      compareChunkIdsBySentence,
    );
    const groupChunkIdRecord = createBooleanRecord();
    const visitedChunkIds = createBooleanRecord();

    for (const chunkId of groupChunkIds) {
      groupChunkIdRecord[String(chunkId)] = true;
    }

    const components: number[][] = [];

    for (const chunkId of groupChunkIds) {
      if (visitedChunkIds[String(chunkId)] === true) {
        continue;
      }

      const stack = [chunkId];
      const component: number[] = [];
      visitedChunkIds[String(chunkId)] = true;

      while (stack.length > 0) {
        const currentChunkId = stack.pop();

        if (currentChunkId === undefined) {
          continue;
        }

        component.push(currentChunkId);

        for (const nextChunkId of adjacentChunkIdsByChunkId[
          String(currentChunkId)
        ] ?? []) {
          if (groupChunkIdRecord[String(nextChunkId)] !== true) {
            continue;
          }
          if (visitedChunkIds[String(nextChunkId)] === true) {
            continue;
          }

          visitedChunkIds[String(nextChunkId)] = true;
          stack.push(nextChunkId);
        }
      }

      component.sort(compareChunkIdsBySentence);
      components.push(component);
    }

    components.sort((left, right) => {
      const leftFirstChunkId = left[0];
      const rightFirstChunkId = right[0];

      if (leftFirstChunkId === undefined || rightFirstChunkId === undefined) {
        return left.length - right.length;
      }

      return compareChunkIdsBySentence(leftFirstChunkId, rightFirstChunkId);
    });

    for (const [localSnakeId, component] of components.entries()) {
      const firstChunkId = component[0];
      const lastChunkId = component[component.length - 1];
      const firstChunk =
        firstChunkId === undefined ? undefined : chunksById[String(firstChunkId)];
      const lastChunk =
        lastChunkId === undefined ? undefined : chunksById[String(lastChunkId)];

      if (firstChunk === undefined || lastChunk === undefined) {
        continue;
      }

      const snakeIndex = snakes.length;

      snakes.push({
        firstLabel: firstChunk.label,
        groupId,
        lastLabel: lastChunk.label,
        localSnakeId,
        size: component.length,
        weight: component.reduce((sum, currentChunkId) => {
          return sum + (chunksById[String(currentChunkId)]?.weight ?? 0);
        }, 0),
        wordsCount: component.reduce((sum, currentChunkId) => {
          return sum + (chunksById[String(currentChunkId)]?.wordsCount ?? 0);
        }, 0),
      });

      for (const [position, currentChunkId] of component.entries()) {
        snakeIndexByChunkId[String(currentChunkId)] = snakeIndex;
        snakeChunks.push({
          chunkId: currentChunkId,
          position,
          snakeIndex,
        });
      }
    }
  }

  const snakeEdgeWeightByKey = createNumberRecord();

  for (const edge of input.edges) {
    const fromSnakeIndex = snakeIndexByChunkId[String(edge.fromId)];
    const toSnakeIndex = snakeIndexByChunkId[String(edge.toId)];

    if (
      fromSnakeIndex === undefined ||
      toSnakeIndex === undefined ||
      fromSnakeIndex === toSnakeIndex
    ) {
      continue;
    }

    const key = getKnowledgeEdgeKey(fromSnakeIndex, toSnakeIndex);

    snakeEdgeWeightByKey[key] =
      (snakeEdgeWeightByKey[key] ?? 0) + edge.weight;
  }

  return {
    snakeChunks,
    snakeEdges: Object.keys(snakeEdgeWeightByKey)
      .sort(compareEdgeKey)
      .map((edgeKey) => {
        const [fromSnakeIndexText = "", toSnakeIndexText = ""] = edgeKey.split(
          ":",
        );

        return {
          fromSnakeIndex: Number(fromSnakeIndexText),
          toSnakeIndex: Number(toSnakeIndexText),
          weight: snakeEdgeWeightByKey[edgeKey] ?? 0,
        };
      }),
    snakes,
  };

  function compareChunkIdsBySentence(leftId: number, rightId: number): number {
    const leftChunk = chunksById[String(leftId)];
    const rightChunk = chunksById[String(rightId)];

    if (leftChunk === undefined || rightChunk === undefined) {
      return leftId - rightId;
    }

    return compareChunkBySentence(leftChunk, rightChunk);
  }
}

function attachChunkAdjacency(
  adjacentChunkIdsByChunkId: Record<string, number[] | undefined>,
  fromId: number,
  toId: number,
): void {
  const existingAdjacentChunkIds = adjacentChunkIdsByChunkId[String(fromId)] ?? [];

  if (existingAdjacentChunkIds.includes(toId)) {
    return;
  }

  adjacentChunkIdsByChunkId[String(fromId)] = [
    ...existingAdjacentChunkIds,
    toId,
  ];
}

function compareChunkBySentence(left: ChunkRecord, right: ChunkRecord): number {
  const [leftSerialId, leftFragmentId, leftSentenceIndex] = left.sentenceId;
  const [rightSerialId, rightFragmentId, rightSentenceIndex] = right.sentenceId;

  if (leftSerialId !== rightSerialId) {
    return leftSerialId - rightSerialId;
  }

  if (leftFragmentId !== rightFragmentId) {
    return leftFragmentId - rightFragmentId;
  }

  if (leftSentenceIndex !== rightSentenceIndex) {
    return leftSentenceIndex - rightSentenceIndex;
  }

  return left.id - right.id;
}

function createBooleanRecord(): Record<string, boolean | undefined> {
  return Object.create(null) as Record<string, boolean | undefined>;
}

function createNumberListRecord(): Record<string, number[] | undefined> {
  return Object.create(null) as Record<string, number[] | undefined>;
}

function createNumberRecord(): Record<string, number> {
  return Object.create(null) as Record<string, number>;
}

function createOptionalNumberRecord(): Record<string, number | undefined> {
  return Object.create(null) as Record<string, number | undefined>;
}

function listSortedRecordNumbers(
  record: Readonly<Record<string, number[] | undefined>>,
): number[] {
  return Object.keys(record).map(Number).sort(compareNumber);
}
