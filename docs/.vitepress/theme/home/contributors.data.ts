import { env } from 'node:process'

import { errorMessageFrom } from '@moeru/std'
import { defineLoader } from 'vitepress'

/**
 * A GitHub account that contributed to `vieval-dev/vieval`.
 */
export interface Contributor {
  avatar: string
  login: string
  url: string
}

declare const data: Contributor[]
export { data }

interface GitHubContributor {
  avatar_url: string
  html_url: string
  login: string
  type: string
}

/**
 * Loads repository contributors once per build for the home page thanks section.
 *
 * NOTICE:
 * Uses the unauthenticated GitHub REST API (60 requests/hour per IP), or `GITHUB_TOKEN` when set, e.g. in CI.
 * A failed request must not break the docs build, so it logs and returns an empty list; the section then
 * only shows the organizations listed in frontmatter.
 * Source: https://docs.github.com/en/rest/repos/repos#list-repository-contributors
 */
export default defineLoader({
  async load(): Promise<Contributor[]> {
    try {
      const response = await fetch('https://api.github.com/repos/vieval-dev/vieval/contributors?per_page=100', {
        headers: {
          Accept: 'application/vnd.github+json',
          ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
        },
      })
      if (!response.ok)
        throw new Error(`GitHub responded ${response.status} ${response.statusText}`)

      const contributors = await response.json() as GitHubContributor[]
      return contributors
        .filter(contributor => contributor.type === 'User')
        .map(contributor => ({ avatar: contributor.avatar_url, login: contributor.login, url: contributor.html_url }))
    }
    catch (error) {
      console.warn(`[vieval docs] could not load contributors: ${errorMessageFrom(error) ?? 'unknown error'}`)
      return []
    }
  },
})
