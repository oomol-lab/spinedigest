import type { BookMeta, SourceFormat } from "./meta.js";
import type { SourceAsset, SourceSection } from "./types.js";
import type { File } from "../../runtime/platform/index.js";

export interface SourceDocument {
  readMeta(): Promise<BookMeta>;
  readCover(): Promise<SourceAsset | undefined>;
  readSections(): Promise<readonly SourceSection[]>;
}

export interface SourceAdapter {
  readonly format: SourceFormat;
  openSession<T>(
    file: File,
    operation: (document: SourceDocument) => Promise<T>,
  ): Promise<T>;
}
