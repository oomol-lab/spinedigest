import { AsyncSemaphore } from "./utils/async-semaphore.js";
import type { Language } from "./language.js";
import type { LLM } from "./llm/index.js";
import type {
  ChunkRecord,
  FragmentGroupRecord,
  KnowledgeEdgeRecord,
  SnakeChunkRecord,
  SnakeEdgeRecord,
  SnakeRecord,
  Workspace,
} from "./model/index.js";
import { Reader } from "./reader/index.js";
import type {
  ReaderChunk,
  ReaderGraphDelta,
  ReaderOptions,
  ReaderTextStream,
} from "./reader/index.js";
import { compressText, type EditorOptions } from "./editor/index.js";
import { Topology } from "./topology/index.js";

const DEFAULT_FRAGMENT_WORDS_COUNT = 800;

export type SerialStage = "topology" | "summary";

export interface CreateSerialOptions {
  readonly targetStage?: SerialStage;
  readonly userLanguage?: Language;
}

export interface SerialHubOptions<S extends string> {
  readonly editor: Omit<
    EditorOptions<S>,
    "groupId" | "llm" | "serialId" | "userLanguage" | "workspace"
  >;
  readonly fragmentWordsCount?: number;
  readonly llm: LLM<S>;
  readonly reader: Omit<
    ReaderOptions<S>,
    "attention" | "llm" | "sentenceTextSource" | "userLanguage"
  > & {
    readonly attention: Omit<ReaderOptions<S>["attention"], "idGenerator">;
  };
  readonly topology: {
    readonly groupTokensCount: number;
  };
  readonly workspace: Workspace;
}

interface SerialState {
  readonly stage: SerialStage;
  readonly summary?: string;
  readonly summaryJob?: Promise<void>;
}

export class SerialHub<S extends string> {
  readonly #editorOptions: SerialHubOptions<S>["editor"];
  readonly #fragmentWordsCount: number;
  readonly #idSemaphore = new AsyncSemaphore(1);
  readonly #llm: LLM<S>;
  #nextChunkId: number | undefined;
  readonly #readerOptions: SerialHubOptions<S>["reader"];
  readonly #serialStates = createSerialStateRecord();
  readonly #topologyOptions: SerialHubOptions<S>["topology"];
  readonly #workspace: Workspace;
  readonly #writeSemaphore = new AsyncSemaphore(1);

  public constructor(options: SerialHubOptions<S>) {
    this.#editorOptions = options.editor;
    this.#fragmentWordsCount =
      options.fragmentWordsCount ?? DEFAULT_FRAGMENT_WORDS_COUNT;
    this.#llm = options.llm;
    this.#readerOptions = options.reader;
    this.#topologyOptions = options.topology;
    this.#workspace = options.workspace;
  }

  public async create(
    stream: ReaderTextStream,
    options: CreateSerialOptions = {},
  ): Promise<Serial<S>> {
    const serialId = await this.#createSerialId();
    const serial = new Serial({
      ensureSummary: async () =>
        await this.#ensureSummary(serialId, options.userLanguage),
      getStage: () => this.#getStage(serialId),
      getSummary: () => this.#getSummary(serialId),
      getTopology: () => this.#getTopology(serialId),
    });
    const targetStage = options.targetStage ?? "summary";

    await this.#buildTopology(serialId, stream, options.userLanguage);
    this.#setTopologyReady(serialId);

    if (targetStage === "summary") {
      await this.#buildSummary(serialId, options.userLanguage);
    }

    return serial;
  }

  async #allocateChunkId(): Promise<number> {
    return await this.#idSemaphore.use(() => {
      if (this.#nextChunkId === undefined) {
        this.#nextChunkId = this.#workspace.chunks.getMaxId() + 1;
      }

      const chunkId = this.#nextChunkId;

      this.#nextChunkId += 1;

