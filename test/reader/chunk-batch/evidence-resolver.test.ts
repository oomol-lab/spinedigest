import { describe, expect, it } from "vitest";

import { EvidenceResolver } from "../../../src/reader/chunk-batch/evidence-resolver.js";

describe("reader/chunk-batch/evidence-resolver", () => {
  it("normalizes multi-sentence anchors to the boundary sentence", () => {
    const resolver = new EvidenceResolver();

    expect(
      resolver.parseAnchor("Alpha begins. Beta continues.", "start_anchor"),
    ).toStrictEqual([
      {
        mode: "full",
        text: "Alpha begins.",
      },
      undefined,
    ]);
    expect(
      resolver.parseAnchor("Alpha begins. Beta continues.", "end_anchor"),
    ).toStrictEqual([
      {
        mode: "full",
        text: "Beta continues.",
      },
      undefined,
    ]);
  });

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

  it("matches normalized and long substring anchors with high confidence", () => {
    const resolver = new EvidenceResolver();
    const [normalizedCandidate, normalizedStrategy, normalizedFailure] =
      resolver.resolveAnchor({
        anchor: {
          mode: "full",
          text: "Cafe noir",
        },
        candidateSentenceIds: [
          [1, 0, 0],
          [1, 0, 1],
        ],
        candidateTexts: ["Café noir", "Tea time"],
        label: "start_anchor",
      });
    const [substringCandidate, substringStrategy, substringFailure] =
      resolver.resolveAnchor({
        anchor: {
          mode: "full",
          text: "Alpha begins the chapter and introduces the stakes",
        },
        candidateSentenceIds: [
          [1, 0, 0],
          [1, 0, 1],
          [1, 0, 2],
        ],
        candidateTexts: [
          "Alpha begins the chapter and introduces the stakes.",
          "A short unrelated line.",
          "Alpha begins the chapter and introduces the stakes with a major reveal.",
        ],
        label: "start_anchor",
      });

    expect(normalizedFailure).toBeUndefined();
    expect(normalizedStrategy).toBe("exact_normalized");
    expect(normalizedCandidate).toMatchObject({
      exactNormalized: true,
      sentenceId: [1, 0, 0],
    });
    expect(substringFailure).toBeUndefined();
    expect(substringStrategy).toBe("exact_substring");
    expect(substringCandidate).toMatchObject({
      exactSubstring: true,
      sentenceId: [1, 0, 2],
    });
    expect(substringCandidate?.score).toBeGreaterThan(0.99);
  });

  it("resolves head-tail anchors into a contiguous evidence range", () => {
    const resolver = new EvidenceResolver();
    const [result, failure] = resolver.resolve(
      {
        end_anchor: "major reveal ... final beat",
        start_anchor: "Alpha begins ... major reveal",
      },
      [
        [1, 0, 0],
        [1, 0, 1],
        [1, 0, 2],
      ],
      [
        "Alpha begins the chapter and introduces the stakes with a major reveal.",
        "Bridge scene keeps tension high.",
        "The major reveal leads into the final beat.",
      ],
    );

    expect(failure).toBeUndefined();
    expect(result).toMatchObject({
      sentenceIds: [
        [1, 0, 0],
        [1, 0, 1],
        [1, 0, 2],
      ],
      strategy: "exact_substring+exact_substring",
    });
    expect(result?.confidence).toBeGreaterThan(0.88);
  });

  it("reports invalid anchors and low-confidence matches", () => {
    const resolver = new EvidenceResolver();
    const [invalidResult, invalidFailure] = resolver.resolve(
      {
        start_anchor: {
          mode: "head_tail",
          head: "Alpha",
        },
      },
      [[1, 0, 0]],
      ["Alpha begins."],
    );
    const [lowCandidate, lowStrategy, lowFailure] = resolver.resolveAnchor({
      anchor: {
        mode: "full",
        text: "completely unrelated anchor text",
      },
      candidateSentenceIds: [
        [1, 0, 0],
        [1, 0, 1],
      ],
      candidateTexts: ["alpha beta gamma", "delta epsilon zeta"],
      label: "start_anchor",
    });

    expect(invalidResult).toBeUndefined();
    expect(invalidFailure).toMatchObject({
      code: "invalid_anchor",
      fieldName: "start_anchor",
    });
    expect(invalidFailure?.message).toContain("head_tail anchor requires");
    expect(lowCandidate).toBeUndefined();
    expect(lowStrategy).toBe("low_confidence");
    expect(lowFailure).toMatchObject({
      code: "low_confidence",
      fieldName: "start_anchor",
    });
    expect(lowFailure?.candidates).toHaveLength(2);
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
