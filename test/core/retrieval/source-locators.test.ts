import { describe, expect, it } from "vitest";

import type { ReadonlyDocument } from "../../../packages/core/src/document/index.js";
import { createSourceLocatorMap } from "../../../packages/core/src/retrieval/query/archive-view/source-locators.js";

describe("source passage locator maps", () => {
  it("clips, rebases, merges adjacent locators, and preserves gaps", async () => {
    const digest = "a".repeat(64);
    const first = {
      artifact: { digest, mediaType: "application/pdf" },
      fragment: "page=1&bbox=0,0,1,1",
      locator: { bbox: [0, 0, 1, 1], pageIndex: 1 },
      sourceRevision: 3,
    } as const;
    const document = {
      serials: { getRevision: () => Promise.resolve(3) },
      sourceProvenance: {
        listMap: () =>
          Promise.resolve([
            { ...first, sourceEnd: 2, sourceStart: 0 },
            { ...first, sourceEnd: 4, sourceStart: 2 },
            {
              ...first,
              fragment: "page=2&bbox=0.1,0.2,0.9,1",
              locator: { bbox: [0.1, 0.2, 0.9, 1], pageIndex: 2 },
              sourceEnd: 8,
              sourceStart: 5,
            },
            { ...first, sourceEnd: 20, sourceRevision: 2, sourceStart: 10 },
          ]),
      },
    } as unknown as ReadonlyDocument;

    await expect(createSourceLocatorMap(document, 7, 1, 7)).resolves.toEqual({
      "1..3": `wikg://artifact/${digest}#page=1&bbox=0,0,1,1`,
      "5..6": `wikg://artifact/${digest}#page=2&bbox=0.1,0.2,0.9,1`,
    });
  });

  it("omits empty intersections", async () => {
    const document = {
      serials: { getRevision: () => Promise.resolve(1) },
      sourceProvenance: { listMap: () => Promise.resolve([]) },
    } as unknown as ReadonlyDocument;

    await expect(createSourceLocatorMap(document, 1, 4, 4)).resolves.toEqual(
      {},
    );
  });
});
