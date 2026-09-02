import { type WritableStream } from "./runtime/platform/index.js";
import {
  createReadStream,
  createWriteStream,
  readLines,
} from "./runtime/platform/index.js";
import { z } from "zod";

import type {
  ChunkRecord,
  FragmentRecord,
  GraphBuildParameterRecord,
  MentionLinkRecord,
  MentionRecord,
  ReadonlyDocument,
  ReadingEdgeRecord,
  SentenceGroupRecord,
  SentenceId,
  SentenceRecord,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
} from "./document/index.js";
import { ChunkImportance, ChunkRetention } from "./document/types.js";
import { readSerialFragments } from "./text/summary-build/source.js";
import type { SummaryInputSnapshotData } from "./text/summary-build/types.js";

export const WIKG_OBJECT_SCHEMA_VERSION = 1;

export type WikgObject =
  | WikgMetaObject
  | WikgParameterObject
  | WikgSourceFragmentObject
  | WikgReadingChunkObject
  | WikgReadingEdgeObject
  | WikgFragmentGroupObject
  | WikgSnakeObject
  | WikgSnakeChunkObject
  | WikgSnakeEdgeObject
  | WikgSummaryObject
  | WikgMentionObject
  | WikgMentionLinkObject
  | WikgEndObject;

export interface WikgMetaObject {
  readonly type: "meta";
  readonly schemaVersion: typeof WIKG_OBJECT_SCHEMA_VERSION;
  readonly chapterId: number;
  readonly stream: "knowledge-graph" | "reading-graph" | "summary";
}

export interface WikgParameterObject {
  readonly type: "parameter";
  readonly scope: "knowledge-graph" | "reading-graph" | "summary";
  readonly language?: string;
  readonly prompt: string;
}

export interface WikgSourceFragmentObject {
  readonly type: "source-fragment";
  readonly fragmentId: number;
  readonly summary: string;
  readonly sentences: readonly SentenceRecord[];
}

export interface WikgReadingChunkObject {
  readonly type: "reading-chunk";
  readonly id: string;
  readonly generation: number;
  readonly sentenceIndex: number;
  readonly label: string;
  readonly content: string;
  readonly sentenceIndexes: readonly number[];
  readonly retention?: ChunkRetention;
  readonly importance?: ChunkImportance;
  readonly wordsCount: number;
  readonly weight: number;
}

export interface WikgReadingEdgeObject {
  readonly type: "reading-edge";
  readonly fromChunkId: string;
  readonly toChunkId: string;
  readonly strength?: string;
  readonly weight: number;
}

export interface WikgFragmentGroupObject {
  readonly type: "fragment-group";
  readonly groupId: number;
  readonly startSentenceIndex: number;
  readonly endSentenceIndex: number;
}

export interface WikgSnakeObject {
  readonly type: "snake";
  readonly id: string;
  readonly groupId: number;
  readonly localSnakeId: number;
  readonly size: number;
  readonly firstLabel: string;
  readonly lastLabel: string;
  readonly wordsCount: number;
  readonly weight: number;
}

export interface WikgSnakeChunkObject {
  readonly type: "snake-chunk";
  readonly snakeId: string;
  readonly chunkId: string;
  readonly position: number;
}

export interface WikgSnakeEdgeObject {
  readonly type: "snake-edge";
  readonly fromSnakeId: string;
  readonly toSnakeId: string;
  readonly weight: number;
}

export interface WikgSummaryObject {
  readonly type: "summary";
  readonly text: string;
}

export interface WikgMentionObject {
  readonly type: "mention";
  readonly id: string;
  readonly fragmentId?: number;
  readonly sentenceIndex?: number;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly surface: string;
  readonly qid: string;
  readonly confidence?: number;
  readonly note?: string;
}

export interface WikgMentionLinkObject {
  readonly type: "mention-link";
  readonly id: string;
  readonly sourceMentionId: string;
  readonly targetMentionId: string;
  readonly predicate: string;
  readonly evidenceSentenceIndexes: readonly number[];
  readonly confidence?: number;
  readonly note?: string;
}

