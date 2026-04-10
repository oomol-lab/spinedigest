import { describe, expect, it } from "vitest";

import {
  inferCLIFormatFromPath,
  isTextCLIFormat,
  parseCLIFormat,
} from "../../src/cli/formats.js";

describe("cli/formats", () => {
  it("infers formats from file extensions", () => {
    expect(inferCLIFormatFromPath("book.epub")).toBe("epub");
    expect(inferCLIFormatFromPath("notes.md")).toBe("markdown");
    expect(inferCLIFormatFromPath("notes.markdown")).toBe("markdown");
    expect(inferCLIFormatFromPath("draft.sdpub")).toBe("sdpub");
    expect(inferCLIFormatFromPath("plain.txt")).toBe("txt");
    expect(inferCLIFormatFromPath("plain.unknown")).toBeUndefined();
  });

  it("detects text formats", () => {
    expect(isTextCLIFormat("markdown")).toBe(true);
    expect(isTextCLIFormat("txt")).toBe(true);
    expect(isTextCLIFormat("epub")).toBe(false);
  });

  it("parses and normalizes format flags", () => {
    expect(parseCLIFormat("  EPUB ", "--format")).toBe("epub");
    expect(() => parseCLIFormat("pdf", "--format")).toThrow(
      "Invalid --format: pdf. Expected one of sdpub, epub, txt, markdown.",
    );
  });
});
