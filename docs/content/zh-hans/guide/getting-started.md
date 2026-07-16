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

本页会创建并运行一个确定性评测。所有代码都在本地 Node.js 进程中执行，不会调用模型提供方。

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

::: code-group

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

:::

Vieval 会以配置文件所在目录为基准解析 `root`。本例中的 `root: '.'` 因此指向项目根目录，`include` 再从该目录中查找匹配 `evals/*.eval.ts` 的文件。`models` 中的条目是本地占位配置。当前版本要求项目至少注册一个模型，才会自动执行已发现的 DSL 任务。本例任务代码不会读取这项配置，也不会调用模型提供方。

## 编写评测

创建与配置匹配的评测文件：

::: code-group

```ts [evals/arithmetic.eval.ts]
import { caseOf, describeTask, expect } from 'vieval'

describeTask('arithmetic', () => {
  caseOf('adds two numbers', () => {
    expect(20 + 22).toBe(42)
  })
})
```

:::

`describeTask` 注册任务，`caseOf` 为该任务注册一个用例，`expect` 检查断言。如果断言不成立，`expect` 会抛出错误，该用例也会失败。

## 运行评测

::: code-group

```sh [pnpm]
pnpm vieval run --config ./vieval.config.ts
```

```sh [npm]
npx vieval run --config ./vieval.config.ts
```

:::

运行器会发现一个项目，调度一个任务，并记录一个通过的用例。CLI 的实际文案和耗时可能随版本或运行环境变化，不必与本文逐字一致。

::: info 无需凭据
这个任务只执行本地算术断言，不会发起模型请求。因此不需要配置 API 凭据，也不会产生模型调用费用。
:::

## 可选：如何阅读后续示例

普通行高亮会标出当前需要关注的完整代码行：

::: code-group

```ts [evals/arithmetic.eval.ts]
const expected = 42 // [!code highlight]
expect(20 + 22).toBe(expected)
```

:::

词高亮只标出指定的标识符或片段：

::: code-group

```ts [evals/arithmetic.eval.ts]
expect(20 + 22).toBe(42) // [!code word:toBe]
```

:::

指南会用错误高亮指出导致失败的代码行：

::: code-group

```ts [evals/arithmetic.eval.ts]
expect(20 + 22).toBe(41) // [!code error]
```

:::

删除行和新增行标记会同时展示原代码与修正结果：

::: code-group

```ts [evals/arithmetic.eval.ts]
expect(20 + 22).toBe(41) // [!code --]
expect(20 + 22).toBe(42) // [!code ++]
```

:::

当示例需要突出修改过程时，也会使用 diff 代码块：

::: code-group

```diff [evals/arithmetic.eval.ts]
- expect(20 + 22).toBe(41)
+ expect(20 + 22).toBe(42)
```

:::

至此，`vieval.config.ts` 已经指定评测文件的位置，`evals/arithmetic.eval.ts` 则注册了要执行的任务和用例。接下来阅读[核心概念](/zh-hans/guide/core-concepts)，了解项目、任务、用例、尝试与报告之间的关系。
