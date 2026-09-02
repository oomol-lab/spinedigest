import { spawn } from "child_process";

import type { WikispineCommandRunner } from "wiki-graph-core";

/** Node host implementation for Core's optional WikiSpine command capability. */
export const nodeWikispineCommandRunner: WikispineCommandRunner = {
  run: async ({ args, command, input, onStdout }) =>
    await new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stderr: Uint8Array[] = [];
      let settled = false;

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (settled) return;
        try {
          onStdout(chunk);
        } catch (error) {
          settled = true;
          child.kill();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk));
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        reject(
          new Error(`Failed to start wikispine command: ${error.message}`),
        );
      });
      child.on("close", (exitCode) => {
        if (settled) return;
        settled = true;
        resolve({
          exitCode,
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
      child.stdin.end(input);
    }),
};
