import { createProgressReporter, type ProgressReporter } from "./reporter.js";
import type { SourceFormat } from "../source/index.js";
import type {
  SpineDigestOperation,
  SpineDigestOutputKind,
  SpineDigestProgressCallback,
} from "./types.js";

export interface CreateDigestProgressTrackerOptions {
  readonly onProgress?: SpineDigestProgressCallback;
  readonly operation: SpineDigestOperation;
}

export class DigestProgressTracker {
  readonly #reporter: ProgressReporter;
  #completedSerials = 0;
  #completedWords = 0;
  #totalSerials: number | undefined;

  public constructor(options: CreateDigestProgressTrackerOptions) {
    this.#reporter = createProgressReporter(
      options.operation,
      options.onProgress,
    );
  }

  public async emitSessionStarted(input: {
    readonly inputFormat?: SourceFormat | "sdpub";
    readonly path?: string;
  }): Promise<void> {
    await this.#reporter.emit({
      ...(input.inputFormat === undefined
        ? {}
        : { inputFormat: input.inputFormat }),
      message: "Digest session started",
      ...(input.path === undefined ? {} : { path: input.path }),
      type: "session-started",
    });
  }

  public async initializeDigest(input: {
    readonly totalSerials: number;
  }): Promise<void> {
    this.#totalSerials = input.totalSerials;
    await this.emitDigestProgress();
  }

  public createSerialTracker(input: {
    readonly sectionTitle: string;
    readonly serialId: number;
    readonly serialIndex: number;
  }): SerialProgressTracker {
    return new SerialProgressTracker(this, input);
  }

  public async emitArchiveOpened(path: string): Promise<void> {
    await this.#reporter.emit({
      inputFormat: "sdpub",
      message: "Archive extracted and ready",
      path,
      type: "archive-opened",
    });
  }

  public async emitExportStarted(
    outputKind: SpineDigestOutputKind,
    path: string,
  ): Promise<void> {
    await this.#reporter.emit({
      message: `${formatOutputKind(outputKind)} export started`,
      outputKind,
      path,
      type: "export-started",
    });
  }

  public async emitExportCompleted(
    outputKind: SpineDigestOutputKind,
    path: string,
  ): Promise<void> {
    await this.#reporter.emit({
      message: `${formatOutputKind(outputKind)} export completed`,
      outputKind,
      path,
      type: "export-completed",
    });
  }

  public async completeSerial(input: {
    readonly serialId: number;
    readonly totalWords: number;
  }): Promise<void> {
    this.#completedSerials += 1;
    this.#completedWords += input.totalWords;
    await this.emitDigestProgress({
      currentSerialId: input.serialId,
    });
  }

  public async emitSerialProgress(input: {
    readonly completedFragments: number;
    readonly completedWords: number;
    readonly isComplete: boolean;
    readonly sectionTitle: string;
    readonly serialId: number;
    readonly serialIndex: number;
    readonly totalFragments: number;
    readonly totalWords: number;
  }): Promise<void> {
    await this.#reporter.emit({
      completedFragments: input.completedFragments,
      completedWords: input.completedWords,
      isComplete: input.isComplete,
      message: input.isComplete
        ? `Completed section ${input.serialIndex}`
        : `Processing section ${input.serialIndex}`,
      sectionTitle: input.sectionTitle,
      serialId: input.serialId,
      serialIndex: input.serialIndex,
      totalFragments: input.totalFragments,
      ...(this.#totalSerials === undefined
        ? {}
        : { totalSerials: this.#totalSerials }),
      totalWords: input.totalWords,
      type: "serial-progress",
    });
  }

  public async emitDigestProgress(input?: {
    readonly currentSerialId?: number;
  }): Promise<void> {
    if (this.#totalSerials === undefined) {
      return;
    }

    await this.#reporter.emit({
      completedSerials: this.#completedSerials,
      completedWords: this.#completedWords,
      isComplete: this.#completedSerials >= this.#totalSerials,
      message:
        this.#completedSerials >= this.#totalSerials
          ? "All sections completed"
          : "Digest is in progress",
      ...(input?.currentSerialId === undefined
        ? {}
        : { serialId: input.currentSerialId }),
      totalSerials: this.#totalSerials,
      type: "digest-progress",
    });
  }
}

export class SerialProgressTracker {
  readonly #digestTracker: DigestProgressTracker;
  #completedFragments = 0;
  #completedWords = 0;
  #started = false;
  readonly #sectionTitle: string;
  readonly #serialId: number;
  readonly #serialIndex: number;
  #totalFragments = 0;
  #totalWords = 0;

  public constructor(
    digestTracker: DigestProgressTracker,
    input: {
      readonly sectionTitle: string;
      readonly serialId: number;
      readonly serialIndex: number;
    },
  ) {
    this.#digestTracker = digestTracker;
    this.#sectionTitle = input.sectionTitle;
    this.#serialId = input.serialId;
    this.#serialIndex = input.serialIndex;
  }

  public async begin(input: {
    readonly totalFragments: number;
    readonly totalWords: number;
  }): Promise<void> {
    this.#started = true;
    this.#totalFragments = input.totalFragments;
    this.#totalWords = input.totalWords;
    await this.#digestTracker.emitSerialProgress({
      completedFragments: this.#completedFragments,
      completedWords: this.#completedWords,
      isComplete: false,
      sectionTitle: this.#sectionTitle,
      serialId: this.#serialId,
      serialIndex: this.#serialIndex,
      totalFragments: this.#totalFragments,
      totalWords: this.#totalWords,
    });
  }

  public async completeFragment(wordsCount: number): Promise<void> {
    if (!this.#started) {
      throw new Error("Serial progress has not started");
    }

    this.#completedFragments += 1;
    this.#completedWords += wordsCount;
    await this.#digestTracker.emitSerialProgress({
      completedFragments: this.#completedFragments,
      completedWords: this.#completedWords,
      isComplete: false,
      sectionTitle: this.#sectionTitle,
      serialId: this.#serialId,
      serialIndex: this.#serialIndex,
      totalFragments: this.#totalFragments,
      totalWords: this.#totalWords,
    });
  }

  public async complete(): Promise<void> {
    if (!this.#started) {
      throw new Error("Serial progress has not started");
    }

    this.#completedFragments = this.#totalFragments;
    this.#completedWords = this.#totalWords;
    await this.#digestTracker.emitSerialProgress({
      completedFragments: this.#completedFragments,
      completedWords: this.#completedWords,
      isComplete: true,
      sectionTitle: this.#sectionTitle,
      serialId: this.#serialId,
      serialIndex: this.#serialIndex,
      totalFragments: this.#totalFragments,
      totalWords: this.#totalWords,
    });
    await this.#digestTracker.completeSerial({
      serialId: this.#serialId,
      totalWords: this.#totalWords,
    });
  }
}

export function createDigestProgressTracker(
  options: CreateDigestProgressTrackerOptions,
): DigestProgressTracker {
  return new DigestProgressTracker(options);
}

function formatOutputKind(outputKind: SpineDigestOutputKind): string {
  switch (outputKind) {
    case "epub":
      return "EPUB";
    case "sdpub":
      return "Archive";
    case "text":
      return "Text";
  }
}
