import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(fileURLToPath(import.meta.url));
const root = process.argv[2]
  ? resolve(process.argv[2])
  : join(repositoryRoot, "..", "packages/core/src");
const forbidden = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "fs/promises",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "sqlite3",
  "stream",
  "stream/promises",
  "timers",
  "timers/promises",
  "url",
  "util",
  "yauzl",
  "yazl",
  "zlib",
]);

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(file)));
    else if (file.endsWith(".ts") && !file.endsWith(".test.ts"))
      files.push(file);
  }
  return files;
}

const violations = [];
for (const file of await collect(root)) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(
    /(?:from|import\s*\()\s*["']([^"']+)["']/g,
  )) {
    const specifier = match[1];
    const builtin = specifier.startsWith("node:")
      ? specifier.slice(5)
      : specifier;
    if (forbidden.has(builtin))
      violations.push(
        `${relative(repositoryRoot, file)} imports Node-only module ${specifier}`,
      );
  }
}
if (violations.length > 0) {
  console.error("wiki-graph-core portability check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}
