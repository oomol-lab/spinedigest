const SOURCE_ARTIFACT_DIGEST_PATTERN = /^[0-9a-f]{64}$/iu;

export interface ParsedSourceLocatorFragment {
  readonly fragment: string;
  readonly locator: Readonly<Record<string, unknown>>;
  readonly mediaType: "application/epub+zip" | "application/pdf";
}

export function normalizeSourceArtifactDigest(value: string): string {
  if (!SOURCE_ARTIFACT_DIGEST_PATTERN.test(value)) {
    throw new Error(
      "Source artifact digest must be exactly 64 hex characters.",
    );
  }

  return value.toLowerCase();
}

export function formatSourceArtifactUri(
  digest: string,
  fragment?: string,
): string {
  const normalizedDigest = normalizeSourceArtifactDigest(digest);

  return `wikg://artifact/${normalizedDigest}${
    fragment === undefined ? "" : `#${fragment}`
  }`;
}

export function formatSourceLocatorFragment(
  mediaType: string,
  locator: Readonly<Record<string, unknown>>,
): string {
  if (mediaType === "application/pdf") {
    return formatPdfLocatorFragment(locator);
  }
  if (mediaType === "application/epub+zip") {
    return formatEpubLocatorFragment(locator);
  }

  throw new Error(`Unsupported source artifact mediaType ${mediaType}.`);
}

export function parseSourceLocatorFragment(
  value: string,
): ParsedSourceLocatorFragment {
  if (isSyntacticallyValidCfi(value)) {
    return {
      fragment: value,
      locator: { cfi: value },
      mediaType: "application/epub+zip",
    };
  }

  const match =
    /^page=([1-9][0-9]*)&bbox=([^,]+),([^,]+),([^,]+),([^,]+)$/u.exec(value);
  if (match === null) {
    throw new Error(`Invalid source artifact locator fragment: ${value}`);
  }

  const pageIndex = Number(match[1]);
  const bbox = match.slice(2).map(Number);
  const locator = { bbox, pageIndex };

  return {
    fragment: formatPdfLocatorFragment(locator),
    locator,
    mediaType: "application/pdf",
  };
}

function formatPdfLocatorFragment(
  locator: Readonly<Record<string, unknown>>,
): string {
  const pageIndex = locator.pageIndex;
  const bbox = locator.bbox;
  if (!Number.isInteger(pageIndex) || (pageIndex as number) < 1) {
    throw new Error("PDF locator pageIndex must be a 1-based integer.");
  }
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    !bbox.every(
      (coordinate) =>
        typeof coordinate === "number" &&
        Number.isFinite(coordinate) &&
        coordinate >= 0 &&
        coordinate <= 1,
    )
  ) {
    throw new Error(
      "PDF locator bbox must contain four finite numbers in [0, 1].",
    );
  }
  const [left, bottom, right, top] = bbox as [number, number, number, number];
  if (left > right || bottom > top) {
    throw new Error("PDF locator bbox must be [left, bottom, right, top].");
  }

  return `page=${String(pageIndex)}&bbox=${bbox
    .map((coordinate) => String(Object.is(coordinate, -0) ? 0 : coordinate))
    .join(",")}`;
}

function formatEpubLocatorFragment(
  locator: Readonly<Record<string, unknown>>,
): string {
  if (
    typeof locator.cfi !== "string" ||
    !isSyntacticallyValidCfi(locator.cfi)
  ) {
    throw new Error(
      "EPUB locator cfi must be a syntactically valid epubcfi(...).",
    );
  }

  return locator.cfi;
}

function isSyntacticallyValidCfi(value: string): boolean {
  if (!value.startsWith("epubcfi(") || !value.endsWith(")")) return false;
  const body = value.slice("epubcfi(".length, -1);
  if (!body.startsWith("/")) return false;

  const step = /\/\d+(?:\[[^\r\n]*\])?/gu;
  let cursor = 0;
  while (cursor < body.length) {
    if (body[cursor] === "/") {
      step.lastIndex = cursor;
      const match = step.exec(body);
      if (match === null || match.index !== cursor) return false;
      cursor = step.lastIndex;
      continue;
    }
    if (body[cursor] === "!") {
      cursor += 1;
      continue;
    }
    if (body[cursor] === ":" || body[cursor] === "@" || body[cursor] === "~") {
      const match = /^(?::\d+|@\d+(?::\d+)?|~\d+(?:@\d+(?::\d+)?)?)/u.exec(
        body.slice(cursor),
      );
      if (match === null) return false;
      cursor += match[0].length;
      if (body[cursor] === "[") {
        const assertionEnd = body.indexOf("]", cursor + 1);
        if (assertionEnd < 0) return false;
        cursor = assertionEnd + 1;
      }
      continue;
    }
    if (body[cursor] === ",") {
      cursor += 1;
      continue;
    }
    return false;
  }

  return cursor > 0;
}
