---
title: 报告与比较
prev:
  text: 可靠执行
  link: /zh-hans/guide/learn/reliable-execution
---

# 报告与比较

默认 CLI 摘要用于回答当前终端中发生了什么。报告产物则保留证据，便于随后检查用例、分析多次运行，并比较基线与候选方案。

## 从终端输出转向可保留的产物

`vieval run` 默认输出适合阅读的摘要。`--json` 会把标准输出切换为机器可读的运行结果，但不会创建文件。如果需要同时持久化报告目录，应添加 `--report-out`。

```bash [终端]
vieval run \
  --config ./vieval.config.ts \
  --workspace local \
  --experiment baseline \
  --attempt attempt-a \
  --report-out .vieval/reports
```

该命令仍会输出适合阅读的摘要，显示当前运行及其项目、任务和用例状态。如果脚本需要从标准输出读取机器可读的运行结果以及解析后的 `reportDirectory`，可以添加 `--json`。`--report-out` 创建的报告目录会在终端会话结束后继续保留，但适合阅读的摘要不会输出其路径。

如果没有 `--report-out`，`reportDirectory` 为 `null`，`vieval report ...` 命令也没有本次运行产生的新产物可读。

## 了解一次运行写入的内容

Vieval 按工作区、项目、实验、尝试和自动生成的运行 ID，把每次运行放在报告根目录下。包含多个项目的运行会使用 `multi-project` 作为项目路径片段。

| 产物 | 已确认的内容 |
| --- | --- |
| `run-summary.json` | CLI 运行结果，包括各类 ID、项目状态、用例摘要与失败信息、矩阵摘要和聚合运行分数。 |
| `events.jsonl` | 执行期间捕获的运行、任务、用例、分数、指标和自定义事件记录，按发生顺序保存。 |
| `cases.jsonl` | 每个已观察任务/用例的一条最终归一化记录，包括各类 ID、状态、耗时、推导出的重试次数、分数、指标以及可选输入/输出。 |
| `metrics-summary.json` | 根据归一化用例记录计算的总体分数数量、总和与平均值。 |
| `otlp/traces.json`、`otlp/logs.json`、`otlp/metrics.json` | 根据用例记录生成的本地 OTLP 结构投影。 |

`vieval report index` 默认还会创建 `index/runs.jsonl`。该文件不会由 `vieval run` 写入。

自动尝试需要注意一个读取边界：`run-summary.json` 包含由所有已完成尝试证据聚合得到的任务分数，而 `cases.jsonl` 为每个任务/用例保留最终投影。需要查看重试或尝试顺序时，应读取 `events.jsonl`。

`retryCount` 字段根据生命周期开始事件推导。如果事件没有提供 `retryIndex`，后续尝试产生的重复用例开始事件也可能增加该值；需要准确区分重试与尝试时，应读取 `events.jsonl`。

::: warning 报告产物可能包含敏感信息
产物可能包含用例输入和输出、错误信息、自定义指标、模型或评测基准标识符，以及其他事件载荷。应设置合适的保留策略与访问限制，并删除或脱敏不应离开评测环境的字段。
:::

## 索引、检查与分析报告

每个报告命令都需要报告路径。该路径通常既可以指向单次运行目录，也可以指向包含多次运行的上层报告根目录。

```bash [终端 — 建立运行索引]
vieval report index <报告目录>
```

`index` 会递归查找 `run-summary.json`，并把精简的运行记录写入 `<报告目录>/index/runs.jsonl`；可以使用 `--output` 修改路径。`--format table|json|jsonl` 控制标准输出，不改变索引文件格式。

```bash [终端 — 检查归一化用例]
vieval report cases <报告目录>
```

`cases` 读取 `cases.jsonl`。可以重复使用 `--where key=value` 进行等值筛选，添加 `--group-by <key>` 生成分组分数摘要，并通过 `--format table|json|jsonl` 选择输出格式。JSON 与 JSONL 都写到标准输出；该命令不会生成新的用例产物。

