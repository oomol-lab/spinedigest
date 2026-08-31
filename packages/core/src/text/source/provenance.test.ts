import { describe, expect, it } from "vitest";

import { parseSourceTextJsonl } from "./provenance.js";

describe("parseSourceTextJsonl", () => {
  it("concatenates text and maps it to the current artifact", () => {
    const result = parseSourceTextJsonl(
      [
        JSON.stringify({
          type: "artifact",
          digest: "A".repeat(64),
          mediaType: "application/pdf",
          name: "book.pdf",
        }),
        JSON.stringify({
          type: "text",
          text: "one\n",
          locator: { pageIndex: 1, bbox: [0, 0, 0.5, 0.5] },
        }),
        JSON.stringify({
          type: "text",
          text: "two",
          locator: { pageIndex: 2, bbox: [0.5, 0.5, 1, 1] },
        }),
      ].join("\n"),
    );

    expect(result.text).toBe("one\ntwo");
    expect(result.provenance.artifacts).toHaveLength(1);
    expect(result.provenance.mappings).toMatchObject([
      { sourceStart: 0, sourceEnd: 4 },
      { sourceStart: 4, sourceEnd: 7 },
    ]);
  });

  it("counts source offsets as Unicode characters", () => {
    const result = parseSourceTextJsonl(
      [
        JSON.stringify({
          type: "artifact",
          digest: "D".repeat(64),
          mediaType: "application/pdf",
        }),
        JSON.stringify({
          type: "text",
          text: "😀a",
          locator: { pageIndex: 1, bbox: [0, 0, 1, 1] },
        }),
      ].join("\n"),
    );

    expect(result.provenance.mappings[0]).toMatchObject({
      sourceStart: 0,
      sourceEnd: 2,
    });
  });

  it("rejects malformed records", () => {
    expect(() => parseSourceTextJsonl('{"type":"text","text":"x"}')).toThrow(
      /must follow an artifact/,
    );
    expect(() =>
      parseSourceTextJsonl(
        JSON.stringify({
          type: "artifact",
          digest: "A".repeat(64),
          mediaType: "application/pdf",
        }) +
          "\n" +
          JSON.stringify({
            type: "text",
            text: "x",
            locator: { pageIndex: 0, bbox: [0, 0, 1, 1] },
          }),
      ),
    ).toThrow(/1-based integer/);
    expect(() =>
      parseSourceTextJsonl(
        [
          JSON.stringify({
            type: "artifact",
            digest: "E".repeat(64),
            mediaType: "application/epub+zip",
          }),
          JSON.stringify({
            type: "text",
            text: "x",
            locator: { cfi: "epubcfi(x)" },
          }),
        ].join("\n"),
      ),
    ).toThrow(/syntactically valid epubcfi/iu);
  });

  it("rejects oversized opaque identifiers", () => {
    const identifier = "opaque:" + "x".repeat(5000);
    expect(() =>
      parseSourceTextJsonl(
        [
          JSON.stringify({
            type: "artifact",
            digest: "C".repeat(64),
            identifier,
            mediaType: "application/epub+zip",
          }),
          JSON.stringify({
            type: "text",
            text: "content",
            locator: { cfi: "epubcfi(/6/2)" },
          }),
        ].join("\n"),
      ),
    ).toThrow(/Invalid source artifact record/iu);
  });
});
