import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addWikiGraphLibraryArchive,
  DirectoryDocument,
  parseWikiGraphLibraryUri,
  TOC_FILE_VERSION,
  writeWikgArchive,
} from "wiki-graph-core";
import {
  getWikiGraphStateDirectoryPathForTesting,
  setWikiGraphStateDirectoryPathForTesting,
} from "../../../core/src/runtime/common/wiki-graph/dir.js";
import { runLibraryCommand } from "./library.js";

let previousStateDir: string | undefined;
let tempDir: string;

beforeEach(async () => {
  previousStateDir = getWikiGraphStateDirectoryPathForTesting();
  tempDir = await mkdtemp(join(tmpdir(), "wikigraph-cli-library-test-"));
  setWikiGraphStateDirectoryPathForTesting(join(tempDir, "state"));
});

afterEach(async () => {
  setWikiGraphStateDirectoryPathForTesting(previousStateDir);
  await rm(tempDir, { force: true, recursive: true });
});

describe("library command", () => {
  it("filters archive tree by file parent without changing the display root", async () => {
    const target = parseWikiGraphLibraryUri("wikg://lib");
    expect(target).toBeDefined();
    const source = join(tempDir, "source.wikg");
    await createEmptyArchive(source);
    const archive = await addWikiGraphLibraryArchive({
      inputPath: source,
      target: target!,
      to: "nested/book.wikg",
    });

    await addWikiGraphLibraryArchive({
      inputPath: source,
      target: target!,
      to: "other.wikg",
    });

    const output = await captureStdout(async () => {
      await runLibraryCommand({
        action: "archive-tree",
        json: true,
        parent: "nested/book.wikg",
        target: { isDefault: true, kind: "archive-tree" },
      });
    });

    expect(JSON.parse(output)).toStrictEqual({
      items: [
        {
          children: [
            {
              children: [],
              name: "book.wikg",
              path: "nested/book.wikg",
              uri: archive.uri,
            },
          ],
          name: "nested",
          path: "nested",
        },
      ],
    });

    const textOutput = await captureStdout(async () => {
      await runLibraryCommand({
        action: "archive-tree",
        parent: "nested/book.wikg",
        target: { isDefault: true, kind: "archive-tree" },
      });
    });

    expect(textOutput).toBe(`└─ nested\n   └─ book.wikg (${archive.uri})\n`);
  });
});

async function createEmptyArchive(path: string): Promise<void> {
  const sourceDir = await mkdtemp(join(tempDir, "wikg-source-"));
  const document = await DirectoryDocument.open(sourceDir);
  try {
    try {
      await document.openSession(async (openedDocument) => {
        await openedDocument.writeToc({ items: [], version: TOC_FILE_VERSION });
      });
    } finally {
      await document.release();
    }
    await writeWikgArchive(sourceDir, path);
  } finally {
    await rm(sourceDir, { force: true, recursive: true });
  }
}

async function captureStdout(operation: () => Promise<void>): Promise<string> {
  let output = "";
  const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) => {
    output += String(chunk);
    if (typeof encodingOrCallback === "function") {
      encodingOrCallback();
    } else {
      callback?.();
    }
    return true;
  }) as typeof process.stdout.write);
  try {
    await operation();
  } finally {
    stdoutWrite.mockRestore();
  }
  return output;
}