export interface WikgEndObject {
  readonly type: "end";
}

export interface ChapterKnowledgeGraphObjects {
  readonly mentionLinks: readonly MentionLinkRecord[];
  readonly mentions: readonly MentionRecord[];
  readonly parameter?: WikgParameterObject;
}

const nonNegativeIntegerSchema = z.number().int().nonnegative();
const positiveSchemaVersionSchema = z.literal(WIKG_OBJECT_SCHEMA_VERSION);
const qidSchema = z.string().regex(/^Q[1-9][0-9]*$/u);
const optionalConfidenceSchema = z.number().min(0).max(1).optional();
const sentenceRecordSchema = z
  .object({
    text: z.string(),
    wordsCount: nonNegativeIntegerSchema,
  })
  .strict();

const metaObjectSchema = z
  .object({
    type: z.literal("meta"),
    schemaVersion: positiveSchemaVersionSchema,
    chapterId: z.number().int(),
    stream: z.enum(["knowledge-graph", "reading-graph", "summary"]),
  })
  .strict();
const parameterObjectSchema = z
  .object({
    type: z.literal("parameter"),
    scope: z.enum(["knowledge-graph", "reading-graph", "summary"]),
    language: z.string().optional(),
    prompt: z.string(),
  })
  .strict();
const sourceFragmentObjectSchema = z
  .object({
    type: z.literal("source-fragment"),
    fragmentId: nonNegativeIntegerSchema,
    summary: z.string(),
    sentences: z.array(sentenceRecordSchema),
  })
  .strict();
const readingChunkObjectSchema = z
  .object({
    type: z.literal("reading-chunk"),
    id: z.string().min(1),
    generation: z.number().int(),
    sentenceIndex: nonNegativeIntegerSchema,
    label: z.string(),
    content: z.string(),
    sentenceIndexes: z.array(nonNegativeIntegerSchema).min(1),
    retention: z.enum(ChunkRetention).optional(),
    importance: z.enum(ChunkImportance).optional(),
    wordsCount: nonNegativeIntegerSchema,
    weight: z.number(),
  })
  .strict();
const readingEdgeObjectSchema = z
  .object({
    type: z.literal("reading-edge"),
    fromChunkId: z.string().min(1),
    toChunkId: z.string().min(1),
    strength: z.string().optional(),
    weight: z.number(),
  })
  .strict();
const fragmentGroupObjectSchema = z
  .object({
    type: z.literal("fragment-group"),
    groupId: nonNegativeIntegerSchema,
    startSentenceIndex: nonNegativeIntegerSchema,
    endSentenceIndex: nonNegativeIntegerSchema,
  })
  .strict();
const snakeObjectSchema = z
  .object({
    type: z.literal("snake"),
    id: z.string().min(1),
    groupId: nonNegativeIntegerSchema,
    localSnakeId: nonNegativeIntegerSchema,
    size: nonNegativeIntegerSchema,
    firstLabel: z.string(),
    lastLabel: z.string(),
    wordsCount: nonNegativeIntegerSchema,
    weight: z.number(),
  })
  .strict();
const snakeChunkObjectSchema = z
  .object({
    type: z.literal("snake-chunk"),
    snakeId: z.string().min(1),
    chunkId: z.string().min(1),
    position: nonNegativeIntegerSchema,
  })
  .strict();
const snakeEdgeObjectSchema = z
  .object({
    type: z.literal("snake-edge"),
    fromSnakeId: z.string().min(1),
    toSnakeId: z.string().min(1),
    weight: z.number(),
  })
  .strict();
const summaryObjectSchema = z
  .object({
    type: z.literal("summary"),
    text: z.string(),
  })
  .strict();
const mentionObjectSchema = z
  .object({
    type: z.literal("mention"),
    id: z.string().min(1),
    fragmentId: nonNegativeIntegerSchema.optional(),
    sentenceIndex: nonNegativeIntegerSchema.optional(),
    rangeStart: nonNegativeIntegerSchema,
    rangeEnd: nonNegativeIntegerSchema,
    surface: z.string().min(1),
    qid: qidSchema,
    confidence: optionalConfidenceSchema,
    note: z.string().optional(),
  })
  .strict();
