/**
 * The matrix of a project or experiment (`MatrixView.vue`) and the score charts of its cells and the case charts
 * (`ScoreBar.vue`, `GroupBars.vue`, `ParallelSets.vue`).
 */
export default {
  groupBars: {
    caseCount: '{n} case | {n} cases',
    groupBy: 'Group by',
    hint: '{measure} per group, lowest first · bars colored like the chart · click a group to select it',
    mean: 'mean {score}',
    passRate: 'pass rate',
  },
  parallelSets: {
    axisHint: 'click to pick · drag title',
    blockTitle: '{value} · {n} case | {value} · {n} cases',
    label: 'Parallel sets of {n} case over {axes} | Parallel sets of {n} cases over {axes}',
    notSelected: '(not selected)',
    ribbonTitle: '{from} → {to} · {n} case | {from} → {to} · {n} cases',
  },
  scoreBar: {
    label: 'Scores: {summary}',
    part: '{count} at {score}',
  },
  view: {
    all: 'all',
    caseCount: '{n} case | {n} cases',
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
    intro: 'Newest full run of every combination across {n} run; a partial run or one over other cases never replaces it. | Newest full run of every combination across {n} runs; a partial run or one over other cases never replaces it.',
    legendFull: 'full run',
    legendNone: 'no result',
    legendPartial: 'partial run or other cases',
    notRun: 'not run',
    partial: '{measured} of {total} cases with a result · no full run yet',
    pointTitle: '{time} · {coverage} ({measured} of {total} cases with a result) · {score} {value} · completed {completion}',
    runCount: '{n} run | {n} runs',
    showSuperseded: 'Show {n} older configuration | Show {n} older configurations',
    sparkline: '{score} of {n} run | {score} of {n} runs',
    superseded: 'An older configuration: newer runs measured this entry with other eval values',
    without: 'without {axes}',
  },
}
