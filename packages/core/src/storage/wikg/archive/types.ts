import type { File } from "../../../runtime/platform/index.js";

export type WikgArchiveOverlay =
  | {
      readonly entryPath: string;
      readonly kind: "deleted";
    }
  | {
      readonly entryPath: string;
      readonly kind: "file";
      readonly file: File;
    };
