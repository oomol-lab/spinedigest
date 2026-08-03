import { afterEach, describe, expect, it, vi } from "vitest";

import { embedQueryText } from "./embedding.js";

describe("runtime/embedding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("embeds query text through an OpenAI-compatible provider", async () => {
    const fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      expect(formatFetchURL(url)).toBe("https://api.example.com/v1/embeddings");
      if (typeof init?.body !== "string") {
        throw new Error("Expected JSON request body.");
      }
      const body = JSON.parse(init.body) as {
        readonly dimensions?: number;
        readonly input?: string[];
        readonly model?: string;
      };

      expect(body).toMatchObject({
        dimensions: 3,
        input: ["hello dense query"],
        model: "embedding-model",
      });

      return new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
          model: "embedding-model",
          object: "list",
          usage: { prompt_tokens: 4, total_tokens: 4 },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      );
    });
    vi.stubGlobal("fetch", fetch);

    const result = await embedQueryText(" hello dense query ", {
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      dimensions: 3,
      model: "embedding-model",
      provider: "openai-compatible",
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(result).toStrictEqual({
      dimensions: 3,
      embedding: [0.1, 0.2, 0.3],
      model: "embedding-model",
      provider: "openai-compatible",
      usage: { tokens: 4 },
    });
  });

  it("requires query text and embedding provider fields", async () => {
    await expect(embedQueryText("   ")).rejects.toThrow(
      "Query text cannot be empty",
    );
    await expect(embedQueryText("hello")).rejects.toThrow(
      "Missing embeddings configuration",
    );
    await expect(
      embedQueryText("hello", {
        provider: "openai-compatible",
      }),
    ).rejects.toThrow("Missing embeddings.model");
  });
});

function formatFetchURL(url: string | URL | Request): string {
  if (typeof url === "string") {
    return url;
  }
  if (url instanceof URL) {
    return url.href;
  }

  return url.url;
}
