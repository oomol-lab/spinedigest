import {
  ensureRelativeFile,
  type Directory,
  type File,
} from "../../runtime/platform/index.js";

import type { Document, ReadonlyDocument } from "../../document/index.js";
import {
  createFragmentBackedDocument,
  DirectoryDocument,
} from "../../document/index.js";
import {
  getChapterDetails,
  requireStage,
  type ChapterDetails,
} from "../../document/chapter/index.js";
import { SummaryInputSnapshotDocument } from "./snapshot/index.js";
import {
  readSummaryInputSnapshot,
  writeSummaryInputSnapshot,
} from "./snapshot-io.js";
import { readSerialFragments } from "./source.js";
import {
  buildSummaryFromDocument,
  buildSummaryFromReadyDocument,
} from "./build.js";
import {
  createChapterReadingGraphObjectStream,
  createSummaryInputSnapshotFromReadingGraphObjects,
  readWikgObjectsFromJsonl,
  writeWikgObjectsToJsonl,
} from "../../object-stream.js";
import { replaceChapterFtsIndexArtifact } from "../../retrieval/index-artifact/index.js";
import type {
  BuildChapterSummaryArtifactOptions,
  ChapterSummaryInputSnapshot,
  SummaryInputSnapshotData,
} from "./types.js";

export async function buildChapterSummaryArtifact(
  document: ReadonlyDocument,
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions,
): Promise<string> {
  const readingGraphObjectsFile = options.readingGraphObjectsFile;

  if (readingGraphObjectsFile !== undefined) {
    return await buildChapterSummaryArtifactFromReadingGraphObjects(chapterId, {
      ...options,
      readingGraphObjectsFile,
    });
  }

  const snapshotFile = options.snapshotFile;

  if (snapshotFile !== undefined) {
    return await buildChapterSummaryArtifactFromSnapshot(chapterId, {
      ...options,
      snapshotFile,
    });
  }

  const sourceDocumentDirectory = options.sourceDocumentDirectory;

  if (sourceDocumentDirectory !== undefined) {
    return await buildChapterSummaryArtifactFromDocumentSnapshot(chapterId, {
      ...options,
      sourceDocumentDirectory,
    });
  }

  return await buildChapterSummaryArtifactFromDocument(
    document,
    chapterId,
    options,
  );
}

export async function buildChapterSummaryArtifactFromSnapshot(
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions & {
    readonly snapshotFile: File;
  },
): Promise<string> {
  const snapshot = await readSummaryInputSnapshot(options.snapshotFile);
  return await buildSummaryFromSnapshot(snapshot, chapterId, options);
}

export async function buildChapterSummaryArtifactFromReadingGraphObjects(
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions & {
    readonly readingGraphObjectsFile: File;
  },
): Promise<string> {
  const snapshot = await createSummaryInputSnapshotFromReadingGraphObjects(
    chapterId,
    readWikgObjectsFromJsonl(options.readingGraphObjectsFile),
  );

  return await buildSummaryFromSnapshot(snapshot, chapterId, options);
}

export async function commitChapterSummaryArtifact(
  document: Document,
  chapterId: number,
  summary: string,
): Promise<ChapterDetails> {
  await document.openSession(async (openedDocument) => {
    await requireStage(openedDocument, chapterId, "graphed");
    const hadFtsArtifact =
      (await openedDocument.indexArtifacts.get(chapterId, "fts")) !== undefined;
    await openedDocument.writeSummary(chapterId, summary);
    if (hadFtsArtifact) {
      await replaceChapterFtsIndexArtifact(openedDocument, chapterId);
    }
  });

  return await getChapterDetails(document, chapterId);
}

export async function snapshotChapterSummaryInput(
  document: ReadonlyDocument,
  chapterId: number,
  workspace: Directory,
): Promise<ChapterSummaryInputSnapshot> {
  const file = await ensureRelativeFile(workspace, "summary-input.json");
  const objectsFile = await ensureRelativeFile(
    workspace,
    "reading-graph.jsonl",
  );

  await requireStage(document, chapterId, "graphed");

  const fragments = await readSerialFragments(document, chapterId);
  const snakes = await document.snakes.listBySerial(chapterId);
  const snakeChunks = (
    await Promise.all(
      snakes.map(
        async (snake) => await document.snakeChunks.listBySnake(snake.id),
      ),
    )
  ).flat();

  await writeSummaryInputSnapshot(file, {
    chunks: await document.chunks.listBySerial(chapterId),
    fragmentGroups: await document.fragmentGroups.listBySerial(chapterId),
    fragments,
    readingEdges: await document.readingEdges.listBySerial(chapterId),
    serial: {
      documentOrder: chapterId,
      id: chapterId,
      knowledgeGraphReady: false,
      revision: 0,
      topologyReady: true,
    },
    snakeChunks,
    snakeEdges: await document.snakeEdges.listBySerial(chapterId),
    snakes,
  });
  await writeWikgObjectsToJsonl(
    objectsFile,
    createChapterReadingGraphObjectStream({
      chapterId,
      document,
    }),
  );

  return { file, objectsFile };
}

async function buildChapterSummaryArtifactFromDocumentSnapshot(
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions & {
    readonly sourceDocumentDirectory: Directory;
  },
): Promise<string> {
  const document = await DirectoryDocument.open(
    options.sourceDocumentDirectory,
  );

  try {
    return await buildChapterSummaryArtifactFromDocument(
      createFragmentBackedDocument(document, options.sourceDocumentDirectory),
      chapterId,
      options,
    );
  } finally {
    await document.release();
  }
}

async function buildChapterSummaryArtifactFromDocument(
  document: ReadonlyDocument,
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions,
): Promise<string> {
  const details = await getChapterDetails(document, chapterId);

  if (details.stage !== "graphed") {
    throw new Error(
      `Chapter ${chapterId} is ${details.stage}. Generate a summary only for graphed chapters.`,
    );
  }

  const summary = await document.readSummary(chapterId);

  if (summary !== undefined) {
    return summary;
  }

  return await buildSummaryFromDocument(document, chapterId, options);
}

async function buildSummaryFromSnapshot(
  snapshot: SummaryInputSnapshotData,
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions,
): Promise<string> {
  if (snapshot.serial.id !== chapterId) {
    throw new Error(
      `Summary snapshot belongs to chapter ${snapshot.serial.id}, not chapter ${chapterId}.`,
    );
  }
  if (!snapshot.serial.topologyReady) {
    throw new Error(`Chapter ${chapterId} is not ready for summary.`);
  }

  return await buildSummaryFromReadyDocument(
    new SummaryInputSnapshotDocument(snapshot),
    chapterId,
    options,
  );
}
