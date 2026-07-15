# API

Vieval 按职责拆分多个公开入口，应用代码可以按需选择范围最小的导入路径。包中的 `.` 导出对应 `vieval`；其余当前导出均在下文以实际发布的导入路径列出。

## 常用编写入口

| 导入路径 | 何时导入 |
| --- | --- |
| `vieval` | 编写评测文件或配置，并使用任务 DSL、配置辅助函数及已安装 Vieval matcher 的 `expect`；代表性导出包括 `describeTask`、`defineConfig` 和 `expect`。 |
| `vieval/core/assertions` | 构建并执行结构化断言管线，再把结果转换成 runner 分数；代表性导出包括 `evaluateAssertions`、`expectRubric` 和 `toRunScores`。 |
| `vieval/expect` | 只需导入已安装 Vieval matcher 的独立 `expect`，且不需要导入主入口中的其他常用编写 API。 |

可以先阅读[任务、用例与输入](/zh-hans/guide/learn/tasks-cases-and-inputs)和[断言、分数与指标](/zh-hans/guide/learn/assertions-scores-and-metrics)。任务 DSL 与结构化核心断言管线都是公开 API，但 `vieval/core/assertions` 返回的结果不会自动接入任务用例。

## 配置与集成

| 导入路径 | 何时导入 |
| --- | --- |
| `vieval/config` | 定义带类型的评测或任务对象，并使用配置所属的契约；代表性导出包括 `defineEval`、`defineTask` 和 `resolveModelByName`，面向 CLI 配置的 `defineConfig` 与 `loadEnv` 仍由 `vieval` 提供。 |
| `vieval/plugins/chat-models` | 注册聊天模型并解析矩阵选择；代表性导出包括 `chatModelFrom`、`ChatModels` 和 `modelFromRun`。 |

[配置导览](/zh-hans/config/)说明配置文件归属与作用域；[模型与推理执行器](/zh-hans/guide/learn/models-and-inference-executors)说明模型注册、选择与实际调用之间的边界。

## 高级执行与处理

这些入口用于需要自行组装或驱动执行流程的宿主程序，属于公开的集成 API；大多数评测编写者不需要直接导入它们。

| 导入路径 | 何时导入 |
| --- | --- |
| `vieval/cli` | 通过 `parseTopLevelCliArguments` 和 `runTopLevelCli` 嵌入可安全导入的顶层 CLI 参数解析与命令分派。 |
| `vieval/core/runner` | 通过 `collectEvalEntries`、`createRunnerSchedule` 和 `runScheduledTasks` 自行组合收集、调度与执行。 |
| `vieval/core/scheduler` | 不引入 runner 收集 API，直接通过 `createSchedulerRuntime` 和 `getActiveScopes` 组织带作用域的并发。 |
| `vieval/core/processors/results` | 通过 `processRunResults` 应用内置结果策略，并使用 `ResultGateDecision` 类型读取门禁判定。 |
| `vieval/core/inference-executors` | 通过 `createProviderAdapter`、`createRetryPolicy` 和 `createOpenAIFromEnv` 构建自定义推理集成。 |

自行组合 runner、scheduler、重试或缓存行为前，请先阅读[可靠执行](/zh-hans/guide/learn/reliable-execution)。聚合、门禁与持久化证据的关系见[报告与比较](/zh-hans/guide/learn/reports-and-comparisons)。

## 测试支持

| 导入路径 | 何时导入 |
| --- | --- |
| `vieval/testing/expect-extensions` | 通过 `installVievalExpectMatchers` 显式安装 Vieval 自定义 matcher，或使用 `KeywordMatcherOptions` 与 `ToolCallContainer` 类型。 |

从主入口 `vieval` 导入的 `expect` 和从 `vieval/expect` 导入的 `expect` 都已安装 Vieval matcher；前者便于与任务 DSL 一起使用，后者是范围更集中的断言入口。`vieval/testing/expect-extensions` 导出安装函数而不是 `expect` 值，因此只有集成方式需要显式安装时，才调用 `installVievalExpectMatchers()`。
