import { describe, expect, it } from "vitest";

import { countTextWords } from "./text-word-count.js";

describe("countTextWords", () => {
  it("counts Latin words and Han characters on the same scale", () => {
    expect(countTextWords("Alpha beta 123")).toBe(3);
    expect(countTextWords("朱元璋占据应天")).toBe(7);
    expect(countTextWords("Alpha朱元璋 beta")).toBe(5);
  });

  it("ignores whitespace and punctuation", () => {
    expect(countTextWords("  中文，English!  ")).toBe(3);
    expect(countTextWords(" \n\t ")).toBe(0);
  });

  it("keeps combining marks inside the current word", () => {
    expect(countTextWords("e\u0301clair")).toBe(1);
    expect(countTextWords("عَرَبِيّ")).toBe(1);
    expect(countTextWords("\u0301")).toBe(0);
  });
});
