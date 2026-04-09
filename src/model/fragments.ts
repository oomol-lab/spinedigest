import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import { join, resolve } from "path";

import type { FragmentRecord, SentenceId, SentenceRecord } from "./types.js";

const CHAPTER_DIRECTORY_PREFIX = "chapter-";
const FRAGMENT_FILE_PATTERN = /^fragment_(\d+)\.json$/;

interface FragmentFileContent {
  readonly summary: string;
  readonly sentences: readonly SentenceRecord[];
}

export class WorkspaceFragments {
  readonly #workspacePath: string;

  public constructor(workspacePath: string) {
    this.#workspacePath = resolve(workspacePath);
  }

  public async ensureCreated(): Promise<void> {
    await mkdir(this.path, { recursive: true });
  }

  public getChapter(chapterId: number): ChapterFragments {
    return new ChapterFragments(this.#workspacePath, chapterId);
  }

  public async getSentence(sentenceId: SentenceId): Promise<string> {
    const [chapterId, fragmentId, sentenceIndex] = sentenceId;
    const fragment = await this.getChapter(chapterId).getFragment(fragmentId);
    const sentence = fragment.sentences[sentenceIndex];

    if (sentence === undefined) {
      throw new RangeError(`Sentence ${sentenceIndex} does not exist`);
    }

    return sentence.text;
  }

  public async getSummary(
    chapterId: number,
    fragmentId: number,
  ): Promise<string> {
    return (await this.getChapter(chapterId).getFragment(fragmentId)).summary;
  }

  public async getTokenCount(
    chapterId: number,
    fragmentId: number,
  ): Promise<number> {
    const fragment = await this.getChapter(chapterId).getFragment(fragmentId);

    return fragment.sentences.reduce(
      (total, sentence) => total + sentence.tokenCount,
      0,
    );
  }

  public get path(): string {
    return join(this.#workspacePath, "fragments");
  }
}

export class ChapterFragments {
  readonly #chapterId: number;
  #draftOpen = false;
  #nextFragmentId: number | undefined;
  readonly #workspacePath: string;

  public constructor(workspacePath: string, chapterId: number) {
    this.#workspacePath = resolve(workspacePath);
    this.#chapterId = chapterId;
  }

  public async createDraft(): Promise<FragmentDraft> {
    if (this.#draftOpen) {
      throw new Error("Only one fragment draft can be open at a time");
    }

    await mkdir(this.path, { recursive: true });
    this.#draftOpen = true;

    return new FragmentDraft({
      chapterId: this.#chapterId,
      discard: () => {
        this.#discardDraft();
      },
      finalize: async (fragmentId, summary, sentences) =>
        await this.#commitDraft(fragmentId, summary, sentences),
      fragmentId: await this.#peekNextFragmentId(),
    });
  }

  public async getFragment(fragmentId: number): Promise<FragmentRecord> {
    const fileContent = await readFragmentFile(
      this.#getFragmentPath(fragmentId),
    );

    return {
      chapterId: this.#chapterId,
      fragmentId,
      summary: fileContent.summary,
      sentences: fileContent.sentences,
    };
  }

  public async listFragmentIds(): Promise<number[]> {
    try {
      const entries = await readdir(this.path, { withFileTypes: true });

      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => FRAGMENT_FILE_PATTERN.exec(entry.name))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => Number(match[1]))
        .sort((left, right) => left - right);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  public get chapterId(): number {
    return this.#chapterId;
  }

  public get path(): string {
    return join(
      this.#workspacePath,
      "fragments",
      `${CHAPTER_DIRECTORY_PREFIX}${this.#chapterId}`,
    );
  }

  async #commitDraft(
    fragmentId: number,
    summary: string,
    sentences: readonly SentenceRecord[],
  ): Promise<FragmentRecord | undefined> {
    this.#draftOpen = false;

    if (sentences.length === 0) {
      return undefined;
    }

    await mkdir(this.path, { recursive: true });
    await writeFile(
      this.#getFragmentPath(fragmentId),
      JSON.stringify(
        {
          sentences,
          summary,
        },
        undefined,
        2,
      ),
      "utf8",
    );

    this.#nextFragmentId = fragmentId + 1;

    return {
      chapterId: this.#chapterId,
      fragmentId,
      summary,
      sentences,
    };
  }

  #discardDraft(): void {
    this.#draftOpen = false;
  }

