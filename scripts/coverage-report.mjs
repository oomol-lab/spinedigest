#!/usr/bin/env node

import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join, relative } from "path";

const rootDir = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const coverageSummaryPath = join(rootDir, "coverage", "coverage-summary.json");
const coverageHtmlPath = join(rootDir, "coverage", "index.html");

const exitCode = await runVitestCoverage();

if (exitCode !== 0) {
  process.exit(exitCode);
}

try {
  const summary = JSON.parse(await readFile(coverageSummaryPath, "utf8"));
  printCoverageSummary(summary);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to read coverage summary: ${message}`);
  process.exitCode = 1;
}

async function runVitestCoverage() {
  return await new Promise((resolve) => {
    const child = spawn(
      pnpmCommand,
      ["exec", "vitest", "run", "--coverage", "--passWithNoTests"],
      {
        cwd: rootDir,
        stdio: "inherit",
      },
    );

    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

function printCoverageSummary(summary) {
  const totals = summary.total;

  if (totals === undefined) {
    console.error("Coverage summary is missing the total section.");
    process.exitCode = 1;
    return;
  }

  const files = Object.entries(summary)
    .filter(([filePath]) => filePath !== "total")
    .map(([filePath, metrics]) => ({
      file: relative(rootDir, filePath),
      lines: formatPercent(metrics.lines.pct),
      functions: formatPercent(metrics.functions.pct),
      branches: formatPercent(metrics.branches.pct),
      statements: formatPercent(metrics.statements.pct),
    }))
    .sort((left, right) => {
      return (
        parseFloat(left.lines) - parseFloat(right.lines) ||
        left.file.localeCompare(right.file)
      );
    });

  console.log("\nCoverage summary:");
  console.table({
    total: {
      lines: formatPercent(totals.lines.pct),
      functions: formatPercent(totals.functions.pct),
      branches: formatPercent(totals.branches.pct),
      statements: formatPercent(totals.statements.pct),
    },
  });

  if (files.length === 0) {
    console.log("No source files were included in the coverage report.");
  } else {
    console.log("Files sorted by line coverage:");
    console.table(files);
  }

  console.log(`HTML report: ${relative(rootDir, coverageHtmlPath)}`);
}

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  return value.toFixed(2);
}
