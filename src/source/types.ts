export type SourceTextStream = AsyncIterable<string> | Iterable<string>;

export interface SourceAsset {
  readonly path: string;
  readonly mediaType: string;
  readonly data: Uint8Array;
}

export interface SourceSection {
  readonly id: string;
  readonly title?: string | undefined;
  readonly children: readonly SourceSection[];
  open(): Promise<SourceTextStream>;
}
