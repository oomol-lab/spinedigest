import { z } from "zod";

import type {
  SourceArtifactInput,
  SourceTextProvenanceInput,
} from "../../document/types.js";

const artifactRecordSchema = z.object({
  type: z.literal("artifact"),
  digest: z.string().regex(/^[0-9a-f]{64}$/iu),
  mediaType: z.string().min(1),
  name: z.string().optional(),
  identifier: z.string().optional(),
});

const textRecordSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  locator: z.record(z.string(), z.unknown()),
});

export interface ParsedSourceTextJsonl {
  readonly provenance: SourceTextProvenanceInput;
  readonly text: string;
}

export function parseSourceTextJsonl(input: string): ParsedSourceTextJsonl {
  const artifacts = new Map<string, SourceArtifactInput>();
  const mappings: Array<SourceTextProvenanceInput["mappings"][number]> = [];
  const textParts: string[] = [];
  let currentArtifact: SourceArtifactInput | undefined;
  let sourceOffset = 0;

  for (const [index, line] of input.split(/\r?\n/u).entries()) {
    if (line.trim() === "") {
      continue;
    }

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid source JSONL at line ${index + 1}.`, {
        cause: error,
      });
    }

    const recordType = readRecordType(value, index + 1);
    if (recordType === "artifact") {
      const artifact = parseArtifactRecord(value, index + 1);
      const digest = artifact.digest.toLowerCase();
      const existing = artifacts.get(digest);

      if (existing !== undefined && existing.mediaType !== artifact.mediaType) {
        throw new Error(
          `Source artifact ${digest} has conflicting mediaType values at line ${index + 1}.`,
        );
      }

      currentArtifact = {
        digest,
        mediaType: artifact.mediaType,
        ...(artifact.name === undefined
          ? existing?.name === undefined
            ? {}
            : { name: existing.name }
          : { name: artifact.name }),
        ...(artifact.identifier === undefined
          ? existing?.identifier === undefined
            ? {}
            : { identifier: existing.identifier }
          : { identifier: artifact.identifier }),
      };
      artifacts.set(digest, currentArtifact);
      continue;
    }

    if (currentArtifact === undefined) {
      throw new Error(
        `Source text record at line ${index + 1} must follow an artifact record.`,
      );
    }

    const record = parseTextRecord(value, index + 1);
    validateLocator(currentArtifact.mediaType, record.locator, index + 1);
    const sourceStart = sourceOffset;
    sourceOffset += record.text.length;
    textParts.push(record.text);
    mappings.push({
      artifactDigest: currentArtifact.digest,
      locator: record.locator,
      sourceEnd: sourceOffset,
      sourceStart,
    });
  }

  if (artifacts.size === 0) {
    throw new Error("Source JSONL must contain at least one artifact record.");
  }
  if (mappings.length === 0) {
    throw new Error("Source JSONL must contain at least one text record.");
  }

  return {
    provenance: {
      artifacts: [...artifacts.values()],
      mappings,
    },
    text: textParts.join(""),
  };
}

function readRecordType(
  value: unknown,
  lineNumber: number,
): "artifact" | "text" {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Source JSONL line ${lineNumber} must be an object.`);
  }
  const type = (value as { readonly type?: unknown }).type;
  if (type !== "artifact" && type !== "text") {
    throw new Error(
      `Source JSONL line ${lineNumber} must have type "artifact" or "text".`,
    );
  }
  return type;
}

function parseArtifactRecord(value: unknown, lineNumber: number) {
  const parsed = artifactRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid source artifact record at line ${lineNumber}.`);
  }
  return parsed.data;
}

function parseTextRecord(value: unknown, lineNumber: number) {
  const parsed = textRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid source text record at line ${lineNumber}.`);
  }
  return parsed.data;
}

function validateLocator(
  mediaType: string,
  locator: Readonly<Record<string, unknown>>,
  lineNumber: number,
): void {
  if (mediaType === "application/pdf") {
    validatePdfLocator(locator, lineNumber);
    return;
  }
  if (mediaType === "application/epub+zip") {
    validateEpubLocator(locator, lineNumber);
    return;
  }
  throw new Error(
    `Unsupported source artifact mediaType ${mediaType} at line ${lineNumber}.`,
  );
}

function validatePdfLocator(
  locator: Readonly<Record<string, unknown>>,
  lineNumber: number,
): void {
  const pageIndex = locator.pageIndex;
  const bbox = locator.bbox;
  if (!Number.isInteger(pageIndex) || (pageIndex as number) < 1) {
    throw new Error(
      `PDF locator pageIndex at line ${lineNumber} must be a 1-based integer.`,
    );
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
      `PDF locator bbox at line ${lineNumber} must contain four finite numbers in [0, 1].`,
    );
  }
  const [left, bottom, right, top] = bbox as [number, number, number, number];
  if (left > right || bottom > top) {
    throw new Error(
      `PDF locator bbox at line ${lineNumber} must be [left, bottom, right, top].`,
    );
  }
}

function validateEpubLocator(
  locator: Readonly<Record<string, unknown>>,
  lineNumber: number,
): void {
  if (
    typeof locator.cfi !== "string" ||
    !/^epubcfi\(.+\)$/u.test(locator.cfi)
  ) {
    throw new Error(
      `EPUB locator cfi at line ${lineNumber} must be a syntactically valid epubcfi(...).`,
    );
  }
}
