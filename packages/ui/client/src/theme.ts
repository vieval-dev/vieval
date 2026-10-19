import { VAR_HUE } from '@proj-airi/unocss-preset-chromatic'

/**
 * CSS variable of the theme hue. `@proj-airi/unocss-preset-chromatic` (`uno.config.ts`) builds the `primary` palette
 * from it at runtime, so the user can pick any hue (sidebar header) without rebuilding the CSS.
 */
export const HUE_VARIABLE = VAR_HUE

/**
 * Default hue (OKLCH degrees) when the user has not picked one; also the preset's `baseHue` in `uno.config.ts`.
 *
 * Orange of the vieval logo (`docs/content/public/apple-touch-icon.png`: OKLCH hue median ~58, range ~37-91),
 * nudged towards red so it stays apart from the interrupted amber (~70). Other state colors (passed green ~150, failed
 * red ~25, running blue ~255) are far enough that an accent is not mistaken for a state.
 *
 * NOTICE: keep in sync with `client/public/scheme.js`, which applies the stored hue before the app mounts and cannot
 * import modules.
 */
export const DEFAULT_HUE = 55

/** `localStorage` key of the picked hue; `client/public/scheme.js` reads the same key. */
export const HUE_STORAGE_KEY = 'vieval-viewer:hue'

/**
 * How state colors are drawn: `default` keeps the green / red / amber / blue state colors; `safe` swaps them for a
 * colorblind-safe set (`[data-color-vision='safe']` in `styles.css`). The theme hue is not affected.
 */
export type ColorVision = 'default' | 'safe'

/**
 * Normalizes a stored or picked hue to a degree from 0 to 360, falling back to {@link DEFAULT_HUE}.
 *
 * Before:
 * - "220.4", 400, Number.NaN
 *
 * After:
 * - 220.4, 360, 55
 */
export function normalizeHue(value: unknown): number {
  const hue = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(hue) ? Math.min(360, Math.max(0, hue)) : DEFAULT_HUE
}

/** `localStorage` key of the picked color vision mode; `client/public/scheme.js` reads the same key. */
export const COLOR_VISION_STORAGE_KEY = 'vieval-viewer:color-vision'

/**
 * Normalizes a stored color vision mode, falling back to `default`.
 *
 * Before:
 * - "safe", "deutan", null
 *
 * After:
 * - "safe", "default", "default"
 */
export function normalizeColorVision(value: unknown): ColorVision {
  return value === 'safe' ? 'safe' : 'default'
}
