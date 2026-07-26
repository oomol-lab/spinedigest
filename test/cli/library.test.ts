import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as CLISupport from "../../packages/cli/src/support/index.js";
import type * as WikiGraphCore from "wiki-graph-core";

const libraryMockState = vi.hoisted(() => ({
  archives: [] as unknown[],
  metadata: {} as Record<string, unknown>,
  putCalls: [] as unknown[],
  textWrites: [] as string[],
}));

vi.mock("wiki-graph-core", async (importOriginal) => {
  const actual = await importOriginal<typeof WikiGraphCore>();

  return {
    ...actual,
    assertWikiGraphLibrarySchemaCurrent: vi.fn(() => Promise.resolve()),
    listWikiGraphLibraryArchives: vi.fn(() =>
      Promise.resolve(libraryMockState.archives),
    ),
    scanWikiGraphLibrary: vi.fn(() =>
      Promise.resolve({ archives: libraryMockState.archives }),
    ),
    putWikiGraphLibraryMetadata: vi.fn(
      (_target: unknown, key: string, value: unknown) => {
        libraryMockState.putCalls.push({ key, value });
        libraryMockState.metadata[key] = value;
        return Promise.resolve({ ...libraryMockState.metadata });
      },
    ),
  };
});

vi.mock("../../packages/cli/src/support/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof CLISupport>();

  return {
    ...actual,
    writeTextToStdout: vi.fn((text: string) => {
      libraryMockState.textWrites.push(text);
      return Promise.resolve();
    }),
  };
});

import { parseCLIArguments } from "../../packages/cli/src/args/index.js";
import { runLibraryCommand } from "../../packages/cli/src/commands/index.js";

