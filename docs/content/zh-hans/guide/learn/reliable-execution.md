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

模型输出可能不稳定，外部服务也可能暂时失败。Vieval 提供自动尝试、重试和超时来处理这些情况，并通过并发限制控制同时执行的任务和用例。对于可以重复使用的数据准备结果，还可以使用任务缓存减少重复计算。

## 理解用例的执行顺序

一个调度任务可以包含多个用例。启用 `autoAttempt` 后，Vieval 会先运行全部用例，等它们结束后再判断是否需要下一次尝试。只要有失败或超时的用例尚未达到自己的尝试次数上限，Vieval 就会再次运行全部用例。每次运行单个用例时，`autoRetry` 还可以在失败后立即重试该用例。

```text
已调度任务
  -> 尝试 0
       -> 用例 A：首次运行 -> 重试 1 -> 重试 2
       -> 用例 B：首次运行
  -> 尝试 1，仅当失败或超时用例仍可再次尝试时运行
       -> 用例 A：首次运行……
       -> 用例 B：首次运行……
```

同一次尝试中的用例可以并发执行，但不同尝试目前会依次执行。后续尝试会重新运行全部用例，包括上一次已经通过的用例。

CLI 参数 `--attempt` 只为本次运行设置报告中的 `attemptId`。它不会启用 `autoAttempt`，也不会改变用例的执行次数。

## 为不同工作设置并发上限

`vieval run` 支持五种并发设置。它们分别控制不同工作，并非每个设置都对应一个独立的并行队列。

| 名称 | 控制对象 | 可配置位置 |
| --- | --- | --- |
| 工作区 | 一次 CLI 运行最多同时执行多少个项目；默认上限为 `1`。 | 顶层 `concurrency.workspace`；`--workspace-concurrency` |
| 项目 | 项目执行调度任务时采用的上限；它会与任务上限取较小值。 | 顶层或项目级 `concurrency.project`；`--project-concurrency` |
| 任务 | 一个项目最多同时执行多少个调度任务；默认上限为 `1`。 | 顶层或项目级 `concurrency.task`；`--task-concurrency` |
| 尝试 | 自动尝试目前依次执行；该值会保存在配置中，但暂不改变执行方式。 | 顶层、项目级或任务级 `concurrency.attempt`；`--attempt-concurrency` |
| 用例 | 一个任务最多同时执行多少个用例。单次 `casesFromInputs` 调用可以使用自己的队列和上限。 | 顶层、项目级或任务级 `concurrency.case`；`casesFromInputs(..., { concurrency })`；`--case-concurrency` |

对于工作区、项目和任务，CLI 参数只能收紧配置中的上限，不能把较小的配置值调高。对于尝试和用例，CLI 参数会覆盖任务级或项目级的值。项目配置不能设置 `workspace`；任务配置只能设置 `attempt` 和 `case`。

::: code-group

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

:::

任务可以单独设置用例并发，某一次 `casesFromInputs` 调用还可以使用更小的上限：

::: code-group

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

:::

这里的任务级上限是 `4`，但这三个输入共享一个上限为 `2` 的队列。传入 `--case-concurrency` 时，运行时值会覆盖项目级、任务级和这一组输入的用例并发。

::: warning 提高并发会增加同时发出的请求数
矩阵、推理执行器注册和并发配置本身不会调用模型服务。如果用例会调用模型或其他计费服务，提高任务或用例并发可能触发限流，并在短时间内产生更多费用。请根据服务方允许的请求速率，以及每个用例实际发出的请求数设置上限。
:::

## 选择自动尝试、重试与超时

可以在 `describeTask` 上设置整个任务的执行策略，也可以在 `caseOf` 或 `casesFromInputs` 上覆盖某些用例的策略。

::: code-group

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

:::

`autoRetry: 2` 表示首次运行失败后最多再执行两次。只要其中一次通过，就不会继续重试；这些运行都计入同一次尝试。默认等待时间按重试序号增加：第一次重试前等待 500 毫秒，第二次重试前等待 1,000 毫秒。也可以把 `autoRetryDelay` 设为固定的非负毫秒数，或传入一个根据重试序号返回等待时间的函数。

