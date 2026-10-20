<script setup lang="ts">
import type { PreviewKind } from '../../../src/shared/contract'
import type { FileLocation } from '../api'
import type { Segment } from './SegmentedControl.vue'

import { errorMessageFrom } from '@moeru/std'
import { useQuery } from '@pinia/colada'
import { parse as parseToml } from 'smol-toml'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { parse as parseYaml } from 'yaml'

import IconButton from './IconButton.vue'
import JsonlTable from './JsonlTable.vue'
import LazyImage from './LazyImage.vue'
import ObjectTree from './ObjectTree.vue'
import SegmentedControl from './SegmentedControl.vue'
import StateView from './StateView.vue'

import { jsonlPage, rawUrl, readText } from '../api'
import { formatBytes } from '../format'

/**
 * Shows one file by its preview kind. Artifacts of a run and files of evidence directories use the same viewer.
 *
 * - image, video, audio: native elements reading the `raw` route (Range requests let media seek)
 * - jsonl: virtualized table paged from the server's line index
 * - json, yaml, toml: parsed into one object tree (parse errors show the text)
 * - text: the first 1 MiB as text
 * - html: a sandboxed iframe without `allow-scripts` / `allow-same-origin`; the server adds a CSP `sandbox` too
 * - binary: no preview, the size and type, the first bytes as hex, and a download link
 */
const props = defineProps<{
  contentType: string
  location: FileLocation
  name: string
  previewKind: PreviewKind
  size: number
}>()

const { t } = useI18n()

/** Text and structured files are read up to this size; larger files show the head and a download link. */
const maxTextBytes = 1024 * 1024

const src = computed(() => rawUrl(props.location))
const download = computed(() => rawUrl(props.location, true))
const structuredView = shallowRef<'source' | 'tree'>('tree')
const structuredViews = computed<Segment<'source' | 'tree'>[]>(() => [{ icon: 'i-mingcute-sitemap-line', label: t('cases.viewer.tree'), value: 'tree' }, { icon: 'i-mingcute-code-line', label: t('cases.viewer.source'), value: 'source' }])

/** What the preview of a text-like or binary file needs, read once per file. */
interface Preview {
  /** First bytes of a binary file as hex rows. */
  hex?: string
  /**
   * Parsed value of a structured file, or why it is shown as text: too large to parse, or the parser's message
   * (translated when shown, so a cached preview follows the language).
   */
  parsed?: { failure?: { message?: string, reason: 'parse' } | { reason: 'size' }, value?: unknown }
  text?: { text: string, total: number, truncated: boolean }
}

// Every file is its own cache entry, so switching files quickly never shows the previous file's content.
// Keyed by the file's identity, not the `location` object, which a parent may rebuild on every render.
const preview = useQuery({
  key: () => ['file-preview', props.location.runKey, props.location.linkId ?? null, props.location.path, props.previewKind],
  query: () => loadPreview(props.location, props.previewKind),
})