  async #peekNextFragmentId(): Promise<number> {
    if (this.#nextFragmentId !== undefined) {
      return this.#nextFragmentId;
    }

    const fragmentIds = await this.listFragmentIds();
    const lastFragmentId = fragmentIds[fragmentIds.length - 1];

    this.#nextFragmentId =
      lastFragmentId === undefined ? 0 : lastFragmentId + 1;

    return this.#nextFragmentId;
  }

  #getFragmentPath(fragmentId: number): string {
    return join(this.path, `fragment_${fragmentId}.json`);
  }
}

export class FragmentDraft {
  #committed = false;
  readonly #chapterId: number;
  readonly #discard: () => void;
  readonly #finalize: (
    fragmentId: number,
    summary: string,
    sentences: readonly SentenceRecord[],
  ) => Promise<FragmentRecord | undefined>;
  readonly #fragmentId: number;
  readonly #sentences: SentenceRecord[] = [];
  #summary = "";

  public constructor(input: {
    chapterId: number;
    discard: () => void;
    finalize: (
      fragmentId: number,
      summary: string,
      sentences: readonly SentenceRecord[],
    ) => Promise<FragmentRecord | undefined>;
    fragmentId: number;
  }) {
    this.#chapterId = input.chapterId;
    this.#discard = input.discard;
    this.#finalize = input.finalize;
    this.#fragmentId = input.fragmentId;
  }

  public addSentence(text: string, tokenCount: number): SentenceId {
    this.#assertActive();
    const sentenceIndex = this.#sentences.length;

    this.#sentences.push({
      text,
      tokenCount,
    });

    return [this.#chapterId, this.#fragmentId, sentenceIndex];
  }

  public async commit(): Promise<FragmentRecord | undefined> {
    this.#assertActive();
    this.#committed = true;

    return await this.#finalize(
      this.#fragmentId,
      this.#summary,
      this.#sentences,
    );
  }

  public discard(): void {
    this.#assertActive();
    this.#committed = true;
    this.#discard();
  }

  public setSummary(summary: string): void {
    this.#assertActive();
    this.#summary = summary;
  }

  public get fragmentId(): number {
    return this.#fragmentId;
  }

  #assertActive(): void {
    if (this.#committed) {
      throw new Error("Fragment draft is already finalized");
    }
  }
}

async function readFragmentFile(
  fragmentPath: string,
): Promise<FragmentFileContent> {
  const rawContent = JSON.parse(
    await readFile(fragmentPath, "utf8"),
  ) as unknown;

  if (Array.isArray(rawContent)) {
    return {
      sentences: rawContent.map(parseSentenceRecord),
      summary: "",
    };
  }

  if (typeof rawContent !== "object" || rawContent === null) {
    throw new TypeError("Fragment file must be an object or an array");
  }

  const summary =
    "summary" in rawContent && typeof rawContent.summary === "string"
      ? rawContent.summary
      : "";
  const sentences =
    "sentences" in rawContent && Array.isArray(rawContent.sentences)
      ? rawContent.sentences.map(parseSentenceRecord)
      : [];

  return {
    sentences,
    summary,
  };
}

function parseSentenceRecord(value: unknown): SentenceRecord {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Sentence entry must be an object");
  }

  const {
    text,
    token_count: tokenCount,
    tokenCount: camelTokenCount,
  } = value as {
    readonly text?: unknown;
    readonly token_count?: unknown;
    readonly tokenCount?: unknown;
  };
  const resolvedTokenCount =
    typeof camelTokenCount === "number" ? camelTokenCount : tokenCount;

  if (typeof text !== "string" || typeof resolvedTokenCount !== "number") {
    throw new TypeError("Sentence entry is invalid");
  }

  return {
    text,
    tokenCount: resolvedTokenCount,
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
