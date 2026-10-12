<script setup lang="ts">
import type { ArtifactDescriptor } from '../../../src/shared/contract'
import type { Frame } from './ImageSequence.vue'

import { computed, shallowRef, watch } from 'vue'

import ArtifactViewer from './ArtifactViewer.vue'
import ImageSequence from './ImageSequence.vue'
import StateView from './StateView.vue'

import { formatBytes } from '../format'

/**
 * Artifacts of a case: a list grouped by preview kind, the selected artifact's viewer, and a sequence player when
 * the case recorded several images (screenshots).
 */
const props = defineProps<{ artifacts: ArtifactDescriptor[], runKey: string }>()

const kindIcons: Record<ArtifactDescriptor['previewKind'], string> = {
  audio: 'i-mingcute-file-music-line',
  binary: 'i-mingcute-file-unknown-line',
  html: 'i-mingcute-file-code-line',
  image: 'i-mingcute-pic-line',
  json: 'i-mingcute-braces-line',
  jsonl: 'i-mingcute-table-line',
  text: 'i-mingcute-document-line',
  toml: 'i-mingcute-file-more-line',
  video: 'i-mingcute-video-line',
  yaml: 'i-mingcute-file-more-line',
}

const images = computed(() => props.artifacts.filter(artifact => artifact.previewKind === 'image'))
const frames = computed<Frame[]>(() => images.value.map(artifact => ({ caption: artifact.purpose, label: artifact.name, location: { path: artifact.path, runKey: props.runKey } })))
/** `sequence` selects the image player; otherwise the path of the selected artifact. */
const selected = shallowRef<string>()
watch(() => props.artifacts, (list) => {
  if (selected.value == null || (selected.value !== 'sequence' && !list.some(artifact => artifact.path === selected.value)))
    selected.value = images.value.length > 1 ? 'sequence' : list[0]?.path
}, { immediate: true })
const current = computed(() => props.artifacts.find(artifact => artifact.path === selected.value))
</script>

<template>
  <StateView :empty="props.artifacts.length === 0" empty-text="No artifacts" empty-hint="Cases record files with context.recordArtifact(name, { body | path, contentType })." data-testid="artifacts-panel">
    <!-- Narrow screens stack the artifact list (shorter) above the preview. -->
    <div :class="['grid gap-3 grid-cols-1 md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]']">
      <ul :class="['flex flex-col gap-0.5 text-sm max-h-[70vh] max-md:max-h-48 overflow-auto']" aria-label="Artifacts">
        <li v-if="images.length > 1">
          <button type="button" :class="['flex items-center gap-1.5 w-full rounded px-2 py-1 text-left', selected === 'sequence' ? 'selected' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800']" @click="selected = 'sequence'">
            <span class="i-mingcute-photo-album-line shrink-0" aria-hidden="true" /><span class="truncate">Image sequence</span><span class="text-xs muted ml-auto">{{ images.length }} frames</span>
          </button>
        </li>
        <li v-for="artifact in props.artifacts" :key="artifact.path">
          <button type="button" :class="['flex items-center gap-1.5 w-full rounded px-2 py-1 text-left', selected === artifact.path ? 'selected' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800']" :title="artifact.path" :data-kind="artifact.previewKind" @click="selected = artifact.path">
            <span :class="[kindIcons[artifact.previewKind], 'shrink-0 muted']" aria-hidden="true" />
            <span class="text-xs mono truncate">{{ artifact.name }}</span>
            <span v-if="artifact.source === 'directory'" class="badge state-neutral" title="Found in the case folder without an artifact.recorded event">dir</span>
            <span class="text-xs muted ml-auto whitespace-nowrap">{{ formatBytes(artifact.size) }}</span>
          </button>
        </li>
      </ul>
      <div :class="['min-w-0']">
        <ImageSequence v-if="selected === 'sequence'" :frames="frames" />
        <ArtifactViewer v-else-if="current" :key="current.path" :location="{ path: current.path, runKey: props.runKey }" :name="current.name" :preview-kind="current.previewKind" :size="current.size" :content-type="current.contentType" />
      </div>
    </div>
  </StateView>
</template>
