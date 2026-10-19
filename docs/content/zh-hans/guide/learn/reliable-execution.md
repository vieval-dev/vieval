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

## 在共享资源的位置设置并发

并发属于调度器配置，而不是会被继承的默认值：顶层配置和每个项目都把它写在 `scheduler.concurrency` 下，和调度中间件放在一起。每个并发值都是一个槽位池。键名决定这个池数的是什么，写在哪里决定哪些工作共用这个池。

| 键 | 计数对象 |
| --- | --- |
| `project` | 同时运行的项目数 |
| `task` | 同时运行的调度任务数 |
| `case` | 同时运行的用例数 |

| 写在哪里 | 可用的键 | 由哪些工作共用 |
| --- | --- | --- |
| 顶层 `scheduler.concurrency`；`--project-concurrency`、`--task-concurrency`、`--case-concurrency` | `project`、`task`、`case` | 整个运行 |
| 项目级 `scheduler.concurrency` | `task`、`case` | 该项目的任务和用例 |
| `describeTask(..., { concurrency: { case } })` | `case` | 该任务的所有用例，跨越它的全部用例组 |
| `casesFromInputs(..., { concurrency })` | 一个数字 | 这一组用例 |

一个用例要拿到路径上每个池的槽位才会开始执行，依次是：所在的用例组、任务、项目和整个运行。各层的值不会互相覆盖，最终由最小的那个起作用，所以内层的值只能为自己的工作调低并发。用例会先拿到内层的槽位，再去占用整个运行的槽位；超时也是在拿到全部槽位之后才开始计时。

顶层配置和 CLI 参数设置同一个键时，两者都作用于整个运行，取较小的值。因此 CLI 参数不会调高配置中写明的值，但可以调高内置默认值。什么都不设置时，同一时间只运行一个项目，每个项目同一时间只运行一个任务，用例数不限。只要在整个运行的层面（配置或 CLI 参数）设置了 `task` 或 `case`，这两个默认值都不再适用：整个运行的槽位池已经限制了实际工作量，任务和项目都可以同时运行，只受这些池的限制。某个任务的慢用例不会再拖住下一个任务；某个项目还有慢用例在运行时，下一个项目也可以开始。

比较会为每个工作区启动独立进程，所以每个工作区都保留自己的槽位池。比较配置中的 `concurrency: { workspace }` 或 `--workspace-concurrency` 可以限制同时运行的工作区数；默认所有工作区同时运行。

::: code-group

```ts [vieval.config.ts]
import { defineConfig } from 'vieval'

export default defineConfig({
  projects: [
    {
      include: ['evals/*.eval.ts'],
      name: 'desktop-agent',
      root: '.',
    },
  ],
  // 整个运行最多同时 7 个用例，例如每个用例都要独占一台虚拟机。
  scheduler: {
    concurrency: {
      case: 7,
      task: 4,
    },
  },
})
```

:::

因为用例池属于整个运行，所以可以按领域把工作拆成多个任务：最多 4 个任务同时运行，但它们加起来不会超过 7 个用例。这里也可以不写 `task`，单靠整个运行的用例池就能让所有任务同时开始。

任务和它的某个用例组还可以为自己的用例进一步调低并发：

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

这里的三个输入共用一个大小为 `2` 的组池，组池外面还有大小为 `4` 的任务池，再外面是项目和整个运行的池。传入 `--case-concurrency 1` 会让整个运行同一时间只执行一个用例。

调度中间件可以包住每个被放行的项目、任务和用例，例如记录调度遥测，或者用动态条件暂缓执行。和槽位池写在一起，在顶层或项目上用 `scheduler: { middleware: [...] }` 声明。中间件在工作拿到全部槽位之后运行，顶层中间件包在项目中间件外面。

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

