import { existsSync, statSync } from "fs";
import { dirname, join, parse } from "path";

export function resolveDataDirPath(): string {
  let currentDirectoryPath = dirname(resolveCurrentFilePath());
  const rootDirectoryPath = parse(currentDirectoryPath).root;

  while (true) {
    const candidatePath = join(currentDirectoryPath, "data");

    if (existsSync(candidatePath) && statSync(candidatePath).isDirectory()) {
      return candidatePath;
    }

    if (currentDirectoryPath === rootDirectoryPath) {
      throw new Error("Could not locate data directory");
    }

    currentDirectoryPath = dirname(currentDirectoryPath);
  }
}

function resolveCurrentFilePath(): string {
  const previousPrepareStackTrace = Error.prepareStackTrace?.bind(Error);

  try {
    Error.prepareStackTrace = (_error, stackTrace) => stackTrace;

    const stackTrace = new Error().stack as unknown as NodeJS.CallSite[];

    for (const callSite of stackTrace) {
      const fileName = callSite.getFileName();

      if (fileName !== null && fileName !== undefined) {
        return fileName;
      }
    }
  } finally {
    Error.prepareStackTrace = previousPrepareStackTrace;
  }

  throw new Error("Could not determine current file path");
}
