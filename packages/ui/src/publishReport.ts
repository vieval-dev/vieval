import type { ExportReportOptions, ExportReportResult } from 'vieval/cli'

import type { ReportPrerenderOptions } from './reportPrerender'
import type { PublishedCatalog, PublishedRun } from './shared/publishedReport'

import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isAllowedPath, isInside } from './server/files'
import { createRunStore, toRunListItem } from './server/store'
import { CATALOG_PATH, runDataPath, telemetryPath } from './shared/publishedReport'

/**
 * Builds a static Viewer site for completed reports.
 *
 * Use when:
 * - a publisher needs to deploy reports to a static HTTP host
 *
 * Expects:
 * - the Viewer is built and the destination does not exist
 *
 * Returns:
 * - the absolute output path, run keys, and count of omitted files
 *
 * Call stack:
 *
 * vieval report export
 *   -> {@link exportReport}
 *     -> Nitro prerender
 *       -> reportPrerender
 */
export async function exportReport(options: ExportReportOptions): Promise<ExportReportResult> {
  const output = resolve(options.output)
  const reportRoots = options.reportRoots.map(root => resolve(root))
  const evidenceRoots = (options.evidenceRoots ?? []).map(root => resolve(root))
  const dist = fileURLToPath(new URL('../dist/', import.meta.url))
  const clientDir = join(dist, 'client')
  const destination = await isAllowedPath([], output)
  if (destination.exists)
    throw new Error(`Export output "${output}" already exists.`)
  for (const source of [...reportRoots, ...evidenceRoots, clientDir]) {
    const root = await isAllowedPath([], source)
    if (!root.exists)
      throw new Error(`Export source "${source}" does not exist.`)
    if (isInside(root.realPath, destination.realPath) || isInside(destination.realPath, root.realPath))
      throw new Error('Export output must not overlap report, evidence, or Viewer sources.')
  }

  const at = Date.now()
  let runs: PublishedCatalog['runs']
  const store = createRunStore({ reportRoots })
  try {
    const completed = (await store.list()).filter((run) => {
      const state = run.state(at)
      return state === 'ended' || state === 'interrupted'
    })
    const selected = options.runKeys?.length
      ? [...new Set(options.runKeys)].map((key) => {
          const run = completed.find(item => item.runKey === key)
          if (run == null)
            throw new Error(`Run "${key}" is not a supported completed report in the selected roots.`)
          return run
        })
      : completed
    if (selected.length === 0)
      throw new Error('No supported completed reports to export.')
    runs = selected.map(run => ({ ...toRunListItem(run, at), reportPath: null, reportRoot: null }))
      .sort((left, right) => (right.startedAt ?? '').localeCompare(left.startedAt ?? ''))
  }
  finally {
    store.close()
  }

  // Nitro owns a scratch build. An exclusive mkdir claims the user's destination only after the build succeeds.
  const scratch = await mkdtemp(join(tmpdir(), 'vieval-export-'))
  try {
    const publicDir = join(scratch, 'site')
    const inputs: ReportPrerenderOptions = {
      at,
      catalog: { runs, version: 1 },
      clientDir,
      evidenceRoots,
      includeEvidence: options.includeEvidence === true,
      output: destination.realPath,
      publicDir,
      reportRoots,
    }
    // The worker gets explicit build inputs without reading the caller's project config or environment variables.
    const serverEntry = join(scratch, 'server.mjs')
    const handler = join(dist, 'reportPrerender.mjs')
    await writeFile(serverEntry, `import { createReportPrerender } from ${JSON.stringify(handler)}\nexport default createReportPrerender(${JSON.stringify(inputs)})\n`)
    const routes = ['/index.html', `/${CATALOG_PATH}`, ...runs.flatMap((_, index) => [
      `/${runDataPath(index, 'run')}`,
      `/${runDataPath(index, 'comparison')}`,
      ...(['logs', 'metrics', 'traces'] as const).map(signal => `/${telemetryPath(index, signal)}`),
    ])]
    const { copyPublicAssets, createNitro, prepare, prerender } = await import('nitro/builder')
    const nitro = await createNitro({
      builder: 'rollup',
      // Resolve the shipped builder from this package, since the Nitro project lives in a temporary directory.
      deps: { install: false, paths: { rollup: import.meta.resolve('rollup/package.json') } },
      output: { dir: join(scratch, 'output'), publicDir },
      prerender: { crawlLinks: false, failOnError: true, ignoreStatusCodes: [404], routes },
      preset: 'static',
      publicAssets: [{ dir: clientDir, ignore: [join(clientDir, 'index.html')] }],
      rootDir: scratch,
      serverEntry,
    }, { dotenv: false })
    try {
      await prepare(nitro)
      await copyPublicAssets(nitro)
      await mkdir(join(publicDir, 'files'), { recursive: true })
      await prerender(nitro)
    }
    finally {
      await nitro.close()
    }

    let omittedFiles = 0
    for (const index of runs.keys()) {
      const run = JSON.parse(await readFile(join(publicDir, runDataPath(index, 'run')), 'utf8')) as PublishedRun
      omittedFiles += run.omitted.length
    }
    await mkdir(dirname(output), { recursive: true })
    await mkdir(output)
    try {
      for (const name of await readdir(publicDir))
        await cp(join(publicDir, name), join(output, name), { errorOnExist: true, force: false, recursive: true })
    }
    catch (error) {
      await rm(output, { force: true, recursive: true })
      throw error
    }
    return { omittedFiles, output, runKeys: runs.map(run => run.runKey) }
  }
  finally {
    await rm(scratch, { force: true, recursive: true })
  }
}
