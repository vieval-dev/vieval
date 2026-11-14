import type { PublishedCatalog, PublishedComparison } from './shared/publishedReport'

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { H3 } from 'h3'

import { projectComparisonRun } from './server/comparisonRun'
import { createEvidenceService } from './server/evidence'
import { isAllowedPath } from './server/files'
import { publishRun } from './server/publishRun'
import { createRunStore } from './server/store'
import { CATALOG_PATH, runDataPath, telemetryPath } from './shared/publishedReport'

/** Build-time inputs sent to the isolated Nitro prerenderer. */
export interface ReportPrerenderOptions {
  /** Fixed timestamp used to compute the report. */
  at: number
  /** Selected runs, in publication order. */
  catalog: PublishedCatalog
  /** Built Viewer directory. */
  clientDir: string
  /** Additional allowed evidence roots. */
  evidenceRoots: string[]
  /** Whether the reader may access linked evidence. */
  includeEvidence: boolean
  /** Canonical destination, checked against linked evidence. */
  output: string
  /** Scratch public output directory used by Nitro. */
  publicDir: string
  /** Input report roots. */
  reportRoots: string[]
}

/**
 * Creates the H3 application that Nitro prerenders into a static publication.
 *
 * Use when:
 * - Nitro loads the generated build entry for a selected set of runs
 *
 * Expects:
 * - the Vue build and the selected runs remain available for the duration of prerendering
 *
 * Returns:
 * - routes for the Viewer shell, report data, and optional raw telemetry
 */
export function createReportPrerender(options: ReportPrerenderOptions): H3 {
  const store = createRunStore({ reportRoots: options.reportRoots })
  const reportDirectories = options.reportRoots.map(root => dirname(root))
  const evidence = createEvidenceService({
    evidenceRoots: [...reportDirectories, ...options.evidenceRoots],
    logDirectories: options.includeEvidence ? reportDirectories.map(directory => join(directory, 'logs')) : [],
  })

  const app: H3 = new H3()
  app.get('/index.html', async () => {
    const html = await readFile(join(options.clientDir, 'index.html'), 'utf8')
    return new Response(html.replace(/<head(?:\s[^>]*)?>/i, '$&<meta name="vieval-report" content="static">'), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  })
  app.get(`/${CATALOG_PATH}`, () => options.catalog)

  for (const [index, item] of options.catalog.runs.entries()) {
    // Resolve each selected run once within the worker. The route paths are independent of report IDs.
    let resolved: ReturnType<typeof store.get> | undefined
    const handle = () => resolved ??= store.get(item.runKey)
    app.get(`/${runDataPath(index, 'run')}`, async () => {
      const run = await handle()
      if (run == null || ['running', 'stale', 'unsupported'].includes(run.state(options.at)))
        throw new Error(`Run "${item.runKey}" is no longer a supported completed report.`)
      return publishRun(run, evidence, options)
    })
    app.get(`/${runDataPath(index, 'comparison')}`, async (): Promise<PublishedComparison> => {
      const run = await handle()
      if (run == null)
        throw new Error(`Run "${item.runKey}" no longer exists.`)
      const { item: _item, ...comparison } = projectComparisonRun(run, options.at)
      return comparison
    })
    for (const signal of ['logs', 'metrics', 'traces'] as const) {
      app.get(`/${telemetryPath(index, signal)}`, async () => {
        const run = await handle()
        if (run?.reportDirectory == null)
          return new Response(null, { status: 404 })
        const file = await isAllowedPath([run.reportDirectory], join(run.reportDirectory, 'otlp', `${signal}.json`))
        if (!file.allowed || !file.exists)
          return new Response(null, { status: 404 })
        const data = await readFile(file.realPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT')
            throw error
          return undefined
        })
        return data == null
          ? new Response(null, { status: 404 })
          : new Response(data, { headers: { 'content-type': 'application/json' } })
      })
    }
  }

  return app
}
