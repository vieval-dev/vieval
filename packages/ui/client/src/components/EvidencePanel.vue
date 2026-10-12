<script setup lang="ts">
import type { EvidenceLink, FileEntry } from '../../../src/shared/contract'
import type { CaseRef } from '../api'
import type { Frame } from './ImageSequence.vue'
import type { ViewTab } from './ViewTabs.vue'

import { computed, shallowRef, watch } from 'vue'

import ArtifactViewer from './ArtifactViewer.vue'
import ImageSequence from './ImageSequence.vue'
import JsonlTable from './JsonlTable.vue'
import LazyImage from './LazyImage.vue'
import ObjectTree from './ObjectTree.vue'
import StateView from './StateView.vue'
import ViewTabs from './ViewTabs.vue'

import { api, jsonlPage, readText } from '../api'
import { useResource } from '../composables/useResource'
import { formatBytes, formatDateTime, formatScore, formatTime, previewValue } from '../format'

/**
 * External evidence of a case: directories recorded with a `*.evidence` metric (OSWorld episodes).
 *
 * For OSWorld episodes: the `result.json` summary and agent steps (each step linked to the screenshot its AUV run
 * captured), the screenshot sequence, `auv-runs/records.jsonl`, every file of the episode, and the command log
 * lines of `.vieval/logs/*.jsonl` correlated by case id, pod, and time window.
 */
const props = defineProps<{ caseRef: CaseRef, links: EvidenceLink[], runKey: string }>()

const linkId = shallowRef(props.links.at(-1)?.id)
watch(() => props.links, links => (linkId.value ??= links.at(-1)?.id))
const link = computed(() => props.links.find(item => item.id === linkId.value))
const usable = computed(() => link.value != null && link.value.allowed && link.value.exists && link.value.kind === 'directory')
const isOsworld = computed(() => link.value?.adapter === 'osworld')
type Tab = 'files' | 'logs' | 'records' | 'screenshots' | 'steps'
const tab = shallowRef<Tab>('steps')
watch(isOsworld, value => (tab.value = value ? 'steps' : 'files'), { immediate: true })

const tree = useResource(() => (usable.value ? linkId.value : undefined), id => (id == null ? Promise.resolve(undefined) : api.evidenceTree(props.runKey, id)))
const timeline = useResource(() => (usable.value && isOsworld.value ? linkId.value : undefined), id => (id == null ? Promise.resolve(undefined) : api.evidenceTimeline(props.runKey, id)))
const frames = computed<Frame[]>(() => (timeline.data.value?.frames ?? []).map(frame => ({
  caption: `${frame.purpose ?? ''} · AUV run ${frame.runId}`,
  label: frame.path,
  location: { linkId: linkId.value, path: frame.path, runKey: props.runKey },
  time: frame.occurredAt,
})))
const frameIndex = shallowRef(0)

/** One agent step of OSWorld's `result.json` (`agent.steps[]`); `arguments` and `output` are JSON strings. */
interface AgentStep { arguments?: string, output?: string, runId?: string, tool?: string }
const resultJson = useResource(() => (usable.value && isOsworld.value ? linkId.value : undefined), async (id) => {
  if (id == null)
    return undefined
  const { text } = await readText({ linkId: id, path: 'result.json', runKey: props.runKey }, 8 * 1024 * 1024)
  return JSON.parse(text) as Record<string, unknown> & { agent?: { steps?: AgentStep[] } }
})
function parseJson(text: string | undefined): Record<string, unknown> | undefined {
  try {
    return text == null ? undefined : JSON.parse(text) as Record<string, unknown>
  }
  catch {
    return undefined
  }
}
const steps = computed(() => (resultJson.data.value?.agent?.steps ?? []).map((step, index) => {
  const args = parseJson(step.arguments)
  const output = parseJson(step.output)
  // Each agent step runs one AUV command whose run id names the screenshot it captured (if any).
  const frame = (timeline.data.value?.frames ?? []).findIndex(item => item.runId === step.runId)
  return {
    command: String(args?.command_id ?? step.tool ?? ''),
    failure: typeof output?.failure === 'string' ? output.failure : undefined,
    frame,
    index,
    raw: { arguments: args ?? step.arguments, output: output ?? step.output },
    status: String(output?.status ?? (output?.failure != null ? 'failed' : 'unknown')),
    // Inputs and target of the AUV command, without the empty objects most commands carry.
    target: [args?.inputs, args?.target].filter(value => value != null && JSON.stringify(value) !== '{}').map(value => previewValue(value, 60)).join(' '),
    tool: step.tool,
  }
}))
const openStep = shallowRef<number>()

