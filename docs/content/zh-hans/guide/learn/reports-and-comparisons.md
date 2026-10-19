---
title: 报告与比较
prev:
  text: 可靠执行
  link: /zh-hans/guide/learn/reliable-execution
---

# 报告与比较

CLI 默认在终端中显示本次运行的摘要。如果需要在运行结束后检查用例、汇总多次运行，或比较基线与候选方案，请把报告保存到文件。

## 保存一次运行的报告

`vieval run` 默认向标准输出写入便于阅读的摘要，并把报告写入配置文件旁边的 `.vieval/reports`。`--report-out <path>` 修改报告根目录；`--no-report` 不写入任何报告，此时用例产物会写入一个临时目录，并在运行结束时删除。`--json` 只把标准输出改为 JSON，不改变写入哪些文件。

::: code-group

```bash [终端]
vieval run \
  --config ./vieval.config.ts \
  --experiment baseline \
  --attempt attempt-a \
  --report-out .vieval/reports
```

:::

上面的命令仍会显示可读摘要，并把报告写入 `.vieval/reports` 下的运行目录。如果脚本需要从标准输出读取运行结果，可以再添加 `--json`：结果包含 `invocationId` 和 `projects` 列表，每个项目都有自己的 `runId` 和 `reportDirectory`。

使用 `--no-report` 时，每个项目的 `reportDirectory` 都为 `null`，后续的 `vieval report ...` 命令也无法读取这次运行的数据。

## 了解一次运行写入的内容

每个项目都是一次独立的运行。Vieval 在报告根目录下按 `<工作区>/<项目>/<实验>/<尝试>/<运行>/` 保存每次运行。工作区目录名默认取工作区配置文件所在目录的名称；只有没有配置文件时才使用 `default-workspace`。同一次 `vieval run` 调用产生的各个运行共用 `experimentId`、`attemptId` 和 `invocationId`；由比较启动的运行还带有 `comparisonId`。

| 文件 | 内容 |
| --- | --- |
| `run-summary.json` | 恰好一个项目的运行结果，包括 `schemaVersion: 1`、`runId`、`reportDirectory`、各类 ID、项目状态、用例计数与失败信息、矩阵摘要和汇总分数。`vieval report` 命令遇到其他版本时会报错。 |
| `events.jsonl` | 按发生顺序记录运行、任务、用例、分数、指标和自定义事件。 |
| `cases.jsonl` | 每个「任务 ID + 用例 ID」组合的最终记录，包括状态、耗时、根据事件推算的重试次数、分数、指标以及可选的输入和输出。 |
| `metrics-summary.json` | 从 `cases.jsonl` 计算出的分数数量、总和与平均值。 |
| `otlp/traces.json`、`otlp/logs.json`、`otlp/metrics.json` | 从用例记录转换得到的本地 OTLP 数据。 |

`vieval report index` 默认会创建 `index/runs.jsonl`，也可以通过 `--output` 指定其他位置；`vieval run` 本身不会写入这个索引文件。

`run-summary.json`、每条事件、每条用例记录，以及 OTLP 文件中资源和 `vieval.run` span 的 `vieval.workspace.id`、`vieval.experiment.id`、`vieval.attempt.id`、`vieval.run.id` 属性，都使用同一组 `workspaceId`、`experimentId`、`attemptId` 和 `runId`，因此可以在所有文件之间追溯同一次运行。

使用自动尝试时，应根据问题选择文件：`run-summary.json` 中的任务分数包含所有已完成尝试的结果；`cases.jsonl` 为每个「任务 ID + 用例 ID」组合只保留一条记录，其顶层字段描述最后一次尝试，`attempts` 列出每次尝试的状态、分数、重试次数和耗时；`events.jsonl` 中，启用自动尝试的任务的 `case.started` 和 `case.ended` 带有 `attemptIndex`（第一次尝试为 0）和 `autoAttempt`。

`cases.jsonl` 中的 `retryCount` 只统计最后一次尝试内的重试。对于启用自动尝试的任务，它根据 `attemptIndex` 计算，后续尝试不会被算作重试。在 `attemptIndex` 出现之前写入的报告没有这个字段，其中后续尝试的重复开始事件仍可能让 `retryCount` 增加。

事件行仍为 `schemaVersion: 2`，用例记录仍为 `schemaVersion: 1`：新增可选字段或新事件名不改变版本号，读取方会忽略不认识的字段；重命名、删除字段或改变字段类型时才会增加版本号。

::: warning 报告文件可能包含敏感信息
报告可能包含用例输入和输出、错误信息、自定义指标、模型或评测基准标识符，以及其他事件数据。请设置合适的保留期限和访问权限，并删除或脱敏不应离开评测环境的字段。
:::

