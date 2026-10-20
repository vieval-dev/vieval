/**
 * Words of scores (`scores.ts`): the headline and its completion rate, unscored reasons, formulas, and graders; the
 * score badges and their detail card on the case page (`ScoreBadge.vue`, `ScoreDetail.vue`); and the Scores panel of a
 * run (`ScoresPanel.vue`).
 */
export default {
  completion: {
    /** Hover text of a completion rate that is not a link. */
    hint: 'Share of settled cases that produced a result',
    label: 'Completion rate',
    /** The completion rate as the headline shows it; `rate` is a percentage. */
    rate: 'completed {rate}',
    /** The cases without a result after the rate; `reasons` is a list of reason counts. */
    reasons: '({reasons})',
    showCases: 'Show the cases without a result',
  },
  detail: {
    calls: '{n} model call of the grader | {n} model calls of the grader',
    derived: 'derived',
    drawerDescription: 'Why the score has this value, and what graded it.',
    formula: 'formula',
    grader: 'grader',
    graders: 'graders',
    metadata: 'metadata',
    noValue: 'This case recorded no value of the score.',
    primary: 'primary',
    rationale: 'rationale',
    unscored: 'unscored · {reason}',
  },
  /** How a derived score combines its inputs; `inputs` is the list of input labels. */
  formula: {
    all: 'all of: {inputs}',
    mean: 'mean of: {inputs}',
    weighted: 'weighted: {inputs}',
  },
  grader: {
    /** Kinds of `grader.kind`; another kind is shown as written. */
    kinds: {
      external: 'external',
      human: 'human',
      model: 'model',
      rule: 'rule',
    },
    version: 'version {version}',
    votes: '{n} vote | {n} votes',
    /** Votes with the reducer that combined them (`3 votes, median`). */
    votesReducer: '{votes}, {reducer}',
  },
  headline: {
    /** Label of a `per-task` headline, whose value is the completion rate. */
    completed: 'completed',
    passedCases: 'Passed cases',
    passedDescription: 'Share of the settled cases that passed. The tasks record no score.',
    perTaskDescription: 'Share of the settled cases that produced a result. The tasks name different primary scores, listed below.',
    unscored: '{n} unscored',
  },
  /** Separator of the items of one line: reason counts, formula inputs. */
  listSeparator: ', ',
  panel: {
    byRound: 'Scores per auto-attempt round',
    columns: {
      counted: 'Counted',
      formula: 'Formula',
      grader: 'Grader',
      mean: 'Mean',
      notCounted: 'Not counted',
      score: 'Score',
    },
    compareRows: 'Compare cases across rows',
    matrixColumns: {
      cases: 'Cases',
      headline: 'Headline',
      rounds: 'Rounds',
      task: 'Task',
    },
    matrixRows: 'Matrix rows (tasks)',
    /** `code` is the call that records a score. */
    noScore: 'No score recorded. Cases record one with {code}; the headline is the share of passed cases.',
    /** `file` is the summary file name. */
    officialSummary: 'Official summary ({file})',
    primary: 'primary',
    /** Bar label of one auto-attempt round of a task. */
    round: '{task} · round {round}',
    title: 'Scores',
  },
  /** One count of a reason: `4 errored`, `2 grader failed`. */
  reasonCount: '{n} {reason}',
  /** Labels of the suggested unscored reasons and of the reasons a case leaves the completion rate. */
  unscoredReasons: {
    errored: 'errored',
    graderFailed: 'grader failed',
    inputUnscored: 'input unscored',
    invalidResponse: 'invalid response',
    noResponse: 'no response',
    refusal: 'refusal',
    timeout: 'timed out',
  },
}
