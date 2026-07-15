---
title: 可靠执行
prev:
  text: 矩阵与数据集
  link: /zh-hans/guide/learn/matrices-and-datasets
next:
  text: 报告与比较
  link: /zh-hans/guide/learn/reports-and-comparisons
---

# 可靠执行

可靠评测需要两类控制：一类用于重复执行，以衡量不确定性；另一类用于限制工作量，保护被测服务。Vieval 为此提供了尝试、重试、超时、并发限制和任务缓存。

## 理解执行层级

一个已调度任务包含若干已注册用例。启用 `autoAttempt` 后，Vieval 会把完整用例集作为一次尝试运行，等待所有用例结束；只有仍有可继续尝试的用例失败或超时时，才会开始下一次尝试。每次用例执行可以先运行一次，再进行 `autoRetry` 重试。

```text
已调度任务
  -> 尝试 0
       -> 用例 A：首次运行 -> 重试 1 -> 重试 2
       -> 用例 B：首次运行
  -> 尝试 1，仅当仍有可继续尝试的用例失败时运行
       -> 用例 A：首次运行……
       -> 用例 B：首次运行……
```

同一次尝试中的用例可以并发执行。`autoAttempt` 产生的尝试目前按顺序执行；后续尝试会重新运行所有已注册用例，包括此前已经通过的用例。只有当前用例集全部结束后，下一次尝试才会开始。

CLI 的 `--attempt` 参数与此有关，但含义不同：它为整个运行指定用于组织报告的 `attemptId`，不会设置 `autoAttempt`，也不会改变任务尝试次数。

## 在负责执行相应工作的层级设置并发

`vieval run` 接受五种并发名称，但当前运行时并未把它们全部实现为相同形式的并行队列。

| 层级 | 当前限制的工作 | 可配置位置 |
| --- | --- | --- |
| 工作区 | 一次 CLI 运行中可以同时进入执行的项目数，默认有效上限为 `1`。 | 顶层 `concurrency.workspace`；`--workspace-concurrency` |
| 项目 | 项目内部运行已调度任务时，与任务上限组合使用的上界。 | 顶层或项目级 `concurrency.project`；`--project-concurrency` |
| 任务 | 一个项目内并发执行的已调度任务数，默认有效上限为 `1`。 | 顶层或项目级 `concurrency.task`；`--task-concurrency` |
| 尝试 | 配置、项目和任务上的尝试并发元数据。`autoAttempt` 目前按顺序执行，因此该值不会让自动尝试相互重叠。 | 顶层、项目级或任务级 `concurrency.attempt`；`--attempt-concurrency` |
| 用例 | DSL 用例的并发数。一个 `casesFromInputs` 分组可以使用独立队列，否则用例共用任务队列。 | 顶层、项目级或任务级 `concurrency.case`；`casesFromInputs(..., { concurrency })`；`--case-concurrency` |

对于工作区、项目和任务调度，CLI 值作为上限使用，不能把较低的配置值调高。对于尝试和用例设置，CLI 运行时值优先于任务级和项目级值。项目配置不能声明 `workspace`，任务配置则只包含 `attempt` 和 `case`。

```ts [vieval.config.ts]
import { defineConfig } from 'vieval'

export default defineConfig({
  concurrency: {
    workspace: 1,
  },
  projects: [
    {
      concurrency: {
        case: 4,
        project: 2,
        task: 2,
      },
      include: ['evals/*.eval.ts'],
      name: 'chat-evals',
      root: '.',
    },
  ],
})
```

任务可以进一步收紧用例并发，某一个生成用例分组还可以再次收紧：

```ts [evals/retrieval.eval.ts]
import { describeTask } from 'vieval'

describeTask('retrieval', ({ casesFromInputs }) => {
  casesFromInputs('query', ['alpha', 'beta', 'gamma'], async ({ matrix }) => {
    await evaluateQuery(matrix.inputs)
  }, {
    concurrency: 2,
  })
}, {
  concurrency: {
    case: 4,
  },
})
```

这里的分组上限是 `2`；如果使用 `--case-concurrency`，则由该运行时值覆盖。

::: warning 只有任务代码发起真实调用时，并发才会放大调用量
矩阵、推理执行器注册和并发设置本身不会调用模型提供方。如果用例确实调用模型或其他计费服务，提高任务或用例并发可能增加限流失败，并在短时间内放大费用。并发上限应根据提供方容量以及每个用例实际发出的调用数确定。
:::

## 有意识地选择尝试、重试与超时

执行策略可以设置在 `describeTask`、`caseOf` 或 `casesFromInputs` 上。用例级值会覆盖任务级值。

