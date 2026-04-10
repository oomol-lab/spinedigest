import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export async function withTempDir<T>(
  prefix: string,
  operation: (path: string) => Promise<T>,
): Promise<T> {
  const path = await mkdtemp(join(tmpdir(), prefix));

  try {
    return await operation(path);
  } finally {
    await rm(path, { force: true, recursive: true });
  }
}
