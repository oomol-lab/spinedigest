import { joinRelativePath } from "../../utils/relative-path.js";

import type { SentenceId } from "../types.js";
import type { Directory } from "../../runtime/platform/index.js";
import {
  createDirectoryFragmentAccess,
  DEFAULT_FRAGMENT_FILE_ACCESS,
  DEFAULT_FRAGMENT_WRITER,
} from "./file-access.js";
import { SerialFragments } from "./serial.js";
import type {
  FragmentFileAccess,
  FragmentWriter,
  ReadonlyFragments,
} from "./types.js";

export class Fragments implements ReadonlyFragments {
  readonly #documentPath: string;
  readonly #fileAccess: FragmentFileAccess;
  readonly #writer: FragmentWriter;

  public constructor(
    documentDirectory: Directory,
    writer?: FragmentWriter,
    fileAccess?: FragmentFileAccess,
  ) {
    this.#documentPath = "";
    const directoryAccess = createDirectoryFragmentAccess(documentDirectory);
    this.#fileAccess =
      fileAccess ?? directoryAccess?.fileAccess ?? DEFAULT_FRAGMENT_FILE_ACCESS;
    this.#writer = writer ?? directoryAccess?.writer ?? DEFAULT_FRAGMENT_WRITER;
  }

  public async ensureCreated(): Promise<void> {
    await this.#fileAccess.ensureDirectory(this.path);
  }

  public getSerial(serialId: number): SerialFragments {
    return new SerialFragments(
      this.#documentPath,
      serialId,
      "fragments",
      this.#writer,
      this.#fileAccess,
    );
  }

  public getSummarySerial(serialId: number): SerialFragments {
    return new SerialFragments(
      this.#documentPath,
      serialId,
      "summaries",
      this.#writer,
      this.#fileAccess,
    );
  }

  public async getSentence(sentenceId: SentenceId): Promise<string> {
    const [serialId, sentenceIndex] = sentenceId;
    const fragmentIds = await this.getSerial(serialId).listFragmentIds();
    let remainingSentenceIndex = sentenceIndex;

    for (const fragmentId of fragmentIds) {
      const fragment = await this.getSerial(serialId).getFragment(fragmentId);
      const sentence = fragment.sentences[remainingSentenceIndex];

      if (sentence !== undefined) {
        return sentence.text;
      }

      remainingSentenceIndex -= fragment.sentences.length;
    }

    throw new RangeError(`Sentence ${sentenceIndex} does not exist`);
  }

  public async getSummary(
    serialId: number,
    fragmentId: number,
  ): Promise<string> {
    return (await this.getSerial(serialId).getFragment(fragmentId)).summary;
  }

  public async getWordsCount(
    serialId: number,
    fragmentId: number,
  ): Promise<number> {
    const fragment = await this.getSerial(serialId).getFragment(fragmentId);

    return fragment.sentences.reduce(
      (total, sentence) => total + sentence.wordsCount,
      0,
    );
  }

  public get path(): string {
    return joinRelativePath(this.#documentPath, "fragments");
  }
}
