# Execution Policy Auto Retry Fixture

This fixture demonstrates a case that succeeds only after in-attempt retries.

## What It Shows

- `caseOf(..., { autoRetry })`
- retries happen within the same task attempt
- the task still reports one passing case after recovery
