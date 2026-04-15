# example-api-load-datasource-as-cases

Example eval project showing data-loaded task cases across multiple tasks.

Structure:

- `evals/<task-name>/<task-name>.eval.ts`
- `evals/<task-name>/cases/*.json`

Included tasks:

- `arithmetic-quality`
- `intent-routing`

Run:

```bash
pnpm run eval:run -- --config packages/vieval/tests/projects/example-api-load-datasource-as-cases/vieval.config.ts
```
