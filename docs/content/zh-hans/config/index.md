# 配置

Vieval 会从执行命令时的工作目录开始逐级向上查找最近的 `vieval.config.*` 文件。支持的扩展名包括 `.ts`、`.mts`、`.cts`、`.js`、`.mjs`、`.cjs` 和 `.json`。使用 `--config <path>` 可以显式指定配置文件；相对路径以执行命令时的工作目录为基准。

配置文件所在的目录是默认根目录。项目没有设置 `root` 时，Vieval 会相对于该目录匹配 `include` 和 `exclude`；设置 `root` 后，则改为相对于项目根目录匹配。

## 配置内容

| 配置项 | 说明 | 延伸阅读 |
| --- | --- | --- |
| 环境变量 | 顶层 `env` 会在 `vieval run` 期间临时写入 `process.env`，运行结束后恢复原值。Vieval 不会自动读取 `.env*` 文件；如需读取，请在配置文件中从 `vieval` 导入并调用 `loadEnv`。 | [模型与推理执行器](/zh-hans/guide/learn/models-and-inference-executors) |
| 项目 | `projects` 用于设置项目名称、根目录、评测文件匹配规则、执行器、模型和项目级运行选项。在项目模式下，未提供 `projects` 时，Vieval 使用名为 `default` 的项目。 | [核心概念](/zh-hans/guide/core-concepts) |
| 工作区 | `workspaces` 中的每个 `{ id, root }` 会独立作为一个项目运行：`id` 是项目名称，`root` 是项目根目录。Vieval 不会另外创建工作区级任务。 | [核心概念](/zh-hans/guide/core-concepts) |
| 比较 | `comparisons` 用于配置 `vieval compare` 的基准、待比较方法和工作区查找规则。顶层的 `projects`、`workspaces` 和 `comparisons` 不能同时使用。 | [报告与比较](/zh-hans/guide/learn/reports-and-comparisons) |
| 插件与模型 | 顶层和项目级均可配置插件与模型。配置模型只会将模型加入该项目的可用模型列表；任务代码仍需主动选择并调用模型。 | [模型与推理执行器](/zh-hans/guide/learn/models-and-inference-executors) |
| 运行矩阵与评测矩阵 | 项目可通过 `runMatrix` 和 `evalMatrix` 定义变量组合。评测和任务还可以继续扩展、替换或禁用矩阵维度。Vieval 根据组合生成待执行任务，任务代码负责使用各维度的取值。 | [矩阵与数据集](/zh-hans/guide/learn/matrices-and-datasets) |
| 并发与执行策略 | 顶层 `concurrency` 可分别控制工作区、项目、任务、尝试和用例的并发数，项目级 `concurrency` 可控制项目、任务、尝试和用例的并发数。任务和用例还可以设置尝试次数、自动重试、超时和并发。CLI 参数为工作区、项目和任务设置并发上限；为尝试和用例设置的参数会覆盖配置值。`--attempt` 仅设置报告中的尝试标识，不会改变自动尝试次数。 | [可靠执行](/zh-hans/guide/learn/reliable-execution) |
| 缓存 | 任务通过 `TaskRunContext` 使用缓存。CLI 默认将项目缓存写入项目根目录下的 `.vieval/cache`。将多个方法与同一基准比较时，这些方法可以共享用例缓存。 | [可靠执行](/zh-hans/guide/learn/reliable-execution) |
| 报告器与报告文件 | 顶层 `reporters` 是项目的默认报告器列表；项目提供自己的 `reporters` 后，会替换该列表。`--report-out` 将报告写入指定目录，`--json` 只改变标准输出格式。 | [报告与比较](/zh-hans/guide/learn/reports-and-comparisons) |
| OpenTelemetry | `reporting.openTelemetry` 控制运行期间的 OpenTelemetry span 和运行结束回调。`--report-out` 生成的本地报告事件与 OTLP 结构文件不受该选项控制。 | [报告与比较](/zh-hans/guide/learn/reports-and-comparisons) |

## 继承和覆盖

不同配置项采用不同的继承规则：

- 顶层 `concurrency.workspace` 只控制工作区并发。顶层 `concurrency` 中的 `project`、`task`、`attempt` 和 `case` 会成为各项目的默认值。项目可以逐项覆盖，未设置的值继续使用顶层配置。
- 顶层 `models` 和 `reporters` 是项目的默认列表。项目一旦提供同名数组，就会替换顶层列表，而不是与之合并。
- `runMatrix` 和 `evalMatrix` 按「项目 → 评测 → 任务」的顺序处理。每一层可以通过 `extend`、`override` 或 `disable` 调整上一层的矩阵。
- 顶层插件按声明顺序修改整个配置。项目插件只修改对应项目的配置。

只有类型定义明确列出的配置项才能在相应层级使用。上述继承关系不代表同一个字段可以写在任意层级。

## CLI 参数

运行时常用的配置相关参数包括：

- `--config` 指定配置文件。
- `--project` 选择要运行的项目。
- 工作区、项目和任务的并发参数设置运行时上限；尝试和用例的并发参数覆盖配置值。
- `--workspace`、`--experiment` 和 `--attempt` 设置报告中的标识。
- `--json` 改变标准输出格式，`--report-out` 将报告写入目录。

这些参数只影响对应命令，不能用于随意覆盖配置文件中的其他字段。

配置相关的公开类型和辅助函数见 [API](/zh-hans/api/)。
