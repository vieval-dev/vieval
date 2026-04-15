import type { EvalDefinition } from '../config'

const registeredDefinitionsByModule = new Map<string, EvalDefinition[]>()
let activeModuleHref: string | null = null

/**
 * Starts module-scoped eval registration collection.
 */
export function beginModuleRegistration(moduleHref: string): void {
  activeModuleHref = moduleHref
}

/**
 * Ends module-scoped eval registration collection.
 */
export function endModuleRegistration(): void {
  activeModuleHref = null
}

/**
 * Registers one eval definition against the currently active module.
 */
export function registerEvalDefinition(definition: EvalDefinition): void {
  if (activeModuleHref == null) {
    return
  }

  const existing = registeredDefinitionsByModule.get(activeModuleHref) ?? []
  existing.push(definition)
  registeredDefinitionsByModule.set(activeModuleHref, existing)
}

/**
 * Consumes registered definitions for one module and clears stored state.
 */
export function consumeModuleRegistrations(moduleHref: string): EvalDefinition[] {
  const definitions = registeredDefinitionsByModule.get(moduleHref) ?? []
  registeredDefinitionsByModule.delete(moduleHref)
  return definitions
}
