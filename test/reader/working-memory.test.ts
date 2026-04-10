import { describe, expect, it } from "vitest";

import { WorkingMemory } from "../../src/reader/attention/working-memory.js";

describe("reader/working-memory", () => {
  it("formats current and extra chunks in stable prompt order", () => {
    const memory = new WorkingMemory(3);

    memory.addChunks([
      createChunk(7, 1, [1, 1, 0], "Later", "Later content"),
      createChunk(3, 0, [1, 0, 1], "Earlier", "Earlier content"),
    ]);
    memory.setExtraChunks([
      createChunk(5, 0, [1, 0, 0], "Extra", "Extra content"),
    ]);

    expect(memory.capacity).toBe(3);
    expect(memory.getChunks().map((chunk) => chunk.id)).toStrictEqual([7, 3, 5]);
    expect(memory.formatForPrompt()).toBe(
      [
        "5. [Extra] - Extra content",
        "3. [Earlier] - Earlier content",
        "7. [Later] - Later content",
      ].join("\n"),
    );
    expect(memory.formatForPrompt(false)).toBe("5. [Extra] - Extra content");
  });

  it("finalizes fragments, increments generation, and clears all state", () => {
    const memory = new WorkingMemory(2);

    memory.addChunks([
      createChunk(1, 0, [1, 0, 0], "Alpha", "Alpha content"),
    ]);
    memory.setExtraChunks([
      createChunk(2, 1, [1, 1, 0], "Beta", "Beta content"),
    ]);

    const finalized = memory.finalizeFragment();

    expect(finalized.map((chunk) => chunk.id)).toStrictEqual([1]);
    expect(memory.generation).toBe(1);
    expect(memory.getAllChunksForSaving()).toStrictEqual([]);
    expect(memory.getChunks().map((chunk) => chunk.id)).toStrictEqual([2]);

    memory.clear();

    expect(memory.getChunks()).toStrictEqual([]);
    expect(memory.formatForPrompt()).toBe("(empty)");
  });
});

function createChunk(
  id: number,
  generation: number,
  sentenceId: readonly [number, number, number],
  label: string,
  content: string,
) {
  return {
    content,
    generation,
    id,
    label,
    links: [],
    sentenceId: [...sentenceId] as [number, number, number],
    sentenceIds: [[...sentenceId] as [number, number, number]],
    tokens: 1,
  };
}
