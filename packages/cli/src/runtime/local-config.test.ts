import { describe, expect, it } from "vitest";

import {
  maskLocalConfigSection,
  normalizeLocalConfigKey,
  validateLocalConfigSection,
} from "./local-config.js";

describe("runtime/local config", () => {
  it("validates embedding config", () => {
    expect(
      validateLocalConfigSection("embedding", {
        apiKey: " sk-test ",
        baseURL: " https://api.example.com/v1 ",
        dimensions: "1536",
        model: " text-embedding-3-small ",
        provider: "openai-compatible",
      }),
    ).toStrictEqual({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      dimensions: 1536,
      model: "text-embedding-3-small",
      provider: "openai-compatible",
    });

    expect(() =>
      validateLocalConfigSection("embedding", {
        provider: "anthropic",
      }),
    ).toThrow("Unknown embedding.provider");
    expect(() =>
      validateLocalConfigSection("embedding", {
        dimensions: 0,
      }),
    ).toThrow("embedding.dimensions must be a positive integer");
  });

  it("normalizes and masks embedding config secrets", () => {
    expect(normalizeLocalConfigKey("embedding", "api-key")).toBe("apiKey");
    expect(normalizeLocalConfigKey("embedding", "base-url")).toBe("baseURL");
    expect(
      maskLocalConfigSection("embedding", {
        apiKey: "sk-test",
        model: "text-embedding-3-small",
      }),
    ).toStrictEqual({
      apiKey: "****",
      model: "text-embedding-3-small",
    });
  });
});
