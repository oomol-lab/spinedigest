import { describe, expect, it } from "vitest";

import { LANGUAGES } from "../src/index.js";

describe("test framework", () => {
  it("runs a hello world smoke test", () => {
    expect(LANGUAGES).toContain("English");
  });
});
