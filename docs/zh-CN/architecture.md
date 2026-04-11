<p><a href="../en/architecture.md">English</a> | 中文</p>

# Architecture

这份文档从系统层面解释 SpineDigest。

它的优先级刻意低于 CLI 文档。如果你的目标是先把工具跑起来，请先看 CLI 相关文档。

## 管线概览

从高层看，SpineDigest 会做这些事：

1. 读取源材料
2. 规范化为工作文档
3. 构建内部的阅读状态与拓扑状态
4. 压缩生成 digest 文本
5. 导出文本、EPUB 或 `.sdpub`

## 主要模块

- `facade`：面向用户的顶层入口
- `cli`：命令行装配与配置加载
- `source`：EPUB、Markdown、纯文本的读取器
- `document`：磁盘工作文档状态与归档 I/O
- `reader`：基于 LLM 的文本流信息提取
- `topology`：根据 reader 输出构建图结构
- `editor`：基于 topology 分组生成压缩摘要
- `progress`：digest 运行过程中的进度统计与事件回调
- `serial.ts`：负责把 reader、topology 和 editor 粘合起来

## 公开边界与内部边界

公开表面故意保持得很小：

- CLI
- `SpineDigestApp`
- `SpineDigest`

除此以外的大多数模块都属于内部实现，可以更自由地演进。

## 为什么需要 `.sdpub`

SpineDigest 不只是输出最终文本，也可以把处理后的 digest 文档保存成 `.sdpub`。

这个归档有价值，因为它：

- 保存了一份可复用的处理状态
- 之后可以重新打开
- 可以在不重新处理原始输入的情况下再次导出

## 输入与输出模型

输入侧：

- EPUB
- Markdown
- 纯文本

输出侧：

- 纯文本
- EPUB
- `.sdpub`

当前 Markdown 输出沿用的是 plain-text export 路径。

## 设计倾向

SpineDigest 优先优化的是：

- CLI-first 使用方式
- 长篇阅读材料
- 可移植的中间归档
- 小而稳定的公开入口，以及更丰富的内部结构

它不以以下目标为优先：

- 精确 round-tripping
- digest 生成阶段的零 LLM 运行
- 把每个内部模块都变成公开 API
