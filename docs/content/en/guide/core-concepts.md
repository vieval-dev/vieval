---
title: Core Concepts
prev:
  text: Getting Started
  link: /en/guide/getting-started
next:
  text: Tasks, Cases, and Inputs
  link: /en/guide/learn/tasks-cases-and-inputs
---

# Core Concepts

Vieval organizes evaluation work into a small set of nested concepts. The following lifecycle is the map for the rest of the guide:

```text
comparison -> workspace -> project

project
  -> task <-> run matrix + eval matrix
    -> case -> assertion / score / metric evidence

task -> attempt -> retry

run --json -> machine-readable stdout
run -> report artifacts (.vieval/reports by default) -> analyze / compare
```

A **workspace** is a config that lists `projects`, inline or collected from other configs such as `packages/*`. A **comparison** is a config that lists `workspaces` and runs each one in its own process, side by side. A **project** defines a discovery boundary and project-level configuration. A discovered eval definition may carry a **task**, while DSL definitions such as `describeTask` register tasks directly. Matrix rows expand the registered tasks into concrete scheduled work. A task contains one or more **cases**, where assertions, normalized scores, and custom metrics provide execution evidence.

Execution reliability has two scopes. An **attempt** reruns a full task and retains the evidence from every attempt. A **retry** lets a failed case run again within an attempt. Output is explicit: `--json` prints a machine-readable result to standard output, and every run writes the report artifacts consumed by analysis and comparison commands, by default to `.vieval/reports` next to the config. `--report-out <directory>` changes that root and `--no-report` turns reports off.

| Concept | Responsibility | Typical scope |
| --- | --- | --- |
| Comparison | Lists workspaces, runs each in its own process, and prints a leaderboard | Several implementations of one benchmark |
| Workspace | Lists projects, schedules them in one process, and provides their env | One repository or monorepo root |
| Project | Defines discovery, configuration, executors, and matrix defaults | One product area or evaluation suite |
| Task | Describes evaluation behavior and connects run/eval matrix selections | One behavior evaluated across variants |
| Case | Executes one input or scenario and emits assertion, score, and metric evidence | One check within a task |
| Run matrix | Expands execution-side choices such as models or scenarios | Project, eval, or task definition |
| Eval matrix | Expands evaluation-side choices such as rubrics | Project, eval, or task definition |
| Attempt | Repeats the complete task to measure reliability | One scheduled task |
| Retry | Re-executes a failed case inside an attempt | One case execution |
| Report artifacts | Preserve run summaries, events, and case evidence; written unless `--no-report` is used | One project run and its report directory |
| Analysis and comparison | Read artifacts to inspect results or compare runs and methods | One or more report artifact sets |

Next, learn how to author [Tasks, Cases, and Inputs](/en/guide/learn/tasks-cases-and-inputs).
