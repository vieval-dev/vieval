---
title: Getting Started
prev:
  text: Why Vieval
  link: /en/guide/why
next:
  text: Core Concepts
  link: /en/guide/core-concepts
---

# Getting Started

This first evaluation is deterministic and runs entirely in your local Node.js process.

## Install Vieval

::: code-group

```sh [pnpm]
pnpm add -D vieval
```

```sh [npm]
npm install --save-dev vieval
```

:::

## Configure a project

Create a config at the root of your project:

```ts [vieval.config.ts]
import { defineConfig } from 'vieval'

export default defineConfig({
  projects: [
    {
      include: ['evals/*.eval.ts'],
      inferenceExecutors: [
        {
          id: 'local',
        },
      ],
      models: [
        {
          aliases: [],
          id: 'local:deterministic',
          inferenceExecutor: 'local',
          inferenceExecutorId: 'local',
          model: 'deterministic',
        },
      ],
      name: 'getting-started',
      root: '.',
    },
  ],
})
```

The project tells Vieval where to discover evaluation files. The `root` is resolved as the project boundary, and `include` selects matching files beneath it. The model entry is local registry metadata used to enable automatic execution of discovered DSL tasks; this evaluation never calls it as a provider.

## Write an evaluation

Create the matching evaluation file:

```ts [evals/arithmetic.eval.ts]
import { caseOf, describeTask, expect } from 'vieval'

describeTask('arithmetic', () => {
  caseOf('adds two numbers', () => {
    expect(20 + 22).toBe(42)
  })
})
```

`describeTask` registers the task, `caseOf` registers one case inside it, and `expect` executes an assertion. If its matcher fails, it throws and the case fails.

## Run it

::: code-group

```sh [pnpm]
pnpm vieval run --config ./vieval.config.ts
```

```sh [npm]
npx vieval run --config ./vieval.config.ts
```

:::

The stable result is one discovered project, one scheduled task, and one passed case. The terminal presentation may change, so this guide does not depend on exact output text or timing.

::: info No credentials required
Automatic DSL execution currently requires a registered model target. The `local:deterministic` entry only satisfies that execution gate: this task makes no provider call, uses no credentials, and incurs no model cost.
:::

## Optional: How to read later examples

Guide examples use an error highlight to identify the line that failed:

```ts [evals/arithmetic.eval.ts]
expect(20 + 22).toBe(41) // [!code error]
```

Removed and added line highlights then show the correction without hiding the original mistake:

```ts [evals/arithmetic.eval.ts]
expect(20 + 22).toBe(41) // [!code --]
expect(20 + 22).toBe(42) // [!code ++]
```

When the edit itself is the subject, the same change may use a diff fence:

```diff [evals/arithmetic.eval.ts]
- expect(20 + 22).toBe(41)
+ expect(20 + 22).toBe(42)
```

You now have two project files: `vieval.config.ts` defines discovery, while `evals/arithmetic.eval.ts` defines executable evaluation behavior. Continue to [Core Concepts](/en/guide/core-concepts) to see how projects, tasks, cases, attempts, and reports fit together.
