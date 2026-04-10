import { mkdir, readFile, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import {
  extractSdpubArchive,
  writeSdpubArchive,
} from "../../src/facade/archive.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/archive", () => {
  it("writes and extracts sdpub archives", async () => {
    await withTempDir("spinedigest-archive-", async (path) => {
      const sourceDir = `${path}/source`;
      const archivePath = `${path}/result/book.sdpub`;
      const extractDir = `${path}/extract`;

      await mkdir(`${sourceDir}/nested`, { recursive: true });
      await writeFile(`${sourceDir}/alpha.txt`, "alpha", "utf8");
      await writeFile(`${sourceDir}/nested/beta.txt`, "beta", "utf8");

      await writeSdpubArchive(sourceDir, archivePath);
      await extractSdpubArchive(archivePath, extractDir);

      expect(await readFile(`${extractDir}/alpha.txt`, "utf8")).toBe("alpha");
      expect(await readFile(`${extractDir}/nested/beta.txt`, "utf8")).toBe(
        "beta",
      );
      await expect(readFile(`${extractDir}/nested`, "utf8")).rejects.toThrow();
    });
  });

  it("creates parent directories for the output archive path", async () => {
    await withTempDir("spinedigest-archive-", async (path) => {
      const sourceDir = `${path}/source`;
      const archivePath = `${path}/deep/output/book.sdpub`;

      await mkdir(sourceDir, { recursive: true });
      await writeFile(`${sourceDir}/chapter.txt`, "chapter", "utf8");
      await writeSdpubArchive(sourceDir, archivePath);

      await expect(readFile(archivePath)).resolves.toBeInstanceOf(Uint8Array);
      await extractSdpubArchive(archivePath, `${path}/unpacked`);
      expect(await readFile(`${path}/unpacked/chapter.txt`, "utf8")).toBe(
        "chapter",
      );
    });
  });
});
