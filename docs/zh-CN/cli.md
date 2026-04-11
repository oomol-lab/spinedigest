<p><a href="../en/cli.md">English</a> | 中文</p>

# CLI Reference

SpineDigest 的设计重心是命令行使用。

## 命令形式

已安装 CLI 时：

```bash
spinedigest [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>]
```

在源码仓库中运行时：

```bash
pnpm dev -- [--input <path>] [--output <path>] [--input-format <format>] [--output-format <format>]
```

## 参数

- `--input <path>`：输入文件路径
- `--output <path>`：输出文件路径
- `--input-format <format>`：显式指定输入格式
- `--output-format <format>`：显式指定输出格式
- `-h`, `--help`：打印帮助文本

不支持 positional arguments。

## 支持的格式

支持以下格式：

- `sdpub`
- `epub`
- `txt`
- `markdown`

如果没有显式传格式参数，SpineDigest 会根据文件扩展名推断格式。

扩展名映射：

- `.sdpub` -> `sdpub`
- `.epub` -> `epub`
- `.txt` -> `txt`
- `.md` 或 `.markdown` -> `markdown`

## 标准流规则

当省略 `--input` 时：

- SpineDigest 会从 `stdin` 读取
- 仅支持 `txt` 和 `markdown`
- 交互式 `stdin` 会被拒绝

当省略 `--output` 时：

- SpineDigest 会写到 `stdout`
- 仅支持 `txt` 和 `markdown`

## 常见命令

把 EPUB 压缩为 Markdown：

```bash
spinedigest --input ./book.epub --output ./digest.md
```

把文本文件压缩为 EPUB：

```bash
spinedigest --input ./book.txt --output ./digest.epub
```

生成 `.sdpub` 归档：

```bash
spinedigest --input ./book.md --output ./book.sdpub
```

复用已有 `.sdpub`：

```bash
spinedigest --input ./book.sdpub --output ./digest.txt
```

通过管道处理：

```bash
cat ./chapter.txt | spinedigest --input-format txt --output-format markdown
```

## 配置

默认配置路径：

```text
~/.spinedigest/config.json
```

覆盖路径：

```text
SPINEDIGEST_CONFIG
```

配置字段：

```json
{
  "llm": {
    "provider": "openai",
    "model": "<your-model>",
    "apiKey": "<optional>",
    "baseURL": "<optional>",
    "name": "<optional>"
  },
  "paths": {
    "cacheDir": "<optional>",
    "debugLogDir": "<optional>"
  },
  "prompt": "<optional>",
  "request": {
    "concurrent": 2,
    "retryIntervalSeconds": 2,
    "retryTimes": 1,
    "temperature": 0.7,
    "timeout": 60000,
    "topP": 0.9
  }
}
```

## 环境变量

SpineDigest 支持通过环境变量覆盖配置值：

- `SPINEDIGEST_CONFIG`
- `SPINEDIGEST_PROMPT`
- `SPINEDIGEST_LLM_PROVIDER`
- `SPINEDIGEST_LLM_MODEL`
- `SPINEDIGEST_LLM_BASE_URL`
- `SPINEDIGEST_LLM_NAME`
- `SPINEDIGEST_LLM_API_KEY`
- `SPINEDIGEST_CACHE_DIR`
- `SPINEDIGEST_DEBUG_LOG_DIR`
- `SPINEDIGEST_REQUEST_CONCURRENT`
- `SPINEDIGEST_REQUEST_TIMEOUT`
- `SPINEDIGEST_REQUEST_RETRY_TIMES`
- `SPINEDIGEST_REQUEST_RETRY_INTERVAL_SECONDS`
- `SPINEDIGEST_REQUEST_TEMPERATURE`
- `SPINEDIGEST_REQUEST_TOP_P`

`openai-compatible` 必须通过配置或 `SPINEDIGEST_LLM_BASE_URL` 提供 base URL。

## `.sdpub` 行为

`.sdpub` 是处理后 digest 文档的可移植归档格式。

当输入是 `.sdpub` 时：

- SpineDigest 会直接打开已经保存的 digest 状态
- 不需要 LLM 配置
- 可以导出为 `.txt`、`.md` 或 `.epub`

当输出是 `.sdpub` 时：

- SpineDigest 会保存这份处理后的 digest 文档，以便后续复用

## 失败场景

在以下情况下，你可以预期看到 `stderr` 的纯文本错误信息和非零退出码：

- 无法推断输入格式
- 无法推断输出格式
- 对非文本格式使用了 `stdin` 或 `stdout`
- digest 操作缺少 LLM 配置
- provider 相关配置不合法

## 相关文档

- [Quick Start](./quickstart.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
