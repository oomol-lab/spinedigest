import { execFileSync } from "child_process";
import { rmSync } from "fs";
import { join, resolve } from "path";

const packageRoot = resolve(import.meta.dirname, "..");
let tarballName;

try {
  tarballName = execFileSync("npm", ["pack"], {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();

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
