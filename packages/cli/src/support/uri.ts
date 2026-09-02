import { homedir } from "os";
import { isAbsolute, relative, resolve } from "path";

import {
  formatWikiGraphCommandUri as formatPortableWikiGraphCommandUri,
  parseLocatedWikiGraphUri as parsePortableLocatedWikiGraphUri,
  type LocatedWikiGraphUri,
} from "wiki-graph-core";

/** Apply Node path semantics at the CLI boundary, after Core parses URI syntax. */
export function parseLocatedWikiGraphUri(uri: string): LocatedWikiGraphUri {
  const parsed = parsePortableLocatedWikiGraphUri(uri);
  if (
    parsed.archivePath === undefined ||
    parsed.archivePath.startsWith("wikg://lib/")
  ) {
    return parsed;
  }
  return {
    ...parsed,
    archivePath: resolveCLIArchivePath(parsed.archivePath),
  };
}

export function formatWikiGraphCommandUri(
  archivePath: string,
  objectUri?: string,
  cwd = process.cwd(),
): string {
  let locator = archivePath;
  if (isAbsolute(archivePath)) {
    const candidate = relative(cwd, archivePath);
    if (
      candidate !== "" &&
      !candidate.startsWith("..") &&
      !isAbsolute(candidate)
    ) {
      locator = candidate;
    }
  }
  return formatPortableWikiGraphCommandUri(locator, objectUri);
}

function resolveCLIArchivePath(locator: string): string {
  if (locator === "~") return homedir();
  if (locator.startsWith("~/")) return resolve(homedir(), locator.slice(2));
  return resolve(locator);
}
