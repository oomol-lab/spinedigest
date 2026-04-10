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
    options: {
      readonly documentDirPath?: string;
    } = {},
  ): Promise<T> {
    const directoryPath =
      options.documentDirPath === undefined
        ? await mkdtemp(join(tmpdir(), "spinedigest-open-"))
        : resolve(options.documentDirPath);

    try {
      await extractSdpubArchive(this.#path, directoryPath);

      const document = await DirectoryDocument.open(directoryPath);

      try {
        return await operation(new SpineDigest(document, directoryPath));
      } finally {
        await document.release();
      }
    } finally {
      if (options.documentDirPath === undefined) {
        await rm(directoryPath, { force: true, recursive: true });
      }
    }
  }
}
