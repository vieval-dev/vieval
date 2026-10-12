import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'

import LazyImage from './LazyImage.vue'

import { ApiError, imagePreview, rawUrl } from '../api'

/** 2×2 red PNG, served as the image's bytes. `vi.hoisted`: the `vi.mock` factory below runs before module constants. */
const { image } = vi.hoisted(() => ({ image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAxMDAAAAeAgEB1L2r7AAAAABJRU5ErkJggg==' }))

// NOTICE:
// `imagePreview` and `rawUrl` are the network boundary of `LazyImage` (the viewer server); the test has no server.
// Mocking the `../api` module keeps the component itself real.
// Removal condition: when component tests run against a fixture viewer server.
vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api')>()
  return { ...original, imagePreview: vi.fn(), rawUrl: vi.fn(() => image) }
})

/** ThumbHash of a real OSWorld screenshot (480 × 300). */
const thumbhash = '3/cNNIZ0gHB3d3doiIiQOKmfqw=='
const location = { path: 'task/case/frame.webp', runKey: 'run-1-a' }

afterEach(() => {
  vi.mocked(imagePreview).mockReset()
  vi.mocked(rawUrl).mockImplementation(() => image)
})

describe('lazyImage', () => {
  /**
   * @example
   * expect(screen.getByTestId('image-placeholder')).toBeInTheDocument()
   */
  it('shows the ThumbHash placeholder in the image size, then fades it out once the image loaded', async () => {
    vi.mocked(imagePreview).mockResolvedValue({ height: 300, thumbhash, width: 480 })
    const screen = await render(LazyImage, { props: { alt: 'Frame 1', loading: 'eager', location } })
    const placeholder = screen.getByTestId('image-placeholder')
    await expect.element(placeholder).toBeInTheDocument()
    await expect.element(placeholder).toHaveAttribute('src', expect.stringMatching(/^data:image\/png;base64,/))
    const img = screen.getByRole('img', { name: 'Frame 1' })
    await expect.element(img).toHaveAttribute('width', '480')
    await expect.element(img).toHaveAttribute('height', '300')
    // The placeholder fades out once the image fired `load`; it stays in the DOM to keep the box's size.
    await expect.element(placeholder, { timeout: 3000 }).toHaveAttribute('data-loaded', 'true')
    await expect.element(img).toHaveAttribute('src', image)
  })

  // ROOT CAUSE:
  //
  // Switching to the next frame of a screenshot sequence collapsed the image box to 0 × 0 until the new frame's
  // preview arrived: the image mounted only after its preview settled, and the sequence re-created the component per
  // frame. The page jumped and the frame flashed empty.
  //
  // We fixed this by keeping the component across frames, keeping the previous preview's size while the next one
  // loads (a sizer `<img>` in the flow), and keeping the previous image on screen until the next one loaded.
  /**
   * @example
   * expect(box.getBoundingClientRect().height).toBeGreaterThan(0)
   */
  it('keeps the box size and the previous image while the next frame loads', async () => {
    // One URL per frame (a fragment on the same data URL), so the component can tell the frames apart.
    vi.mocked(rawUrl).mockImplementation(at => `${image}#${at.path}`)
    let releaseNext!: () => void
    vi.mocked(imagePreview)
      .mockResolvedValueOnce({ height: 300, thumbhash, width: 480 })
      .mockImplementationOnce(() => new Promise(resolve => (releaseNext = () => resolve({ height: 300, thumbhash, width: 480 }))))
    const screen = await render(LazyImage, { props: { alt: 'Frame', loading: 'eager', location } })
    await expect.element(screen.getByTestId('image-placeholder'), { timeout: 3000 }).toHaveAttribute('data-loaded', 'true')
    const box = screen.getByTestId('lazy-image').element()
    const before = box.getBoundingClientRect().height
    expect(before).toBeGreaterThan(0)

    await screen.rerender({ alt: 'Frame', loading: 'eager', location: { ...location, path: 'task/case/frame-2.webp' } })

    // The next preview is still pending: same box, the previous image still on screen.
    expect(box.getBoundingClientRect().height).toBe(before)
    await expect.element(screen.getByTestId('image-previous')).toHaveAttribute('src', `${image}#task/case/frame.webp`)

    releaseNext()
    await expect.element(screen.getByTestId('image-placeholder'), { timeout: 3000 }).toHaveAttribute('data-loaded', 'true')
    expect(box.getBoundingClientRect().height).toBe(before)
  })

  /**
   * @example
   * expect(screen.container.querySelector('[data-testid="image-placeholder"]')).toBeNull()
   */
  it('shows the image without a placeholder when the server has no preview for it', async () => {
    vi.mocked(imagePreview).mockRejectedValue(new ApiError(415, 'Not an image'))
    const screen = await render(LazyImage, { props: { alt: 'Diagram', loading: 'eager', location } })
    const img = screen.getByRole('img', { name: 'Diagram' })
    await expect.element(img).toHaveAttribute('src', image)
    expect(screen.container.querySelector('[data-testid="image-placeholder"]')).toBeNull()
  })
})
