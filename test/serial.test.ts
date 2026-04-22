import { beforeEach, describe, expect, it, vi } from "vitest";

const { compressTextMock, readerSegmentMock } = vi.hoisted(() => ({
  compressTextMock: vi.fn(),
  readerSegmentMock: vi.fn(),
}));

vi.mock("../src/editor/index.js", () => ({
  compressText: compressTextMock,
}));

vi.mock("../src/reader/index.js", () => ({
  Reader: class {
    public segment(stream: unknown): AsyncIterable<unknown> {
      return readerSegmentMock(stream);
    }

    public extractUserFocused() {
      return Promise.resolve({
        delta: {
          chunks: [],
          edges: [],
        },
        fragmentSummary: "",
      });
    }

    public extractBookCoherence() {
      return Promise.resolve({
        chunks: [],
        edges: [],
      });
    }

    public completeFragment(): void {}
  },
  segmentTextStream: (stream: unknown) => stream,
}));

vi.mock("../src/topology/index.js", () => ({
  Topology: class {
    public accept(): void {}

    public finalize(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

import { DirectoryDocument } from "../src/document/index.js";
import { SerialGeneration } from "../src/serial.js";
import { withTempDir } from "./helpers/temp.js";

describe("serial", () => {
  beforeEach(() => {
    compressTextMock.mockReset();
    readerSegmentMock.mockReset();
    compressTextMock.mockResolvedValue("");
  });

  it("emits advance for a single fragment before completion", async () => {
    await withTempDir("spinedigest-serial-", async (path) => {
      const document = await DirectoryDocument.open(path);
      const progressTracker = {
        advance: vi.fn(async (_wordsCount: number) => undefined),
        complete: vi.fn(async (_finalWordsCount?: number) => undefined),
      };

      readerSegmentMock.mockReturnValueOnce(
        createSentenceStream([
          {
            text: "Alpha beta.",
            wordsCount: 2,
          },
        ]),
      );

      try {
        await new SerialGeneration({
          document,
          llm: {} as never,
        }).generateInto(
          1,
          [],
          {
            extractionPrompt: "Keep key beats",
          },
          progressTracker as never,
        );

        expect(progressTracker.advance).toHaveBeenCalledTimes(1);
        expect(progressTracker.advance).toHaveBeenCalledWith(2);
        expect(progressTracker.complete).toHaveBeenCalledTimes(1);
        expect(progressTracker.complete).toHaveBeenCalledWith();
      } finally {
        await document.release();
      }
    });
  });

  it("emits advance for every processed fragment", async () => {
    await withTempDir("spinedigest-serial-", async (path) => {
      const document = await DirectoryDocument.open(path);
      const progressTracker = {
        advance: vi.fn(async (_wordsCount: number) => undefined),
        complete: vi.fn(async (_finalWordsCount?: number) => undefined),
      };

      readerSegmentMock.mockReturnValueOnce(
        createSentenceStream([
          {
            text: "Alpha beta.",
            wordsCount: 200,
          },
          {
            text: "Gamma delta epsilon.",
            wordsCount: 160,
          },
        ]),
      );

      try {
        await new SerialGeneration({
          document,
          llm: {} as never,
        }).generateInto(
          1,
          [],
          {
            extractionPrompt: "Keep key beats",
          },
          progressTracker as never,
        );

        expect(progressTracker.advance).toHaveBeenCalledTimes(2);
        expect(progressTracker.advance).toHaveBeenNthCalledWith(1, 200);
        expect(progressTracker.advance).toHaveBeenNthCalledWith(2, 160);
        expect(progressTracker.complete).toHaveBeenCalledWith();
      } finally {
        await document.release();
      }
    });
  });
});

async function* createSentenceStream(
  sentences: ReadonlyArray<{
    readonly text: string;
    readonly wordsCount: number;
  }>,
): AsyncIterable<{
  readonly text: string;
  readonly wordsCount: number;
}> {
  for (const sentence of sentences) {
    yield sentence;
  }
}
