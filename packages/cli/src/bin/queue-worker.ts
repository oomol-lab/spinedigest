#!/usr/bin/env node

import { installNodeWikiGraphPlatform } from "../runtime/node-platform.js";
installNodeWikiGraphPlatform();
const { runQueueWorker } = await import("../commands/index.js");
const { withWorkerEntryRuntime } = await import("../runtime/worker-entry.js");

async function main(): Promise<void> {
  await withWorkerEntryRuntime(
    "queue-worker",
    async () => await runQueueWorker(),
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
