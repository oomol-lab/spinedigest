import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdpubMockState = vi.hoisted(() => ({
  binaryWrites: [] as Uint8Array[],
  cover: {
    data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
    mediaType: "image/png",
    path: "images/cover.png",
  } as
    | {
        readonly data: Uint8Array;
        readonly mediaType: string;
        readonly path: string;
      }
    | undefined,
  meta: {
    authors: ["Ari Lantern", "Bea North"],
    description: "Fixture description",
    identifier: "urn:test:sdpub-cli",
    language: "en",
    publishedAt: "2026-01-01",
    publisher: "Open Sample Press",
    sourceFormat: "epub",
    title: "Fixture Book",
    version: 1,
  },
  openCalls: [] as string[],
  serialEntries: [
    {
      fragmentCount: 2,
      serialId: 1,
      title: "Chapter 1",
      tocPath: ["Part I", "Chapter 1"],
    },
    {
      fragmentCount: 1,
      serialId: 2,
      title: "Chapter 2",
      tocPath: ["Part I", "Chapter 2"],
    },
  ],
  serialSummary: "Summary line one.\nSummary line two.",
  textWrites: [] as string[],
  toc: {
    items: [
      {
        children: [
          {
            children: [],
            serialId: 1,
            title: "Chapter 1",
          },
          {
            children: [],
            serialId: 2,
            title: "Chapter 2",
          },
        ],
        title: "Part I",
      },
    ],
    version: 1,
  },
}));

vi.mock("../../src/index.js", () => ({
  SpineDigestApp: class {
    public async openSession(
      path: string,
      operation: (digest: MockDigest) => Promise<unknown>,
    ): Promise<unknown> {
      sdpubMockState.openCalls.push(path);
      return await operation(createMockDigest());
    }
  },
}));

vi.mock("../../src/cli/io.js", () => ({
  writeBinaryToStdout: vi.fn((data: Uint8Array) => {
    sdpubMockState.binaryWrites.push(data);
    return Promise.resolve();
  }),
  writeTextToStdout: vi.fn((text: string) => {
    sdpubMockState.textWrites.push(text);
    return Promise.resolve();
  }),
}));

import { runSdpubCommand } from "../../src/cli/sdpub.js";

