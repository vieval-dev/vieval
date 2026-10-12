import type { StartViewerOptions, ViewerHost } from './viewer-host'

import process from 'node:process'

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseTopLevelCliArguments } from './index'
import { parseViewerCliArguments, runViewerCli } from './viewer'

const directories: string[] = []

async function createReportRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vieval-viewer-cli-'))
  directories.push(directory)
  await mkdir(join(directory, '.vieval', 'reports'), { recursive: true })
  return directory
}

describe('vieval viewer', () => {
  afterEach(async () => {
    await Promise.all(directories.splice(0).map(async directory => rm(directory, { force: true, recursive: true })))
    process.exitCode = undefined
    vi.restoreAllMocks()
  })

  it('is a top-level command', () => {
    expect(parseTopLevelCliArguments(['viewer', 'reports'])).toEqual({ command: 'viewer', commandArgv: ['reports'] })
  })

  it('defaults to .vieval/reports in the cwd, port 51204, and loopback', async () => {
    const cwd = await createReportRoot()
    expect(parseViewerCliArguments([], cwd)).toEqual({
      evidenceRoots: [],
      host: '127.0.0.1',
      mode: 'static',
      open: false,
      port: 51204,
      reportRoots: [join(cwd, '.vieval', 'reports')],
    })
  })

  it('accepts report roots, evidence roots, port, host, open, and stale threshold', async () => {
    const cwd = await createReportRoot()
    const parsed = parseViewerCliArguments(['.vieval/reports', '--port', '0', '--host', '0.0.0.0', '--open', '--evidence-root', 'a', '--evidence-root', '/b', '--stale-after', '5'], cwd)
    expect(parsed).toEqual({
      evidenceRoots: [join(cwd, 'a'), '/b'],
      host: '0.0.0.0',
      mode: 'static',
      open: true,
      port: 0,
      reportRoots: [join(cwd, '.vieval', 'reports')],
      staleAfterMs: 300_000,
    })
  })

  it('uses the report root next to --config', async () => {
    const cwd = await createReportRoot()
    expect(parseViewerCliArguments(['--config', join(cwd, 'vieval.config.ts')], '/').reportRoots).toEqual([join(cwd, '.vieval', 'reports')])
  })

  it.each([
    [['--port', '70000'], /Invalid --port/],
    [['--stale-after', '0'], /Invalid --stale-after/],
    [['missing-root'], /does not exist/],
  ])('rejects %j', async (argv, message) => {
    const cwd = await createReportRoot()
    expect(() => parseViewerCliArguments(argv, cwd)).toThrow(message)
  })

  it('starts the viewer in static mode and serves until it is closed', async () => {
    const cwd = await createReportRoot()
    vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    let resolveClosed!: () => void
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve
    })
    const received: StartViewerOptions[] = []
    const host: ViewerHost = {
      attachRun: () => undefined,
      close: async () => resolveClosed(),
      url: 'http://127.0.0.1:51204/',
      waitUntilClosed: () => closed,
    }
    const running = runViewerCli([], {
      importViewer: async () => ({
        startViewer: async (options) => {
          received.push(options)
          return host
        },
      }),
    })
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]).toMatchObject({ mode: 'static', reportRoots: [join(cwd, '.vieval', 'reports')] })
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Viewer: http://127.0.0.1:51204/'))
    await host.close()
    await running
    expect(process.exitCode).toBeUndefined()
  })

  it('reports a missing viewer package with exit code 1', async () => {
    const cwd = await createReportRoot()
    vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await runViewerCli([], {
      importViewer: async () => {
        throw new Error('--with-viewer requires the "@vieval/ui" package.')
      },
    })
    expect(process.exitCode).toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('@vieval/ui'))
  })
})
