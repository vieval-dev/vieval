/** Words of a case's external evidence (`EvidencePanel.vue`): OSWorld episodes and other evidence directories. */
export default {
  files: {
    empty: 'The evidence directory is empty',
    filter: 'Filter files…',
    label: 'Evidence files',
    truncated: 'Listing stopped at {n} entries.',
  },
  /** Caption of one screenshot: what the AUV run did, and its id. */
  frameCaption: '{purpose} · AUV run {run}',
  /** One evidence link in the picker: its auto-attempt round and file name. */
  link: 'round {round} · {file}',
  logs: {
    empty: 'No correlated log lines',
    /** `keys` lists the correlation keys searched for. */
    emptyHint: 'Searched {n} log files for keys {keys}',
    loadMore: 'Load more ({n} left)',
    matched: '{n} lines matched in {files} · pods {pods} · window {from}–{to}',
  },
  noRecords: 'No {file} in this episode',
  noScreenshots: 'No screenshots in {dir}',
  notReadable: {
    /** A link to something other than a directory; `kind` is what it is (`file`). */
    kind: 'it is a {kind}',
    missing: 'the path does not exist on this machine',
    title: 'Evidence not readable: {reason}.',
  },
  steps: {
    columns: {
      command: 'Command',
      screenshot: 'Screenshot',
      status: 'Status',
      target: 'Inputs / target',
    },
    empty: '{file} has no agent steps',
    openFrame: 'Open frame {n}',
    screenshotOf: 'Screenshot of step {n}',
  },
  tabs: {
    commandLogs: 'Command logs',
    files: 'Files',
    label: 'Evidence views',
    logs: 'Logs',
    records: 'AUV records',
    screenshots: 'Screenshots',
    steps: 'Steps',
  },
  title: 'External evidence',
}
