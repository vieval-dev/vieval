import type { EvalDefinition, EvalModuleMap } from '../config'

import { pathToFileURL } from 'node:url'

import { createVitest } from 'vitest/node'

import { beginModuleRegistration, consumeModuleRegistrations, endModuleRegistration } from '../dsl/registry'

async function loadDefinitionsWithNativeImport(moduleHref: string): Promise<EvalDefinition[]> {
  const importHref = `${moduleHref}?vieval_fallback=${Date.now()}`
  beginModuleRegistration(importHref)

  try {
    const moduleValue = await import(importHref) as { default?: EvalDefinition }
    const registeredDefinitions = consumeModuleRegistrations(importHref)
    return [
      ...registeredDefinitions,
      ...(moduleValue.default == null ? [] : [moduleValue.default]),
    ]
  }
  finally {
    endModuleRegistration()
  }
}

/**
 * Loads eval modules and returns a normalized eval-module map.
 *
 * Use when:
 * - CLI collection needs Vite/Vitest-powered module resolution and transforms
 * - eval files should be imported with the same runtime semantics as Vitest
 *
 * Expects:
 * - `projectRoot` points at the project that owns the eval files
 * - each `evalFilePaths` entry is an absolute file path
 *
 * Returns:
 * - eval modules keyed by stable file href + optional registration suffixes
 */
export async function loadEvalModulesWithVitestRuntime(
  evalFilePaths: readonly string[],
  projectRoot: string,
): Promise<EvalModuleMap> {
  const loadedModules: EvalModuleMap = {}
  const runtime = await createVitest('test', {
    root: projectRoot,
    run: false,
    silent: true,
    watch: false,
  })

  try {
    for (const evalFilePath of evalFilePaths) {
      const moduleHref = pathToFileURL(evalFilePath).href
      beginModuleRegistration(moduleHref)

      try {
        const moduleValue = await runtime.import<{ default?: EvalDefinition }>(moduleHref)
        const registeredDefinitions = consumeModuleRegistrations(moduleHref)
        const defaultDefinition = moduleValue.default

        let definitions = [
          ...registeredDefinitions,
          ...(defaultDefinition == null ? [] : [defaultDefinition]),
        ]

        if (definitions.length === 0) {
          definitions = await loadDefinitionsWithNativeImport(moduleHref)
        }

        const deduplicatedDefinitions = definitions.filter((definition, index) => {
          const key = `${definition.name}::${definition.description}::${definition.task?.id ?? ''}`
          return definitions.findIndex(candidate => `${candidate.name}::${candidate.description}::${candidate.task?.id ?? ''}` === key) === index
        })

        if (deduplicatedDefinitions.length === 0) {
          continue
        }

        for (const [definitionIndex, definition] of deduplicatedDefinitions.entries()) {
          const moduleKey = definitionIndex === 0
            ? moduleHref
            : `${moduleHref}#registration-${definitionIndex + 1}`

          loadedModules[moduleKey] = {
            default: definition,
          }
        }
      }
      finally {
        endModuleRegistration()
      }
    }
  }
  finally {
    await runtime.close()
  }

  return loadedModules
}
