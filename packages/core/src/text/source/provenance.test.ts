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
  });
});
