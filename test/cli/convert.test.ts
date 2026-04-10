import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cliMockState = vi.hoisted(() => ({
  appConstructorOptions: [] as unknown[],
  buildLLMOptionsConfig: [] as unknown[],
  config: {} as Record<string, unknown>,
  createTemporaryOutputPathCalls: [] as Array<{
    readonly extension: string;
    readonly prefix: string;
  }>,
  digestCalls: {
    epub: [] as unknown[],
    markdown: [] as unknown[],
    text: [] as unknown[],
    txt: [] as unknown[],
  },
  exportCalls: [] as Array<{
    readonly method: "exportEpub" | "exportText" | "saveAs";
    readonly path: string;
  }>,
  openCalls: [] as string[],
  removeTemporaryDirectoryCalls: [] as string[],
  stdoutWrites: [] as string[],
}));

const mockLLMOptions = {
  model: {
    provider: "mock-model",
  },
};

const mockTemporaryOutput = {
  directoryPath: "/tmp/spinedigest-cli-output-temp",
  filePath: "/tmp/spinedigest-cli-output-temp/output.txt",
};

const mockStdinStream = ["from stdin"];

vi.mock("../../src/index.js", () => ({
  SpineDigestApp: class {
    public constructor(options: unknown) {
      cliMockState.appConstructorOptions.push(options);
    }

    public async openSession(
      path: string,
      operation: (digest: MockDigest) => Promise<unknown>,
    ): Promise<unknown> {
      cliMockState.openCalls.push(path);
      return await operation(createMockDigest());
    }

    public async digestEpubSession(
      options: unknown,
      operation: (digest: MockDigest) => Promise<unknown>,
    ): Promise<unknown> {
      cliMockState.digestCalls.epub.push(options);
      return await operation(createMockDigest());
    }

    public async digestMarkdownSession(
      options: unknown,
      operation: (digest: MockDigest) => Promise<unknown>,
    ): Promise<unknown> {
      cliMockState.digestCalls.markdown.push(options);
      return await operation(createMockDigest());
    }

    public async digestTextSession(
      options: unknown,
      operation: (digest: MockDigest) => Promise<unknown>,
    ): Promise<unknown> {
      cliMockState.digestCalls.text.push(options);
      return await operation(createMockDigest());
    }

    public async digestTxtSession(
      options: unknown,
      operation: (digest: MockDigest) => Promise<unknown>,
    ): Promise<unknown> {
      cliMockState.digestCalls.txt.push(options);
      return await operation(createMockDigest());
    }
  },
}));

vi.mock("../../src/cli/config.js", () => ({
  loadCLIConfig: vi.fn(() => Promise.resolve(cliMockState.config)),
}));

vi.mock("../../src/cli/llm.js", () => ({
  buildLLMOptions: vi.fn((config: unknown) => {
    cliMockState.buildLLMOptionsConfig.push(config);
    return mockLLMOptions;
  }),
}));

vi.mock("../../src/cli/io.js", () => ({
  createTemporaryOutputPath: vi.fn((prefix: string, extension: string) => {
    cliMockState.createTemporaryOutputPathCalls.push({
      extension,
      prefix,
    });
    return Promise.resolve(mockTemporaryOutput);
  }),
  readTextStreamFromStdin: vi.fn(() => mockStdinStream),
  removeTemporaryDirectory: vi.fn((directoryPath: string) => {
    cliMockState.removeTemporaryDirectoryCalls.push(directoryPath);
    return Promise.resolve();
  }),
  writeTextFileToStdout: vi.fn((path: string) => {
    cliMockState.stdoutWrites.push(path);
    return Promise.resolve();
  }),
}));

import { runConvertCommand } from "../../src/cli/convert.js";

