import { AsyncSemaphore } from "./utils/async-semaphore.js";
import type { Language } from "./language.js";
import type { LLM } from "./llm/index.js";
import type {
  ChunkRecord,
  FragmentGroupRecord,
  KnowledgeEdgeRecord,
  SerialRecord,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
} from "./model/types.js";
import type { SerialFragments } from "./model/fragments.js";
import type {
  ChunkStore,
  FragmentGroupStore,
  KnowledgeEdgeStore,
  SerialStore,
  SnakeChunkStore,
  SnakeEdgeStore,
  SnakeStore,
} from "./model/stores.js";
import type { Workspace } from "./model/workspace.js";
import { Reader } from "./reader/index.js";
import type {
  ReaderChunk,
  ReaderGraphDelta,
  ReaderSegmenter,
  ReaderTextStream,
} from "./reader/index.js";
import { compressText, type EditorOptions } from "./editor/index.js";
import { Topology } from "./topology/index.js";

const DEFAULT_COMPRESSION_RATIO = 0.2;
const DEFAULT_FRAGMENT_WORDS_COUNT = 800;
const DEFAULT_GENERATION_DECAY_FACTOR = 0.5;
const DEFAULT_GROUP_TOKENS_COUNT = 9600;
const DEFAULT_MAX_CLUES = 10;
const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_WORKING_MEMORY_CAPACITY = 7;
const SERIAL_HUB_SCOPES = {
  editorCompress: "serial-hub/editor-compress",
  editorReview: "serial-hub/editor-review",
  editorReviewGuide: "serial-hub/editor-review-guide",
  readerChoice: "serial-hub/reader-choice",
  readerExtraction: "serial-hub/reader-extraction",
} as const;

export enum SerialStage {
  Topology = "topology",
  Summary = "summary",
}

export interface CreateSerialOptions {
  readonly extractionPrompt: string;
  readonly targetStage?: SerialStage;
  readonly userLanguage?: Language;
}

export interface SerialHubOptions {
  readonly llm: LLM<string>;
  readonly logDirPath?: string;
  readonly segmenter?: ReaderSegmenter;
  readonly workspace: Workspace;
}

export class SerialHub {
  readonly #chunks: ChunkStore;
  readonly #fragmentWordsCount = DEFAULT_FRAGMENT_WORDS_COUNT;
  readonly #fragmentGroups: FragmentGroupStore;
  readonly #idSemaphore = new AsyncSemaphore(1);
  readonly #llm: LLM<string>;
  readonly #logDirPath: string | undefined;
  readonly #serials: SerialStore;
  readonly #segmenter: ReaderSegmenter | undefined;
  readonly #workspace: Workspace;
  readonly #writeSemaphore = new AsyncSemaphore(1);

  #nextChunkId: number | undefined;

  public constructor(options: SerialHubOptions) {
    this.#chunks = options.workspace.chunks;
    this.#fragmentGroups = options.workspace.fragmentGroups;
    this.#llm = options.llm;
    this.#logDirPath = options.logDirPath;
    this.#serials = options.workspace.serials;
    this.#segmenter = options.segmenter;
    this.#workspace = options.workspace;
  }

