import {
  runWikiGraphCLIWithEntryPolicy,
  type RunWikiGraphCLIInput,
} from "./runner.js";
import type { WikiGraphEntryEnvPolicy } from "../runtime/entry-context.js";
import { installNodeWikiGraphPlatform } from "../runtime/node-platform.js";

export async function main(
  input: RunWikiGraphCLIInput = {},
  envPolicy: WikiGraphEntryEnvPolicy = "production",
): Promise<void> {
  installNodeWikiGraphPlatform();
  const result = await runWikiGraphCLIWithEntryPolicy(input, envPolicy);
  process.exitCode = result.exitCode;
}
