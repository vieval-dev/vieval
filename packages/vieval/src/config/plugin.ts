/**
 * Generic plugin contract for vieval config lifecycle hooks.
 *
 * Use when:
 * - a plugin needs to transform config before CLI normalization
 * - a plugin needs a final resolved-config callback
 *
 * Expects:
 * - `name` to be stable for diagnostics
 * - hooks to return either a full config object or `void`
 *
 * Returns:
 * - a typed plugin shape bound to one config object
 */
export interface ConfigHookPlugin<TConfig> {
  /**
   * Stable plugin name for diagnostics.
   */
  name: string
  /**
   * Optional config transform hook.
   */
  configVieval?: (config: TConfig) => TConfig | void | Promise<TConfig | void>
  /**
   * Optional hook after config is finalized.
   */
  configVievalResolved?: (config: TConfig) => void | Promise<void>
}
