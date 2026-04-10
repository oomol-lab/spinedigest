import { parseArgs } from "util";

import { CLI_FORMATS, type CLIFormat, parseCLIFormat } from "./formats.js";

export interface CLIArguments {
  readonly help: boolean;
  readonly inputPath?: string;
  readonly inputFormat?: CLIFormat;
  readonly outputPath?: string;
  readonly outputFormat?: CLIFormat;
}

export const CLI_HELP_TEXT = `
Usage:
  spinedigest [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>]

Behavior:
  - If --input is omitted, stdin is used.
  - If --output is omitted, stdout is used.
  - stdin/stdout only support txt or markdown.
  - If a format flag is omitted, the format is inferred from the file extension.

Formats:
  ${CLI_FORMATS.join(", ")}

Configuration:
  Config file: ~/.spinedigest/config.json
  Override path: SPINEDIGEST_CONFIG

Important env vars:
  SPINEDIGEST_PROMPT
  SPINEDIGEST_LLM_PROVIDER
  SPINEDIGEST_LLM_MODEL
  SPINEDIGEST_LLM_BASE_URL
  SPINEDIGEST_LLM_NAME
  SPINEDIGEST_LLM_API_KEY
  SPINEDIGEST_CACHE_DIR
  SPINEDIGEST_DEBUG_LOG_DIR
  SPINEDIGEST_REQUEST_CONCURRENT
  SPINEDIGEST_REQUEST_TIMEOUT
  SPINEDIGEST_REQUEST_RETRY_TIMES
  SPINEDIGEST_REQUEST_RETRY_INTERVAL_SECONDS
  SPINEDIGEST_REQUEST_TEMPERATURE
  SPINEDIGEST_REQUEST_TOP_P
`.trim();

export function parseCLIArguments(argv = process.argv.slice(2)): CLIArguments {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      help: {
        short: "h",
        type: "boolean",
      },
      input: {
        type: "string",
      },
      "input-format": {
        type: "string",
      },
      output: {
        type: "string",
      },
      "output-format": {
        type: "string",
      },
    },
    strict: true,
  });

  if (positionals.length > 0) {
    throw new Error(
      `Unexpected positional arguments: ${positionals.join(" ")}. Use --input and --output instead.`,
    );
  }

  return {
    help: values.help ?? false,
    ...(values.input === undefined ? {} : { inputPath: values.input }),
    ...(values["input-format"] === undefined
      ? {}
      : {
          inputFormat: parseCLIFormat(values["input-format"], "--input-format"),
        }),
    ...(values.output === undefined ? {} : { outputPath: values.output }),
    ...(values["output-format"] === undefined
      ? {}
      : {
          outputFormat: parseCLIFormat(
            values["output-format"],
            "--output-format",
          ),
        }),
  };
}
