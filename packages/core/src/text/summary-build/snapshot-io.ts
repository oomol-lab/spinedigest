import {
  readFileText,
  writeFileContent,
  type File,
} from "../../runtime/platform/index.js";

import {
  summaryInputSnapshotSchema,
  toChunkRecord,
  toReadingEdgeRecord,
} from "./schema.js";
import type { SummaryInputSnapshotData } from "./types.js";

export async function readSummaryInputSnapshot(
  file: File,
): Promise<SummaryInputSnapshotData> {
  const snapshot = summaryInputSnapshotSchema.parse(
    JSON.parse(await readFileText(file)),
  );

  return {
    ...snapshot,
    chunks: snapshot.chunks.map(toChunkRecord),
    readingEdges: snapshot.readingEdges.map(toReadingEdgeRecord),
  };
}

export async function writeSummaryInputSnapshot(
  file: File,
  snapshot: SummaryInputSnapshotData,
): Promise<void> {
  await writeFileContent(file, `${JSON.stringify(snapshot)}\n`);
}
