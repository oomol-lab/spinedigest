import type { CognitiveChunk } from "../chunk-batch/types.js";

export class WorkingMemory {
  readonly #capacity: number;
  readonly #currentFragmentChunks: CognitiveChunk[] = [];
  readonly #extraChunks: CognitiveChunk[] = [];
  #generation = 0;

  public constructor(capacity: number) {
    this.#capacity = capacity;
  }

  public get capacity(): number {
    return this.#capacity;
  }

  public get generation(): number {
    return this.#generation;
  }

  public addChunks(chunks: readonly CognitiveChunk[]): void {
    this.#currentFragmentChunks.push(...chunks);
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
}
