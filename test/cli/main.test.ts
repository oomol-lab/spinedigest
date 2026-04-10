import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

const mainMockState = vi.hoisted(() => ({
  argsResult: { help: false } as Record<string, unknown>,
  parseError: undefined as Error | undefined,
  runCalls: [] as unknown[],
  runError: undefined as Error | undefined,
}));

vi.mock("../../src/cli/args.js", () => ({
  CLI_HELP_TEXT: "CLI HELP",
  parseCLIArguments: vi.fn(() => {
    if (mainMockState.parseError !== undefined) {
      throw mainMockState.parseError;
    }

    return mainMockState.argsResult;
  }),
}));

vi.mock("../../src/cli/convert.js", () => ({
  runConvertCommand: vi.fn((args: unknown) => {
    mainMockState.runCalls.push(args);

    if (mainMockState.runError !== undefined) {
      return Promise.reject(mainMockState.runError);
    }

    return Promise.resolve();
  }),
}));

import { main } from "../../src/cli/main.js";

describe("cli/main", () => {
  const originalExitCode = process.exitCode;
  let stdoutWrite: MockInstance;
  let stderrWrite: MockInstance;
  let stdoutChunks: string[];
  let stderrChunks: string[];

  beforeEach(() => {
    mainMockState.argsResult = { help: false };
    mainMockState.parseError = undefined;
    mainMockState.runCalls.length = 0;
    mainMockState.runError = undefined;
    process.exitCode = 0;
    stdoutChunks = [];
    stderrChunks = [];
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stdoutChunks.push(String(chunk));
        return true;
      });
    stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        stderrChunks.push(String(chunk));
        return true;
      });
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    process.exitCode = originalExitCode;
  });

  it("prints help text and skips conversion when --help is used", async () => {
    mainMockState.argsResult = { help: true };

    await main();

    expect(stdoutChunks).toStrictEqual(["CLI HELP\n"]);
    expect(stderrChunks).toStrictEqual([]);
    expect(mainMockState.runCalls).toHaveLength(0);
    expect(process.exitCode).toBe(0);
  });

  it("runs the convert command for normal execution", async () => {
    mainMockState.argsResult = {
      help: false,
      inputPath: "/tmp/book.txt",
      outputPath: "/tmp/out.txt",
    };

    await main();

    expect(mainMockState.runCalls).toStrictEqual([
      {
        help: false,
        inputPath: "/tmp/book.txt",
        outputPath: "/tmp/out.txt",
      },
    ]);
    expect(stdoutChunks).toStrictEqual([]);
    expect(stderrChunks).toStrictEqual([]);
    expect(process.exitCode).toBe(0);
  });

  it("writes parse errors to stderr and sets a non-zero exit code", async () => {
    mainMockState.parseError = new Error("bad args");

    await main();

    expect(stderrChunks).toStrictEqual(["bad args\n"]);
    expect(mainMockState.runCalls).toHaveLength(0);
    expect(process.exitCode).toBe(1);
  });

  it("writes convert command failures to stderr and sets a non-zero exit code", async () => {
    mainMockState.argsResult = { help: false };
    mainMockState.runError = new Error("convert failed");

    await main();

    expect(stderrChunks).toStrictEqual(["convert failed\n"]);
    expect(mainMockState.runCalls).toStrictEqual([{ help: false }]);
    expect(process.exitCode).toBe(1);
  });
});
