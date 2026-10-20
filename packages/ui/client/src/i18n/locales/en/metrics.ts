/**
 * Words of metrics: their hover card (`MetricSummary.vue`), the case metrics panel and its charts
 * (`CaseMetricsPanel.vue`, `AxisPicker*.vue`, `CaseCartesian.vue`, `ParallelCoordinates.vue`, `ScatterMatrix.vue`,
 * `PairsHeatmap.vue`), the metric sections of a run's Scores panel, and the bar and line charts.
 */
export default {
  axes: {
    addToChart: 'Add to the chart',
    /** Separation of a metric: `value` is its AUC. */
    auc: 'AUC {value}',
    /** `side` is one of `higherIn`. */
    aucHint: 'AUC {value}: higher in {side} cases',
    available: 'Available · best at telling failed from passed (or low from high scores) first',
    category: 'category',
    description: 'Pick the metrics and categories drawn on the case charts.',
    details: 'Details of {metric}',
    detailsDescription: 'What the metric is and how its values spread.',
    hidden: 'Hidden automatically',
    /** Which cases a metric runs higher in. */
    higherIn: {
      failed: 'failed',
      higherScored: 'higher-scored',
      lowerScored: 'lower-scored',
      passed: 'passed',
    },
    onChart: 'On the chart',
    repeats: 'Repeats of a metric above',
    search: 'Search metrics…',
    searchLabel: 'Search metrics',
    title: 'Axes',
  },
  cases: {
    addCut: 'cut',
    addCutHint: 'Split the widest band; drag the new line on the metric\'s axis',
    bandsOf: 'Bands of {metric}',
    caseDescription: 'The case\'s value on every axis and where it sits among all cases.',
    caseTitle: 'Case {name}',
    clearSelection: 'Clear selection',
    colorBy: 'Color by',
    empty: 'No cases yet',
    legendCount: '{n} case | {n} cases',
    matrixFirst: '(the first {n} picked metrics)',
    matrixHint: '· drag in a cell to select',
    matrixPairs: 'Every pair of {metrics}',
    /** Selection summary of an eval without a primary score: the share of finished cases that passed. */
    pass: 'pass',
    /** `axes` is the name of the axis picker, in bold. */
    pickAxes: 'Pick a metric or a category in {axes} to draw the cases.',
    resetCuts: 'steps',
    resetCutsHint: 'Back to five equal steps',
    subtitle: 'every case against its recorded metrics',
    title: 'Case metrics',
    viewLabel: 'View',
    views: {
      chart: 'Chart',
      groups: 'Groups',
      matrix: 'Matrix',
      pairs: 'Pairs',
      sets: 'Sets',
    },
  },
  charts: {
    bar: 'Bar chart of {series}',
    /** Accessible name of a strip or plane; `axes` are the axis labels joined by `and`. */
    cartesian: 'Cases by {axes}',
    cartesianAnd: ' and ',
    categoryAxis: '{axis} · click a value to pick',
    clickToPick: 'click to pick',
    dragToSelect: 'drag to select',
    line: 'Line chart of {name}',
    noData: 'no data',
    parallel: 'Parallel coordinates of the cases',
    /** Shown on a cut line dragged off its axis. */
    removeCut: 'remove',
    scatterMatrix: 'Scatterplot matrix of the cases',
    symlogDrag: 'symlog · drag',
  },
  /** Summaries of a list metric, after its label (`Listener votes · mean`). */
  derived: {
    length: 'length',
    mean: 'mean',
  },
  pairs: {
    aucOf: 'AUC of {metric}',
    cell: '{column} × {row} · r {r} ({strength}) · {n} case | {column} × {row} · r {r} ({strength}) · {n} cases',
    diagonal: 'diagonal: AUC (failed vs passed) · click a cell for its scatterplot',
    independent: 'mostly independent',
    loose: 'loosely related',
    moveOpposite: 'move opposite',
    moveTogether: 'move together',
    /** A negative correlation; `strength` is one of the strength words. */
    opposite: '{strength}, opposite',
  },
  run: {
    casesOfEveryTask: '{n} case of every task | {n} cases of every task',
    empty: 'No metrics recorded',
    /** `code` is the call that records a metric. */
    emptyHint: 'Cases record metrics with {code}.',
    inference: 'Inference: {requests} requests · {responses} responses · {failed} failed',
    inRecordingOrder: 'in recording order',
    matrixHint: 'Every pair of the {n} metrics that best tell failed from passed cases · click a dot to open its case',
    numeric: 'Numeric metrics',
    other: 'Other metrics',
    pairsNeedTwo: 'Pairs need two numeric metrics that vary across cases.',
    /** Recorded on the run rather than on a case. */
    runValue: 'run',
    stats: 'n={n} · min {min} · avg {avg} · max {max}',
    viewLabel: 'Numeric metrics view',
    views: {
      matrix: 'Matrix',
      pairs: 'Pairs',
      time: 'Over time',
    },
  },
  summary: {
    distribution: 'Distribution of {n} values',
    errorsCountZero: 'errored cases count as 0',
    formula: 'formula',
    grader: 'grader',
    higherIsBetter: 'higher is better',
    histogram: 'Histogram from {min} to {max}',
    lowerIsBetter: 'lower is better',
    median: 'median {value}',
    /** Category values past the first few, as one segment. */
    more: '{n} more',
    /** After the score's mean, in bold: the cases that counted toward it. */
    over: 'over {n} of {total} cases',
    primaryScore: 'primary score',
    thisCase: 'this case: {value}',
    unit: 'unit · {unit}',
    unscored: 'unscored: {reasons}',
    values: '{n} value | {n} values',
  },
}
