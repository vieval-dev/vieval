---
title: Reliable Execution
prev:
  text: Matrices and Datasets
  link: /en/guide/learn/matrices-and-datasets
next:
  text: Reports and Comparisons
  link: /en/guide/learn/reports-and-comparisons
---

# Reliable Execution

Reliable evaluation requires two different controls: repeat enough work to measure nondeterminism, and bound enough work to protect the service being evaluated. Vieval exposes attempts, retries, timeouts, concurrency limits, and a task cache for those purposes.

## Read the execution hierarchy

A scheduled task contains registered cases. When `autoAttempt` is enabled, Vieval runs the complete case set as one attempt, waits for every case to settle, and starts another attempt only if an eligible case still failed or timed out. Each case execution may make an initial try followed by `autoRetry` retries.

```text
scheduled task
  -> attempt 0
       -> case A: initial try -> retry 1 -> retry 2
       -> case B: initial try
  -> attempt 1, only if an eligible case still failed
       -> case A: initial try ...
       -> case B: initial try ...
```

Cases within an attempt may run concurrently. Attempts created by `autoAttempt` are currently sequential, and a later attempt reruns every registered case, including cases that passed previously. The next attempt begins only after the current case set has settled.

The `--attempt` CLI flag is related but distinct: it assigns an `attemptId` to the whole run for report organization. It does not set `autoAttempt` or the number of task attempts.

## Set concurrency at the scope that owns the work

`vieval run` accepts five concurrency names, but the current runtime does not use all of them as parallel queues in the same way.

| Scope | What it limits today | Where it can be set |
| --- | --- | --- |
| Workspace | Projects admitted concurrently within one CLI run. The default effective cap is `1`. | Top-level `concurrency.workspace`; `--workspace-concurrency` |
| Project | An upper bound combined with the task cap when scheduled tasks run inside a project. | Top-level or project `concurrency.project`; `--project-concurrency` |
| Task | Concurrent scheduled tasks inside a project. The default effective cap is `1`. | Top-level or project `concurrency.task`; `--task-concurrency` |
| Attempt | Attempt concurrency metadata on config, projects, and tasks. `autoAttempt` execution is sequential today, so this does not make automatic attempts overlap. | Top-level, project, or task `concurrency.attempt`; `--attempt-concurrency` |
| Case | Concurrent DSL cases. A `casesFromInputs` group can have its own queue; otherwise cases share the task queue. | Top-level, project, or task `concurrency.case`; `casesFromInputs(..., { concurrency })`; `--case-concurrency` |

For workspace, project, and task scheduling, a CLI value acts as a cap: it cannot raise a lower configured value. For attempt and case settings, the CLI runtime value takes precedence over task and project values. Project config cannot declare `workspace`, and task config contains only `attempt` and `case`.

```ts [vieval.config.ts]
import { defineConfig } from 'vieval'

export default defineConfig({
  concurrency: {
    workspace: 1,
  },
  projects: [
    {
      concurrency: {
        case: 4,
        project: 2,
        task: 2,
      },
      include: ['evals/*.eval.ts'],
      name: 'chat-evals',
      root: '.',
    },
  ],
})
```

A task can narrow case concurrency, and one generated case group can narrow it again:

```ts [evals/retrieval.eval.ts]
import { describeTask } from 'vieval'

describeTask('retrieval', ({ casesFromInputs }) => {
  casesFromInputs('query', ['alpha', 'beta', 'gamma'], async ({ matrix }) => {
    await evaluateQuery(matrix.inputs)
  }, {
    concurrency: 2,
  })
}, {
  concurrency: {
    case: 4,
  },
})
```

Here the group limit of `2` applies unless `--case-concurrency` supplies a runtime override.

::: warning Concurrency multiplies real calls only when task code makes them
Matrices, inference-executor registrations, and concurrency settings do not call a provider by themselves. If cases do invoke a model or another metered service, higher task or case concurrency can increase rate-limit failures and create a sudden cost spike. Choose limits from provider capacity and the number of calls each case actually makes.
:::

## Choose attempts, retries, and timeouts deliberately

Execution policies can be placed on `describeTask`, `caseOf`, or `casesFromInputs`. A case-level value overrides the task-level value.

