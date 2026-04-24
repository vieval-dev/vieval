import { sleep } from '@moeru/std'

import { describeTask } from '../../../../src'

describeTask('cases-from-inputs-fixture', (task) => {
  task.casesFromInputs(
    'sample',
    'a'.repeat(1000).split(''),
    async () => {
      await sleep(500)
    },
    { concurrency: 10 },
  )
})
