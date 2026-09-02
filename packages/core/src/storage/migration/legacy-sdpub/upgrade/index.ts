import { rm } from "../../../../runtime/platform/index.js";
import { join, resolve } from "../../../../runtime/platform/index.js";

import { createWikiGraphTempDirectory } from "../../../../runtime/common/wiki-graph/temp.js";
import { DirectoryDocument } from "../../../../document/index.js";
import { writeWikgArchive } from "../../../wikg/index.js";
import { extractLegacySdpubArchive } from "./extract.js";
import { migrateLegacyDatabase } from "./schema.js";
import { migrateLegacyTextStorage } from "./text-storage/index.js";

export interface LegacySdpubMigrationResult {
  readonly inputPath: string;
  readonly outputPath: string;
}

export async function migrateLegacySdpubToWikg(
  inputPath: string,
  outputPath = defaultWikgOutputPath(inputPath),
): Promise<LegacySdpubMigrationResult> {
  if (resolve(inputPath) === resolve(outputPath)) {
    throw new Error(
      "Legacy migration output path must differ from input path.",
    );
  }

  const workspacePath = await createWikiGraphTempDirectory("sdpub-upgrade");

  try {
    await extractLegacySdpubArchive(inputPath, workspacePath);
    await migrateLegacyDatabase(join(workspacePath, "database.db"));
    await migrateLegacyTextStorage(workspacePath);
    await normalizeLegacyToc(workspacePath);
    await writeWikgArchive(workspacePath, outputPath);

    return { inputPath, outputPath };
  } finally {
    await rm(workspacePath, { force: true, recursive: true });
  }
}

async function normalizeLegacyToc(workspacePath: string): Promise<void> {
  const document = await DirectoryDocument.open(workspacePath);

  try {
    const toc = await document.readToc();

    if (toc !== undefined) {
      await document.replaceToc(toc);
    }
  } finally {
    await document.release();
  }
}

function defaultWikgOutputPath(inputPath: string): string {
  if (inputPath.toLowerCase().endsWith(".sdpub")) {
    return `${inputPath.slice(0, -".sdpub".length)}.wikg`;
  }

  return `${inputPath}.wikg`;
}
