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
          scores: [{ kind: 'exact', score: 1 }],
        }
      },
      include: ['evals/*.eval.ts'],
      name: 'example-pattern-byoa-bring-your-own-agent-exec',
      providers: [{ id: 'fixture-provider' }],
      root: '.',
    },
  ],
}
