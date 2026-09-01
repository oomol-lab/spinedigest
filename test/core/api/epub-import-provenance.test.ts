import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

import { importSource } from "../../../packages/core/src/api/import.js";
import { DirectoryDocument } from "../../../packages/core/src/document/index.js";
import { EPUB_SOURCE_ADAPTER } from "../../../packages/core/src/text/source/index.js";
import { withTempDir } from "../../helpers/temp.js";

describe("facade/import EPUB provenance", () => {
  it("persists a provenance map for each imported non-empty section", async () => {
    await withTempDir("wikigraph-epub-import-provenance-", async (path) => {
      const epubPath = resolve("test/fixtures/sources/Cambridge.epub");
      const digest = createHash("sha256")
        .update(await readFile(epubPath))
        .digest("hex");
      const document = await DirectoryDocument.open(path);

      try {
        const imported = await importSource({
          adapter: EPUB_SOURCE_ADAPTER,
          document,
          extractionPrompt: "Keep the source text unchanged.",
          llm: {} as never,
          path: epubPath,
          targetStage: "sourced",
        });

        expect(imported.serials.length).toBeGreaterThan(0);

        for (const serial of imported.serials) {
          const sourceText = await document
            .getSerialFragments(serial.id)
            .readText();
          const mappings = await document.sourceProvenance.listMap(serial.id);

          expect(sourceText).toBeDefined();
          expect(sourceText!.length).toBeGreaterThan(0);
          expect(mappings.length).toBeGreaterThan(0);
          expect(mappings[0]?.sourceStart).toBe(0);
          expect(mappings.at(-1)?.sourceEnd).toBe(
            Array.from(sourceText!).length,
          );
          expect(
            mappings.every(
              (mapping) =>
                mapping.sourceEnd > mapping.sourceStart &&
                typeof mapping.locator.cfi === "string",
            ),
          ).toBe(true);
          expect(
            mappings.every(
              (mapping, index) =>
                index === 0 ||
                mapping.sourceStart === mappings[index - 1]!.sourceEnd,
            ),
          ).toBe(true);
          expect(
            mappings.every((mapping) => mapping.artifact.digest === digest),
          ).toBe(true);
        }

        const artifactNames = new Set(
          (
            await document.sourceProvenance.listMap(imported.serials[0]!.id)
          ).map((mapping) => mapping.artifact.name),
        );
        expect(artifactNames).toStrictEqual(new Set(["Cambridge.epub"]));
      } finally {
        await document.release();
      }
    });
  });
});