const mentionLinkObjectSchema = z
  .object({
    type: z.literal("mention-link"),
    id: z.string().min(1),
    sourceMentionId: z.string().min(1),
    targetMentionId: z.string().min(1),
    predicate: z.string().min(1),
    evidenceSentenceIndexes: z.array(nonNegativeIntegerSchema).min(1),
    confidence: optionalConfidenceSchema,
    note: z.string().optional(),
  })
  .strict();
const endObjectSchema = z
  .object({
    type: z.literal("end"),
  })
  .strict();

const wikgObjectSchema = z.discriminatedUnion("type", [
  metaObjectSchema,
  parameterObjectSchema,
  sourceFragmentObjectSchema,
  readingChunkObjectSchema,
  readingEdgeObjectSchema,
  fragmentGroupObjectSchema,
  snakeObjectSchema,
  snakeChunkObjectSchema,
  snakeEdgeObjectSchema,
  summaryObjectSchema,
  mentionObjectSchema,
  mentionLinkObjectSchema,
  endObjectSchema,
]);

export function parseWikgObject(record: unknown): WikgObject {
  return wikgObjectSchema.parse(record) as WikgObject;
}

export async function writeWikgObjectsToJsonl(
  path: string,
  objects: AsyncIterable<WikgObject> | Iterable<WikgObject>,
): Promise<void> {
  const stream = createWriteStream(path, { encoding: "utf8", flags: "wx" });

  try {
    for await (const object of objects) {
      await writeLine(stream, `${JSON.stringify(parseWikgObject(object))}\n`);
    }
  } finally {
    await closeWritableStream(stream);
  }
}

export async function* readWikgObjectsFromJsonl(
  path: string,
): AsyncGenerator<WikgObject> {
  const lines = readLines(createReadStream(path, { encoding: "utf8" }));
  let lineNumber = 0;

  for await (const line of lines) {
    lineNumber += 1;
    if (line.trim() === "") {
      continue;
    }

    try {
      yield parseWikgObject(JSON.parse(line));
    } catch (error) {
      throw new Error(
        `Invalid WikgObject JSONL record at ${path}:${lineNumber}`,
        {
          cause: error,
        },
      );
    }
  }
}

export async function* createChapterKnowledgeGraphObjectStream(input: {
  readonly chapterId: number;
  readonly mentionLinks:
    | AsyncIterable<MentionLinkRecord>
    | Iterable<MentionLinkRecord>;
  readonly mentions: AsyncIterable<MentionRecord> | Iterable<MentionRecord>;
  readonly parameter?: { readonly language?: string; readonly prompt: string };
}): AsyncGenerator<WikgObject> {
  yield {
    chapterId: input.chapterId,
    schemaVersion: WIKG_OBJECT_SCHEMA_VERSION,
    stream: "knowledge-graph",
    type: "meta",
  };
  if (input.parameter !== undefined) {
    yield {
      ...(input.parameter.language === undefined
        ? {}
        : { language: input.parameter.language }),
      prompt: input.parameter.prompt,
      scope: "knowledge-graph",
      type: "parameter",
    };
  }
  for await (const mention of input.mentions) {
    if (mention.chapterId !== input.chapterId) {
      throw new Error(
        `Mention ${mention.id} belongs to chapter ${mention.chapterId}, expected chapter ${input.chapterId}.`,
      );
    }
    yield mentionRecordToObject(mention);
  }
  for await (const link of input.mentionLinks) {
    yield mentionLinkRecordToObject(input.chapterId, link);
  }
  yield { type: "end" };
}

