import type { ImagePreview } from '../shared/contract'

import { Buffer } from 'node:buffer'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'

import { Transformer } from '@napi-rs/image'
import { Semaphore } from 'es-toolkit'
import { rgbaToThumbHash } from 'thumbhash'

import { ViewerError } from './errors'
import { classifyPreview } from './files'

/**
 * Largest image file a preview is computed for. Decoding needs the whole file plus its pixels in memory; artifacts
 * and screenshots are far below this, and anything above it is refused with `413`.
 */
export const MAX_PREVIEW_SOURCE_BYTES = 50 * 1024 * 1024

/** Longest side of the image a ThumbHash is computed from; ThumbHash accepts at most 100 × 100 pixels. */
const THUMBHASH_MAX_SIDE = 100

/**
 * Options of {@link createImagePreviews}.
 */
export interface CreateImagePreviewsOptions {
  /**
   * Most previews kept in memory; the least recently used one is dropped first. One entry is about 100 bytes.
   *
   * @default 1000
   */
  cacheSize?: number
  /**
   * Most images decoded at the same time, so a filmstrip of hundreds of frames does not decode them all at once.
   *
   * @default 4
   */
  concurrency?: number
}

/**
 * Previews of image files, computed on demand.
 */
export interface ImagePreviews {
  /**
   * Size and ThumbHash of one image file.
   *
   * Throws `ViewerError`: `415` for a file that is not a raster image or cannot be decoded, `413` above
   * {@link MAX_PREVIEW_SOURCE_BYTES}, `404` when the file is missing.
   */
  preview: (filePath: string, contentType: string) => Promise<ImagePreview>
}

/**
 * Computes the size and ThumbHash of one encoded image (PNG, JPEG, WebP, AVIF, GIF, BMP, …).
 *
 * Throws:
 * - `ViewerError(415)` when the bytes cannot be decoded
 */
export async function computeImagePreview(bytes: Uint8Array): Promise<ImagePreview> {
  let width: number
  let height: number
  let pixels: Buffer
  let scaledWidth: number
  let scaledHeight: number
  try {
    ({ height, width } = await new Transformer(bytes).metadata())
    if (!(width > 0) || !(height > 0)) {
      throw new Error('empty image')
    }
    // Never upscale: an icon smaller than 100 px is hashed at its own size.
    const scale = Math.min(1, THUMBHASH_MAX_SIDE / Math.max(width, height))
    scaledWidth = Math.max(1, Math.round(width * scale))
    scaledHeight = Math.max(1, Math.round(height * scale))
    pixels = await new Transformer(bytes).resize(scaledWidth, scaledHeight).rawPixels()
  }
  catch {
    throw new ViewerError(415, 'Image cannot be decoded.')
  }

  const rgba = toRgba(pixels, scaledWidth * scaledHeight)
  return {
    height,
    thumbhash: Buffer.from(rgbaToThumbHash(scaledWidth, scaledHeight, rgba)).toString('base64'),
    width,
  }
}

/**
 * Creates the image preview cache of one viewer server.
 *
 * Use when:
 * - the API answers `/artifacts/preview` and `/evidence/:linkId/preview`
 *
 * Expects:
 * - `filePath` already resolved inside an allowed root (`resolveInsideRoot`); this module does not check roots
 *
 * Returns:
 * - previews cached by real path, size, and modification time (a file that is rewritten gets a new entry);
 *   concurrent requests for the same file share one decode, and failures are not cached
 */
export function createImagePreviews(options: CreateImagePreviewsOptions = {}): ImagePreviews {
  const cacheSize = options.cacheSize ?? 1000
  const decodes = new Semaphore(options.concurrency ?? 4)
  // A Map iterates in insertion order; re-inserting on every hit makes the first key the least recently used.
  const cache = new Map<string, Promise<ImagePreview>>()

  return {
    async preview(filePath, contentType) {
      if (classifyPreview(contentType, filePath) !== 'image' || isSvg(contentType, filePath)) {
        throw new ViewerError(415, 'Previews are only available for raster images.')
      }
      const info = await stat(filePath).catch(() => undefined)
      if (info == null || !info.isFile()) {
        throw new ViewerError(404, 'File not found.')
      }
      if (info.size > MAX_PREVIEW_SOURCE_BYTES) {
        throw new ViewerError(413, `Image is larger than ${MAX_PREVIEW_SOURCE_BYTES / 1024 / 1024} MiB; no preview is computed.`)
      }

      const key = `${filePath}\0${info.size}\0${info.mtimeMs}`
      let pending = cache.get(key)
      if (pending != null) {
        cache.delete(key)
        cache.set(key, pending)
        return await pending
      }

      pending = (async () => {
        await decodes.acquire()
        try {
          return await computeImagePreview(await readFile(filePath))
        }
        finally {
          decodes.release()
        }
      })()
      cache.set(key, pending)
      pending.catch(() => cache.delete(key))
      if (cache.size > cacheSize) {
        cache.delete(cache.keys().next().value!)
      }
      return await pending
    },
  }
}

function isSvg(contentType: string, filePath: string): boolean {
  return contentType.split(';')[0].trim().toLowerCase() === 'image/svg+xml' || extname(filePath).toLowerCase() === '.svg'
}

/**
 * Expands decoded pixels to 8-bit RGBA.
 *
 * NOTICE:
 * `Transformer#rawPixels()` of `@napi-rs/image` returns the pixels in the image's own color type, not always RGBA:
 * an opaque WebP screenshot (480 × 300, resized to 100 × 63) came back as 18900 bytes, i.e. 3 bytes per pixel,
 * while WebP/PNG files with alpha come back as RGBA. Passing an RGB buffer to `rgbaToThumbHash` as RGBA produced the
 * degenerate hash `AAAABIAAAAAAAAAAAAAAAAAAAA==`. The channel count is therefore derived from the buffer length.
 * 16-bit color types (6 or 8 bytes per pixel) are refused because their byte order is not documented.
 * Source: `node_modules/@napi-rs/image/index.d.ts` (`rawPixels(): Promise<Buffer>`, no color type option).
 * Removal condition: `@napi-rs/image` gains an option to always return RGBA8.
 *
 * Before:
 * - gray `[v]`, gray+alpha `[v, a]`, RGB `[r, g, b]`
 *
 * After:
 * - `[v, v, v, 255]`, `[v, v, v, a]`, `[r, g, b, 255]`
 */
function toRgba(pixels: Uint8Array, pixelCount: number): Uint8Array {
  const channels = pixels.length / pixelCount
  if (channels === 4) {
    return pixels
  }
  if (channels !== 1 && channels !== 2 && channels !== 3) {
    throw new ViewerError(415, 'Image has an unsupported pixel format.')
  }
  const rgba = new Uint8Array(pixelCount * 4)
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const source = pixel * channels
    const target = pixel * 4
    const gray = channels < 3
    rgba[target] = pixels[source]
    rgba[target + 1] = gray ? pixels[source] : pixels[source + 1]
    rgba[target + 2] = gray ? pixels[source] : pixels[source + 2]
    rgba[target + 3] = channels === 2 ? pixels[source + 1] : 255
  }
  return rgba
}
