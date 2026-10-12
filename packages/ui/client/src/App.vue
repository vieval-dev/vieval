<script setup lang="ts">
import type { RunListItem } from '../../src/shared/contract'

import { computedAsync, useDark, useToggle } from '@vueuse/core'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, TooltipProvider } from 'reka-ui'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'

import CompareMenu from './components/CompareMenu.vue'
import HuePicker from './components/HuePicker.vue'
import IconButton from './components/IconButton.vue'
import Sidebar from './components/Sidebar.vue'
import CasePage from './pages/CasePage.vue'
import ComparePage from './pages/ComparePage.vue'
import ExperimentPage from './pages/ExperimentPage.vue'
import HomePage from './pages/HomePage.vue'
import ProjectPage from './pages/ProjectPage.vue'
import RunPage from './pages/RunPage.vue'
import TaskPage from './pages/TaskPage.vue'

import { currentRoute, href } from './router'
import { runInfo } from './runInfo'

const route = currentRoute
const routeRunKey = computed(() => ('runKey' in route.value ? route.value.runKey : undefined))
// `computedAsync` drops the response of a run key that is no longer current. While the next response loads it
// keeps the previous run, so only a run that matches the route is passed on (never another run's report paths).
const loadedRun = computedAsync<RunListItem | undefined>(async () => {
  const runKey = routeRunKey.value
  return runKey == null ? undefined : await runInfo(runKey).catch(() => undefined)
}, undefined)
const activeRun = computed(() => (loadedRun.value?.runKey === routeRunKey.value ? loadedRun.value : undefined))
const sidebarRun = computed(() => activeRun.value && {
  attempt: activeRun.value.attemptId,
  experiment: activeRun.value.experimentId,
  project: activeRun.value.projectSegment,
  runKey: activeRun.value.runKey,
  workspace: activeRun.value.workspaceId,
})

/** Scope of the comparisons menu: the hierarchy position of the current page. */
const compareScope = computed(() => {
  const value = route.value
  if (value.name === 'scope')
    return { experiment: value.experiment, project: value.project, workspace: value.workspace }
  const run = sidebarRun.value
  return run == null ? {} : { experiment: run.experiment, project: run.project, runKey: run.runKey, workspace: run.workspace }
})

// `public/scheme.js` applies the same stored value before the first paint; keep the key and values in sync.
const dark = useDark({ disableTransition: false, storageKey: 'vieval-viewer:scheme' })
const toggleScheme = useToggle(dark)

/**
 * Identity of the page shown, without its tab: `main` is the scroll container of every page and outlives them, so a new
 * page starts at the top while switching tabs keeps the position.
 */
const pageKey = computed(() => JSON.stringify({ ...route.value, tab: undefined }))
const main = useTemplateRef<HTMLElement>('main')
watch(pageKey, () => main.value?.scrollTo({ top: 0 }))

