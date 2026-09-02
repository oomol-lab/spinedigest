import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repositoryRoot = dirname(fileURLToPath(import.meta.url));
const target = resolve(
  process.argv[2] ?? join(repositoryRoot, "..", "packages/core/src"),
);
const artifactMode = process.argv.includes("--artifact");
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
  "readline",
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
const violations = [];
const seenFiles = new Set();
const forbiddenCapabilities = new Set([
  "readFile",
  "writeFile",
  "readdir",
  "mkdir",
  "rm",
  "resolve",
  "join",
  "path_resolve",
  "path_join",
  "hostArchiveHandle",
  "system_homedir",
  "system_tmpdir",
]);
// These packages are part of Core's existing browser-capable surface. Their
// published ESM/browser bundles contain optional feature probes such as
// `process`/`Buffer` (or legacy CommonJS wrappers) that are never executed by
// the imported APIs. We still inspect their complete import graph and reject
// every forbidden Node module; the narrow exception only avoids treating an
// optional probe as a hard runtime dependency. Any new/unknown dependency is
// scanned strictly, including globals and `require`.
const auditedBrowserPackageVersions = new Map([
  ["ai", "6.0.154"],
  ["htmlparser2", "12.0.0"],
  ["jsonrepair", "3.13.3"],
  ["nunjucks", "3.2.4"],
  ["saxes", "6.0.0"],
  ["zod", "4.3.6"],
  ["tinyld", "1.3.4"],
  ["@ai-sdk/anthropic", "3.0.68"],
  ["@ai-sdk/google", "3.0.61"],
  ["@ai-sdk/openai", "3.0.52"],
  ["@ai-sdk/openai-compatible", "2.0.41"],
]);

async function collect(directory, extensions) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules")
      files.push(...(await collect(file, extensions)));
    else if (
      entry.isFile() &&
      extensions.some((extension) => file.endsWith(extension)) &&
      !file.endsWith(".test.ts")
    )
      files.push(file);
  }
  return files;
}

function report(file, message) {
  violations.push(`${relative(repositoryRoot, file)} ${message}`);
}
function moduleName(specifier) {
  return specifier.startsWith("node:") ? specifier.slice(5) : specifier;
}

