import { CLI_HELP_TEXT, parseCLIArguments } from "./args.js";
import { runConvertCommand } from "./convert.js";
import { formatError } from "../utils/node-error.js";

export async function main(): Promise<void> {
  try {
    const args = parseCLIArguments();

    if (args.help) {
      process.stdout.write(`${CLI_HELP_TEXT}\n`);
      return;
    }

    await runConvertCommand(args);
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  }
}
