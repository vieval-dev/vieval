# 配置

Vieval 配置应放在拥有评测的仓库或包中。`vieval run` 从命令的工作目录开始，逐级向上查找最近的可读配置文件，支持 `vieval.config.ts`、`.mts`、`.cts`、`.js`、`.mjs`、`.cjs` 和 `.json`。也可以通过 `--config <path>` 显式选择文件；相对路径以命令的工作目录为基准解析。

配置文件所在目录是项目相对 `root` 的解析基准。每个项目的 `include` 和 `exclude` 随后在该项目根目录中匹配。一个配置描述多个项目时，这条规则可以让评测发现范围仍由各项目明确负责。

## 配置领域

| 领域 | 包含的内容 | 延伸阅读 |
| --- | --- | --- |
| 加载与环境变量 | 配置发现或 `--config` 选择、`defineConfig` 和顶层 `env`。Vieval 不会自动读取 `.env*` 文件；需要这些值时，应在配置文件中显式调用 `loadEnv`。 | [模型与推理执行器](/zh-hans/guide/learn/models-and-inference-executors) |
| 项目与模式 | 项目名称、根目录、发现规则、执行器和项目级设置。顶层 `projects`、`workspaces` 与 `comparisons` 互斥：`run` 接受项目模式，并会在当前实现中把每个工作区 `{ id, root }` 映射为一个项目边界；`compare` 使用比较模式。工作区模式不会增加一层嵌套编排。 | [核心概念](/zh-hans/guide/core-concepts) |
| 插件与模型 | 顶层或项目级配置插件、模型注册、提供方元数据、别名和项目模型覆盖。注册只会让任务代码能够找到模型，不会自行发起推理请求。 | [模型与推理执行器](/zh-hans/guide/learn/models-and-inference-executors) |
| 运行与评测矩阵 | 项目的 `runMatrix`、`evalMatrix`，以及评测级和任务级矩阵如何扩展、覆盖或禁用轴。矩阵展开负责调度不同变量组合，各选择值的实际行为仍由任务代码决定。 | [矩阵与数据集](/zh-hans/guide/learn/matrices-and-datasets) |
| 执行策略与并发 | 项目调度上限，以及任务和用例的尝试、重试、超时与并发控制。`vieval run` 的并发参数会在各自已记录的范围中作为运行时覆盖或上限；`--attempt` 只为报告制品添加标识，不会配置自动尝试次数。 | [可靠执行](/zh-hans/guide/learn/reliable-execution) |
| 缓存 | 任务缓存通过 `TaskRunContext` 注入，不是通用的顶层缓存配置块。CLI 执行会把项目缓存放在项目根目录下的 `.vieval/cache`；比较模式可以选择共享的评测基准缓存命名空间。 | [可靠执行](/zh-hans/guide/learn/reliable-execution) |
| 报告器与制品 | 顶层报告器会由项目继承，除非项目提供自己的列表。本地报告制品通过运行参数 `--report-out` 启用；`--json` 只改变标准输出，不会创建制品。 | [报告与比较](/zh-hans/guide/learn/reports-and-comparisons) |
| 遥测 | `reporting.openTelemetry` 控制运行时 OpenTelemetry span 及运行结束回调。`--report-out` 生成的本地报告器事件和 OTLP 结构文件不依赖这个开关。 | [报告与比较](/zh-hans/guide/learn/reports-and-comparisons) |

## 作用域与优先级

配置只会在类型定义和运行时明确支持的范围中继承。顶层 `concurrency.workspace` 只控制工作区调度。对于 `project`、`task`、`attempt` 和 `case`，顶层的各个并发值会成为项目默认值；项目可以逐字段覆盖，未提供的字段继续继承顶层值。模型和报告器的规则不同：顶层数组为项目提供默认列表，但项目一旦提供数组，就会整表替换继承列表。矩阵层使用独立的「项目 → 评测 → 任务」解析规则。插件可以转换顶层配置，项目级插件则针对项目作用域内的配置视图运行。这些规则不表示每个字段都能出现在所有作用域。

运行命令可以用 `--project` 选择项目、用 `--config` 选择配置文件、限制或覆盖已记录的并发范围，用 `--workspace`、`--experiment` 和 `--attempt` 组织报告标识，并通过 `--json` 与 `--report-out` 选择输出行为。这些参数是命令专用的运行时输入，不是任意配置字段的通用覆盖机制。

每个已记录字段都按 **类型 → 默认值 → 作用域 → CLI 覆盖 → 行为 → 示例 → 交互关系** 说明。某一步不适用于该字段时，参考文档会明确标注，不推测默认值或覆盖方式。

配置相关的导出类型与辅助函数可以在 [API 导览](/zh-hans/api/)中查阅。
