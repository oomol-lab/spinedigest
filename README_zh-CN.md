<p><a href="./README.md">English</a> | 中文</p>

# SpineDigest

**把书读薄。**

[![npm version](https://img.shields.io/npm/v/spinedigest)](https://www.npmjs.com/package/spinedigest)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node >=22.12.0](https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen)](https://nodejs.org/)

---

<!-- 占位图1：Terminal 截图 — 展示 spinedigest CLI 运行效果 -->
![SpineDigest Terminal 演示](./docs/images/terminal-demo.png)

SpineDigest 把长篇书籍喂给 AI，自动提炼核心内容。处理结果不只是文字摘要——它同时生成章节拓扑与知识脉络图，让整本书的结构一眼可见。

<!-- 占位图2：Inkora 界面截图 — 展示打开 .sdpub 后的章节拓扑图与知识关系图 -->
![Inkora 打开效果](./docs/images/inkora-screenshot.png)
<sub>Inkora 打开 .sdpub 效果</sub>

## 安装

无需全局安装，直接试用：

```bash
npx spinedigest --help
```

全局安装：

```bash
npm install -g spinedigest
```

## 快速开始

把一本 EPUB 摘要成 Markdown：

```bash
spinedigest --input ./book.epub --output ./digest.md
```

先保存归档，之后再导出：

```bash
spinedigest --input ./book.epub --output ./book.sdpub
spinedigest --input ./book.sdpub --output ./book.epub
```

从 stdin 读取，从 stdout 输出：

```bash
cat ./chapter.txt | spinedigest --input-format txt --output-format markdown
```

完整参数说明见 [CLI Reference](./docs/zh-CN/cli.md)。

## 为什么是 SpineDigest

一本六百页的书，认真读完要几个月。把它直接扔给 AI 总结？上下文窗口撑不住。

但上下文限制只是浅层问题。更深的困难在于：**压缩不等于截断**。AI 不知道哪一段应该留下，哪一段可以丢掉。这种取舍的判断，是在阅读过程中才能做出的——它需要理解、需要立场、需要对全局的把握。

SpineDigest 用一套结构化流程来解决这件事。它把章节文本切分成认知心理学意义上的 chunk——类似人类短期记忆的信息区块（Miller 定律，7±2 单位）。这些 chunk 通过拓扑连接聚集成簇，每一簇围绕一组内聚的知识点形成一条 snake。然后进入最关键的阶段：

**每一条 snake 都成为一个评委。**

这些评委各自持有原文片段，以及你最初给出的提取指令。它们围着大语言模型施压，要求压缩结果不能遗漏自己负责的信息。LLM 必须在所有评委之间寻找平衡，经过多轮博弈，最终生成一份谁都不能完全满意、但谁都不会被完全忽视的压缩稿。这就是为什么 SpineDigest 的结果不是截断，而是真正的提炼。

<!-- 占位图3：架构逻辑图 — 展示 chunk → snake → 评委博弈 → 输出的流程 -->
![SpineDigest 架构图](./docs/images/architecture.png)

**脉络是可以定制的。** 用自然语言告诉 SpineDigest 什么重要——"历史必然性"、"某个人物的心理变化"、"论证结构"。评委就按这个标准执法。与之无关的内容失去代言人，与之相关的内容则被多个评委共同护住。最终的脉络由你的语言定义，而不是由 AI 的默认理解决定。

## Inkora

`.sdpub` 是 SpineDigest 输出的可移植归档格式，完整保存了摘要结果和提取到的知识结构。

**Inkora** 是专门用来打开它的免费应用，提供章节拓扑图和知识关系图两个核心视图。即使已经导出成其他格式，`.sdpub` 仍然保留，随时可以重新打开或再次导出，不需要重跑摘要流程。

## 输入与输出

| 格式 | 输入 | 输出 |
|------|------|------|
| `.epub` | ✓ | ✓ |
| `.md` | ✓ | ✓ |
| `.txt` | ✓ | ✓ |
| `.sdpub` | ✓ | ✓ |
| `stdin`（txt / md） | ✓ | — |
| `stdout` | — | ✓ |

运行要求：Node `>=22.12.0`，以及任意受支持的 LLM provider 及其凭据。输入为 `.sdpub` 时不需要 LLM 访问权限。

## 作为库使用

SpineDigest 也提供程序化 API，适合把摘要流程嵌入自己的 Node 或 TypeScript 代码。CLI 之外的集成方式见 [Library Usage](./docs/zh-CN/library.md)。

## 面向 AI Agent

SpineDigest 专为自动化流程与 AI agent 调用设计，可直接集成进 Cursor、Claude Code 等工具。

- **CLI 优先。** 除非明确需要代码级集成，否则优先使用 CLI。
- **行为确定性。** 用显式的 `--input` 和 `--output` 保证每次运行结果一致。
- **退出码。** 成功返回 `0`；失败返回非零退出码，并在 `stderr` 输出纯文本错误信息。
- **stdin 支持。** 仅接受 `txt` 和 `md`，且只用于非交互式流程。
- **无 LLM 依赖。** 输入为 `.sdpub` 时不调用任何 LLM provider。
- **优先保留归档。** 如果同一份摘要将来还需要再次导出，把 `.sdpub` 作为中间产物。

完整 agent 操作参考见 [AI Agent Guide](./docs/zh-CN/ai-agents.md)。
