# 配置

Vieval 会从执行命令时的工作目录开始逐级向上查找最近的 `vieval.config.*` 文件。支持的扩展名包括 `.ts`、`.mts`、`.cts`、`.js`、`.mjs`、`.cjs` 和 `.json`。使用 `--config <path>` 可以显式指定配置文件；相对路径以执行命令时的工作目录为基准。

配置文件所在的目录是默认根目录。项目没有设置 `root` 时，Vieval 会相对于该目录匹配 `include` 和 `exclude`；设置 `root` 后，则改为相对于项目根目录匹配。

## 配置内容

| 配置项 | 说明 | 延伸阅读 |
| --- | --- | --- |
| 环境变量 | 顶层 `env` 会在 `vieval run` 期间临时写入 `process.env`，运行结束后恢复原值。Vieval 不会自动读取 `.env*` 文件；如需读取，请在配置文件中从 `vieval` 导入并调用 `loadEnv`。 | [模型与推理执行器](/zh-hans/guide/learn/models-and-inference-executors) |
| 工作区与项目 | 列出 `projects` 的配置就是一个工作区。每一项可以是内联的项目（名称、根目录、评测文件匹配规则、矩阵、模型、执行器、插件、报告器和 `scheduler`），也可以引用其他配置：路径或 glob 字符串（如 `'packages/*'`），或 `{ from, env?, scheduler? }`。被收集的项目按自己的配置加载。同一工作区内的项目名不能重复。未提供 `projects` 时，Vieval 使用名为 `default` 的项目。 | [核心概念](/zh-hans/guide/core-concepts) |
| 比较 | 列出 `workspaces` 的配置就是一个比较：`defineConfig({ id?, workspaces, cache?, env?, concurrency?: { workspace? } })`。`vieval run` 会为每个工作区启动一个独立进程。比较配置中没有模型、插件和报告器。同一个配置不能同时使用 `projects` 和 `workspaces`。 | [报告与比较](/zh-hans/guide/learn/reports-and-comparisons) |
| 插件与模型 | 顶层和项目级均可配置插件与模型。配置模型只会将模型加入该项目的可用模型列表；任务代码仍需主动选择并调用模型。 | [模型与推理执行器](/zh-hans/guide/learn/models-and-inference-executors) |
| 运行矩阵与评测矩阵 | 项目可通过 `runMatrix` 和 `evalMatrix` 定义变量组合。评测和任务还可以继续扩展、替换或禁用矩阵维度。Vieval 根据组合生成待执行任务，任务代码负责使用各维度的取值。 | [矩阵与数据集](/zh-hans/guide/learn/matrices-and-datasets) |
| 并发与执行策略 | `scheduler.concurrency` 声明项目、任务和用例的槽位池，写在哪里就由哪些工作共用：顶层配置和 CLI 参数作用于整个运行，项目、任务和用例组只能为自己的工作调低并发。`scheduler.middleware` 可以包住每个被放行的项目、任务和用例。任务和用例还可以设置尝试次数、自动重试和超时。`--attempt` 仅设置报告中的尝试标识，不会改变自动尝试次数。 | [可靠执行](/zh-hans/guide/learn/reliable-execution) |
| 缓存 | 任务通过 `TaskRunContext` 使用缓存。CLI 默认将项目缓存写入项目根目录下的 `.vieval/cache`。比较配置中的 `cache: { namespace }` 会让所有工作区共用比较配置旁边的 `.vieval/cache/<比较 ID>/<namespace>/`。 | [可靠执行](/zh-hans/guide/learn/reliable-execution) |
| 报告器与报告文件 | 顶层 `reporters` 是项目的默认报告器列表；项目提供自己的 `reporters` 后，会替换该列表。`vieval run` 默认把报告写入配置文件旁边的 `.vieval/reports`；`--report-out` 修改报告根目录，`--no-report` 关闭报告。`--json` 只改变标准输出格式。 | [报告与比较](/zh-hans/guide/learn/reports-and-comparisons) |
| OpenTelemetry | `reporting.openTelemetry` 控制运行期间的 OpenTelemetry span 和运行结束回调。报告目录中的本地事件与 OTLP 结构文件不受该选项控制。 | [报告与比较](/zh-hans/guide/learn/reports-and-comparisons) |

## 继承和覆盖

不同配置项采用不同的继承规则：

- 顶层 `scheduler` 不会被项目继承：`scheduler.concurrency` 声明的是整个运行共用的池，项目的 `scheduler.concurrency` 另外声明只属于该项目的 `task` 和 `case` 池，工作要同时满足两者。顶层 `scheduler.middleware` 包在项目 `scheduler.middleware` 外面。
- 顶层 `models` 和 `reporters` 是项目的默认列表。项目一旦提供同名数组，就会替换顶层列表，而不是与之合并。
- `runMatrix` 和 `evalMatrix` 按「项目 → 评测 → 任务」的顺序处理。每一层可以通过 `extend`、`override` 或 `disable` 调整上一层的矩阵。
- 顶层插件按声明顺序修改整个配置。项目插件只修改对应项目的配置。
- 工作区的 `env`、`scheduler` 和 `reporting` 作用于整个工作区。环境变量在整个进程中共享：工作区的 `env`、每个被引用配置的 `env` 和引用项上的 `env` 会合并，同一个键出现两个不同的值时会报错。引用项上的 `scheduler` 会替换被收集项目的调度设置。
- 在比较中，比较配置的 `env`（以及单个工作区条目的 `env`）优先于各工作区配置的 `env`，并在工作区插件运行之前生效。

只有类型定义明确列出的配置项才能在相应层级使用。上述继承关系不代表同一个字段可以写在任意层级。

## CLI 参数

运行时常用的配置相关参数包括：

- `--config` 指定配置文件。
- `--workspace`（仅用于比较）、`--project`、`--task` 和 `--case` 选择要运行的工作区、项目、任务和用例。
- `--workspace-concurrency`、`--project-concurrency`、`--task-concurrency` 和 `--case-concurrency` 设置整个运行的并发上限，不会调高配置中写明的值。
- `--experiment` 和 `--attempt` 设置报告中的标识。
- `--resume [attemptId]` 继续之前的某次尝试（默认最近一次）：作为一次新的尝试，只运行其中没有结果的用例。
- `--json` 改变标准输出格式，`--report-out` 修改报告根目录，`--no-report` 关闭报告。

这些参数只影响对应命令，不能用于随意覆盖配置文件中的其他字段。

配置相关的公开类型和辅助函数见 [API](/zh-hans/api/)。
