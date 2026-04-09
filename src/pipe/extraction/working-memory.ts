import type { ChunkBatch, CognitiveChunk } from "./types.js";

type ChunkIdGenerator = () => Promise<number>;

export class WorkingMemory {
  readonly #capacity: number;
  readonly #currentFragmentChunks: CognitiveChunk[] = [];
  readonly #extraChunks: CognitiveChunk[] = [];
  readonly #idGenerator: ChunkIdGenerator;
  #generation = 0;

  public constructor(capacity: number, idGenerator: ChunkIdGenerator) {
    this.#capacity = capacity;
    this.#idGenerator = idGenerator;
  }

  public get capacity(): number {
    return this.#capacity;
  }

  public async addChunksWithLinks(
    chunkBatch: ChunkBatch,
  ): Promise<
    readonly [chunks: CognitiveChunk[], edges: Array<readonly [number, number]>]
  > {
    const tempIdMap = new Map<string, CognitiveChunk>();

    for (const [index, chunk] of chunkBatch.chunks.entries()) {
      chunk.id = await this.#idGenerator();
      chunk.generation = this.#generation;
      tempIdMap.set(chunkBatch.tempIds[index] ?? "", chunk);
    }

    this.#currentFragmentChunks.push(...chunkBatch.chunks);

    const edges: Array<readonly [number, number]> = [];

    for (const link of chunkBatch.links) {
      const fromChunk = this.#resolveChunkReference(link.from, tempIdMap);
      const toChunk = this.#resolveChunkReference(link.to, tempIdMap);

      if (fromChunk === undefined || toChunk === undefined) {
        continue;
      }

      const [edgeFromId, edgeToId] =
        fromChunk.id > toChunk.id
          ? ([fromChunk.id, toChunk.id] as const)
          : ([toChunk.id, fromChunk.id] as const);

      this.#attachLink(edgeToId, edgeFromId);
      edges.push([edgeFromId, edgeToId]);
    }

    return [chunkBatch.chunks, edges];
  }

  public setExtraChunks(extraChunks: readonly CognitiveChunk[]): void {
    this.#extraChunks.splice(0, this.#extraChunks.length, ...extraChunks);
  }

  public finalizeFragment(): CognitiveChunk[] {
    const finishedChunks = [...this.#currentFragmentChunks];

    this.#currentFragmentChunks.splice(0, this.#currentFragmentChunks.length);
    this.#generation += 1;

    return finishedChunks;
  }

  public getChunks(): CognitiveChunk[] {
    return [...this.#currentFragmentChunks, ...this.#extraChunks];
  }

  public getAllChunksForSaving(): CognitiveChunk[] {
    return [...this.#currentFragmentChunks];
  }

  public formatForPrompt(includeCurrentFragment = true): string {
    const chunks = includeCurrentFragment
      ? this.getChunks()
      : [...this.#extraChunks];

    if (chunks.length === 0) {
      return "(empty)";
    }

    const sortedChunks = [...chunks].sort((left, right) => {
      if (left.generation !== right.generation) {
        return left.generation - right.generation;
      }

      if (left.sentenceId[0] !== right.sentenceId[0]) {
        return left.sentenceId[0] - right.sentenceId[0];
      }

      if (left.sentenceId[1] !== right.sentenceId[1]) {
        return left.sentenceId[1] - right.sentenceId[1];
      }

      if (left.sentenceId[2] !== right.sentenceId[2]) {
        return left.sentenceId[2] - right.sentenceId[2];
      }

      return left.id - right.id;
    });

    return sortedChunks
      .map((chunk) => `${chunk.id}. [${chunk.label}] - ${chunk.content}`)
      .join("\n");
  }

  public clear(): void {
    this.#currentFragmentChunks.splice(0, this.#currentFragmentChunks.length);
    this.#extraChunks.splice(0, this.#extraChunks.length);
  }

  #resolveChunkReference(
    reference: number | string,
    tempIdMap: ReadonlyMap<string, CognitiveChunk>,
  ): CognitiveChunk | undefined {
    if (typeof reference === "string") {
      return tempIdMap.get(reference);
    }

    return this.getChunks().find((chunk) => chunk.id === reference);
  }

  #attachLink(targetChunkId: number, sourceChunkId: number): void {
    for (const chunk of this.getChunks()) {
      if (chunk.id !== targetChunkId) {
        continue;
      }

      if (!chunk.links.includes(sourceChunkId)) {
        chunk.links.push(sourceChunkId);
      }

      return;
    }
  }
}
