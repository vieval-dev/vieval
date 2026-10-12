import type { StartViewerOptions, ViewerModule } from './viewer-host'

import process from 'node:process'

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import meow from 'meow'

import { errorMessageFrom } from '@moeru/std'

import { DEFAULT_VIEWER_HOST, DEFAULT_VIEWER_PORT, importViewer } from './viewer-host'

/**
 * Process-bound dependencies of {@link runViewerCli}, replaceable by tests.
 */
export interface ViewerCliRuntime {
  /** @default {@link importViewer} */
  importViewer?: (baseDirectory: string) => Promise<ViewerModule>
}

const viewerHelpText = `
  Browse vieval reports in the web viewer, including runs another process is still writing.

  Usage
    $ vieval viewer [reportRoot...] [options]

  Arguments
    reportRoot   Report root(s) to browse (default: .vieval/reports next to --config, or in the cwd)

  Options
    --config, -c        Config file whose .vieval/reports is browsed when no reportRoot is given
    --port <port>       Port (default: ${DEFAULT_VIEWER_PORT}; 0 picks a free port)
    --host <host>       Host to bind (default: ${DEFAULT_VIEWER_HOST})
    --open              Open the viewer in a browser
    --evidence-root     Extra directory evidence links (for example *.evidence metrics) may point into;
                        repeatable. The parent of each report root (.vieval) is always allowed.
    --stale-after <min> Minutes without events after which a run with no end event is shown as stale
                        (default: 60)

  Examples
    $ vieval viewer
    $ vieval viewer ~/project/evals/osworld/.vieval/reports --port 0 --open
`

/**
 * Parsed `vieval viewer` arguments.
 */
export interface ParsedViewerCliArguments extends StartViewerOptions {
  evidenceRoots: string[]
  staleAfterMs?: number
}

/**
 * Parses `vieval viewer` arguments.
 *
 * Throws:
 * - for an invalid port or stale threshold, or a report root that does not exist
 */
export function parseViewerCliArguments(argv: readonly string[], cwd = process.cwd()): ParsedViewerCliArguments {
  const cli = meow(viewerHelpText, {
    allowUnknownFlags: false,
    argv: [...argv],
    autoHelp: false,
    autoVersion: false,
    flags: {
      config: { shortFlag: 'c', type: 'string' },
      evidenceRoot: { isMultiple: true, type: 'string' },
      host: { type: 'string' },
      open: { default: false, type: 'boolean' },
      port: { type: 'number' },
      staleAfter: { type: 'number' },
    },
    importMeta: import.meta,
  })
  const port = cli.flags.port ?? DEFAULT_VIEWER_PORT
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid --port "${String(cli.flags.port)}". Expected an integer from 0 to 65535.`)
  }
  const staleAfter = cli.flags.staleAfter
  if (staleAfter != null && (!Number.isFinite(staleAfter) || staleAfter <= 0)) {
    throw new Error(`Invalid --stale-after "${String(staleAfter)}". Expected a positive number of minutes.`)
  }
  const baseDirectory = cli.flags.config == null ? cwd : dirname(resolve(cwd, cli.flags.config))
  const reportRoots = cli.input.length > 0
    ? cli.input.map(root => resolve(cwd, root))
    : [join(baseDirectory, '.vieval', 'reports')]
  for (const root of reportRoots) {
    if (!existsSync(root)) {
      throw new Error(`Report root "${root}" does not exist. Run "vieval run" first, or pass the directory that holds the reports.`)
    }
  }
  return {
    evidenceRoots: (cli.flags.evidenceRoot ?? []).map(root => resolve(cwd, root)),
    host: cli.flags.host ?? DEFAULT_VIEWER_HOST,
    mode: 'static',
    open: cli.flags.open,
    port,
    reportRoots,
    ...(staleAfter == null ? {} : { staleAfterMs: staleAfter * 60_000 }),
  }
}

/**
 * Runs `vieval viewer`: serves report roots until Ctrl+C.
 *
 * Call stack:
 *
 * runTopLevelCli (`./index`)
 *   -> {@link runViewerCli}
 *     -> {@link parseViewerCliArguments}
 *     -> {@link importViewer}
 *       -> `startViewer({ mode: 'static', ... })` of `@vieval/ui`
 *     -> `ViewerHost.waitUntilClosed()`
 */
export async function runViewerCli(argv: readonly string[], runtime: ViewerCliRuntime = {}): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${viewerHelpText.trim()}\n`)
    return
  }
  let host: Awaited<ReturnType<ViewerModule['startViewer']>>
  try {
    const parsed = parseViewerCliArguments(argv)
    const viewer = await (runtime.importViewer ?? importViewer)(process.cwd())
    host = await viewer.startViewer(parsed)
    process.stderr.write(`Viewer: ${host.url} (press Ctrl+C to exit)\n  reports: ${parsed.reportRoots.join(', ')}\n`)
  }
  catch (error) {
    process.stderr.write(`[vieval] ${errorMessageFrom(error) ?? 'Failed to start the viewer.'}\n`)
    process.exitCode = 1
    return
  }

  const close = () => {
    void host.close()
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  try {
    await host.waitUntilClosed()
  }
  finally {
    process.off('SIGINT', close)
    process.off('SIGTERM', close)
  }
}
