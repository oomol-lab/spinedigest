import { DirectoryDocument } from "../../../../document/index.js";
import {
  getWikiGraphStorage,
  type Directory,
  type File,
} from "../../../../runtime/platform/index.js";
import { writeWikgArchive } from "../../../wikg/index.js";
import { extractLegacySdpubArchive } from "./extract.js";
import { migrateLegacyDatabase } from "./schema.js";
import { migrateLegacyTextStorage } from "./text-storage/index.js";

export interface LegacySdpubMigrationResult {
  readonly inputIdentity: string;
  readonly outputIdentity: string;
}

let workspaceSequence = 0;

export async function migrateLegacySdpubToWikg(
  inputFile: File,
  outputFile: File,
): Promise<LegacySdpubMigrationResult> {
  if (inputFile.identity === outputFile.identity) {
    throw new Error("Legacy migration output must differ from input.");
  }
  const root = getWikiGraphStorage().documentStore;
  const workspaceName = await createWorkspaceName(root);
  const workspace = await root.createDirectory(workspaceName);
  try {
    await extractLegacySdpubArchive(inputFile, workspace);
    const databaseFile = await workspace.getFile("database.db");
    if (databaseFile === undefined)
      throw new Error("Legacy database is missing.");
    await migrateLegacyDatabase(databaseFile);
    await migrateLegacyTextStorage(workspace);
    await normalizeLegacyToc(workspace);
    await writeWikgArchive(workspace, outputFile);
    return {
      inputIdentity: inputFile.identity,
      outputIdentity: outputFile.identity,
    };
  } finally {
    await root
      .remove(workspaceName, { recursive: true })
      .catch(() => undefined);
  }
}

async function normalizeLegacyToc(workspace: Directory): Promise<void> {
  const document = await DirectoryDocument.open(workspace);
  try {
    const toc = await document.readToc();
    if (toc !== undefined) await document.replaceToc(toc);
  } finally {
    await document.release();
  }
}

async function createWorkspaceName(root: Directory): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    workspaceSequence += 1;
    const name = `.sdpub-upgrade-${Date.now().toString(36)}-${workspaceSequence.toString(36)}`;
    if ((await root.getDirectory(name)) === undefined) return name;
  }
  throw new Error("Could not allocate a legacy migration workspace");
}
