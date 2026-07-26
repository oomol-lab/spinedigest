#!/usr/bin/env node

import { tryRunWikiGraphGc } from "wiki-graph-core/gc";

import { withWorkerEntryRuntime } from "../runtime/worker-entry.js";
import { formatCLIJSON } from "../support/index.js";

async function main(): Promise<void> {
  await withWorkerEntryRuntime("gc-worker", async ({ argv }) => {
    const args = parseGcWorkerArguments(argv);
    process.stdout.write(
      formatCLIJSON(
        await tryRunWikiGraphGc({
          dryRun: args.dryRun,
          force: args.force,
        }),
      ),
    );
  });
}

function parseGcWorkerArguments(argv: readonly string[]): {
  readonly dryRun: boolean;
  readonly force: boolean;
} {
  return {
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
  };
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
