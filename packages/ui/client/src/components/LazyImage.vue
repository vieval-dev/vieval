<script setup lang="ts">
import type { FileLocation } from '../api'

import { UnLazyImage } from '@unlazy/vue/components'
import { thumbHashToDataURL } from 'thumbhash'
import { computed, shallowRef, watch } from 'vue'

import { imagePreview, rawUrl } from '../api'
import { useResource } from '../composables/useResource'

/**
 * Image of a run artifact or an evidence file that loads with a blurred ThumbHash placeholder.
 *
 * The server sends the image's size and ThumbHash first (`/preview`). A sizer `<img>` (the placeholder, or a
 * transparent pixel) sits in the flow with the image's width, height, and classes, and the image lies on top of it,
 * so the box has the image's size before any byte of the image arrives. When `location` changes (the next frame of a
 * sequence), the size of the previous image is kept until the new preview arrives and the previous image stays visible
 * until the new one loaded: the box never collapses and the frame never flashes empty. Files without a preview (SVG,
 * undecodable files, older servers) show the image as it loads, without a placeholder.
 *
 * After the `@nolebase/vitepress-plugin-thumbnail-hash` image component (`UnLazyImage` + a fading placeholder).
 */
const props = defineProps<{
  alt: string
  /** Classes of the image, which size the box (for example `max-h-[50vh] max-w-full object-contain`). */
  imgClass?: string | string[]
  /** `eager` for the image the user is looking at; `lazy` (the default) for thumbnails in long lists. */
  loading?: 'eager' | 'lazy'
  location: FileLocation
}>()

/** 1 × 1 transparent GIF: the sizer of an image whose preview has no ThumbHash. */
const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

const preview = useResource(() => [props.location.runKey, props.location.linkId, props.location.path] as const, () => imagePreview(props.location), { keepData: true })
const src = computed(() => rawUrl(props.location))
const loaded = shallowRef(false)
/** Last image that finished loading; shown under a newer one until that one loaded. */
const shown = shallowRef<string>()
watch(src, () => (loaded.value = false))

function onLoad(): void {
  loaded.value = true
  shown.value = src.value
}

const thumbhash = computed(() => preview.data.value?.thumbhash)
const placeholder = computed(() => {
  if (thumbhash.value == null)
    return undefined
  // The API sends the ThumbHash as base64; `thumbhash` decodes bytes.
  return thumbHashToDataURL(Uint8Array.from(atob(thumbhash.value), character => character.charCodeAt(0)))
})
const size = computed(() => preview.data.value && { aspectRatio: `${preview.data.value.width} / ${preview.data.value.height}`, height: preview.data.value.height, width: preview.data.value.width })
/** No preview (failed request): the image sizes the box itself, as a plain `<img>` would. */
const sized = computed(() => size.value != null)
</script>

<template>
  <span :class="['relative inline-block max-w-full align-top']" data-testid="lazy-image">
    <!-- Sizer: in the flow with the image's size, so the box is right before the image loads. It shows the blurred
         placeholder and fades out once the image loaded (it stays in the DOM to keep the size). -->
    <img
      v-if="sized"
      :src="placeholder ?? TRANSPARENT_PIXEL"
      alt=""
      aria-hidden="true"
      :width="size!.width"
      :height="size!.height"
      :style="{ aspectRatio: size!.aspectRatio }"
      :class="[props.imgClass, 'block pointer-events-none transition-opacity duration-750 motion-reduce:transition-none', loaded ? 'opacity-0' : 'opacity-100']"
      :data-loaded="loaded"
      data-testid="image-placeholder"
    >
    <!-- The previous image, until the new one loaded: switching frames goes from image to image, never through an
         empty box. -->
    <img
      v-if="sized && !loaded && shown && shown !== src"
      :src="shown"
      alt=""
      aria-hidden="true"
      :class="['absolute inset-0 size-full object-contain pointer-events-none']"
      data-testid="image-previous"
    >
    <UnLazyImage
      v-if="sized || !preview.loading.value"
      :key="src"
      :src="src"
      :alt="props.alt"
      :thumbhash="thumbhash"
      :loading="props.loading ?? 'lazy'"
      :width="size?.width"
      :height="size?.height"
      :style="size ? { aspectRatio: size.aspectRatio } : undefined"
      :class="sized ? ['absolute inset-0 size-full object-contain'] : props.imgClass"
      @image-load="onLoad"
      @image-error="loaded = true"
    />
  </span>
</template>