      return chunkId;
    });
  }

  async #buildSummary(
    serialId: number,
    userLanguage: Language | undefined,
  ): Promise<void> {
    const state = this.#getState(serialId);

    if (state.stage === "summary") {
      return;
    }

    if (state.summaryJob !== undefined) {
      await state.summaryJob;

      return;
    }

    const summaryJob = this.#buildSummaryOnce(serialId, userLanguage);

    this.#setState(serialId, {
      ...state,
      summaryJob,
    });

    try {
      await summaryJob;
    } finally {
      const nextState = this.#getState(serialId);

      if (nextState.summaryJob === summaryJob) {
        this.#setState(serialId, {
          stage: nextState.stage,
          ...(nextState.summary === undefined
            ? {}
            : {
                summary: nextState.summary,
              }),
        });
      }
    }
  }

  async #buildSummaryOnce(
    serialId: number,
    userLanguage: Language | undefined,
  ): Promise<void> {
    const existingSummary = await this.#workspace.readSummary(serialId);

    if (existingSummary !== undefined) {
      this.#setSummary(serialId, existingSummary);

      return;
    }

    const groupIds =
      this.#workspace.fragmentGroups.listGroupIdsForSerial(serialId);
    const summaryParts: string[] = [];

    for (const groupId of groupIds) {
      const groupSummary = await compressText({
        ...this.#editorOptions,
        groupId,
        llm: this.#llm,
        serialId,
        workspace: this.#workspace,
        ...(userLanguage === undefined
          ? {}
          : {
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
    this.#setSummary(serialId, summary);
  }

  async #buildTopology(
    serialId: number,
    stream: ReaderTextStream,
    userLanguage: Language | undefined,
  ): Promise<void> {
    const reader = new Reader({
      ...this.#readerOptions,
      attention: {
        ...this.#readerOptions.attention,
        idGenerator: async () => await this.#allocateChunkId(),
      },
      llm: this.#llm,
      sentenceTextSource: this.#workspace,
      ...(userLanguage === undefined
        ? {}
        : {
            userLanguage,
          }),
    });
    const topology = new Topology({
      groupTokensCount: this.#topologyOptions.groupTokensCount,
      serialId,
      workspace: this.#workspace,
    });
    const allChunks: ReaderChunk[] = [];
    const successorIdsByChunkId = createNumberListRecord();

    for await (const fragment of streamFragments({
      maxWordsCount: this.#fragmentWordsCount,
      stream: reader.segment(stream),
    })) {
      const serialFragments = this.#workspace.getSerialFragments(serialId);
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
    });
  }

  async #createSerialId(): Promise<number> {
    return await this.#idSemaphore.use(() => this.#workspace.createSerial());
  }

  async #ensureSummary(
    serialId: number,
    userLanguage: Language | undefined,
  ): Promise<void> {
    await this.#buildSummary(serialId, userLanguage);
  }

  #getStage(serialId: number): SerialStage {
    return this.#getState(serialId).stage;
  }

  #getState(serialId: number): SerialState {
    const state = this.#serialStates[String(serialId)];

    if (state === undefined) {
      throw new Error(`Serial ${serialId} is not managed by this hub`);
    }

    return state;
  }

  #getTopology(serialId: number): SerialTopology {
    return new SerialTopology(this.#workspace, serialId);
  }

  #getSummary(serialId: number): string | undefined {
    return this.#getState(serialId).summary;
  }

  #setState(serialId: number, state: SerialState): void {
    this.#serialStates[String(serialId)] = state;
  }

  #setSummary(serialId: number, summary: string): void {
    this.#setState(serialId, {
      stage: "summary",
      summary,
    });
  }

  #setTopologyReady(serialId: number): void {
    this.#setState(serialId, {
      stage: "topology",
    });
  }
}

export class Serial<S extends string> {
  readonly #ensureSummary: () => Promise<void>;
  readonly #getStage: () => SerialStage;
  readonly #getSummary: () => string | undefined;
  readonly #getTopology: () => SerialTopology;

  public constructor(input: {
    ensureSummary: () => Promise<void>;
    getStage: () => SerialStage;
    getSummary: () => string | undefined;
    getTopology: () => SerialTopology;
  }) {
    this.#ensureSummary = input.ensureSummary;
    this.#getStage = input.getStage;
    this.#getSummary = input.getSummary;
    this.#getTopology = input.getTopology;
  }

  public get stage(): SerialStage {
    return this.#getStage();
  }

  public async ensureSummary(): Promise<Serial<S>> {
    await this.#ensureSummary();

    return this;
  }

  public async ensureTopology(): Promise<Serial<S>> {
    return await Promise.resolve(this);
  }

  public getSummary(): string {
    const summary = this.#getSummary();

    if (summary === undefined) {
      throw new Error("Serial summary is not ready");
    }

    return summary;
  }

  public getTopology(): SerialTopology {
    return this.#getTopology();
  }
}

export class SerialTopology {
  readonly #serialId: number;
  readonly #workspace: Workspace;

  public constructor(workspace: Workspace, serialId: number) {
    this.#workspace = workspace;
    this.#serialId = serialId;
  }

  public listChunks(): readonly ChunkRecord[] {
    return this.#workspace.chunks.listBySerial(this.#serialId);
  }

  public listEdges(): readonly KnowledgeEdgeRecord[] {
    return this.#workspace.knowledgeEdges.listBySerial(this.#serialId);
  }

  public listGroups(): readonly FragmentGroupRecord[] {
    return this.#workspace.fragmentGroups.listBySerial(this.#serialId);
  }

  public listSnakeChunks(snakeId: number): readonly SnakeChunkRecord[] {
    const snake = this.#workspace.snakes.getById(snakeId);

    if (snake === undefined || snake.serialId !== this.#serialId) {
      throw new Error(`Snake ${snakeId} does not belong to this serial`);
    }

    return this.#workspace.snakeChunks.listBySnake(snakeId);
  }

  public listSnakeEdges(): readonly SnakeEdgeRecord[] {
    return this.#workspace.snakeEdges.listBySerial(this.#serialId);
  }

  public listSnakes(): readonly SnakeRecord[] {
    return this.#workspace.snakes.listBySerial(this.#serialId);
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

function createSerialStateRecord(): Record<string, SerialState | undefined> {
  return Object.create(null) as Record<string, SerialState | undefined>;
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
