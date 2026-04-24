import { caseOf, describeTask } from '../../../../src'

describeTask('experiment-metadata-fixture', () => {
  caseOf('sample-case', async () => {}, {
    input: {
      source: 'fixture',
    },
  })
})
