import { mkdtemp, realpath, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "vitest";

import {
  createWikiGraphCLI,
  runWikiGraphCLICaptured,
} from "../../packages/cli/src/index.js";
import {
  resolveWikiGraphHomeDirectoryPath,
  withWikiGraphRuntimeEnvironment,
} from "wiki-graph-core";

describe("cli/sdk-runner", () => {
  it("captures stdout and stderr without spawning a process", async () => {
    const result = await runWikiGraphCLICaptured({
      argv: ["--version"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\n$/u);
    expect(result.stderr).toBe("");
  });

  it("supports reusable defaults with per-run argv overrides", async () => {
    const cli = createWikiGraphCLI({
      argv: ["--help"],
      stdinIsTTY: true,
    });

    const helpResult = await cli.runCaptured();
    const versionResult = await cli.runCaptured(["--version"]);

    expect(helpResult.exitCode).toBe(0);
    expect(helpResult.stdout).toContain("Wiki Graph CLI");
    expect(helpResult.stderr).toBe("");
    expect(versionResult.exitCode).toBe(0);
    expect(versionResult.stdout).toMatch(/^\d+\.\d+\.\d+\n$/u);
    expect(versionResult.stderr).toBe("");
  });

  it("preserves CLI JSON error output", async () => {
    const result = await runWikiGraphCLICaptured({
      argv: ["unknown-command", "--json"],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: {
        type: "error",
      },
    });
  });

  it("uses runner cwd, env, stdio, TTY flags, and exit code without changing process globals", async () => {
    const originalCwd = process.cwd();
    const outerCwd = await mkdtemp(join(tmpdir(), "wikigraph-runner-outer-"));
    const stateDir = await mkdtemp(join(tmpdir(), "wikigraph-runner-state-"));

    try {
      process.chdir(outerCwd);
      const result = await runWikiGraphCLICaptured({
        argv: ["--version"],
        cwd: originalCwd,
        env: {
          WIKIGRAPH_STATE_DIR: stateDir,
        },
        stdin: "ignored",
        stdinIsTTY: false,
        stdoutIsTTY: true,
        stderrIsTTY: true,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\n$/u);
      expect(result.stderr).toBe("");
      expect(await realpath(process.cwd())).toBe(await realpath(outerCwd));
      expect(process.env.WIKIGRAPH_STATE_DIR).not.toBe(stateDir);
    } finally {
      process.chdir(originalCwd);
      await rm(outerCwd, { force: true, recursive: true });
      await rm(stateDir, { force: true, recursive: true });
    }
  });

  it("lets the core SDK and CLI runner use the same state dir in one process", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wikigraph-shared-state-"));

    try {
      const coreStateDir = await withWikiGraphRuntimeEnvironment(
        {
          ...process.env,
          WIKIGRAPH_STATE_DIR: stateDir,
        },
        () => resolveWikiGraphHomeDirectoryPath(),
      );
      const result = await runWikiGraphCLICaptured({
        argv: ["wikg://local/config/concurrent", "put", "job", "4"],
        env: {
          WIKIGRAPH_STATE_DIR: stateDir,
        },
      });

      expect(coreStateDir).toBe(stateDir);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toStrictEqual({ job: 4 });
      expect(result.stderr).toBe("");
    } finally {
      await rm(stateDir, { force: true, recursive: true });
    }
  });

  it("allows independent runner calls to run concurrently", async () => {
    const leftStateDir = await mkdtemp(join(tmpdir(), "wikigraph-left-state-"));
    const rightStateDir = await mkdtemp(
      join(tmpdir(), "wikigraph-right-state-"),
    );

    try {
      const [left, right] = await Promise.all([
        runWikiGraphCLICaptured({
          argv: ["wikg://local/config/concurrent", "put", "job", "2"],
          env: {
            WIKIGRAPH_STATE_DIR: leftStateDir,
          },
        }),
        runWikiGraphCLICaptured({
          argv: ["wikg://local/config/concurrent", "put", "request", "3"],
          env: {
            WIKIGRAPH_STATE_DIR: rightStateDir,
          },
        }),
      ]);

      expect(left.exitCode).toBe(0);
      expect(JSON.parse(left.stdout)).toStrictEqual({ job: 2 });
      expect(right.exitCode).toBe(0);
      expect(JSON.parse(right.stdout)).toStrictEqual({ request: 3 });
    } finally {
      await rm(leftStateDir, { force: true, recursive: true });
      await rm(rightStateDir, { force: true, recursive: true });
    }
  });
});
