import { basename, isAbsolute } from "path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const appMockState = vi.hoisted(() => ({
  digestCalls: {
    epub: [] as unknown[],
    markdown: [] as unknown[],
    textStream: [] as unknown[],
    txt: [] as unknown[],
  },
  llmOptions: [] as unknown[],
}));

vi.mock("../../src/llm/index.js", () => ({
  LLM: class {
    public constructor(options: unknown) {
      appMockState.llmOptions.push(options);
    }
  },
}));

vi.mock("../../src/facade/digest.js", () => ({
  digestEpubSession: vi.fn(
    async (options: unknown, operation: () => unknown) => {
      appMockState.digestCalls.epub.push(options);
      return await operation();
    },
  ),
  digestMarkdownSession: vi.fn(
    async (options: unknown, operation: () => unknown) => {
      appMockState.digestCalls.markdown.push(options);
      return await operation();
    },
  ),
  digestTextStreamSession: vi.fn(
    async (options: unknown, operation: () => unknown) => {
      appMockState.digestCalls.textStream.push(options);
      return await operation();
    },
  ),
  digestTxtSession: vi.fn(
    async (options: unknown, operation: () => unknown) => {
      appMockState.digestCalls.txt.push(options);
      return await operation();
    },
  ),
}));

import { DirectoryDocument } from "../../src/document/index.js";
import { SpineDigest } from "../../src/facade/spine-digest.js";
import { SpineDigestApp } from "../../src/index.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/app", () => {
  beforeEach(() => {
    appMockState.digestCalls.epub.length = 0;
    appMockState.digestCalls.markdown.length = 0;
    appMockState.digestCalls.textStream.length = 0;
    appMockState.digestCalls.txt.length = 0;
    appMockState.llmOptions.length = 0;
  });

  it("throws when digest operations require an llm but none is configured", async () => {
    const app = new SpineDigestApp({});

    await expect(
      app.digestTxtSession(
        {
          path: "/tmp/source.txt",
        },
        () => undefined,
      ),
    ).rejects.toThrow(
      "LLM is required for digest operations. Configure `llm` when constructing SpineDigestApp.",
    );
  });

  it("normalizes a raw model into llm options and forwards source session arguments", async () => {
    const fakeModel = {
      provider: "test-model",
    };
    const app = new SpineDigestApp({
      debugLogDirPath: "/tmp/spinedigest-debug",
      llm: fakeModel as never,
    });
    const onProgress = vi.fn();

    const result = await app.digestTxtSession(
      {
        documentDirPath: "/tmp/spinedigest-document",
        extractionPrompt: "   ",
        onProgress,
        path: "/tmp/source.txt",
        userLanguage: "Simplified Chinese",
      },
      () => "done",
    );

    expect(result).toBe("done");
    expect(appMockState.llmOptions).toHaveLength(1);
    const llmOptions = appMockState.llmOptions[0] as {
      readonly dataDirPath: string;
      readonly model: unknown;
    };

    expect(isAbsolute(llmOptions.dataDirPath)).toBe(true);
    expect(basename(llmOptions.dataDirPath)).toBe("data");
    expect(llmOptions.model).toBe(fakeModel);
    expect(appMockState.digestCalls.txt).toHaveLength(1);
    const digestCall = appMockState.digestCalls.txt[0] as {
      readonly documentDirPath: string;
      readonly extractionPrompt: string;
      readonly llm: unknown;
      readonly logDirPath: string;
      readonly onProgress: typeof onProgress;
      readonly path: string;
      readonly userLanguage: string;
    };

    expect(digestCall.documentDirPath).toBe("/tmp/spinedigest-document");
    expect(digestCall.logDirPath).toBe("/tmp/spinedigest-debug");
    expect(digestCall.onProgress).toBe(onProgress);
    expect(digestCall.path).toBe("/tmp/source.txt");
    expect(digestCall.userLanguage).toBe("Simplified Chinese");
    expect(digestCall.llm).toBeTruthy();
    expect(digestCall.extractionPrompt).toContain(
      "main storyline and key character developments",
    );
  });

  it("forwards text-stream session options and preserves explicit extraction prompts", async () => {
    const fakeModel = {
      provider: "test-model",
    };
    const app = new SpineDigestApp({
      llm: {
        cacheDirPath: "/tmp/cache",
        model: fakeModel as never,
        stream: true,
        temperature: 0.3,
      },
    });

    await app.digestTextStreamSession(
      {
        bookLanguage: "ja",
        documentDirPath: "/tmp/custom-document",
        extractionPrompt: "Keep dialogue only",
        sourceFormat: "markdown",
        stream: ["alpha", "beta"],
        title: "  Session Title  ",
        userLanguage: "English",
      },
      () => undefined,
    );

    expect(appMockState.llmOptions).toHaveLength(1);
    const llmOptions = appMockState.llmOptions[0] as {
      readonly cacheDirPath: string;
      readonly dataDirPath: string;
      readonly model: unknown;
      readonly stream: boolean;
      readonly temperature: number;
    };

    expect(llmOptions.cacheDirPath).toBe("/tmp/cache");
    expect(isAbsolute(llmOptions.dataDirPath)).toBe(true);
    expect(basename(llmOptions.dataDirPath)).toBe("data");
    expect(llmOptions.model).toBe(fakeModel);
    expect(llmOptions.stream).toBe(true);
    expect(llmOptions.temperature).toBe(0.3);
    expect(appMockState.digestCalls.textStream).toHaveLength(1);
    const digestCall = appMockState.digestCalls.textStream[0] as {
      readonly bookLanguage: string;
      readonly documentDirPath: string;
      readonly extractionPrompt: string;
      readonly sourceFormat: string;
      readonly stream: readonly string[];
      readonly title: string;
      readonly userLanguage: string;
    };

    expect(digestCall.bookLanguage).toBe("ja");
    expect(digestCall.documentDirPath).toBe("/tmp/custom-document");
    expect(digestCall.sourceFormat).toBe("markdown");
    expect(digestCall.stream).toStrictEqual(["alpha", "beta"]);
    expect(digestCall.title).toBe("  Session Title  ");
    expect(digestCall.userLanguage).toBe("English");
    expect(digestCall.extractionPrompt).toBe("Keep dialogue only");
  });

  it("opens saved digest archives without requiring llm configuration", async () => {
    await withTempDir("spinedigest-app-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.createSerial();
          await openedDocument.writeBookMeta({
            authors: ["Ari Lantern"],
            description: null,
            identifier: "urn:test:app-open",
            language: "en",
            publishedAt: null,
            publisher: null,
            sourceFormat: "txt",
            title: "App Open Fixture",
            version: 1,
          });
          await openedDocument.writeSummary(1, "Recovered");
          await openedDocument.writeToc({
            items: [
              {
                children: [],
                serialId: 1,
                title: "Chapter 1",
              },
            ],
            version: 1,
          });
        });

        const archivePath = `${path}/fixture/book.sdpub`;
        await new SpineDigest(document, document.path).saveAs(archivePath);

        const app = new SpineDigestApp({});
        const title = await app.openSession(archivePath, async (digest) => {
          return (await digest.readMeta())?.title;
        });

        expect(title).toBe("App Open Fixture");
      } finally {
        await document.release();
      }
    });
  });
});
