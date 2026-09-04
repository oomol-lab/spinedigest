import {
  formatSourceArtifactUri,
  type ReadonlyDocument,
} from "../../../document/index.js";
import { listChapters } from "../../../document/chapter/index.js";
import { parseChapterPath } from "../../../document/chapter/path.js";
import { parseWikiGraphUriSyntax } from "../../../runtime/common/wiki-graph/uri.js";

import {
  DEFAULT_FIND_LIMIT,
  decodeFindCursor,
  encodeFindCursor,
} from "./helpers.js";
import { readTextStreamRange } from "./text-streams.js";
import type {
  ArchiveSourceLocator,
  ArchiveSourceLocatorOptions,
  ArchiveSourceLocatorResult,
} from "./types.js";

interface LocalLocatorRange {
  end: number;
  readonly uri: string;
  readonly start: number;
}

export async function listArchiveSourceLocators(
  document: ReadonlyDocument,
  uri: string,
  options: ArchiveSourceLocatorOptions = {},
): Promise<ArchiveSourceLocatorResult> {
  const target = parseSourceLocatorScopeUri(uri);
  const chapter = (await listChapters(document)).find(
    (entry) => entry.path === target.chapterPath,
  );
  if (chapter === undefined) {
    throw new Error(
      `Chapter wikg://chapter/${target.chapterPath} was not found.`,
    );
  }

  const source = await readTextStreamRange(
    document,
    chapter.chapterId,
    "source",
    target.startSentenceIndex,
    target.endSentenceIndex,
  );
  const items = await createSourceLocatorRanges(
    document,
    chapter.chapterId,
    source.sourceStart,
    source.sourceEnd,
  );
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const start = decodeFindCursor(options.cursor);
  const page = items.slice(start, start + limit);
  const nextOffset = start + page.length;

  return {
    items: page,
    limit,
    nextCursor: nextOffset < items.length ? encodeFindCursor(nextOffset) : null,
  };
}

export async function createSourceLocatorRanges(
  document: ReadonlyDocument,
  chapterId: number,
  sourceStart: number | undefined,
  sourceEnd: number | undefined,
): Promise<readonly ArchiveSourceLocator[]> {
  if (
    sourceStart === undefined ||
    sourceEnd === undefined ||
    sourceEnd <= sourceStart
  ) {
    return [];
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

  return ranges.map((range) => ({
    range: [range.start + 1, range.end],
    uri: range.uri,
  }));
}

export function isSourceLocatorScopeUri(uri: string): boolean {
  try {
    parseSourceLocatorScopeUri(uri);
    return true;
  } catch {
    return false;
  }
}

function parseSourceLocatorScopeUri(uri: string): {
  readonly chapterPath: string;
  readonly endSentenceIndex: number;
  readonly startSentenceIndex: number;
} {
  const parsed = parseWikiGraphUriSyntax(uri);
  const parts = parsed.path;
  if (
    parsed.protocol !== "wikg" ||
    parts[0] !== "chapter" ||
    parts.length < 4 ||
    parts.at(-2) !== "source" ||
    parts.at(-1) !== "locators"
  ) {
    throw new Error(`Invalid source locator scope URI: ${uri}`);
  }

  const chapterPath = parseChapterPath(parts.slice(1, -2).join("/"));
  const fragment = parsed.fragment;
  if (fragment === undefined) {
    return {
      chapterPath,
      endSentenceIndex: Number.POSITIVE_INFINITY,
      startSentenceIndex: 0,
    };
  }

  const start =
    typeof fragment === "number"
      ? fragment
      : "begin" in fragment
        ? fragment.begin
        : NaN;
  const end =
    typeof fragment === "number"
      ? fragment
      : "end" in fragment
        ? fragment.end
        : NaN;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start
  ) {
    throw new Error(`Invalid source locator sentence range: ${uri}`);
  }

  return {
    chapterPath,
    endSentenceIndex: end - 1,
    startSentenceIndex: start - 1,
  };
}
