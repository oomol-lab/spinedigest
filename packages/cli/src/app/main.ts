import {
  runWikiGraphCLIWithEntryPolicy,
  type RunWikiGraphCLIInput,
} from "./runner.js";
import type { WikiGraphEntryEnvPolicy } from "../runtime/entry-context.js";

export async function main(
  input: RunWikiGraphCLIInput = {},
  envPolicy: WikiGraphEntryEnvPolicy = "production",
): Promise<void> {
  const result = await runWikiGraphCLIWithEntryPolicy(input, envPolicy);
  process.exitCode = result.exitCode;
}
