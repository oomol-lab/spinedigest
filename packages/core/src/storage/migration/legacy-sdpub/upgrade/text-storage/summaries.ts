import {
  isDirectory,
  readFileText,
  type Directory,
} from "../../../../../runtime/platform/index.js";
import { DirectoryDocument } from "../../../../../document/directory/index.js";

export async function migrateLegacySummariesToTextStreams(
  workspace: Directory,
): Promise<void> {
  const summaries = await listLegacySummaries(workspace);
  const document = await DirectoryDocument.open(workspace);
  try {
    for (const summary of summaries) {
      await document.writeSummary(summary.serialId, summary.text);
    }
  } finally {
    await document.release();
  }
}

async function listLegacySummaries(
  workspace: Directory,
): Promise<Array<{ readonly serialId: number; readonly text: string }>> {
  const directory = await workspace.getDirectory("summaries");
  if (directory === undefined) return [];
  const summaries: Array<{ serialId: number; text: string }> = [];
  for (const entry of await directory.list()) {
    if (isDirectory(entry)) continue;
    const match = /^serial-(\d+)\.txt$/u.exec(entry.name);
    if (match === null) continue;
    summaries.push({
      serialId: Number(match[1]),
      text: await readFileText(entry),
    });
  }
  return summaries.sort((left, right) => left.serialId - right.serialId);
}
