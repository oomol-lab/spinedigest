import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMockState = vi.hoisted(() => ({
  generateTextResponse: "generated response",
  generateTextCalls: [] as unknown[],
  generateTextError: undefined as Error | undefined,
  streamTextCalls: [] as unknown[],
  streamTextError: undefined as Error | undefined,
}));

vi.mock("ai", () => ({
  APICallError: class extends Error {
    public readonly isRetryable: boolean;
    public readonly statusCode: number | undefined;

    public constructor(
      message: string,
      options: {
        cause?: unknown;
        isRetryable?: boolean;
        statusCode?: number;
      } = {},
    ) {
      super(message, options);
      this.name = "AI_APICallError";
      this.isRetryable = options.isRetryable ?? false;
      this.statusCode = options.statusCode;
    }

    public static isInstance(error: unknown): boolean {
      return error instanceof this;
    }
  },
  generateText: vi.fn((input: unknown) => {
    aiMockState.generateTextCalls.push(input);

    if (aiMockState.generateTextError !== undefined) {
      return Promise.reject(aiMockState.generateTextError);
    }

    return Promise.resolve({ text: aiMockState.generateTextResponse });
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
              if (aiMockState.streamTextError !== undefined) {
                return Promise.reject(aiMockState.streamTextError);
              }

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

import { SpineDigestScope } from "../../src/common/llm-scope.js";
import { LLM } from "../../src/llm/client.js";

describe("llm/client", () => {
  beforeEach(() => {
    aiMockState.generateTextResponse = "generated response";
    aiMockState.generateTextCalls.length = 0;
    aiMockState.generateTextError = undefined;
    aiMockState.streamTextCalls.length = 0;
    aiMockState.streamTextError = undefined;
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
    expect(llm.config.timeout).toBe(360000);
    expect(aiMockState.generateTextCalls).toHaveLength(1);
    expect(
      aiMockState.generateTextCalls[0] as {
        readonly timeout: number;
      },
    ).toMatchObject({
      timeout: 360000,
    });
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

  it("uses explicit scoped sampling defaults provided by the caller", async () => {
    const llm = new LLM<SpineDigestScope.EditorCompress>({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      sampling: {
        [SpineDigestScope.EditorCompress]: {
          temperature: 0.7,
          topP: 0.9,
        },
      },
    });

    await llm.request(
      [
        {
          content: "hello",
          role: "user",
        },
      ],
      {
        scope: SpineDigestScope.EditorCompress,
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

  it("passes explicit timeout values through as milliseconds", async () => {
    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      timeout: 45000,
    });

    await llm.request([
      {
        content: "hello",
        role: "user",
      },
    ]);

    expect(llm.config.timeout).toBe(45000);
    expect(
      aiMockState.generateTextCalls[0] as {
        readonly timeout: number;
      },
    ).toMatchObject({
      timeout: 45000,
    });
  });

  it("treats an empty string response as a successful result", async () => {
    aiMockState.generateTextResponse = "";

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
    ).resolves.toBe("");
    expect(aiMockState.generateTextCalls).toHaveLength(1);
  });

  it("preserves the last retry error as the request cause", async () => {
    const { APICallError } = await import("ai");
    const MockAPICallError = APICallError as unknown as {
      new (
        message: string,
        options?: {
          cause?: unknown;
          isRetryable?: boolean;
          statusCode?: number;
        },
      ): Error;
    };
    const tlsError = Object.assign(
      new Error(
        "Client network socket disconnected before secure TLS connection was established",
      ),
      {
        code: "ECONNRESET",
      },
    );

    aiMockState.generateTextError = new MockAPICallError(
      "Cannot connect to API",
      {
        cause: tlsError,
        isRetryable: true,
      },
    );

    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      retryIntervalSeconds: 0,
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).rejects.toMatchObject({
      cause: aiMockState.generateTextError,
      message:
        "LLM request failed after 6 attempts: Cannot connect to API: Client network socket disconnected before secure TLS connection was established (ECONNRESET)",
    });
    expect(aiMockState.generateTextCalls).toHaveLength(6);
  });

  it("retries terminated transport errors for generateText", async () => {
    aiMockState.generateTextError = new TypeError("terminated");

    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      retryIntervalSeconds: 0,
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).rejects.toMatchObject({
      cause: aiMockState.generateTextError,
      message: "LLM request failed after 6 attempts: terminated",
    });
    expect(aiMockState.generateTextCalls).toHaveLength(6);
  });

  it("does not retry abort-like errors", async () => {
    const abortError = new Error("The operation was aborted.");
    abortError.name = "AbortError";
    aiMockState.generateTextError = abortError;

    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      retryIntervalSeconds: 0,
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).rejects.toBe(abortError);
    expect(aiMockState.generateTextCalls).toHaveLength(1);
  });

  it("retries terminated transport errors for streamText", async () => {
    aiMockState.streamTextError = new TypeError("terminated");

    const llm = new LLM({
      dataDirPath: process.cwd(),
      model: {
        modelId: "test-model",
        provider: "test-provider",
      } as never,
      retryIntervalSeconds: 0,
      stream: true,
    });

    await expect(
      llm.request([
        {
          content: "hello",
          role: "user",
        },
      ]),
    ).rejects.toMatchObject({
      cause: aiMockState.streamTextError,
      message: "LLM request failed after 6 attempts: terminated",
    });
    expect(aiMockState.streamTextCalls).toHaveLength(6);
  });
});
