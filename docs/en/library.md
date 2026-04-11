<p>English | <a href="../zh-CN/library.md">中文</a></p>

# Library Usage

SpineDigest also exposes a programmatic API for Node and TypeScript environments.

This is a secondary interface. If you only need to run the pipeline, prefer the CLI.

## Requirements

- Node `>=22.12.0`

## Install

```bash
npm install spinedigest
```

## Public Entry Point

The package exports `SpineDigestApp`, `SpineDigest`, and language helpers from the top-level entry point.

Both ESM `import` and CommonJS `require()` are supported.

## Typical Flow

1. Construct `SpineDigestApp` with an LLM model.
2. Open a digest session for a source file or text stream.
3. Use the provided `SpineDigest` object to export or inspect the result.

## Example

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { SpineDigestApp } from "spinedigest";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = new SpineDigestApp({
  llm: {
    model: openai("<your-model>"),
  },
});

await app.digestEpubSession(
  {
    path: "./book.epub",
  },
  async (digest) => {
    await digest.exportText("./digest.txt");
    await digest.saveAs("./book.sdpub");
  },
);
```

## CommonJS Example

```js
const { createOpenAI } = require("@ai-sdk/openai");
const { SpineDigestApp } = require("spinedigest");
```

## Main Session Methods

- `digestEpubSession`
- `digestMarkdownSession`
- `digestTxtSession`
- `digestTextSession`
- `openSession`

`openSession` is for existing `.sdpub` archives and does not require a fresh digest run.

## Progress Callbacks

Digest session options accept an optional `onProgress` callback.

The callback reports three event shapes during digest generation:

- `serial-discovered`, which reports a serial id plus its fragment count and total word count
- `serial-progress`, which reports completed word count and completed fragment count for a specific serial id
- `digest-progress`, which reports completed word count against the current total discovered word count

## What `SpineDigest` Can Do

- `readMeta()`
- `readCover()`
- `readToc()`
- `exportText(path)`
- `exportEpub(path)`
- `saveAs(path)`

## Notes

- Digest operations require an LLM configuration.
- Existing `.sdpub` archives can be reopened without re-running the source digest.
- If you are evaluating the project for direct use, start with the CLI docs instead.

## Related Docs

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- [Architecture](./architecture.md)
