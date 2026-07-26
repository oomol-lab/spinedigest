#!/usr/bin/env node

import { runQueueWorker } from "../commands/index.js";
import { withWorkerEntryRuntime } from "../runtime/worker-entry.js";

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
