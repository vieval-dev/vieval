# `@vieval/viewer-showcase-fixture`

A real vieval eval project. Its runs write reports that use every feature of the web viewer (`@vieval/viewer`).
Use these reports for screenshots and manual checks, instead of hand-written JSON.

All models use the `mock` inference executor. The run does not use the network.

## What the run produces

The run matrix is `model` (`mock:model-a`, `mock:model-b`) × `repeat` (`1`, `2`), so each eval file gives 4 tasks (16 tasks in total).
One run takes about 25 seconds.

| Eval file | Task | What it exercises |
|---|---|---|
| `evals/artifacts.eval.ts` | `artifacts` | One case for each artifact preview kind: PNG `image`, a sequence of 6 WebP screenshots, WebM `video`, WAV `audio` (generated at run time, because `*.wav` is gitignored), `jsonl` with 20,500 or 21,000 rows, nested `json`, `yaml`, `toml`, plain `text` (400 lines), `html` with an inline script (the sandbox must block it: the page stays beige and says "Scripts are blocked"), and `binary` (`application/octet-stream`). The text case also writes `unannounced-notes.md` without `recordArtifact`, so the viewer lists it with `source: 'directory'`. |
| `evals/retries.eval.ts` | `retries` | `autoAttempt: 2`: the task runs 3 rounds, because one case fails in rounds 1 and 2. `autoRetry` cases fail on their first tries and pass on a retry. One case fails for `mock:model-b` in every try. |
| `evals/logs.eval.ts` | `logs` | `console.log/info/debug/warn/error` output, multi-line and Unicode output, one case with 3,201 lines, and a slow case (24 s for `repeat=1`, 12 s for `repeat=2`) that records `slow.step_latency_ms` every second. Use it to look at a run while it is in progress. |
| `evals/cases.eval.ts` | `cases` | 64 short cases (a long case list). Each case records the numeric metrics `latency_ms` and `tokens` once per step, the non-numeric metrics `finish_reason`, `cached`, and `tools_used`, and `exact` and `judge` scores. `mock:model-b` gets lower scores and more failures. |

The flaky and retry outcomes are deterministic: each case counts its executions in module scope (`evals/shared.ts`).
The `SHOWCASE_SEED` environment variable changes the scores of the `cases` task, so runs with different seeds
differ in comparisons.

The committed files in `fixtures/` (`image.png`, `frames/*.webp`, `clip.webm`) were made with ffmpeg test sources:

```shell
ffmpeg -f lavfi -i "testsrc2=size=320x200:rate=1" -frames:v 1 fixtures/image.png
ffmpeg -f lavfi -i "testsrc=size=480x300:rate=1" -ss 3 -frames:v 1 -c:v libwebp -quality 60 fixtures/frames/frame-01.webp # -ss 3, 6, ... 18
ffmpeg -f lavfi -i "testsrc=size=320x240:rate=15" -f lavfi -i "sine=frequency=440:sample_rate=22050" -t 3 \
  -c:v libvpx-vp9 -b:v 200k -c:a libopus -b:a 32k fixtures/clip.webm
```

## Run it

Build `vieval` first (`pnpm -F vieval build`). Then, in this directory, make reports for 2 experiments and 2 attempts:

```shell
pnpm exec vieval run --experiment baseline --attempt attempt-1
SHOWCASE_SEED=2 pnpm exec vieval run --experiment baseline --attempt attempt-2
SHOWCASE_SEED=candidate pnpm exec vieval run --experiment candidate --attempt attempt-1
```

Each run exits with code 1, because some cases fail on purpose.
Reports go to `.vieval/reports/default-workspace/showcase/<experiment>/<attempt>/<run>/` (gitignored, about 30 MB for each run).

Open the reports in the viewer (from the repository root):

```shell
node packages/vieval/dist/bin/vieval.mjs viewer packages/viewer/test/projects/showcase/.vieval/reports --port 51288
```

To look at a run while it is in progress, run `pnpm exec vieval run --with-viewer` in this directory, or start the viewer
on the reports directory and start a run in a second terminal.
