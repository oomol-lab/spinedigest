import {
  formatSourceArtifactUri,
  type ReadonlyDocument,
} from "../../../document/index.js";
import { listChapters } from "../../../document/chapter/index.js";
import { parseChapterPath } from "../../../document/chapter/path.js";
import { parseWikiGraphUriSyntax } from "../../../runtime/common/wiki-graph/uri.js";
import {
  decodeBase64UrlText,
  encodeBase64UrlText,
} from "../../../utils/bytes.js";

import { DEFAULT_FIND_LIMIT } from "./helpers.js";
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

  const sourceRevision = await document.serials.getRevision(chapter.chapterId);
  const start = decodeSourceLocatorCursor(options.cursor, sourceRevision);
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
  if (
    (await document.serials.getRevision(chapter.chapterId)) !== sourceRevision
  ) {
    throw new Error("Invalid or stale source locator cursor.");
  }
  const limit = options.limit ?? DEFAULT_FIND_LIMIT;
  const page = items.slice(start, start + limit);
  const nextOffset = start + page.length;

  return {
    items: page,
    limit,
    nextCursor:
      nextOffset < items.length
        ? encodeSourceLocatorCursor(nextOffset, sourceRevision)
        : null,
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
      mapping.artifact.shortUid,
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

function encodeSourceLocatorCursor(
  offset: number,
  sourceRevision: number,
): string {
  return encodeBase64UrlText(JSON.stringify({ offset, sourceRevision, v: 1 }));
}

function decodeSourceLocatorCursor(
  cursor: string | undefined,
  sourceRevision: number,
): number {
  if (cursor === undefined) return 0;

  try {
    const parsed: unknown = JSON.parse(decodeBase64UrlText(cursor));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "v" in parsed &&
      "offset" in parsed &&
      "sourceRevision" in parsed &&
      parsed.v === 1 &&
      Number.isInteger(parsed.offset) &&
      typeof parsed.offset === "number" &&
      parsed.offset >= 0 &&
      Number.isInteger(parsed.sourceRevision) &&
      parsed.sourceRevision === sourceRevision
    ) {
      return parsed.offset;
    }
  } catch {
    throw new Error("Invalid or stale source locator cursor.");
  }

  throw new Error("Invalid or stale source locator cursor.");
}
