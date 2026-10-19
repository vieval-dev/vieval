import type { Preset } from 'unocss'

import { join } from 'node:path'

import { presetChromatic } from '@proj-airi/unocss-preset-chromatic'
import { defineConfig, presetIcons, presetWind4, transformerVariantGroup } from 'unocss'

import { DEFAULT_HUE } from './client/src/theme'

/**
 * Styles of the viewer UI.
 *
 * Colors of run/case states are shortcuts so every view paints `passed`, `failed`, … the same way; the status
 * hues are reserved for states and always ship with an icon and a label. Accents (links, selection, focus, the active
 * tab, progress) use `primary`, which follows the user's theme hue.
 */
export default defineConfig({
  content: {
    // NOTICE: also scan the sources from disk, so `virtual:uno.css` is complete even before a component module is
    // transformed (Vitest browser mode imports the stylesheet in its setup file, before the components).
    // The glob is anchored to this file: Vitest may run from the repository root.
    filesystem: [join(import.meta.dirname, 'client', 'src', '**', '*.{vue,ts}')],
  },
  presets: [
    presetWind4({
      dark: 'class',
      preflights: { reset: true },
    }),
    // `primary-*` follows `--chromatic-hue` at runtime, so the hue picker recolors the UI without a rebuild.
    // NOTICE:
    // The preset's declarations bundle their own copy of the `@unocss/core` types
    // (`@proj-airi/unocss-preset-chromatic/dist/shared-*.d.mts`) instead of importing them, so its `Preset` is not
    // assignable to this repository's `unocss` `Preset` although the runtime object is the same shape (airi's
    // `uno.config.ts` casts it the same way).
    // Removal condition: a preset release whose declarations import types from `@unocss/core`.
    presetChromatic({ baseHue: DEFAULT_HUE, colors: { primary: 0 } }) as Preset,
    presetIcons({
      // NOTICE: load the collection from this package; by default presetIcons resolves `@iconify-json/*` from the
      // process cwd, which is the repository root when Vitest runs every project, where the package is not installed.
      collections: { mingcute: () => import('@iconify-json/mingcute/icons.json', { with: { type: 'json' } }).then(module => module.default) },
      // NOTICE: presetIcons sets `width` / `height` but no `display`, so an icon `<span>` stays `inline` and its size
      // is ignored: outside a flex container (for example the check of the current breadcrumb switcher option, inside
      // an absolutely positioned indicator) the icon measured 0 × 0 and was invisible. Flex items are blockified,
      // which hid the problem everywhere else.
      extraProperties: { 'display': 'inline-block', 'vertical-align': 'middle' },
      scale: 1.1,
    }),
  ],
  shortcuts: {
    'badge': 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium leading-none whitespace-nowrap',
    // Ghost buttons: no border or fill until hovered, so toolbars read as text and icons, not as boxes.
    'btn': 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm text-neutral-700 dark:text-neutral-300 bg-transparent select-none transition-colors hover:bg-primary-500/10 active:bg-primary-500/20 focus-visible:(outline-2 outline-offset-1 outline-primary-500) disabled:(opacity-40 pointer-events-none)',
    // `!`: wins over the transparent `btn` background and its hover.
    'btn-active': 'bg-primary-500/15! text-primary-800! dark:text-primary-200! font-medium',
    'card': 'rounded-lg border border-neutral-200/50 dark:border-neutral-800/50 bg-white dark:bg-neutral-900',
    'card-title': 'flex items-center gap-2 px-3 py-2 text-sm font-semibold border-b border-neutral-200/50 dark:border-neutral-800/50',
    'floating': 'z-50 rounded-lg shadow-lg bg-white text-neutral-900 border border-neutral-200/50 dark:(bg-neutral-900 text-neutral-100 border-neutral-700/40)',
    'floating-arrow': 'fill-white dark:fill-neutral-900',
    // Square, icon-only ghost button; always pair it with `aria-label` and a tooltip (`IconButton.vue`).
    'icon-btn': 'inline-flex items-center justify-center size-7 shrink-0 rounded-md text-base text-neutral-600 dark:text-neutral-300 bg-transparent transition-colors hover:(bg-primary-500/10 text-primary-700 dark:text-primary-200) active:bg-primary-500/20 focus-visible:(outline-2 outline-offset-1 outline-primary-500) disabled:(opacity-40 pointer-events-none)',
    'link': 'text-primary-700 dark:text-primary-300 rounded-sm transition-colors hover:(text-primary-600 bg-primary-500/10) dark:hover:text-primary-200 decoration-primary-500/40 underline-offset-2',
    // Item of a reka-ui DropdownMenu; `data-highlighted` is set by keyboard and pointer alike.
    'menu-item': 'flex items-center gap-2 rounded-md px-2 py-1.5 outline-none cursor-pointer data-[highlighted]:(bg-primary-500/10 text-primary-800 dark:text-primary-200)',
    // Font only: list-like views (tables, timelines, events, logs) and raw content pick their own size.
    'mono': 'font-mono tabular-nums',
    'muted': 'text-neutral-500 dark:text-neutral-400',
    'option-trigger': 'inline-flex items-center gap-1.5 rounded-lg bg-neutral-500/10 px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-200 select-none transition-colors hover:bg-neutral-500/16 data-[state=open]:bg-neutral-500/22 focus-visible:(outline-2 outline-offset-1 outline-primary-500)',
    // Segmented control (`SegmentedControl.vue`, reka-ui ToggleGroup): a tinted track with the chosen item raised.
    // A gray track says "pick one of these"; the raised block (`segmented-indicator`, slid by `SegmentedControl.vue`)
    // marks the picked choice. `option-trigger` is the same gray for a control that opens a list of choices.
    'segmented': 'inline-flex items-center gap-0.5 rounded-lg bg-neutral-500/10 p-0.5 select-none',
    'segmented-indicator': 'absolute top-0.5 bottom-0.5 left-0 rounded-md bg-white shadow-sm dark:bg-neutral-700 pointer-events-none',
    'segmented-item': 'relative z-1 inline-flex items-center gap-1 rounded-md text-neutral-600 dark:text-neutral-300 transition-colors hover:text-neutral-900 dark:hover:text-neutral-100 focus-visible:(outline-2 outline-offset-1 outline-primary-500) data-[state=on]:(text-primary-700 font-medium) dark:data-[state=on]:text-primary-200',
    // Selected row of a list (sidebar, file lists, JSONL rows).
    'selected': 'bg-primary-500/15 text-primary-900 dark:text-primary-100',
    // Placeholder block of `LoadingSkeleton.vue`; `.skeleton` in styles.css sweeps a highlight across it.
    'skeleton': 'rounded-md bg-neutral-500/12 dark:bg-neutral-500/16',
    // State badges read the `--mark-*` / `--ink-*` tokens of `client/src/styles.css`, so the colorblind-safe mode
    // (`data-color-vision`) recolors them with the bars and charts. The tint is the mark mixed into the surface.
    'state-failed': '[background-color:color-mix(in_oklab,var(--mark-failed)_16%,transparent)] [color:var(--ink-failed)]',
    // No result and execution trouble: `errored`, `timeout`, interrupted runs, retries, stale runs, warnings.
    'state-interrupted': '[background-color:color-mix(in_oklab,var(--mark-errored)_16%,transparent)] [color:var(--ink-errored)]',
    'state-neutral': 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
    'state-passed': '[background-color:color-mix(in_oklab,var(--mark-passed)_16%,transparent)] [color:var(--ink-passed)]',
    'state-running': '[background-color:color-mix(in_oklab,var(--mark-running)_16%,transparent)] [color:var(--ink-running)]',
    // The link covers its nearest positioned ancestor (a card); controls inside the card need `relative z-1`.
    'stretched-link': 'after:(content-[""] absolute inset-0)',
    // On/off setting (reka-ui Switch): a gray track that fills with the accent when on; the thumb slides with it.
    'switch': 'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-neutral-500/25 cursor-pointer select-none transition-colors data-[state=checked]:bg-primary-500 focus-visible:(outline-2 outline-offset-1 outline-primary-500) disabled:(opacity-40 pointer-events-none)',
    'switch-thumb': 'block size-3 rounded-full bg-white shadow-sm translate-x-0.5 transition-transform duration-200 data-[state=checked]:translate-x-3.5',
    // Tabs (`ViewTabs.vue`, reka-ui Tabs): the active trigger carries `data-state="active"`.
    'tab': 'inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 border-transparent muted whitespace-nowrap transition-colors hover:text-neutral-900 dark:hover:text-neutral-100 focus-visible:(outline-2 -outline-offset-2 outline-primary-500) data-[state=active]:(border-primary-500 text-neutral-900 dark:text-neutral-100 font-medium)',
    'td': 'px-2 py-1.5 text-sm align-top',
    'th': 'px-2 py-1.5 text-left text-xs font-medium muted whitespace-nowrap',
    // Floating surfaces (tooltips, popovers, menus, the breadcrumb switcher) share one look per color scheme: a dark
    // tooltip on light pages, and in the dark scheme a raised neutral surface with a hairline border instead of a
    // white box. Arrows use the matching `*-arrow` fill.
    'tooltip': 'z-50 rounded-md px-2 py-1 font-sans text-xs shadow-md select-none bg-neutral-900 text-neutral-50 dark:(bg-neutral-800 text-neutral-100 border border-neutral-700/40)',
    'tooltip-arrow': 'fill-neutral-900 dark:fill-neutral-800',
  },
  theme: {
    // Self-hosted by Fontsource (imported in `client/src/main.ts`), so the viewer also renders offline.
    // Quicksand has no CJK glyphs; Noto Sans SC covers them, loaded per unicode-range chunk on demand.
    font: {
      mono: '\'Maple Mono\', ui-monospace, SFMono-Regular, Menlo, Consolas, \'Noto Sans SC Variable\', monospace',
      sans: '\'Quicksand Variable\', \'Noto Sans Variable\', \'Noto Sans SC Variable\', system-ui, \'PingFang SC\', \'Hiragino Sans GB\', \'Microsoft YaHei\', sans-serif',
    },
  },
  transformers: [transformerVariantGroup()],
})
