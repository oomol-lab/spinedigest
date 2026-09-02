import {
  createReadStream,
  createWriteStream,
  readLines,
} from "../../runtime/platform/index.js";
import { mkdir } from "../../runtime/platform/index.js";
import { dirname } from "../../runtime/platform/index.js";
import type { Writable } from "../../runtime/platform/index.js";
import { z } from "zod";

import type {
  IndexArtifactEmbeddingSegment,
  IndexArtifactKind,
  IndexArtifactLexicalRow,
  ReplaceEmbeddingIndexArtifactInput,
  ReplaceFtsIndexArtifactInput,
} from "../../document/index.js";

const INDEX_ARTIFACT_OUTPUT_PROTOCOL = "wikg-index-output/v1";

const indexArtifactKindSchema = z.enum([
  "fts",
  "embedding-source",
  "embedding-summary",
]);

const manifestSchema = z.object({
  artifactKind: indexArtifactKindSchema,
  chapterId: z.number().int().nonnegative(),
  embedding: z
    .object({
      dimensions: z.number().int().nonnegative(),
      identity: z.string().optional(),
      model: z.string(),
    })
    .optional(),
  inputRevision: z.number().int().nonnegative(),
  protocol: z.literal(INDEX_ARTIFACT_OUTPUT_PROTOCOL),
  type: z.literal("manifest"),
});

const lexicalRowSchema = z.object({
  metadata: z.record(z.string(), z.unknown()).optional(),
  objectId: z.string().min(1),
  objectKind: z.string().min(1),
  rowId: z.string().min(1),
  sentenceIndex: z.number().int().nonnegative().optional(),
  text: z.string(),
  tokens: z.array(z.string()),
  type: z.literal("lexical-row"),
});

const embeddingSegmentSchema = z.object({
  endSentenceIndex: z.number().int().nonnegative(),
  segmentIndex: z.number().int().nonnegative(),
  startSentenceIndex: z.number().int().nonnegative(),
  text: z.string(),
  vector: z.array(z.number()),
  wordsCount: z.number().int().nonnegative(),
  type: z.literal("segment"),
});

type IndexArtifactOutputManifest = z.infer<typeof manifestSchema>;

export type IndexArtifactOutput =
  | ReplaceEmbeddingIndexArtifactInput
  | ReplaceFtsIndexArtifactInput;

export async function writeIndexArtifactOutput(
  path: string,
  artifact: IndexArtifactOutput,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const stream = createWriteStream(path, { encoding: "utf8", flags: "w" });

  await writeIndexArtifactOutputToStream(stream, artifact);
}

export async function writeIndexArtifactOutputToStream(
  stream: Writable,
  artifact: IndexArtifactOutput,
): Promise<void> {
  const streamErrors = createWritableStreamErrorTracker(stream);

  try {
    const manifest = createOutputManifest(artifact);

    await writeJSONLRecord(stream, streamErrors, manifest);
    if ("lexicalRows" in artifact) {
      for (const row of artifact.lexicalRows) {
        await writeJSONLRecord(stream, streamErrors, {
          type: "lexical-row",
          ...omitEmptyMetadata(row),
        });
      }
      return;
    }

    for (const segment of artifact.segments) {
      await writeJSONLRecord(stream, streamErrors, {
        type: "segment",
        ...segment,
      });
    }
  } finally {
    try {
      await closeWritableStream(stream, streamErrors);
    } finally {
      await waitForPendingWritableStreamErrors();
      streamErrors.dispose();
    }
  }
}