## 索引、检查与分析报告

每个报告命令都需要一个报告路径。这个路径通常既可以是单次运行目录，也可以是包含多次运行的上层目录。

::: code-group

```bash [终端 — 建立运行索引]
vieval report index <报告目录>
```

:::

`index` 会递归查找 `run-summary.json`，并把每次运行的摘要写入 `<报告目录>/index/runs.jsonl`。可以用 `--output` 修改索引文件路径。`--format table|json|jsonl` 只改变标准输出的格式，索引文件始终使用 JSONL。

::: code-group

```bash [终端 — 检查用例记录]
vieval report cases <报告目录>
```

:::

`cases` 读取 `cases.jsonl`。可以多次传入 `--where key=value` 筛选记录，用 `--group-by <key>` 按字段汇总分数，并通过 `--format table|json|jsonl` 选择输出格式。命令只向标准输出写入结果，不会生成新的用例文件。

::: code-group

```bash [终端 — 分析运行]
vieval report analyze <报告目录>
```

:::

`analyze` 读取运行摘要和事件。它可以按工作区、项目、实验、尝试、运行、事件、错误文本，以及运行或评测矩阵的选中值筛选，再按工作区和实验汇总结果。`--task-state` 和 `--case-state` 目前接受 `passed`、`failed` 或 `skipped`；`--case-state` 暂不接受 `timeout`。`--attempt-index <n>` 只保留至少有一个用例运行过第 `n` 次自动尝试的运行。JSON、JSONL 和 CSV 输出中的每个运行行和实验分组都包含 `autoAttemptedCases`（运行过多次尝试的用例数；后续尝试会重新运行任务的全部用例）和 `maxAttemptIndex`（没有自动尝试时为 `null`）。`--format table|json|jsonl|csv` 用于选择标准输出格式。

::: code-group

```bash [终端 — 列出尝试]
vieval report attempts --config vieval.config.ts
```

:::

`attempts` 按时间从新到旧列出报告目录中的尝试：每个实验和尝试一行，显示涉及的工作区、通过、失败和没有结果的用例数，以及覆盖率。"←" 标记 `vieval run --resume` 不指定标识时会继续的那次尝试；备注列显示该尝试继续自哪次尝试、是否被中断，以及没来得及写入摘要就被终止的运行。可以传入报告目录，或用 `--config` 列出配置文件旁边的报告；用 `--experiment` 和 `--workspace` 筛选，用 `--format table|json` 选择输出格式。

## 比较两组已有报告

比较命令的第一个目录是基线，第二个目录是候选方案：

::: code-group

```bash [终端]
vieval report compare <基线报告目录> <候选方案报告目录>
```

:::

命令按以下规则计算结果：

1. **先对齐用例。** 命令从基线和候选方案中读取 `cases.jsonl`，根据用例键找到同一个用例。候选方案独有的记录记为新增，基线独有的记录记为移除。
2. **再计算匹配项。** 单个用例和分组的差值都按「候选方案减基线」计算，并且只使用已经对齐的记录。使用 `--group-by` 时，分组值取自候选方案。
3. **处理缺失分数。** 已对齐的用例如果在某份报告中缺少 `--score-kind` 指定的分数，对应分数按 `0` 计算。`--score-kind` 默认为 `exact`。
4. **单独计算总体差值。** 命令分别对基线和候选方案中所有包含该分数的记录求平均值，再用候选平均值减去基线平均值。新增和移除的用例会影响总体差值；缺少所选分数的记录不会进入这一步。因此，总体差值不一定等于匹配用例差值的平均值。

输出格式支持 `table` 和 `json`。

为了对齐用例，命令默认依次尝试指标 `benchmark.case.id`、指标 `vieval.case.id`，最后使用 `<taskId>::<caseName>`。如果评测基准有其他稳定标识符，可以传入 `--case-key <key>`。显式指定的键必须存在于每条记录中；基线或候选方案中出现重复键时，命令会报错，不会自行选择其中一条记录。

`--case-key`、`--group-by` 和 `report cases` 的字段选择规则相同：先查找同名指标，再查找 `scores.<name>` 或分数名称，最后查找用例记录的直接字段。例如，`benchmark.category` 可以引用指标，`state` 可以引用用例状态字段。

`vieval report compare <基线报告目录> <候选方案报告目录>` 只比较已经保存的用例报告。如果要让同一评测基准的多种实现并排运行，请使用比较配置。

## 运行一次比较

