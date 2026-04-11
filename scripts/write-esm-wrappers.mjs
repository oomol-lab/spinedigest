import { copyFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const packageRoot = resolve(import.meta.dirname, "..");
const distDirectoryPath = join(packageRoot, "dist");

copyFileSync(
  join(distDirectoryPath, "index.d.cts"),
  join(distDirectoryPath, "index.d.ts"),
);

writeFileSync(
  join(distDirectoryPath, "index.js"),
  [
    'import spineDigestModule from "./index.cjs";',
    "",
    "export const LANGUAGES = spineDigestModule.LANGUAGES;",
    "export const SpineDigest = spineDigestModule.SpineDigest;",
    "export const SpineDigestApp = spineDigestModule.SpineDigestApp;",
    "export default spineDigestModule;",
    "",
  ].join("\n"),
);

writeFileSync(
  join(distDirectoryPath, "cli.js"),
  ["#!/usr/bin/env node", 'import "./cli.cjs";', ""].join("\n"),
  {
    mode: 0o755,
  },
);