```ts [evals/provider-health.eval.ts]
import { caseOf, describeTask, expect } from 'vieval'

describeTask('provider health', () => {
  caseOf('returns a usable answer', async ({ signal }) => {
    const answer = await requestAnswer({ signal })
    expect(answer.length).toBeGreaterThan(0)
  }, {
    autoAttempt: 1,
    autoRetry: 2,
    input: 'health-check',
    timeout: 10_000,
  })
})
```

`autoRetry: 2` 表示首次失败后最多再重试两次。某次重试通过后便会停止，所有重试都属于同一次尝试。默认采用指数延迟：重试 1 前等待 500 毫秒，重试 2 前等待 1,000 毫秒。`autoRetryDelay` 也可以设为固定的非负数，或根据重试序号返回延迟的函数。

`autoAttempt: 1` 表示最多增加一次完整任务尝试。只有用例在重试后仍失败，且该用例还有剩余尝试次数时，才会开始下一次尝试。因为完整用例集会重新运行，早期和后续结果都会成为尝试证据。例如，第一次失败、第二次通过会贡献 `0.5`，而不是用后来的 `1` 覆盖早期失败。

::: tip 根据要回答的问题选择重复方式
尝试用于衡量不确定性带来的可靠性，因为每次完成的尝试都会贡献证据。重试用于恢复同一次尝试中的瞬时用例故障；如果重试最终通过，这次尝试就按通过处理。因此，任务分数不会保留此前的瞬时失败，不过生命周期事件仍会记录各次运行。只有当目标是恢复故障，而不是衡量故障频率时，才适合使用重试。
:::

`timeout` 针对每次用例运行单独计时。超时后，Vieval 会把该次运行标记为 `timeout`、中止用例的 `signal`，然后根据配置进入重试或后续尝试。取消过程需要下游协作，因此应把该信号传给下游操作。忽略信号的代码可能在 Vieval 停止接收其分数和指标后，继续产生外部副作用。

## 缓存确定性的准备产物

任务回调可以通过 `context.cache` 使用文件系统缓存。它是显式文件 API，不会自动缓存函数结果：

```ts [evals/dataset.eval.ts]
import { describeTask } from 'vieval'

describeTask('dataset-backed eval', ({ caseOf }) => {
  caseOf('loads prepared cases', async ({ cache, signal }) => {
    const file = cache.namespace('dataset-v1').file({
      ext: 'json',
      key: ['prepared', 'source-sha256'],
    })

    if (!await file.exists()) {
      await file.writeJson(await prepareDataset({ signal }))
    }

    const cases = await file.readJson<Array<{ id: string }>>()
    await evaluatePreparedCases(cases)
  })
})
```

CLI 运行期间，缓存路径依次由项目根目录下的 `.vieval/cache`、工作区 ID、项目名、命名空间、键片段和扩展名组成。运行时会清理路径片段，并以原子方式写入文本、JSON 和二进制数据。它不会自动对输入求哈希、设置过期时间，也不会判断缓存内容是否仍然有效。所有会改变产物的身份信息都应放入命名空间或键中。

只有缓存根目录以及工作区、项目、命名空间和键都相同，任务尝试和后续运行才会解析到同一个文件。顶层比较运行会通过已配置的评测基准缓存命名空间共享项目身份片段，但位于不同项目根目录下的方案仍使用不同的物理 `.vieval/cache` 目录。复用同一个缓存文件还要求缓存根目录相同。

## 了解每一层保留的证据

任务聚合与报告产物回答的是相关但不同的问题：

- 失败或超时用例会增加一次值为 `0` 的 `exact` 证据；没有自定义分数的通过用例会增加 `1`。
- 通过用例会贡献自定义的 `exact` 与 `judge` 分数；失败用例的自定义分数不参与任务聚合。
- 每次完成的自动尝试都会向任务聚合分数增加一组用例结果。
- 执行过程中会发出报告器生命周期、分数和指标事件。使用 `--report-out` 时，`events.jsonl` 会保留这些事件。
- `cases.jsonl` 是按任务与用例生成的最终归一化投影，因此重复重试或自动尝试不会形成独立用例行。需要查看执行顺序时应读取原始事件；需要查看按尝试加权的分数时，应读取 `run-summary.json` 中的任务聚合结果。

正如[断言、分数与指标](/zh-hans/guide/learn/assertions-scores-and-metrics)所述，在后续失败前发出的分数事件可能保留在报告用例记录中，但任务聚合仍会把该结果计为失败。诊断时需要结合状态与分数判断。

常见的边界错误是使用 `autoRetry` 衡量可靠性：恢复后的用例只会表现为一次通过的尝试。如果需要在聚合结果中保留早期失败，应使用 `autoAttempt`，并注意它也会重新运行已经通过的用例。此外，不要把 `--attempt` 或 `--attempt-concurrency` 当作增加自动尝试次数的参数。

下一步在[报告与比较](/zh-hans/guide/learn/reports-and-comparisons)中保留并检查这些证据。
