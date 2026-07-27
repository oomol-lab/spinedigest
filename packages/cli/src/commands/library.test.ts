import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

import {
  addWikiGraphLibraryArchive,
  parseWikiGraphLibraryUri,
} from "../../../core/src/index.js";
import { withWikiGraphStateDirectoryPathForTesting } from "../../../core/src/runtime/common/wiki-graph/dir.js";
import { runLibraryCommand } from "./library.js";
import { createEmptyArchive } from "./test-helpers.js";

describe("library command", () => {
  it("filters archive tree by file parent without changing the display root", async () => {
    await withLibraryCommandTestState(async (tempDir) => {
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const source = join(tempDir, "source.wikg");
      await createEmptyArchive({ path: source, tempDir });
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
});

async function withLibraryCommandTestState(
  operation: (tempDir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "wikigraph-cli-library-test-"));

  try {
    await withWikiGraphStateDirectoryPathForTesting(
      join(tempDir, "state"),
      async () => {
        await operation(tempDir);
      },
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
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
