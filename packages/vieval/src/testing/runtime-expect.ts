import type { ExpectStatic, MatchersObject, MatcherState, Tester } from '@vitest/expect'

import {
  addCustomEqualityTesters,
  ASYMMETRIC_MATCHERS_OBJECT,
  chai,
  ChaiStyleAssertions,
  customMatchers,
  getState,
  GLOBAL_EXPECT,
  JestAsymmetricMatchers,
  JestChaiExpect,
  JestExtend,
  setState,
} from '@vitest/expect'

let isPluginInstalled = false
let runtimeExpectInstance: ExpectStatic | undefined

/**
 * Installs Vitest expect plugins once for process-local runtime assertions.
 *
 * Use when:
 * - running eval tasks outside Vitest worker runtime
 * - building an `expect` instance that does not rely on Vitest internal state
 *
 * Expects:
 * - `@vitest/expect` is available in runtime dependencies
 *
 * Returns:
 * - nothing; side-effects are applied to `chai`
 */
function ensureRuntimeExpectPluginsInstalled(): void {
  if (isPluginInstalled) {
    return
  }

  chai.use(JestExtend)
  chai.use(JestChaiExpect)
  chai.use(ChaiStyleAssertions)
  chai.use(JestAsymmetricMatchers)
  isPluginInstalled = true
}

/**
 * Creates a Vitest-compatible `expect` instance without worker-state coupling.
 *
 * Use when:
 * - CLI runtime needs assertion helpers from `vieval/expect`
 * - code is executed outside `vitest run`
 *
 * Expects:
 * - plugins from {@link ensureRuntimeExpectPluginsInstalled} are installed
 * - callers do not depend on Vitest worker-only features (snapshot/poll internals)
 *
 * Returns:
 * - standalone expect instance with core matcher APIs and `extend`
 */
function createRuntimeExpect(): ExpectStatic {
  ensureRuntimeExpectPluginsInstalled()

  const runtimeExpect = ((value: unknown, message?: string) => {
    const currentState = getState(runtimeExpect)
    setState({ assertionCalls: currentState.assertionCalls + 1 }, runtimeExpect)
    return chai.expect(value, message)
  }) as unknown as ExpectStatic

  Object.assign(runtimeExpect, chai.expect)
  Object.assign(runtimeExpect, (globalThis as Record<PropertyKey, unknown>)[ASYMMETRIC_MATCHERS_OBJECT] as object)

  runtimeExpect.getState = () => getState(runtimeExpect)
  runtimeExpect.setState = (state: Partial<MatcherState>) => setState(state, runtimeExpect)
  runtimeExpect.assert = chai.assert
  // NOTICE:
  // Chai's public `ExpectStatic` type does not expose Vitest's plugin-added `extend`.
  // Runtime `chai.expect.extend` exists after `JestExtend` plugin installation.
  // Source/context: `@vitest/expect` plugin pipeline in `dist/index.js`.
  // Removal condition: remove this cast if upstream exposes `extend` on Chai expect types.
  const chaiExpectWithExtend = chai.expect as unknown as {
    extend: (expect: ExpectStatic, matchers: MatchersObject) => void
  }
  runtimeExpect.extend = (matchers: MatchersObject) => chaiExpectWithExtend.extend(runtimeExpect, matchers)
  runtimeExpect.addEqualityTesters = (customTesters: Tester[]) => addCustomEqualityTesters(customTesters)
  runtimeExpect.unreachable = (message?: string) => {
    chai.assert.fail(`expected${message ? ` "${message}" ` : ' '}not to be reached`)
  }

  runtimeExpect.setState({
    assertionCalls: 0,
    currentTestName: '',
    expectedAssertionsNumber: null,
    expectedAssertionsNumberErrorGen: null,
    isExpectingAssertions: false,
    isExpectingAssertionsError: null,
  })

  runtimeExpect.extend(customMatchers)

  return runtimeExpect
}

/**
 * Returns process-local runtime `expect` instance used by Vieval.
 *
 * Use when:
 * - you need matcher assertions in eval files and CLI runtime
 * - importing from `vitest` would crash outside Vitest worker contexts
 *
 * Expects:
 * - single-process usage (instance is memoized per process)
 *
 * Returns:
 * - memoized runtime `expect` instance
 */
export function getRuntimeExpect(): ExpectStatic {
  if (runtimeExpectInstance != null) {
    return runtimeExpectInstance
  }

  runtimeExpectInstance = createRuntimeExpect()
  Object.defineProperty(globalThis, GLOBAL_EXPECT, {
    configurable: true,
    value: runtimeExpectInstance,
    writable: true,
  })

  return runtimeExpectInstance
}