/** Reads what the preview of `kind` shows: parsed structured data, text, or the first bytes as hex. */
async function loadPreview(location: FileLocation, kind: PreviewKind): Promise<Preview> {
  if (kind !== 'json' && kind !== 'yaml' && kind !== 'toml' && kind !== 'text' && kind !== 'binary')
    return {}
  if (kind === 'binary') {
    // The hex preview is optional: if it cannot be read, the notice and the download link still show.
    const response = await fetch(rawUrl(location), { headers: { Range: 'bytes=0-255' } }).catch(() => undefined)
    if (!response?.ok)
      return {}
    const bytes = new Uint8Array(await response.arrayBuffer()).slice(0, 256)
    return { hex: [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(' ').replace(/((?:\S\S ){16})/g, '$1\n') }
  }
  const text = await readText(location, maxTextBytes)
  if (kind === 'text')
    return { text }
  if (text.truncated)
    return { parsed: { failure: { reason: 'size' } }, text }
  try {
    return { parsed: { value: kind === 'json' ? JSON.parse(text.text) : kind === 'yaml' ? parseYaml(text.text) : parseToml(text.text) }, text }
  }
  catch (caught) {
    return { parsed: { failure: { message: errorMessageFrom(caught), reason: 'parse' } }, text }
  }
}
const text = computed(() => preview.data.value?.text)
const parsed = computed(() => preview.data.value?.parsed)
const hex = computed(() => preview.data.value?.hex)
const failure = computed(() => {
  const value = parsed.value?.failure
  if (value == null)
    return undefined
  return value.reason === 'size'
    ? t('cases.viewer.tooLarge', { size: formatBytes(maxTextBytes) })
    : t('cases.viewer.parseFailed', { format: props.previewKind.toUpperCase(), message: value.message ?? t('cases.viewer.unknownError') })
})

const loadJsonl = computed(() => {
  const location = props.location
  return (offset: number, limit: number) => jsonlPage(location, offset, limit)
})
</script>

<template>
  <div :class="['flex flex-col gap-2 min-w-0']" data-testid="artifact-viewer" :data-preview-kind="props.previewKind">
    <div :class="['flex items-center gap-2 text-xs flex-wrap']">
      <span :class="['badge state-neutral uppercase']">{{ props.previewKind }}</span>
      <span class="font-medium break-all">{{ props.name }}</span>
      <span class="muted">{{ props.contentType }} · {{ formatBytes(props.size) }}</span>
      <div :class="['ml-auto flex items-center gap-0.5']">
        <IconButton :href="src" new-tab icon="i-mingcute-external-link-line" :label="t('cases.viewer.openRaw')" />
        <IconButton :href="download" :download="props.name" icon="i-mingcute-download-2-line" :label="t('cases.viewer.downloadFile')" />
      </div>
    </div>

    <div v-if="props.previewKind === 'image'" :class="['flex justify-center rounded-lg bg-neutral-100 dark:bg-neutral-950 p-2']">
      <LazyImage :key="src" :location="props.location" :alt="props.name" loading="eager" :img-class="['max-h-[65vh] max-w-full object-contain']" />
    </div>

    <video v-else-if="props.previewKind === 'video'" :src="src" controls preload="metadata" :class="['max-h-[65vh] max-w-full rounded bg-black']" />

    <div v-else-if="props.previewKind === 'audio'" :class="['rounded border border-neutral-200/50 dark:border-neutral-800/50 p-3']">
      <audio :src="src" controls preload="metadata" :class="['w-full']" />
    </div>

    <JsonlTable v-else-if="props.previewKind === 'jsonl'" :load="loadJsonl" />

    <template v-else-if="props.previewKind === 'html'">
      <p class="text-xs muted flex gap-1 items-center">
        <span class="i-mingcute-safety-certificate-line text-green-600" aria-hidden="true" />{{ t('cases.viewer.sandboxed') }}
      </p>
      <iframe :src="src" sandbox="" referrerpolicy="no-referrer" :title="props.name" :class="['w-full h-[60vh] rounded border border-neutral-200/50 dark:border-neutral-800/50 bg-white']" data-testid="html-sandbox" />
    </template>

    <StateView v-else :error="preview.error.value" :loading="preview.isPending.value" skeleton="media" @retry="preview.refetch()">
      <template v-if="props.previewKind === 'binary'">
        <div :class="['rounded border border-dashed border-neutral-300/60 dark:border-neutral-700/40 p-4 flex flex-col items-center gap-2 text-center']" data-testid="binary-notice">
          <span class="i-mingcute-file-forbid-line text-3xl muted" aria-hidden="true" />
          <div class="font-medium">
            {{ t('cases.viewer.noPreview') }}
          </div>
          <div class="text-sm muted">
            {{ t('cases.viewer.binaryHint', { size: formatBytes(props.size), type: props.contentType }) }}
          </div>
          <a :href="download" :class="['btn btn-active']" :download="props.name"><span class="i-mingcute-download-2-line" aria-hidden="true" />{{ t('cases.viewer.downloadName', { name: props.name }) }}</a>
          <details v-if="hex" :class="['w-full text-left']">
            <summary class="text-xs muted cursor-pointer">
              {{ t('cases.viewer.hexHead', { n: Math.min(256, props.size) }) }}
            </summary>
            <pre :class="['mono text-[11px] p-2 overflow-auto']">{{ hex }}</pre>
          </details>
        </div>
      </template>
      <template v-else-if="props.previewKind === 'text'">
        <p v-if="text?.truncated" class="text-xs muted">
          {{ t('cases.viewer.showingHead', { size: formatBytes(maxTextBytes), total: formatBytes(text.total) }) }}
        </p>
        <StateView :empty="text?.total === 0" :empty-text="t('cases.viewer.emptyFile')">
          <pre :class="['mono text-xs leading-5 p-3 overflow-auto max-h-[65vh] rounded bg-neutral-50 dark:bg-neutral-950 border border-neutral-200/50 dark:border-neutral-800/50 whitespace-pre-wrap break-all']" data-testid="text-view">{{ text?.text }}</pre>
        </StateView>
      </template>
      <template v-else>
        <div v-if="failure" :class="['text-xs rounded state-interrupted px-2 py-1']">
          {{ failure }}
        </div>
        <div>
          <SegmentedControl v-model="structuredView" :items="structuredViews" :label="t('cases.viewer.showAs')" />
        </div>
        <div v-if="structuredView === 'tree' && parsed?.value !== undefined" :class="['rounded border border-neutral-200/50 dark:border-neutral-800/50 p-2 overflow-auto max-h-[65vh]']">
          <ObjectTree :value="parsed.value" :expand-depth="2" />
        </div>
        <pre v-else :class="['mono text-xs p-3 overflow-auto max-h-[65vh] rounded bg-neutral-50 dark:bg-neutral-950 border border-neutral-200/50 dark:border-neutral-800/50']">{{ text?.text }}</pre>
      </template>
    </StateView>
  </div>
</template>
