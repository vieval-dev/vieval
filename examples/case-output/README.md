# `@vieval-examples/case-output`

Shows how `vieval run` folds the stdout/stderr of each case, like `pnpm -r run` folds the output of each package script.

```shell
pnpm -F @vieval-examples/case-output eval:run
```

What to look for in a terminal:

- While a case runs, the live window shows the last lines of its output under the case row.
  Older lines are hidden behind `[N lines collapsed]`. The number of lines per case depends on the terminal height (at most 10).
- When a case ends, its output leaves the live window. Nothing is printed while the run is still going.
- When the run ends, the output of every case is printed once, grouped by matrix row and in case order, before the summary:

  ```txt
  |case-output| episodes [repeat=1] > libreoffice/sum-column
  [6 lines collapsed]
  │ [libreoffice/sum-column#1] step 5/14: click (500, 250)
  │ ...
  └─ Done in 4 seconds
  ```

- `vscode/rename-symbol` fails on purpose. A failed case keeps its full output and ends with `└─ Failed in ...: <error>`.
  This also makes the command exit with code 1.
- `[module] episodes.eval.ts loaded` is written outside every case, so it is printed as-is.

When stdout is not a TTY (CI logs, `| cat`), there is no live window. Each case's full output is printed as one block when the case ends.

## Report and artifacts

The run writes its report to `.vieval/reports/<workspace>/case-output/<experiment>/<attempt>/<run>/`:

- `events.jsonl` is appended while the run is in progress. Each line has a `seq` that orders it within the run.
- Every case records an `actions.json` artifact with `context.recordArtifact(...)`. It is stored under `artifacts/<task>/<case>/` and announced as an `artifact.recorded` event in `events.jsonl`.

Pass `--no-report` to write nothing:

```shell
pnpm -F @vieval-examples/case-output eval:run --no-report
```
