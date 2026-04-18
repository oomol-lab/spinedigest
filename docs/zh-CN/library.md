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
- `digestTextStreamSession`
- `openSession`

`openSession` 面向已有的 `.sdpub` 归档，不需要重新执行一轮新的 digest。

## 进度回调

digest session 的 option 现在可以传入可选的 `onProgress` 回调。

这个回调在 digest 过程中会提供三种事件：

- `serials-discovered`：一次性报告所有已发现 serial 的 id、fragment 数量和总词数；如果当前输入无法提前发现，则会发出一次 `available: false` 且 `serials` 为空数组的事件
- `serial-progress`：报告某个 serial 当前已经完成的词数和 fragment 数量
- `digest-progress`：报告整个 digest 当前已完成词数，以及当前已知的总词数

## `SpineDigest` 能做什么

- `readMeta()`
- `readCover()`
- `readToc()`
- `listSerials()`
- `readSerialSummary(serialId)`
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
