<p>English | <a href="../zh-CN/quickstart.md">中文</a></p>

# Quick Start

This guide is for the primary SpineDigest workflow: running the CLI directly.

## 1. Requirements

- Node `>=20.17.0`
- `pnpm`
- access to an LLM provider supported by SpineDigest

Supported providers:

- `anthropic`
- `google`
- `openai`
- `openai-compatible`

## 2. Install And Enter The Project

Clone the repository and install dependencies:

```bash
git clone https://github.com/oomol-lab/spinedigest.git
cd spinedigest
pnpm install
```

If you are reading this from another environment that already exposes the `spinedigest` binary, you can skip the source setup and use the installed command directly.

## 3. Configure The CLI

SpineDigest reads configuration from:

- default path: `~/.spinedigest/config.json`
- override path: `SPINEDIGEST_CONFIG`

A minimal config file looks like this:

```json
{
  "llm": {
    "provider": "openai",
    "model": "<your-model>"
  }
}
```

Set credentials with environment variables when possible:

```bash
export SPINEDIGEST_LLM_API_KEY="<your-api-key>"
```

For `openai-compatible`, you must also set a base URL:

```bash
export SPINEDIGEST_LLM_BASE_URL="https://your-provider.example/v1"
```

You can also place these fields in `config.json` if your environment requires it.

## 4. Run Your First Digest

From a local clone, the easiest command is:

```bash
pnpm dev -- --input ./test/fixtures/sources/sample-observatory-guide.md --output ./out/digest.md
```

After the command completes, inspect:

```bash
cat ./out/digest.md
```

If you are using an installed CLI instead of a source checkout, run the same flow against one of your own files:

```bash
spinedigest --input ./book.md --output ./out/digest.md
```

## 5. Common Output Patterns

Write plain text:

```bash
spinedigest --input ./book.epub --output ./digest.txt
```

Write Markdown:

```bash
spinedigest --input ./book.txt --output ./digest.md
```

Write EPUB:

```bash
spinedigest --input ./book.md --output ./digest.epub
```

Write a reusable `.sdpub` archive:

```bash
spinedigest --input ./book.epub --output ./book.sdpub
```

Re-open an existing `.sdpub` and export it again:

```bash
spinedigest --input ./book.sdpub --output ./digest.txt
```

## 6. Pipe Through Standard Streams

`stdin` and `stdout` are only supported for text formats.

Read from `stdin`:

```bash
cat ./chapter.txt | spinedigest --input-format txt --output ./digest.md
```

Write to `stdout`:

```bash
spinedigest --input ./chapter.md --output-format txt
```

Pipe both directions:

```bash
cat ./chapter.txt | spinedigest --input-format txt --output-format markdown
```

## 7. Add A Custom Extraction Prompt

You can customize the extraction prompt in config:

```json
{
  "prompt": "Preserve key arguments, named entities, and decisive transitions."
}
```

This prompt is applied when digesting source files or text streams.

## 8. Troubleshooting

If you see a missing LLM configuration error:

- make sure `llm.provider` and `llm.model` are set
- make sure the corresponding API key is available

If format inference fails:

- add `--input-format`
- add `--output-format`

If you omit `--input` and nothing is piped in:

- SpineDigest refuses to read from interactive `stdin`
- provide `--input <path>` or pipe text into the process

## Next

- [CLI Reference](./cli.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
