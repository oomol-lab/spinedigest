import { homedir } from "os";
import { join, resolve } from "path";

import { getCLICwd, getCLIStateDir } from "./context.js";

export function isWikiGraphHomeTarget(target: string): boolean {
  if (target === "home" || target === "~/.wikigraph") return true;

  const configuredHome = resolve(
    getCLIStateDir() ?? join(homedir(), ".wikigraph"),
  );
  return resolve(getCLICwd(), target) === configuredHome;
}
