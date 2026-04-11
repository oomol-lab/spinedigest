import { describe, expect, it, vi } from "vitest";

const { groupFragmentsMock } = vi.hoisted(() => ({
  groupFragmentsMock: vi.fn(),
}));

vi.mock("../../src/topology/grouping.js", () => ({
  groupFragments: groupFragmentsMock,
}));

import { ChunkImportance, ChunkRetention } from "../../src/document/index.js";
import type {
  ChunkRecord,
  Document,
  KnowledgeEdgeRecord,
  ReadonlySerialFragments,
} from "../../src/document/index.js";
import { Topology } from "../../src/topology/topology.js";

describe("topology/topology", () => {
  it("merges deltas, applies annotations, and persists weighted topology output", async () => {
    groupFragmentsMock.mockResolvedValue([
      {
        fragmentId: 1,
        groupId: 0,
        serialId: 7,
      },
      {
        fragmentId: 2,
        groupId: 0,
        serialId: 7,
      },
    ]);
    const {
      document,
      ensureSerial,
      getSerialFragments,
      saveChunk,
      saveEdge,
      saveFragmentGroups,
    } = createDocumentStub();
    const topology = new Topology(document, 7, 120);

    topology.accept({
      chunks: [
        createReaderChunk(2, 2, {
          retention: ChunkRetention.Focused,
        }),
        createReaderChunk(1, 1, {
          retention: ChunkRetention.Relevant,
        }),
      ],
      edges: [
        {
          fromId: 2,
          toId: 1,
        },
      ],
    });
    topology.accept({
      chunks: [],
      edges: [
        {
          fromId: 2,
          strength: "critical",
          toId: 1,
        },
      ],
      importanceAnnotations: [
        {
          chunkId: 2,
          importance: ChunkImportance.Critical,
        },
        {
          chunkId: 999,
          importance: ChunkImportance.Helpful,
        },
      ],
    });

    await topology.finalize();

    const savedChunks = saveChunk.mock.calls as Array<[ChunkRecord]>;
    const savedEdges = saveEdge.mock.calls as Array<[KnowledgeEdgeRecord]>;

    expect(ensureSerial).toHaveBeenCalledWith(7);
    expect(savedChunks.map(([record]) => record)).toStrictEqual([
      {
        content: "Chunk 1",
        generation: 0,
        id: 1,
        label: "Chunk 1",
        retention: ChunkRetention.Relevant,
        sentenceId: [7, 1, 0],
        sentenceIds: [[7, 1, 0]],
        wordsCount: 5,
        weight: 1,
      },
      {
        content: "Chunk 2",
        generation: 0,
        id: 2,
        importance: ChunkImportance.Critical,
        label: "Chunk 2",
        retention: ChunkRetention.Focused,
        sentenceId: [7, 2, 0],
        sentenceIds: [[7, 2, 0]],
        wordsCount: 5,
        weight: 12,
      },
    ]);
    expect(savedEdges.map(([record]) => record)).toStrictEqual([
      {
        fromId: 2,
        strength: "critical",
        toId: 1,
        weight: 13,
      },
    ]);
    expect(groupFragmentsMock).toHaveBeenCalledWith({
      chunks: [
        {
          content: "Chunk 1",
          generation: 0,
          id: 1,
          label: "Chunk 1",
          retention: ChunkRetention.Relevant,
          sentenceId: [7, 1, 0],
          sentenceIds: [[7, 1, 0]],
          wordsCount: 5,
          weight: 1,
        },
        {
          content: "Chunk 2",
          generation: 0,
          id: 2,
          importance: ChunkImportance.Critical,
          label: "Chunk 2",
          retention: ChunkRetention.Focused,
          sentenceId: [7, 2, 0],
          sentenceIds: [[7, 2, 0]],
          wordsCount: 5,
          weight: 12,
        },
      ],
      edges: [
        {
          fromId: 2,
          strength: "critical",
          toId: 1,
          weight: 13,
        },
      ],
      fragments: getSerialFragments(),
      groupWordsCount: 120,
      serialId: 7,
    });
    expect(saveFragmentGroups).toHaveBeenCalledWith([
      {
        fragmentId: 1,
        groupId: 0,
        serialId: 7,
      },
      {
        fragmentId: 2,
        groupId: 0,
        serialId: 7,
      },
    ]);
  });
});

function createDocumentStub(): {
  readonly document: Document;
  readonly ensureSerial: ReturnType<typeof vi.fn>;
  readonly getSerialFragments: () => ReadonlySerialFragments;
  readonly saveChunk: ReturnType<typeof vi.fn>;
  readonly saveEdge: ReturnType<typeof vi.fn>;
  readonly saveFragmentGroups: ReturnType<typeof vi.fn>;
} {
  const fragments = {
    getFragment: (fragmentId: number) =>
      Promise.resolve({
        fragmentId,
        sentences: [
          {
            text: `Fragment ${fragmentId}`,
            wordsCount: 10,
          },
        ],
        serialId: 7,
        summary: "",
      }),
    listFragmentIds: () => Promise.resolve([1, 2]),
    path: "/tmp/fragments",
    serialId: 7,
  } satisfies ReadonlySerialFragments;
  const saveChunk = vi.fn(() => Promise.resolve());
  const saveEdge = vi.fn(() => Promise.resolve());
  const saveFragmentGroups = vi.fn(() => Promise.resolve());
  const ensureSerial = vi.fn(() => Promise.resolve());
  const getSerialFragments = () => fragments;

  return {
    document: {
      chunks: {
        save: saveChunk,
      },
      fragmentGroups: {
        saveMany: saveFragmentGroups,
      },
      getSerialFragments,
      knowledgeEdges: {
        save: saveEdge,
      },
      serials: {
        ensure: ensureSerial,
      },
    } as unknown as Document,
    ensureSerial,
    getSerialFragments,
    saveChunk,
    saveEdge,
    saveFragmentGroups,
  };
}

function createReaderChunk(
  id: number,
  fragmentId: number,
  extra: {
    readonly importance?: ChunkImportance;
    readonly retention?: ChunkRetention;
  } = {},
) {
  return {
    content: `Chunk ${id}`,
    generation: 0,
    id,
    label: `Chunk ${id}`,
    links: [],
    sentenceId: [7, fragmentId, 0] as const,
    sentenceIds: [[7, fragmentId, 0] as const],
    wordsCount: 5,
    ...extra,
  };
}
