import { createProgressReporter, type ProgressReporter } from "./reporter.js";
import type {
  SpineDigestOperation,
  SpineDigestProgressCallback,
} from "./types.js";

export interface CreateDigestProgressTrackerOptions {
  readonly onProgress?: SpineDigestProgressCallback;
  readonly operation: SpineDigestOperation;
}

export class DigestProgressTracker {
  readonly #reporter: ProgressReporter;
  #completedWords = 0;
  #totalWords = 0;

  public constructor(options: CreateDigestProgressTrackerOptions) {
    this.#reporter = createProgressReporter(
      options.operation,
      options.onProgress,
    );
  }

  public createSerialTracker(input: {
    readonly id: number;
  }): SerialProgressTracker {
    return new SerialProgressTracker(this, input.id);
  }

  public async discoverSerial(input: {
    readonly fragments: number;
    readonly id: number;
    readonly words: number;
  }): Promise<void> {
    this.#totalWords += input.words;
    await this.#reporter.emit({
      fragments: input.fragments,
      id: input.id,
      type: "serial-discovered",
      words: input.words,
    });
    await this.#reporter.emit({
      completedWords: this.#completedWords,
      totalWords: this.#totalWords,
      type: "digest-progress",
    });
  }

  public async completeSerial(words: number): Promise<void> {
    this.#completedWords += words;
    await this.#reporter.emit({
      completedWords: this.#completedWords,
      totalWords: this.#totalWords,
      type: "digest-progress",
    });
  }

  public async emitSerialProgress(input: {
    readonly completedWords: number;
    readonly id: number;
  }): Promise<void> {
    await this.#reporter.emit({
      completedWords: input.completedWords,
      id: input.id,
      type: "serial-progress",
    });
  }
}

export class SerialProgressTracker {
  readonly #digestTracker: DigestProgressTracker;
  #completedWords = 0;
  readonly #id: number;
  #started = false;
  #totalWords = 0;

  public constructor(digestTracker: DigestProgressTracker, id: number) {
    this.#digestTracker = digestTracker;
    this.#id = id;
  }

  public async begin(input: {
    readonly fragments: number;
    readonly words: number;
  }): Promise<void> {
    this.#started = true;
    this.#totalWords = input.words;
    await this.#digestTracker.discoverSerial({
      fragments: input.fragments,
      id: this.#id,
      words: this.#totalWords,
    });
  }

  public async advance(wordsCount: number): Promise<void> {
    if (!this.#started) {
      throw new Error("Serial progress has not started");
    }

    this.#completedWords += wordsCount;
    await this.#digestTracker.emitSerialProgress({
      completedWords: this.#completedWords,
      id: this.#id,
    });
  }

  public async complete(finalWordsCount = 0): Promise<void> {
    if (!this.#started) {
      throw new Error("Serial progress has not started");
    }

    this.#completedWords += finalWordsCount;

    if (this.#completedWords > this.#totalWords) {
      throw new Error(`Serial ${this.#id} completed beyond its total words`);
    }

    await this.#digestTracker.emitSerialProgress({
      completedWords: this.#completedWords,
      id: this.#id,
    });
    await this.#digestTracker.completeSerial(this.#totalWords);
  }
}

export function createDigestProgressTracker(
  options: CreateDigestProgressTrackerOptions,
): DigestProgressTracker {
  return new DigestProgressTracker(options);
}
