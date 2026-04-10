import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import {
  GuaranteedParseValidationError,
  ParsedJsonError,
  SuspectedModelRefusalError,
  requestGuaranteedJson,
} from "../../src/guaranteed/index.js";
import type { LLMessage } from "../../src/llm/index.js";

const schema = z.object({
  value: z.number(),
});

describe("guaranteed/request", () => {
  it("retries after syntax failures and eventually succeeds", async () => {
    const request = vi
      .fn<
        (
          messages: readonly LLMessage[],
          retryIndex: number,
          retryMax: number,
        ) => Promise<string>
      >()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"value": 3}');

    const result = await requestGuaranteedJson({
      messages: [
        {
          role: "user",
          content: "Return JSON",
        },
      ],
      parse: (data) => data.value,
      request,
      schema,
    });

    expect(result).toBe(3);
    expect(request).toHaveBeenCalledTimes(2);

    const secondCallMessages = request.mock.calls[1]?.[0];

    expect(secondCallMessages).toHaveLength(3);
    expect(secondCallMessages?.[1]).toMatchObject({
      role: "assistant",
      content: "not json",
    });
    expect(secondCallMessages?.[2]?.content).toContain("structural issues");
  });

  it("treats consecutive non-JSON responses as a refusal", async () => {
    await expect(
      requestGuaranteedJson({
        messages: [],
        parse: (data) => data.value,
        request: () => Promise.resolve("}"),
        schema,
      }),
    ).rejects.toBeInstanceOf(SuspectedModelRefusalError);
  });

  it("throws a parse validation error after exhausting retries", async () => {
    await expect(
      requestGuaranteedJson({
        maxRetries: 1,
        messages: [],
        parse: () => {
          throw new ParsedJsonError(["value is not acceptable"]);
        },
        request: () => Promise.resolve('{"value": 1}'),
        schema,
      }),
    ).rejects.toBeInstanceOf(GuaranteedParseValidationError);
  });
});
