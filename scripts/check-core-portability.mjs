import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repositoryRoot = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] ?? join(repositoryRoot, "..", "packages/core/src"));
const artifactMode = process.argv.includes("--artifact");
const forbidden = new Set([
  "assert", "async_hooks", "buffer", "child_process", "crypto", "events",
  "fs", "fs/promises", "http", "https", "module", "net", "os", "path",
  "sqlite3", "stream", "stream/promises", "timers", "timers/promises", "url",
  "util", "yauzl", "yazl", "zlib",
]);
const violations = [];
const seenFiles = new Set();

async function collect(directory, extensions) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") files.push(...await collect(file, extensions));
    else if (entry.isFile() && extensions.some((extension) => file.endsWith(extension)) && !file.endsWith(".test.ts")) files.push(file);
  }
  return files;
}

function report(file, message) { violations.push(`${relative(repositoryRoot, file)} ${message}`); }
function moduleName(specifier) { return specifier.startsWith("node:") ? specifier.slice(5) : specifier; }

function inspectSource(file, source, { artifact = false, dependency = false } = {}) {
  const scriptKind = file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const relativeImports = new Set();
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier)) {
        if (forbidden.has(moduleName(specifier.text))) report(file, `imports forbidden module ${specifier.text}`);
        else if (specifier.text.startsWith(".")) relativeImports.add(specifier.text);
      }
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (!argument || !ts.isStringLiteral(argument) || forbidden.has(moduleName(argument.text))) report(file, "uses a non-literal or forbidden dynamic import");
      }
      if (!dependency && ts.isIdentifier(node.expression) && node.expression.text === "require") {
        const argument = node.arguments[0];
        if (!artifact || !argument || !ts.isStringLiteral(argument) || forbidden.has(moduleName(argument.text))) report(file, "uses CommonJS require");
      }
    }
    if (ts.isIdentifier(node)) {
      const name = node.text;
      const parent = node.parent;
      const isProperty = ts.isPropertyAccessExpression(parent) && parent.name === node;
      const isDeclaration = ts.isVariableDeclaration(parent) && parent.name === node;
      if (!dependency && !isProperty && !isDeclaration && (name === "process" || name === "Buffer" || name === "NodeJS")) report(file, `references Node-only global ${name}`);
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
      for (const candidate of [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.ts`, join(base, "index.js"), join(base, "index.mjs")]) {
        try { await scanFile(candidate, options); break; } catch { /* unresolved optional export */ }
      }
    }
  }
}

async function packageRoot(name, fromDirectory) {
  let directory = fromDirectory;
  while (directory !== dirname(directory)) {
    const candidate = join(directory, "node_modules", name, "package.json");
    try { await readFile(candidate); return dirname(candidate); } catch { directory = dirname(directory); }
  }
  return undefined;
}

async function scanDependency(name, fromDirectory, chain = []) {
  if (chain.includes(name)) return;
  const root = await packageRoot(name, fromDirectory);
  if (!root) return;
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const entry = manifest.module ?? manifest.browser ?? manifest.main ?? "index.js";
  try { await scanFile(resolve(root, entry), { dependency: true, follow: true }); } catch { /* types-only package */ }
  for (const dependency of Object.keys({ ...(manifest.dependencies ?? {}), ...(manifest.optionalDependencies ?? {}) })) {
    if (forbidden.has(dependency)) report(join(root, "package.json"), `depends on forbidden module ${dependency}`);
    else await scanDependency(dependency, root, [...chain, name]);
  }
}

const extensions = artifactMode ? [".js", ".cjs", ".mjs"] : [".ts"];
for (const file of await collect(target, extensions)) await scanFile(file, { artifact: artifactMode });
if (!artifactMode) {
  let packageFile = join(repositoryRoot, "..", "packages/core/package.json");
  try { await readFile(join(target, "package.json")); packageFile = join(target, "package.json"); } catch { /* source directory */ }
  const manifest = JSON.parse(await readFile(packageFile, "utf8"));
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (forbidden.has(dependency)) report(packageFile, `depends on forbidden module ${dependency}`);
    else await scanDependency(dependency, dirname(packageFile));
  }
}
if (violations.length > 0) {
  console.error("wiki-graph-core portability check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}
