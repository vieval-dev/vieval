# @vieval/ui

Web viewer for [vieval](../vieval) runs: an H3 (v2) app served with srvx, and a Vue 3 + Vite + UnoCSS web UI that
the same server hosts at `/`. It shows runs while they execute and after they finished, from three sources:

- **in-process** (`vieval run --with-viewer`): the run's event bus, from its first event;
- **live tail** (`vieval viewer <reportRoot>`): runs another process is still writing (only `events.jsonl` exists);
- **reports**: finished runs, including reports of event schema version 1.

The API contract is in [API.md](./API.md) and `src/shared/contract.ts`.

## Install

```sh
pnpm add -D @vieval/ui
```

Up to 0.2.0 this package was published as `@vieval/viewer`. Replace that dependency with `@vieval/ui` when you upgrade.

`vieval` loads this package only when you ask for the viewer. Runs without `--with-viewer` do not import it.

## Use

Watch a run you start:

```sh
vieval run --with-viewer                 # http://127.0.0.1:51204/
vieval run --with-viewer --port 0 --host 127.0.0.1 --open
vieval run --config evals/agent-memory/vieval.config.ts --with-viewer --open   # a comparison
```

`--port`, `--host`, and `--open` have the same names and defaults as on `vieval viewer`. With a comparison config, one
viewer serves the comparison's report root (`.vieval/reports` next to the comparison config).

The viewer keeps serving after the run ended. Press Ctrl+C to exit; the exit code is the run's exit code.

Browse reports, including a run that another process is writing right now (the Vitest-style standalone command):

```sh
vieval viewer                            # .vieval/reports in the cwd (or next to --config)
vieval viewer ~/project/evals/osworld/.vieval/reports --port 0 --open
vieval viewer reports-a reports-b --evidence-root /data/episodes --stale-after 30
```

| Option | Default | Meaning |
|---|---|---|
| `--port` | `51204` | Port; `0` picks a free one. |
| `--host` | `127.0.0.1` | Interface. Other hosts are refused unless you bind them (DNS rebinding protection). |
| `--open` | off | Open the browser. |
| `--evidence-root <dir>` | — | Extra directory that `*.evidence` metric paths may point into (repeatable). The `.vieval` directory above each report root is always allowed. |
| `--stale-after <min>` | `60` | A run without an end event whose last event is older is shown as `stale`. |

## Programmatic use

```ts
import { startViewer } from '@vieval/ui'

const viewer = await startViewer({ host: '127.0.0.1', mode: 'static', open: false, port: 0, reportRoots: ['.vieval/reports'] })
console.info(viewer.url)
await viewer.close()
```

`startViewer` implements the `ViewerModule` contract of `vieval/cli` (`StartViewerOptions`, `ViewerHost`). In `live`
mode, pass `viewer.attachRun` as `onRunReady` to `runVievalCli`.

## The web UI

Open the URL that `vieval run --with-viewer` or `vieval viewer` prints. The UI reads only the API in [API.md](./API.md);
every number on screen comes from a run's events, report files, or evidence directories.

