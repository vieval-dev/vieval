# API

Vieval 提供以下公开导入路径。编写普通评测时，通常只需从 `vieval` 导入；需要自定义断言、执行流程或集成方式时，再选择相应的专用入口。

## 编写评测

| 导入路径 | 提供的功能 |
| --- | --- |
| `vieval` | 用于编写评测文件和 CLI 配置的常用 API，包括 `describeTask`、`describeEval`、`caseOf`、`casesFromInputs`、`defineConfig`、`loadEnv`、`requiredEnvFrom`，以及已安装 Vieval 匹配器（matcher）的 `expect`。 |
| `vieval/expect` | 仅导出已安装 Vieval 匹配器的 `expect`。不需要任务 DSL 时，可以使用此入口。 |
| `vieval/core/assertions` | 创建和执行结构化断言，并将断言结果转换为供运行器使用的分数。常用导出包括 `evaluateAssertions`、`expectRubric` 和 `toRunScores`。 |

从 `vieval/core/assertions` 获得的断言结果不会自动写入任务的用例结果。调用方需要自行执行断言，并将结果传给 `toRunScores` 等后续处理函数。相关用法见[任务、用例与输入](/zh-hans/guide/learn/tasks-cases-and-inputs)和[断言、分数与指标](/zh-hans/guide/learn/assertions-scores-and-metrics)。

## 配置模型和执行器

| 导入路径 | 提供的功能 |
| --- | --- |
| `vieval/config` | 提供配置相关类型、插件契约，以及用于定义评测和任务对象的辅助函数，包括 `defineEval`、`defineTask` 和 `resolveModelByName`。CLI 配置文件使用的 `defineConfig` 和 `loadEnv` 从 `vieval` 导入。 |
| `vieval/plugins/chat-models` | 定义聊天模型和提供方，并根据评测矩阵或运行矩阵选择模型。常用导出包括 `chatModelFrom`、`ChatModels`、`ChatProviders`、`modelFromEval`、`modelFromMatrix` 和 `modelFromRun`。 |
| `vieval/core/inference-executors` | 创建提供方适配器、重试策略和 OpenAI 兼容客户端。常用导出包括 `createProviderAdapter`、`createRetryPolicy` 和 `createOpenAIFromEnv`。 |

[配置](/zh-hans/config/)介绍配置文件的查找方式和各类配置项；[模型与推理执行器](/zh-hans/guide/learn/models-and-inference-executors)说明如何注册、选择和调用模型。

## 自定义执行流程

如果需要将 CLI 嵌入其他工具，或自行组织执行流程，可以使用下列入口。普通评测文件通常不需要使用这些入口。

| 导入路径 | 提供的功能 |
| --- | --- |
| `vieval/cli` | 解析顶层 CLI 参数并分派命令，导出 `parseTopLevelCliArguments` 和 `runTopLevelCli`。 |
| `vieval/core/runner` | 收集评测、生成调度任务、执行任务并汇总结果。常用导出包括 `collectEvalEntries`、`createRunnerSchedule`、`runScheduledTasks` 和 `aggregateRunResults`。 |
| `vieval/core/scheduler` | 分别控制工作区、项目、任务、尝试和用例的并发数，导出 `createSchedulerRuntime` 和 `getActiveScopes`。 |
| `vieval/core/processors/results` | 处理运行结果并执行内置的结果判定策略，导出 `processRunResults` 和 `ResultGateDecision`。 |

如果需要自行组织运行器、调度器、重试和缓存逻辑，请先阅读[可靠执行](/zh-hans/guide/learn/reliable-execution)。结果汇总、判定和报告文件的关系见[报告与比较](/zh-hans/guide/learn/reports-and-comparisons)。

## 安装自定义匹配器

| 导入路径 | 提供的功能 |
| --- | --- |
| `vieval/testing/expect-extensions` | 为现有的 Vitest `expect` 显式安装 Vieval 匹配器，导出 `installVievalExpectMatchers`，以及 `KeywordMatcherOptions` 和 `ToolCallContainer` 类型。 |

从 `vieval` 或 `vieval/expect` 导入的 `expect` 已安装 Vieval 匹配器。只有需要把匹配器安装到现有 Vitest `expect` 的集成代码，才需要调用 `installVievalExpectMatchers()`。
