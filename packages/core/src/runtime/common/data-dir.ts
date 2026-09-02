import { process as platformProcess } from "../platform/index.js";
import { existsSync, statSync } from "../platform/index.js";
import { fileURLToPath } from "../platform/index.js";
import { dirname, join, parse, resolve } from "../platform/index.js";

export function resolveDataDirPath(): string {
  const injectedPath = (globalThis as { __WIKIGRAPH_DATA_DIR__?: unknown })
    .__WIKIGRAPH_DATA_DIR__;

  if (typeof injectedPath === "string" && injectedPath !== "") {
    return injectedPath;
  }

  const moduleDataDirPath = resolveDataDirPathFromModule();
  if (moduleDataDirPath !== undefined) {
    return moduleDataDirPath;
  }

  return resolveDataDirPathFromWorkingDirectory();
}

function resolveDataDirPathFromModule(): string | undefined {
  const moduleDirectoryPath = dirname(fileURLToPath(import.meta.url));

  for (const candidatePath of [
    resolve(moduleDirectoryPath, "../../../data"),
    resolve(moduleDirectoryPath, "../../data"),
    resolve(moduleDirectoryPath, "../data"),
  ]) {
    if (existsSync(candidatePath) && statSync(candidatePath).isDirectory()) {
      return candidatePath;
    }
  }

  return undefined;
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
