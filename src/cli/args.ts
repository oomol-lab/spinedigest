import { parseArgs } from "util";

import { CLI_FORMATS, type CLIFormat, parseCLIFormat } from "./formats.js";

export interface CLIArguments {
  readonly digestDirPath?: string;
  readonly help: boolean;
  readonly inputPath?: string;
  readonly inputFormat?: CLIFormat;
  readonly outputPath?: string;
  readonly outputFormat?: CLIFormat;
  readonly verbose: boolean;
}

export const SDPUB_SUBCOMMANDS = [
  "info",
  "toc",
  "list",
  "cat",
  "cover",
] as const;

export type SDPubSubcommand = (typeof SDPUB_SUBCOMMANDS)[number];

export interface CLISdpubArguments {
  readonly inputPath: string;
  readonly serialId?: number;
  readonly subcommand: SDPubSubcommand;
}

export type ParsedCLIArguments =
  | {
      readonly args: CLIArguments;
      readonly help: boolean;
      readonly helpText: string;
      readonly kind: "convert";
    }
  | {
      readonly args?: CLISdpubArguments;
      readonly help: boolean;
      readonly helpText: string;
      readonly kind: "sdpub";
    };

export const CLI_HELP_TEXT = `
Usage:
  spinedigest [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>] [--digest-dir <path>] [--verbose]
  spinedigest sdpub <info|toc|list|cat|cover> --input <path> [--serial <id>]

Behavior:
  - If --input is omitted, stdin is used.
  - If --output is omitted, stdout is used.
  - stdin/stdout only support txt or markdown.
  - --verbose cannot be used together with stdout output.
  - If a format flag is omitted, the format is inferred from the file extension.
  - --digest-dir keeps the intermediate digest workspace for digest inputs.
  - --digest-dir clears the target directory before each run.
  - --verbose writes diagnostic logs to stderr.

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

export const SDPUB_HELP_TEXT = `
Usage:
  spinedigest sdpub info --input <path>
  spinedigest sdpub toc --input <path>
  spinedigest sdpub list --input <path>
  spinedigest sdpub cat --input <path> --serial <id>
  spinedigest sdpub cover --input <path>

Behavior:
  - All sdpub subcommands require --input <path>.
  - Input must be an existing .sdpub archive path.
  - Output is written to stdout.
  - cover writes raw binary cover bytes to stdout.
  - cat writes only the serial summary text to stdout.
  - cover refuses to write binary data to an interactive terminal.
`.trim();

export function parseCLIArguments(
  argv = process.argv.slice(2),
): ParsedCLIArguments {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      help: {
        short: "h",
        type: "boolean",
      },
      "digest-dir": {
        type: "string",
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
      serial: {
        type: "string",
      },
      verbose: {
        short: "v",
        type: "boolean",
      },
    },
    strict: true,
  });

  if (positionals[0] === "sdpub") {
    return parseSdpubArguments(positionals.slice(1), values);
  }

  if (positionals.length > 0) {
    throw new Error(
      `Unexpected positional arguments: ${positionals.join(" ")}. Use --input and --output instead.`,
    );
  }

  return {
    args: {
      ...(values["digest-dir"] === undefined
        ? {}
        : { digestDirPath: values["digest-dir"] }),
      help: values.help ?? false,
      ...(values.input === undefined ? {} : { inputPath: values.input }),
      ...(values["input-format"] === undefined
        ? {}
        : {
            inputFormat: parseCLIFormat(
              values["input-format"],
              "--input-format",
            ),
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
      verbose: values.verbose ?? false,
    },
    help: values.help ?? false,
    helpText: CLI_HELP_TEXT,
    kind: "convert",
  };
}

function parseSdpubArguments(
  positionals: readonly string[],
  values: {
    readonly "digest-dir"?: string;
    readonly help?: boolean;
    readonly input?: string;
    readonly "input-format"?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly serial?: string;
    readonly verbose?: boolean;
  },
): ParsedCLIArguments {
  const help = values.help ?? false;
  const subcommand = positionals[0];

  if (positionals.length > 1) {
    throw new Error(
      `Unexpected positional arguments: ${positionals.slice(1).join(" ")}.`,
    );
  }

  if (subcommand === undefined) {
    if (help) {
      return {
        help: true,
        helpText: SDPUB_HELP_TEXT,
        kind: "sdpub",
      };
    }

    throw new Error(
      `Missing sdpub subcommand. Expected one of ${SDPUB_SUBCOMMANDS.join(", ")}.`,
    );
  }

  if (!SDPUB_SUBCOMMANDS.includes(subcommand as SDPubSubcommand)) {
    throw new Error(
      `Invalid sdpub subcommand: ${subcommand}. Expected one of ${SDPUB_SUBCOMMANDS.join(", ")}.`,
    );
  }

  const parsedSubcommand = subcommand as SDPubSubcommand;

  if (values["digest-dir"] !== undefined) {
    throw new Error(
      "The `sdpub` subcommands do not support --digest-dir. Use the main command for digest generation.",
    );
  }
  if (values["input-format"] !== undefined) {
    throw new Error(
      "The `sdpub` subcommands do not support --input-format. They always read .sdpub archives.",
    );
  }
  if (values.output !== undefined) {
    throw new Error(
      "The `sdpub` subcommands do not support --output. Use stdout redirection or pipes instead.",
    );
  }
  if (values["output-format"] !== undefined) {
    throw new Error(
      "The `sdpub` subcommands do not support --output-format. Their output format is fixed by the subcommand.",
    );
  }
  if (values.verbose) {
    throw new Error("The `sdpub` subcommands do not support --verbose.");
  }

  const serialId =
    values.serial === undefined
      ? undefined
      : parseSerialId(values.serial, "--serial");

  if (parsedSubcommand === "cat" && serialId === undefined && !help) {
    throw new Error("Missing --serial. `spinedigest sdpub cat` requires it.");
  }
  if (parsedSubcommand !== "cat" && serialId !== undefined) {
    throw new Error(
      `The \`sdpub ${parsedSubcommand}\` subcommand does not support --serial.`,
    );
  }

  const inputPath = values.input;

  if (!help) {
    if (inputPath === undefined || inputPath === "-") {
      throw new Error(
        "The `sdpub` subcommands require --input <path>. stdin is not supported.",
      );
    }
    if (parseCLIFormat("sdpub", "--input-format") !== "sdpub") {
      throw new Error("Internal error: failed to resolve sdpub input format.");
    }
  }

  return {
    ...(help || inputPath === undefined || inputPath === "-"
      ? {}
      : {
          args: {
            inputPath,
            ...(serialId === undefined ? {} : { serialId }),
            subcommand: parsedSubcommand,
          } satisfies CLISdpubArguments,
        }),
    help,
    helpText: SDPUB_HELP_TEXT,
    kind: "sdpub",
  };
}

function parseSerialId(value: string, flag: string): number {
  const normalized = value.trim();

  if (!/^\d+$/u.test(normalized)) {
    throw new Error(
      `Invalid ${flag}: ${value}. Expected a non-negative integer.`,
    );
  }

  return Number(normalized);
}
