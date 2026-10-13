# casesFromInputs Concurrency Fixture

This fixture demonstrates task-local bounded case execution with `casesFromInputs(..., { concurrency })`.

## What It Shows

- one task generated from multiple inputs
- a per-group case pool of `10`, shared only by the cases of that `casesFromInputs` call
- a compact runnable example for `vieval run`
