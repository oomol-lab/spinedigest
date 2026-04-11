import { clearLine, cursorTo, moveCursor } from "readline";

import type {
  SpineDigestProgressCallback,
  SpineDigestProgressEvent,
} from "../index.js";

interface SerialState {
  readonly fragments: number;
  completedWords: number;
  readonly words: number;
}

export interface CLIProgressRenderer {
  readonly onProgress?: SpineDigestProgressCallback;
  stop(): Promise<void>;
}

export function createCLIProgressRenderer(input: {
  readonly enabled: boolean;
  readonly stream?: NodeJS.WriteStream;
}): CLIProgressRenderer {
  if (!input.enabled) {
    return {
      async stop() {},
    };
  }

  return new TerminalProgressRenderer(input.stream ?? process.stderr);
}

class TerminalProgressRenderer implements CLIProgressRenderer {
  readonly #stream: NodeJS.WriteStream;
  readonly #serials = new Map<number, SerialState>();
  #digest:
    | {
        completedWords: number;
        totalWords: number;
      }
    | undefined;
  #renderQueue: Promise<void> = Promise.resolve();
  #renderedLineCount = 0;
  #stopping = false;

  public constructor(stream: NodeJS.WriteStream) {
    this.#stream = stream;
  }

  public readonly onProgress: SpineDigestProgressCallback = async (event) => {
    if (this.#stopping) {
      return;
    }

    const renderTask = this.#renderQueue.catch(swallowRenderError).then(() => {
      this.#applyEvent(event);
      this.#render();
    });

    this.#renderQueue = renderTask;

    await renderTask;
  };

  public async stop(): Promise<void> {
    if (this.#stopping) {
      await this.#renderQueue.catch(swallowRenderError);
      return;
    }

    this.#stopping = true;

    const stopTask = this.#renderQueue.catch(swallowRenderError).then(() => {
      if (this.#renderedLineCount === 0) {
        return;
      }

      this.#stream.write("\n");
      this.#renderedLineCount = 0;
    });

    this.#renderQueue = stopTask;

    await stopTask;
  }

  #applyEvent(event: SpineDigestProgressEvent): void {
    switch (event.type) {
      case "serial-discovered":
        this.#serials.set(event.id, {
          completedWords: 0,
          fragments: event.fragments,
          words: event.words,
        });
        return;
      case "serial-progress": {
        const serial = this.#serials.get(event.id);

        if (serial !== undefined) {
          serial.completedWords = event.completedWords;
        }
        return;
      }
      case "digest-progress":
        this.#digest = {
          completedWords: event.completedWords,
          totalWords: event.totalWords,
        };
        return;
    }
  }

  #render(): void {
    const lines = this.#buildLines();

    if (lines.length === 0) {
      return;
    }

    if (this.#renderedLineCount > 0) {
      moveCursor(this.#stream, 0, -this.#renderedLineCount);
    }

    const renderLineCount = Math.max(lines.length, this.#renderedLineCount);

    for (let index = 0; index < renderLineCount; index += 1) {
      cursorTo(this.#stream, 0);
      clearLine(this.#stream, 0);

      const line = lines[index];

      if (line !== undefined) {
        this.#stream.write(line);
      }

      if (index < renderLineCount - 1) {
        this.#stream.write("\n");
      }
    }

    this.#renderedLineCount = lines.length;
  }

  #buildLines(): string[] {
    const lines: string[] = [];

    if (this.#digest !== undefined) {
      lines.push(
        `${formatLabel("Digest")}${renderBar(
          this.#digest.completedWords,
          this.#digest.totalWords,
        )} ${formatNumber(this.#digest.completedWords)} / ${formatNumber(
          this.#digest.totalWords,
        )} words`,
      );
    }

    for (const [serialId, serial] of [...this.#serials.entries()].sort(
      ([leftId], [rightId]) => leftId - rightId,
    )) {
      lines.push(
        `${formatLabel(`Serial #${serialId}`)}${renderBar(
          serial.completedWords,
          serial.words,
        )} ${formatNumber(serial.completedWords)} / ${formatNumber(
          serial.words,
        )} words (${formatNumber(serial.fragments)} fragments)`,
      );
    }

    return lines;
  }
}

function swallowRenderError(): undefined {
  return undefined;
}

function formatLabel(label: string): string {
  return label.padEnd(11);
}

function renderBar(completed: number, total: number): string {
  const width = 12;
  const safeTotal = total <= 0 ? 1 : total;
  const ratio = Math.max(0, Math.min(1, completed / safeTotal));
  const filled = Math.round(ratio * width);

  return `[${"#".repeat(filled)}${".".repeat(width - filled)}]`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
