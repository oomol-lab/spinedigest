import {
  deleteArchiveSearchSessions,
  isArchiveSearchIndexCurrent,
  readSearchIndexCapabilityStatus,
  rebuildArchiveSearchIndex,
  type SearchIndexBuildOptions,
} from "wiki-graph-core";
import { readArchiveIndexSettings, setFtsIndexEmbedded } from "wiki-graph-core";
import { WikiGraphArchiveFile } from "wiki-graph-core";

import type { CLIArchiveIndexArguments } from "../../args/index.js";
import { writeTextToStdout } from "../../support/index.js";
import { formatCLIJSON } from "../../support/index.js";
import {
  ProgressOutputWriter,
  type ProgressCounter,
} from "../../runtime/index.js";
import { loadCLIConfig } from "../../runtime/config.js";
import { buildSearchIndexEmbeddingProvider } from "../../runtime/embedding.js";
import { writeArchiveDocument } from "./run/document.js";
import { resolveArchiveRuntimeLocation } from "./run/uri.js";

const INDEX_PROGRESS_OUTPUT_INTERVAL_MS = 6_000;

export async function runArchiveIndexCommand(
  args: CLIArchiveIndexArguments,
): Promise<void> {
  switch (args.action) {
    case "get":
      await readIndexSettings(args);
      return;
    case "enable":
      await enableIndex(args);
      return;
    case "embed":
      await embedIndex(args);
      return;
    case "external":
      await externalizeIndex(args);
      return;
    case "disable":
      await disableIndex(args);
      return;
  }
}

async function readIndexSettings(
  args: CLIArchiveIndexArguments,
): Promise<void> {
  const location = await resolveArchiveRuntimeLocation(args.archivePath);
  await new WikiGraphArchiveFile(location.archivePath).readDocument(
    async (document) => {
      const settings = await readArchiveIndexSettings(document);

      await writeIndexOutput(
        args,
        await readIndexOutputPayload(document, settings.ftsEmbedded),
      );
    },
  );
}

async function enableIndex(args: CLIArchiveIndexArguments): Promise<void> {
  const buildOptions = await createSearchIndexBuildOptions(args.indexes);
  const writer = new ProgressOutputWriter({
    jsonl: args.jsonl ?? false,
    throttleMs: INDEX_PROGRESS_OUTPUT_INTERVAL_MS,
  });

  await writeArchiveDocument(
    args.archivePath,
    async (document) => {
      await writer.write({
        json: { type: "started" },
        kind: "lifecycle",
        text: `index enable started\nindexes: ${buildOptions.indexes ?? "auto"}\nsteps: ${formatIndexEnableSteps(buildOptions).join(" -> ")}`,
      });
      await writer.write({
        json: { phase: "checking", type: "status_snapshot" },
        kind: "status",
        phase: "checking",
      });

      if (await isRequestedSearchIndexAlreadyCurrent(document, buildOptions)) {
        await writer.write({
          json: { type: "already-current" },
          kind: "lifecycle",
          text: "already current",
        });
      } else {
        await rebuildArchiveSearchIndex(
          document,
          async (event) => {
            await writer.write({
              counters:
                event.done === undefined || event.total === undefined
                  ? []
                  : [formatIndexCounter(event)],
              json: {
                counters:
                  event.done === undefined || event.total === undefined
                    ? []
                    : [formatIndexCounter(event)],
                phase: event.phase,
                type: "status_snapshot",
              },
              kind: "status",
              phase: event.phase,
            });
          },
          buildOptions,
        );
      }

      await writer.write({
        json: { type: "completed" },
        kind: "lifecycle",
        text: "index enabled",
      });
      await writer.write({
        json: { type: "succeeded" },
        kind: "lifecycle",
        text: "succeeded",
      });
    },
    {
      searchIndexWritebackPolicy: await readSearchIndexWritebackPolicy(
        args.archivePath,
      ),
    },
  );
  await deleteArchiveSearchSessions(args.archivePath);
}

