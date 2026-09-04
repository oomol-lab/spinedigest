import {
  formatSourceArtifactUri,
  type ReadonlyDocument,
} from "../../../document/index.js";

import type { SourceLocatorMap } from "./types.js";

interface LocalLocatorRange {
  end: number;
  readonly uri: string;
  readonly start: number;
}

export async function createSourceLocatorMap(
  document: ReadonlyDocument,
  chapterId: number,
  sourceStart: number | undefined,
  sourceEnd: number | undefined,
): Promise<SourceLocatorMap> {
  if (
    sourceStart === undefined ||
    sourceEnd === undefined ||
    sourceEnd <= sourceStart
  ) {
    return {};
  }

  const [mappings, sourceRevision] = await Promise.all([
    document.sourceProvenance.listMap(chapterId),
    document.serials.getRevision(chapterId),
  ]);
  const ranges: LocalLocatorRange[] = [];

  for (const mapping of mappings) {
    if (
      mapping.sourceRevision !== sourceRevision ||
      mapping.sourceStart >= sourceEnd ||
      mapping.sourceEnd <= sourceStart
    ) {
      continue;
    }

    const start = Math.max(mapping.sourceStart, sourceStart) - sourceStart;
    const end = Math.min(mapping.sourceEnd, sourceEnd) - sourceStart;
    if (end <= start) continue;

    const uri = formatSourceArtifactUri(
      mapping.artifact.digest,
      mapping.fragment,
    );
    const previous = ranges.at(-1);
    if (
      previous !== undefined &&
      previous.uri === uri &&
      previous.end === start
    ) {
      previous.end = end;
    } else {
      ranges.push({ end, start, uri });
    }
  }

  return Object.fromEntries(
    ranges.map((range) => [`${range.start + 1}..${range.end}`, range.uri]),
  );
}
