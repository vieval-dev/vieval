/**
 * Supported env value coercion types.
 */
export type EnvValueType = 'string'

/**
 * Common options for env readers.
 */
export interface EnvFromOptions {
  /**
   * Env key to read and use in error messages.
   */
  name: string
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
}

/**
 * Env options used by the required helper.
 *
 * `required` is intentionally omitted because this helper is always required.
 */
export type RequiredEnvFromOptions = Omit<EnvFromOptions, 'required'>

type EnvSource = Record<string, string | undefined>

function assertNonEmptyString(value: string | undefined, options: EnvFromOptions): string | undefined {
  if (value == null || value.trim().length === 0) {
    if (options.required === true) {
      throw new Error(`Missing required ${options.name}.`)
    }

    return undefined
  }

  return value
}

/**
 * Parses one env value with optional required behavior.
 *
 * Example:
 * `const apiKey = envFrom(process.env, { type: 'string', required: true, name: 'OPENAI_API_KEY' })`
 */
export function envFrom<TEnv extends EnvSource>(
  env: TEnv,
  options: EnvFromOptions & { name: keyof TEnv & string },
): string | undefined {
  if (options.type === 'string') {
    return assertNonEmptyString(env[options.name], options)
  }

  return undefined
}

/**
 * Parses one required env value.
 *
 * Example:
 * `const apiKey = requiredEnvFrom(process.env, { type: 'string', name: 'OPENAI_API_KEY' })`
 */
export function requiredEnvFrom<TEnv extends EnvSource>(
  env: TEnv,
  options: RequiredEnvFromOptions & { name: keyof TEnv & string },
): string {
  const parsed = envFrom(env, {
    ...options,
    required: true,
  })

  if (parsed == null) {
    throw new Error(`Missing required ${options.name}.`)
  }

  return parsed
}
