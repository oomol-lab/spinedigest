import { defineConfig } from "tsup";

const BUNDLED_DEPENDENCIES_PATTERN = [/.*/];
const EXTERNAL_DEPENDENCIES = ["sqlite3"];
const CJS_DATA_DIR_BANNER = [
  'globalThis.__SPINEDIGEST_DATA_DIR__ ??= require("node:path").resolve(',
  "  __dirname,",
  '  "../data",',
  ");",
].join("\n");
const SHARED_OPTIONS = {
  bundle: true,
  external: EXTERNAL_DEPENDENCIES,
  noExternal: BUNDLED_DEPENDENCIES_PATTERN,
  outDir: "dist",
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node22",
} as const;

export default defineConfig([
  {
    ...SHARED_OPTIONS,
    banner: {
      js: CJS_DATA_DIR_BANNER,
    },
    clean: true,
    dts: true,
    entry: {
      index: "src/index.ts",
    },
    format: ["cjs"],
    outExtension() {
      return {
        js: ".cjs",
      };
    },
  },
  {
    ...SHARED_OPTIONS,
    banner: {
      js: CJS_DATA_DIR_BANNER,
    },
    clean: false,
    dts: false,
    entry: {
      cli: "src/cli.ts",
    },
    format: ["cjs"],
    outExtension() {
      return {
        js: ".cjs",
      };
    },
  },
]);
