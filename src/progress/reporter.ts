import { getLogger } from "../common/logging.js";

import type {
  SpineDigestOperation,
  SpineDigestProgressCallback,
  SpineDigestProgressEvent,
} from "./types.js";

export class ProgressReporter {
  readonly #callback: SpineDigestProgressCallback | undefined;
  readonly #operation: SpineDigestOperation;

  public constructor(
    operation: SpineDigestOperation,
    callback?: SpineDigestProgressCallback,
  ) {
    this.#callback = callback;
    this.#operation = operation;
  }

  public async emit(
    event: Omit<SpineDigestProgressEvent, "operation" | "timestamp">,
  ): Promise<void> {
    const resolvedEvent = {
      ...event,
      operation: this.#operation,
      timestamp: new Date().toISOString(),
    } satisfies SpineDigestProgressEvent;

    getLogger({
      component: "progress",
      eventType: resolvedEvent.type,
      operation: resolvedEvent.operation,
      ...(resolvedEvent.completedFragments === undefined
        ? {}
        : { completedFragments: resolvedEvent.completedFragments }),
      ...(resolvedEvent.completedSerials === undefined
        ? {}
        : { completedSerials: resolvedEvent.completedSerials }),
      ...(resolvedEvent.completedWords === undefined
        ? {}
        : { completedWords: resolvedEvent.completedWords }),
      ...(resolvedEvent.inputFormat === undefined
        ? {}
        : { inputFormat: resolvedEvent.inputFormat }),
      ...(resolvedEvent.isComplete === undefined
        ? {}
        : { isComplete: resolvedEvent.isComplete }),
      ...(resolvedEvent.outputKind === undefined
        ? {}
        : { outputKind: resolvedEvent.outputKind }),
      ...(resolvedEvent.path === undefined ? {} : { path: resolvedEvent.path }),
      ...(resolvedEvent.sectionTitle === undefined
        ? {}
        : { sectionTitle: resolvedEvent.sectionTitle }),
      ...(resolvedEvent.serialId === undefined
        ? {}
        : { serialId: resolvedEvent.serialId }),
      ...(resolvedEvent.serialIndex === undefined
        ? {}
        : { serialIndex: resolvedEvent.serialIndex }),
      ...(resolvedEvent.totalFragments === undefined
        ? {}
        : { totalFragments: resolvedEvent.totalFragments }),
      ...(resolvedEvent.totalSerials === undefined
        ? {}
        : { totalSerials: resolvedEvent.totalSerials }),
      ...(resolvedEvent.totalWords === undefined
        ? {}
        : { totalWords: resolvedEvent.totalWords }),
    }).info(resolvedEvent.message);

    if (this.#callback === undefined) {
      return;
    }

    try {
      await this.#callback(resolvedEvent);
    } catch (error) {
      getLogger({
        component: "progress",
        operation: this.#operation,
      }).warn(
        {
          error:
            error instanceof Error
              ? { message: error.message, name: error.name }
              : String(error),
        },
        "Progress callback failed",
      );
    }
  }
}

export function createProgressReporter(
  operation: SpineDigestOperation,
  callback?: SpineDigestProgressCallback,
): ProgressReporter {
  return new ProgressReporter(operation, callback);
}
