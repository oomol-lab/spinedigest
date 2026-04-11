<p>English | <a href="../zh-CN/architecture.md">中文</a></p>

# Architecture

This document explains SpineDigest at the system level.

It is intentionally secondary to the CLI docs. Start there if your goal is to run the tool.

## Pipeline Overview

At a high level, SpineDigest does this:

1. read source material
2. normalize it into a working document
3. build internal reading and topology state
4. compress the result into digest text
5. export text, EPUB, or `.sdpub`

## Main Modules

- `facade`: top-level user-facing entry points
- `cli`: command-line assembly and config loading
- `source`: readers for EPUB, Markdown, and plain text
- `document`: on-disk working document state and archive I/O
- `reader`: LLM-guided extraction over the text stream
- `topology`: graph construction from reader output
- `editor`: compression and summary generation from topology groups
- `serial.ts`: glue between reader, topology, and editor

## Public Versus Internal Boundaries

The public surface is intentionally small:

- the CLI
- `SpineDigestApp`
- `SpineDigest`

Most other modules are internal implementation details and may evolve more freely.

## Why `.sdpub` Exists

SpineDigest does not only emit final text. It can also preserve the processed digest document as `.sdpub`.

That archive is useful because it:

- captures a reusable processed state
- can be reopened later
- can be exported again without re-digesting the original source

## Source And Output Model

Source side:

- EPUB
- Markdown
- plain text

Output side:

- plain text
- EPUB
- `.sdpub`

Markdown output currently uses the plain-text export path.

## Design Biases

SpineDigest is optimized for:

- CLI-first usage
- long-form reading material
- portable intermediate artifacts
- small public entry points with richer internal structure

It is not optimized for:

- exact round-tripping
- zero-LLM operation during digest generation
- exposing every internal module as public API
