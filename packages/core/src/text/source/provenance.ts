import { z } from "zod";

import type {
  SourceArtifactInput,
  SourceTextProvenanceInput,
} from "../../document/types.js";
import { formatSourceLocatorFragment } from "../../document/source-locator.js";

const artifactRecordSchema = z.object({
  type: z.literal("artifact"),
  digest: z.string().regex(/^[0-9a-f]{64}$/iu),
  mediaType: z.string().min(1),
  name: z.string().optional(),
  identifier: z.string().max(1024).optional(),
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
    sourceOffset += countCharacters(record.text);
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
  try {
    formatSourceLocatorFragment(mediaType, locator);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message.replace(/\.$/u, "")} at line ${lineNumber}.`, {
      cause: error,
    });
  }
}

function countCharacters(text: string): number {
  return Array.from(text).length;
}
