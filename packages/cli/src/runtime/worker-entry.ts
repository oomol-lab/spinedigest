import { withNodeWikiGraphStorage } from "./node-platform.js";

import { createEntryRuntimeContext } from "./entry-context.js";

export interface WorkerEntryArguments {
  readonly argv: readonly string[];
  readonly internalChild: string;
  readonly stateDir?: string | undefined;
}

const INTERNAL_CHILD_FLAG = "--wikigraph-internal-child";
const STATE_DIR_FLAG = "--wikigraph-state-dir";

export async function withWorkerEntryRuntime<T>(
  expectedInternalChild: string,
  operation: (args: WorkerEntryArguments) => Promise<T> | T,
): Promise<T> {
  const args = parseWorkerEntryArguments(process.argv.slice(2));

  if (args.internalChild !== expectedInternalChild) {
    throw new Error("This Wiki Graph worker entry is internal.");
  }

  const entryContext = createEntryRuntimeContext({
    argv: args.argv,
    envPolicy: "production",
    stateDir: args.stateDir,
  });

  return await withNodeWikiGraphStorage(entryContext.stateDir, () =>
    operation(args),
  );
}

function parseWorkerEntryArguments(
  argv: readonly string[],
): WorkerEntryArguments {
  const stripped: string[] = [];
  let internalChild: string | undefined;
  let stateDir: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;

    if (arg === INTERNAL_CHILD_FLAG) {
      if (index + 1 >= argv.length) {
        throw new Error(`${INTERNAL_CHILD_FLAG} requires a value.`);
      }

      internalChild = argv[index + 1]!;
      index += 1;
      continue;
    }

    if (arg !== STATE_DIR_FLAG) {
      stripped.push(arg);
      continue;
    }

    if (index + 1 >= argv.length) {
      throw new Error(`${STATE_DIR_FLAG} requires a value.`);
    }

    stateDir = argv[index + 1]!;
    index += 1;
  }

  return {
    argv: stripped,
    internalChild: internalChild ?? "",
    stateDir,
  };
}
