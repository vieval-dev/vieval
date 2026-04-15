import { expect as vitestExpect } from 'vitest'

import { installVievalExpectMatchers } from './testing/expect-extensions'

let isInstalled = false

function ensureExpectMatchersInstalled(): void {
  if (isInstalled) {
    return
  }

  installVievalExpectMatchers()
  isInstalled = true
}

ensureExpectMatchersInstalled()

/**
 * Re-exported expect with vieval custom matchers pre-installed.
 */
export const expect = vitestExpect
