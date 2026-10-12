import type { MaybeRefOrGetter } from 'vue'

import { useHead } from '@unhead/vue'
import { shallowRef, toValue, watch } from 'vue'

/** Outcome a favicon badge shows, after the three states of GitHub's CI favicon. */
type FaviconStatus = 'failure' | 'pending' | 'success'

/**
 * Keys of the favicon links; `App.vue` declares the plain logo under the same keys, so a page's badged icon replaces
 * it while the page is shown and the logo returns when the page goes.
 */
export const FAVICON_KEYS = { png: 'favicon-png', svg: 'favicon-svg' } as const

/** Badge colors (GitHub Primer: attention, danger, success), readable on light and dark tab strips. */
const badgeColors: Record<FaviconStatus, string> = { failure: '#cf222e', pending: '#d4a72c', success: '#1a7f37' }

/** Rendered icons per status; the logo and the badge never change, so each is drawn once per page load. */
const rendered = new Map<FaviconStatus, Promise<string>>()

/**
 * Shows the outcome of what the page is about in the browser tab icon, like GitHub's CI favicon: a yellow dot while
 * it runs, a red cross when it failed, a green check when it completed.
 *
 * Use when:
 * - a page follows one run, task, or case (run, task, and case pages)
 *
 * Expects:
 * - a state of the API (`RunState`, `TaskState`, `CaseState`); `undefined` while loading
 *
 * Returns:
 * - nothing; while the calling component is mounted the tab icon carries the badge, the plain logo otherwise
 */
export function useStatusFavicon(state: MaybeRefOrGetter<string | undefined>): void {
  const href = shallowRef<string>()
  let generation = 0
  watch(() => statusOf(toValue(state)), async (status) => {
    const mine = ++generation
    if (status == null) {
      href.value = undefined
      return
    }
    if (!rendered.has(status))
      rendered.set(status, draw(status))
    // A plain logo is better than a broken one: if drawing fails, the badge is left out (and tried again next time).
    const url = await rendered.get(status)!.catch(() => {
      rendered.delete(status)
      return undefined
    })
    if (mine === generation)
      href.value = url
  }, { immediate: true })

  useHead({
    link: () => (href.value == null
      ? []
      : [
          { href: href.value, key: FAVICON_KEYS.svg, rel: 'icon', type: 'image/png' },
          { href: href.value, key: FAVICON_KEYS.png, rel: 'icon', sizes: '64x64', type: 'image/png' },
        ]),
  })
}

/**
 * Draws the vieval logo with a status badge in its lower-right corner as a 64 px PNG data URL.
 *
 * A canvas, not an SVG: favicons render SVGs without loading the resources they reference, and the logo is itself an
 * SVG wrapping an embedded image. The badge sits in a transparent ring cut out of the logo, so it reads on any tab
 * color.
 */
async function draw(status: FaviconStatus): Promise<string> {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  const logo = new Image()
  logo.src = new URL('vieval-logo.svg', document.baseURI).href
  await logo.decode()
  context.drawImage(logo, 0, 0, size, size)

  // Badge center and radii in the 64 px grid: a 10 px dot inside a 14 px transparent ring, tucked into the corner so
  // the logo stays the larger part of the icon.
  const [x, y] = [50, 50]
  context.globalCompositeOperation = 'destination-out'
  context.beginPath()
  context.arc(x, y, 14, 0, Math.PI * 2)
  context.fill()
  context.globalCompositeOperation = 'source-over'
  context.fillStyle = badgeColors[status]
  context.beginPath()
  context.arc(x, y, 10, 0, Math.PI * 2)
  context.fill()

  // The glyph: a check for success, a cross for failure. Pending gets a white center: a plain yellow dot (GitHub's)
  // melts into the logo's yellow-orange gradient.
  if (status === 'pending') {
    context.fillStyle = '#fff'
    context.beginPath()
    context.arc(x, y, 3.5, 0, Math.PI * 2)
    context.fill()
    return canvas.toDataURL('image/png')
  }
  context.strokeStyle = '#fff'
  context.lineWidth = 3
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  if (status === 'success') {
    context.moveTo(x - 4.5, y)
    context.lineTo(x - 1, y + 3.5)
    context.lineTo(x + 5, y - 3.5)
  }
  else {
    context.moveTo(x - 3.5, y - 3.5)
    context.lineTo(x + 3.5, y + 3.5)
    context.moveTo(x + 3.5, y - 3.5)
    context.lineTo(x - 3.5, y + 3.5)
  }
  context.stroke()
  return canvas.toDataURL('image/png')
}

/**
 * Maps a run, task, or case state to the badge of the tab icon; states without a clear outcome get none.
 *
 * Before:
 * - "running", "stale", "queued" / "failed", "timeout", "interrupted", "unfinished" / "ended", "passed" / "legacy"
 *
 * After:
 * - "pending" / "failure" / "success" / undefined
 */
function statusOf(state: string | undefined): FaviconStatus | undefined {
  switch (state) {
    case 'ended':
    case 'passed':
      return 'success'
    case 'failed':
    case 'interrupted':
    case 'timeout':
    case 'unfinished':
      return 'failure'
    case 'queued':
    case 'running':
    case 'stale':
      return 'pending'
    default:
      return undefined
  }
}
