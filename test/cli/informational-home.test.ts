import { access, mkdir, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Writable } from "stream";

import { afterEach, describe, expect, it } from "vitest";

import { main } from "../../packages/cli/src/app/main.js";
import { installNodeWikiGraphPlatform } from "../../packages/cli/src/runtime/node-platform.js";

describe("CLI informational home isolation", () => {
  const originalExitCode = process.exitCode;
  const originalHome = process.env.HOME;

  afterEach(() => {
    process.exitCode = originalExitCode;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    installNodeWikiGraphPlatform();
  });

  it.each([
    ["version", ["--version"]],
    ["root help", ["--help"]],
    ["help command", ["help"]],
  ] as const)("does not create ~/.wikigraph for %s", async (_name, argv) => {
    const root = await mkdtemp(join(tmpdir(), "wikigraph-info-home-"));
    const home = join(root, "home");
    await mkdir(home);
    process.env.HOME = home;
    process.exitCode = 0;
    const stdout = createCaptureStream();
    const stderr = createCaptureStream();

    try {
      await main({
        argv,
        env: {
          ...process.env,
          WIKIGRAPH_DEV: undefined,
          WIKIGRAPH_ENV_POLICY: undefined,
          WIKIGRAPH_QUEUE_DISABLE_AUTOSTART: undefined,
          WIKIGRAPH_STATE_DIR: undefined,
        },
        stderr: stderr.stream,
        stdin: "",
        stdinIsTTY: false,
        stdout: stdout.stream,
      });

      expect(process.exitCode).toBe(0);
      expect(stderr.text).toBe("");
      expect(stdout.text.length).toBeGreaterThan(0);
      await expect(access(join(home, ".wikigraph"))).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function createCaptureStream(): {
  readonly stream: Writable;
  readonly text: string;
} {
  const chunks: string[] = [];
  return {
    stream: new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    }),
    get text() {
      return chunks.join("");
    },
  };
}
