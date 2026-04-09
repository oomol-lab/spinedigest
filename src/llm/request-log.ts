import { appendFile } from "node:fs/promises";
import { join } from "node:path";

let lastTimestamp: string | undefined;
let loggerSuffixId = 1;

export class RequestLog {
  readonly #filePath: string | undefined;

  constructor(filePath?: string) {
    this.#filePath = filePath;
  }

  get filePath(): string | undefined {
    return this.#filePath;
  }

  async append(content: string): Promise<void> {
    if (this.#filePath === undefined) {
      return;
    }

    await appendFile(this.#filePath, content, "utf8");
  }
}

export function createRequestLog(logDirPath?: string): RequestLog {
  if (logDirPath === undefined) {
    return new RequestLog();
  }

  const now = new Date();
  const timestampKey = formatTimestamp(now);
  const suffixId =
    lastTimestamp === timestampKey ? loggerSuffixId + 1 : 1;

  lastTimestamp = timestampKey;
  loggerSuffixId = suffixId;

  const fileName =
    suffixId === 1
      ? `request ${timestampKey}.log`
      : `request ${timestampKey}_${suffixId}.log`;

  return new RequestLog(join(logDirPath, fileName));
}

function formatTimestamp(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}-${minutes}-${seconds}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
