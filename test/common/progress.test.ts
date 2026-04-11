import { describe, expect, it, vi } from "vitest";

import { ProgressReporter } from "../../src/progress/index.js";

describe("progress/reporter", () => {
  it("does not fail the pipeline when the progress callback throws", async () => {
    const reporter = new ProgressReporter("digest-text", async () => {
      throw new Error("UI disconnected");
    });

    await expect(
      reporter.emit({
        message: "Digest session started",
        type: "session-started",
      }),
    ).resolves.toBeUndefined();
  });

  it("delivers structured events to the callback", async () => {
    const callback = vi.fn();
    const reporter = new ProgressReporter("digest-text", callback);

    await reporter.emit({
      message: "Text export completed",
      outputKind: "text",
      path: "/tmp/output.txt",
      type: "export-completed",
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Text export completed",
        operation: "digest-text",
        outputKind: "text",
        path: "/tmp/output.txt",
        timestamp: expect.any(String),
        type: "export-completed",
      }),
    );
  });
});