async function isRequestedSearchIndexAlreadyCurrent(
  document: Parameters<typeof isArchiveSearchIndexCurrent>[0],
  options: SearchIndexBuildOptions,
): Promise<boolean> {
  if (!(await isArchiveSearchIndexCurrent(document))) {
    return false;
  }

  const capabilities = await readSearchIndexCapabilityStatus(document);

  if (options.indexes === "fts") {
    return capabilities.indexes === "fts";
  }
  if (options.embeddingProvider === undefined) {
    return capabilities.indexes === "fts";
  }

  if (options.indexes === "dense") {
    return (
      capabilities.indexes === "dense" &&
      capabilities.dense.current &&
      (options.embeddingProvider.dimensions === undefined ||
        capabilities.dense.dimensions === options.embeddingProvider.dimensions)
    );
  }

  return (
    capabilities.indexes === "fts,dense" &&
    capabilities.dense.current &&
    capabilities.dense.model === options.embeddingProvider.model &&
    (options.embeddingProvider.dimensions === undefined ||
      capabilities.dense.dimensions === options.embeddingProvider.dimensions)
  );
}

async function createSearchIndexBuildOptions(
  indexes: CLIArchiveIndexArguments["indexes"],
): Promise<SearchIndexBuildOptions> {
  if (indexes === "fts") {
    return { indexes };
  }

  const config = await loadCLIConfig();

  if (config.embedding === undefined) {
    if (indexes === "dense" || indexes === "fts,dense") {
      throw new Error(
        `Missing embeddings configuration. Configure \`wikg://local/config/embeddings\` before using --indexes ${indexes}.`,
      );
    }
    return { indexes: indexes ?? "auto" };
  }

  return {
    embeddingProvider: buildSearchIndexEmbeddingProvider(config.embedding),
    indexes: indexes ?? "auto",
  };
}

function formatIndexEnableSteps(
  options: SearchIndexBuildOptions,
): readonly string[] {
  return [
    "checking",
    "collecting",
    "clearing",
    "indexing-text",
    "indexing-objects",
    ...(options.embeddingProvider === undefined ? [] : ["indexing-dense"]),
    "finalizing",
  ];
}

async function embedIndex(args: CLIArchiveIndexArguments): Promise<void> {
  let built = false;

  await writeArchiveDocument(
    args.archivePath,
    async (document) => {
      await setFtsIndexEmbedded(document, true);
      if (await isArchiveSearchIndexCurrent(document)) {
        await document.writeSearchIndexDatabase(async (database) => {
          await database.run(
            "UPDATE search_index_state SET value = value WHERE key = 'version'",
          );
        });
      } else {
        await rebuildArchiveSearchIndex(document);
        built = true;
      }
      await writeIndexOutput(args, {
        ...(await readIndexOutputPayload(document, true)),
        built,
      });
    },
    { searchIndexWritebackPolicy: "archive" },
  );
  await deleteArchiveSearchSessions(args.archivePath);
}

async function externalizeIndex(args: CLIArchiveIndexArguments): Promise<void> {
  await writeArchiveDocument(
    args.archivePath,
    async (document) => {
      await setFtsIndexEmbedded(document, false);
      await document.deleteSearchIndexDatabase();
      await writeIndexOutput(args, {
        capabilities: { dense: { current: false }, indexes: "missing" },
        ftsEmbedded: false,
        ftsCurrent: false,
      });
    },
    { searchIndexWritebackPolicy: "archive" },
  );
  await deleteArchiveSearchSessions(args.archivePath);
}