describe("cli/sdpub", () => {
  const originalStdoutIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    sdpubMockState.binaryWrites.length = 0;
    sdpubMockState.cover = {
      data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      mediaType: "image/png",
      path: "images/cover.png",
    };
    sdpubMockState.meta = {
      authors: ["Ari Lantern", "Bea North"],
      description: "Fixture description",
      identifier: "urn:test:sdpub-cli",
      language: "en",
      publishedAt: "2026-01-01",
      publisher: "Open Sample Press",
      sourceFormat: "epub",
      title: "Fixture Book",
      version: 1,
    };
    sdpubMockState.openCalls.length = 0;
    sdpubMockState.serialEntries = [
      {
        fragmentCount: 2,
        serialId: 1,
        title: "Chapter 1",
        tocPath: ["Part I", "Chapter 1"],
      },
      {
        fragmentCount: 1,
        serialId: 2,
        title: "Chapter 2",
        tocPath: ["Part I", "Chapter 2"],
      },
    ];
    sdpubMockState.serialSummary = "Summary line one.\nSummary line two.";
    sdpubMockState.textWrites.length = 0;
    sdpubMockState.toc = {
      items: [
        {
          children: [
            {
              children: [],
              serialId: 1,
              title: "Chapter 1",
            },
            {
              children: [],
              serialId: 2,
              title: "Chapter 2",
            },
          ],
          title: "Part I",
        },
      ],
      version: 1,
    };
    setStdoutTTY(false);
  });

  afterEach(() => {
    setStdoutTTY(originalStdoutIsTTY);
  });

  it("renders sdpub info in a human-friendly format", async () => {
    await runSdpubCommand({
      inputPath: "/tmp/book.sdpub",
      subcommand: "info",
    });

    expect(sdpubMockState.openCalls).toStrictEqual(["/tmp/book.sdpub"]);
    expect(sdpubMockState.textWrites).toStrictEqual([
      [
        "Title: Fixture Book",
        "Authors: Ari Lantern, Bea North",
        "Language: en",
        "Source Format: epub",
        "Identifier: urn:test:sdpub-cli",
        "Publisher: Open Sample Press",
        "Published At: 2026-01-01",
        "Description: Fixture description",
        "Cover: yes",
        "Cover Media Type: image/png",
        "Cover Path: images/cover.png",
        "",
        "Top-level Sections: 1",
        "Referenced Serials: 2",
        "Fragments: 3",
        "",
      ].join("\n"),
    ]);
  });

  it("renders the toc tree", async () => {
    await runSdpubCommand({
      inputPath: "/tmp/book.sdpub",
      subcommand: "toc",
    });

    expect(sdpubMockState.textWrites).toStrictEqual([
      [
        "Fixture Book",
        "",
        "Part I",
        "  Chapter 1 [serial 1]",
        "  Chapter 2 [serial 2]",
        "",
      ].join("\n"),
    ]);
  });

  it("renders serials in toc order", async () => {
    await runSdpubCommand({
      inputPath: "/tmp/book.sdpub",
      subcommand: "list",
    });

    expect(sdpubMockState.textWrites).toStrictEqual([
      [
        "[1] Part I / Chapter 1 (fragments: 2)",
        "[2] Part I / Chapter 2 (fragments: 1)",
        "",
      ].join("\n"),
    ]);
  });

  it("writes only serial summary text for cat", async () => {
    await runSdpubCommand({
      inputPath: "/tmp/book.sdpub",
      serialId: 2,
      subcommand: "cat",
    });

    expect(sdpubMockState.textWrites).toStrictEqual([
      "Summary line one.\nSummary line two.",
    ]);
  });

  it("writes raw cover bytes for cover", async () => {
    await runSdpubCommand({
      inputPath: "/tmp/book.sdpub",
      subcommand: "cover",
    });

    expect(sdpubMockState.binaryWrites).toHaveLength(1);
    expect(Array.from(sdpubMockState.binaryWrites[0]!)).toStrictEqual([
      0x89, 0x50, 0x4e, 0x47,
    ]);
  });

  it("rejects binary cover output to an interactive terminal", async () => {
    setStdoutTTY(true);

    await expect(
      runSdpubCommand({
        inputPath: "/tmp/book.sdpub",
        subcommand: "cover",
      }),
    ).rejects.toThrow(
      "Refusing to write binary cover data to an interactive terminal. Redirect stdout or pipe it.",
    );

    expect(sdpubMockState.binaryWrites).toHaveLength(0);
  });

  it("fails when the cover is missing", async () => {
    sdpubMockState.cover = undefined;

    await expect(
      runSdpubCommand({
        inputPath: "/tmp/book.sdpub",
        subcommand: "cover",
      }),
    ).rejects.toThrow("Document cover is missing.");
  });
});

interface MockDigest {
  listSerials(): Promise<readonly unknown[]>;
  readCover(): Promise<typeof sdpubMockState.cover>;
  readMeta(): Promise<typeof sdpubMockState.meta>;
  readSerialSummary(serialId: number): Promise<string>;
  readToc(): Promise<typeof sdpubMockState.toc>;
}

function createMockDigest(): MockDigest {
  return {
    listSerials: () => Promise.resolve(sdpubMockState.serialEntries),
    readCover: () => Promise.resolve(sdpubMockState.cover),
    readMeta: () => Promise.resolve(sdpubMockState.meta),
    readSerialSummary: (serialId: number) => {
      expect(serialId).toBe(2);
      return Promise.resolve(sdpubMockState.serialSummary);
    },
    readToc: () => Promise.resolve(sdpubMockState.toc),
  };
}

function setStdoutTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value,
  });
}
