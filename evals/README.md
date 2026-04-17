# Evals Workspace

This directory contains benchmark and test-object workspaces used with `vieval`.

## Layout

- `benchmarks/locomo`: unified LoCoMo package containing benchmark core and all test-objects.
- `benchmarks/locomo/benchmark`: benchmark-core source.
- `benchmarks/locomo/test-objects/*`: backend adapters (mem9, lobehub, etc.).

## Goal

Use one benchmark-core and shared cached case artifacts to compare multiple backends under identical LoCoMo inputs.
