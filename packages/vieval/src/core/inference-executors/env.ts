/**
 * Supported env value coercion types.
 */
export type EnvValueType = 'string'

/**
 * Common options for env readers.
 */
export interface EnvFromOptions {
  /**
   * Expected env value type.
   */
  type: EnvValueType
  /**
   * Whether an empty or missing value should throw.
   *
   * @default false
   */
  required?: boolean
  /**
   * Optional key name used for clearer error messages.
   */
  name?: string
}

/**
 * Env options used by the required helper.
 *
 * `required` is intentionally omitted because this helper is always required.
 */
export type RequiredEnvFromOptions = Omit<EnvFromOptions, 'required'>

function assertNonEmptyString(value: string | undefined, options: EnvFromOptions): string | undefined {
  if (value == null || value.trim().length === 0) {
    if (options.required === true) {
      const label = options.name ?? 'environment variable'
      throw new Error(`Missing required ${label}.`)
    }

    return undefined
  }

  return value
}

/**
 * Parses one env value with optional required behavior.
 *
 * Example:
 * `const apiKey = envFrom(process.env.OPENAI_API_KEY, { type: 'string', required: true, name: 'OPENAI_API_KEY' })`
 */
export function envFrom(
  value: string | undefined,
  options: EnvFromOptions,
): string | undefined {
  if (options.type === 'string') {
    return assertNonEmptyString(value, options)
  }

  return undefined
}

/**
 * Parses one required env value.
 *
 * Example:
 * `const apiKey = requiredEnvFrom(process.env.OPENAI_API_KEY, { type: 'string', name: 'OPENAI_API_KEY' })`
 */
export function requiredEnvFrom(
  value: string | undefined,
  options: RequiredEnvFromOptions,
): string {
  const parsed = envFrom(value, {
    ...options,
    required: true,
  })

  if (parsed == null) {
    const label = options.name ?? 'environment variable'
    throw new Error(`Missing required ${label}.`)
  }

  return parsed
}
