import { describe, expect, it } from "vitest";

import {
  createDefaultSamplingConfig,
  getScopeDefaults,
  resolveSamplingSetting,
  resolveTemperatureSetting,
} from "../../src/llm/sampling.js";

describe("llm/sampling", () => {
  it("resolves static and ranged sampling values", () => {
    expect(resolveSamplingSetting(undefined, "temperature")).toBeUndefined();
    expect(resolveSamplingSetting(0.5, "temperature")).toBe(0.5);
    expect(resolveSamplingSetting([0.2], "temperature")).toBe(0.2);
    expect(resolveSamplingSetting([0.2, 0.8], "temperature", 1, 2)).toBe(0.5);
    expect(resolveTemperatureSetting([0.2, 0.8], 99, 2)).toBe(0.8);
  });

  it("rejects invalid range lengths", () => {
    expect(() => resolveSamplingSetting([0.1, 0.2, 0.3], "topP")).toThrow(
      "topP must be a number or a 2-item range like [0.6, 0.98]",
    );
  });

  it("resolves scoped defaults with fallback behavior", () => {
    expect(
      getScopeDefaults("extract", undefined, [0.1, 0.2], 0.9),
    ).toStrictEqual({
      temperature: [0.1, 0.2],
      topP: 0.9,
    });

    expect(
      getScopeDefaults(
        "extract",
        {
          extract: {
            temperature: 0.4,
          },
        },
        0.2,
        0.9,
      ),
    ).toStrictEqual({
      temperature: 0.4,
      topP: 0.9,
    });
  });

  it("builds built-in scope defaults from the legacy profiles", () => {
    const sampling = createDefaultSamplingConfig();

    expect(
      getScopeDefaults(
        "serial-generation/editor-compress",
        sampling,
        0.6,
        0.6,
      ),
    ).toStrictEqual({
      temperature: 0.7,
      topP: 0.9,
    });
    expect(
      getScopeDefaults(
        "serial-generation/reader-extraction",
        sampling,
        0.6,
        0.6,
      ),
    ).toStrictEqual({
      temperature: [0.3, 0.95],
      topP: [0.4, 0.8],
    });
  });

  it("replaces matching values across all scopes when global overrides exist", () => {
    const sampling = createDefaultSamplingConfig({
      temperature: 0.2,
    });

    expect(
      getScopeDefaults(
        "serial-generation/editor-compress",
        sampling,
        0.6,
        0.6,
      ),
    ).toStrictEqual({
      temperature: 0.2,
      topP: 0.9,
    });
    expect(
      getScopeDefaults(
        "serial-generation/reader-choice",
        sampling,
        0.6,
        0.6,
      ),
    ).toStrictEqual({
      temperature: 0.2,
      topP: [0.4, 0.8],
    });
  });
});
