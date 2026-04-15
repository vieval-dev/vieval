module.exports = {
  projects: [
    {
      name: 'example-pattern-byoa-bring-your-own-agent-exec',
      root: '.',
      include: ['evals/*.eval.ts'],
      exclude: [],
      providers: [{ id: 'fixture-provider' }],
      async executor(task) {
        return {
          id: task.id,
          entryId: task.entry.id,
          providerId: task.inferenceExecutor.id,
          matrix: task.matrix,
          scores: [{ kind: 'exact', score: 1 }],
        }
      },
    },
  ],
}
