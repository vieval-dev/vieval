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

## Set concurrency where the work is shared

Concurrency is scheduler configuration, not an inherited default: the top-level config and each project declare it under `scheduler.concurrency`, next to scheduler middleware. Each concurrency value is a pool of slots. The place where you write the value decides which work shares the pool, and the key decides what the pool counts.

| Key | Counts |
| --- | --- |
| `project` | projects running at once |
| `task` | scheduled tasks running at once |
| `case` | case executions running at once |

| Declared in | Keys | Shared by |
| --- | --- | --- |
| Top-level `scheduler.concurrency`; `--project-concurrency`, `--task-concurrency`, `--case-concurrency` | `project`, `task`, `case` | the whole run |
| Project `scheduler.concurrency` | `task`, `case` | the tasks and cases of that project |
| `describeTask(..., { concurrency: { case } })` | `case` | the cases of that task, across all of its case groups |
| `casesFromInputs(..., { concurrency })` | a number | the cases of that group |

A case starts only after it holds a slot in every pool on its path: its group, its task, its project, and the run. Pools do not override each other, so the smallest one wins, and a narrower value can only lower concurrency for its own work. A case waits for its narrow pools before it takes a run-wide slot, and its timeout starts only after it holds every slot.

A top-level value and a CLI flag for the same key both bound the whole run, so the smaller value applies. A flag never raises a configured value, but it can raise a built-in default. Without any declaration, one project runs at a time, each project runs one task at a time, and cases are not limited. A run-wide `task` or `case` value lifts the one-task-per-project default: a run-wide case pool already bounds the real work, so tasks overlap and a slow case of one task no longer holds back the next task.

```ts [vieval.config.ts]
import { defineConfig } from 'vieval'

export default defineConfig({
  projects: [
    {
      include: ['evals/*.eval.ts'],
      name: 'desktop-agent',
      root: '.',
    },
  ],
  // At most 7 cases in the whole run, for example because every case owns one VM.
  scheduler: {
    concurrency: {
      case: 7,
      task: 4,
    },
  },
})
```

Because the case pool belongs to the run, the work can be split into one task per domain: up to four tasks overlap, and together they never run more than seven cases. `task` can be left out here; the run-wide case pool alone lets every task start.

A task and one of its case groups can narrow concurrency further for their own cases:

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

Here the three queries share a group pool of `2`, inside the task pool of `4`, inside any project and run pools. `--case-concurrency 1` would bound the whole run to one case.

Scheduler middleware can wrap every admitted project, task, and case, for example to record admission telemetry or to hold work behind a dynamic gate. Declare it next to the pools, with `scheduler: { middleware: [...] }` at the top level or on a project. Middleware runs after the unit holds all of its slots, and top-level middleware wraps project middleware.

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
- `cases.jsonl` is a final normalized projection keyed by task and case, so repeated retries or automatic attempts do not become independent case rows. For a task with automatic attempts, the record lists every attempt in `attempts`. Read raw events when the exact sequence matters (`case.started` and `case.ended` carry `attemptIndex`), and read the task aggregate in `run-summary.json` when attempt-weighted scoring matters.

As described in [Assertions, Scores, and Metrics](/en/guide/learn/assertions-scores-and-metrics), a score event emitted before a later failure can remain in a persisted case record even though task aggregation counts that outcome as a failure. Diagnose state and score together.

A common failure is using `autoRetry` to estimate reliability: the recovered case appears as one passing attempt. Use `autoAttempt` when earlier failures should remain in the aggregate, and remember that it reruns cases that already passed. Also avoid treating `--attempt` as a request for more automatic attempts: it only labels the run.

Next, retain and inspect this evidence in [Reports and Comparisons](/en/guide/learn/reports-and-comparisons).
