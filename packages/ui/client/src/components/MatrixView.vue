<script setup lang="ts">
import type { MatrixCell } from '../../../src/shared/contract'
import type { Baseline, MatrixAxis } from '../matrixGrid'
import type { Segment } from './SegmentedControl.vue'

import { useQuery } from '@pinia/colada'
import { useElementSize, useMediaQuery, useStorage, useWindowSize } from '@vueuse/core'
import { DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuItemIndicator, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AnimatedContent from './AnimatedContent.vue'
import CompletionRing from './CompletionRing.vue'
import MarginBar from './MarginBar.vue'
import MatrixTable from './MatrixTable.vue'
import SegmentedControl from './SegmentedControl.vue'
import StateView from './StateView.vue'

import { api } from '../api'
import { useCatalog } from '../composables/useCatalog'
import { formatCount, formatScore, shortTaskId } from '../format'
import { axisMeans, buildGrid, chooseLayout, defaultAveraged, matrixAxes, meanOf, typicalCaseCount } from '../matrixGrid'

/**
 * Matrix of a project or experiment (`GET /api/matrix`): one grid per eval entry. A cell is the newest run that covered
 * that combination fully (see `MatrixCell.latest`), with the trend of every run.
 *
 * The axes are laid out to fill the width with columns and let rows run long ({@link chooseLayout}); repeat axes
 * (`seed`, `repeat`) are averaged into one cell. A grid shows cards while they fit the screen, and compact cells (a
 * filled number that opens its card on hover) once there are too many; the reader can pin either. Picking a baseline
 * value for any of the axes (`method = text`, `view = online`) turns every cell into its difference from the cell with
 * those values and its own on the other axes.
 *
 * Configurations the project moved away from (every cell `superseded`, for example an eval axis dropped since) are
 * left out until asked for, so the table opens on what the newest runs measure.
 *
 * Call stack:
 *
 * MatrixView
 *   -> {@link matrixAxes} (varying and shared axes of an entry)
 *   -> {@link chooseLayout} (cards and compact, for the width)
 *   -> {@link buildGrid}
 *     -> MatrixTable (headers, margins, cells)
 *       -> MatrixHeatCell | MatrixCellCard
 */
const props = defineProps<{ experiment?: string, project: string, workspace: string }>()
const { t } = useI18n()

const matrix = useQuery({
  key: () => ['matrix', { experiment: props.experiment ?? null, project: props.project, workspace: props.workspace }],
  query: () => api.matrix({ experiment: props.experiment, project: props.project, workspace: props.workspace }),
})

// The catalog polls every run; when a run of this scope advanced, its cells (scores, counts, state) are re-read.
const catalog = useCatalog()
const scopeRuns = computed(() => catalog.runsIn({ experiment: props.experiment, project: props.project, workspace: props.workspace }))
watch(() => scopeRuns.value.map(run => `${run.runKey}:${run.lastSeq}`).join(','), () => void matrix.refetch())

type ViewChoice = 'auto' | 'cards' | 'compact'
/** The reader's pick of cell view, kept across pages: automatic until they pin one. */
const viewChoice = useStorage<ViewChoice>('vieval:matrix-view', 'auto')
const viewItems = computed<Segment<ViewChoice>[]>(() => [
  { icon: 'i-mingcute-magic-2-line', label: t('matrix.mode.auto'), value: 'auto' },
  { icon: 'i-mingcute-grid-line', label: t('matrix.mode.compact'), value: 'compact' },
  { icon: 'i-mingcute-layout-grid-line', label: t('matrix.mode.cards'), value: 'cards' },
])
const sort = shallowRef(false)
/** Baseline value per axis key; an axis without one keeps each cell's own value. */
const baseline = shallowRef<Baseline>({})
/** Axes the reader averages; `undefined` keeps the default (the repeat axes of each entry). */
const averagedChoice = shallowRef<string[]>()
const showSuperseded = shallowRef(false)

const root = useTemplateRef<HTMLElement>('root')
const { width } = useElementSize(root)
const { height: windowHeight } = useWindowSize()
// Cards are `w-44 md:w-56` (MatrixTable); the layout needs the same width to know how many fit.
const wideCards = useMediaQuery('(min-width: 768px)')

// NOTICE:
// Header widths are measured with a canvas in the viewer's font, so the layout knows how wide a column of model names
// is before it renders. The font may not be loaded on the first pass; the estimate is close enough to choose a layout.
const measure = document.createElement('canvas').getContext('2d')
function textWidth(text: string): number {
  if (measure == null)
    return text.length * 7
  measure.font = '500 12px "Quicksand Variable", system-ui, sans-serif'
  return measure.measureText(text).width
}

/** Superseded configurations, one label per entry and eval row, for the fold toggle. */
const supersededLabels = computed(() => {
  const labels = (matrix.data.value?.cells ?? []).filter(cell => cell.superseded).map(cell => Object.entries(cell.eval).map(([axis, value]) => `${axis} ${value}`).join(' · ') || cell.evalRowId)
  return [...new Set(labels)]
})

/** Pixels a grid's cells may take: the card's width less the row margin (bar and mean) and the table's padding. */
const MARGIN_COLUMN_PX = 140
/** Height of a card row, to tell whether the cards of a grid fit about one screen. */
const CARD_ROW_PX = 170

const grids = computed(() => {
  const response = matrix.data.value
  if (response == null)
    return []
  const byEntry = new Map<string, MatrixCell[]>()
  for (const cell of response.cells) {
    if (cell.superseded && !showSuperseded.value)
      continue
    byEntry.set(cell.entryId, [...(byEntry.get(cell.entryId) ?? []), cell])
  }
  const available = Math.max(320, width.value - MARGIN_COLUMN_PX)
  return [...byEntry.entries()].map(([entryId, cells]) => {
    const { shared, varying } = matrixAxes(cells, response)
    const averaged = (averagedChoice.value ?? defaultAveraged(varying)).filter(key => varying.some(axis => axis.key === key))
    const cards = chooseLayout(varying, averaged, { available, cellWidth: wideCards.value ? 232 : 184, textWidth })
    const compact = chooseLayout(varying, averaged, { available, cellWidth: 64, textWidth })
    const cardRows = cards.layout.rows.reduce((count, key) => count * (varying.find(axis => axis.key === key)?.values.length ?? 1), 1)
    // Cards while they fit the width and about a screen and a half of height; past that, compact cells.
    const automatic = cards.fits && cardRows * CARD_ROW_PX <= windowHeight.value * 1.5 ? 'cards' : 'compact'
    const view = viewChoice.value === 'auto' ? automatic : viewChoice.value
    const layout = { ...(view === 'cards' ? cards : compact).layout }
    // Compared axes go innermost, so each baseline cell sits next to the cells measured against it.
    const compared = (keys: string[]) => [...keys.filter(key => !(key in baseline.value)), ...keys.filter(key => key in baseline.value)]
    layout.rows = compared(layout.rows)
    layout.columns = compared(layout.columns)
    const grid = buildGrid(cells, varying, layout)
    const flat = grid.cells.flat()
    return {
      axes: varying,
      entryId,
      grid,
      incomplete: flat.filter(cell => cell?.completion != null).length,
      means: axisMeans(cells, varying),
      missing: flat.filter(cell => cell == null).length,
      name: shortTaskId(entryId).split('/').at(-1) ?? entryId,
      shared: shared.map(axis => `${axis.name} ${axis.value}`).join(' · '),
      typical: typicalCaseCount(cells),
      view,
    }
  })
})

/** Axes that can be averaged or compared, across the grids (an axis of one entry only applies to that entry). */
const layoutAxes = computed(() => {
  const byKey = new Map<string, MatrixAxis>()
  for (const grid of grids.value) {
    for (const axis of grid.axes)
      byKey.set(axis.key, { ...axis, values: [...new Set([...(byKey.get(axis.key)?.values ?? []), ...axis.values])] })
  }
  return [...byKey.values()]
})
/**
 * Mean score of each axis value across the entries (the mean of each entry's main effect), shown beside the values in
 * the menus so a pick says what it compares to, and an average what it hides.
 */
const valueMeans = computed(() => {
  const merged = new Map<string, Map<string, null | number>>()
  for (const axis of layoutAxes.value) {
    merged.set(axis.key, new Map(axis.values.map(value => [
      value,
      meanOf(grids.value.map(grid => grid.means.get(axis.key)?.get(value)).filter((mean): mean is number => mean != null)),
    ])))
  }
  return merged
})
/** Every value mean of every axis, for the shared scales of the menu marks. */
const allValueMeans = computed(() => [...valueMeans.value.values()].flatMap(means => [...means.values()]).filter((mean): mean is number => mean != null))
/** Highest value mean: the full length of the baseline menu's bars, so bars of different axes compare. */
const valueMeanScale = computed(() => Math.max(0, ...allValueMeans.value))
/**
 * Where a value mean sits between the lowest and the highest of all axes (0–1), for the dots of the average menu: a
 * scale from 0 would make a 40 % and a 57 % look alike.
 */
function dotPosition(mean: number): number {
  const low = Math.min(...allValueMeans.value)
  const high = Math.max(...allValueMeans.value)
  return high > low ? (mean - low) / (high - low) : 0.5
}
/** How far apart an axis's values score (highest mean less lowest), what averaging the axis would hide. */
function spreadOf(key: string): null | number {
  const means = [...(valueMeans.value.get(key)?.values() ?? [])].filter((mean): mean is number => mean != null)
  return means.length < 2 ? null : Math.max(...means) - Math.min(...means)
}
const meanOfValue = (key: string, value: string) => valueMeans.value.get(key)?.get(value) ?? null
const averagedKeys = computed(() => new Set(grids.value.flatMap(grid => grid.grid.layout.averaged)))
const baselineAxes = computed(() => layoutAxes.value.filter(axis => !averagedKeys.value.has(axis.key)))
/**
 * Radio value of "each cell's own" in an axis's baseline group. An axis value can be any string, including `''` (cells
 * without the axis), so the choice needs a value no axis can have.
 */
const OWN_VALUE = '\u0000'
const hasBaseline = computed(() => Object.keys(baseline.value).length > 0)
/** Picks the baseline value of one axis; `null` lets the axis keep each cell's own value again. */
function pickBaseline(key: string, value: null | string): void {
  const next = { ...baseline.value }
  if (value == null)
    delete next[key]
  else
    next[key] = value
  baseline.value = next
}
const baselineText = computed(() => {
  const picked = Object.entries(baseline.value)
  if (picked.length === 0)
    return t('matrix.baseline.none')
  return picked.map(([key, value]) => `${layoutAxes.value.find(axis => axis.key === key)?.name ?? key} = ${value || '—'}`).join(' · ')
})
function toggleAveraged(key: string, on: boolean): void {
  const current = [...averagedKeys.value]
  averagedChoice.value = on ? [...current, key] : current.filter(item => item !== key)
  if (on && key in baseline.value)
    pickBaseline(key, null)
}
const averagedText = computed(() => {
  const names = layoutAxes.value.filter(axis => averagedKeys.value.has(axis.key)).map(axis => axis.name)
  return names.length === 0 ? t('matrix.averaged.none') : names.join(', ')
})
const anyCompact = computed(() => grids.value.some(grid => grid.view === 'compact'))
const anyIncomplete = computed(() => grids.value.some(grid => grid.incomplete > 0))
</script>

<template>
  <StateView :error="matrix.error.value" :loading="matrix.isPending.value" :empty="grids.length === 0" :empty-text="t('matrix.view.empty')" :empty-hint="t('matrix.view.emptyHint')" skeleton="matrix" @retry="matrix.refetch()">
    <div ref="root" :class="['flex flex-col gap-3']">
      <div :class="['flex flex-wrap items-center gap-2']" data-testid="matrix-toolbar">
        <SegmentedControl v-model="viewChoice" :items="viewItems" :label="t('matrix.mode.label')" size="md" data-testid="matrix-view-mode" />
        <DropdownMenuRoot v-if="layoutAxes.length > 0">
          <DropdownMenuTrigger :class="['option-trigger max-w-60']" data-testid="matrix-averaged">
            <span :class="['muted shrink-0']">{{ t('matrix.averaged.label') }}</span><span :class="['truncate']">{{ averagedText }}</span><span class="i-mingcute-down-line muted" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent as-child align="start" :side-offset="6" :collision-padding="12" :class="['floating min-w-64 p-1 text-sm']">
              <AnimatedContent>
                <DropdownMenuLabel :class="['px-2 py-1 text-xs muted max-w-72']">
                  {{ t('matrix.averaged.hint') }}
                </DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  v-for="axis in layoutAxes" :key="axis.key"
                  :model-value="averagedKeys.has(axis.key)" :class="['menu-item']"
                  @select.prevent @update:model-value="(on: boolean | 'indeterminate') => toggleAveraged(axis.key, on === true)"
                >
                  <span :class="['size-4 shrink-0 grid place-items-center']">
                    <DropdownMenuItemIndicator><span class="i-mingcute-check-line" aria-hidden="true" /></DropdownMenuItemIndicator>
                  </span>
                  <span :class="['truncate']">{{ axis.name }}</span>
                  <span
                    :class="['ml-auto relative h-2 w-20 shrink-0 rounded-full bg-neutral-500/12']"
                    :title="axis.values.map(value => `${value || '—'}: ${formatScore(meanOfValue(axis.key, value))}`).join('\n')"
                    data-testid="matrix-averaged-spread"
                  >
                    <!-- One dot per value on the scale every axis shares; a wide spread is what averaging would hide. -->
                    <template v-for="value in axis.values" :key="value">
                      <span
                        v-if="meanOfValue(axis.key, value) != null"
                        :class="['absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--series-1)] opacity-80']"
                        :style="{ left: `${dotPosition(meanOfValue(axis.key, value)!) * 100}%` }"
                      />
                    </template>
                  </span>
                  <span :class="['w-10 text-right text-xs muted tabular-nums']" :title="t('matrix.averaged.spread')">{{ spreadOf(axis.key) == null ? '' : (spreadOf(axis.key)! * 100).toFixed(1) }}</span>
                </DropdownMenuCheckboxItem>
              </AnimatedContent>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
        <DropdownMenuRoot v-if="baselineAxes.length > 0">
          <DropdownMenuTrigger :class="['option-trigger max-w-72']" data-testid="matrix-baseline">
            <span :class="['muted shrink-0']">{{ t('matrix.baseline.label') }}</span><span :class="['truncate']">{{ baselineText }}</span><span class="i-mingcute-down-line muted" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent as-child align="start" :side-offset="6" :collision-padding="12" :class="['floating min-w-72 p-1 text-sm']">
              <AnimatedContent>
                <div :class="['max-h-[min(28rem,var(--reka-dropdown-menu-content-available-height))] overflow-y-auto']">
                  <DropdownMenuLabel :class="['px-2 py-1 text-xs muted max-w-64']">
                    {{ t('matrix.baseline.hint') }}
                  </DropdownMenuLabel>
                  <template v-for="(axis, index) in baselineAxes" :key="axis.key">
                    <DropdownMenuLabel :class="['px-2 py-1 text-xs font-medium', index > 0 && 'mt-2']">
                      {{ axis.name }}
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      :model-value="baseline[axis.key] ?? OWN_VALUE"
                      @update:model-value="value => pickBaseline(axis.key, typeof value === 'string' && value !== OWN_VALUE ? value : null)"
                    >
                      <DropdownMenuRadioItem :value="OWN_VALUE" :class="['menu-item']" @select.prevent>
                        <span :class="['size-4 shrink-0 grid place-items-center']">
                          <DropdownMenuItemIndicator><span class="i-mingcute-check-line" aria-hidden="true" /></DropdownMenuItemIndicator>
                        </span>
                        <span :class="['muted']">{{ t('matrix.baseline.own') }}</span>
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem v-for="value in axis.values" :key="value" :value="value" :class="['menu-item']" @select.prevent>
                        <span :class="['size-4 shrink-0 grid place-items-center']">
                          <DropdownMenuItemIndicator><span class="i-mingcute-check-line" aria-hidden="true" /></DropdownMenuItemIndicator>
                        </span>
                        <span :class="['truncate']">{{ value || '—' }}</span>
                        <span v-if="meanOfValue(axis.key, value) != null" :class="['ml-auto flex items-center gap-2 pl-3 text-xs muted tabular-nums']" data-testid="matrix-baseline-mean">
                          <MarginBar :value="meanOfValue(axis.key, value)!" :scale="valueMeanScale" :diverging="false" />
                          <span :class="['w-9 text-right']">{{ formatScore(meanOfValue(axis.key, value)) }}</span>
                        </span>
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </template>
                </div>
                <template v-if="hasBaseline">
                  <DropdownMenuItem :class="['menu-item mt-2']" @select="baseline = {}">
                    <span class="i-mingcute-close-line size-4" aria-hidden="true" />{{ t('matrix.baseline.clearAll') }}
                  </DropdownMenuItem>
                </template>
              </AnimatedContent>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
        <button type="button" :class="['btn', sort && 'btn-active']" :aria-pressed="sort" data-testid="matrix-sort" @click="sort = !sort">
          <span class="i-mingcute-sort-descending-line" aria-hidden="true" />{{ t('matrix.sort') }}
        </button>
        <button v-if="supersededLabels.length > 0" type="button" :class="['btn ml-auto']" :title="supersededLabels.join('\n')" data-testid="matrix-toggle-superseded" @click="showSuperseded = !showSuperseded">
          <span :class="[showSuperseded ? 'i-mingcute-eye-close-line' : 'i-mingcute-history-line']" aria-hidden="true" />
          {{ t(showSuperseded ? 'matrix.view.hideSuperseded' : 'matrix.view.showSuperseded', { n: formatCount(supersededLabels.length) }, supersededLabels.length) }}
        </button>
      </div>

      <p :class="['flex flex-wrap items-center gap-x-4 gap-y-1 text-xs muted']" data-testid="matrix-legend">
        <span>{{ t('matrix.view.intro', { n: formatCount(matrix.data.value?.runCount ?? 0) }, matrix.data.value?.runCount ?? 0) }}</span>
        <span v-if="anyCompact && !hasBaseline" :class="['inline-flex items-center gap-1.5']">
          <span :class="['inline-block w-16 h-2 rounded-sm']" :style="{ background: 'linear-gradient(90deg, color-mix(in oklab, var(--series-1) 10%, transparent), var(--series-1))' }" aria-hidden="true" />{{ t('matrix.legend.scale') }}
        </span>
        <span v-if="hasBaseline" :class="['inline-flex items-center gap-1.5']">
          <span :class="['inline-block w-16 h-2 rounded-sm']" :style="{ background: 'linear-gradient(90deg, var(--series-3), transparent, var(--series-1))' }" aria-hidden="true" />{{ t('matrix.legend.delta', { baseline: baselineText }) }}
        </span>
        <span v-if="anyCompact && !hasBaseline" :class="['inline-flex items-center gap-1.5']">
          <span :class="['inline-block size-3 rounded-sm outline-2 outline -outline-offset-2 outline-neutral-900 dark:outline-neutral-100']" aria-hidden="true" />{{ t('matrix.legend.best') }}
        </span>
        <span v-if="anyIncomplete" :class="['inline-flex items-center gap-1.5']">
          <CompletionRing :completion="{ errored: 1, expected: 4, failed: 0, running: false, scored: 2 }" :size="12" />{{ t('matrix.legend.ring') }}
        </span>
      </p>

      <section v-for="entry in grids" :key="entry.entryId" :class="['card overflow-hidden']" :data-testid="`matrix-${entry.entryId}`">
        <h2 :class="['card-title flex-wrap']" :title="shortTaskId(entry.entryId)">
          <span class="i-mingcute-layout-grid-line" aria-hidden="true" />{{ entry.name }}
          <span :class="['text-xs font-normal muted']">
            {{ [entry.shared, t('matrix.view.casesEach', { n: formatCount(entry.typical) }, entry.typical), entry.incomplete > 0 ? t('matrix.view.incomplete', { n: formatCount(entry.incomplete) }, entry.incomplete) : '', entry.missing > 0 ? t('matrix.view.missing', { n: formatCount(entry.missing) }, entry.missing) : ''].filter(Boolean).join(' · ') }}
          </span>
        </h2>
        <div :class="['overflow-auto max-h-[80vh] p-2']">
          <MatrixTable
            :grid="entry.grid" :axes="entry.axes" :view="entry.view" :baseline="baseline" :sort="sort"
            :definitions="matrix.data.value?.scoreDefinitions ?? []" :text-width="textWidth" :room="width"
          />
        </div>
      </section>
    </div>
  </StateView>
</template>
