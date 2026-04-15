# example-api-expect

Fixture project focused on demonstrating `vieval` API usage from eval files.

Covers:

- Assertion pipeline helpers from `src/core/assertions`
- Rubric judge assertions
- Custom `expect(...)` matchers from `src/expect`

Notes:

- `eval:run` examples are in `evals/*.eval.ts` and are runnable via `vieval run`.
- Extended `expect` matcher usage is demonstrated in `evals/expect-extensions.vitest.test.ts` and runs under Vitest.
