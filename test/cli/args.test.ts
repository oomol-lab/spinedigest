import { describe, expect, it } from "vitest";

import { CLI_HELP_TEXT, parseCLIArguments } from "../../src/cli/args.js";

describe("cli/args", () => {
  it("parses help and io flags with normalized formats", () => {
    expect(
      parseCLIArguments([
        "--help",
        "--input",
        "book.epub",
        "--input-format",
        " EPUB ",
        "--output",
        "out.txt",
        "--output-format",
        "markdown",
      ]),
    ).toStrictEqual({
      help: true,
      inputFormat: "epub",
      inputPath: "book.epub",
      outputFormat: "markdown",
      outputPath: "out.txt",
    });
  });

  it("omits undefined optional arguments", () => {
    expect(parseCLIArguments([])).toStrictEqual({
      help: false,
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

  it("documents the supported command-line contract", () => {
    expect(CLI_HELP_TEXT).toContain(
      "stdin/stdout only support txt or markdown",
    );
    expect(CLI_HELP_TEXT).toContain("SPINEDIGEST_LLM_MODEL");
  });
});
