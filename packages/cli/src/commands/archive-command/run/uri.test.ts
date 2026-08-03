import { randomUUID } from "crypto";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addWikiGraphLibraryArchive,
  createWikiGraphLibrary,
  parseWikiGraphLibraryUri,
  readWikiGraphLibraryIndexState,
  rebuildArchiveSearchIndex,
  rebuildWikiGraphLibraryIndex,
  replaceChapterFtsIndexArtifact,
  WikiGraphArchiveFile,
} from "../../../../../core/src/index.js";
import {
  getWikiGraphStateDirectoryPathForTesting,
  setWikiGraphStateDirectoryPathForTesting,
} from "../../../../../core/src/runtime/common/wiki-graph/dir.js";
import { readWikgArchiveEntry } from "../../../../../core/src/storage/wikg/archive/index.js";
import { runArchiveChapterCommand } from "../chapter.js";
import {
  resolveArchiveCommandRuntimeArguments,
  resolveArchiveRuntimeLocation,
} from "./uri.js";
import { createEmptyArchive } from "../../test-helpers.js";

let previousStateDir: string | undefined;
let tempDir: string;

beforeEach(async () => {
  previousStateDir = getWikiGraphStateDirectoryPathForTesting();
  tempDir = await mkdtemp(join(tmpdir(), "wikigraph-cli-uri-test-"));
  setWikiGraphStateDirectoryPathForTesting(join(tempDir, "state"));
});

afterEach(async () => {
  setWikiGraphStateDirectoryPathForTesting(previousStateDir);
  await rm(tempDir, { force: true, recursive: true });
});

describe("archive-command URI runtime resolution", () => {
  it("resolves library archive object URIs before running archive commands", async () => {
    const target = await createTestLibraryTarget();
    const source = join(tempDir, "book.wikg");
    await createEmptyArchive({ path: source, tempDir });
    const archive = await addWikiGraphLibraryArchive({
      inputPath: source,
      target,
      to: "books/book.wikg",
    });

    await expect(
      resolveArchiveCommandRuntimeArguments({
        action: "get",
        archivePath: `${archive.uri}/entity/Q23`,
        format: "json",
        objectId: `${archive.uri}/entity/Q23`,
      }),
    ).resolves.toStrictEqual({
      action: "get",
      archivePath: `wikg://${archive.path}/entity/Q23`,
      format: "json",
      objectId: `wikg://${archive.path}/entity/Q23`,
    });
  });

  it("keeps library archive inspect arguments displayable while runtime resolution can find the archive", async () => {
    const target = parseWikiGraphLibraryUri("wikg://lib");
    expect(target).toBeDefined();
    const archive = await addTestArchiveToLibrary(target!);

    await expect(
      resolveArchiveCommandRuntimeArguments({
        action: "inspect",
        archivePath: archive.uri,
      }),
    ).resolves.toStrictEqual({
      action: "inspect",
      archivePath: archive.uri,
    });

    await expect(
      resolveArchiveRuntimeLocation(archive.uri),
    ).resolves.toMatchObject({
      archivePath: archive.path,
      locatedUri: `wikg://${archive.path}`,
    });
  });

  it("marks a library index dirty after successful archive writes through a library locator", async () => {
    const target = await createTestLibraryTarget();
    const archive = await addTestArchiveToLibrary(target);

    await rebuildWikiGraphLibraryIndex(target);
    await expect(readWikiGraphLibraryIndexState(target)).resolves.toMatchObject(
      {
        status: "current",
      },
    );

    await runArchiveChapterCommand({ action: "add", path: archive.uri });

    await expect(readWikiGraphLibraryIndexState(target)).resolves.toMatchObject(
      {
        status: "dirty",
      },
    );
  });

  it("marks the explicit library index dirty after successful archive writes through a library locator", async () => {
    const library = await createWikiGraphLibrary({
      folderPath: join(tempDir, "team-library"),
    });
    const target = parseWikiGraphLibraryUri(library.uri);
    expect(target).toBeDefined();
    const archive = await addTestArchiveToLibrary(target!);

    await rebuildWikiGraphLibraryIndex(target!);
    await expect(
      readWikiGraphLibraryIndexState(target!),
    ).resolves.toMatchObject({
      status: "current",
    });

    await runArchiveChapterCommand({ action: "add", path: archive.uri });

    await expect(
      readWikiGraphLibraryIndexState(target!),
    ).resolves.toMatchObject({
      status: "dirty",
    });
  });

  it("does not dirty a library index for filesystem archive URI writes", async () => {
    const target = await createTestLibraryTarget();
    const archive = await addTestArchiveToLibrary(target);

    await rebuildWikiGraphLibraryIndex(target);
    await expect(readWikiGraphLibraryIndexState(target)).resolves.toMatchObject(
      {
        status: "current",
      },
    );

    await runArchiveChapterCommand({
      action: "add",
      path: `wikg://${archive.path}`,
    });

    await expect(readWikiGraphLibraryIndexState(target)).resolves.toMatchObject(
      {
        status: "current",
      },
    );
  });

  it("does not dirty a library index when an archive write fails", async () => {
    const target = await createTestLibraryTarget();
    const archive = await addTestArchiveToLibrary(target);

    await rebuildWikiGraphLibraryIndex(target);
    await expect(
      runArchiveChapterCommand({
        action: "set-title",
        path: archive.uri,
        chapterPath: "missing",
        title: "Nope",
      }),
    ).rejects.toThrow();

    await expect(readWikiGraphLibraryIndexState(target)).resolves.toMatchObject(
      {
        status: "current",
      },
    );
  });

  it("keeps index cache external during library archive URI writes", async () => {
    const target = parseWikiGraphLibraryUri("wikg://lib");
    expect(target).toBeDefined();
    const archive = await addTestArchiveToLibrary(target!);

    await new WikiGraphArchiveFile(archive.path).write(
      async (document) => {
        await replaceChapterFtsIndexArtifact(document, 1);
        await rebuildArchiveSearchIndex(document);
      },
      { searchIndexWritebackPolicy: "archive" },
    );
    await expect(
      readWikgArchiveEntry(archive.path, "index.db"),
    ).resolves.toBeUndefined();

    await runArchiveChapterCommand({ action: "add", path: archive.uri });

    await expect(readWikgArchiveEntry(archive.path, "index.db")).resolves.toBe(
      undefined,
    );
    await expect(
      readWikiGraphLibraryIndexState(target!),
    ).resolves.toMatchObject({
      status: "dirty",
    });
  });
});

async function addTestArchiveToLibrary(
  target: NonNullable<ReturnType<typeof parseWikiGraphLibraryUri>>,
): ReturnType<typeof addWikiGraphLibraryArchive> {
  const source = join(tempDir, `${randomUUID()}.wikg`);
  await createEmptyArchive({ path: source, tempDir });

  return await addWikiGraphLibraryArchive({
    inputPath: source,
    target,
    to: `${randomUUID()}.wikg`,
  });
}

async function createTestLibraryTarget(): Promise<
  NonNullable<ReturnType<typeof parseWikiGraphLibraryUri>>
> {
  const library = await createWikiGraphLibrary({
    folderPath: join(tempDir, `library-${randomUUID()}`),
  });
  const target = parseWikiGraphLibraryUri(library.uri);

  if (target === undefined) {
    throw new Error(`Invalid test library URI: ${library.uri}`);
  }

  return target;
}