describe("cli/convert", () => {
  const originalStdinIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    cliMockState.appConstructorOptions.length = 0;
    cliMockState.buildLLMOptionsConfig.length = 0;
    cliMockState.createTemporaryOutputPathCalls.length = 0;
    cliMockState.digestCalls.epub.length = 0;
    cliMockState.digestCalls.markdown.length = 0;
    cliMockState.digestCalls.text.length = 0;
    cliMockState.digestCalls.txt.length = 0;
    cliMockState.exportCalls.length = 0;
    cliMockState.openCalls.length = 0;
    cliMockState.removeTemporaryDirectoryCalls.length = 0;
    cliMockState.stdoutWrites.length = 0;
    cliMockState.config = {};
    setStdinTTY(false);
  });

  afterEach(() => {
    setStdinTTY(originalStdinIsTTY);
  });

  it("opens sdpub input without requiring llm configuration", async () => {
    await runConvertCommand({
      help: false,
      inputPath: "/tmp/book.sdpub",
      outputPath: "/tmp/output.txt",
    });

    expect(cliMockState.appConstructorOptions).toStrictEqual([{}]);
    expect(cliMockState.openCalls).toStrictEqual(["/tmp/book.sdpub"]);
    expect(cliMockState.exportCalls).toStrictEqual([
      {
        method: "exportText",
        path: "/tmp/output.txt",
      },
    ]);
    expect(cliMockState.digestCalls.epub).toHaveLength(0);
    expect(cliMockState.buildLLMOptionsConfig).toHaveLength(0);
  });

  it("digests stdin text to stdout through a temporary text file", async () => {
    cliMockState.config = {
      llm: {
        model: "gpt-test",
        provider: "openai",
      },
      paths: {
        debugLogDir: "/tmp/debug-log",
      },
      prompt: "Keep the main beats",
    };

    await runConvertCommand({
      help: false,
      inputFormat: "txt",
      outputFormat: "markdown",
    });

    expect(cliMockState.appConstructorOptions).toStrictEqual([
      {
        debugLogDirPath: "/tmp/debug-log",
        llm: mockLLMOptions,
      },
    ]);
    expect(cliMockState.buildLLMOptionsConfig).toStrictEqual([
      cliMockState.config,
    ]);
    expect(cliMockState.digestCalls.text).toHaveLength(1);
    expect(cliMockState.digestCalls.text[0]).toStrictEqual({
      extractionPrompt: "Keep the main beats",
      sourceFormat: "txt",
      stream: mockStdinStream,
    });
    expect(cliMockState.createTemporaryOutputPathCalls).toStrictEqual([
      {
        extension: ".md",
        prefix: "spinedigest-cli-output-",
      },
    ]);
    expect(cliMockState.exportCalls).toStrictEqual([
      {
        method: "exportText",
        path: mockTemporaryOutput.filePath,
      },
    ]);
    expect(cliMockState.stdoutWrites).toStrictEqual([
      mockTemporaryOutput.filePath,
    ]);
    expect(cliMockState.removeTemporaryDirectoryCalls).toStrictEqual([
      mockTemporaryOutput.directoryPath,
    ]);
  });

  it("refuses to read interactive stdin when input is omitted", async () => {
    cliMockState.config = {
      llm: {
        model: "gpt-test",
        provider: "openai",
      },
    };
    setStdinTTY(true);

    await expect(
      runConvertCommand({
        help: false,
        inputFormat: "txt",
        outputPath: "/tmp/output.txt",
      }),
    ).rejects.toThrow(
      "Missing --input. Refusing to read from interactive stdin. Use --input <path> or pipe text into stdin.",
    );

    expect(cliMockState.digestCalls.text).toHaveLength(0);
  });

  it("routes epub inputs through digestEpubSession and saves sdpub output", async () => {
    cliMockState.config = {
      llm: {
        model: "gpt-test",
        provider: "openai",
      },
      paths: {
        debugLogDir: "/tmp/debug-log",
      },
      prompt: "Keep the main beats",
    };

    await runConvertCommand({
      help: false,
      inputPath: "/tmp/book.epub",
      outputPath: "/tmp/output.sdpub",
    });

    expect(cliMockState.digestCalls.epub).toStrictEqual([
      {
        extractionPrompt: "Keep the main beats",
        path: "/tmp/book.epub",
      },
    ]);
    expect(cliMockState.exportCalls).toStrictEqual([
      {
        method: "saveAs",
        path: "/tmp/output.sdpub",
      },
    ]);
  });

  it("rejects digest inputs when llm configuration is missing", async () => {
    cliMockState.config = {};

    await expect(
      runConvertCommand({
        help: false,
        inputPath: "/tmp/book.txt",
        outputPath: "/tmp/output.txt",
      }),
    ).rejects.toThrow(
      "Missing LLM configuration. Set `llm.provider` and `llm.model` in ~/.spinedigest/config.json or the matching SPINEDIGEST_LLM_* environment variables.",
    );

    expect(cliMockState.appConstructorOptions).toHaveLength(0);
    expect(cliMockState.digestCalls.txt).toHaveLength(0);
  });

  it("rejects stdin input when the format cannot be inferred", async () => {
    await expect(
      runConvertCommand({
        help: false,
        outputFormat: "txt",
      }),
    ).rejects.toThrow("Cannot infer input format from stdin. Set --input-format.");

    expect(cliMockState.appConstructorOptions).toHaveLength(0);
  });

  it("rejects non-text stdout outputs before any app work starts", async () => {
    await expect(
      runConvertCommand({
        help: false,
        inputPath: "/tmp/book.sdpub",
        outputFormat: "sdpub",
      }),
    ).rejects.toThrow("stdout only supports txt or markdown, but got sdpub.");

    expect(cliMockState.appConstructorOptions).toHaveLength(0);
    expect(cliMockState.openCalls).toHaveLength(0);
  });
});

interface MockDigest {
  exportEpub(path: string): Promise<void>;
  exportText(path: string): Promise<void>;
  saveAs(path: string): Promise<void>;
}

function createMockDigest(): MockDigest {
  return {
    exportEpub: (path: string) => {
      cliMockState.exportCalls.push({
        method: "exportEpub",
        path,
      });
      return Promise.resolve();
    },
    exportText: (path: string) => {
      cliMockState.exportCalls.push({
        method: "exportText",
        path,
      });
      return Promise.resolve();
    },
    saveAs: (path: string) => {
      cliMockState.exportCalls.push({
        method: "saveAs",
        path,
      });
      return Promise.resolve();
    },
  };
}

function setStdinTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value,
  });
}
