import { execFileSync } from "child_process";
import { rmSync } from "fs";
import { join, resolve } from "path";

const packageRoot = resolve(import.meta.dirname, "..");
let tarballName;

function readTarballName(packOutput) {
  const jsonMatch = packOutput.match(/(\[\s*\{[\s\S]*\}\s*\])\s*$/);

  if (!jsonMatch) {
    throw new Error("Failed to locate npm pack JSON output.");
  }

  const packResult = JSON.parse(jsonMatch[1]);
  const filename = packResult[0]?.filename;

  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("Failed to resolve tarball filename from npm pack output.");
  }

  return filename;
}

try {
  const packOutput = execFileSync("npm", ["pack", "--json"], {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  tarballName = readTarballName(packOutput);

  const tarballPath = join(packageRoot, tarballName);

  execFileSync("npm", ["install", "-g", tarballPath], {
    cwd: packageRoot,
    stdio: "inherit",
  });
} finally {
  if (tarballName !== undefined) {
    rmSync(join(packageRoot, tarballName), { force: true });
  }
}
