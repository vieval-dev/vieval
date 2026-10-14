import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createCaseArtifacts } from './case-artifacts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async directory => rm(directory, { force: true, recursive: true })))
})

async function createRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vieval-case-artifacts-'))
  temporaryDirectories.push(directory)
  return directory
}

/**
 * @example
 * describe('createCaseArtifacts', () => {})
 */
describe('createCaseArtifacts', () => {
  /**
   * @example
   * it('places the case directory under normalized task and case segments', async () => {})
   */
  it('places the case directory under normalized task and case segments', async () => {
    const root = await createRoot()
    const artifacts = createCaseArtifacts(root, 'evals%2Fepisodes::default::run=repeat%3D1', '0:chrome%2Fopen')

    /**
     * @example
     * expect(artifacts.directory).toBe(join(root, 'evals-2Fepisodes-default-run-repeat-3D1', '0-chrome-2Fopen'))
     */
    expect(artifacts.directory).toBe(join(root, 'evals-2Fepisodes-default-run-repeat-3D1', '0-chrome-2Fopen'))
  })

  /**
   * @example
   * it('writes a body as <name> and describes it relative to the artifacts root', async () => {})
   */
  it('writes a body as <name> and describes it relative to the artifacts root', async () => {
    const root = await createRoot()
    const artifacts = createCaseArtifacts(root, 'task', 'case')

    const recorded = await artifacts.record('result.json', { body: '{"ok":true}', contentType: 'application/json' })

    /**
     * @example
     * expect(recorded).toEqual({ contentType: 'application/json', name: 'result.json', path: 'task/case/result.json', size: 11 })
     */
    expect(recorded).toEqual({ contentType: 'application/json', name: 'result.json', path: 'task/case/result.json', size: 11 })
    expect(await readFile(join(root, 'task', 'case', 'result.json'), 'utf-8')).toBe('{"ok":true}')
  })

  /**
   * @example
   * it('references a file already inside the case directory without copying it', async () => {})
   */
  it('references a file already inside the case directory without copying it', async () => {
    const root = await createRoot()
    const artifacts = createCaseArtifacts(root, 'task', 'case')
    const screenshotPath = join(artifacts.directory, 'step-1.webp')
    await writeFile(screenshotPath, 'pixels')

    const recorded = await artifacts.record('first step', { contentType: 'image/webp', path: screenshotPath, purpose: 'display_capture' })

    /**
     * @example
     * expect(recorded).toEqual({ contentType: 'image/webp', name: 'first step', path: 'task/case/step-1.webp', purpose: 'display_capture', size: 6 })
     */
    expect(recorded).toEqual({ contentType: 'image/webp', name: 'first step', path: 'task/case/step-1.webp', purpose: 'display_capture', size: 6 })
    // No copy named after the artifact was made.
    await expect(readFile(join(artifacts.directory, 'first-step'), 'utf-8')).rejects.toThrow()
  })

  /**
   * @example
   * expect(recorded.label).toEqual({ 'en': 'Final screen', 'zh-Hans': '最终画面' })
   */
  it('carries the label and description viewers show for the file', async () => {
    const root = await createRoot()
    const artifacts = createCaseArtifacts(root, 'task', 'case')

    const recorded = await artifacts.record('final.webp', {
      body: 'pixels',
      contentType: 'image/webp',
      description: 'Screen after the agent said it was done.',
      label: { 'en': 'Final screen', 'zh-Hans': '最终画面' },
    })

    expect(recorded.label).toEqual({ 'en': 'Final screen', 'zh-Hans': '最终画面' })
    expect(recorded.description).toBe('Screen after the agent said it was done.')
  })

  /**
   * @example
   * it('copies a file from outside the case directory in as <name>', async () => {})
   */
  it('copies a file from outside the case directory in as <name>', async () => {
    const root = await createRoot()
    const outside = await createRoot()
    const sourcePath = join(outside, 'bridge.log')
    await writeFile(sourcePath, 'bridge output')
    const artifacts = createCaseArtifacts(root, 'task', 'case')

    const recorded = await artifacts.record('bridge-setup.log', { contentType: 'text/plain', path: sourcePath })

    /**
     * @example
     * expect(recorded.path).toBe('task/case/bridge-setup.log')
     */
    expect(recorded.path).toBe('task/case/bridge-setup.log')
    expect(await readFile(join(root, 'task', 'case', 'bridge-setup.log'), 'utf-8')).toBe('bridge output')
  })

  /**
   * @example
   * it('rejects calls with both or neither of body and path', async () => {})
   */
  it('rejects calls with both or neither of body and path', async () => {
    const artifacts = createCaseArtifacts(await createRoot(), 'task', 'case')

    /**
     * @example
     * await expect(artifacts.record('x', { contentType: 'text/plain' })).rejects.toThrow('exactly one of')
     */
    await expect(artifacts.record('x', { contentType: 'text/plain' })).rejects.toThrow('exactly one of')
    await expect(artifacts.record('x', { body: 'a', contentType: 'text/plain', path: 'a.txt' })).rejects.toThrow('exactly one of')
  })

  /**
   * @example
   * it('keeps a name of .. inside the case directory', async () => {})
   */
  it('keeps a name of .. inside the case directory', async () => {
    const root = await createRoot()
    const artifacts = createCaseArtifacts(root, 'task', 'case')

    const recorded = await artifacts.record('..', { body: 'x', contentType: 'text/plain' })

    /**
     * @example
     * expect(recorded.path).toBe('task/case/-')
     */
    expect(recorded.path).toBe('task/case/-')
  })
})
