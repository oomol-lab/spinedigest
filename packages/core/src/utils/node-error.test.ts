import { describe, expect, it } from "vitest";

import { formatError, isHostError } from "./host-error.js";

describe("utils/node-error", () => {
  it("detects Error instances only", () => {
    expect(isHostError(new Error("boom"))).toBe(true);
    expect(isHostError({ code: "ENOENT" })).toBe(false);
    expect(isHostError("boom")).toBe(false);
  });

  it("formats missing files without exposing Node stack wording", () => {
    const error = Object.assign(
      new Error("ENOENT: no such file or directory"),
      {
        code: "ENOENT",
        path: "/tmp/missing.wikg",
      },
    );

    expect(formatError(error)).toBe("File not found (ENOENT)");
  });

  it("formats permission errors without exposing the affected path", () => {
    const error = Object.assign(new Error("permission denied"), {
      code: "EACCES",
      path: "/tmp/private.wikg",
    });

    expect(formatError(error)).toBe("Permission denied (EACCES)");
  });

  it("does not expose paths carried by unknown host errors", () => {
    const error = Object.assign(new Error("failed at /private/host/data.db"), {
      code: "EHOSTFAIL",
      path: "/private/host/data.db",
    });

    expect(formatError(error)).toBe("Error (EHOSTFAIL)");
  });
});
