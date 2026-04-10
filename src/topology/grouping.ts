import type { FragmentGroupRecord } from "../document/index.js";
import { computeNormalizedFragmentIncisions } from "./fragment-incision.js";
import { createFragmentGroups } from "./resource-segmentation.js";

export async function groupFragments(input: {
  edges: Parameters<typeof computeNormalizedFragmentIncisions>[0]["edges"];
  fragments: Parameters<
    typeof computeNormalizedFragmentIncisions
  >[0]["fragments"];
  groupTokensCount: number;
  chunks: Parameters<typeof computeNormalizedFragmentIncisions>[0]["chunks"];
  serialId: number;
}): Promise<FragmentGroupRecord[]> {
  const fragmentInfos = await computeNormalizedFragmentIncisions({
    chunks: input.chunks,
    edges: input.edges,
    fragments: input.fragments,
  });

  return createFragmentGroups({
    fragmentInfos,
    groupTokensCount: input.groupTokensCount,
    serialId: input.serialId,
  });
}