export async function collectChapterKnowledgeGraphObjects(
  chapterId: number,
  objects: AsyncIterable<WikgObject> | Iterable<WikgObject>,
): Promise<ChapterKnowledgeGraphObjects> {
  const mentions: MentionRecord[] = [];
  const mentionLinks: MentionLinkRecord[] = [];
  let parameter: WikgParameterObject | undefined;
  let sawMeta = false;
  let sawEnd = false;

  for await (const object of objects) {
    switch (object.type) {
      case "meta":
        if (object.chapterId !== chapterId) {
          throw new Error(
            `WikgObject stream belongs to chapter ${object.chapterId}, expected chapter ${chapterId}.`,
          );
        }
        if (object.stream !== "knowledge-graph") {
          throw new Error(
            `Expected knowledge-graph stream, received ${object.stream}.`,
          );
        }
        sawMeta = true;
        break;
      case "parameter":
        if (object.scope === "knowledge-graph") {
          parameter = object;
        }
        break;
      case "mention":
        mentions.push(mentionObjectToRecord(chapterId, object));
        break;
      case "mention-link":
        mentionLinks.push(mentionLinkObjectToRecord(chapterId, object));
        break;
      case "end":
        sawEnd = true;
        break;
      default:
        throw new Error(
          `Unexpected ${object.type} record in knowledge graph stream.`,
        );
    }
  }
  if (!sawMeta) {
    throw new Error("WikgObject stream is missing a meta record.");
  }
  if (!sawEnd) {
    throw new Error("WikgObject stream is missing an end record.");
  }

  return {
    mentionLinks,
    mentions,
    ...(parameter === undefined ? {} : { parameter }),
  };
}

export async function* createChapterReadingGraphObjectStream(input: {
  readonly chapterId: number;
  readonly document: ReadonlyDocument;
  readonly parameter?: { readonly language?: string; readonly prompt: string };
}): AsyncGenerator<WikgObject> {
  yield {
    chapterId: input.chapterId,
    schemaVersion: WIKG_OBJECT_SCHEMA_VERSION,
    stream: "reading-graph",
    type: "meta",
  };
  if (input.parameter !== undefined) {
    yield {
      ...(input.parameter.language === undefined
        ? {}
        : { language: input.parameter.language }),
      prompt: input.parameter.prompt,
      scope: "reading-graph",
      type: "parameter",
    };
  }

  for (const fragment of await readSerialFragments(
    input.document,
    input.chapterId,
  )) {
    yield sourceFragmentRecordToObject(fragment);
  }

  const chunkIds = new Map<number, string>();
  let chunkIndex = 0;
  for (const chunk of await input.document.chunks.listBySerial(
    input.chapterId,
  )) {
    const id = `chunk-${chunkIndex}`;
    chunkIndex += 1;
    chunkIds.set(chunk.id, id);
    yield chunkRecordToObject(input.chapterId, id, chunk);
  }

  for (const edge of await input.document.readingEdges.listBySerial(
    input.chapterId,
  )) {
    const fromChunkId = chunkIds.get(edge.fromId);
    const toChunkId = chunkIds.get(edge.toId);
    if (fromChunkId === undefined || toChunkId === undefined) {
      continue;
    }
    yield readingEdgeRecordToObject(fromChunkId, toChunkId, edge);
  }

  for (const group of await input.document.fragmentGroups.listBySerial(
    input.chapterId,
  )) {
    yield fragmentGroupRecordToObject(group);
  }

  const snakeIds = new Map<number, string>();
  let snakeIndex = 0;
  const snakes = await input.document.snakes.listBySerial(input.chapterId);
  for (const snake of snakes) {
    const id = `snake-${snakeIndex}`;
    snakeIndex += 1;
    snakeIds.set(snake.id, id);
    yield snakeRecordToObject(id, snake);

    for (const snakeChunk of await input.document.snakeChunks.listBySnake(
      snake.id,
    )) {
      const chunkId = chunkIds.get(snakeChunk.chunkId);
      if (chunkId === undefined) {
        continue;
      }
      yield {
        chunkId,
        position: snakeChunk.position,
        snakeId: id,
        type: "snake-chunk",
      };
    }
  }

  for (const edge of await input.document.snakeEdges.listBySerial(
    input.chapterId,
  )) {
    const fromSnakeId = snakeIds.get(edge.fromSnakeId);
    const toSnakeId = snakeIds.get(edge.toSnakeId);
    if (fromSnakeId === undefined || toSnakeId === undefined) {
      continue;
    }
    yield {
      fromSnakeId,
      toSnakeId,
      type: "snake-edge",
      weight: edge.weight,
    };
  }
  yield { type: "end" };
}

