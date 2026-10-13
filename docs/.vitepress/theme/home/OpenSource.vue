<script setup lang="ts">
import { data as contributors } from './contributors.data'

/**
 * A project, organization, or university thanked on the home page, shown by its GitHub avatar.
 */
export interface ThanksEntry {
  /** Image URL for entries without a GitHub account, such as universities. */
  avatar?: string
  /** GitHub account whose avatar and profile are used. */
  github?: string
  /** Link opened on click; defaults to the GitHub profile. */
  link?: string
  name: string
}

defineProps<{
  action?: { link?: string, text?: string }
  body?: string
  /** Heading above the contributor avatars. */
  contributorsTitle?: string
  eyebrow?: string
  thanks: ThanksEntry[]
  title?: string
}>()
</script>

<template>
  <div :class="['grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 gap-10 lg:gap-16', 'px-5 py-14 sm:px-10 lg:px-20 lg:py-24']">
    <div class="flex flex-col gap-4 max-w-lg">
      <span class="text-xs text-grey tracking-wide font-mono uppercase">{{ eyebrow ?? '' }}</span>
      <h3 class="section-title">
        {{ title ?? '' }}
      </h3>
      <p class="text-pretty">
        {{ body ?? '' }}
      </p>
      <a v-if="action?.link" :href="action.link" target="_blank" rel="noopener noreferrer" class="button mt-4 w-fit">{{ action.text ?? '' }}</a>
    </div>

    <div class="flex flex-col gap-8">
      <ul :class="['grid grid-cols-4 sm:grid-cols-6 gap-3']">
        <li v-for="entry in thanks" :key="entry.name">
          <a
            :href="entry.link ?? `https://github.com/${entry.github}`"
            target="_blank"
            rel="noopener noreferrer"
            :title="entry.name"
            :class="['group flex flex-col items-center gap-2']"
          >
            <img
              :src="entry.avatar ?? `https://github.com/${entry.github}.png?size=120`"
              :alt="entry.name"
              width="56"
              height="56"
              loading="lazy"
              :class="['size-14 rounded-xl', 'border border-white/10', 'grayscale group-hover:grayscale-0 opacity-80 group-hover:opacity-100', 'transition duration-300']"
            >
            <span class="text-[0.7rem] text-white/45 leading-tight text-center">{{ entry.name }}</span>
          </a>
        </li>
      </ul>

      <div v-if="contributors.length" class="flex flex-col gap-3">
        <span class="text-xs text-grey tracking-wide font-mono uppercase">{{ contributorsTitle ?? '' }}</span>
        <ul class="flex flex-wrap gap-2">
          <li v-for="contributor in contributors" :key="contributor.login">
            <a :href="contributor.url" target="_blank" rel="noopener noreferrer" :title="contributor.login">
              <img :src="contributor.avatar" :alt="contributor.login" width="36" height="36" loading="lazy" class="border border-white/10 rounded-full size-9">
            </a>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
