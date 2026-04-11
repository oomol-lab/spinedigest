import { getLogger } from "../common/logging.js";

import type {
  DigestProgressEvent,
  SerialDiscoveredEvent,
  SerialProgressEvent,
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

  public async emit(event: SpineDigestProgressEvent): Promise<void> {
    getLogger({
      component: "progress",
      eventType: event.type,
      operation: this.#operation,
      ...buildLogBindings(event),
    }).info(buildLogMessage(event));

    if (this.#callback === undefined) {
      return;
    }

    try {
      await this.#callback(event);
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

function buildLogBindings(
  event: SpineDigestProgressEvent,
): Record<string, number> {
  switch (event.type) {
    case "serial-discovered":
      return {
        fragments: event.fragments,
        id: event.id,
        words: event.words,
      } satisfies Record<keyof Omit<SerialDiscoveredEvent, "type">, number>;
    case "serial-progress":
      return {
        completedWords: event.completedWords,
        id: event.id,
      } satisfies Record<keyof Omit<SerialProgressEvent, "type">, number>;
    case "digest-progress":
      return {
        completedWords: event.completedWords,
        totalWords: event.totalWords,
      } satisfies Record<keyof Omit<DigestProgressEvent, "type">, number>;
  }
}

function buildLogMessage(event: SpineDigestProgressEvent): string {
  switch (event.type) {
    case "serial-discovered":
      return `Discovered serial ${event.id}`;
    case "serial-progress":
      return `Serial ${event.id} progressed`;
    case "digest-progress":
      return "Digest progressed";
  }
}
