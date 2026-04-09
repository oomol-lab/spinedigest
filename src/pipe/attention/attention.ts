import { assembleChunkBatch, type ChunkGraphDelta } from "./assembly.js";
import { WaveReflection } from "./wave-reflection.js";
import { WorkingMemory } from "./working-memory.js";
import type { ChunkBatch, CognitiveChunk } from "../chunk-batch/types.js";

export interface ChunkBatchContext {
  readonly visibleChunkIds: readonly number[];
  readonly workingMemoryPrompt: string;
}

export class Attention {
  readonly #idGenerator: () => Promise<number>;
  readonly #waveReflection: WaveReflection;
  readonly #workingMemory: WorkingMemory;

  public constructor(input: {
    capacity: number;
    generationDecayFactor: number;
    idGenerator: () => Promise<number>;
  }) {
    this.#idGenerator = input.idGenerator;
    this.#waveReflection = new WaveReflection(input.generationDecayFactor);
    this.#workingMemory = new WorkingMemory(input.capacity);
  }

  public get capacity(): number {
    return this.#workingMemory.capacity;
  }

  public createChunkBatchContext(input?: {
    includeCurrentFragment?: boolean;
  }): ChunkBatchContext {
    return {
      visibleChunkIds: this.#workingMemory.getChunks().map((chunk) => chunk.id),
      workingMemoryPrompt: this.#workingMemory.formatForPrompt(
        input?.includeCurrentFragment ?? true,
      ),
    };
  }

  public async acceptChunkBatch(
    chunkBatch: ChunkBatch,
  ): Promise<ChunkGraphDelta> {
    const delta = await assembleChunkBatch({
      chunkBatch,
      generation: this.#workingMemory.generation,
      idGenerator: this.#idGenerator,
      visibleChunks: this.#workingMemory.getChunks(),
    });

    this.#workingMemory.addChunks(delta.chunks);

    return delta;
  }

  public completeFragment(input: {
    allChunks: readonly CognitiveChunk[];
    getSuccessorChunkIds: (chunkId: number) => readonly number[];
  }): void {
    const latestChunkIds = this.#workingMemory
      .getAllChunksForSaving()
      .map((chunk) => chunk.id);
    const extraChunks = this.#waveReflection.selectTopChunks({
      allChunks: input.allChunks,
      capacity: this.#workingMemory.capacity,
      getSuccessorChunkIds: input.getSuccessorChunkIds,
      latestChunkIds,
    });

    this.#workingMemory.setExtraChunks(extraChunks);
    this.#workingMemory.finalizeFragment();
  }

  public clear(): void {
    this.#workingMemory.clear();
  }
}