describe("cli/library args", () => {
  beforeEach(() => {
    libraryMockState.archives = [];
    libraryMockState.metadata = {};
    libraryMockState.putCalls.length = 0;
    libraryMockState.textWrites.length = 0;
  });

  it("parses library create, scope, remove, and metadata commands", () => {
    expect(
      parseCLIArguments([
        "wikg://lib/registry",
        "add",
        "--path",
        "/tmp/research",
        "--json",
      ]),
    ).toStrictEqual({
      args: {
        action: "create",
        json: true,
        path: "/tmp/research",
        target: { isDefault: true, kind: "registry" },
      },
      help: false,
      kind: "library",
    });

    expect(parseCLIArguments(["wikg://lib/abc123abc123"])).toStrictEqual({
      args: {
        action: "list",
        json: undefined,
        target: { isDefault: false, kind: "scope", publicId: "abc123abc123" },
      },
      help: false,
      kind: "library",
    });

    expect(() =>
      parseCLIArguments(["wikg://lib/abc123abc123", "remove", "--json"]),
    ).toThrow("Missing --confirm");

    expect(
      parseCLIArguments([
        "wikg://lib/abc123abc123",
        "remove",
        "--confirm",
        "--json",
      ]),
    ).toMatchObject({
      args: {
        action: "remove",
        confirm: true,
        json: true,
        target: { publicId: "abc123abc123" },
      },
      kind: "library",
    });

    expect(
      parseCLIArguments(["wikg://lib/meta", "put", "note", "Default"]),
    ).toMatchObject({
      args: {
        action: "put",
        inputValue: "Default",
        key: "note",
        target: { isDefault: true, kind: "metadata" },
      },
      help: false,
      kind: "library",
    });
  });

  it("parses library archive member commands and routes inspect to archive readiness", () => {
    expect(
      parseCLIArguments(["wikg://lib/arc/archive123", "--json"]),
    ).toMatchObject({
      args: {
        action: "get",
        json: true,
        target: {
          archivePublicId: "archive123",
          isDefault: true,
          kind: "archive",
        },
      },
      kind: "library",
    });
    expect(
      parseCLIArguments(["wikg://lib/arc/archive123", "remove", "--confirm"]),
    ).toMatchObject({
      args: {
        action: "remove",
        confirm: true,
        target: {
          archivePublicId: "archive123",
          isDefault: true,
          kind: "archive",
        },
      },
      kind: "library",
    });
    expect(
      parseCLIArguments([
        "wikg://lib/arc/archive123/path",
        "set",
        "nested/book.wikg",
      ]),
    ).toMatchObject({
      args: {
        action: "move",
        target: { archivePublicId: "archive123", kind: "archive-path" },
        to: "nested/book.wikg",
      },
      kind: "library",
    });
    expect(() =>
      parseCLIArguments(["wikg://lib/arc/archive123", "remove"]),
    ).toThrow("Missing --confirm");
    expect(() => parseCLIArguments(["wikg://lib/meta", "move"])).toThrow(
      "does not support `move`",
    );
    expect(
      parseCLIArguments(["wikg://lib/arc/archive123", "inspect"]),
    ).toMatchObject({
      args: {
        action: "inspect",
        archivePath: "wikg://lib/arc/archive123",
      },
      kind: "archive",
    });
    expect(
      parseCLIArguments([
        "wikg://lib/team/arc/archive123",
        "inspect",
        "--json",
      ]),
    ).toMatchObject({
      args: {
        action: "inspect",
        archivePath: "wikg://lib/team/arc/archive123",
        json: true,
      },
      kind: "archive",
    });
    expect(() =>
      parseCLIArguments(["wikg://lib/abc123abc123", "inspect"]),
    ).toThrow(
      "Library-level inspection is not supported. Inspect one managed archive with `wg wikg://lib/arc/<archive-id> inspect`.",
    );
    expect(() =>
      parseCLIArguments(["wikg://lib", "inspect", "--help"]),
    ).toThrow(
      "Library-level inspection is not supported. Inspect one managed archive with `wg wikg://lib/arc/<archive-id> inspect`.",
    );
  });

  it("routes library URI and predicate help through command pages", () => {
    const scopeHelp = parseCLIArguments(["wikg://lib", "--help"]);
    const createHelp = parseCLIArguments([
      "wikg://lib/registry",
      "add",
      "--help",
    ]);
    const putHelp = parseCLIArguments(["wikg://lib/meta", "put", "--help"]);

    expect(scopeHelp).toMatchObject({
      help: true,
      kind: "help",
    });
    if (!scopeHelp.help || !createHelp.help || !putHelp.help) {
      throw new Error("Expected help output.");
    }
    expect(scopeHelp.helpText).toContain("Library scope");
    expect(createHelp.helpText).toContain("Library Predicate Command");
    expect(putHelp.helpText).toContain("Write one library metadata key");
    expect(() => parseCLIArguments(["wikg://lib", "create", "--help"])).toThrow(
      "does not support `create`",
    );
  });

  it("parses redesigned registry, path, archive collection, and tree commands", () => {
    expect(parseCLIArguments(["wikg://lib/registry", "--json"])).toMatchObject({
      args: { action: "list", json: true, target: { kind: "registry" } },
      kind: "library",
    });
    expect(parseCLIArguments(["wikg://lib/path"])).toMatchObject({
      args: { action: "get", target: { kind: "path" } },
      kind: "library",
    });
    expect(
      parseCLIArguments(["wikg://lib/path", "set", "/tmp/library", "--jsonl"]),
    ).toMatchObject({
      args: {
        action: "rebind",
        jsonl: true,
        path: "/tmp/library",
        target: { kind: "path" },
      },
      kind: "library",
    });
    expect(
      parseCLIArguments([
        "wikg://lib/arc",
        "add",
        "--input",
        "book.wikg",
        "--to",
        "nested/book.wikg",
      ]),
    ).toMatchObject({
      args: {
        action: "add",
        inputPath: "book.wikg",
        target: { kind: "archive-collection" },
        to: "nested/book.wikg",
      },
      kind: "library",
    });
    expect(
      parseCLIArguments(["wikg://lib/arc", "scan", "--jsonl"]),
    ).toMatchObject({
      args: {
        action: "scan",
        jsonl: true,
        target: { kind: "archive-collection" },
      },
      kind: "library",
    });

    expect(() =>
      parseCLIArguments(["wikg://lib/arc", "list", "--jsonl"]),
    ).toThrow("does not support --jsonl");
    expect(() =>
      parseCLIArguments(["wikg://lib/registry", "remove", "--help"]),
    ).toThrow("does not support `remove`");
    expect(() =>
      parseCLIArguments(["wikg://lib/arc/tree", "scan", "--help"]),
    ).toThrow("does not support `scan`");
    expect(
      parseCLIArguments([
        "wikg://lib/arc/tree",
        "--parent",
        "nested/book.wikg",
        "--depth",
        "2",
        "--json",
      ]),
    ).toMatchObject({
      args: {
        action: "archive-tree",
        depth: 2,
        json: true,
        parent: "nested/book.wikg",
        target: { kind: "archive-tree" },
      },
      kind: "library",
    });
    expect(() =>
      parseCLIArguments(["wikg://lib", "add", "--input", "book.wikg"]),
    ).toThrow("does not support `add`");
    expect(() => parseCLIArguments(["wikg://lib/team.lib"])).toThrow(
      ".lib suffixes are no longer supported",
    );
  });

  it("does not steal archive URIs below a lib path segment", () => {
    expect(parseCLIArguments(["wikg://lib/book.wikg"])).toMatchObject({
      args: {
        action: "list",
        archivePath: expect.stringContaining("lib/book.wikg") as string,
      },
      kind: "archive",
    });
  });

  it("routes library root query through archive search arguments", () => {
    expect(
      parseCLIArguments([
        "wikg://lib",
        "--query",
        "曹操",
        "--limit",
        "5",
        "--json",
      ]),
    ).toMatchObject({
      args: {
        action: "search",
        archivePath: "wikg://lib",
        format: "json",
        limit: 5,
        query: "曹操",
      },
      kind: "archive",
    });
  });

  it("renders archive tree depth relative to parent and streams scan JSONL archives", async () => {
    libraryMockState.archives = [
      {
        uri: "wikg://lib/arc/root",
        publicId: "root",
        libraryUri: "wikg://lib",
        relativePath: "root.wikg",
        path: "/tmp/library/root.wikg",
        exists: true,
        status: "present",
      },
      {
        uri: "wikg://lib/arc/book",
        publicId: "book",
        libraryUri: "wikg://lib",
        relativePath: "nested/book.wikg",
        path: "/tmp/library/nested/book.wikg",
        exists: true,
        status: "present",
      },
      {
        uri: "wikg://lib/arc/deep",
        publicId: "deep",
        libraryUri: "wikg://lib",
        relativePath: "nested/deeper/deep.wikg",
        path: "/tmp/library/nested/deeper/deep.wikg",
        exists: true,
        status: "present",
      },
    ];

    await runLibraryCommand({
      action: "archive-tree",
      depth: 1,
      json: true,
      parent: "nested",
      target: { isDefault: true, kind: "archive-tree" },
    });

    expect(JSON.parse(libraryMockState.textWrites[0] ?? "{}")).toStrictEqual({
      items: [
        {
          name: "book.wikg",
          path: "nested/book.wikg",
          uri: "wikg://lib/arc/book",
        },
        { name: "deeper", path: "nested/deeper" },
      ],
    });

    libraryMockState.textWrites.length = 0;
    await runLibraryCommand({
      action: "scan",
      jsonl: true,
      target: { isDefault: true, kind: "archive-collection" },
    });

    const events = libraryMockState.textWrites.map(
      (line) =>
        JSON.parse(line) as {
          readonly action?: string;
          readonly type?: string;
        },
    );
    expect(events.map((event) => event.type)).toContain("archive");
    expect(events.at(-1)).toMatchObject({ action: "scan", type: "succeeded" });
  });

  it("keeps --json as output formatting for library metadata put", async () => {
    await runLibraryCommand({
      action: "put",
      inputValue: "42",
      json: true,
      key: "title",
      target: { isDefault: true, kind: "metadata" },
    });

    expect(libraryMockState.putCalls).toStrictEqual([
      { key: "title", value: "42" },
    ]);
    expect(JSON.parse(libraryMockState.textWrites[0]!)).toStrictEqual({
      title: "42",
    });
  });

  it("renders object metadata values as JSON in text output", async () => {
    await runLibraryCommand({
      action: "put",
      jsonInputValue: '{"nested":true}',
      key: "details",
      target: { isDefault: true, kind: "metadata" },
    });

    expect(libraryMockState.putCalls).toStrictEqual([
      { key: "details", value: { nested: true } },
    ]);
    expect(libraryMockState.textWrites).toStrictEqual([
      'details: {"nested":true}\n',
    ]);
  });
});
