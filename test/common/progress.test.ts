import { describe, expect, it, vi } from "vitest";

import { ProgressReporter } from "../../src/progress/index.js";

describe("progress/reporter", () => {
  it("does not fail the pipeline when the progress callback throws", async () => {
    const reporter = new ProgressReporter("digest-text", () => {
      throw new Error("UI disconnected");
    });

    await expect(
      reporter.emit({
        completedWords: 0,
        totalWords: 12,
        type: "digest-progress",
      }),
    ).resolves.toBeUndefined();
  });

  it("delivers structured events to the callback", async () => {
    const callback = vi.fn();
    const reporter = new ProgressReporter("digest-text", callback);

    await reporter.emit({
      fragments: 4,
      id: 7,
      type: "serial-discovered",
      words: 1600,
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      fragments: 4,
      id: 7,
      type: "serial-discovered",
      words: 1600,
    });
  });
});
