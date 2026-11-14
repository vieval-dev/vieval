import type { EvidenceLink, ExternalLogsResponse, PreviewKind } from '../shared/contract'
import type { PublishedRun } from '../shared/publishedReport'
import type { EvidenceService } from './evidence'
import type { RunHandle } from './store'

import { createHash } from 'node:crypto'
import { copyFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { fileKey } from '../shared/publishedReport'
import { ViewerError } from './errors'
import { isAllowedPath, isInside, listTree, resolveInsideRoot, staticFileExtension } from './files'
import { buildOtelLogs, buildOtelMetrics, buildOtelTraces } from './otel'
import { buildCaseDetail, buildMetrics, buildProgress, buildScores, buildSnapshot, buildTimeline, findCase, listArtifacts } from './views'

/**
 * Materializes a completed run and copies the files that its static Viewer can open.
 *
 * Use when:
 * - the Nitro prerenderer publishes one selected run
 *
 * Expects:
 * - the site's files directory exists and the evidence service knows the allowed roots
 *
 * Returns:
 * - the report data with relative file URLs and a list of unavailable or excluded files
 */
export async function publishRun(handle: RunHandle, evidence: EvidenceService, options: { at: number, includeEvidence: boolean, output: string, publicDir: string }): Promise<PublishedRun> {
  const { at, includeEvidence, output, publicDir } = options
  const reducer = handle.reducer()
  const snapshot = buildSnapshot(handle, evidence, at)
  const files: PublishedRun['files'] = {}
  const omitted: PublishedRun['omitted'] = []
  const evidenceViews: PublishedRun['evidenceViews'] = Object.create(null)
  const tasks: PublishedRun['tasks'] = Object.create(null)

  async function publishFile(root: string, path: string, linkId?: string): Promise<void> {
    const key = fileKey(path, linkId)
    if (files[key] != null)
      return
    try {
      const source = await resolveInsideRoot(root, path)
      if (isInside(output, source) || isInside(source, output))
        throw new Error('Export output must not overlap linked files.')

      const name = createHash('sha256').update(JSON.stringify([handle.runKey, key])).digest('hex')
      const target = `files/${name}${staticFileExtension(path)}`
      await copyFile(source, join(publicDir, target))
      files[key] = target
    }
    catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (!(error instanceof ViewerError) && code !== 'ENOENT' && code !== 'EISDIR')
        throw error
      omitted.push({ path: linkId == null ? path : `evidence/${linkId}/${path}`, reason: error instanceof ViewerError ? error.message : 'File is unavailable.' })
    }
  }

  function portablePreview<T extends { path: string, previewKind?: PreviewKind }>(item: T): T {
    return item.previewKind === 'html' || (item.previewKind === 'image' && staticFileExtension(item.path) === '.bin')
      ? { ...item, previewKind: 'binary' }
      : item
  }

  const artifactRoot = handle.artifactsRoot()
  const root = artifactRoot == null || handle.reportDirectory == null
    ? undefined
    : await isAllowedPath([handle.reportDirectory], artifactRoot)
  const artifacts = []
  for (const artifact of await listArtifacts(handle, {})) {
    if (!root?.allowed || !root.exists) {
      omitted.push({ path: artifact.path, reason: 'Run has no allowed artifact directory.' })
      continue
    }
    await publishFile(root.realPath, artifact.path)
    if (files[fileKey(artifact.path)] != null)
      artifacts.push(portablePreview(artifact))
  }

  const links: EvidenceLink[] = []
  for (const source of await evidence.links(reducer)) {
    const path = `evidence/${source.id}/${source.path.split(/[\\/]/).filter(Boolean).at(-1) ?? source.id}`
    if (!includeEvidence || !source.allowed || !source.exists) {
      const reason = includeEvidence ? source.reason ?? 'Evidence is unavailable.' : 'External evidence was not included.'
      omitted.push({ path, reason })
      links.push({ ...source, allowed: false, path, reason, summary: undefined })
      continue
    }
    const link = await evidence.find(reducer, source.id)
    const target = await isAllowedPath(evidence.roots, link.realPath)
    if (!target.allowed || !target.exists) {
      const reason = 'Evidence is unavailable.'
      omitted.push({ path, reason })
      links.push({ ...source, allowed: false, path, reason, summary: undefined })
      continue
    }
    if (isInside(target.realPath, output) || isInside(output, target.realPath))
      throw new Error('Export output must not overlap linked evidence.')
    links.push({ ...source, path })
    if (link.kind !== 'directory') {
      omitted.push({ path, reason: 'The Viewer opens evidence directories.' })
      continue
    }
    const tree = await listTree(target.realPath)
    for (const entry of tree.entries) {
      if (entry.kind === 'file')
        await publishFile(target.realPath, entry.path, link.id)
    }
    const timeline = link.adapter === 'osworld' ? await evidence.screenshotTimeline(link) : undefined
    const entries = tree.entries.filter(entry => entry.kind !== 'file' || files[fileKey(entry.path, link.id)] != null)
    evidenceViews[link.id] = {
      timeline: timeline == null ? undefined : { ...timeline, frames: timeline.frames.filter(frame => files[fileKey(frame.path, link.id)] != null) },
      tree: { ...tree, entries: entries.map(portablePreview) },
    }
  }

  for (const task of snapshot.tasks) {
    const cases: PublishedRun['tasks'][string]['cases'] = Object.create(null)
    for (const { caseId } of task.cases) {
      const scope = { caseId, taskId: task.id }
      const detail = await buildCaseDetail(handle, evidence, task.id, caseId)
      const caseEvidence = links.filter(link => link.taskId === task.id && link.caseId === caseId)
      let externalLogs: ExternalLogsResponse | undefined
      if (caseEvidence.some(link => link.allowed)) {
        const reduced = findCase(handle, task.id, caseId)
        let offset: null | number = 0
        while (offset != null) {
          const page = await evidence.externalLogs(reducer, reduced, { limit: 2000, offset })
          externalLogs ??= { ...page, files: page.files.map(file => ({ ...file, path: basename(file.path) })), lines: [], nextOffset: null }
          for (const line of page.lines)
            externalLogs.lines.push({ ...line, file: basename(line.file) })
          offset = page.nextOffset
        }
      }
      cases[caseId] = {
        detail: {
          ...detail,
          artifacts: artifacts.filter(artifact => artifact.taskId === task.id && artifact.caseId === caseId),
          evidence: caseEvidence,
        },
        externalLogs,
        timeline: buildTimeline(handle, scope),
      }
    }
    const scope = { taskId: task.id }
    tasks[task.id] = { cases, metrics: buildMetrics(handle, scope), timeline: buildTimeline(handle, scope) }
  }

  return {
    evidenceViews,
    files,
    logs: [...reducer.logs],
    metrics: buildMetrics(handle, {}),
    omitted,
    otel: { logs: buildOtelLogs(handle), metrics: buildOtelMetrics(handle), traces: buildOtelTraces(handle) },
    progress: buildProgress(handle, at),
    scores: buildScores(handle),
    snapshot,
    tasks,
    timeline: buildTimeline(handle, {}),
  }
}
