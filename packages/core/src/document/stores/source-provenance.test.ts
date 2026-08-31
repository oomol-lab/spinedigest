import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../index.js";
import { writeSerialSource } from "../../text/serial/source.js";

describe("SourceProvenanceStore", () => {
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
});
