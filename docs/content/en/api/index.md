# API

Vieval publishes focused entrypoints so application code can import the narrowest supported surface for its job. The package's `.` export is imported as `vieval`; every other current export is listed below by its published import path.

## Common authoring

| Import | Import when |
| --- | --- |
| `vieval` | Author eval files or config with the task DSL, config helpers, and the preconfigured assertion API; representative imports are `describeTask`, `defineConfig`, and `expect`. |
| `vieval/core/assertions` | Build and evaluate structured assertion pipelines and convert their outcomes into runner scores with exports such as `evaluateAssertions`, `expectRubric`, and `toRunScores`. |
| `vieval/expect` | Import the standalone `expect` with Vieval matchers pre-installed without importing the rest of the main authoring surface. |

Start with [Tasks, Cases, and Inputs](/en/guide/learn/tasks-cases-and-inputs) and [Assertions, Scores, and Metrics](/en/guide/learn/assertions-scores-and-metrics). The task DSL and the structured core assertion pipeline are both public, but outcomes from `vieval/core/assertions` are not connected to task cases automatically.

## Config and integration

| Import | Import when |
| --- | --- |
| `vieval/config` | Define typed eval or task objects and work with config-owned contracts through exports such as `defineEval`, `defineTask`, and `resolveModelByName`; the CLI-facing `defineConfig` and `loadEnv` helpers remain on `vieval`. |
| `vieval/plugins/chat-models` | Register chat models and resolve matrix selections with exports such as `chatModelFrom`, `ChatModels`, and `modelFromRun`. |

Use the [Config map](/en/config/) for file ownership and scope, and [Models and Inference Executors](/en/guide/learn/models-and-inference-executors) for the boundary between registration, selection, and an actual model call.

## Advanced execution and processing

These are public integration surfaces for hosts that need to assemble or drive execution directly. Most eval authors do not need them.

| Import | Import when |
| --- | --- |
| `vieval/cli` | Embed the import-safe top-level CLI parser and command dispatcher through `parseTopLevelCliArguments` and `runTopLevelCli`. |
| `vieval/core/runner` | Assemble collection, scheduling, and execution directly with exports such as `collectEvalEntries`, `createRunnerSchedule`, and `runScheduledTasks`. |
| `vieval/core/scheduler` | Construct scoped concurrency coordination without the runner's collection APIs by using `createSchedulerRuntime` and `getActiveScopes`. |
| `vieval/core/processors/results` | Apply built-in result policies and inspect the gate through `processRunResults` and the `ResultGateDecision` type. |
| `vieval/core/inference-executors` | Build custom inference integrations with exports such as `createProviderAdapter`, `createRetryPolicy`, and `createOpenAIFromEnv`. |

Read [Reliable Execution](/en/guide/learn/reliable-execution) before composing runner, scheduler, retry, or cache behavior. For aggregation, gating, and persisted evidence, continue with [Reports and Comparisons](/en/guide/learn/reports-and-comparisons).

## Testing support

| Import | Import when |
| --- | --- |
| `vieval/testing/expect-extensions` | Explicitly install Vieval's custom matchers or consume their supporting types through `installVievalExpectMatchers`, `KeywordMatcherOptions`, and `ToolCallContainer`. |

`expect` from the main `vieval` entrypoint and `expect` from `vieval/expect` both arrive with Vieval's matchers installed; the main entrypoint is convenient beside the task DSL, while the subpath is the focused assertion import. `vieval/testing/expect-extensions` exports the installer rather than an `expect` value, so call `installVievalExpectMatchers()` only when explicit installation is the integration you need.
