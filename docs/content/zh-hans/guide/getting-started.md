---
title: 快速开始
prev:
  text: 为什么选择 Vieval
  link: /zh-hans/guide/why
next:
  text: 核心概念
  link: /zh-hans/guide/core-concepts
---

# 快速开始

第一个评测采用确定性逻辑，所有代码都在本地 Node.js 进程中运行。

## 安装 Vieval

::: code-group

```sh [pnpm]
pnpm add -D vieval
```

```sh [npm]
npm install --save-dev vieval
```

:::

## 配置项目

在项目根目录创建配置文件：

```ts [vieval.config.ts]
import { defineConfig } from 'vieval'

export default defineConfig({
  projects: [
    {
      include: ['evals/*.eval.ts'],
      inferenceExecutors: [
        {
          id: 'local',
        },
      ],
      models: [
        {
          aliases: [],
          id: 'local:deterministic',
          inferenceExecutor: 'local',
          inferenceExecutorId: 'local',
          model: 'deterministic',
        },
      ],
      name: 'getting-started',
      root: '.',
    },
  ],
})
```

这段配置告诉 Vieval 去哪里发现评测文件。`root` 确定项目边界，`include` 从该边界下选择匹配的文件。模型条目只是用于自动执行已发现 DSL 任务的本地注册信息；本例不会把它作为模型提供方调用。

## 编写评测

创建与配置匹配的评测文件：

```ts [evals/arithmetic.eval.ts]
import { caseOf, describeTask, expect } from 'vieval'

describeTask('arithmetic', () => {
  caseOf('adds two numbers', () => {
    expect(20 + 22).toBe(42)
  })
})
```

`describeTask` 注册任务，`caseOf` 在任务中注册一个用例，`expect` 执行断言；如果 matcher 不通过，它会抛出错误并使该用例失败。

## 运行评测

::: code-group

```sh [pnpm]
pnpm vieval run --config ./vieval.config.ts
```

```sh [npm]
npx vieval run --config ./vieval.config.ts
```

:::

这次执行的稳定语义是：发现一个项目，调度一个任务，并通过一个用例。终端展示形式可能变化，因此本指南不依赖具体输出文本或耗时。

::: info 无需凭据
当前自动执行 DSL 任务需要注册至少一个模型目标。`local:deterministic` 条目只用于满足这项执行条件；任务不会调用模型提供方，不需要凭据，也不会产生模型调用费用。
:::

## 可选：如何阅读后续示例

指南会用错误高亮指出导致失败的代码行：

```ts [evals/arithmetic.eval.ts]
expect(20 + 22).toBe(41) // [!code error]
```

随后用删除行和新增行高亮展示修正，同时保留原始错误作为上下文：

```ts [evals/arithmetic.eval.ts]
expect(20 + 22).toBe(41) // [!code --]
expect(20 + 22).toBe(42) // [!code ++]
```

当编辑过程本身是讲解重点时，同一处修改也可以使用 diff 代码块：

```diff [evals/arithmetic.eval.ts]
- expect(20 + 22).toBe(41)
+ expect(20 + 22).toBe(42)
```

此时项目里有两个相关文件：`vieval.config.ts` 定义发现规则，`evals/arithmetic.eval.ts` 定义可执行的评测行为。接下来阅读[核心概念](/zh-hans/guide/core-concepts)，了解项目、任务、用例、尝试与报告之间的关系。