export async function readIndexArtifactOutput(
  path: string,
): Promise<IndexArtifactOutput> {
  const lines = readLines(createReadStream(path, { encoding: "utf8" }));
  let manifest: IndexArtifactOutputManifest | undefined;
  const lexicalRows: IndexArtifactLexicalRow[] = [];
  const segments: IndexArtifactEmbeddingSegment[] = [];
  let lineNumber = 0;

  for await (const line of lines) {
    lineNumber += 1;
    if (line.trim() === "") {
      continue;
    }

    let record: unknown;

    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid index artifact JSONL at ${path}:${lineNumber}`, {
        cause: error,
      });
    }

    if (manifest === undefined) {
      manifest = parseOutputManifest(record, path, lineNumber);
      continue;
    }

    if (isFtsOutputManifest(manifest)) {
      lexicalRows.push(parseLexicalRow(record, path, lineNumber));
      continue;
    }

    segments.push(parseEmbeddingSegment(record, path, lineNumber));
  }

  if (manifest === undefined) {
    throw new Error(`Index artifact output ${path} has no manifest.`);
  }

  if (isFtsOutputManifest(manifest)) {
    return {
      lexicalRows,
      serialId: manifest.chapterId,
      sourceRevision: manifest.inputRevision,
    };
  }

  assertEmbeddingManifest(manifest);
  assertEmbeddingSegmentsMatchManifest(manifest, segments);

  return {
    kind: manifest.artifactKind,
    metadata: {
      dimensions: manifest.embedding.dimensions,
      ...(manifest.embedding.identity === undefined
        ? {}
        : { identity: manifest.embedding.identity }),
      model: manifest.embedding.model,
      version: 1,
    },
    segments,
    serialId: manifest.chapterId,
    sourceRevision: manifest.inputRevision,
  };
}

function createOutputManifest(
  artifact: IndexArtifactOutput,
): IndexArtifactOutputManifest {
  if ("lexicalRows" in artifact) {
    return {
      artifactKind: "fts",
      chapterId: artifact.serialId,
      inputRevision: artifact.sourceRevision,
      protocol: INDEX_ARTIFACT_OUTPUT_PROTOCOL,
      type: "manifest",
    };
  }

  const dimensions = readNonNegativeIntegerMetadata(
    artifact.metadata,
    "dimensions",
  );
  const model = readRequiredStringMetadata(artifact.metadata, "model");
  const identity = readStringMetadata(artifact.metadata, "identity");

  return {
    artifactKind: artifact.kind,
    chapterId: artifact.serialId,
    embedding: {
      dimensions,
      ...(identity === undefined ? {} : { identity }),
      model,
    },
    inputRevision: artifact.sourceRevision,
    protocol: INDEX_ARTIFACT_OUTPUT_PROTOCOL,
    type: "manifest",
  };
}

function parseOutputManifest(
  record: unknown,
  path: string,
  lineNumber: number,
): IndexArtifactOutputManifest {
  try {
    const manifest = manifestSchema.parse(record);

    if (manifest.artifactKind === "fts" && manifest.embedding !== undefined) {
      throw new Error("FTS output manifest must not include embedding data.");
    }
    if (manifest.artifactKind !== "fts" && manifest.embedding === undefined) {
      throw new Error("Embedding output manifest must include embedding data.");
    }

    return manifest;
  } catch (error) {
    throw new Error(
      `Invalid index artifact output manifest at ${path}:${lineNumber}`,
      { cause: error },
    );
  }
}

function parseLexicalRow(
  record: unknown,
  path: string,
  lineNumber: number,
): IndexArtifactLexicalRow {
  try {
    const parsed = lexicalRowSchema.parse(record);

    return {
      metadata: parsed.metadata ?? {},
      objectId: parsed.objectId,
      objectKind: parsed.objectKind,
      rowId: parsed.rowId,
      ...(parsed.sentenceIndex === undefined
        ? {}
        : { sentenceIndex: parsed.sentenceIndex }),
      text: parsed.text,
      tokens: parsed.tokens,
    };
  } catch (error) {
    throw new Error(
      `Invalid index artifact lexical row at ${path}:${lineNumber}`,
      { cause: error },
    );
  }
}

function parseEmbeddingSegment(
  record: unknown,
  path: string,
  lineNumber: number,
): IndexArtifactEmbeddingSegment {
  try {
    const parsed = embeddingSegmentSchema.parse(record);

    if (parsed.endSentenceIndex < parsed.startSentenceIndex) {
      throw new Error(`Segment ${parsed.segmentIndex} ends before it starts.`);
    }

    return {
      endSentenceIndex: parsed.endSentenceIndex,
      segmentIndex: parsed.segmentIndex,
      startSentenceIndex: parsed.startSentenceIndex,
      text: parsed.text,
      vector: parsed.vector,
      wordsCount: parsed.wordsCount,
    };
  } catch (error) {
    throw new Error(
      `Invalid index artifact embedding segment at ${path}:${lineNumber}`,
      { cause: error },
    );
  }
}

function assertEmbeddingManifest(
  manifest: IndexArtifactOutputManifest,
): asserts manifest is IndexArtifactOutputManifest & {
  readonly artifactKind: "embedding-source" | "embedding-summary";
  readonly embedding: {
    readonly dimensions: number;
    readonly identity?: string;
    readonly model: string;
  };
} {
  if (manifest.artifactKind === "fts" || manifest.embedding === undefined) {
    throw new Error("Expected an embedding index artifact output manifest.");
  }
}

function assertEmbeddingSegmentsMatchManifest(
  manifest: IndexArtifactOutputManifest & {
    readonly embedding: { readonly dimensions: number };
  },
  segments: readonly IndexArtifactEmbeddingSegment[],
): void {
  const segmentIndexes = new Set<number>();

  for (const segment of segments) {
    if (segmentIndexes.has(segment.segmentIndex)) {
      throw new Error(`Duplicate embedding segment ${segment.segmentIndex}.`);
    }
    if (segment.vector.length !== manifest.embedding.dimensions) {
      throw new Error(
        `Embedding segment ${segment.segmentIndex} has ${segment.vector.length} dimensions; expected ${manifest.embedding.dimensions}.`,
      );
    }
    segmentIndexes.add(segment.segmentIndex);
  }
}

function isFtsOutputManifest(manifest: {
  readonly artifactKind: IndexArtifactKind;
}): boolean {
  return manifest.artifactKind === "fts";
}

function readNonNegativeIntegerMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number {
  const value = metadata?.[key];

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  throw new Error(
    `Embedding index artifact metadata ${key} must be a nonnegative integer.`,
  );
}

function readStringMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];

  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }

  throw new Error(`Embedding index artifact metadata ${key} must be a string.`);
}

function readRequiredStringMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string {
  const value = readStringMetadata(metadata, key);

  if (value !== undefined) {
    return value;
  }

  throw new Error(`Embedding index artifact metadata is missing ${key}.`);
}

function omitEmptyMetadata<T extends { readonly metadata: unknown }>(
  record: T,
): Omit<T, "metadata"> | T {
  if (
    record.metadata !== undefined &&
    typeof record.metadata === "object" &&
    record.metadata !== null &&
    Object.keys(record.metadata).length === 0
  ) {
    const { metadata: _metadata, ...rest } = record;

    return rest;
  }

  return record;
}

function createWritableStreamErrorTracker(stream: Writable): {
  readonly dispose: () => void;
  readonly race: <T>(operation: Promise<T>) => Promise<T>;
} {
  let streamError: Error | undefined;
  const waiters = new Set<(error: Error) => void>();
  const onError = (error: Error) => {
    streamError ??= error;
    for (const reject of waiters) {
      reject(streamError);
    }
  };

  stream.on("error", onError);

  return {
    dispose() {
      stream.off("error", onError);
      waiters.clear();
    },
    race<T>(operation: Promise<T>): Promise<T> {
      if (streamError !== undefined) {
        return Promise.reject(streamError);
      }

      return new Promise<T>((resolve, reject) => {
        const rejectOnStreamError = (error: Error) => reject(error);
        const cleanup = () => {
          waiters.delete(rejectOnStreamError);
        };

        waiters.add(rejectOnStreamError);
        operation.then(
          (value) => {
            cleanup();
            resolve(value);
          },
          (error: unknown) => {
            cleanup();
            reject(toError(error));
          },
        );
      });
    },
  };
}

async function closeWritableStream(
  stream: Writable,
  streamErrors: ReturnType<typeof createWritableStreamErrorTracker>,
): Promise<void> {
  if (stream.closed) {
    return;
  }

  const closePromise = waitForWritableStreamClose(stream);

  if (stream.destroyed) {
    await streamErrors.race(closePromise);
    return;
  }

  await streamErrors.race(
    new Promise<void>((resolveClose, rejectClose) => {
      try {
        stream.end((error?: Error | null) => {
          if (error !== undefined && error !== null) {
            rejectClose(error);
            return;
          }

          resolveClose();
        });
      } catch (error) {
        rejectClose(toError(error));
      }
    }),
  );

  await streamErrors.race(closePromise);
}

function waitForWritableStreamClose(stream: Writable): Promise<void> {
  if (stream.closed) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    stream.once("close", resolve);
  });
}

function waitForPendingWritableStreamErrors(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

async function writeJSONLRecord(
  stream: Writable,
  streamErrors: ReturnType<typeof createWritableStreamErrorTracker>,
  record: unknown,
): Promise<void> {
  await streamErrors.race(
    new Promise<void>((resolveWrite, rejectWrite) => {
      let drainDone = false;
      let needsDrain = false;
      let settled = false;
      let writeDone = false;

      const cleanup = () => {
        stream.off("drain", onDrain);
      };
      const settle = (error?: Error | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error !== undefined && error !== null) {
          rejectWrite(error);
          return;
        }
        resolveWrite();
      };
      const maybeSettle = () => {
        if (writeDone && (!needsDrain || drainDone)) {
          settle();
        }
      };
      const onDrain = () => {
        drainDone = true;
        maybeSettle();
      };

      const canContinue = stream.write(
        `${JSON.stringify(record)}\n`,
        (error: any) => {
          if (error !== undefined && error !== null) {
            settle(error);
            return;
          }
          writeDone = true;
          maybeSettle();
        },
      );
      if (!canContinue) {
        needsDrain = true;
        stream.once("drain", onDrain);
      }
    }),
  );
}
