# Matrix Scenarios Fixture

This fixture demonstrates control-group style matrix design in `vieval`.

## Scenarios

- `model-comparison.eval.ts`
  - compares `gpt-4.1-mini` vs `gpt-4.1` under `baseline` and `stress`
- `prompt-language-ablation.eval.ts`
  - validates run-matrix axes such as `promptLanguage` and `scenario`
- `rubric-sensitivity.eval.ts`
  - compares strict/lenient rubric and `rubricModel` judge variants

## Matrix Layers Demonstrated

- project-level defaults in `vieval.config.ts`
- eval-level extension/override in each `*.eval.ts`
- task-level override in `rubric-sensitivity.eval.ts`

This is intended as an example set for matrix-powered control-group experimentation.