export async function collectReadingGraphObjects(
  chapterId: number,
  objects: AsyncIterable<WikgObject> | Iterable<WikgObject>,
): Promise<{
  readonly chunks: readonly WikgReadingChunkObject[];
  readonly fragmentGroups: readonly WikgFragmentGroupObject[];
  readonly fragments: readonly FragmentRecord[];
  readonly parameter?: WikgParameterObject;
  readonly readingEdges: readonly WikgReadingEdgeObject[];
  readonly snakeChunks: readonly WikgSnakeChunkObject[];
  readonly snakeEdges: readonly WikgSnakeEdgeObject[];
  readonly snakes: readonly WikgSnakeObject[];
}> {
  const chunks: WikgReadingChunkObject[] = [];
  const fragmentGroups: WikgFragmentGroupObject[] = [];
  const fragments: FragmentRecord[] = [];
  const readingEdges: WikgReadingEdgeObject[] = [];
  const snakeChunks: WikgSnakeChunkObject[] = [];
  const snakeEdges: WikgSnakeEdgeObject[] = [];
  const snakes: WikgSnakeObject[] = [];
  let parameter: WikgParameterObject | undefined;
  let sawMeta = false;
  let sawEnd = false;

  for await (const object of objects) {
    switch (object.type) {
      case "meta":
        if (object.chapterId !== chapterId) {
          throw new Error(
            `WikgObject stream belongs to chapter ${object.chapterId}, expected chapter ${chapterId}.`,
          );
        }
        if (object.stream !== "reading-graph") {
          throw new Error(
            `Expected reading-graph stream, received ${object.stream}.`,
          );
        }
        sawMeta = true;
        break;
      case "parameter":
        if (object.scope === "reading-graph") {
          parameter = object;
        }
        break;
      case "source-fragment":
        fragments.push(sourceFragmentObjectToRecord(chapterId, object));
        break;
      case "reading-chunk":
        chunks.push(object);
        break;
      case "reading-edge":
        readingEdges.push(object);
        break;
      case "fragment-group":
        fragmentGroups.push(object);
        break;
      case "snake":
        snakes.push(object);
        break;
      case "snake-chunk":
        snakeChunks.push(object);
        break;
      case "snake-edge":
        snakeEdges.push(object);
        break;
      case "end":
        sawEnd = true;
        break;
      default:
        throw new Error(
          `Unexpected ${object.type} record in reading graph stream.`,
        );
    }
  }
  if (!sawMeta) {
    throw new Error("WikgObject stream is missing a meta record.");
  }
  if (!sawEnd) {
    throw new Error("WikgObject stream is missing an end record.");
  }

  validateReadingGraphReferences({
    chunks,
    readingEdges,
    snakeChunks,
    snakeEdges,
    snakes,
  });

  return {
    chunks,
    fragmentGroups,
    fragments,
    ...(parameter === undefined ? {} : { parameter }),
    readingEdges,
    snakeChunks,
    snakeEdges,
    snakes,
  };
}

