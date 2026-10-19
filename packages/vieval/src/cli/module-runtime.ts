import type { EvalDefinition, EvalModuleMap } from '../config'

import { pathToFileURL } from 'node:url'

import { createVitest } from 'vitest/node'

import { beginModuleRegistration, consumeModuleRegistrations, endModuleRegistration } from '../dsl/registry'

// NOTICE:
// Eval files register their tasks as a side effect of `describeTask`, and the DSL registry attributes each
// registration to the one module marked active in the process (`dsl/registry.ts`). `vieval run` prepares projects
// concurrently, so two imports could be pending at once and one file's tasks landed under another file.
// Imports are therefore chained process-wide: a module's registrations are consumed before the next module starts.
// Removal condition: registrations carry their own module identity (for example a per-import registry handed to
// the module), so no process-wide active module is needed.
let registrationChain: Promise<unknown> = Promise.resolve()

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
    config: false,
    root: projectRoot,
    run: false,
    silent: true,
    watch: false,
  })

  try {
    for (const evalFilePath of evalFilePaths) {
      const moduleHref = pathToFileURL(evalFilePath).href
      const { moduleValue, registeredDefinitions } = await withExclusiveRegistration(async () => {
        beginModuleRegistration(moduleHref)
        try {
          const moduleValue = await runtime.import<{ default?: EvalDefinition }>(moduleHref)
          return { moduleValue, registeredDefinitions: consumeModuleRegistrations(moduleHref) }
        }
        finally {
          endModuleRegistration()
        }
      })

      const defaultDefinition = moduleValue.default

      const definitions = [
        ...registeredDefinitions,
        ...(defaultDefinition == null ? [] : [defaultDefinition]),
      ]

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
  }
  finally {
    await runtime.close()
  }

  return loadedModules
}

function withExclusiveRegistration<T>(load: () => Promise<T>): Promise<T> {
  const result = registrationChain.then(load)
  registrationChain = result.catch(() => {})
  return result
}
