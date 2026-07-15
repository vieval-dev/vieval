---
title: Why Vieval
prev: false
next:
  text: Getting Started
  link: /en/guide/getting-started
---

# Why Vieval

Evaluation code is most useful when it can evolve with the behavior it measures. Vieval keeps evaluation files next to product code, where they can be reviewed, versioned, and changed through the same development workflow.

## Repeatability needs more than a callback

A callback can check one behavior once. A repeatable evaluation also needs to find the intended files, expand variations consistently, schedule the resulting work, and preserve evidence after execution.

Vieval owns that evaluation lifecycle: discovery, matrix expansion, scheduling, execution evidence, reports, and comparison. Tasks remain ordinary TypeScript definitions, while the runner supplies the surrounding structure needed to execute the same evaluation again or across several model and scenario combinations.

## One run serves people and tools

During a run, the CLI provides human-readable progress and summaries. Pass `--json` to print machine-readable output, or `--report-out <directory>` to write report artifacts that analysis, comparison, and automation can inspect. These output modes use the same discovery, scheduling, and execution path as the interactive CLI.

## A good fit

Vieval is a good fit when:

- evaluations belong in a TypeScript repository and should be reviewed with product changes;
- the same task needs to run across model, scenario, rubric, or dataset variations;
- local runs and automation need consistent scheduling and evidence;
- case-level assertions, scores, and metrics need to remain available through explicitly written report artifacts.

## Not a good fit

Vieval does not provide hosted dataset management, an annotation UI or annotation product, or SaaS observability. Use dedicated services for those needs. Vieval can evaluate code that reads external data or calls remote models, but it remains the evaluation runner and artifact producer rather than the system that hosts those surrounding products.
