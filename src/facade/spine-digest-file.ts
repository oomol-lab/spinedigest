import { mkdtemp, rm } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";

import { DirectoryDocument } from "../document/index.js";

import { extractSdpubArchive } from "./archive.js";
import { SpineDigest } from "./spine-digest.js";

export class SpineDigestFile {
  readonly #path: string;

  public constructor(path: string) {
    this.#path = resolve(path);
  }

  public async openSession<T>(
    operation: (digest: SpineDigest) => Promise<T> | T,
  ): Promise<T> {
    const temporaryDirectoryPath = await mkdtemp(
      join(tmpdir(), "spinedigest-open-"),
    );

    try {
      await extractSdpubArchive(this.#path, temporaryDirectoryPath);

      const document = await DirectoryDocument.open(temporaryDirectoryPath);

      try {
        return await operation(
          new SpineDigest(document, temporaryDirectoryPath),
        );
      } finally {
        await document.release();
      }
    } finally {
      await rm(temporaryDirectoryPath, { force: true, recursive: true });
    }
  }
}
