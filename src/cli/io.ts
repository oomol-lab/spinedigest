import { createReadStream } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { pipeline } from "stream/promises";

export function readTextStreamFromStdin(): AsyncIterable<string> {
  process.stdin.setEncoding("utf8");
  return process.stdin;
}

export async function writeTextFileToStdout(path: string): Promise<void> {
  await pipeline(createReadStream(path, { encoding: "utf8" }), process.stdout);
}

export async function createTemporaryOutputPath(
  prefix: string,
  extension: string,
): Promise<{
  readonly directoryPath: string;
  readonly filePath: string;
}> {
  const directoryPath = await mkdtemp(join(tmpdir(), prefix));

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
