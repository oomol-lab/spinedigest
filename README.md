<p>English | <a href="./README_zh-CN.md">中文</a></p>

# SpineDigest

SpineDigest is a CLI-first tool for digesting long-form text into smaller, portable outputs.

It reads EPUB, Markdown, and plain text, runs an LLM-guided digestion pipeline, and writes compressed text, EPUB, or reusable `.sdpub` archives.

## Install

Quick run without a global install:

```bash
npx spinedigest --help
```

Global install:

```bash
npm install -g spinedigest
```

If you prefer `pnpm`, use:

```bash
pnpm add -g spinedigest
```

To install the current local checkout into your terminal for pre-release verification:

```bash
pnpm cli:install-local
```

Remove that local global install with:

```bash
pnpm cli:uninstall-local
```

## Why People Use It

- Turn long-form text into shorter, easier-to-scan outputs.
- Keep a portable digest artifact as `.sdpub` instead of repeating the full pipeline.
- Work from the command line without writing integration code.

## Quick Facts

- Primary interface: CLI
- Inputs: `.epub`, `.md`, `.txt`, or non-interactive `stdin`
- Outputs: `.epub`, `.md`, `.txt`, or `.sdpub`
- Requires: Node `>=22.12.0`, an LLM provider, and credentials for that provider
- Good fit: books, chapters, essays, guides, and other long-form reading material
- Not a fit: exact reproduction, retrieval QA, or fully offline processing

## CLI At A Glance

If you are running from a local clone of this repository, use:

```bash
pnpm dev -- --input ./path/to/book.epub --output ./digest.md
```

If you installed the package as a CLI, use:

```bash
spinedigest --input ./path/to/book.epub --output ./digest.md
```

The same flags work in both cases.

For brevity, the examples below use `spinedigest`. In a source checkout, replace that command with `pnpm dev --`.

## Quick Start

Start with the CLI guide:

- [Quick Start](./docs/en/quickstart.md)
- [CLI Reference](./docs/en/cli.md)

## Example Flows

Digest a Markdown file into plain text:

```bash
spinedigest --input ./book.md --output ./digest.txt
```

Digest an EPUB and keep a reusable archive:

```bash
spinedigest --input ./book.epub --output ./book.sdpub
```

Open a saved `.sdpub` and export it again without re-digesting the original source:

```bash
spinedigest --input ./book.sdpub --output ./book.epub
```

Pipe text through `stdin` and receive Markdown on `stdout`:

```bash
cat ./chapter.txt | spinedigest --input-format txt --output-format markdown
```

## What `.sdpub` Is

`.sdpub` is SpineDigest's portable archive format for a processed digest document.

Use it when you want to:

- preserve the processed result
- export to another output format later
- avoid repeating the original digest step

## For AI Agents

If an AI agent is deciding whether to install or run SpineDigest, the operational contract is simple:

- SpineDigest is a CLI-first tool. Prefer the CLI unless integration code is explicitly required.
- Use explicit `--input` and `--output` paths for deterministic runs.
- Use `stdin` only for `txt` or `markdown`, and only in non-interactive flows.
- Provide LLM configuration before digesting source files. `.sdpub` input does not require LLM access.
- Expect non-zero exit codes on failure and a plain-text error message on `stderr`.
- Prefer `.sdpub` as an intermediate artifact when the same digest may need to be exported again.

For agent-oriented guidance, see [AI Agent Guide](./docs/en/ai-agents.md).

## Documentation

- [Quick Start](./docs/en/quickstart.md)
- [CLI Reference](./docs/en/cli.md)
- [AI Agent Guide](./docs/en/ai-agents.md)
- [Library Usage](./docs/en/library.md)
- [Architecture](./docs/en/architecture.md)

## Library Usage

SpineDigest also exposes a programmatic API, but that is a secondary interface.

If you need to embed the pipeline into your own Node or TypeScript code, start with [Library Usage](./docs/en/library.md).
