import type { SourceFormat } from "../source/index.js";

export type SpineDigestOperation =
  | "digest-epub"
  | "digest-markdown"
  | "digest-text"
  | "digest-txt"
  | "open-sdpub";

export type SpineDigestProgressEventType =
  | "session-started"
  | "serial-progress"
  | "digest-progress"
  | "archive-opened"
  | "export-started"
  | "export-completed";

export type SpineDigestOutputKind = "epub" | "sdpub" | "text";

export interface SpineDigestProgressEvent {
  readonly type: SpineDigestProgressEventType;
  readonly message: string;
  readonly operation: SpineDigestOperation;
  readonly timestamp: string;
  readonly completedFragments?: number;
  readonly completedSerials?: number;
  readonly completedWords?: number;
  readonly inputFormat?: SourceFormat | "sdpub";
  readonly isComplete?: boolean;
  readonly outputKind?: SpineDigestOutputKind;
  readonly path?: string;
  readonly sectionTitle?: string;
  readonly serialId?: number;
  readonly serialIndex?: number;
  readonly totalFragments?: number;
  readonly totalSerials?: number;
  readonly totalWords?: number;
}

export type SpineDigestProgressCallback = (
  event: SpineDigestProgressEvent,
) => void | Promise<void>;
