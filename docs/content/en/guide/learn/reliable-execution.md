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

A top-level value and a CLI flag for the same key both bound the whole run, so the smaller value applies. A flag never raises a configured value, but it can raise a built-in default. Without any declaration, one project runs at a time, each project runs one task at a time, and cases are not limited. A run-wide `task` or `case` value, in config or on the CLI, lifts both defaults: a run-wide pool already bounds the real work, so tasks and projects overlap, bounded only by those pools. A slow case of one task no longer holds back the next task, and the next project starts while a slow case of another project still runs.

A comparison runs each workspace in its own process, so every workspace keeps its own pools. `concurrency: { workspace }` in the comparison config, or `--workspace-concurrency`, limits how many workspaces run at once; by default all of them do.

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

`autoRetry: 2` permits two additional case tries after the initial failure. Retries stop at the first pass and remain part of the same attempt. By default only tries without a result (`errored` and `timeout`) run again; a failed assertion is a result, so it is not retried. The default delays are exponential: 500 ms before retry 1, then 1,000 ms before retry 2. `autoRetryDelay` can instead be a fixed non-negative number or a function of the retry index and the error of the failed try. `autoRetryIf` limits retries to the failures it accepts, so a wrong assertion fails at once instead of running again:

```ts
import { isRetriableProviderError, readRetryAfter } from 'vieval/core/inference-executors'

const providerRetry = {
  autoRetry: 3,
  // Wait for the provider's `Retry-After` when it sent one.
  autoRetryDelay: (retryIndex: number, error: unknown) => readRetryAfter(error) ?? 10_000 * 2 ** (retryIndex - 1),
  // Retry rate limits, server errors, and dropped connections only.
  autoRetryIf: isRetriableProviderError,
}
```

A case retry replays the whole case. To retry only the failed provider call, wrap that call in `runWithRetry` from `vieval/core/inference-executors`. Its default delay waits for the provider's `Retry-After` or an exponential backoff with jitter, whichever is longer, and passing `{ signal }` stops the wait when the run is interrupted.

`autoAttempt: 1` permits one additional full task attempt. It starts only when a case still fails after its retries and that case has remaining attempts. Because the full registered case set runs again, attempt evidence includes both the earlier and later outcomes. For example, one failed attempt followed by one passing attempt that records `1` gives that case a mean of `0.5` in the score, not a replacement pass of `1`.

::: tip Use repetition for the question it answers
Attempts measure nondeterministic reliability because every completed attempt contributes evidence. Retries recover transient case failures inside one attempt; a retry that eventually passes makes that attempt pass. Retries therefore hide the earlier transient failure from task scoring, although lifecycle events still record the tries. Use retries only when recovery, rather than failure frequency, is the intended measurement.
:::

`timeout` is measured separately for each case try. When it expires, Vieval marks that try as `timeout`, aborts the case's `signal`, and may proceed to a configured retry or later attempt. Cancellation is cooperative: pass the signal to downstream operations. Code that ignores it may continue external side effects after Vieval has stopped accepting its scores and metrics.

### Requeue a case that has no result yet

`autoRetry` runs a case again right away, in its slot. When a provider rate-limits, the retries often land in the
same cooldown. `requeue` sends the case to the end of the queue instead, so other cases run first and the provider has
time to recover:

```ts
describeTask('read aloud', build, {
  autoRetry: 1, // retry once right away
  requeue: 2, // then go back to the end of the queue, at most twice
  requeueDelay: 30_000, // and wait at least 30 seconds before running again
})
```

Only runs without a result (`errored`, `timeout`) are requeued; a failed assertion is a result. A requeued case gives
its slot back while it waits, and each later run gets its own `autoRetry` retries, so a case runs at most
`(1 + autoRetry) × (1 + requeue)` times. `requeueDelay` matters when few cases are left: the end of the queue may then
be next, and without a delay a requeue would be an immediate retry.