列出 `workspaces` 的配置就是一个比较。每一项可以是包含 `vieval.config.*` 的目录路径或 glob，可以用 `'!<glob>'` 排除目录，也可以写成 `{ root, id?, env? }`。工作区 ID 默认取目录名，ID 重复时会报错。比较配置中没有模型、插件和报告器，每个工作区都按自己的配置运行。

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

::: code-group

```bash [终端]
vieval run --config evals/agent-memory/vieval.config.ts
```

:::

- 每个工作区都在独立进程中运行，使用该工作区自己解析到的 `vieval`。它的版本必须相同，因此工作区的依赖必须已经安装。
- 默认所有工作区同时开始。可以用 `concurrency: { workspace }` 或 `--workspace-concurrency` 限制数量。
- 比较配置的 `env`（以及单个条目的 `env`）优先于各工作区配置的 `env`，并在工作区插件运行之前生效。
- `cache: { namespace }` 让所有工作区共用比较配置旁边的 `.vieval/cache/<比较 ID>/<namespace>/`。
- 终端中只有一个实时窗口，显示所有工作区的 `Workspaces`、`Projects`、`Tasks`、`Cases`、`Concurrency` 和 `Time` 行。某个工作区失败不会中止其他工作区。
- 运行结束后会输出排行榜：每个工作区的每个项目占一行，按混合分数（hybrid）排序；随后列出失败的工作区及其 stderr 的最后几行。
- 只要有工作区失败或存在失败的用例，退出码就是 `1`。`--json` 会输出比较结果。
- 报告写入比较配置旁边的 `.vieval/reports`。实验 ID 默认为比较 ID，所有工作区共用同一个尝试，因此比较中的每次运行都位于 `<工作区>/<项目>/<比较 ID>/<尝试>/` 下。
- 使用 `--with-viewer` 时，只启动一个查看器，展示比较的报告根目录。

选择器用于缩小运行范围。它们可以重复传入，值中包含 `*` 时按 glob 匹配：`--workspace <id>`（仅用于比较，用在工作区配置上会报错）、`--project <name>`、`--task <name>`（`describeTask` 名称或评测项 ID）和 `--case <name>`（用例名称）。选择器没有匹配到任何内容时会报错，并列出现有的选项；在比较中，`--project`、`--task` 和 `--case` 必须至少在一个工作区中有匹配。

::: code-group

```bash [终端]
vieval run --config evals/agent-memory/vieval.config.ts --workspace mem9 --with-viewer --open
vieval run --task zh --case 'case #1*'
```

:::

## 完成一次完整比较流程

下面的流程使用两份配置分别运行基线和候选方案，再对它们共同的报告根目录建立索引。请确保两份配置会发现同一组评测用例，并分别指向需要比较的模型、提示词或被测项目版本。`--experiment` 只为报告设置实验标识，不会切换模型、提示词或被测代码。

报告命令会递归查找运行目录，因此不需要手动填写运行 ID。

::: code-group

```bash [终端 — 运行并保存基线报告]
vieval run \
  --config ./vieval.baseline.config.ts \
  --experiment baseline \
  --attempt attempt-a \
  --report-out .vieval/reports/baseline
```

:::

::: code-group

```bash [终端 — 运行并保存候选方案报告]
vieval run \
  --config ./vieval.candidate.config.ts \
  --experiment candidate \
  --attempt attempt-a \
  --report-out .vieval/reports/candidate
```

:::

::: code-group

```bash [终端 — 为所有报告建立索引]
vieval report index .vieval/reports
```

:::

::: code-group

```bash [终端 — 检查候选用例]
vieval report cases .vieval/reports/candidate \
  --where state=failed \
  --format jsonl
```

:::

::: code-group

```bash [终端 — 汇总运行结果]
vieval report analyze .vieval/reports --format json
```

:::

::: code-group

```bash [终端 — 比较已对齐的用例分数]
vieval report compare \
  .vieval/reports/baseline \
  .vieval/reports/candidate \
  --case-key benchmark.case.id \
  --score-kind exact \
  --format table
```

:::

最后一条命令要求每个用例都有唯一的 `benchmark.case.id`。如果无法保证这一点，并且默认标识符可以稳定对应同一个用例，请省略 `--case-key`。

常见错误包括：让报告命令读取错误的根目录（使用 `--report-out` 时，报告位于该路径下，而不是 `.vieval/reports`）；试图读取使用 `--no-report` 的运行；或使用自动生成、可能重复的标识符对齐用例。只有当所选键在基线和候选方案中都表示同一个评测基准用例时，比较结果才有意义。

可以在[API](/zh-hans/api/)中查看公开入口，在[配置](/zh-hans/config/)中查看当前配置接口。
