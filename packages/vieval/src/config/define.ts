import type { EvalDefinition, TaskDefinition } from './types'

/**
 * Returns the provided vieval definition while preserving literal field types.
 */
export function defineEval<const TDefinition extends EvalDefinition>(definition: TDefinition): TDefinition {
  return definition
}

/**
 * Returns the provided task definition while preserving literal field types.
 */
export function defineTask<const TDefinition extends TaskDefinition>(definition: TDefinition): TDefinition {
  return definition
}
