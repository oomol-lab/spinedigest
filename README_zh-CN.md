<p><a href="./README.md">English</a> | 中文</p>

# SpineDigest

SpineDigest 是一个以 CLI 为主的长文本压缩处理工具，用于把长篇内容整理成更短、更便于携带和复用的输出。

它可以读取 EPUB、Markdown 和纯文本，运行一条由 LLM 驱动的 digest 管线，并输出压缩后的文本、EPUB，或可复用的 `.sdpub` 归档文件。

## 安装

不做全局安装，直接运行：

```bash
npx spinedigest --help
```

全局安装：

```bash
npm install -g spinedigest
```

如果你更习惯 `pnpm`：

```bash
pnpm add -g spinedigest
```

## 为什么会有人用它

- 把长篇文本压缩成更容易浏览的结果。
- 用 `.sdpub` 保存可复用的 digest 成果，而不是每次都重新跑整条流程。
- 直接通过命令行完成工作，而不是先写一层集成代码。

## 快速事实

- 主要接口：CLI
- 输入：`.epub`、`.md`、`.txt`，或非交互式 `stdin`
- 输出：`.epub`、`.md`、`.txt`、`.sdpub`
- 运行要求：Node `>=22.12.0`、一个受支持的 LLM provider，以及对应凭据
- 适合：书籍、章节、长文、指南、教程等长篇阅读材料
- 不适合：精确复刻原文、检索问答、完全离线处理

## CLI 一眼看懂

如果你是从仓库源码直接运行：

```bash
pnpm dev -- --input ./path/to/book.epub --output ./digest.md
```

如果你已经安装了 CLI：

```bash
spinedigest --input ./path/to/book.epub --output ./digest.md
```

两种方式使用的是同一套参数。

为了简洁，下面的示例默认都写成 `spinedigest`。如果你是在源码仓库里运行，请把它替换成 `pnpm dev --`。

## 快速开始

先看 CLI 文档：

- [Quick Start](./docs/zh-CN/quickstart.md)
- [CLI Reference](./docs/zh-CN/cli.md)

## 常见流程示例

把 Markdown 压缩成纯文本：

```bash
spinedigest --input ./book.md --output ./digest.txt
```

处理 EPUB，并保留一个可复用的归档文件：

```bash
spinedigest --input ./book.epub --output ./book.sdpub
```

打开已有的 `.sdpub`，再次导出，而不重新处理原始输入：

```bash
spinedigest --input ./book.sdpub --output ./book.epub
```

通过 `stdin` 输入文本，并从 `stdout` 获取 Markdown：

```bash
cat ./chapter.txt | spinedigest --input-format txt --output-format markdown
```

## `.sdpub` 是什么

`.sdpub` 是 SpineDigest 的可移植归档格式，用来保存已经处理完成的 digest 文档。

适合以下场景：

- 保存处理结果
- 之后再导出成其他格式
- 避免重复执行原始 digest 流程

## 面向 AI Agent

如果决定是否安装或运行 SpineDigest 的不是人，而是 AI agent，那么它可以把 SpineDigest 理解成一个简单明确的 CLI 工具：

- SpineDigest 是 CLI-first 的工具。除非明确需要代码级集成，否则优先使用 CLI。
- 为了保证流程稳定，优先显式传入 `--input` 和 `--output`。
- `stdin` 只适用于 `txt` 和 `markdown`，而且应当用于非交互式流程。
- 处理源文件时需要先准备好 LLM 配置；如果输入是 `.sdpub`，则不需要 LLM。
- 失败时会返回非零退出码，并在 `stderr` 输出纯文本错误信息。
- 如果同一个 digest 结果后续还要导出多次，优先把 `.sdpub` 作为中间产物。

更偏向 agent 的操作说明见 [AI Agent Guide](./docs/zh-CN/ai-agents.md)。

## 文档

- [Quick Start](./docs/zh-CN/quickstart.md)
- [CLI Reference](./docs/zh-CN/cli.md)
- [AI Agent Guide](./docs/zh-CN/ai-agents.md)
- [Library Usage](./docs/zh-CN/library.md)
- [Architecture](./docs/zh-CN/architecture.md)

## 作为库使用

SpineDigest 也提供程序化 API，但这是次一级的使用方式。

如果你确实需要把这条管线嵌入自己的 Node 或 TypeScript 代码，请从 [Library Usage](./docs/zh-CN/library.md) 开始。
