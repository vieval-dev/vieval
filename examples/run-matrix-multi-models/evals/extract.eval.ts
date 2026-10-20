import { caseOf, defineScore, describeTask } from 'vieval'

import { extract } from './agent'

/**
 * The one score of this task, so it is also the task's primary score.
 */
const extractScore = defineScore('sleep_matrix.extract', {
  description: {
    'en': 'Mock extraction quality: a random value in 0..1 returned by the agent.',
    'zh-Hans': '模拟的抽取质量：agent 返回的 0..1 之间的随机值。',
  },
  grader: { id: 'mock', kind: 'rule' },
  label: { 'en': 'Extract', 'zh-Hans': '抽取' },
})

async function scoreExtract(input: number) {
  return input
}

describeTask('sleep-matrix', () => {
  caseOf('sleep mock', async (context) => {
    const res = await extract()
    context.recordScore(extractScore, await scoreExtract(res))
  })
}, { scores: [extractScore] })
