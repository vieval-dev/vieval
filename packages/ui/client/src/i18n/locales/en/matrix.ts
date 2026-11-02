/**
 * The matrix of a project or experiment (`MatrixView.vue`) and the score charts of its cells and the case charts
 * (`ScoreBar.vue`, `GroupBars.vue`, `ParallelSets.vue`).
 */
export default {
  averaged: {
    hint: 'Pool these axes into one cell (repeats of one configuration) · dots: mean score of each value',
    label: 'Average',
    members: '{n} {axes}: | {n} {axes}:',
    none: 'none',
    spread: 'Gap between its highest and lowest value mean, in points',
  },
  baseline: {
    clear: 'Beyond noise (about 95 %, treating the two cells as independent)',
    clearAll: 'Compare to nothing',
    hint: 'Pick a value per axis; an axis left at "each cell\'s own" is not compared · bars: mean score of each value',
    label: 'Baseline',
    noise: 'Within noise (about 95 %, treating the two cells as independent)',
    none: 'none',
    own: 'each cell\'s own',
    tag: 'baseline',
  },
  detail: {
    against: 'Against the baseline cell ({baseline})',
    excluded: 'Not counted in the best mark, the means, or the color scale until it settles',
    interval: '95 % interval {low}–{high} · n {n}',
    members: 'Each {axes}',
    scores: 'Every score',
  },
  groupBars: {
    caseCount: '{n} case | {n} cases',
    groupBy: 'Group by',
    hint: '{measure} per group, lowest first · bars colored like the chart · click a group to select it',
    mean: 'mean {score}',
    passRate: 'pass rate',
  },
  legend: {
    best: 'best of its row',
    delta: 'difference from {baseline} · faint: within noise',
    ring: 'cases with a result / cases expected · amber: no result',
    scale: 'score, low to high',
  },
  margin: {
    mean: 'mean',
    meanDelta: 'mean diff.',
  },
  mode: {
    auto: 'Auto',
    cards: 'Cards',
    compact: 'Compact',
    label: 'Cell view',
  },
  parallelSets: {
    axisHint: 'click to pick · drag title',
    blockTitle: '{value} · {n} case | {value} · {n} cases',
    label: 'Parallel sets of {n} case over {axes} | Parallel sets of {n} cases over {axes}',
    notSelected: '(not selected)',
    ribbonTitle: '{from} → {to} · {n} case | {from} → {to} · {n} cases',
  },
  ring: {
    errored: '{scored} of {expected} cases with a result, {errored} without one',
    label: '{scored} of {expected} cases with a result',
    running: 'running',
  },
  scoreBar: {
    label: 'Scores: {summary}',
    part: '{count} at {score}',
  },
  sort: 'Best first',
  view: {
    caseCount: '{n} case | {n} cases',
    casesEach: '{n} case each | {n} cases each',
    coverage: {
      full: 'every case',
      none: 'no result',
      other: 'other cases',
      partial: 'some cases',
    },
    deltaTitle: '{delta} points from the previous full run',
    empty: 'No matrix rows',
    emptyHint: 'Runs without tasks have nothing to show here.',
    hideSuperseded: 'Hide {n} older configuration | Hide {n} older configurations',
    incomplete: '{n} incomplete',
    intro: 'Newest full run of every combination across {n} run; a partial run or one over other cases never replaces it. | Newest full run of every combination across {n} runs; a partial run or one over other cases never replaces it.',
    missing: '{n} not run',
    notRun: 'not run',
    partial: '{measured} of {total} cases with a result · no full run yet',
    pointTitle: '{time} · {coverage} ({measured} of {total} cases with a result) · {score} {value} · completed {completion}',
    runCount: '{n} run | {n} runs',
    showSuperseded: 'Show {n} older configuration | Show {n} older configurations',
    sparkline: '{score} of {n} run | {score} of {n} runs',
  },
}