const files = computed(() => (tree.data.value?.entries ?? []).filter(entry => entry.kind === 'file'))
const selectedFile = shallowRef<FileEntry>()
watch(files, list => (selectedFile.value ??= list.find(entry => entry.path === 'result.json') ?? list[0]))
const fileFilter = shallowRef('')
const filteredFiles = computed(() => files.value.filter(entry => entry.path.toLowerCase().includes(fileFilter.value.toLowerCase())))
const recordsPath = computed(() => files.value.find(entry => entry.path === 'auv-runs/records.jsonl')?.path)
const loadRecords = computed(() => {
  const id = linkId.value
  const path = recordsPath.value
  return (offset: number, limit: number) => jsonlPage({ linkId: id, path: path ?? '', runKey: props.runKey }, offset, limit)
})

const logLimit = 200
const logs = useResource(() => [props.runKey, props.caseRef.taskId, props.caseRef.caseId] as const, ([runKey, taskId, caseId]) => api.externalLogs(runKey, { caseId, taskId }, 0, logLimit))
const extraLogs = shallowRef<NonNullable<typeof logs.data.value>['lines']>([])
async function moreLogs(): Promise<void> {
  const page = await api.externalLogs(props.runKey, props.caseRef, logLimit + extraLogs.value.length, logLimit)
  extraLogs.value = [...extraLogs.value, ...page.lines]
}
const logLines = computed(() => [...(logs.data.value?.lines ?? []), ...extraLogs.value].map(line => ({ ...line, record: (line.record ?? {}) as Record<string, unknown> })))
const openLog = shallowRef<number>()

const summary = computed(() => link.value?.summary ?? {})
const tabs = computed<ViewTab<Tab>[]>(() => (isOsworld.value
  ? [{ count: steps.value.length, label: 'Steps', value: 'steps' }, { count: frames.value.length, label: 'Screenshots', value: 'screenshots' }, { label: 'AUV records', value: 'records' }, { count: files.value.length, label: 'Files', value: 'files' }, { count: logs.data.value?.total, label: 'Command logs', value: 'logs' }]
  : [{ count: files.value.length, label: 'Files', value: 'files' }, { count: logs.data.value?.total, label: 'Logs', value: 'logs' }]))

function showFrame(index: number): void {
  frameIndex.value = index
  tab.value = 'screenshots'
}
</script>

