/**
 * Names of run, task, case, try, and span states as `StateBadge` shows them, keyed by the state the API reports.
 * English keeps the lowercase API words; a state missing here is shown as reported.
 */
export default {
  ended: 'ended',
  error: 'error',
  errored: 'errored',
  failed: 'failed',
  interrupted: 'interrupted',
  ok: 'ok',
  passed: 'passed',
  queued: 'queued',
  requeued: 'requeued',
  retried: 'retried',
  running: 'running',
  skipped: 'skipped',
  stale: 'stale',
  timeout: 'timeout',
  unfinished: 'unfinished',
  unset: 'unset',
  unsupported: 'unsupported',
}
