import { describe, expect, it, vi } from "vitest";

vi.mock("tinyld", () => ({
  detect: vi.fn(() => "ja"),
  validateISO2: vi.fn((value: string) =>
    value === "ja" || value === "en" ? value : "",
  ),
}));

import { ChunkExtractor } from "../../../src/reader/chunk-batch/extractor.js";
import {
  EVIDENCE_CHOICE_PROMPT_TEMPLATE,
  TRANSLATE_CHUNKS_PROMPT_TEMPLATE,
  USER_FOCUSED_PROMPT_TEMPLATE,
} from "../../../src/reader/chunk-batch/prompt-templates.js";
import { ScriptedLLM } from "../../helpers/scripted-llm.js";

describe("reader/chunk-batch/extractor", () => {
  it("extracts user-focused chunks through the scripted llm protocol", async () => {
    const llm = new ScriptedLLM<"choice" | "extract">([
      JSON.stringify({
        chunks: [
          {
            content: "Alpha summary",
            label: "Alpha label",
            retention: "focused",
            source_sentences: ["Alpha begins."],
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "Fragment summary",
        links: [],
      }),
    ]);
    const extractor = new ChunkExtractor({
      extractionGuidance: "Focus on plot",
      llm: llm as never,
      scopes: {
        choice: "choice",
        extraction: "extract",
      },
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
    });

    const result = await extractor.extractUserFocused({
      sentences: [
        {
          sentenceId: [1, 0, 0],
          text: "Alpha begins.",
          tokenCount: 2,
        },
      ],
      text: "Alpha begins.",
      visibleChunkIds: [],
      workingMemoryPrompt: "memory",
    });

    expect(result).toStrictEqual({
      chunkBatch: {
        chunks: [
          {
            content: "Alpha summary",
            generation: 0,
            id: 0,
            label: "Alpha label",
            links: [],
            retention: "focused",
            sentenceId: [1, 0, 0],
            sentenceIds: [[1, 0, 0]],
            tokens: 2,
          },
        ],
        links: [],
        orderCorrect: true,
        tempIds: ["temp-1"],
      },
      fragmentSummary: "Fragment summary",
    });
    expect(llm.prompts.map((prompt) => prompt.templateName)).toContain(
      USER_FOCUSED_PROMPT_TEMPLATE,
    );
    expect(llm.prompts.map((prompt) => prompt.templateName)).toContain(
      EVIDENCE_CHOICE_PROMPT_TEMPLATE,
    );
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.options.scope).toBe("extract");
    expect(llm.calls[0]?.viaContext).toBe(true);
  });

  it("translates extracted chunks when the requested language differs", async () => {
    const llm = new ScriptedLLM<"choice" | "extract">([
      JSON.stringify({
        chunks: [
          {
            content: "こんにちは世界",
            label: "挨拶",
            retention: "detailed",
            source_sentences: ["Hello world."],
            temp_id: "temp-1",
          },
        ],
        fragment_summary: "",
        links: [],
      }),
      JSON.stringify([
        {
          content: "Hello world",
          id: 0,
          label: "Greeting",
        },
      ]),
    ]);
    const extractor = new ChunkExtractor({
      extractionGuidance: "Focus on plot",
      llm: llm as never,
      scopes: {
        choice: "choice",
        extraction: "extract",
      },
      sentenceTextSource: {
        getSentence: (sentenceId) => Promise.resolve(sentenceId.join(":")),
      },
      userLanguage: "English",
    });

    const result = await extractor.extractUserFocused({
      sentences: [
        {
          sentenceId: [1, 0, 0],
          text: "Hello world.",
          tokenCount: 2,
        },
      ],
      text: "Hello world.",
      visibleChunkIds: [],
      workingMemoryPrompt: "memory",
    });

    expect(result.chunkBatch.chunks[0]).toMatchObject({
      content: "Hello world",
      label: "Greeting",
    });
    expect(llm.prompts.map((prompt) => prompt.templateName)).toContain(
      TRANSLATE_CHUNKS_PROMPT_TEMPLATE,
    );
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]?.options.scope).toBe("extract");
    expect(llm.calls[1]?.viaContext).toBe(false);
  });
});