<template>
  <section :class="['card']" data-testid="evidence-panel">
    <h2 :class="['card-title flex-wrap']">
      <span class="i-mingcute-file-search-line" aria-hidden="true" />External evidence
      <select v-if="props.links.length > 1" v-model="linkId" :class="['ml-2 rounded border border-neutral-300/60 dark:border-neutral-700/40 bg-transparent text-xs px-1 py-0.5 font-normal']">
        <option v-for="item in props.links" :key="item.id" :value="item.id">
          round {{ item.roundIndex ?? 0 }} · {{ item.path.split('/').at(-1) }}
        </option>
      </select>
      <span v-if="link" :class="['badge state-neutral font-normal']">{{ link.adapter }}</span>
      <span v-if="link" :class="['text-xs muted font-normal break-all']" :title="link.path">{{ link.path }}</span>
    </h2>
    <div v-if="link && !usable" :class="['p-4 text-sm flex items-center gap-2']" role="alert">
      <span class="i-mingcute-safe-alert-line text-xl text-amber-600" aria-hidden="true" />
      <span>Evidence not readable: {{ (link.reason ?? (link.exists ? `it is a ${link.kind}` : 'the path does not exist on this machine')).replace(/\.$/, '') }}.</span>
    </div>
    <template v-else-if="link">
      <dl v-if="isOsworld" :class="['flex flex-wrap gap-x-6 gap-y-1 px-3 py-2 text-sm border-b border-neutral-100/70 dark:border-neutral-900']" data-testid="osworld-summary">
        <div v-for="key in ['status', 'score', 'model', 'domain', 'podName', 'agentSteps', 'api', 'startedAt', 'finishedAt']" :key="key">
          <dt class="text-xs muted">
            {{ key }}
          </dt>
          <dd class="break-all tabular-nums">
            {{ summary[key] == null ? '—' : key === 'score' ? formatScore(Number(summary[key])) : key.endsWith('At') ? formatDateTime(String(summary[key])) : summary[key] }}
          </dd>
        </div>
      </dl>
      <ViewTabs v-model="tab" :items="tabs" label="Evidence views" in-card>
        <div class="p-3">
          <StateView v-if="tab === 'steps'" :error="resultJson.error.value" :loading="resultJson.loading.value" :empty="steps.length === 0" empty-text="result.json has no agent steps" skeleton="lines" :skeleton-count="8" @retry="resultJson.reload">
            <div :class="['overflow-auto max-h-[65vh]']">
              <table :class="['w-full']" data-testid="osworld-steps">
                <thead :class="['sticky top-0 bg-white dark:bg-neutral-900 max-md:hidden']">
                  <tr :class="['border-b border-neutral-200/50 dark:border-neutral-800/50']">
                    <th class="th">
                      #
                    </th>
                    <th class="th">
                      Command
                    </th>
                    <th class="th">
                      Inputs / target
                    </th>
                    <th class="th">
                      Status
                    </th>
                    <th class="th">
                      Screenshot
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="step in steps" :key="step.index">
                    <!-- Phones: number, command, and status on one line, then the inputs and the screenshot below. -->
                    <tr :class="['border-b border-neutral-100/70 dark:border-neutral-900 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50', 'max-md:(flex flex-wrap items-start py-1)']" @click="openStep = openStep === step.index ? undefined : step.index">
                      <td :class="['td mono text-xs muted', 'max-md:(w-7 pr-0)']">
                        {{ step.index + 1 }}
                      </td>
                      <td :class="['td mono text-xs', 'max-md:(flex-1 min-w-0 break-all)']">
                        {{ step.command }}
                      </td>
                      <td :class="['td mono text-xs muted max-w-64 truncate', 'max-md:(order-last basis-full max-w-none pl-9 pt-0)']">
                        {{ step.target }}
                      </td>
                      <td :class="['td', 'max-md:text-right']">
                        <span :class="['badge', step.status === 'completed' ? 'state-passed' : step.failure ? 'state-failed' : 'state-neutral']">{{ step.status }}</span>
                        <div v-if="step.failure" :class="['text-xs text-red-700 dark:text-red-400 mt-0.5 max-w-xl']">
                          {{ previewValue(step.failure, 160) }}
                        </div>
                      </td>
                      <td :class="['td', 'max-md:(order-last basis-full pl-9 pt-0)']">
                        <button v-if="step.frame >= 0" type="button" :class="['block']" :title="`Open frame ${step.frame + 1}`" @click.stop="showFrame(step.frame)">
                          <LazyImage :location="frames[step.frame]!.location" :alt="`Screenshot of step ${step.index + 1}`" :img-class="['h-12 max-md:h-24 w-auto rounded border border-neutral-200/50 dark:border-neutral-700/40']" />
                        </button>
                      </td>
                    </tr>
                    <tr v-if="openStep === step.index" :class="['max-md:block']">
                      <td colspan="5" :class="['p-2 bg-neutral-50 dark:bg-neutral-950 max-md:(block overflow-x-auto)']">
                        <ObjectTree :value="step.raw" :expand-depth="2" />
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </StateView>

          <StateView v-else-if="tab === 'screenshots'" :error="timeline.error.value" :loading="timeline.loading.value" :empty="frames.length === 0" empty-text="No screenshots in auv-runs" skeleton="media" @retry="timeline.reload">
            <ImageSequence :frames="frames" :initial="frameIndex" />
          </StateView>

          <template v-else-if="tab === 'records'">
            <StateView :empty="recordsPath == null" empty-text="No auv-runs/records.jsonl in this episode">
              <JsonlTable :load="loadRecords" />
            </StateView>
          </template>

          <StateView v-else-if="tab === 'files'" :error="tree.error.value" :loading="tree.loading.value" :empty="files.length === 0" empty-text="The evidence directory is empty" skeleton="lines" @retry="tree.reload">
            <!-- Narrow screens stack the file list (shorter) above the preview. -->
            <div :class="['grid gap-3 grid-cols-1 md:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]']">
              <div :class="['flex flex-col gap-1 min-w-0']">
                <input v-model="fileFilter" type="search" placeholder="Filter files…" :class="['rounded border border-neutral-300/60 dark:border-neutral-700/40 bg-transparent px-2 py-0.5 text-xs max-md:py-1']">
                <ul :class="['text-xs max-h-[65vh] max-md:max-h-48 overflow-auto']" aria-label="Evidence files">
                  <li v-for="entry in filteredFiles" :key="entry.path">
                    <button type="button" :class="['flex items-center gap-1 w-full rounded px-1.5 py-0.5 text-left', selectedFile?.path === entry.path ? 'selected' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800']" :title="entry.path" @click="selectedFile = entry">
                      <span class="text-xs mono truncate"><span class="muted">{{ entry.path.split('/').slice(0, -1).map(part => part.length > 10 ? `${part.slice(0, 8)}…` : part).join('/') }}{{ entry.path.includes('/') ? '/' : '' }}</span>{{ entry.path.split('/').at(-1) }}</span>
                      <span class="muted ml-auto whitespace-nowrap">{{ formatBytes(entry.size) }}</span>
                    </button>
                  </li>
                </ul>
                <div v-if="tree.data.value?.truncated" class="text-xs muted">
                  Listing stopped at 5000 entries.
                </div>
              </div>
              <div :class="['min-w-0']">
                <ArtifactViewer
                  v-if="selectedFile" :key="selectedFile.path"
                  :location="{ linkId, path: selectedFile.path, runKey: props.runKey }" :name="selectedFile.path"
                  :preview-kind="selectedFile.previewKind ?? 'binary'" :size="selectedFile.size" :content-type="selectedFile.contentType"
                />
              </div>
            </div>
          </StateView>

          <StateView v-else :error="logs.error.value" :loading="logs.loading.value" skeleton="lines" :empty="logs.data.value?.total === 0" empty-text="No correlated log lines" :empty-hint="`Searched ${logs.data.value?.files.length ?? 0} log files for keys ${logs.data.value?.correlation.keys.join(', ')}`" @retry="logs.reload">
            <div class="text-xs muted mb-2" data-testid="external-logs-correlation">
              {{ logs.data.value?.total }} lines matched in {{ logs.data.value?.files.filter(file => file.matched > 0).map(file => file.path.split('/').at(-1)).join(', ') }} · pods {{ logs.data.value?.correlation.podNames.join(', ') || '—' }} · window {{ formatTime(logs.data.value?.correlation.window.from) }}–{{ formatTime(logs.data.value?.correlation.window.to) }}
            </div>
            <div :class="['overflow-auto max-h-[60vh]']">
              <table :class="['w-full']">
                <tbody>
                  <template v-for="(line, index) in logLines" :key="`${line.file}:${line.line}`">
                    <tr :class="['border-b border-neutral-100/70 dark:border-neutral-900 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50']" @click="openLog = openLog === index ? undefined : index">
                      <td :class="['td mono muted whitespace-nowrap text-xs']">
                        {{ formatTime(String(line.record.time ?? '')) }}
                      </td>
                      <td class="td">
                        <span :class="['badge', line.record.level === 'error' ? 'state-failed' : line.record.level === 'warn' ? 'state-interrupted' : 'state-neutral']">{{ line.record.level ?? 'log' }}</span>
                      </td>
                      <td :class="['td mono text-xs muted']">
                        {{ line.record.scope }}
                      </td>
                      <td :class="['td text-xs']">
                        {{ line.record.message }}
                        <div v-if="line.record.command" class="text-xs muted mono max-w-3xl truncate">
                          {{ previewValue(line.record.command, 140) }}
                        </div>
                      </td>
                    </tr>
                    <tr v-if="openLog === index">
                      <td colspan="4" :class="['p-2 bg-neutral-50 dark:bg-neutral-950']">
                        <div class="text-xs muted mb-1">
                          {{ line.file }}:{{ line.line }}
                        </div>
                        <ObjectTree :value="line.record" :expand-depth="1" />
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
            <button v-if="logLines.length < (logs.data.value?.total ?? 0)" type="button" :class="['btn text-xs mt-2']" @click="moreLogs">
              Load more ({{ (logs.data.value?.total ?? 0) - logLines.length }} left)
            </button>
          </StateView>
        </div>
      </ViewTabs>
    </template>
  </section>
</template>
