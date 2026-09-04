import { bytesToHex, hexToBytes } from "../../utils/bytes.js";
import { getNumber, getOptionalString, getString } from "../database.js";
import type { Database, SqlRow } from "../database.js";
import {
  formatSourceLocatorFragment,
  normalizeSourceArtifactDigest,
} from "../source-locator.js";
import type {
  SourceArtifactRecord,
  SourceLocatorRecord,
  SourceTextMapRecord,
  SourceTextProvenanceInput,
} from "../types.js";
import type { ReadonlySourceProvenanceStore } from "./types.js";

export class SourceProvenanceStore implements ReadonlySourceProvenanceStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async getArtifact(
    digestValue: string,
  ): Promise<SourceArtifactRecord | undefined> {
    const digest = normalizeSourceArtifactDigest(digestValue);

    return await this.#database.queryOne(
      `
        SELECT id, digest, media_type, name, identifier
        FROM source_artifacts
        WHERE digest = ?
      `,
      [hexToBytes(digest)],
      mapArtifactRecord,
    );
  }

  public async getLocator(
    digestValue: string,
    fragment: string,
  ): Promise<SourceLocatorRecord | undefined> {
    const digest = normalizeSourceArtifactDigest(digestValue);

    return await this.#database.queryOne(
      `
        SELECT
          source_artifacts.digest AS digest,
          source_artifacts.media_type AS media_type,
          source_artifacts.name AS name,
          source_artifacts.identifier AS identifier,
          source_locators.fragment AS fragment,
          source_locators.value_json AS value_json
        FROM source_locators
        JOIN source_artifacts
          ON source_artifacts.id = source_locators.artifact_id
        WHERE source_artifacts.digest = ? AND source_locators.fragment = ?
      `,
      [hexToBytes(digest), fragment],
      (row) => ({
        artifact: mapArtifactRecordWithoutId(row),
        fragment: getString(row, "fragment"),
        locator: parseLocator(getString(row, "value_json")),
      }),
    );
  }

  public async listArtifacts(): Promise<SourceArtifactRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT id, digest, media_type, name, identifier
        FROM source_artifacts
        ORDER BY id
      `,
      undefined,
      mapArtifactRecord,
    );
  }

  public async listMap(serialId: number): Promise<SourceTextMapRecord[]> {
    return await this.#database.queryAll(
      `
        SELECT
          source_text_maps.source_revision AS source_revision,
          source_text_maps.source_start AS source_start,
          source_text_maps.source_end AS source_end,
          source_artifacts.digest AS digest,
          source_artifacts.media_type AS media_type,
          source_artifacts.name AS name,
          source_artifacts.identifier AS identifier,
          source_locators.fragment AS fragment,
          source_locators.value_json AS value_json
        FROM source_text_maps
        JOIN source_locators
          ON source_locators.id = source_text_maps.locator_id
        JOIN source_artifacts
          ON source_artifacts.id = source_locators.artifact_id
        WHERE source_text_maps.serial_id = ?
        ORDER BY source_text_maps.source_start, source_text_maps.locator_id
      `,
      [serialId],
      (row) => {
        const identifier = getOptionalString(row, "identifier");
        const name = getOptionalString(row, "name");
        return {
          artifact: {
            digest: readDigest(row.digest),
            ...(identifier === undefined ? {} : { identifier }),
            mediaType: getString(row, "media_type"),
            ...(name === undefined ? {} : { name }),
          },
          fragment: getString(row, "fragment"),
          locator: parseLocator(getString(row, "value_json")),
          sourceEnd: getNumber(row, "source_end"),
          sourceRevision: getNumber(row, "source_revision"),
          sourceStart: getNumber(row, "source_start"),
        };
      },
    );
  }

  public async replace(
    serialId: number,
    sourceRevision: number,
    input: SourceTextProvenanceInput | undefined,
  ): Promise<void> {
    await this.#database.transaction(async () => {
      await this.validate(input);
      await this.#deleteSerialRecords(serialId);

      if (input !== undefined) {
        const artifactIds = new Map<string, number>();

        for (const artifact of input.artifacts) {
          const digest = normalizeSourceArtifactDigest(artifact.digest);
          const existing = await this.#database.queryOne(
            `
              SELECT id, media_type
              FROM source_artifacts
              WHERE digest = ?
            `,
            [hexToBytes(digest)],
            (row) => ({
              id: getNumber(row, "id"),
              mediaType: getString(row, "media_type"),
            }),
          );

          if (
            existing !== undefined &&
            existing.mediaType !== artifact.mediaType
          ) {
            throw new Error(
              `Source artifact ${digest} already exists with mediaType ${existing.mediaType}; received ${artifact.mediaType}.`,
            );
          }

          if (existing === undefined) {
            await this.#database.run(
              `
                INSERT INTO source_artifacts (
                  digest, media_type, name, identifier
                )
                VALUES (?, ?, ?, ?)
              `,
              [
                hexToBytes(digest),
                artifact.mediaType,
                artifact.name ?? null,
                artifact.identifier ?? null,
              ],
            );
            artifactIds.set(digest, await this.#database.getLastInsertRowId());
          } else {
            const existingMetadata = await this.#database.queryOne(
              `
                SELECT name, identifier
                FROM source_artifacts
                WHERE id = ?
              `,
              [existing.id],
              (row) => ({
                identifier: getOptionalString(row, "identifier"),
                name: getOptionalString(row, "name"),
              }),
            );
            await this.#database.run(
              `
                UPDATE source_artifacts
                SET name = ?, identifier = ?
                WHERE id = ?
              `,
              [
                artifact.name ?? existingMetadata?.name ?? null,
                artifact.identifier ?? existingMetadata?.identifier ?? null,
                existing.id,
              ],
            );
            artifactIds.set(digest, existing.id);
          }
        }

        for (const mapping of input.mappings) {
          if (
            !Number.isInteger(mapping.sourceStart) ||
            !Number.isInteger(mapping.sourceEnd) ||
            mapping.sourceStart < 0 ||
            mapping.sourceEnd < mapping.sourceStart
          ) {
            throw new Error(
              "Source text map offsets must be non-negative integer ranges.",
            );
          }
          const digest = normalizeSourceArtifactDigest(mapping.artifactDigest);
          const artifactId = artifactIds.get(digest);

          if (artifactId === undefined) {
            throw new Error(
              `Source mapping references undeclared artifact ${digest}.`,
            );
          }

          const artifact = input.artifacts.find(
            (candidate) =>
              normalizeSourceArtifactDigest(candidate.digest) === digest,
          );
          if (artifact === undefined) {
            throw new Error(
              `Source mapping references undeclared artifact ${digest}.`,
            );
          }
          const fragment = formatSourceLocatorFragment(
            artifact.mediaType,
            mapping.locator,
          );

          await this.#database.run(
            `
              INSERT INTO source_locators (artifact_id, fragment, value_json)
              VALUES (?, ?, ?)
              ON CONFLICT(artifact_id, fragment) DO NOTHING
            `,
            [artifactId, fragment, JSON.stringify(mapping.locator)],
          );
          const locatorId = await this.#database.queryOne(
            `
              SELECT id
              FROM source_locators
              WHERE artifact_id = ? AND fragment = ?
            `,
            [artifactId, fragment],
            (row) => getNumber(row, "id"),
          );
          if (locatorId === undefined) {
            throw new Error("Failed to persist source locator.");
          }

          await this.#database.run(
            `
              INSERT INTO source_text_maps (
                serial_id,
                source_revision,
                source_start,
                source_end,
                locator_id
              )
              VALUES (?, ?, ?, ?, ?)
            `,
            [
              serialId,
              sourceRevision,
              mapping.sourceStart,
              mapping.sourceEnd,
              locatorId,
            ],
          );
        }
      }

      await this.#deleteUnreferenced();
    });
  }

  public async clear(serialId: number): Promise<void> {
    await this.replace(serialId, 0, undefined);
  }

  /** Validate all artifact constraints without changing provenance records. */
  public async validate(
    input: SourceTextProvenanceInput | undefined,
    options: { readonly sourceTextLength?: number } = {},
  ): Promise<void> {
    if (input === undefined) return;
    const seen = new Map<string, string>();
    const declared = new Set<string>();
    for (const artifact of input.artifacts) {
      const digest = normalizeSourceArtifactDigest(artifact.digest);
      if (artifact.mediaType.length === 0) {
        throw new Error("Source artifact mediaType must not be empty.");
      }
      if (
        artifact.identifier !== undefined &&
        Array.from(artifact.identifier).length > 1024
      ) {
        throw new Error(
          "Source artifact identifier must be at most 1024 characters.",
        );
      }
      declared.add(digest);
      const prior = seen.get(digest);
      if (prior !== undefined && prior !== artifact.mediaType) {
        throw new Error(
          `Source artifact ${digest} has conflicting mediaType values.`,
        );
      }
      seen.set(digest, artifact.mediaType);
      for (const mapping of input.mappings) {
        if (normalizeSourceArtifactDigest(mapping.artifactDigest) === digest) {
          formatSourceLocatorFragment(artifact.mediaType, mapping.locator);
        }
      }
      const existing = await this.#database.queryOne(
        `SELECT media_type FROM source_artifacts WHERE digest = ?`,
        [hexToBytes(digest)],
        (row) => getString(row, "media_type"),
      );
      if (existing !== undefined && existing !== artifact.mediaType) {
        throw new Error(
          `Source artifact ${digest} already exists with mediaType ${existing}; received ${artifact.mediaType}.`,
        );
      }
    }

    if (input.artifacts.length === 0 || input.mappings.length === 0) {
      throw new Error(
        "Source provenance must contain artifacts and source text mappings.",
      );
    }

    for (const mapping of input.mappings) {
      if (
        !Number.isInteger(mapping.sourceStart) ||
        !Number.isInteger(mapping.sourceEnd) ||
        mapping.sourceStart < 0 ||
        mapping.sourceEnd < mapping.sourceStart ||
        (options.sourceTextLength !== undefined &&
          mapping.sourceEnd > options.sourceTextLength)
      ) {
        throw new Error(
          "Source text map offsets must be non-negative character ranges within source text.",
        );
      }
      if (
        !declared.has(normalizeSourceArtifactDigest(mapping.artifactDigest))
      ) {
        throw new Error(
          `Source mapping references undeclared artifact ${mapping.artifactDigest}.`,
        );
      }
    }

    const orderedMappings = input.mappings
      .filter((mapping) => mapping.sourceEnd > mapping.sourceStart)
      .slice()
      .sort(
        (left, right) =>
          left.sourceStart - right.sourceStart ||
          left.sourceEnd - right.sourceEnd,
      );
    for (let index = 1; index < orderedMappings.length; index += 1) {
      if (
        orderedMappings[index]!.sourceStart <
        orderedMappings[index - 1]!.sourceEnd
      ) {
        throw new Error("Source text map ranges must not overlap.");
      }
    }
  }

  async #deleteSerialRecords(serialId: number): Promise<void> {
    await this.#database.run(
      `DELETE FROM source_text_maps WHERE serial_id = ?`,
      [serialId],
    );
  }

  async #deleteUnreferenced(): Promise<void> {
    await this.#database.run(
      `
        DELETE FROM source_locators
        WHERE NOT EXISTS (
          SELECT 1
          FROM source_text_maps
          WHERE source_text_maps.locator_id = source_locators.id
        )
      `,
    );
    await this.#database.run(
      `
        DELETE FROM source_artifacts
        WHERE NOT EXISTS (
          SELECT 1
          FROM source_locators
          WHERE source_locators.artifact_id = source_artifacts.id
        )
      `,
    );
  }
}

function readDigest(value: unknown): string {
  if (value instanceof Uint8Array) {
    return bytesToHex(value);
  }
  throw new TypeError("Expected source artifact digest to be binary");
}

function mapArtifactRecord(row: SqlRow): SourceArtifactRecord {
  return {
    ...mapArtifactRecordWithoutId(row),
    id: getNumber(row, "id"),
  };
}

function mapArtifactRecordWithoutId(
  row: SqlRow,
): Omit<SourceArtifactRecord, "id"> {
  const identifier = getOptionalString(row, "identifier");
  const name = getOptionalString(row, "name");

  return {
    digest: readDigest(row.digest),
    ...(identifier === undefined ? {} : { identifier }),
    mediaType: getString(row, "media_type"),
    ...(name === undefined ? {} : { name }),
  };
}

function parseLocator(value: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Expected source locator to be a JSON object");
  }
  return parsed as Readonly<Record<string, unknown>>;
}
