import type { GenericSchema } from 'valibot'

import { Buffer } from 'node:buffer'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Transformer } from '@napi-rs/image'
import { rgbaToThumbHash, thumbHashToApproximateAspectRatio, thumbHashToRGBA } from 'thumbhash'
import { afterEach, describe, expect, it } from 'vitest'

import * as v from 'valibot'

import {
  cleanupTemporaryDirectories,
  copyOsworldFixture,
  createTestApp,
  fixturesDirectory,
  OSWORLD_RUNS,
} from '../../test/helpers'
import { errorResponseSchema, imagePreviewSchema } from '../shared/contract'
import { computeImagePreview, createImagePreviews } from './preview'

afterEach(cleanupTemporaryDirectories)

/** OSWorld screenshot of the fixture: a 1920 × 1080 WebP. */
const OSWORLD_WEBP = join(
  fixturesDirectory,
  'osworld',
  '.vieval',
  'episodes',
  '06fe7178-4491-4589-810f-2e2bc9502122',
  '2026-10-11T19-14-06.064Z-gpt-5.5-r1',
  'auv-runs',
  'artifacts',
  'ef8e83be-bb57-3c0c-d366-3c2add975efe',
  '01a12c64-f338-757a-a79a-76ca615a4ca3.webp',
)
const ARCHIVED = 'run-1791746045991-a77ba0a4'
const FAILED_CASE = '1:chrome%2F06fe7178-4491-4589-810f-2e2bc9502122'
const q = encodeURIComponent

/** A PNG with an alpha channel: left half opaque red, right half transparent. */
async function createAlphaPng(width: number, height: number): Promise<Buffer> {
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      pixels.set(x < width / 2 ? [255, 0, 0, 255] : [0, 0, 0, 0], offset)
    }
  }
  return await Transformer.fromRgbaPixels(pixels, width, height).png()
}

/** An opaque lossy WebP: left half red, right half blue. Decodes to 3 bytes per pixel. */
async function createOpaqueWebp(width: number, height: number): Promise<Buffer> {
  const pixels = new Uint8Array(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel++) {
    pixels.set(pixel % width < width / 2 ? [230, 20, 20, 255] : [20, 20, 230, 255], pixel * 4)
  }
  return await Transformer.fromRgbaPixels(pixels, width, height).webp(90)
}

function decodeHash(thumbhash: string): Uint8Array {
  return new Uint8Array(Buffer.from(thumbhash, 'base64'))
}

function expectSchema<T>(schema: GenericSchema<unknown, T>, value: unknown): T {
  const result = v.safeParse(schema, value)
  if (!result.success) {
    throw new Error(`Response does not match the contract: ${JSON.stringify(v.flatten(result.issues))}`)
  }
  return result.output
}

