import type { EvalDefinition } from '../config'

import process from 'node:process'

interface EvalDefinitionRegistryStore {
  activeModuleHref: string | null
  registeredDefinitionsByModule: Map<string, EvalDefinition[]>
}

const registryStoreSymbol = Symbol.for('vieval.dsl.registry.store')

function getRegistryStore(): EvalDefinitionRegistryStore {
  const processWithStore = process as NodeJS.Process & {
    [registryStoreSymbol]?: EvalDefinitionRegistryStore
  }

  processWithStore[registryStoreSymbol] ??= {
    activeModuleHref: null,
    registeredDefinitionsByModule: new Map<string, EvalDefinition[]>(),
  }

  return processWithStore[registryStoreSymbol]
}

/**
 * Starts module-scoped eval registration collection.
 */
export function beginModuleRegistration(moduleHref: string): void {
  const store = getRegistryStore()
  store.activeModuleHref = moduleHref
}

/**
 * Ends module-scoped eval registration collection.
 */
export function endModuleRegistration(): void {
  const store = getRegistryStore()
  store.activeModuleHref = null
}

/**
 * Registers one eval definition against the currently active module.
 */
export function registerEvalDefinition(definition: EvalDefinition): void {
  const store = getRegistryStore()

  if (store.activeModuleHref == null) {
    return
  }

  const existing = store.registeredDefinitionsByModule.get(store.activeModuleHref) ?? []
  existing.push(definition)
  store.registeredDefinitionsByModule.set(store.activeModuleHref, existing)
}

/**
 * Consumes registered definitions for one module and clears stored state.
 */
export function consumeModuleRegistrations(moduleHref: string): EvalDefinition[] {
  const store = getRegistryStore()
  const definitions = store.registeredDefinitionsByModule.get(moduleHref) ?? []
  store.registeredDefinitionsByModule.delete(moduleHref)
  return definitions
}