export async function createSummaryInputSnapshotFromReadingGraphObjects(
  chapterId: number,
  objects: AsyncIterable<WikgObject> | Iterable<WikgObject>,
): Promise<SummaryInputSnapshotData> {
  const graph = await collectReadingGraphObjects(chapterId, objects);
  const chunkIdMap = new Map<string, number>();
  const snakeIdMap = new Map<string, number>();
  const chunks = graph.chunks.map((chunk, index) => {
    const id = index + 1;
    chunkIdMap.set(chunk.id, id);
    return readingChunkObjectToRecord(chapterId, id, chunk);
  });
  const snakes = graph.snakes.map((snake, index) => {
    const id = index + 1;
    snakeIdMap.set(snake.id, id);
    return snakeObjectToRecord(chapterId, id, snake);
  });

  return {
    chunks,
    fragmentGroups: graph.fragmentGroups.map((group) =>
      fragmentGroupObjectToRecord(chapterId, group),
    ),
    fragments: graph.fragments,
    readingEdges: graph.readingEdges.map((edge) =>
      readingEdgeObjectToRecord(chunkIdMap, edge),
    ),
    serial: {
      documentOrder: chapterId,
      id: chapterId,
      knowledgeGraphReady: false,
      revision: 0,
      topologyReady: true,
    },
    snakeChunks: graph.snakeChunks.map((snakeChunk) =>
      snakeChunkObjectToRecord(chunkIdMap, snakeIdMap, snakeChunk),
    ),
    snakeEdges: graph.snakeEdges.map((edge) =>
      snakeEdgeObjectToRecord(snakeIdMap, edge),
    ),
    snakes,
  };
}

export function graphParameterRecordToObject(
  scope: WikgParameterObject["scope"],
  parameter: Pick<GraphBuildParameterRecord, "language" | "prompt">,
): WikgParameterObject {
  return {
    ...(parameter.language === undefined
      ? {}
      : { language: parameter.language }),
    prompt: parameter.prompt,
    scope,
    type: "parameter",
  };
}

function mentionRecordToObject(record: MentionRecord): WikgMentionObject {
  return {
    ...(record.confidence === undefined
      ? {}
      : { confidence: record.confidence }),
    ...(record.fragmentId === undefined
      ? {}
      : { fragmentId: record.fragmentId }),
    id: record.id,
    ...(record.note === undefined ? {} : { note: record.note }),
    qid: record.qid,
    rangeEnd: record.rangeEnd,
    rangeStart: record.rangeStart,
    ...(record.sentenceIndex === undefined
      ? {}
      : { sentenceIndex: record.sentenceIndex }),
    surface: record.surface,
    type: "mention",
  };
}

function mentionObjectToRecord(
  chapterId: number,
  object: WikgMentionObject,
): MentionRecord {
  return {
    chapterId,
    ...(object.confidence === undefined
      ? {}
      : { confidence: object.confidence }),
    ...(object.fragmentId === undefined
      ? {}
      : { fragmentId: object.fragmentId }),
    id: object.id,
    ...(object.note === undefined ? {} : { note: object.note }),
    qid: object.qid,
    rangeEnd: object.rangeEnd,
    rangeStart: object.rangeStart,
    ...(object.sentenceIndex === undefined
      ? {}
      : { sentenceIndex: object.sentenceIndex }),
    surface: object.surface,
  };
}

function mentionLinkRecordToObject(
  chapterId: number,
  record: MentionLinkRecord,
): WikgMentionLinkObject {
  return {
    ...(record.confidence === undefined
      ? {}
      : { confidence: record.confidence }),
    evidenceSentenceIndexes: record.evidenceSentenceIds.map((sentenceId) => {
      if (sentenceId[0] !== chapterId) {
        throw new Error(
          `Mention link ${record.id} evidence sentence ${formatSentenceId(sentenceId)} is outside chapter ${chapterId}.`,
        );
      }
      return sentenceId[1];
    }),
    id: record.id,
    ...(record.note === undefined ? {} : { note: record.note }),
    predicate: record.predicate,
    sourceMentionId: record.sourceMentionId,
    targetMentionId: record.targetMentionId,
    type: "mention-link",
  };
}

function mentionLinkObjectToRecord(
  chapterId: number,
  object: WikgMentionLinkObject,
): MentionLinkRecord {
  return {
    ...(object.confidence === undefined
      ? {}
      : { confidence: object.confidence }),
    evidenceSentenceIds: object.evidenceSentenceIndexes.map(
      (sentenceIndex) => [chapterId, sentenceIndex] as const,
    ),
    id: object.id,
    ...(object.note === undefined ? {} : { note: object.note }),
    predicate: object.predicate,
    sourceMentionId: object.sourceMentionId,
    targetMentionId: object.targetMentionId,
  };
}

