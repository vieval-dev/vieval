module.exports = {
  projects: [
    {
      exclude: [],
      async executor(task) {
        return {
          entryId: task.entry.id,
          id: task.id,
          matrix: task.matrix,
          providerId: task.inferenceExecutor.id,
          scores: [{ mean: 1, n: 1, name: 'byoa.success', sum: 1, total: 1, unscored: {} }],
        }
      },
      include: ['evals/*.eval.ts'],
      name: 'example-pattern-byoa-bring-your-own-agent-exec',
      providers: [{ id: 'fixture-provider' }],
      root: '.',
    },
  ],
}
