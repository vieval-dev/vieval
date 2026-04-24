import { describeTask } from '../../../../src'

describeTask('cli-overrides-fixture', (task) => {
  task.casesFromInputs('sample', ['a', 'b'], async () => {})
})
