import process from 'node:process'

import { dirname, join, resolve } from 'node:path'

import meow from 'meow'

import { importViewer, VIEWER_PACKAGE_NAME } from './viewer-host'

const help = `
  Export completed evaluations as a static Viewer site.

  Usage
    $ vieval report export [reportRoot...] --output <directory> [options]

  Options
    --output            New directory for the website
    --config, -c        Resolve the default .vieval/reports next to this config
    --run               Exact run key to export (repeatable)
    --include-evidence  Copy linked external evidence
    --evidence-root     Extra allowed evidence directory (repeatable)

  Serve the resulting directory over HTTP to share the report.
`

/**
 * Publishes completed reports through the optional Viewer package.
 *
 * Call stack:
 *
 * runTopLevelCli (./index)
 *   -> {@link runReportExportCli}
 *     -> {@link importViewer}
 *       -> @vieval/ui exportReport
 */
export async function runReportExportCli(argv: readonly string[]): Promise<void> {
  const cli = meow(help, {
    allowUnknownFlags: false,
    argv: [...argv],
    flags: {
      config: { shortFlag: 'c', type: 'string' },
      evidenceRoot: { isMultiple: true, type: 'string' },
      includeEvidence: { type: 'boolean' },
      output: { type: 'string' },
      run: { isMultiple: true, type: 'string' },
    },
    importMeta: import.meta,
  })
  if (!cli.flags.output)
    throw new Error('Static export requires --output <directory>.')

  const cwd = process.cwd()
  const project = cli.flags.config == null ? cwd : dirname(resolve(cwd, cli.flags.config))
  const viewer = await importViewer(project, VIEWER_PACKAGE_NAME, 'vieval report export')
  if (viewer.exportReport == null)
    throw new Error('Install a version of @vieval/ui with static report export support.')

  const result = await viewer.exportReport({
    evidenceRoots: cli.flags.evidenceRoot?.map(root => resolve(cwd, root)),
    includeEvidence: cli.flags.includeEvidence,
    output: resolve(cwd, cli.flags.output),
    reportRoots: cli.input.length > 0 ? cli.input.map(root => resolve(cwd, root)) : [join(project, '.vieval', 'reports')],
    runKeys: cli.flags.run,
  })
  process.stdout.write(`Exported ${result.runKeys.length} run(s) to ${result.output}\nOmitted files: ${result.omittedFiles}\n`)
}
