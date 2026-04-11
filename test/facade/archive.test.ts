import { mkdir, readFile, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import {
  extractSdpubArchive,
  writeSdpubArchive,
} from "../../src/facade/archive.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/archive", () => {
  it("writes and extracts only whitelisted sdpub document files", async () => {
    await withTempDir("spinedigest-archive-", async (path) => {
      const sourceDir = `${path}/source`;
      const archivePath = `${path}/result/book.sdpub`;
      const extractDir = `${path}/extract`;

      await mkdir(`${sourceDir}/cover`, { recursive: true });
      await mkdir(`${sourceDir}/fragments/serial-1`, { recursive: true });
      await mkdir(`${sourceDir}/summaries`, { recursive: true });
      await writeFile(`${sourceDir}/database.db`, "sqlite", "utf8");
      await writeFile(`${sourceDir}/database.db-journal`, "journal", "utf8");
      await writeFile(
        `${sourceDir}/book-meta.json`,
        '{"title":"Book"}',
        "utf8",
      );
      await writeFile(`${sourceDir}/toc.json`, '{"items":[]}', "utf8");
      await writeFile(
        `${sourceDir}/cover/info.json`,
        '{"mediaType":"image/png"}',
        "utf8",
      );
      await writeFile(`${sourceDir}/cover/data.bin`, "cover-bytes", "utf8");
      await writeFile(
        `${sourceDir}/fragments/serial-1/fragment_0.json`,
        '{"summary":"","sentences":[]}',
        "utf8",
      );
      await writeFile(
        `${sourceDir}/fragments/serial-1/note.txt`,
        "ignored",
        "utf8",
      );
      await writeFile(`${sourceDir}/summaries/serial-1.txt`, "summary", "utf8");
      await writeFile(`${sourceDir}/alpha.txt`, "ignored", "utf8");

      await writeSdpubArchive(sourceDir, archivePath);
      await extractSdpubArchive(archivePath, extractDir);

      expect(await readFile(`${extractDir}/database.db`, "utf8")).toBe(
        "sqlite",
      );
      expect(await readFile(`${extractDir}/book-meta.json`, "utf8")).toContain(
        '"title":"Book"',
      );
      expect(await readFile(`${extractDir}/toc.json`, "utf8")).toContain(
        '"items":[]',
      );
      expect(
        await readFile(
          `${extractDir}/fragments/serial-1/fragment_0.json`,
          "utf8",
        ),
      ).toContain('"sentences":[]');
      expect(
        await readFile(`${extractDir}/summaries/serial-1.txt`, "utf8"),
      ).toBe("summary");
      expect(await readFile(`${extractDir}/cover/data.bin`, "utf8")).toBe(
        "cover-bytes",
      );
      await expect(
        readFile(`${extractDir}/database.db-journal`, "utf8"),
      ).rejects.toThrow();
      await expect(
        readFile(`${extractDir}/alpha.txt`, "utf8"),
      ).rejects.toThrow();
      await expect(
        readFile(`${extractDir}/fragments/serial-1/note.txt`, "utf8"),
      ).rejects.toThrow();
    });
  });

  it("creates parent directories for the output archive path", async () => {
    await withTempDir("spinedigest-archive-", async (path) => {
      const sourceDir = `${path}/source`;
      const archivePath = `${path}/deep/output/book.sdpub`;

      await mkdir(sourceDir, { recursive: true });
      await writeFile(`${sourceDir}/database.db`, "chapter", "utf8");
      await writeSdpubArchive(sourceDir, archivePath);

      await expect(readFile(archivePath)).resolves.toBeInstanceOf(Uint8Array);
      await extractSdpubArchive(archivePath, `${path}/unpacked`);
      expect(await readFile(`${path}/unpacked/database.db`, "utf8")).toBe(
        "chapter",
      );
    });
  });
});