`autoRetry: 2` 表示首次运行失败后最多再执行两次。只要其中一次通过，就不会继续重试；这些运行都计入同一次尝试。默认只重试没有得出结果的运行（`errored` 和 `timeout`）；断言失败已经是一个结果，不会被重试。默认等待时间按重试序号增加：第一次重试前等待 500 毫秒，第二次重试前等待 1,000 毫秒。也可以把 `autoRetryDelay` 设为固定的非负毫秒数，或传入一个函数，根据重试序号和上一次运行抛出的错误返回等待时间。`autoRetryIf` 用来限定哪些失败可以重试，这样断言错误会立即失败，不会被反复执行：

```ts
import { isRetriableProviderError, readRetryAfter } from 'vieval/core/inference-executors'

const providerRetry = {
  autoRetry: 3,
  // 服务返回了 `Retry-After` 时，按它的要求等待。
  autoRetryDelay: (retryIndex: number, error: unknown) => readRetryAfter(error) ?? 10_000 * 2 ** (retryIndex - 1),
  // 只重试限流、服务端错误和连接中断。
  autoRetryIf: isRetriableProviderError,
}
```

用例重试会重新执行整个用例。如果只想重试失败的那一次服务调用，可以用 `vieval/core/inference-executors` 的 `runWithRetry` 包住这次调用。它默认在服务的 `Retry-After` 和带随机抖动的指数退避之间取较长的一个作为等待时间；传入 `{ signal }` 后，运行被中断时会立即停止等待。

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

只有实际使用的缓存根目录、工作区 ID、项目名、命名空间和键全部相同，多次尝试或后续运行才会读到同一个文件。因此，位于不同根目录的工作区会使用各自的 `.vieval/cache`，除非由比较共享缓存：在比较配置中设置 `cache: { namespace }` 后，所有工作区都会把缓存写到比较配置旁边的 `.vieval/cache/<比较 ID>/<namespace>/`，一个工作区准备好的用例数据可以被其他工作区复用。

::: code-group

```ts [evals/agent-memory/vieval.config.ts]
import { defineConfig, loadEnv } from 'vieval'

export default defineConfig({
  cache: { namespace: 'locomo-cases-v1' },
  env: loadEnv('test', import.meta.dirname, ''),
  id: 'agent-memory-semantic-approaches',
  workspaces: ['eval/test-objects/*'],
})
```

:::

## 区分任务汇总与报告文件

任务分数和报告文件保留的信息不同：

- 失败或超时的用例会为任务增加一个值为 `0` 的 `exact` 分数；没有自定义分数的通过用例会增加 `1`。
- 通过用例发出的 `exact` 和 `judge` 分数会参与任务计算；失败用例在运行中发出的自定义分数不会参与任务计算。
- 每次完成的自动尝试都会再向任务分数加入一组用例结果。
- 执行过程会产生生命周期、分数和指标事件。除非使用 `--no-report`，这些事件都会按顺序写入 `events.jsonl`。
- `cases.jsonl` 最终为每个「任务 ID + 用例 ID」组合写一条记录，多次重试或自动尝试不会分别占一行。对于启用自动尝试的任务，该记录的 `attempts` 会列出每次尝试的结果。要查看准确的执行顺序，请读取 `events.jsonl`（`case.started` 和 `case.ended` 带有 `attemptIndex`）；要查看包含所有尝试结果的任务分数，请读取 `run-summary.json`。

正如[断言、分数与指标](/zh-hans/guide/learn/assertions-scores-and-metrics)所述，用例在失败前发出的分数事件可能仍会出现在报告记录中，但任务分数会把该用例计为失败。排查问题时，请同时检查用例状态和分数。

不要使用 `autoRetry` 统计多次执行的通过率：重试后恢复的用例在任务分数中只算一次通过。如果希望早期失败也参与最终分数，请使用 `autoAttempt`，并注意它会重新运行已经通过的用例。`--attempt` 不会增加自动尝试次数，它只为运行设置标签。

下一步可在[报告与比较](/zh-hans/guide/learn/reports-and-comparisons)中保存运行记录，并检查或比较结果。