function sourceFragmentRecordToObject(
  record: FragmentRecord,
): WikgSourceFragmentObject {
  return {
    fragmentId: record.fragmentId,
    sentences: record.sentences.map((sentence) => ({
      text: sentence.text,
      wordsCount: sentence.wordsCount,
    })),
    summary: record.summary,
    type: "source-fragment",
  };
}

function sourceFragmentObjectToRecord(
  chapterId: number,
  object: WikgSourceFragmentObject,
): FragmentRecord {
  return {
    fragmentId: object.fragmentId,
    sentences: object.sentences,
    serialId: chapterId,
    summary: object.summary,
  };
}

function chunkRecordToObject(
  chapterId: number,
  id: string,
  record: ChunkRecord,
): WikgReadingChunkObject {
  return {
    content: record.content,
    generation: record.generation,
    id,
    ...(record.importance === undefined
      ? {}
      : { importance: record.importance }),
    label: record.label,
    ...(record.retention === undefined ? {} : { retention: record.retention }),
    sentenceIndex: requireLocalSentenceIndex(chapterId, record.sentenceId),
    sentenceIndexes: record.sentenceIds.map((sentenceId) =>
      requireLocalSentenceIndex(chapterId, sentenceId),
    ),
    type: "reading-chunk",
    weight: record.weight,
    wordsCount: record.wordsCount,
  };
}

function readingChunkObjectToRecord(
  chapterId: number,
  id: number,
  object: WikgReadingChunkObject,
): ChunkRecord {
  return {
    content: object.content,
    generation: object.generation,
    id,
    ...(object.importance === undefined
      ? {}
      : { importance: object.importance }),
    label: object.label,
    ...(object.retention === undefined ? {} : { retention: object.retention }),
    sentenceId: [chapterId, object.sentenceIndex],
    sentenceIds: object.sentenceIndexes.map(
      (sentenceIndex) => [chapterId, sentenceIndex] as const,
    ),
    weight: object.weight,
    wordsCount: object.wordsCount,
  };
}

function readingEdgeRecordToObject(
  fromChunkId: string,
  toChunkId: string,
  record: ReadingEdgeRecord,
): WikgReadingEdgeObject {
  return {
    fromChunkId,
    ...(record.strength === undefined ? {} : { strength: record.strength }),
    toChunkId,
    type: "reading-edge",
    weight: record.weight,
  };
}

function readingEdgeObjectToRecord(
  chunkIdMap: ReadonlyMap<string, number>,
  object: WikgReadingEdgeObject,
): ReadingEdgeRecord {
  return {
    fromId: requireMappedId(chunkIdMap, object.fromChunkId, "chunk"),
    ...(object.strength === undefined ? {} : { strength: object.strength }),
    toId: requireMappedId(chunkIdMap, object.toChunkId, "chunk"),
    weight: object.weight,
  };
}

function fragmentGroupRecordToObject(
  record: SentenceGroupRecord,
): WikgFragmentGroupObject {
  return {
    endSentenceIndex: record.endSentenceIndex,
    groupId: record.groupId,
    startSentenceIndex: record.startSentenceIndex,
    type: "fragment-group",
  };
}

function fragmentGroupObjectToRecord(
  chapterId: number,
  object: WikgFragmentGroupObject,
): SentenceGroupRecord {
  return {
    endSentenceIndex: object.endSentenceIndex,
    groupId: object.groupId,
    serialId: chapterId,
    startSentenceIndex: object.startSentenceIndex,
  };
}

function snakeRecordToObject(id: string, record: SnakeRecord): WikgSnakeObject {
  return {
    firstLabel: record.firstLabel,
    groupId: record.groupId,
    id,
    lastLabel: record.lastLabel,
    localSnakeId: record.localSnakeId,
    size: record.size,
    type: "snake",
    weight: record.weight,
    wordsCount: record.wordsCount,
  };
}