  public async create(
    stream: ReaderTextStream,
    options: CreateSerialOptions,
  ): Promise<Serial> {
    const serialId = await this.#createSerialId();
    const serial = new Serial(
      () => this.#getTopology(serialId),
      async () => await this.#buildSummary(serialId, options.userLanguage),
    );
    const targetStage = options.targetStage ?? SerialStage.Summary;

    await this.#buildTopology(
      serialId,
      stream,
      options.extractionPrompt,
      options.userLanguage,
    );
    if (targetStage === SerialStage.Summary) {
      await serial.ensureSummary();
    }
    return serial;
  }

  async #allocateChunkId(): Promise<number> {
    return await this.#idSemaphore.use(async () => {
      if (this.#nextChunkId === undefined) {
        this.#nextChunkId = (await this.#chunks.getMaxId()) + 1;
      }
      const chunkId = this.#nextChunkId;
      this.#nextChunkId += 1;
      return chunkId;
    });
  }

  async #buildSummary(
    serialId: number,
    userLanguage: Language | undefined,
  ): Promise<string> {
    const record = await this.#getRecord(serialId);
    if (!record.topologyReady) {
      throw new Error(`Serial ${serialId} is not ready for summary`);
    }
    const existingSummary = await this.#workspace.readSummary(serialId);

    if (existingSummary !== undefined) {
      return existingSummary;
    }
    const groupIds = await this.#fragmentGroups.listGroupIdsForSerial(serialId);
    const summaryParts: string[] = [];

    for (const groupId of groupIds) {
      const groupSummary = await compressText({
        ...this.#createEditorOptions({
          groupId,
          serialId,
          userLanguage,
        }),
      });
      if (groupSummary.trim() === "") {
        continue;
      }
      summaryParts.push(groupSummary);
    }
    const summary = summaryParts.join("\n\n");

    await this.#writeSemaphore.use(
      async () => await this.#workspace.writeSummary(serialId, summary),
    );
    return summary;
  }

  async #buildTopology(
    serialId: number,
    stream: ReaderTextStream,
    extractionPrompt: string,
    userLanguage: Language | undefined,
  ): Promise<void> {
    const reader = new Reader({
      attention: {
        capacity: DEFAULT_WORKING_MEMORY_CAPACITY,
        generationDecayFactor: DEFAULT_GENERATION_DECAY_FACTOR,
        idGenerator: async () => await this.#allocateChunkId(),
      },
      extractionGuidance: extractionPrompt,
      llm: this.#llm,
      scopes: {
        choice: SERIAL_HUB_SCOPES.readerChoice,
        extraction: SERIAL_HUB_SCOPES.readerExtraction,
      },
      sentenceTextSource: this.#workspace,
      ...(this.#segmenter === undefined
        ? {}
        : {
            segmenter: this.#segmenter,
          }),
      ...(userLanguage === undefined
        ? {}
        : {
            userLanguage,
          }),
    });
    const topology = new Topology(
      this.#workspace,
      serialId,
      DEFAULT_GROUP_TOKENS_COUNT,
    );
    const allChunks: ReaderChunk[] = [];
    const successorIdsByChunkId = createNumberListRecord();

    for await (const fragment of streamFragments({
      maxWordsCount: this.#fragmentWordsCount,
      stream: reader.segment(stream),
    })) {
      const serialFragments = this.#getSerialFragments(serialId);
      const fragmentDraft = await serialFragments.createDraft();
      const sentences = fragment.sentences.map((sentence) => ({
        sentenceId: fragmentDraft.addSentence(
          sentence.text,
          sentence.wordsCount,
        ),
        text: sentence.text,
        tokenCount: sentence.wordsCount,
      }));
      const fragmentText = sentences.map((sentence) => sentence.text).join(" ");
      const userFocused = await reader.extractUserFocused({
        sentences,
        text: fragmentText,
      });

      if (userFocused.fragmentSummary.trim() !== "") {
        fragmentDraft.setSummary(userFocused.fragmentSummary);
      }

      const bookCoherence = await reader.extractBookCoherence({
        sentences,
        text: fragmentText,
        userFocusedChunks: userFocused.delta.chunks,
      });

      await fragmentDraft.commit();
      saveDelta(allChunks, successorIdsByChunkId, topology, userFocused.delta);
      saveDelta(allChunks, successorIdsByChunkId, topology, bookCoherence);
      reader.completeFragment({
        allChunks,
        getSuccessorChunkIds: (chunkId) =>
          successorIdsByChunkId[String(chunkId)] ?? [],
      });
    }

    await this.#writeSemaphore.use(async () => {
      await topology.finalize();
      await this.#serials.setTopologyReady(serialId);
    });
  }

  async #createSerialId(): Promise<number> {
    return await this.#idSemaphore.use(
      async () => await this.#serials.create(),
    );
  }

  async #getRecord(serialId: number): Promise<SerialRecord> {
    const record = await this.#serials.getById(serialId);
    if (record === undefined) {
      throw new Error(`Serial ${serialId} does not exist`);
    }
    return record;
  }

  #getTopology(serialId: number): SerialTopology {
    return new SerialTopology(this.#workspace, serialId);
  }

  #getSerialFragments(serialId: number): SerialFragments {
    return this.#workspace.getSerialFragments(serialId);
  }

  #createEditorOptions(input: {
    groupId: number;
    serialId: number;
    userLanguage: Language | undefined;
  }): EditorOptions<string> {
    return {
      compressionRatio: DEFAULT_COMPRESSION_RATIO,
      groupId: input.groupId,
      llm: this.#llm,
      maxClues: DEFAULT_MAX_CLUES,
      maxIterations: DEFAULT_MAX_ITERATIONS,
      scopes: {
        compress: SERIAL_HUB_SCOPES.editorCompress,
        review: SERIAL_HUB_SCOPES.editorReview,
        reviewGuide: SERIAL_HUB_SCOPES.editorReviewGuide,
      },
      serialId: input.serialId,
      workspace: this.#workspace,
      ...(this.#logDirPath === undefined
        ? {}
        : {
            logDirPath: this.#logDirPath,
          }),
      ...(input.userLanguage === undefined
        ? {}
        : {
            userLanguage: input.userLanguage,
          }),
    };
  }
}

export class Serial {
  readonly #ensureSummaryOperation: () => Promise<string>;
  readonly #getTopology: () => SerialTopology;

  #summary: Promise<string> | string | undefined;

  public constructor(
    getTopology: () => SerialTopology,
    ensureSummary: () => Promise<string>,
  ) {
    this.#ensureSummaryOperation = ensureSummary;
    this.#getTopology = getTopology;
  }

  public get stage(): SerialStage {
    if (typeof this.#summary === "string") {
      return SerialStage.Summary;
    }
    return SerialStage.Topology;
  }