| Screen | Address (`#/…`) | What it shows |
|---|---|---|
| Projects (home) | `#/` or `#/?workspace=` | One card per project: the best exact score, the newest run's state, experiments and runs, the matrix axes, and the case bar; while the newest run is running, when it is expected to end, how long ago it started, and a thin progress bar. With one workspace its projects are shown directly (the workspace stays in the breadcrumb). |
| Project | `#/?workspace=&project=&tab=` | **Experiments**: one row per experiment with its readable name, newest run (state, time), score trend, cases, exact score, attempts. **Matrix**: per eval entry, rows along the run axis with the most values (for example `model`), columns for the other axes (for example `repeat`); each cell is the newest run of that combination with its score, cases, and trend, linking to the task. |
| Experiment | `#/?workspace=&project=&experiment=&tab=` | **Attempts**: one row per attempt, newest first (time, run state and short hash, duration, cases, exact score; extra runs of an attempt as sub-rows), checkboxes to compare chosen runs. **Matrix** of the experiment's runs. `&attempt=` highlights one attempt. |
| Run | `#/runs/<runKey>` | Progress bar and progress chart (solid: completed cases over time; dashed: projection at the current ETA to the estimated total, fainter when it is a lower bound; "now" marker; recent rate in cases/h), cases done / estimated, running cases, tasks done, elapsed time, ETA and expected finish, current position (running cases with round, retry, elapsed). Tabs: **Execution** (virtualized live tree `project → task → round → case → try`, state filters, search, *Current* jumps to the first running case), **Scores & metrics** (scores, matrix rows table and chart, scores per round, numeric metrics as line charts, other metrics collapsed to one line each, expandable to every value per case), **Console logs** (all `console.*` lines of the run, linked to their case), **OpenTelemetry** (trace waterfall, log records, gauges, raw `otlp/*.json`). |
| Task | `#/runs/<runKey>/task?taskId=` | Matrix values, scores, rounds (auto attempts) with pass rates, **Case metrics**, the virtualized case list. Case metrics draws every case against its metrics, and picks the chart by the number of dimensions (`state` is the color, not a dimension): one dimension is a strip of dots, two a plane (metric × metric scatter, metric × category bands, category × category grid), three or more parallel coordinates with a scatterplot matrix of the first five picked metrics. The chart opens on the five metrics that best tell failed from passed cases (AUC, scores left out); the *Axes* button opens a searchable list of the axes on the chart, the others ranked by AUC, metrics that move with another one (\|r\| ≥ 0.95 on log values), and those hidden as constant or repeated. *Color by* recolors by state, a category, or a metric. Dragging on an axis or in a scatterplot cell, or clicking a category value, selects cases; the case list below shows the selection. Hovering a line or dot previews its case; clicking pins it (its line and its value on every axis stay highlighted) and opens a card with the case's categories on one line and its most unusual metrics (furthest from the median) with a small histogram each, the rest folded, and a link to the case. On phones a tap opens that card in a bottom drawer (vaul). |
| Case | `#/runs/<runKey>/case?taskId=&caseId=` | **Overview**: error, timeline of rounds (auto attempts) and tries (retries), input and output as object trees, metrics. **Console log**, **Artifacts**, **Evidence**, **Inference**: calls, input and output tokens (per model when a case used several, plus their sum), model time, and one row per model call with the tool calls it asked for. |
| Compare | `#/compare?view=experiments\|attempts\|runs\|matrix&…` | Per column: newest run, state, exact score, case counts; a bar chart of exact score and pass rate; a case × column table (state, exact score, rounds) with an "only differing" filter. `matrix` compares the matrix rows (for example `model` × `repeat`) of one eval entry inside one run. |

Ids are query parameters because task and case ids contain `/` and `%`. Breadcrumbs show the path
`projects → workspace → project → experiment → attempt → run → task → case` up to the page shown. Ancestors are links;
the last segment opens a switcher (search by name or id) to the other items of the same parent. Report ids are shown as
readable names: an experiment by its matrix (`model gpt-5.5 · repeat 1–3`, or its chosen id plus matrix chips), an
attempt by its start time, a run by its start time and short hash. The full id is in the tooltip; "⋯ → Copy ID" in the
page header (and on attempt rows) copies it. Comparisons open from the *Compare* menu in the sidebar header.

On screens narrower than 768 px (phones), the sidebar becomes a drawer behind the menu button of a top bar, the
breadcrumb is one line that scrolls sideways, and list rows stack their columns (for example the run, duration, and
cases of an attempt below its time). A run page shows progress, ETA, and expected finish right under the progress bar.
While a view loads, a skeleton in its shape stands in for it; responses are cached (Pinia Colada), so a view opened
again shows at once and refreshes in place.

Cards (project, matrix cell, compared column) share one layout: the exact score top left, the state top right, the
name below the score, the expected finish of a running run, and the case bar at the bottom. The case bar is the one
indicator of case outcomes everywhere; cards show its counts above the bar on hover, rows and headers in a tooltip.

To follow a run from a phone, bind the viewer to an address the phone can reach, for example a Tailscale address or
`--host 0.0.0.0` on a trusted network (binding all interfaces turns off the `Host` check).

