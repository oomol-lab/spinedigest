import {
  readFileText,
  writeFileContent,
  type Directory,
} from "../../runtime/platform/index.js";

export interface PendingCacheEntry {
  cacheKey: string;
  response: string;
}

export class LLMCache {
  readonly #directory: Directory;

  public constructor(directory: Directory) {
    this.#directory = directory;
  }

  public createEntry(cacheKey: string, response: string): PendingCacheEntry {
    return { cacheKey, response };
  }

  public async read(cacheKey: string): Promise<string | undefined> {
    const file = await this.#directory.getFile(`${cacheKey}.txt`);
    return file === undefined ? undefined : await readFileText(file);
  }

  public async write(entry: PendingCacheEntry): Promise<void> {
    const name = `${entry.cacheKey}.txt`;
    const file =
      (await this.#directory.getFile(name)) ??
      (await this.#directory.createFile(name));
    await writeFileContent(file, entry.response);
  }
}
