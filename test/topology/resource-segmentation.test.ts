import { describe, expect, it } from "vitest";

import { createFragmentGroups } from "../../src/topology/resource-segmentation.js";

describe("topology/resource-segmentation", () => {
  it("returns no groups for empty fragment input", () => {
    expect(
      createFragmentGroups({
        fragmentInfos: [],
        groupWordsCount: 100,
        serialId: 1,
      }),
    ).toStrictEqual([]);
  });

  it("greedily groups adjacent fragments without duplicating ids", () => {
    expect(
      createFragmentGroups({
        fragmentInfos: [
          {
            endIncision: 0,
            fragmentId: 1,
            startIncision: 0,
            wordsCount: 40,
          },
          {
            endIncision: 0,
            fragmentId: 2,
            startIncision: 0,
            wordsCount: 40,
          },
          {
            endIncision: 0,
            fragmentId: 3,
            startIncision: 0,
            wordsCount: 40,
          },
        ],
        groupWordsCount: 100,
        serialId: 1,
      }),
    ).toStrictEqual([
      { fragmentId: 1, groupId: 0, serialId: 1 },
      { fragmentId: 2, groupId: 0, serialId: 1 },
      { fragmentId: 3, groupId: 1, serialId: 1 },
    ]);
  });

  it("prefers strong incision boundaries when splitting oversized groups", () => {
    expect(
      createFragmentGroups({
        fragmentInfos: [
          {
            endIncision: 1,
            fragmentId: 1,
            startIncision: 0,
            wordsCount: 20,
          },
          {
            endIncision: 9,
            fragmentId: 2,
            startIncision: 1,
            wordsCount: 20,
          },
          {
            endIncision: 1,
            fragmentId: 3,
            startIncision: 9,
            wordsCount: 20,
          },
          {
            endIncision: 0,
            fragmentId: 4,
            startIncision: 1,
            wordsCount: 20,
          },
        ],
        groupWordsCount: 60,
        serialId: 1,
      }),
    ).toStrictEqual([
      { fragmentId: 1, groupId: 0, serialId: 1 },
      { fragmentId: 2, groupId: 0, serialId: 1 },
      { fragmentId: 3, groupId: 1, serialId: 1 },
      { fragmentId: 4, groupId: 1, serialId: 1 },
    ]);
  });

  it("forces individually oversized fragments into separate groups", () => {
    expect(
      createFragmentGroups({
        fragmentInfos: [
          {
            endIncision: 0,
            fragmentId: 1,
            startIncision: 0,
            wordsCount: 70,
          },
          {
            endIncision: 0,
            fragmentId: 2,
            startIncision: 0,
            wordsCount: 70,
          },
          {
            endIncision: 0,
            fragmentId: 3,
            startIncision: 0,
            wordsCount: 70,
          },
        ],
        groupWordsCount: 100,
        serialId: 1,
      }),
    ).toStrictEqual([
      { fragmentId: 1, groupId: 0, serialId: 1 },
      { fragmentId: 2, groupId: 1, serialId: 1 },
      { fragmentId: 3, groupId: 2, serialId: 1 },
    ]);
  });
});