**Live updates.** A run in state `running` or `stale` opens the SSE stream after the snapshot's `seq`. `progress`
events update progress, ETA, and the current position at once; other events trigger a snapshot refetch at most every
1.5 s; `reset` and `end` refetch. Between updates the elapsed time and the ETA follow the local clock. The case and
task pages, scores, metrics, and OTEL panels refetch when the run's `seq` changes, at most every 1.5 s; console logs
follow the tail while the case or run is running. The run list behind the sidebar, the home and project pages, and the
breadcrumb switchers is re-read every 10 s while the tab is visible, so new runs appear.

**Artifacts and evidence files** use one viewer, chosen by `previewKind`:

| Kind | Behavior |
|---|---|
| `image` | Image, fit or 100 %. Two or more images of a case also form an *Image sequence* (player with play/pause, ←/→, scrubber, filmstrip). OSWorld WebP screenshots use the same player. |
| `video`, `audio` | Native `<video>` / `<audio>` with controls; Range requests let them seek. |
| `jsonl` | Virtualized table (only visible rows are in the DOM), pages of 200 lines fetched from the server's line index; columns are the frequent top-level keys and one level of nested keys (`record.type`); a row opens as an object tree. |
| `json`, `yaml`, `toml` | Parsed (`JSON.parse`, `yaml`, `smol-toml`) into one collapsible object tree; *Source* shows the text; a parse error shows the text with the message. Files over 1 MiB show their beginning as text. |
| `text` | The first 1 MiB as text. |
| `html` | `<iframe sandbox="">` (no scripts, forms, or same-origin access); the server also sends `Content-Security-Policy: sandbox`. |
| `binary` | "No preview" notice with type and size, a download button, and the first 256 bytes as hex. |

**OSWorld evidence** (case page, *Evidence*): the `result.json` summary; *Steps* (every `agent.steps[]` entry with its
command, inputs, status or failure, and the screenshot its AUV run captured); *Screenshots* (sequence player);
*AUV records* (`auv-runs/records.jsonl` as a JSONL table); *Files* (every file of the episode in the viewer above);
*Command logs* (lines of `.vieval/logs/*.jsonl` matched by case id, pod, and time window).

Every list has loading, empty, and error states; an unreachable server shows a retry button. The UI has a light and a
dark scheme and a theme color (both in the sidebar header): accents follow the picked hue (stored in the browser), state
colors (passed, failed, interrupted, running) never change.

## What the API returns

- Hierarchy `workspace → project → experiment → attempt → run`, then the execution tree
  `run → project → task → round (autoAttempt) → case → try (autoRetry)`.
- Current position (running cases), progress and ETA, console logs, metrics, scores, attempt/retry timeline.
- Artifacts from `artifacts/<task>/<case>/` with Range reads and JSONL paging; HTML/SVG sandboxed by CSP.
- External evidence linked by `*.evidence` metrics (OSWorld episodes: `result.json` summary, screenshot timeline),
  and lines of `.vieval/logs/*.jsonl` filtered by case id, pod, and time window.
- Simple OTEL views (spans/logs/gauges rebuilt from events) and the raw `otlp/*.json`.
- Comparisons between experiments, between attempts of one experiment, and between chosen runs.

## Experiments, attempts, rounds, and tries

A report path is `<workspace>/<project>/<experiment>/<attempt>/<run>/`. The four words mean different things:

| Level | Set by | Meaning | Example (OSWorld) |
|---|---|---|---|
| experiment | `--experiment`, or vieval's default `matrix-<run rows>` | What was measured. Two experiments are different setups and are compared side by side. | `matrix-run-model-gpt-5.5-repeat-1` and `matrix-run-model-gpt-5.5-repeat-1--…-repeat-3` (1 repeat or 3 repeats of `gpt-5.5`) |
| attempt | `--attempt`, or vieval's default `attempt-<ISO time>` | One invocation of the same experiment. It is a label only: vieval does not re-run anything for it. | 11 `attempt-2026-10-1…Z` directories below `matrix-run-model-gpt-5.5-repeat-1` |
| round | `autoAttempt` of a task | vieval ran every case of the task again because a case failed. Shown in the task and case pages. | — |
| try | `autoRetry` of a case | vieval retried one case at once inside a round. | — |

