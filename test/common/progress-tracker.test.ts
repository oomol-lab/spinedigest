import { describe, expect, it } from "vitest";

import { createDigestProgressTracker } from "../../src/progress/index.js";

describe("progress/tracker", () => {
  it("does not add an extra fragment when completion only finalizes digest totals", async () => {
    const events: Array<{
      readonly completedFragments?: number;
      readonly completedWords?: number;
      readonly id?: number;
      readonly totalWords?: number;
      readonly type: string;
    }> = [];
    const digestTracker = createDigestProgressTracker({
      onProgress: (event) => {
        switch (event.type) {
          case "serial-progress":
            events.push({
              completedFragments: event.completedFragments,
              completedWords: event.completedWords,
              id: event.id,
              type: event.type,
            });
            return;
          case "digest-progress":
            events.push({
              completedWords: event.completedWords,
              totalWords: event.totalWords,
              type: event.type,
            });
        }
      },
      operation: "digest-text-stream",
    });
    const serialTracker = digestTracker.createSerialTracker({
      id: 7,
    });

    await serialTracker.advance(3);
    await serialTracker.complete();

    expect(events).toStrictEqual([
      {
        completedFragments: 1,
        completedWords: 3,
        id: 7,
        type: "serial-progress",
      },
      {
        completedFragments: 1,
        completedWords: 3,
        id: 7,
        type: "serial-progress",
      },
      {
        completedWords: 3,
        totalWords: 3,
        type: "digest-progress",
      },
    ]);
  });
});
