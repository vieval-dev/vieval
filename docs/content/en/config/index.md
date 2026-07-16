# Config

Vieval configuration belongs to the repository or package that owns the evaluations. `vieval run` starts at the command's working directory and uses the nearest readable `vieval.config.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`, or `.json`, searching upward through parent directories. Pass `--config <path>` to select a file explicitly; a relative path is resolved from the command's working directory.

The config file's directory becomes the base for relative project roots. Each project's `include` and `exclude` patterns are then evaluated within that project root. This keeps discovery ownership explicit when one config describes more than one project.

## Configuration domains

| Domain | What belongs here | Learn more |
| --- | --- | --- |
| Loading and environment | Config discovery or `--config` selection, `defineConfig`, and top-level `env`. Vieval does not load `.env*` files automatically; when those values are needed, call `loadEnv` explicitly from the config file. | [Models and Inference Executors](/en/guide/learn/models-and-inference-executors) |
| Projects and modes | Project names, roots, discovery patterns, executors, and project-scoped settings. Top-level `projects`, `workspaces`, and `comparisons` are mutually exclusive: `run` accepts project mode and currently maps each workspace `{ id, root }` to a project boundary, while `compare` owns comparison mode. Workspace mode does not add another nested orchestration layer. | [Core Concepts](/en/guide/core-concepts) |
| Plugins and models | Top-level or project-local config plugins, model registrations, provider metadata, aliases, and project model overrides. A registration makes a model available to task code; it does not make an inference request by itself. | [Models and Inference Executors](/en/guide/learn/models-and-inference-executors) |
| Run and eval matrices | Project `runMatrix` and `evalMatrix` definitions, plus how eval- and task-level layers extend, override, or disable axes. Matrix expansion schedules variants; task code decides what each selected value does. | [Matrices and Datasets](/en/guide/learn/matrices-and-datasets) |
| Execution policy and concurrency | Project scheduling caps and the task/case attempt, retry, timeout, and concurrency controls that bound execution. The `vieval run` concurrency flags are runtime overrides or caps at their documented scopes; `--attempt` labels report artifacts and does not configure automatic attempts. | [Reliable Execution](/en/guide/learn/reliable-execution) |
| Cache | The task cache is injected through `TaskRunContext`, not declared as a general top-level cache block. CLI runs place project cache data under `.vieval/cache` inside the project root; comparison mode can select a shared benchmark cache namespace. | [Reliable Execution](/en/guide/learn/reliable-execution) |
| Reporters and artifacts | Top-level reporters are inherited by projects unless a project supplies its own list. Local report artifacts are enabled at run time with `--report-out`; `--json` changes standard output and does not create artifacts. | [Reports and Comparisons](/en/guide/learn/reports-and-comparisons) |
| Telemetry | `reporting.openTelemetry` controls runtime OpenTelemetry spans and an end-of-run lifecycle callback. Local reporter events and the OTLP-shaped files produced by `--report-out` do not depend on that switch. | [Reports and Comparisons](/en/guide/learn/reports-and-comparisons) |

## Scope and precedence

Configuration only inherits where the owning types and runtime define inheritance. Top-level `concurrency.workspace` controls workspace scheduling only. For `project`, `task`, `attempt`, and `case`, each top-level concurrency value becomes the project default; a project can override each field independently, and any field it omits continues to inherit the top-level value. Models and reporters behave differently: their top-level arrays feed project defaults, but a project-provided array replaces the complete inherited list. Matrix layers have their own project → eval → task resolution rules. Plugins may transform top-level config, while project-local plugins run against a project-scoped config view. These rules do not imply that every field is available at every scope.

The run command can select projects with `--project`, select a config with `--config`, cap or override the documented concurrency scopes, label report organization with `--workspace`, `--experiment`, and `--attempt`, and choose output behavior with `--json` and `--report-out`. Treat these as command-specific runtime inputs rather than a generic override mechanism for arbitrary config fields.

Each documented field records **Type → Default → Scope → CLI override → Behavior → Example → Interactions**. When a step does not apply to that field, the reference states that explicitly instead of inferring a value or an override.

For the exported config types and helpers, see the [API map](/en/api/).
