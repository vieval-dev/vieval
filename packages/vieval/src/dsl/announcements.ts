/**
 * Tracks which definitions (`metric.defined`, `score.defined`) one task already announced.
 *
 * @param TDefined - Payload of the definition event; `name` identifies the definition.
 */
export interface Announcements<TDefined extends { name: string }> {
  /**
   * Records one definition.
   *
   * Returns:
   * - `true` when the definition is new for the task or differs from its last announcement, so it must be emitted
   */
  announce: (defined: TDefined) => boolean
  /**
   * Latest announced definition of each name, in first-announced order.
   */
  latest: () => TDefined[]
}

/**
 * Creates the announcement tracker of one task.
 *
 * Use when:
 * - a task starts running its cases; every case of the task shares the tracker, so a definition is announced once,
 *   and again only when it changes
 *
 * Returns:
 * - a tracker comparing definitions by content, independent of field order
 */
export function createAnnouncements<TDefined extends { name: string }>(): Announcements<TDefined> {
  const announced = new Map<string, { defined: TDefined, key: string }>()
  return {
    announce(defined) {
      // Field order differs between a definition and inline metadata, so the comparison key sorts the fields.
      const key = JSON.stringify(Object.entries(defined).sort(([a], [b]) => a.localeCompare(b)))
      if (announced.get(defined.name)?.key === key)
        return false
      announced.set(defined.name, { defined, key })
      return true
    },
    latest: () => [...announced.values()].map(({ defined }) => defined),
  }
}