function inspectSource(
  file,
  source,
  {
    artifact = false,
    dependency = false,
    strictDependencies = false,
    allowOptionalGlobals = false,
  } = {},
) {
  const scriptKind = file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const relativeImports = new Set();
  const globalAliases = new Set(["globalThis"]);
  const requireAliases = new Set(["require"]);
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      globalAliases.has(node.initializer.text)
    ) {
      globalAliases.add(node.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      requireAliases.has(node.initializer.text)
    ) {
      requireAliases.add(node.name.text);
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier)) {
        if (forbidden.has(moduleName(specifier.text)))
          report(file, `imports forbidden module ${specifier.text}`);
        else if (specifier.text.startsWith("."))
          relativeImports.add(specifier.text);
      }
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (
          !argument ||
          !ts.isStringLiteral(argument) ||
          forbidden.has(moduleName(argument.text))
        )
          report(file, "uses a non-literal or forbidden dynamic import");
      }
      const aliasedRequire =
        ts.isIdentifier(node.expression) &&
        requireAliases.has(node.expression.text);
      const propertyRequire =
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "require";
      if (
        (!dependency || strictDependencies) &&
        (aliasedRequire || propertyRequire)
      ) {
        const argument = node.arguments[0];
        // A CommonJS wrapper is not itself a Node dependency. Reject it when
        // it resolves to a forbidden builtin (or cannot be resolved), while
        // allowing legacy wrappers that only require portable package code.
        if (
          !argument ||
          !ts.isStringLiteral(argument) ||
          forbidden.has(moduleName(argument.text))
        )
          report(file, "uses CommonJS require");
      }
      if (
        !artifact &&
        !file.includes("runtime/platform") &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "capability" &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0]) &&
        forbiddenCapabilities.has(node.arguments[0].text)
      ) {
        report(
          file,
          `uses forbidden runtime capability ${node.arguments[0].text}`,
        );
      }
    }
    if (ts.isIdentifier(node)) {
      const name = node.text;
      const parent = node.parent;
      const isProperty =
        ts.isPropertyAccessExpression(parent) &&
        parent.name === node &&
        !(
          ts.isPropertyAccessExpression(parent) &&
          ts.isIdentifier(parent.expression) &&
          parent.expression.text === "globalThis"
        );
      const isDeclaration =
        ts.isVariableDeclaration(parent) && parent.name === node;
      const optionalGlobal =
        allowOptionalGlobals && (name === "process" || name === "Buffer");
      if (
        (!dependency || strictDependencies) &&
        !optionalGlobal &&
        !isProperty &&
        !isDeclaration &&
        (name === "process" || name === "Buffer" || name === "NodeJS")
      )
        report(file, `references Node-only global ${name}`);
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      globalAliases.has(node.expression.text) &&
      ["process", "Buffer", "NodeJS"].includes(node.name.text) &&
      (!dependency || strictDependencies) &&
      !allowOptionalGlobals
    ) {
      report(
        file,
        `references Node-only global ${node.expression.text}.${node.name.text}`,
      );
    }
    // Computed global access is equivalent to a direct property access and is
    // commonly used to hide runtime references from textual scans.
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      globalAliases.has(node.expression.text) &&
      node.argumentExpression &&
      ts.isStringLiteral(node.argumentExpression) &&
      ["process", "Buffer", "NodeJS"].includes(node.argumentExpression.text) &&
      (!dependency || strictDependencies) &&
      !allowOptionalGlobals
    ) {
      report(
        file,
        `references Node-only global ${node.expression.text}[${node.argumentExpression.text}]`,
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return relativeImports;
}

async function scanFile(file, options) {
  if (seenFiles.has(file)) return;
  seenFiles.add(file);
  const imports = inspectSource(file, await readFile(file, "utf8"), options);
  if (options.follow) {
    for (const specifier of imports) {
      const base = resolve(dirname(file), specifier);
      for (const candidate of [
        base,
        `${base}.js`,
        `${base}.mjs`,
        `${base}.cjs`,
        `${base}.ts`,
        join(base, "index.js"),
        join(base, "index.mjs"),
      ]) {
        try {
          await scanFile(candidate, options);
          break;
        } catch {
          /* unresolved optional export */
        }
      }
    }
  }
}

async function packageRoot(name, fromDirectory) {
  let directory = fromDirectory;
  while (directory !== dirname(directory)) {
    const candidate = join(directory, "node_modules", name, "package.json");
    try {
      await readFile(candidate);
      return dirname(candidate);
    } catch {
      directory = dirname(directory);
    }
  }
  return undefined;
}

async function scanDependency(name, fromDirectory, chain = [], strict = false) {
  if (chain.includes(name)) return;
  const root = await packageRoot(name, fromDirectory);
  if (!root) return;
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  const entries = new Set();
  const selectExportTarget = (value) => {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return undefined;
    // Resolve one runtime branch exactly as a browser/ESM host would. Do not
    // union every conditional export (which would incorrectly pull in Node
    // and CommonJS branches that are never part of Core's graph).
    for (const key of ["browser", "import", "default", "module"]) {
      if (key in value) {
        const selected = selectExportTarget(value[key]);
        if (selected) return selected;
      }
    }
    for (const [key, nested] of Object.entries(value)) {
      if (key === "types" || key === "require" || key === "node") continue;
      const selected = selectExportTarget(nested);
      if (selected) return selected;
    }
    return undefined;
  };
  if (manifest.exports) {
    const selected = selectExportTarget(
      manifest.exports["."] ?? manifest.exports,
    );
    if (selected) entries.add(selected);
  } else {
    const selected =
      manifest.browser ?? manifest.module ?? manifest.main ?? "index.js";
    entries.add(selected);
  }
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    if (strict) {
      try {
        await scanFile(resolve(root, entry), {
          dependency: true,
          strictDependencies: strict,
          // Optional probes are allowed only for the exact audited package
          // version shipped by this workspace. A fixture (or dependency
          // upgrade) using the same name is scanned strictly.
          allowOptionalGlobals:
            auditedBrowserPackageVersions.get(name) === manifest.version,
          follow: true,
        });
      } catch {
        /* optional/types-only entry */
      }
    }
  }
  for (const dependency of Object.keys({
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  })) {
    if (forbidden.has(dependency))
      report(
        join(root, "package.json"),
        `depends on forbidden module ${dependency}`,
      );
    else await scanDependency(dependency, root, [...chain, name], strict);
  }
}

const extensions = artifactMode ? [".js", ".cjs", ".mjs", ".d.ts"] : [".ts"];
for (const file of await collect(target, extensions))
  await scanFile(file, { artifact: artifactMode });
if (!artifactMode) {
  let packageFile = join(repositoryRoot, "..", "packages/core/package.json");
  try {
    await readFile(join(target, "package.json"));
    packageFile = join(target, "package.json");
  } catch {
    /* source directory */
  }
  const manifest = JSON.parse(await readFile(packageFile, "utf8"));
  // Always inspect the dependency runtime graph. Core's own build must not
  // silently downgrade this check: transitive Node imports/globals are just
  // as non-portable as direct ones.
  const strictDependencyScan = true;
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (forbidden.has(dependency))
      report(packageFile, `depends on forbidden module ${dependency}`);
    else
      await scanDependency(
        dependency,
        dirname(packageFile),
        [],
        strictDependencyScan,
      );
  }
}
if (violations.length > 0) {
  console.error("wiki-graph-core portability check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}
