# Execution Policy Auto Attempt Fixture

This fixture demonstrates a full-task rerun after the first attempt settles.

## What It Shows

- `caseOf(..., { autoAttempt })`
- second task attempt starts only after every case in the previous attempt settles
- append-only log output for integration assertions