/** OSWorld fixture with an `artifacts/` directory added to the archived run. */
async function setupWithArtifacts() {
  const { reportRoot, vievalDirectory } = await copyOsworldFixture()
  const artifactsDirectory = join(reportRoot, OSWORLD_RUNS.archived, 'artifacts', 'task', 'case')
  await mkdir(artifactsDirectory, { recursive: true })
  await copyFile(OSWORLD_WEBP, join(artifactsDirectory, 'screen.webp'))
  await writeFile(join(artifactsDirectory, 'alpha.png'), await createAlphaPng(64, 32))
  await writeFile(join(artifactsDirectory, 'notes.txt'), 'not an image')
  await writeFile(join(artifactsDirectory, 'broken.png'), 'not a png either')
  await writeFile(join(artifactsDirectory, 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
  return createTestApp({ reportRoots: [reportRoot], vievalDirectory })
}

describe('computeImagePreview', () => {
  /**
   * @example
   * expect(rgba[left]).toBeGreaterThan(rgba[left + 2])
   */
  it('hashes an opaque WebP (3 bytes per decoded pixel) from its real colors', async () => {
    // ROOT CAUSE:
    //
    // `rawPixels()` of `@napi-rs/image` returns 3 bytes per pixel for images without alpha (an opaque 480 × 300
    // WebP screenshot resized to 100 × 63 came back as 18900 bytes). Passing that buffer to `rgbaToThumbHash` as
    // RGBA read every fourth byte as alpha and shifted all colors:
    //
    // rgbaToThumbHash(w, h, await transformer.rawPixels())
    //
    // We fixed this by deriving the channel count from the buffer length and expanding to RGBA (alpha 255).
    const bytes = await createOpaqueWebp(48, 30)
    const decoded = await new Transformer(bytes).rawPixels()
    expect(decoded.length).toBe(48 * 30 * 3)

    const preview = await computeImagePreview(bytes)
    expect(preview).toMatchObject({ height: 30, width: 48 })
    const { h, rgba, w } = thumbHashToRGBA(decodeHash(preview.thumbhash))
    const left = (Math.floor(h / 2) * w) * 4
    const right = (Math.floor(h / 2) * w + w - 1) * 4
    // Left half red, right half blue, fully opaque.
    expect(rgba[left]).toBeGreaterThan(rgba[left + 2])
    expect(rgba[right + 2]).toBeGreaterThan(rgba[right])
    expect(rgba[left + 3]).toBe(255)

    // What the code computed before the fix: the RGB buffer passed as RGBA.
    const naive = Buffer.from(rgbaToThumbHash(48, 30, decoded)).toString('base64')
    expect(preview.thumbhash).not.toBe(naive)
  })

  /**
   * @example
   * expect(preview).toMatchObject({ height: 1080, width: 1920 })
   */
  it('reads the size of the OSWorld WebP screenshot', async () => {
    const preview = await computeImagePreview(await readFile(OSWORLD_WEBP))
    expect(preview).toMatchObject({ height: 1080, width: 1920 })
    expect(thumbHashToApproximateAspectRatio(decodeHash(preview.thumbhash))).toBeCloseTo(1920 / 1080, 0)
  })

  /**
   * @example
   * expect(thumbHashToRGBA(hash).rgba[3]).toBeGreaterThan(200)
   */
  it('keeps the alpha channel of an RGBA PNG', async () => {
    const preview = await computeImagePreview(await createAlphaPng(64, 32))
    expect(preview).toMatchObject({ height: 32, width: 64 })
    const { rgba, w } = thumbHashToRGBA(decodeHash(preview.thumbhash))
    // Top-left pixel: opaque red; top-right pixel: (almost) transparent.
    expect(rgba[3]).toBeGreaterThan(200)
    expect(rgba[0]).toBeGreaterThan(rgba[1])
    expect(rgba[(w - 1) * 4 + 3]).toBeLessThan(60)
  })

  /**
   * @example
   * await expect(computeImagePreview(bytes)).rejects.toMatchObject({ status: 415 })
   */
  it('refuses bytes that are not an image with 415', async () => {
    await expect(computeImagePreview(new TextEncoder().encode('not an image'))).rejects.toMatchObject({ status: 415 })
  })
})

describe('createImagePreviews', () => {
  /**
   * @example
   * expect(first).toBe(second)
   */
  it('shares one result between concurrent and repeated requests for the same file', async () => {
    const previews = createImagePreviews()
    const [first, second] = await Promise.all([
      previews.preview(OSWORLD_WEBP, 'image/webp'),
      previews.preview(OSWORLD_WEBP, 'image/webp'),
    ])
    expect(first).toBe(second)
    expect(await previews.preview(OSWORLD_WEBP, 'image/webp')).toBe(first)
  })
})

describe('preview routes', () => {
  /**
   * @example
   * expect(preview).toMatchObject({ height: 1080, width: 1920 })
   */
  it('returns the size and a decodable ThumbHash of an artifact image', async () => {
    const { json } = await setupWithArtifacts()
    const preview = expectSchema(imagePreviewSchema, await json(`/api/runs/${ARCHIVED}/artifacts/preview?path=${q('task/case/screen.webp')}`))
    expect(preview).toMatchObject({ height: 1080, width: 1920 })
    const hash = decodeHash(preview.thumbhash)
    expect(thumbHashToRGBA(hash).rgba.length).toBeGreaterThan(0)
    expect(thumbHashToApproximateAspectRatio(hash)).toBeCloseTo(1920 / 1080, 0)

    const alpha = expectSchema(imagePreviewSchema, await json(`/api/runs/${ARCHIVED}/artifacts/preview?path=${q('task/case/alpha.png')}`))
    expect(alpha).toMatchObject({ height: 32, width: 64 })
  })

  /**
   * @example
   * expect(response.status).toBe(415)
   */
  it.each([
    ['task/case/notes.txt', 415],
    ['task/case/broken.png', 415],
    ['task/case/vector.svg', 415],
    ['task/case/missing.png', 404],
    ['../run-summary.json', 403],
    ['', 400],
  ])('answers artifact preview of %j with %i', async (path, status) => {
    const { get } = await setupWithArtifacts()
    const response = await get(`/api/runs/${ARCHIVED}/artifacts/preview?path=${q(path)}`)
    expect(response.status).toBe(status)
    expectSchema(errorResponseSchema, await response.json())
  })

  /**
   * @example
   * expect(preview.width).toBe(1920)
   */
  it('returns the preview of an OSWorld evidence screenshot', async () => {
    const { get, json } = await setupWithArtifacts()
    const [link] = await json<Array<{ id: string }>>(`/api/runs/${ARCHIVED}/evidence?caseId=${q(FAILED_CASE)}`)
    const path = 'auv-runs/artifacts/ef8e83be-bb57-3c0c-d366-3c2add975efe/01a12c64-f338-757a-a79a-76ca615a4ca3.webp'
    const preview = expectSchema(imagePreviewSchema, await json(`/api/runs/${ARCHIVED}/evidence/${link.id}/preview?path=${q(path)}`))
    expect(preview).toMatchObject({ height: 1080, width: 1920 })

    expect((await get(`/api/runs/${ARCHIVED}/evidence/${link.id}/preview?path=${q('result.json')}`)).status).toBe(415)
    expect((await get(`/api/runs/${ARCHIVED}/evidence/${link.id}/preview?path=${q('../../reports')}`)).status).toBe(403)
  })
})