```bash [终端 — 分析运行]
vieval report analyze <报告目录>
```

`analyze` 读取运行摘要与事件，对运行进行筛选，再按工作区与实验汇总。筛选条件包括工作区、项目、实验、尝试、运行、事件或错误文本，以及运行/评测矩阵选择器。`--task-state` 与 `--case-state` 目前接受 `passed`、`failed` 或 `skipped`；`--case-state` 当前不接受 `timeout`。`--format table|json|jsonl|csv` 控制标准输出。

## 比较两组已有报告

报告比较命令需要左侧基线与右侧候选方案：

```bash [终端]
vieval report compare <左侧报告目录> <右侧报告目录>
```

该命令读取归一化用例，按用例键对齐，并报告匹配项的差值以及新增、移除的用例。单个用例与分组差值只使用已匹配记录，并按「右侧减左侧」计算；分组选择器读取右侧记录的值。已匹配用例缺少所选分数时，该分数按 `0` 处理。总体差值则用左右两侧完整记录集各自的平均值相减，并忽略缺少所选分数的记录，因此新增和移除会影响总体差值，它也不等于匹配项差值的平均值。`--score-kind <kind>` 默认为 `exact`，输出格式可以是 `table` 或 `json`。

默认对齐键依次为 `benchmark.case.id` 指标、`vieval.case.id`，最后是记录自身的 `caseId`。如果评测基准使用其他稳定标识符，可以传入 `--case-key <key>`。显式指定的键必须存在于每条记录中。任何一侧出现重复的解析键都会报错，而不会任意选择匹配项。

`--case-key`、`--group-by` 与 `report cases` 使用的选择器会先查找同名指标，再查找 `scores.<name>` 或分数简称，最后查找用例记录的直接字段。例如，`benchmark.category` 可以引用指标，`state` 则引用归一化记录字段。

不要把该命令与顶层 `vieval compare` 混淆：

- `vieval report compare <left> <right>` 比较已经存在的用例产物。
- `vieval compare --config ... --comparison ...` 加载比较模式配置，针对同一个评测基准执行每个已配置方案，共享已配置的评测基准缓存命名空间，并可通过 `--output` 写入聚合比较产物。

## 完成一次完整比较流程

下面的流程会保留两次执行、索引合并后的根目录、检查候选用例、分析所有运行，最后比较用例分数。报告命令会递归发现运行，因此不需要编造运行 ID。

```bash [终端 — 保留基线]
vieval run \
  --config ./vieval.config.ts \
  --workspace local \
  --experiment baseline \
  --attempt attempt-a \
  --report-out .vieval/reports/baseline
```

```bash [终端 — 保留候选方案]
vieval run \
  --config ./vieval.config.ts \
  --workspace local \
  --experiment candidate \
  --attempt attempt-a \
  --report-out .vieval/reports/candidate
```

```bash [终端 — 索引所有已保留运行]
vieval report index .vieval/reports
```

```bash [终端 — 检查候选用例]
vieval report cases .vieval/reports/candidate \
  --where state=failed \
  --format jsonl
```

```bash [终端 — 分析运行级可靠性]
vieval report analyze .vieval/reports --format json
```

```bash [终端 — 比较已对齐的用例分数]
vieval report compare \
  .vieval/reports/baseline \
  .vieval/reports/candidate \
  --case-key benchmark.case.id \
  --score-kind exact \
  --format table
```

最后一条命令要求每个用例都发出唯一的 `benchmark.case.id`。如果没有这一保证，并且内置后备标识符适合当前数据，应省略 `--case-key`。

常见错误包括把 `--json` 当成持久化选项，或者把报告命令指向一次未使用 `--report-out` 的运行目录。另一个常见错误是使用自动生成或重复的标识符进行对齐；只有当所选键在左右两侧表示同一个评测基准用例时，比较才有意义。

可以在 [API](/zh-hans/api/) 中查看公开入口，在[配置](/zh-hans/config/)中查看当前配置接口。
