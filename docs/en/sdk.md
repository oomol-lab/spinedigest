English | [中文](../zh-CN/sdk.md)

# SDK

This document describes how to use Wiki Graph through `wiki-graph-core`. Use
the SDK when an application needs to create, read, query, or maintain `.wikg`
archives without shelling out to the `wg` CLI. Core is runtime-neutral: the
host provides `File` and `Directory` implementations, while the Node-only
filesystem, SQLite, and ZIP wiring remains private to the CLI.

## Packages

Install the SDK package when code needs programmatic access:

```bash
$ npm install wiki-graph-core
# or
$ pnpm add wiki-graph-core
```

Install the CLI package when a user should receive the `wg` command:

```bash
$ npm install -g wiki-graph
# or
$ pnpm add --global wiki-graph
```

The installed CLI command is self-contained for normal `wg` usage. Application
code should depend on `wiki-graph-core` directly when it needs the core SDK. If
an application uses the `wiki-graph` package's programmatic CLI runner entry, it
should install both `wiki-graph` and `wiki-graph-core` so the runner can share
the same core package as the application.

## Main SDK

The main entrypoint is `wiki-graph-core`. It exposes archive sessions, archive query helpers, chapter operations, queue control, and shared types.

### Host storage

Before opening or creating archives, install two host-owned directory roots:

```ts
import {
  installWikiGraphPlatform,
  WikiGraph,
  type Directory,
  type File,
  type WikiGraphPlatform,
} from "wiki-graph-core";

installWikiGraphPlatform(myPlatform satisfies WikiGraphPlatform);

const storage = {
  library: myLibraryDirectory satisfies Directory,
  documentStore: myDocumentDirectory satisfies Directory,
};
const wikiGraph = new WikiGraph({ storage });

const archive = myArchiveFile satisfies File;
await wikiGraph.openSession(archive, (session) => session.readMeta());
```

`File`/`Directory` are platform primitives. Core never interprets their URI or
absolute path; browser and extension hosts can back them with IndexedDB,
OPFS, or another scoped store. The `wiki-graph` CLI supplies the Node adapter.
Each `File.identity` and `Directory.identity` is a stable, opaque coordination
key—not a path or URI.
Archive SQLite workspaces are created only below the supplied `documentStore`
and are removed after the archive session settles.
`WikiGraphPlatform` is process-wide host infrastructure for async context,
database, and ZIP operations, so an application installs it once after import.
The two storage roots belong to each `WikiGraph` instance and remain isolated
when instances run concurrently.

```ts
import { WikiGraph } from "wiki-graph-core";

const wikiGraph = new WikiGraph({});

await wikiGraph.digestTextStreamSession(
  {
    stream: ["Alpha is connected to beta.\n"],
    targetStage: "planned",
    title: "Research note",
  },
  async (archive) => {
    await archive.saveAs("research.wikg");
  },
);

await wikiGraph.openSession("research.wikg", async (archive) => {
  console.log(await archive.readMeta());
});
```

`targetStage: "planned"` creates an archive without calling an LLM. Stages that build a Reading Graph, Summary, or Knowledge Graph require LLM configuration.

## LLM Configuration

`WikiGraph` accepts any AI SDK `LanguageModel`. The SDK does not read CLI config files; applications pass their own model and runtime options.

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { WikiGraph } from "wiki-graph-core";

const openai = createOpenAI({
  apiKey: "<your-openai-api-key>",
});

const wikiGraph = new WikiGraph({
  llm: {
    cacheDirPath: ".wikigraph-cache",
    concurrent: 3,
    logDirPath: ".wikigraph-logs",
    model: openai("gpt-4.1-mini"),
  },
});
```

Wiki Graph does not automatically read `OPENAI_API_KEY` or any CLI provider
configuration. Your application owns credential loading and must pass its fully
configured AI SDK `LanguageModel` through the `WikiGraph` `llm` option.

## Queue Control

Queue control belongs to the main SDK because callers may add, inspect, pause, resume, cancel, and clean jobs from an application process.

```ts
import { addBuildJob, listBuildJobs } from "wiki-graph-core";

const job = await addBuildJob({
  archivePath: "research.wikg",
  target: "knowledge-graph",
});

console.log(job.jobId);
console.log(await listBuildJobs({ archivePath: "research.wikg" }));
```

Adding a job does not spawn a worker. Process management is intentionally left to the application or CLI.

## Worker SDK

Use `wiki-graph-core/worker` only inside a process that is already meant to run queued build work. This entrypoint does not create a process.

```ts
import { runBuildJobWorker } from "wiki-graph-core/worker";

await runBuildJobWorker({
  concurrency: 1,
  executeJob: async (job, reporter, context) => {
    // Applications provide the job execution policy here.
    // The CLI wires this to Wiki Graph's built-in generation pipeline.
    context.signal.throwIfAborted();
    await reporter.stepStarted(job.target);
    await reporter.stepCompleted(job.target);
  },
});
```

Most applications should either use the CLI for background generation or provide their own worker process entrypoint that calls this SDK function.

## GC SDK

Use `wiki-graph-core/gc` inside a process that should perform local Wiki Graph cleanup.

```ts
import { tryRunWikiGraphGc } from "wiki-graph-core/gc";

const report = await tryRunWikiGraphGc({
  dryRun: false,
  force: false,
});

console.log(report);
```

The GC SDK runs cleanup in the current process. It does not spawn or schedule another process.

## Process Boundary

The SDK has three process-local surfaces:

- `wiki-graph-core`: application and queue-control APIs.
- `wiki-graph-core/worker`: build worker APIs for an already-started worker process.
- `wiki-graph-core/gc`: cleanup APIs for an already-started GC process.

Process creation is outside the SDK. The `wg` CLI uses its own private worker entrypoint for background jobs; applications should do the same if they need background workers.

## Related Documents

- [`.wikg` Archive Standard](./wikg-standard.md)
- [WikiSpine Runtime](../wikispine-runtime.md)
