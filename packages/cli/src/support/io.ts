import { createReadStream } from "fs";
import { rm } from "fs/promises";
import { join } from "path";

import { createWikiGraphTempDirectory } from "wiki-graph-core";
import {
  getCLIStderr,
  getCLIStdin,
  getCLIStdout,
  setCLIExitCode,
} from "../runtime/context.js";

export function readTextStreamFromStdin(): AsyncIterable<string> {
  const stdin = getCLIStdin();

  stdin.setEncoding("utf8");
  return stdin as AsyncIterable<string>;
}

export async function writeTextFileToStdout(path: string): Promise<void> {
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    await writeChunkToStdout(String(chunk));
  }
}

export async function writeTextToStdout(text: string): Promise<void> {
  await writeChunkToStdout(text);
}

export async function writeTextToStderr(text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    getCLIStderr().write(text, (error) => {
      if (error === undefined || error === null) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

export async function writeBinaryToStdout(data: Uint8Array): Promise<void> {
  await writeChunkToStdout(data);
}

async function writeChunkToStdout(chunk: string | Uint8Array): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    getCLIStdout().write(chunk, (error) => {
      if (error === undefined || error === null) {
        resolve();
        return;
      }
      if (isBrokenPipeError(error)) {
        setCLIExitCode(0);
        resolve();
        return;
      }

      reject(error);
    });
  });
}

function isBrokenPipeError(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "EPIPE";
}

export async function createTemporaryOutputPath(
  prefix: string,
  extension: string,
): Promise<{
  readonly directoryPath: string;
  readonly filePath: string;
}> {
  void prefix;
  const directoryPath = await createWikiGraphTempDirectory("cli-output");

  return {
    directoryPath,
    filePath: join(directoryPath, `output${extension}`),
  };
}

export async function removeTemporaryDirectory(
  directoryPath: string,
): Promise<void> {
  await rm(directoryPath, { force: true, recursive: true });
}
