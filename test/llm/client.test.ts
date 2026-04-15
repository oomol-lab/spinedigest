import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMockState = vi.hoisted(() => ({
  generateTextCalls: [] as unknown[],
  streamTextCalls: [] as unknown[],
}));

vi.mock("ai", () => ({
  APICallError: class extends Error {
    public static isInstance(error: unknown): boolean {
      return error instanceof this;
    }
  },
  generateText: vi.fn((input: unknown) => {
    aiMockState.generateTextCalls.push(input);
    return Promise.resolve({ text: "generated response" });
  }),
  streamText: vi.fn((input: unknown) => {
    aiMockState.streamTextCalls.push(input);
    const chunks = ["streamed ", "response"];

    return {
      textStream: {
        [Symbol.asyncIterator]() {
          let index = 0;

          return {
            next() {
              if (index >= chunks.length) {
                return Promise.resolve({
                  done: true as const,
                  value: undefined,
                });
              }

              const value = chunks[index];

              index += 1;

              return Promise.resolve({
                done: false as const,
                value,
              });
            },
          };
        },
      },
    };
  }),
}));

import { LLM } from "../../src/llm/client.js";

describe("llm/client", () => {
  beforeEach(() => {
    aiMockState.generateTextCalls.length = 0;
    aiMockState.streamTextCalls.length = 0;
  });

  it("uses generateText by default", async () => {
    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).resolves.toBe("generated response");

    expect(llm.config.stream).toBe(false);
    expect(aiMockState.generateTextCalls).toHaveLength(1);
    expect(aiMockState.streamTextCalls).toHaveLength(0);
  });

  it("uses streamText when stream mode is enabled", async () => {
    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      stream: true,
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).resolves.toBe("streamed response");

    expect(llm.config.stream).toBe(true);
    expect(aiMockState.generateTextCalls).toHaveLength(0);
    expect(aiMockState.streamTextCalls).toHaveLength(1);
  });
});
