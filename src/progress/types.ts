export type SpineDigestOperation =
  | "digest-epub"
  | "digest-markdown"
  | "digest-text-stream"
  | "digest-txt";

export interface SerialDiscoveredEvent {
  readonly type: "serial-discovered";
  readonly id: number;
  readonly fragments: number;
  readonly words: number;
}

export interface SerialProgressEvent {
  readonly type: "serial-progress";
  readonly id: number;
  readonly completedWords: number;
  readonly completedFragments: number;
}

export interface DigestProgressEvent {
  readonly type: "digest-progress";
  readonly completedWords: number;
  readonly totalWords: number;
}

export type SpineDigestProgressEventType = SpineDigestProgressEvent["type"];

export type SpineDigestProgressEvent =
  | SerialDiscoveredEvent
  | SerialProgressEvent
  | DigestProgressEvent;

export type SpineDigestProgressCallback = (
  event: SpineDigestProgressEvent,
) => void | Promise<void>;