*Compare → experiments* puts the newest run of each experiment of a project side by side. *Compare → attempts* puts
the runs of one experiment side by side. Neither changes the data; both read the same report directories.

## Security of artifacts and evidence

- The server binds `127.0.0.1` and refuses other `Host` headers (DNS rebinding). Do not bind `0.0.0.0` on a shared
  network: the API has no authentication.
- Files are served only from inside a run's `artifacts/` directory, the `.vieval` directory above a report root, or an
  `--evidence-root`. Absolute paths, `..`, and symlinks that leave the root are refused with `403`.
- HTML and SVG are shown in `<iframe sandbox="">` and are sent with `Content-Security-Policy: sandbox`: their scripts do
  not run and they cannot read the viewer's origin. Every file is sent with `X-Content-Type-Options: nosniff`.
- Binary files are never rendered; the UI shows type, size, the first 256 bytes as hex, and a download button.
- The viewer opens report files read-only. It is safe to point it at a run that another process is writing.

See [API.md § Security](./API.md#security) for the status codes.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `/` says "The web UI is not bundled in this build." | `dist/client/` is missing. Run `pnpm -F @vieval/ui build`. |
| `EADDRINUSE` on start | Port `51204` is in use (often a second viewer). Use `--port 0` or another port. |
| `403` `Host "…" is not allowed` | You opened the viewer through a hostname other than the bound host. Use `127.0.0.1`, or bind that host with `--host`. |
| A run shows `stale` | No end event and no event for `--stale-after` minutes. The writer was killed, or it is waiting longer than that. Raise `--stale-after` for slow evals. |
| A new run does not appear in the sidebar | The sidebar re-reads report roots every 10 s. Check that the run writes below one of the roots in `GET /api/health`. |
| Evidence says "Path is outside the allowed evidence roots." | The `*.evidence` metric points outside the `.vieval` directory. Add its directory with `--evidence-root`. |
| *Command logs* is empty | The viewer looks for `.vieval/logs/*.jsonl` next to the report root. Logs without the case id, pod, or a time in the case's window are not matched. |
| No rounds, tries, or console logs for an old run | The run used event schema version 1. These runs only have `cases.jsonl` (shown as `legacy`). |
| Component tests fail with "browserType.launch" | Run `pnpm exec playwright install chromium` once. |
| `vieval run` without `--with-viewer` changed behavior | It should not: the viewer package is not imported then. Report it with the command and the `stdout` of both versions. |

## Limits

- **Traces are simple on purpose.** The OpenTelemetry tab rebuilds one trace per run from vieval's own events
  (`run → project → task → round → case → try`). It does not:
  - receive OTLP data (there is no collector endpoint);
  - show spans that user code or libraries create with the OpenTelemetry SDK (only vieval's lifecycle);
  - correlate traces across processes or services (no context propagation, no linked traces);
  - sample, search, filter by attribute, aggregate, or keep traces after the run (no query language, no storage);
  - export to Jaeger, Tempo, Honeycomb, or another backend.
  For these, send vieval's OpenTelemetry output to a real tracing backend. `otlp/*.json` (written when the run
  ends) is shown as raw JSON only.
- Logs and metrics in the OpenTelemetry tab are also rebuilt from events (console lines, failures, numeric metrics,
  case duration and scores as gauges).
- `/` shows a placeholder when the package was built without the web UI (`dist/client/` missing).
- Runs of event schema version 1 have no rounds, retries, or logs (rebuilt from `cases.jsonl`).
- Whether a tailed run is still alive is not known (`events.jsonl` carries no writer pid); after `--stale-after`
  without events it is shown as `stale`.

## Develop

```sh
pnpm -F @vieval/ui build        # tsdown (server) + vite build (web UI into dist/client/)
pnpm -F @vieval/ui typecheck    # tsc (server) + vue-tsc (web UI)
pnpm -F @vieval/ui test:run     # server tests (Node) + component tests (Vitest browser mode, Chromium)
pnpm -F @vieval/ui dev:client   # Vite dev server for the UI; proxies /api to VIEVAL_VIEWER_API (default http://127.0.0.1:51204)
```

Component tests need the Playwright Chromium (`pnpm exec playwright install chromium` once).

The package uses the workspace's `typescript`, `vite`, `vitest`, and `unocss`; do not add them to this package.

UI conventions:

- Icons are MingCute through UnoCSS `presetIcons` (`i-mingcute-*-line`; state badges use `-fill`). Do not add inline SVG
  icons or glyphs such as `✓`.
- Fonts are self-hosted with Fontsource, so the viewer works offline: Quicksand, Noto Sans, and Noto Sans SC (loaded
  per `unicode-range`, only when a page shows CJK text) for text; Maple Mono for `font-mono`.
- Use `mono` (`font-mono tabular-nums`) only in list-like views (tables, timelines, event and log rows) and for raw
  content (JSON, logs, hex). Headers, figures, and navigation use the sans font; add `tabular-nums` to figures.
- Every hierarchy level (projects, comparison, workspace, project, experiment, attempt, run, task, case, round, try) has
  one icon, `levelIcons` in `client/src/hierarchy.ts`. Use it wherever a level is named.
- Show report ids through `labels.ts` (`experimentLabel`, `attemptLabel`, `runLabel`) and `IdLabel.vue` (full id in the
  tooltip); copying an id is the explicit "Copy ID" action of `IdMenu.vue`, never a bare icon next to a name.
- Accents use the `primary` palette of `@proj-airi/unocss-preset-chromatic`, driven by `--chromatic-hue` (default
  `DEFAULT_HUE` in `client/src/theme.ts`, applied before mount by `client/public/scheme.js`). Status hues stay reserved
  for states. Floating surfaces use the `tooltip` / `floating` shortcuts (and their `*-arrow` fills) so tooltips,
  popovers, and menus match each color scheme.
- Buttons are ghost buttons (`btn`: no border, a tint on hover). Icon-only buttons use `IconButton.vue` (`icon-btn`,
  with an `aria-label` and a reka-ui tooltip); `TooltipProvider` wraps the app in `App.vue`, so component tests that
  render an `IconButton` wrap it in one too.
- Interactive widgets come from reka-ui: `ViewTabs.vue` (Tabs), `SegmentedControl.vue` (ToggleGroup, for filters and
  view switches), the image-sequence scrubber and the hue picker (Slider, Popover), `CompareMenu.vue` and `IdMenu.vue`
  (DropdownMenu), `CrumbSwitcher.vue` (Popover + Combobox), and tooltips. Lists stay on `@tanstack/vue-virtual`.
- Fonts are never inlined into the bundle (`vite.config.ts`): the UI's CSP has no `font-src data:`.
- Images of artifacts and evidence go through `LazyImage.vue`: it reads `GET …/preview` (size and ThumbHash), keeps
  the image's aspect ratio before it loads, and fades the blurred placeholder out once the image arrived.

| Path | Content |
|---|---|
| `client/src/pages/` | `HomePage`, `ProjectPage`, `ExperimentPage`, `RunPage`, `TaskPage`, `CasePage`, `ComparePage`. |
| `client/src/components/` | Execution tree, progress panel, log view, charts, artifact viewers (`ArtifactViewer`, `JsonlTable`, `ObjectTree`, `ImageSequence`), OSWorld `EvidencePanel`, `OtelPanel`. |
| `client/src/composables/useRunLive.ts` | Snapshot + SSE stream of a run. |
| `client/src/composables/useCatalog.ts` | The shared run list (`GET /api/runs`, every 10 s) and the hierarchy built from it. |
| `client/src/labels.ts`, `client/src/switcher.ts` | Readable names of report ids; options of the breadcrumb switchers. |
| `client/src/api.ts` | Typed client of the API (types from `src/shared/contract.ts`). |

`test/fixtures/osworld` is a trimmed copy of a real OSWorld `.vieval` directory (see its README).
`test/projects/showcase` is a real eval project whose runs produce every artifact kind, auto attempts, retries,
long logs, and matrix rows (see its README); use its reports for manual checks of the UI.