Until its last run ends, the case has not ended. It emits `case.requeued` instead of `case.ended`, the viewer shows it
as waiting to rerun (not done yet), and it does not count in scores or in the completion rate. Only the final run is scored. A case
whose retries and requeues all ran out ends `errored`; resume it later with `--resume`.

### Resume an attempt

Retries happen inside one attempt. When a provider stays down for longer, many cases end `errored` or `timeout`. Fix
the cause, then run only those cases again as a new attempt:

```sh
vieval run --config vieval.config.ts --resume
```

`--resume [attemptId]` reads the cases of that attempt of the same experiment from the reports; without an id, it
resumes the latest one. It runs every case without a result: errored, timed out, or never run because the attempt was interrupted. Cases that passed
or failed keep their result and do not run again; a task whose cases all have a result is skipped. The latest attempt is the
attempt directory of the experiment that changed last. In a comparison, it is resolved once, so every workspace
resumes the same attempt. The new run records the resumed attempt as `resumedFrom` in `run-summary.json`.

When a run ends interrupted or with cases without a result, `vieval run` prints the resume command for that attempt
by id, with the same `--config`, `--workspace`, `--project`, `--task`, and `--case` selectors, ready to copy. To find
an attempt later, run `vieval report attempts`.

Finished steps that the task cached return from the cache, so resuming sends only the calls that failed. Resuming
needs reports, because it reads the earlier attempt from them, and a new `--attempt` id (the default is a new timestamp).

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

The same cache root and stable workspace/project/namespace/key resolve to the same file across task attempts and later runs. Workspaces under different roots therefore use different `.vieval/cache` directories, unless a comparison shares one cache: with `cache: { namespace }` in the comparison config, every workspace caches under `.vieval/cache/<comparison id>/<namespace>/` next to the comparison config, so a case prepared by one workspace is reused by the others.

```ts [evals/agent-memory/vieval.config.ts]
import { defineConfig, loadEnv } from 'vieval'

export default defineConfig({
  cache: { namespace: 'locomo-cases-v1' },
  env: loadEnv('test', import.meta.dirname, ''),
  id: 'agent-memory-semantic-approaches',
  workspaces: ['eval/test-objects/*'],
})
```

## Know which evidence survives each layer

Task aggregation and report artifacts answer related but different questions:

- A failed case counts as `0` in every score of its task. An errored or timed-out case is left out of a score with `errors: 'exclude'` (the default) and counts as `0` with `errors: 'zero'`; either way it lowers the completion rate.
- A passing case contributes the values it recorded. A passing case that did not record a score is missing from that score, not counted as `1`.
- Every completed auto attempt contributes another set of case outcomes to the task's aggregated score.
- Reporter lifecycle, score, and metric events are emitted as execution happens. Unless the run uses `--no-report`, `events.jsonl` retains those events.
- `cases.jsonl` is a final normalized projection keyed by task and case, so repeated retries or automatic attempts do not become independent case rows. Its `scores` hold the counted value of each score under the same rule as the task result, so a failed case shows `0`. For a task with automatic attempts, the record lists every attempt in `attempts`. Read raw events when the exact sequence matters (`case.started` and `case.ended` carry `attemptIndex`), and read the task aggregate in `run-summary.json` when attempt-weighted scoring matters.

As described in [Assertions, Scores, and Metrics](/en/guide/learn/assertions-scores-and-metrics), a value recorded before a later failure stays in `events.jsonl` and in the case record's `scoreDetails`, but it is not counted: the case's `scores` show `0`. Diagnose state and score together.

A common failure is using `autoRetry` to estimate reliability: the recovered case appears as one passing attempt. Use `autoAttempt` when earlier failures should remain in the aggregate, and remember that it reruns cases that already passed. Also avoid treating `--attempt` as a request for more automatic attempts: it only labels the run.

Next, retain and inspect this evidence in [Reports and Comparisons](/en/guide/learn/reports-and-comparisons).
