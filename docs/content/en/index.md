---
title: Vieval
titleTemplate: Vitest-based evaluation framework
layout: home
theme: dark
home:
  logoAlt: Vieval icon
  eyebrow: Evaluation framework
  heroTitle: Evaluate agents and models, with confidence.
  heroDescription: Agents are not deterministic, Vieval let you test and benchmark with confidence, Vieval = Vitest + Benchmark Framework.
  primaryAction:
    text: Get Started
    link: /en/guide/
  secondaryAction:
    text: View on GitHub
    link: https://github.com/vieval-dev/vieval
  terminal:
    title: vieval run
    code: |-
      $ pnpm add -D vieval
      $ pnpm vieval run

      RUN  vieval
      ✓ |agent-routing| (24 tasks)
        4 files, 6 entries, 24 runs
        cases 198 passed | 3 failed | 0 timeout
        matrix run 4 [model|scenario] / eval 2 [rubric]
        report .vieval/reports/local/baseline/attempt-a/...
  why:
    eyebrow: Why Vieval
    title: Measure over probability, but with confidence this time.
    body:
      - Vieval keeps evaluation cases readable while giving matrix scheduling, model execution, custom assertions, and reporting a stable infrastructure.
      - OpenAI compatible chat completions are supported natively, but it's not limited, YOLO, VLM, and Robotics evaluation cases can be used as well.
    action:
      text: Read the guide
      link: /en/guide/
  features:
    - title: Test-style eval files
      details: Use describeTask, caseOf, casesFromInputs, and expect to keep eval cases close to the product code they validate.
    - title: Native dataset cases
      details: Feed casesFromInputs from HuggingFace datasets, S3 objects, local fixtures, or dynamically generated inputs.
    - title: Matrix, all the way down
      details: Compare one implementation or many through workspace, project, eval, and task matrix parameters.
    - title: Rubric is built-in
      details: When agent behavior cannot be asserted directly, ask another model or agent to score it against a rubric.
    - title: Chat models, Voice models, you name it!
      details: "ChatModels is just a plugin: define chat providers on day one, then extend the same plugin surface for new runtimes."
    - title: LLM & Human friendly reports
      details: Built-in CLI tools help agents analyze and inspect runs, so coding agents can optimize your agent or model runs while human DX stays readable too.
---

<script setup lang="ts">
import Home from '../../.vitepress/theme/Home.vue'
</script>

<Home />
