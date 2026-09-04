import { describe, expect, it } from "vitest";

import {
  formatSourceArtifactUri,
  formatSourceLocatorFragment,
  parseSourceLocatorFragment,
} from "../../../packages/core/src/document/index.js";

describe("source locator URI", () => {
  it("canonicalizes artifact digests and PDF fragments", () => {
    const digest = "A".repeat(64);
    const fragment = formatSourceLocatorFragment("application/pdf", {
      bbox: [-0, 0.25, 1, 1],
      pageIndex: 21,
    });

    expect(fragment).toBe("page=21&bbox=0,0.25,1,1");
    expect(formatSourceArtifactUri(digest, fragment)).toBe(
      `wikg://artifact/${digest.toLowerCase()}#${fragment}`,
    );
    expect(parseSourceLocatorFragment(fragment)).toStrictEqual({
      fragment,
      locator: { bbox: [0, 0.25, 1, 1], pageIndex: 21 },
      mediaType: "application/pdf",
    });
  });

  it("round-trips EPUB CFI fragments", () => {
    const fragment = "epubcfi(/6/2[body]!/4/2/1:0)";

    expect(
      formatSourceLocatorFragment("application/epub+zip", { cfi: fragment }),
    ).toBe(fragment);
    expect(parseSourceLocatorFragment(fragment)).toStrictEqual({
      fragment,
      locator: { cfi: fragment },
      mediaType: "application/epub+zip",
    });
  });

  it("rejects non-canonical or out-of-bounds PDF locations", () => {
    expect(() => parseSourceLocatorFragment("page=0&bbox=0,0,1,1")).toThrow(
      "Invalid source artifact locator fragment",
    );
    expect(() =>
      formatSourceLocatorFragment("application/pdf", {
        bbox: [0, 0, 1.1, 1],
        pageIndex: 1,
      }),
    ).toThrow("in [0, 1]");
    expect(() =>
      formatSourceLocatorFragment("application/pdf", {
        bbox: [0.8, 0, 0.2, 1],
        pageIndex: 1,
      }),
    ).toThrow("left, bottom, right, top");
  });
});
