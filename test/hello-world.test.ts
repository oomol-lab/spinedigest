import { describe, expect, it } from "vitest";

import { Language } from "../src/index.js";

describe("test framework", () => {
  it("runs a hello world smoke test", () => {
    expect(Object.values(Language)).toContain(Language.English);
  });
});