/** Sidebar drawer of narrow screens (below `md`), where the sidebar does not fit next to the page. */
const drawerOpen = shallowRef(false)
// Back / forward or a link outside the drawer changed the page: do not leave the drawer over it.
watch(route, () => (drawerOpen.value = false))
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div :class="['flex h-full max-md:flex-col']">
      <!-- Narrow screens: a top bar with the drawer toggle replaces the sidebar column. -->
      <header :class="['md:hidden shrink-0 flex items-center gap-1 px-2 h-12 pt-[env(safe-area-inset-top)] box-content', 'border-b border-neutral-200/50 dark:border-neutral-800/50 bg-white/90 dark:bg-neutral-950/90 backdrop-blur']">
        <IconButton icon="i-mingcute-menu-line" label="Projects and runs" @click="drawerOpen = true" />
        <a :href="href({ name: 'scope' })" :class="['flex items-center gap-2 px-1 font-semibold']">
          <img src="/vieval-logo.svg" alt="" width="20" height="20" :class="['size-5']">
          Vieval
        </a>
        <div :class="['ml-auto flex items-center gap-0.5']">
          <CompareMenu v-bind="compareScope" />
          <HuePicker />
          <IconButton :icon="dark ? 'i-mingcute-sun-line' : 'i-mingcute-moon-line'" :label="dark ? 'Light mode' : 'Dark mode'" @click="toggleScheme()" />
        </div>
      </header>
      <DialogRoot v-model:open="drawerOpen">
        <DialogPortal>
          <DialogOverlay :class="['vv-drawer-overlay fixed inset-0 z-40 bg-black/30 dark:bg-black/50 md:hidden']" />
          <!-- Focus stays on the drawer itself: focusing its first button would pop that button's tooltip open. -->
          <DialogContent :class="['vv-drawer fixed inset-y-0 left-0 z-50 w-[min(20rem,85vw)] flex flex-col md:hidden', 'bg-white dark:bg-neutral-950 shadow-xl outline-none pt-[env(safe-area-inset-top)]']" @open-auto-focus.prevent>
            <div :class="['flex items-center gap-2 px-3 h-12 shrink-0 border-b border-neutral-200/50 dark:border-neutral-800/50']">
              <DialogTitle :class="['font-semibold']">
                Projects and runs
              </DialogTitle>
              <DialogDescription :class="['sr-only']">
                Navigate to a project, an experiment, or a recent run.
              </DialogDescription>
              <IconButton :class="['ml-auto']" icon="i-mingcute-close-line" label="Close" @click="drawerOpen = false" />
            </div>
            <!-- A link to the page already shown does not change the route; close on every followed link instead. -->
            <div :class="['flex-1 overflow-auto p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]']" @click="($event.target as HTMLElement).closest('a') && (drawerOpen = false)">
              <Sidebar :active-run="sidebarRun" />
            </div>
          </DialogContent>
        </DialogPortal>
      </DialogRoot>
      <aside :class="['max-md:hidden w-72 shrink-0 flex flex-col border-r border-neutral-200/50 dark:border-neutral-800/50 bg-white dark:bg-neutral-950']">
        <div :class="['flex items-center gap-2 px-3 h-11 border-b border-neutral-200/50 dark:border-neutral-800/50']">
          <a :href="href({ name: 'scope' })" :class="['flex items-center gap-2 font-semibold']">
            <img src="/vieval-logo.svg" alt="" width="20" height="20" :class="['size-5']">
            Vieval
          </a>
          <div :class="['ml-auto flex items-center gap-0.5']">
            <CompareMenu v-bind="compareScope" />
            <HuePicker />
            <IconButton :icon="dark ? 'i-mingcute-sun-line' : 'i-mingcute-moon-line'" :label="dark ? 'Light mode' : 'Dark mode'" @click="toggleScheme()" />
          </div>
        </div>
        <div :class="['flex-1 overflow-auto p-2']">
          <Sidebar :active-run="sidebarRun" />
        </div>
      </aside>
      <main ref="main" :class="['relative flex-1 min-w-0 min-h-0 overflow-auto px-3 py-3 md:px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))]']">
        <template v-if="route.name === 'scope'">
          <HomePage v-if="route.project == null || route.workspace == null" :workspace="route.workspace" />
          <ProjectPage v-else-if="route.experiment == null" :key="`${route.workspace}/${route.project}`" :project="route.project" :tab="route.tab" :workspace="route.workspace" />
          <ExperimentPage v-else :key="`${route.workspace}/${route.project}/${route.experiment}`" :attempt="route.attempt" :experiment="route.experiment" :project="route.project" :tab="route.tab" :workspace="route.workspace" />
        </template>
        <ComparePage v-else-if="route.name === 'compare'" :route="route" />
        <RunPage v-else-if="route.name === 'run'" :key="route.runKey" :route="route" :run="activeRun" />
        <TaskPage v-else-if="route.name === 'task'" :key="`${route.runKey}/${route.taskId}`" :route="route" :run="activeRun" />
        <CasePage v-else-if="route.name === 'case'" :key="`${route.runKey}/${route.taskId}/${route.caseId}`" :route="route" :run="activeRun" />
      </main>
    </div>
  </TooltipProvider>
</template>
