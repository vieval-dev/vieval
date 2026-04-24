import { describeTask } from '../../../../src'

describeTask('task-concurrency-fixture', (task) => {
  task.casesFromInputs('sample', [1, 2, 3], async () => {})
}, {
  concurrency: {
    case: 2,
  },
})
