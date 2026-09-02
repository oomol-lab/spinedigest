import { process as platformProcess } from "../platform/index.js";
import { existsSync, statSync } from "../platform/index.js";
import { dirname, join, parse, resolve } from "../platform/index.js";

export function resolveDataDirPath(): string {
  const injectedPath = (globalThis as { __WIKIGRAPH_DATA_DIR__?: unknown })
    .__WIKIGRAPH_DATA_DIR__;

  if (typeof injectedPath === "string" && injectedPath !== "") {
    return injectedPath;
  }

  return resolveDataDirPathFromWorkingDirectory();
}

function resolveDataDirPathFromWorkingDirectory(): string {
  let currentDirectoryPath = platformProcess.cwd();
  const rootDirectoryPath = parse(currentDirectoryPath).root;

  while (true) {
    for (const candidatePath of [
      join(currentDirectoryPath, "data"),
      join(currentDirectoryPath, "packages", "core", "data"),
    ]) {
      if (existsSync(candidatePath) && statSync(candidatePath).isDirectory()) {
        return candidatePath;
      }
    }

    if (currentDirectoryPath === rootDirectoryPath) {
      throw new Error("Could not locate data directory");
    }

    currentDirectoryPath = dirname(currentDirectoryPath);
  }
}
