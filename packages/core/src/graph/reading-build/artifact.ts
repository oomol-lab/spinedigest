import {
  ensureRelativeDirectory,
  ensureRelativeFile,
} from "../../runtime/platform/index.js";

import type { Document } from "../../document/index.js";
import {
  createFragmentBackedDocument,
  DirectoryDocument,
} from "../../document/index.js";
import {
  getChapterDetails,
  requireStage,
  type ChapterDetails,
} from "../../document/chapter/index.js";
import { SerialGeneration } from "../../serial.js";
import {
  collectReadingGraphObjects,
  createChapterReadingGraphObjectStream,
  readWikgObjectsFromJsonl,
  writeWikgObjectsToJsonl,
} from "../../object-stream.js";
import { replaceChapterFtsIndexArtifact } from "../../retrieval/index-artifact/index.js";
import {
  createGraphBuildParameterInput,
  createTopologyOptions,
} from "./options.js";
import { writeGraphArtifactSourceFragments } from "./source-fragments.js";
import type {
  BuildChapterGraphArtifactOptions,
  ChapterGraphBuildArtifact,
} from "./types.js";

export async function buildChapterGraphArtifact(
  chapterId: number,
  options: BuildChapterGraphArtifactOptions,
): Promise<ChapterGraphBuildArtifact> {
  if ((await options.workspace.getDirectory("graph-document")) !== undefined) {
    await options.workspace.remove("graph-document", { recursive: true });
  }
  const documentDirectory = await ensureRelativeDirectory(
    options.workspace,
    "graph-document",
  );
  const objectsFile = await ensureRelativeFile(
    options.workspace,
    "reading-graph.jsonl",
  );
  const parameter = createGraphBuildParameterInput(options);

  const document = await DirectoryDocument.open(documentDirectory);

  try {
    await document.openSession(async (openedDocument) => {
      await openedDocument.serials.createWithId(chapterId);
      await writeGraphArtifactSourceFragments(
        documentDirectory,
        chapterId,
        options.sourceText,
      );
      const artifactDocument = createFragmentBackedDocument(
        openedDocument,
        documentDirectory,
      );

      await new SerialGeneration({
        document: artifactDocument,
        llm: options.llm,
        ...(options.logDirectory === undefined
          ? {}
          : { logDirectory: options.logDirectory }),
      }).buildTopologyInto(
        chapterId,
        createTopologyOptions(options),
        options.progressTracker,
      );
    });
    await writeWikgObjectsToJsonl(
      objectsFile,
      createChapterReadingGraphObjectStream({
        chapterId,
        document: createFragmentBackedDocument(document, documentDirectory),
        parameter,
      }),
    );
  } finally {
    await document.release();
  }

  return {
    chapterId,
    documentDirectory,
    objectsFile,
    parameter,
  };
}

export async function commitChapterGraphArtifact(
  document: Document,
  artifact: ChapterGraphBuildArtifact,
): Promise<ChapterDetails> {
  const graph = await collectReadingGraphObjects(
    artifact.chapterId,
    readWikgObjectsFromJsonl(artifact.objectsFile),
  );

  await document.openSession(async (openedDocument) => {
    await requireStage(openedDocument, artifact.chapterId, "sourced");
    const hadFtsArtifact =
      (await openedDocument.indexArtifacts.get(artifact.chapterId, "fts")) !==
      undefined;
    await openedDocument.clearSerialReadingGraph(artifact.chapterId);
    await openedDocument.serials.ensure(artifact.chapterId);

    const chunkIdMap = new Map<string, number>();

    for (const chunk of graph.chunks) {
      const createdChunk = await openedDocument.chunks.create({
        content: chunk.content,
        generation: chunk.generation,
        label: chunk.label,
        sentenceId: [artifact.chapterId, chunk.sentenceIndex],
        sentenceIds: chunk.sentenceIndexes.map(
          (sentenceIndex) => [artifact.chapterId, sentenceIndex] as const,
        ),
        weight: chunk.weight,
        wordsCount: chunk.wordsCount,
        ...(chunk.importance === undefined
          ? {}
          : { importance: chunk.importance }),
        ...(chunk.retention === undefined
          ? {}
          : { retention: chunk.retention }),
      });

      chunkIdMap.set(chunk.id, createdChunk.id);
    }

    for (const edge of graph.readingEdges) {
      await openedDocument.readingEdges.save({
        fromId: requireMappedId(chunkIdMap, edge.fromChunkId, "chunk"),
        ...(edge.strength === undefined ? {} : { strength: edge.strength }),
        toId: requireMappedId(chunkIdMap, edge.toChunkId, "chunk"),
        weight: edge.weight,
      });
    }

    await openedDocument.fragmentGroups.saveMany(
      graph.fragmentGroups.map((group) => ({
        endSentenceIndex: group.endSentenceIndex,
        groupId: group.groupId,
        serialId: artifact.chapterId,
        startSentenceIndex: group.startSentenceIndex,
      })),
    );

    const snakeIdMap = new Map<string, number>();

    for (const snake of graph.snakes) {
      const snakeId = await openedDocument.snakes.create({
        firstLabel: snake.firstLabel,
        groupId: snake.groupId,
        lastLabel: snake.lastLabel,
        localSnakeId: snake.localSnakeId,
        serialId: artifact.chapterId,
        size: snake.size,
        weight: snake.weight,
        wordsCount: snake.wordsCount,
      });

      snakeIdMap.set(snake.id, snakeId);
    }

    for (const snakeChunk of graph.snakeChunks) {
      await openedDocument.snakeChunks.save({
        chunkId: requireMappedId(chunkIdMap, snakeChunk.chunkId, "chunk"),
        position: snakeChunk.position,
        snakeId: requireMappedId(snakeIdMap, snakeChunk.snakeId, "snake"),
      });
    }

    for (const edge of graph.snakeEdges) {
      await openedDocument.snakeEdges.save({
        fromSnakeId: requireMappedId(snakeIdMap, edge.fromSnakeId, "snake"),
        toSnakeId: requireMappedId(snakeIdMap, edge.toSnakeId, "snake"),
        weight: edge.weight,
      });
    }

    const parameter = await openedDocument.graphBuildParameters.save(
      graph.parameter ?? artifact.parameter,
    );
    await openedDocument.serials.setTopologyReady(
      artifact.chapterId,
      true,
      parameter.hash,
    );
    if (hadFtsArtifact) {
      await replaceChapterFtsIndexArtifact(openedDocument, artifact.chapterId);
    }
  });

  return await getChapterDetails(document, artifact.chapterId);
}

function requireMappedId(
  ids: ReadonlyMap<string, number>,
  id: string,
  kind: string,
): number {
  const mapped = ids.get(id);
  if (mapped === undefined) {
    throw new Error(`Unknown ${kind} id ${id}.`);
  }
  return mapped;
}
