import { caseOf, describeTask } from 'vieval'

import { extract } from './agent'

async function scoreExtract(input: number) {
  return input
}

describeTask('sleep-matrix', () => {
  caseOf('sleep mock', async (context) => {
    const res = await extract()
    context.score(await scoreExtract(res))
  })
})
