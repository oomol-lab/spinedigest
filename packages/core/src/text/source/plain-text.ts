import type { File } from "../../runtime/platform/index.js";

import { BOOK_META_VERSION, type BookMeta } from "./meta.js";
import type { SourceAdapter, SourceDocument } from "./adapter.js";
import type { SourceAsset, SourceSection, SourceTextStream } from "./types.js";

type PlainTextSourceFormat = "markdown" | "txt";
const ROOT_SECTION_ID = "root";

class PlainTextSection implements SourceSection {
  readonly #text: string;
  readonly #sectionId: string;

  public constructor(text: string, sectionId = ROOT_SECTION_ID) {
    this.#text = text;
    this.#sectionId = sectionId;
  }

  public get id(): string {
    return this.#sectionId;
  }
  public get hasContent(): boolean {
    return true;
  }
  public get title(): string | undefined {
    return undefined;
  }
  public get children(): readonly SourceSection[] {
    return [];
  }
  public open(): Promise<SourceTextStream> {
    return Promise.resolve(iterateTextLines(this.#text));
  }
}

class PlainTextDocument implements SourceDocument {
  readonly #section: PlainTextSection;
  readonly #file: File;
  readonly #sourceFormat: PlainTextSourceFormat;

  public constructor(
    file: File,
    sourceFormat: PlainTextSourceFormat,
    content: Uint8Array | string,
  ) {
    this.#file = file;
    this.#sourceFormat = sourceFormat;
    this.#section = new PlainTextSection(
      typeof content === "string" ? content : new TextDecoder().decode(content),
    );
  }

  public readMeta(): Promise<BookMeta> {
    return Promise.resolve({
      version: BOOK_META_VERSION,
      sourceFormat: this.#sourceFormat,
      title: getFileStem(this.#file.name),
      authors: [],
      language: null,
      identifier: null,
      publisher: null,
      publishedAt: null,
      description: null,
    });
  }
  public readCover(): Promise<SourceAsset | undefined> {
    return Promise.resolve(undefined);
  }
  public readSections(): Promise<readonly SourceSection[]> {
    return Promise.resolve([this.#section]);
  }
}

export class PlainTextSourceAdapter implements SourceAdapter {
  readonly #sourceFormat: PlainTextSourceFormat;

  public constructor(sourceFormat: PlainTextSourceFormat) {
    this.#sourceFormat = sourceFormat;
  }

  public get format(): PlainTextSourceFormat {
    return this.#sourceFormat;
  }

  public async openSession<T>(
    file: File,
    operation: (document: SourceDocument) => Promise<T>,
  ): Promise<T> {
    const content = await file.read({ encoding: "utf8" });
    return await operation(
      new PlainTextDocument(file, this.#sourceFormat, content),
    );
  }
}

export const TXT_SOURCE_ADAPTER = new PlainTextSourceAdapter("txt");
export const MARKDOWN_SOURCE_ADAPTER = new PlainTextSourceAdapter("markdown");

async function* iterateTextLines(text: string): AsyncIterable<string> {
  for (const line of text.match(/.*(?:\r?\n|$)/gu) ?? []) {
    if (line !== "") yield line;
  }
}

function getFileStem(name: string): string | null {
  const separator = name.lastIndexOf(".");
  const stem = (separator <= 0 ? name : name.slice(0, separator)).trim();
  return stem === "" ? null : stem;
}
