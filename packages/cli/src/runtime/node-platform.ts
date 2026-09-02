import * as asyncHooks from "node:async_hooks";
import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as stream from "node:stream";
import * as streamPromises from "node:stream/promises";
import * as timers from "node:timers/promises";
import * as url from "node:url";
import * as zlib from "node:zlib";
import * as sqlite3 from "sqlite3";
import * as yauzl from "yauzl";
import * as yazl from "yazl";

import {
  installWikiGraphPlatform,
  type WikiGraphPlatform,
} from "wiki-graph-core/platform";

/** Install the Node implementation used by the CLI and its workers. */
export const nodeWikiGraphPlatform: WikiGraphPlatform = {
  fs,
  childProcess,
  fsPromises,
  path,
  os,
  crypto,
  streams: stream,
  streamPromises,
  timers,
  asyncHooks,
  zlib,
  url,
  sqlite3,
  zip: { yauzl, yazl },
};

export function installNodeWikiGraphPlatform(): void {
  installWikiGraphPlatform(nodeWikiGraphPlatform);
}
