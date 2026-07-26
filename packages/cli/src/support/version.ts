import { existsSync, readFileSync } from "fs";
import { dirname, join, parse, resolve } from "path";

import { getCLICwd } from "../runtime/context.js";

function isCLIPackageJSON(path: string): boolean {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));

  return (
    typeof parsed === "object" &&
    parsed !== null &&
    "name" in parsed &&
    parsed.name === "wiki-graph"
  );
}

function findPackageJSONPathFromWorkingDirectory(): string | undefined {
  let currentDirectoryPath = getCLICwd();
  const rootDirectoryPath = parse(currentDirectoryPath).root;

  while (true) {
    for (const candidatePath of [
      join(currentDirectoryPath, "package.json"),
      join(currentDirectoryPath, "packages", "cli", "package.json"),
    ]) {
      if (existsSync(candidatePath) && isCLIPackageJSON(candidatePath)) {
        return candidatePath;
      }
    }

    if (currentDirectoryPath === rootDirectoryPath) {
      return undefined;
    }

    currentDirectoryPath = dirname(currentDirectoryPath);
  }
}

function resolvePackageJSONPath(): string {
  const injectedCLIDistDirectoryPath = (
    globalThis as { __WIKIGRAPH_CLI_DIST_DIR__?: unknown }
  ).__WIKIGRAPH_CLI_DIST_DIR__;

  const candidatePaths = [
    typeof injectedCLIDistDirectoryPath === "string"
      ? resolve(injectedCLIDistDirectoryPath, "../package.json")
      : undefined,
    findPackageJSONPathFromWorkingDirectory(),
  ];

  for (const candidatePath of candidatePaths) {
    if (candidatePath !== undefined && existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error("Could not locate CLI package.json");
}

export function readCLIVersion(): string {
  const packageJSONPath = resolvePackageJSONPath();
  const parsed: unknown = JSON.parse(readFileSync(packageJSONPath, "utf8"));

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    typeof parsed.version === "string"
  ) {
    return parsed.version;
  }

  throw new Error(`Invalid package version in ${packageJSONPath}`);
}
