---
title: 报告与比较
prev:
  text: 可靠执行
  link: /zh-hans/guide/learn/reliable-execution
---

# 报告与比较

CLI 默认在终端中显示本次运行的摘要。如果需要在运行结束后检查用例、汇总多次运行，或比较基线与候选方案，请把报告保存到文件。

## 保存一次运行的报告

`vieval run` 默认向标准输出写入便于阅读的摘要。`--json` 会把标准输出改为 JSON，但不会创建报告文件。要保存报告目录，请使用 `--report-out`。

::: code-group

```bash [终端]
vieval run \
  --config ./vieval.config.ts \
  --workspace local \
  --experiment baseline \
  --attempt attempt-a \
  --report-out .vieval/reports
```

:::

上面的命令仍会显示可读摘要，并把报告写入 `.vieval/reports` 下的本次运行目录。如果脚本需要从标准输出读取运行结果和最终的 `reportDirectory`，可以再添加 `--json`。可读摘要不会显示报告目录路径。

未使用 `--report-out` 时，JSON 结果中的 `reportDirectory` 为 `null`，后续的 `vieval report ...` 命令也无法读取这次运行的数据。

## 了解一次运行写入的内容

Vieval 在报告根目录下按工作区、项目、实验、尝试和自动生成的运行 ID 保存每次运行。如果一次运行包含多个项目，项目目录名会使用 `multi-project`。

| 文件 | 内容 |
| --- | --- |
| `run-summary.json` | 完整的 CLI 运行结果，包括各类 ID、项目状态、用例计数与失败信息、矩阵摘要和汇总分数。 |
| `events.jsonl` | 按发生顺序记录运行、任务、用例、分数、指标和自定义事件。 |
| `cases.jsonl` | 每个「任务 ID + 用例 ID」组合的最终记录，包括状态、耗时、根据事件推算的重试次数、分数、指标以及可选的输入和输出。 |
| `metrics-summary.json` | 从 `cases.jsonl` 计算出的分数数量、总和与平均值。 |
| `otlp/traces.json`、`otlp/logs.json`、`otlp/metrics.json` | 从用例记录转换得到的本地 OTLP 数据。 |

`vieval report index` 默认会创建 `index/runs.jsonl`，也可以通过 `--output` 指定其他位置；`vieval run` 本身不会写入这个索引文件。

使用自动尝试时，应根据问题选择文件：`run-summary.json` 中的任务分数包含所有已完成尝试的结果；`cases.jsonl` 为每个「任务 ID + 用例 ID」组合只保留最终记录；`events.jsonl` 则保留重试和尝试的执行顺序。

`cases.jsonl` 中的 `retryCount` 根据用例开始事件计算。如果事件没有 `retryIndex`，后续自动尝试产生的重复开始事件也可能让这个数字增加。要准确区分重试和自动尝试，请直接查看 `events.jsonl`。

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

`analyze` 读取运行摘要和事件。它可以按工作区、项目、实验、尝试、运行、事件、错误文本，以及运行或评测矩阵的选中值筛选，再按工作区和实验汇总结果。`--task-state` 和 `--case-state` 目前接受 `passed`、`failed` 或 `skipped`；`--case-state` 暂不接受 `timeout`。`--format table|json|jsonl|csv` 用于选择标准输出格式。

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

为了对齐用例，命令默认依次尝试指标 `benchmark.case.id`、指标 `vieval.case.id`，最后使用记录中的 `caseId`。如果评测基准有其他稳定标识符，可以传入 `--case-key <key>`。显式指定的键必须存在于每条记录中；基线或候选方案中出现重复键时，命令会报错，不会自行选择其中一条记录。

`--case-key`、`--group-by` 和 `report cases` 的字段选择规则相同：先查找同名指标，再查找 `scores.<name>` 或分数名称，最后查找用例记录的直接字段。例如，`benchmark.category` 可以引用指标，`state` 可以引用用例状态字段。

不要把该命令与顶层 `vieval compare` 混淆：

- `vieval report compare <基线报告目录> <候选方案报告目录>` 读取并比较已经保存的用例报告。
- `vieval compare --config ... --comparison ...` 读取比较模式配置，针对同一个评测基准运行所有已配置方案。Vieval 会把 `benchmark.sharedCaseNamespace` 用作各方案共同的缓存项目名（内部的 `cacheProjectName`），并可通过 `--output` 保存汇总后的比较结果。

## 完成一次完整比较流程

下面的流程使用两份配置分别运行基线和候选方案，再对它们共同的报告根目录建立索引。请确保两份配置会发现同一组评测用例，并分别指向需要比较的模型、提示词或被测项目版本。`--experiment` 只为报告设置实验标识，不会切换模型、提示词或被测代码。

报告命令会递归查找运行目录，因此不需要手动填写运行 ID。

::: code-group

```bash [终端 — 运行并保存基线报告]
vieval run \
  --config ./vieval.baseline.config.ts \
  --workspace local \
  --experiment baseline \
  --attempt attempt-a \
  --report-out .vieval/reports/baseline
```

:::

::: code-group

```bash [终端 — 运行并保存候选方案报告]
vieval run \
  --config ./vieval.candidate.config.ts \
  --workspace local \
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

常见错误包括：把 `--json` 当作保存报告的选项；试图用报告命令读取没有通过 `--report-out` 保存的运行；或使用自动生成、可能重复的标识符对齐用例。只有当所选键在基线和候选方案中都表示同一个评测基准用例时，比较结果才有意义。

可以在[API](/zh-hans/api/)中查看公开入口，在[配置](/zh-hans/config/)中查看当前配置接口。
