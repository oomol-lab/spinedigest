import { access, mkdir, writeFile } from "fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineSource } from "stream";

import { withTempDir } from "../helpers/temp.js";

const ioMockState = vi.hoisted(() => ({
  pipelineCalls: [] as unknown[][],
}));

vi.mock("stream/promises", () => ({
  pipeline: vi.fn((...args: PipelineSource<unknown>[]) => {
    ioMockState.pipelineCalls.push(args);
    return Promise.resolve();
  }),
}));

import {
  createTemporaryOutputPath,
  readTextStreamFromStdin,
  removeTemporaryDirectory,
  writeTextFileToStdout,
} from "../../src/cli/io.js";

describe("cli/io", () => {
  beforeEach(() => {
    ioMockState.pipelineCalls.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("configures stdin for utf8 text and returns the stdin stream", () => {
    const setEncoding = vi
      .spyOn(process.stdin, "setEncoding")
      .mockImplementation(() => process.stdin);

    expect(readTextStreamFromStdin()).toBe(process.stdin);
    expect(setEncoding).toHaveBeenCalledWith("utf8");
  });

  it("pipes a utf8 file into stdout", async () => {
    await withTempDir("spinedigest-io-", async (path) => {
      const filePath = `${path}/result.txt`;

      await writeFile(filePath, "hello stdout", "utf8");
      await writeTextFileToStdout(filePath);

      expect(ioMockState.pipelineCalls).toHaveLength(1);
      expect(ioMockState.pipelineCalls[0]?.[1]).toBe(process.stdout);
      expect(ioMockState.pipelineCalls[0]?.[0]).toMatchObject({
        path: filePath,
      });
    });
  });

  it("creates temporary output paths inside a new directory", async () => {
    const output = await createTemporaryOutputPath(
      "spinedigest-io-output-",
      ".md",
    );

    try {
      await expect(access(output.directoryPath)).resolves.toBeUndefined();
      expect(output.filePath).toBe(`${output.directoryPath}/output.md`);
    } finally {
      await removeTemporaryDirectory(output.directoryPath);
    }
  });

  it("removes temporary directories recursively", async () => {
    await withTempDir("spinedigest-io-", async (path) => {
      const directoryPath = `${path}/to-remove`;

      await mkdir(`${directoryPath}/nested`, { recursive: true });
      await writeFile(`${directoryPath}/nested/file.txt`, "temp", "utf8");

      await removeTemporaryDirectory(directoryPath);

      await expect(access(directoryPath)).rejects.toThrow();
    });
  });
});
