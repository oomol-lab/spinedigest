import type { BookMeta, SourceFormat } from "./meta.js";
import type { TocFile } from "./toc.js";

export type SourceTextStream = AsyncIterable<string> | Iterable<string>;

export interface SourceAsset {
  readonly path: string;
  readonly mediaType: string;
  readonly data: Uint8Array;
}

export interface SourceSection {
  readonly id: string;
  readonly title: string;
  createTextStream(): SourceTextStream;
}

export interface SourceBook {
  readonly assets: readonly SourceAsset[];
  readonly meta: BookMeta;
  readonly toc: TocFile;
  readonly sections: readonly SourceSection[];
}

export interface ReadSourceOptions {
  readonly path: string;
}

export interface SourceReader {
  readonly format: SourceFormat;
  read(options: ReadSourceOptions): Promise<SourceBook>;
}
