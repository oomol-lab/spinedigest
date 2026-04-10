import { describe, expect, it } from "vitest";

import { EvidenceResolver } from "../../../src/reader/chunk-batch/evidence-resolver.js";

describe("reader/chunk-batch/evidence-resolver", () => {
  it("resolves a unique exact anchor match", () => {
    const resolver = new EvidenceResolver();
    const [result, failure] = resolver.resolve(
      {
        start_anchor: "Alpha begins.",
      },
      [
        [1, 0, 0],
        [1, 0, 1],
      ],
      ["Alpha begins.", "Beta ends."],
    );

    expect(failure).toBeUndefined();
    expect(result).toStrictEqual({
      confidence: 1,
      sentenceIds: [[1, 0, 0]],
      strategy: "exact_raw",
    });
  });

  it("reports ambiguous exact matches", () => {
    const resolver = new EvidenceResolver();
    const [result, failure] = resolver.resolve(
      {
        start_anchor: "Echo",
      },
      [
        [1, 0, 0],
        [1, 0, 1],
      ],
      ["Echo", "Echo"],
    );

    expect(result).toBeUndefined();
    expect(failure).toMatchObject({
      code: "ambiguous_exact_raw",
      fieldName: "start_anchor",
    });
    expect(failure?.candidates).toHaveLength(2);
  });

  it("supports override-based resolution and rejects invalid ranges", () => {
    const resolver = new EvidenceResolver();
    const [resolved, resolvedFailure] = resolver.resolveWithOverrides({
      candidateSentenceIds: [
        [1, 0, 0],
        [1, 0, 1],
      ],
      candidateTexts: ["Intro", "Echo"],
      evidence: {
        end_anchor: "Echo",
        start_anchor: "Intro",
      },
      overrides: {
        start_anchor: {
          exactNormalized: true,
          exactRaw: true,
          exactSubstring: true,
          index: 0,
          nextText: "Echo",
          occurrenceId: "S1",
          prevText: "",
          score: 1,
          sentenceId: [1, 0, 0],
          text: "Intro",
        },
      },
    });
    const [, invalidFailure] = resolver.resolveWithOverrides({
      candidateSentenceIds: [
        [1, 0, 0],
        [1, 0, 1],
      ],
      candidateTexts: ["Intro", "Echo"],
      evidence: {
        end_anchor: "Intro",
        start_anchor: "Echo",
      },
      overrides: {
        end_anchor: {
          exactNormalized: true,
          exactRaw: true,
          exactSubstring: true,
          index: 0,
          nextText: "Echo",
          occurrenceId: "S1",
          prevText: "",
          score: 1,
          sentenceId: [1, 0, 0],
          text: "Intro",
        },
        start_anchor: {
          exactNormalized: true,
          exactRaw: true,
          exactSubstring: true,
          index: 1,
          nextText: "",
          occurrenceId: "S2",
          prevText: "Intro",
          score: 1,
          sentenceId: [1, 0, 1],
          text: "Echo",
        },
      },
    });

    expect(resolvedFailure).toBeUndefined();
    expect(resolved?.sentenceIds).toStrictEqual([[1, 0, 0], [1, 0, 1]]);
    expect(invalidFailure).toMatchObject({
      code: "invalid_range",
      fieldName: "end_anchor",
    });
  });
});
