# CLI Concurrency Overrides Fixture

This fixture demonstrates CLI caps applied over run-wide pools declared in config.

## What It Shows

- top-level `concurrency: { project: 2, task: 2 }`, which bounds the whole run
- CLI flags such as `--project-concurrency` and `--task-concurrency`, which also bound the whole run, so the smaller
  value wins and a flag never raises a configured value