```ts [evals/provider-health.eval.ts]
import { caseOf, describeTask, expect } from 'vieval'

describeTask('provider health', () => {
  caseOf('returns a usable answer', async ({ signal }) => {
    const answer = await requestAnswer({ signal })
    expect(answer.length).toBeGreaterThan(0)
  }, {
    autoAttempt: 1,
    autoRetry: 2,
    input: 'health-check',
    timeout: 10_000,
  })
})
```

`autoRetry: 2` permits two additional case tries after the initial failure. Retries stop at the first pass and remain part of the same attempt. The default delays are exponential: 500 ms before retry 1, then 1,000 ms before retry 2. `autoRetryDelay` can instead be a fixed non-negative number or a function of the retry index.

`autoAttempt: 1` permits one additional full task attempt. It starts only when a case still fails after its retries and that case has remaining attempts. Because the full registered case set runs again, attempt evidence includes both the earlier and later outcomes. For example, one failed attempt followed by one passing attempt contributes `0.5`, not a replacement pass of `1`.

::: tip Use repetition for the question it answers
Attempts measure nondeterministic reliability because every completed attempt contributes evidence. Retries recover transient case failures inside one attempt; a retry that eventually passes makes that attempt pass. Retries therefore hide the earlier transient failure from task scoring, although lifecycle events still record the tries. Use retries only when recovery, rather than failure frequency, is the intended measurement.
:::

`timeout` is measured separately for each case try. When it expires, Vieval marks that try as `timeout`, aborts the case's `signal`, and may proceed to a configured retry or later attempt. Cancellation is cooperative: pass the signal to downstream operations. Code that ignores it may continue external side effects after Vieval has stopped accepting its scores and metrics.

## Cache deterministic setup artifacts

Task callbacks receive a filesystem-backed cache through `context.cache`. It is an explicit file API, not automatic memoization:

```ts [evals/dataset.eval.ts]
import { describeTask } from 'vieval'

describeTask('dataset-backed eval', ({ caseOf }) => {
  caseOf('loads prepared cases', async ({ cache, signal }) => {
    const file = cache.namespace('dataset-v1').file({
      ext: 'json',
      key: ['prepared', 'source-sha256'],
    })

    if (!await file.exists()) {
      await file.writeJson(await prepareDataset({ signal }))
    }

    const cases = await file.readJson<Array<{ id: string }>>()
    await evaluatePreparedCases(cases)
  })
})
```

During a CLI run, the path is derived from the project root's `.vieval/cache`, then workspace ID, project name, namespace, key segments, and extension. The runtime sanitizes path segments and writes text, JSON, and buffers atomically. It does not hash inputs, expire entries, or decide whether cached content is still valid. Put every identity that changes the artifact into the namespace or key.

The same cache root and stable workspace/project/namespace/key resolve to the same file across task attempts and later runs. Top-level comparison runs deliberately share the project identity segment through their configured benchmark cache namespace, but methods under different project roots still use different physical `.vieval/cache` directories. Reusing one cached file also requires the same cache root.

## Know which evidence survives each layer

Task aggregation and report artifacts answer related but different questions:

- A failed or timed-out case adds exact score evidence of `0`; a passing case without a custom score adds `1`.
- A passing case contributes its custom `exact` and `judge` scores. A failed case's custom score is not used by task aggregation.
- Every completed auto attempt contributes another set of case outcomes to the task's aggregated score.
- Reporter lifecycle, score, and metric events are emitted as execution happens. With `--report-out`, `events.jsonl` retains those events.
- `cases.jsonl` is a final normalized projection keyed by task and case, so repeated retries or automatic attempts do not become independent case rows. Read raw events when the sequence matters, and read the task aggregate in `run-summary.json` when attempt-weighted scoring matters.

As described in [Assertions, Scores, and Metrics](/en/guide/learn/assertions-scores-and-metrics), a score event emitted before a later failure can remain in a persisted case record even though task aggregation counts that outcome as a failure. Diagnose state and score together.

A common failure is using `autoRetry` to estimate reliability: the recovered case appears as one passing attempt. Use `autoAttempt` when earlier failures should remain in the aggregate, and remember that it reruns cases that already passed. Also avoid treating `--attempt` or `--attempt-concurrency` as a request for more automatic attempts.

Next, retain and inspect this evidence in [Reports and Comparisons](/en/guide/learn/reports-and-comparisons).
