<p><a href="../en/library.md">English</a> | 中文</p>

# Library Usage

SpineDigest 也提供面向 Node 和 TypeScript 环境的程序化 API。

但这是次一级接口。如果你只是想直接使用这条管线，优先看 CLI 文档。

## 环境要求

- Node `>=22.12.0`

## 安装

```bash
npm install spinedigest
```

## 公开入口

这个包会从顶层入口导出 `SpineDigestApp`、`SpineDigest` 以及语言辅助类型。

同时支持 ESM `import` 和 CommonJS `require()`。

## 典型流程

1. 用一个 LLM model 构造 `SpineDigestApp`。
2. 针对源文件或文本流打开一个 digest session。
3. 在回调里使用提供的 `SpineDigest` 对象进行导出或读取信息。

## 示例

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

## CommonJS 示例

```js
const { createOpenAI } = require("@ai-sdk/openai");
const { SpineDigestApp } = require("spinedigest");
```

## 主要 session 方法

- `digestEpubSession`
- `digestMarkdownSession`
- `digestTxtSession`
- `digestTextSession`
- `openSession`

`openSession` 面向已有的 `.sdpub` 归档，不需要重新执行一轮新的 digest。

## 进度回调

digest session 的 option 现在可以传入可选的 `onProgress` 回调。

这个回调在 digest 过程中会提供两层进度：

- serial 级进度：当前章节内部已完成的 fragment 数量与单词数量
- digest 级进度：已经完成的章节数量，以及这些已完成章节累计的单词数量

导出和 `.sdpub` 重新打开也会发出轻量的生命周期事件。

## `SpineDigest` 能做什么

- `readMeta()`
- `readCover()`
- `readToc()`
- `exportText(path)`
- `exportEpub(path)`
- `saveAs(path)`

## 补充说明

- digest 操作需要提供 LLM 配置。
- 已有 `.sdpub` 可以在不重新处理源文件的情况下重新打开。
- 如果你是在评估项目是否可以直接使用，请先从 CLI 文档开始。

## 相关文档

- [Quick Start](./quickstart.md)
- [CLI Reference](./cli.md)
- [Architecture](./architecture.md)
