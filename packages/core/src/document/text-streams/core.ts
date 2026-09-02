import type { Database } from "../database.js";
import { joinDocumentPath, resolveDocumentPath } from "../directory/path.js";
import type { SentenceId } from "../types.js";
import { DEFAULT_FILE_ACCESS } from "./file-access.js";
import { SerialTextStream } from "./serial.js";
import type {
  ReadonlyTextStreams,
  TextStreamFileAccess,
  TextStreamName,
} from "./types.js";

export class TextStreams implements ReadonlyTextStreams {
  readonly #database: Database;
  readonly #documentPath: string;
  readonly #fileAccess: TextStreamFileAccess;
  readonly #identity: string;

  public constructor(
    documentPath: string,
    database: Database,
    fileAccess: TextStreamFileAccess = DEFAULT_FILE_ACCESS,
    identity = documentPath,
  ) {
    this.#database = database;
    this.#documentPath = resolveDocumentPath(documentPath);
    this.#fileAccess = fileAccess;
    this.#identity = identity;
  }

  public async ensureCreated(): Promise<void> {
    await this.#fileAccess.ensureDirectory(this.#getRootPath("source"));
    await this.#fileAccess.ensureDirectory(this.#getRootPath("summary"));
  }

  public async getSentence(sentenceId: SentenceId): Promise<string> {
    return (await this.getSerial(sentenceId[0]).getSentence(sentenceId[1]))
      .text;
  }

  public getSerial(serialId: number): SerialTextStream {
    return new SerialTextStream(
      this.#documentPath,
      this.#database,
      this.#fileAccess,
      "source",
      serialId,
      this.#identity,
    );
  }

  public getSummarySerial(serialId: number): SerialTextStream {
    return new SerialTextStream(
      this.#documentPath,
      this.#database,
      this.#fileAccess,
      "summary",
      serialId,
      this.#identity,
    );
  }

  #getRootPath(stream: TextStreamName): string {
    return joinDocumentPath(this.#documentPath, "texts", stream);
  }
}