function snakeObjectToRecord(
  chapterId: number,
  id: number,
  object: WikgSnakeObject,
): SnakeRecord {
  return {
    firstLabel: object.firstLabel,
    groupId: object.groupId,
    id,
    lastLabel: object.lastLabel,
    localSnakeId: object.localSnakeId,
    serialId: chapterId,
    size: object.size,
    weight: object.weight,
    wordsCount: object.wordsCount,
  };
}

function snakeChunkObjectToRecord(
  chunkIdMap: ReadonlyMap<string, number>,
  snakeIdMap: ReadonlyMap<string, number>,
  object: WikgSnakeChunkObject,
): SnakeChunkRecord {
  return {
    chunkId: requireMappedId(chunkIdMap, object.chunkId, "chunk"),
    position: object.position,
    snakeId: requireMappedId(snakeIdMap, object.snakeId, "snake"),
  };
}

function snakeEdgeObjectToRecord(
  snakeIdMap: ReadonlyMap<string, number>,
  object: WikgSnakeEdgeObject,
): SnakeEdgeRecord {
  return {
    fromSnakeId: requireMappedId(snakeIdMap, object.fromSnakeId, "snake"),
    toSnakeId: requireMappedId(snakeIdMap, object.toSnakeId, "snake"),
    weight: object.weight,
  };
}

function validateReadingGraphReferences(input: {
  readonly chunks: readonly WikgReadingChunkObject[];
  readonly readingEdges: readonly WikgReadingEdgeObject[];
  readonly snakeChunks: readonly WikgSnakeChunkObject[];
  readonly snakeEdges: readonly WikgSnakeEdgeObject[];
  readonly snakes: readonly WikgSnakeObject[];
}): void {
  const chunkIds = new Set<string>();
  for (const chunk of input.chunks) {
    if (chunkIds.has(chunk.id)) {
      throw new Error(`Duplicate reading chunk id ${chunk.id}.`);
    }
    chunkIds.add(chunk.id);
  }
  const snakeIds = new Set<string>();
  for (const snake of input.snakes) {
    if (snakeIds.has(snake.id)) {
      throw new Error(`Duplicate snake id ${snake.id}.`);
    }
    snakeIds.add(snake.id);
  }
  for (const edge of input.readingEdges) {
    requireKnownId(chunkIds, edge.fromChunkId, "chunk");
    requireKnownId(chunkIds, edge.toChunkId, "chunk");
  }
  for (const snakeChunk of input.snakeChunks) {
    requireKnownId(snakeIds, snakeChunk.snakeId, "snake");
    requireKnownId(chunkIds, snakeChunk.chunkId, "chunk");
  }
  for (const edge of input.snakeEdges) {
    requireKnownId(snakeIds, edge.fromSnakeId, "snake");
    requireKnownId(snakeIds, edge.toSnakeId, "snake");
  }
}

function requireKnownId(
  ids: ReadonlySet<string>,
  id: string,
  kind: string,
): void {
  if (!ids.has(id)) {
    throw new Error(`Unknown ${kind} id ${id}.`);
  }
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

function requireLocalSentenceIndex(
  chapterId: number,
  sentenceId: SentenceId,
): number {
  if (sentenceId[0] !== chapterId) {
    throw new Error(
      `Sentence ${formatSentenceId(sentenceId)} is outside chapter ${chapterId}.`,
    );
  }
  return sentenceId[1];
}

function formatSentenceId(sentenceId: SentenceId): string {
  return sentenceId.join(":");
}

async function writeLine(stream: WritableStream, line: string): Promise<void> {
  await new Promise<void>((resolveWrite, rejectWrite) => {
    stream.write(line, (error?: Error | null) => {
      if (error !== undefined && error !== null) {
        rejectWrite(error);
        return;
      }
      resolveWrite();
    });
  });
}

async function closeWritableStream(stream: WritableStream): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    stream.end((error?: Error | null) => {
      if (error !== undefined && error !== null) {
        rejectClose(error);
        return;
      }

      resolveClose();
    });
  });
}
