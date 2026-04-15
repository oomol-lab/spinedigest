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

  it("uses built-in scope sampling defaults", async () => {
    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
    });

    await llm.request(
      [
        {
          content: "hello",
          role: "user",
        },
      ],
      {
        scope: "serial-generation/editor-compress",
      },
    );

    expect(aiMockState.generateTextCalls).toHaveLength(1);
    expect(
      aiMockState.generateTextCalls[0] as {
        readonly temperature: number;
        readonly topP: number;
      },
    ).toMatchObject({
      temperature: 0.7,
      topP: 0.9,
    });
  });

  it("replaces scope values when global overrides are provided", async () => {
    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      temperature: 0.2,
    });

    await llm.request(
      [
        {
          content: "hello",
          role: "user",
        },
      ],
      {
        retryIndex: 1,
        retryMax: 2,
        scope: "serial-generation/reader-extraction",
      },
    );

    expect(aiMockState.generateTextCalls).toHaveLength(1);
    expect(
      aiMockState.generateTextCalls[0] as {
        readonly temperature: number;
        readonly topP: number;
      },
    ).toMatchObject({
      temperature: 0.2,
    });
    expect(
      (aiMockState.generateTextCalls[0] as { readonly topP: number }).topP,
    ).toBeCloseTo(0.6);
  });
});