async function disableIndex(args: CLIArchiveIndexArguments): Promise<void> {
  await writeArchiveDocument(
    args.archivePath,
    async (document) => {
      await document.deleteSearchIndexDatabase();
      const settings = await readArchiveIndexSettings(document);

      await writeIndexOutput(args, {
        capabilities: { dense: { current: false }, indexes: "missing" },
        ftsEmbedded: settings.ftsEmbedded,
        ftsCurrent: false,
      });
    },
    {
      searchIndexWritebackPolicy: await readSearchIndexWritebackPolicy(
        args.archivePath,
      ),
    },
  );
  await deleteArchiveSearchSessions(args.archivePath);
}

async function readSearchIndexWritebackPolicy(
  archivePath: string,
): Promise<"archive" | "cache"> {
  let embedded = false;
  const location = await resolveArchiveRuntimeLocation(archivePath);

  await new WikiGraphArchiveFile(location.archivePath).readDocument(
    async (document) => {
      embedded = (await readArchiveIndexSettings(document)).ftsEmbedded;
    },
  );

  return embedded ? "archive" : "cache";
}

async function readIndexOutputPayload(
  document: Parameters<typeof isArchiveSearchIndexCurrent>[0],
  ftsEmbedded: boolean,
): Promise<{
  readonly capabilities: Awaited<
    ReturnType<typeof readSearchIndexCapabilityStatus>
  >;
  readonly ftsCurrent: boolean;
  readonly ftsEmbedded: boolean;
}> {
  const [capabilities, indexCurrent] = await Promise.all([
    readSearchIndexCapabilityStatus(document),
    isArchiveSearchIndexCurrent(document),
  ]);

  return {
    capabilities,
    ftsEmbedded,
    ftsCurrent:
      indexCurrent &&
      (capabilities.indexes === "fts" || capabilities.indexes === "fts,dense"),
  };
}

function formatIndexCounter(input: {
  readonly done?: number;
  readonly total?: number;
  readonly unit?: "chapter" | "object" | "sentence" | "vector";
}): ProgressCounter {
  return {
    done: input.done ?? 0,
    name: formatIndexCounterName(input.unit),
    total: input.total ?? 0,
    unit: formatIndexUnit(input.unit),
  };
}

function formatIndexCounterName(
  unit: "chapter" | "object" | "sentence" | "vector" | undefined,
): string {
  switch (unit) {
    case "chapter":
      return "chapters";
    case "object":
      return "objects";
    case "sentence":
      return "sentences";
    case "vector":
      return "vectors";
    case undefined:
      return "items";
  }
}

function formatIndexUnit(
  unit: "chapter" | "object" | "sentence" | "vector" | undefined,
): string {
  switch (unit) {
    case "chapter":
      return "chapters";
    case "object":
      return "objects";
    case "sentence":
      return "sentences";
    case "vector":
      return "vectors";
    case undefined:
      return "items";
  }
}

async function writeIndexOutput(
  args: CLIArchiveIndexArguments,
  payload: {
    readonly built?: boolean;
    readonly capabilities: Awaited<
      ReturnType<typeof readSearchIndexCapabilityStatus>
    >;
    readonly ftsCurrent: boolean;
    readonly ftsEmbedded: boolean;
  },
): Promise<void> {
  if (args.json === true) {
    await writeTextToStdout(formatCLIJSON(payload));
    return;
  }

  await writeTextToStdout(
    [
      `Enabled indexes: ${payload.capabilities.indexes}`,
      `FTS embedded: ${payload.ftsEmbedded ? "yes" : "no"}`,
      `FTS current: ${payload.ftsCurrent ? "yes" : "no"}`,
      `Dense current: ${payload.capabilities.dense.current ? "yes" : "no"}`,
      ...(payload.capabilities.dense.model === undefined
        ? []
        : [`Dense model: ${payload.capabilities.dense.model}`]),
      ...(payload.capabilities.dense.dimensions === undefined
        ? []
        : [`Dense dimensions: ${payload.capabilities.dense.dimensions}`]),
      ...(payload.built === undefined
        ? []
        : [`Built: ${payload.built ? "yes" : "no"}`]),
      "",
    ].join("\n"),
  );
}
