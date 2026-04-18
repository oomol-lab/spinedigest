import { describe, expect, it } from "vitest";

import {
  CLI_HELP_TEXT,
  SDPUB_HELP_TEXT,
  parseCLIArguments,
} from "../../src/cli/args.js";

describe("cli/args", () => {
  it("parses help and io flags with normalized formats", () => {
    expect(
      parseCLIArguments([
        "--help",
        "--digest-dir",
        "/tmp/digest",
        "--input",
        "book.epub",
        "--input-format",
        " EPUB ",
        "--output",
        "out.txt",
        "--output-format",
        "markdown",
        "--prompt",
        "Keep named entities",
      ]),
    ).toStrictEqual({
      args: {
        digestDirPath: "/tmp/digest",
        help: true,
        inputFormat: "epub",
        inputPath: "book.epub",
        outputFormat: "markdown",
        outputPath: "out.txt",
        prompt: "Keep named entities",
        verbose: false,
      },
      help: true,
      helpText: CLI_HELP_TEXT,
      kind: "convert",
    });
  });

  it("omits undefined optional arguments", () => {
    expect(parseCLIArguments([])).toStrictEqual({
      args: {
        help: false,
        verbose: false,
      },
      help: false,
      helpText: CLI_HELP_TEXT,
      kind: "convert",
    });
  });

  it("parses --verbose", () => {
    expect(parseCLIArguments(["--verbose"])).toStrictEqual({
      args: {
        help: false,
        verbose: true,
      },
      help: false,
      helpText: CLI_HELP_TEXT,
      kind: "convert",
    });
  });

  it("parses --prompt for the main convert command", () => {
    expect(parseCLIArguments(["--prompt", "Keep dialogue only"])).toStrictEqual(
      {
        args: {
          help: false,
          prompt: "Keep dialogue only",
          verbose: false,
        },
        help: false,
        helpText: CLI_HELP_TEXT,
        kind: "convert",
      },
    );
  });

  it("parses sdpub subcommands", () => {
    expect(
      parseCLIArguments([
        "sdpub",
        "cat",
        "--input",
        "book.sdpub",
        "--serial",
        "12",
      ]),
    ).toStrictEqual({
      args: {
        inputPath: "book.sdpub",
        serialId: 12,
        subcommand: "cat",
      },
      help: false,
      helpText: SDPUB_HELP_TEXT,
      kind: "sdpub",
    });
  });

  it("prints sdpub help text", () => {
    expect(parseCLIArguments(["sdpub", "--help"])).toStrictEqual({
      help: true,
      helpText: SDPUB_HELP_TEXT,
      kind: "sdpub",
    });
  });

  it("rejects positional arguments", () => {
    expect(() => parseCLIArguments(["book.epub"])).toThrow(
      "Unexpected positional arguments: book.epub. Use --input and --output instead.",
    );
  });

  it("rejects invalid format flags", () => {
    expect(() => parseCLIArguments(["--input-format", "pdf"])).toThrow(
      "Invalid --input-format: pdf. Expected one of sdpub, epub, txt, markdown.",
    );
    expect(() => parseCLIArguments(["--output-format", "pdf"])).toThrow(
      "Invalid --output-format: pdf. Expected one of sdpub, epub, txt, markdown.",
    );
  });

  it("rejects invalid sdpub usage", () => {
    expect(() => parseCLIArguments(["sdpub"])).toThrow(
      "Missing sdpub subcommand. Expected one of info, toc, list, cat, cover.",
    );
    expect(() => parseCLIArguments(["sdpub", "inspect"])).toThrow(
      "Invalid sdpub subcommand: inspect. Expected one of info, toc, list, cat, cover.",
    );
    expect(() =>
      parseCLIArguments(["sdpub", "info", "--output", "out.txt"]),
    ).toThrow(
      "The `sdpub` subcommands do not support --output. Use stdout redirection or pipes instead.",
    );
    expect(() =>
      parseCLIArguments(["sdpub", "info", "--prompt", "Keep dialogue only"]),
    ).toThrow(
      "The `sdpub` subcommands do not support --prompt. It only applies to digest generation from source inputs.",
    );
    expect(() =>
      parseCLIArguments(["sdpub", "cat", "--input", "book.sdpub"]),
    ).toThrow("Missing --serial. `spinedigest sdpub cat` requires it.");
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "list",
        "--input",
        "book.sdpub",
        "--serial",
        "2",
      ]),
    ).toThrow("The `sdpub list` subcommand does not support --serial.");
    expect(() =>
      parseCLIArguments([
        "sdpub",
        "cat",
        "--input",
        "book.sdpub",
        "--serial",
        "x",
      ]),
    ).toThrow("Invalid --serial: x. Expected a non-negative integer.");
  });

  it("documents the supported command-line contract", () => {
    expect(CLI_HELP_TEXT).toContain(
      "stdin/stdout only support txt or markdown",
    );
    expect(CLI_HELP_TEXT).toContain(
      "spinedigest sdpub <info|toc|list|cat|cover>",
    );
    expect(CLI_HELP_TEXT).toContain("--digest-dir keeps the intermediate");
    expect(CLI_HELP_TEXT).toContain(
      "--digest-dir clears the target directory before each run",
    );
    expect(CLI_HELP_TEXT).toContain(
      "--prompt overrides config/env extraction prompts",
    );
    expect(CLI_HELP_TEXT).toContain(
      "--verbose writes diagnostic logs to stderr",
    );
    expect(CLI_HELP_TEXT).toContain(
      "--verbose cannot be used together with stdout output",
    );
    expect(CLI_HELP_TEXT).toContain("SPINEDIGEST_LLM_MODEL");
    expect(SDPUB_HELP_TEXT).toContain("cover writes raw binary cover bytes");
  });
});
