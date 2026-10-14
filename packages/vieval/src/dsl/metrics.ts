import type { MetricDefinedData } from '../events'

/**
 * Tracks which metric metadata a task already announced.
 *
 * Use when:
 * - `recordMetric` must decide whether to emit `metric.defined` before a value
 */
export interface MetricAnnouncements {
  /**
   * Resolves the name and metadata of one `recordMetric` call.
   *
   * Returns:
   * - `name` of the metric, and `defined` when its metadata is new or changed for this task (to emit before the
   *   value); a definition's fields are overridden by inline `metadata` field by field
   */
  resolve: (metric: MetricDefinition | string, metadata: MetricMetadata | undefined) => { defined?: MetricDefinedData, name: string }
}

/**
 * One metric declared once with {@link defineMetric}; pass it to `context.recordMetric` instead of its name.
 */
export interface MetricDefinition extends MetricMetadata {
  /** Metric name written to `metric.recorded`. */
  readonly name: string
}

/**
 * Labels, description, unit, and direction of one metric, as shown by viewers.
 *
 * `label` and `description` take one string, or one string per BCP 47 locale
 * (`{ en: 'Agent steps', 'zh-Hans': 'Agent 步数' }`).
 */
export type MetricMetadata = Omit<MetricDefinedData, 'name'>

/**
 * Creates the announcement tracker of one task.
 *
 * Use when:
 * - a task starts running its cases; every case of the task shares the tracker, so metadata is announced once
 *
 * Returns:
 * - a tracker that announces metadata on first use and again when it differs from the last announcement
 */
export function createMetricAnnouncements(): MetricAnnouncements {
  const announced = new Map<string, string>()
  return {
    resolve(metric, metadata) {
      const name = typeof metric === 'string' ? metric : metric.name
      const defined: MetricDefinedData = { ...(typeof metric === 'string' ? {} : metric), ...metadata, name }
      if (Object.keys(defined).length === 1)
        return { name }
      // Field order differs between a definition and inline metadata, so the comparison key sorts the fields.
      const key = JSON.stringify(Object.entries(defined).sort(([a], [b]) => a.localeCompare(b)))
      if (announced.get(name) === key)
        return { name }
      announced.set(name, key)
      return { defined, name }
    },
  }
}

/**
 * Declares one metric with the text and unit viewers show for it.
 *
 * Use when:
 * - several cases or files record the same metric, so its label and description are written once
 * - a metric should read as a sentence in the viewer, not as `osworld.model.usage.output_tokens`
 *
 * Expects:
 * - `name` to be the stable metric identifier, the same one `recordMetric(name, value)` would use
 *
 * Returns:
 * - a frozen definition; `context.recordMetric(definition, value)` records the value and announces the metadata
 *   once per task (`metric.defined`)
 *
 * @example
 * const steps = defineMetric('osworld.agent.steps', {
 *   better: 'lower',
 *   description: { 'en': 'Tool calls before the agent stopped.', 'zh-Hans': 'agent 停下之前调用工具的次数。' },
 *   label: { 'en': 'Agent steps', 'zh-Hans': 'Agent 步数' },
 *   unit: 'steps',
 * })
 * context.recordMetric(steps, result.agent.steps.length)
 */
export function defineMetric(name: string, metadata: MetricMetadata = {}): MetricDefinition {
  return Object.freeze({ ...metadata, name })
}
