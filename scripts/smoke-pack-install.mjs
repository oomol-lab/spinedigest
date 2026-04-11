import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const packageRoot = resolve(import.meta.dirname, "..");
const tempRoot = mkdtempSync(join(tmpdir(), "spinedigest-pack-"));
let tarballName;

try {
  tarballName = execFileSync("npm", ["pack", "--ignore-scripts"], {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();

  writeFileSync(
    join(tempRoot, "package.json"),
    JSON.stringify({ name: "spinedigest-pack-smoke", private: true }),
  );

  const tarballPath = join(packageRoot, tarballName);

  execFileSync("npm", ["install", tarballPath], {
    cwd: tempRoot,
    stdio: "inherit",
  });

  const installedCliPath = join(
    tempRoot,
    "node_modules",
    "spinedigest",
    "dist",
    "cli.js",
  );

  execFileSync(process.execPath, [installedCliPath, "--help"], {
    cwd: tempRoot,
    stdio: "inherit",
  });
} finally {
  if (tarballName !== undefined) {
    rmSync(join(packageRoot, tarballName), { force: true });
  }

  rmSync(tempRoot, { force: true, recursive: true });
}