  public async ensureSummary(): Promise<Serial> {
    if (typeof this.#summary === "string") {
      return this;
    }

    if (this.#summary instanceof Promise) {
      await this.#summary;
      return this;
    }

    const summary = this.#loadSummary();

    this.#summary = summary;

    try {
      await summary;
    } finally {
      if (this.#summary === summary) {
        this.#summary = undefined;
      }
    }
    return this;
  }

  public async ensureTopology(): Promise<Serial> {
    return await Promise.resolve(this);
  }

  public getSummary(): string {
    if (typeof this.#summary !== "string") {
      throw new Error("Serial summary is not ready");
    }
    return this.#summary;
  }

  public getTopology(): SerialTopology {
    return this.#getTopology();
  }

  async #loadSummary(): Promise<string> {
    const summary = await this.#ensureSummaryOperation();
    this.#summary = summary;
    return summary;
  }
}

export class SerialTopology {
  readonly #chunks: ChunkStore;
  readonly #fragmentGroups: FragmentGroupStore;
  readonly #knowledgeEdges: KnowledgeEdgeStore;
  readonly #serialId: number;
  readonly #snakeChunks: SnakeChunkStore;
  readonly #snakeEdges: SnakeEdgeStore;
  readonly #snakes: SnakeStore;

  public constructor(workspace: Workspace, serialId: number) {
    this.#chunks = workspace.chunks;
    this.#fragmentGroups = workspace.fragmentGroups;
    this.#knowledgeEdges = workspace.knowledgeEdges;
    this.#serialId = serialId;
    this.#snakeChunks = workspace.snakeChunks;
    this.#snakeEdges = workspace.snakeEdges;
    this.#snakes = workspace.snakes;
  }

  public async listChunks(): Promise<readonly ChunkRecord[]> {
    return await this.#chunks.listBySerial(this.#serialId);
  }

  public async listEdges(): Promise<readonly KnowledgeEdgeRecord[]> {
    return await this.#knowledgeEdges.listBySerial(this.#serialId);
  }

  public async listGroups(): Promise<readonly FragmentGroupRecord[]> {
    return await this.#fragmentGroups.listBySerial(this.#serialId);
  }

  public async listSnakeChunks(
    snakeId: number,
  ): Promise<readonly SnakeChunkRecord[]> {
    const snake = await this.#snakes.getById(snakeId);
    if (snake === undefined || snake.serialId !== this.#serialId) {
      throw new Error(`Snake ${snakeId} does not belong to this serial`);
    }
    return await this.#snakeChunks.listBySnake(snakeId);
  }

  public async listSnakeEdges(): Promise<readonly SnakeEdgeRecord[]> {
    return await this.#snakeEdges.listBySerial(this.#serialId);
  }

  public async listSnakes(): Promise<readonly SnakeRecord[]> {
    return await this.#snakes.listBySerial(this.#serialId);
  }
}

function appendSuccessor(
  successorIdsByChunkId: Record<string, number[] | undefined>,
  fromId: number,
  toId: number,
): void {
  const existingSuccessors = successorIdsByChunkId[String(fromId)] ?? [];

  if (existingSuccessors.includes(toId)) {
    return;
  }

  successorIdsByChunkId[String(fromId)] = [...existingSuccessors, toId].sort(
    compareNumber,
  );
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function createNumberListRecord(): Record<string, number[] | undefined> {
  return Object.create(null) as Record<string, number[] | undefined>;
}

function saveDelta(
  allChunks: ReaderChunk[],
  successorIdsByChunkId: Record<string, number[] | undefined>,
  topology: Topology,
  delta: ReaderGraphDelta,
): void {
  topology.accept(delta);
  allChunks.push(...delta.chunks);

  for (const edge of delta.edges) {
    appendSuccessor(successorIdsByChunkId, edge.fromId, edge.toId);
  }
}

async function* streamFragments(input: {
  maxWordsCount: number;
  stream: AsyncIterable<{
    readonly text: string;
    readonly wordsCount: number;
  }>;
}): AsyncIterable<{
  readonly sentences: ReadonlyArray<{
    readonly text: string;
    readonly wordsCount: number;
  }>;
}> {
  let currentSentences: Array<{
    readonly text: string;
    readonly wordsCount: number;
  }> = [];
  let currentWordsCount = 0;

  for await (const sentence of input.stream) {
    const sentenceText = sentence.text.trim();

    if (sentenceText === "") {
      continue;
    }
    if (
      currentSentences.length > 0 &&
      currentWordsCount + sentence.wordsCount > input.maxWordsCount
    ) {
      yield {
        sentences: currentSentences,
      };
      currentSentences = [];
      currentWordsCount = 0;
    }
    currentSentences.push({
      text: sentenceText,
      wordsCount: sentence.wordsCount,
    });
    currentWordsCount += sentence.wordsCount;
  }

  if (currentSentences.length > 0) {
    yield {
      sentences: currentSentences,
    };
  }
}