`autoAttempt: 1` 表示首次尝试结束后，最多再运行一次完整用例集。只有某个用例在用完重试次数后仍然失败或超时，并且尚未达到自己的尝试上限，Vieval 才会开始下一次尝试。每次完成的尝试都会参与任务分数计算。例如，同一个用例第一次失败、第二次通过时，最终的 `exact` 平均分为 `0.5`，后一次通过不会覆盖前一次失败。

::: tip 根据要回答的问题选择重复方式
如果要观察多次执行的通过率，请使用 `autoAttempt`，因为每次尝试的结果都会参与任务分数计算。`autoRetry` 更适合应对网络抖动等临时故障：只要某次重试通过，这次尝试就按通过计算，不会把此前的失败计入任务分数。各次运行仍会写入生命周期事件，便于排查问题。
:::

`timeout` 会为每次用例运行单独计时。超时后，Vieval 把该次运行标记为 `timeout`，并中止传给用例的 `signal`，随后根据配置重试当前用例或开始下一次尝试。请把这个信号继续传给网络请求、模型调用等下游操作。下游代码如果不响应取消信号，仍可能在 Vieval 停止记录该用例的分数和指标后继续执行，并产生外部副作用。

## 缓存可重复使用的数据准备结果

任务回调可以通过 `context.cache` 读写文件缓存。Vieval 不会自动缓存函数返回值，因此代码需要明确判断文件是否存在，并负责写入和读取：

::: code-group

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

:::

CLI 默认把缓存写到项目根目录下的 `.vieval/cache`。完整路径依次包含工作区 ID、项目名、命名空间、键和扩展名。Vieval 会把这些值转换为安全的路径片段，并以原子方式写入文本、JSON 和二进制文件。

缓存不会自动计算输入哈希、设置过期时间或检查内容是否过时。凡是会改变文件内容的版本号、数据源标识或参数，都应写入命名空间或键。例如，数据源变化后，示例中的 `source-sha256` 也应随之变化。

只有实际使用的缓存根目录、工作区 ID、项目名、命名空间和键全部相同，多次尝试或后续运行才会读到同一个文件。顶层 `vieval compare` 会把比较配置中的 `benchmark.sharedCaseNamespace` 用作各方案共同的缓存项目名。不过，如果方案位于不同的项目根目录，它们仍会写入各自的 `.vieval/cache`；仅统一缓存项目名并不能让两个物理目录复用同一个文件。

## 区分任务汇总与报告文件

任务分数和报告文件保留的信息不同：

- 失败或超时的用例会为任务增加一个值为 `0` 的 `exact` 分数；没有自定义分数的通过用例会增加 `1`。
- 通过用例发出的 `exact` 和 `judge` 分数会参与任务计算；失败用例在运行中发出的自定义分数不会参与任务计算。
- 每次完成的自动尝试都会再向任务分数加入一组用例结果。
- 执行过程会产生生命周期、分数和指标事件。使用 `--report-out` 时，这些事件按顺序写入 `events.jsonl`。
- `cases.jsonl` 最终为每个「任务 ID + 用例 ID」组合写一条记录，多次重试或自动尝试不会分别占一行。要查看执行顺序，请读取 `events.jsonl`；要查看包含所有尝试结果的任务分数，请读取 `run-summary.json`。

正如[断言、分数与指标](/zh-hans/guide/learn/assertions-scores-and-metrics)所述，用例在失败前发出的分数事件可能仍会出现在报告记录中，但任务分数会把该用例计为失败。排查问题时，请同时检查用例状态和分数。

不要使用 `autoRetry` 统计多次执行的通过率：重试后恢复的用例在任务分数中只算一次通过。如果希望早期失败也参与最终分数，请使用 `autoAttempt`，并注意它会重新运行已经通过的用例。`--attempt` 和 `--attempt-concurrency` 都不会增加自动尝试次数。

下一步可在[报告与比较](/zh-hans/guide/learn/reports-and-comparisons)中保存运行记录，并检查或比较结果。
