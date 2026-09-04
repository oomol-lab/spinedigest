import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../index.js";
import { writeSerialSource } from "../../text/serial/source.js";

describe("SourceProvenanceStore", () => {
  it("persists exact stable short UIDs and extends only new collisions", async () => {
    const path = await mkdtemp(join(tmpdir(), "wikigraph-source-provenance-"));
    try {
      const document = await DirectoryDocument.open(path);
      try {
        await document.openSession(async (opened) => {
          const serialId = await opened.createSerial();
          const first = "a".repeat(64);
          const second = `${"a".repeat(12)}b${"1".repeat(51)}`;
          const third = `${"a".repeat(12)}bc${"2".repeat(50)}`;

          const replace = async (digests: readonly string[]) => {
            await opened.sourceProvenance.replace(serialId, 1, {
              artifacts: digests.map((digest) => ({
                digest,
                mediaType: "application/pdf",
              })),
              mappings: digests.map((digest, index) => ({
                artifactDigest: digest,
                locator: {
                  bbox: [0, 0, 1, 1],
                  pageIndex: index + 1,
                },
                sourceEnd: index + 1,
                sourceStart: index,
              })),
            });
          };

          await replace([first]);
          expect(
            await opened.sourceProvenance.getArtifact(first),
          ).toMatchObject({ digest: first, shortUid: "a".repeat(12) });

          await replace([first, second]);
          await replace([first, second, third]);

          const artifacts = await opened.sourceProvenance.listArtifacts();
          expect(
            artifacts.map(({ digest, shortUid }) => ({ digest, shortUid })),
          ).toStrictEqual([
            { digest: first, shortUid: "a".repeat(12) },
            { digest: second, shortUid: `${"a".repeat(12)}b` },
            { digest: third, shortUid: `${"a".repeat(12)}bc` },
          ]);
          await expect(
            opened.sourceProvenance.getArtifact("a".repeat(12)),
          ).resolves.toMatchObject({ digest: first });
          await expect(
            opened.sourceProvenance.getArtifact(`${"a".repeat(12)}b`),
          ).resolves.toMatchObject({ digest: second });
          await expect(
            opened.sourceProvenance.getArtifact(second),
          ).resolves.toMatchObject({ shortUid: `${"a".repeat(12)}b` });
          await expect(
            opened.sourceProvenance.getArtifact(`${"a".repeat(12)}b1`),
          ).resolves.toBeUndefined();
        });
      } finally {
        await document.release();
      }
    } finally {
      await rm(path, { force: true, recursive: true });
    }
  });

  it("replaces provenance atomically and removes unreferenced artifacts", async () => {
    const path = await mkdtemp(join(tmpdir(), "wikigraph-source-provenance-"));
    try {
      const document = await DirectoryDocument.open(path);
      try {
        await document.openSession(async (opened) => {
          const serialId = await opened.createSerial();
          await opened.sourceProvenance.replace(serialId, 1, {
            artifacts: [
              {
                digest: "A".repeat(64),
                mediaType: "application/pdf",
                name: "book.pdf",
              },
            ],
            mappings: [
              {
                artifactDigest: "A".repeat(64),
                locator: { pageIndex: 1, bbox: [0, 0, 1, 1] },
                sourceStart: 0,
                sourceEnd: 5,
              },
            ],
          });
          expect(await opened.sourceProvenance.listMap(serialId)).toHaveLength(
            1,
          );

          await opened.sourceProvenance.clear(serialId);
          expect(await opened.sourceProvenance.listMap(serialId)).toStrictEqual(
            [],
          );
          expect(await opened.sourceProvenance.listArtifacts()).toStrictEqual(
            [],
          );
        });
      } finally {
        await document.release();
      }
    } finally {
      await rm(path, { force: true, recursive: true });
    }
  });

  it("preflights mediaType conflicts before replacing existing source text", async () => {
    const path = await mkdtemp(join(tmpdir(), "wikigraph-source-provenance-"));
    try {
      const document = await DirectoryDocument.open(path);
      try {
        await document.openSession(async (opened) => {
          const serialId = await opened.createSerial();
          const digest = "B".repeat(64);
          await writeSerialSource(opened, serialId, ["original"], {
            provenance: {
              artifacts: [{ digest, mediaType: "application/pdf" }],
              mappings: [
                {
                  artifactDigest: digest,
                  locator: { pageIndex: 1, bbox: [0, 0, 1, 1] },
                  sourceStart: 0,
                  sourceEnd: 8,
                },
              ],
            },
          });
          const revision = await opened.serials.getRevision(serialId);
          const beforeMap = await opened.sourceProvenance.listMap(serialId);

          await expect(
            writeSerialSource(opened, serialId, ["replacement"], {
              provenance: {
                artifacts: [{ digest, mediaType: "application/epub+zip" }],
                mappings: [],
              },
            }),
          ).rejects.toThrow(/mediaType/iu);

          expect(await opened.getSerialFragments(serialId).readText()).toBe(
            "original",
          );
          expect(await opened.serials.getRevision(serialId)).toBe(revision);
          expect(await opened.sourceProvenance.listMap(serialId)).toStrictEqual(
            beforeMap,
          );
        });
      } finally {
        await document.release();
      }
    } finally {
      await rm(path, { force: true, recursive: true });
    }
  });

  it("preflights invalid mappings before replacing source text", async () => {
    const path = await mkdtemp(join(tmpdir(), "wikigraph-source-provenance-"));
    try {
      const document = await DirectoryDocument.open(path);
      try {
        await document.openSession(async (opened) => {
          const serialId = await opened.createSerial();
          const digest = "E".repeat(64);
          await writeSerialSource(opened, serialId, ["original"], {
            provenance: {
              artifacts: [{ digest, mediaType: "application/pdf" }],
              mappings: [
                {
                  artifactDigest: digest,
                  locator: { pageIndex: 1, bbox: [0, 0, 1, 1] },
                  sourceStart: 0,
                  sourceEnd: 8,
                },
              ],
            },
          });
          const revision = await opened.serials.getRevision(serialId);

          await expect(
            writeSerialSource(opened, serialId, ["replacement"], {
              provenance: {
                artifacts: [{ digest, mediaType: "application/pdf" }],
                mappings: [
                  {
                    artifactDigest: "F".repeat(64),
                    locator: { pageIndex: 1, bbox: [0, 0, 1, 1] },
                    sourceStart: 0,
                    sourceEnd: 11,
                  },
                ],
              },
            }),
          ).rejects.toThrow(/undeclared artifact/iu);

          expect(await opened.getSerialFragments(serialId).readText()).toBe(
            "original",
          );
          expect(await opened.serials.getRevision(serialId)).toBe(revision);
        });
      } finally {
        await document.release();
      }
    } finally {
      await rm(path, { force: true, recursive: true });
    }
  });
});
