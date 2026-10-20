---
title: Vieval
titleTemplate: Vitest-based evaluation framework
layout: home
theme: dark
home:
  heroTitle: Evaluate agents and models, with confidence.
  heroDescription: Agents behave differently from run to run. Vieval runs your cases across models, parameters, and languages, so you can see what works, what breaks, and why, before you ship the next change.
  primaryAction:
    text: Get Started
    link: /en/guide/
  secondaryAction:
    text: View on GitHub
    link: https://github.com/vieval-dev/vieval
  terminal:
    title: vieval
    code: |-
      $ pnpm vieval run --report-out .vieval/reports/candidate
      RUN  vieval
      ✓ |desktop-agent| (412 cases)
        cases 407 passed | 5 failed | 0 timeout
      $ pnpm vieval report cases .vieval/reports/candidate --where state=failed
        ✗ chrome/open-settings  pass 0  wrong tab
        ✗ gimp/resize-image  timeout  60m
        ✗ vscode/rename-symbol  pass 0  old name kept
        ✗ calc/sum-column  rubric 0.42  partial
        ✗ chat/refund-policy  rubric 0.31  hallucinated
  blocks:
    eyebrow: How it works
    title: Write once. Evaluate everywhere.
    body: One green run proves little. Run the same eval again, across every combination you care about, and keep a record of why each case passed or failed.
    items:
      - eyebrow: Write
        visual: code
        title: Write evals like tests
        details: Evals are TypeScript files in your repo. Give casesFromInputs a list of inputs, and each item becomes a case that runs the same code.
      - eyebrow: Expand
        visual: matrix
        title: Cover every combination
        details: List the models and scenarios to compare, and Vieval runs every combination. Add rubrics, and each run is scored once per rubric. You know the total before anything starts.
      - eyebrow: Observe
        visual: trace
        title: Find out why it failed
        details: Every run, retry, and model call is recorded. Watch it live in the dashboard, or export it to OpenTelemetry.
      - eyebrow: Compare
        visual: compare
        title: Compare scores side by side
        details: Reports are plain files. Pick two runs and compare scores by category or metric to see what improved and what regressed.
  usedBy:
    title: Used by
    adopters:
      - { github: proj-airi, name: Project AIRI }
      - { github: moeru-ai, name: Moeru AI }
    domains:
      - Agent memory
      - Computer-use agents
      - Tool calling
      - Vision-language models
      - Voice agents
      - Robotics
      - Retrieval
      - Self-evolving agents
  capabilities:
    eyebrow: Capabilities
    title: Everything you need to evaluate
    learnMore: Learn more
    items:
      - eyebrow: Generate
        scene: factory
        title: Any data source
        summary: Hugging Face, S3, local files, or code.
        details: Load inputs from Hugging Face, S3, or local files, or generate them in code. Change the data without touching the eval, and keep stable case IDs to compare runs over time.
        link: /en/guide/learn/tasks-cases-and-inputs
      - eyebrow: Execute
        scene: executors
        title: Any task, any model
        summary: Chat, voice, vision, and computer use.
        details: Models plug in through providers. OpenAI-compatible APIs and Ollama work out of the box, and you can write your own executor for voice, vision, or robotics.
        link: /en/guide/learn/models-and-inference-executors
      - eyebrow: Schedule
        scene: scheduler
        title: Parallel at full speed
        summary: Run in parallel. Retry what fails.
        details: Run as many cases at once as your providers allow. Flaky calls retry automatically, stuck calls time out, and repeated setup comes from the cache.
        link: /en/guide/learn/reliable-execution
      - eyebrow: Monitor
        scene: monitor
        title: Built-in dashboard
        summary: Watch results as they come in.
        details: Add --with-viewer to see progress, cases, and scores live in a local dashboard. You can also open a run that another process is still writing. No account, no cloud.
        link: /en/guide/learn/reports-and-comparisons
      - eyebrow: Trace
        scene: trace
        title: Trace to the source
        summary: Every score links to its evidence.
        details: Follow any score back to its attempt, transcript, screenshots, and metrics. When a score drops, you see the cause instead of guessing.
        link: /en/guide/learn/reports-and-comparisons
      - eyebrow: Judge
        scene: judge
        title: Model as judge
        summary: When rules can't decide, a model can.
        details: Use expect for what rules can check. For everything else, let another model score the output against a rubric. Custom assertions and plugins work the same way.
        link: /en/guide/learn/assertions-scores-and-metrics
  openSource:
    eyebrow: Open source
    title: Open source, built together
    body: Vieval is MIT licensed. Thanks to the projects and organizations we build on, the universities that evaluate with us, and every contributor.
    contributorsTitle: Contributors
    action:
      text: Star on GitHub
      link: https://github.com/vieval-dev/vieval
    thanks:
      - { github: vitest-dev, name: Vitest }
      - { github: vitejs, name: Vite }
      - { github: voidzero-dev, name: VoidZero }
      - { github: vuejs, name: Vue }
      - { github: unocss, name: UnoCSS }
      - { github: unjs, name: UnJS }
      - { github: juliangarnier, name: anime.js }
      - { github: open-telemetry, name: OpenTelemetry }
      - { github: pnpm, name: pnpm }
      - { github: moeru-ai, name: Moeru AI }
      - { github: proj-airi, name: Project AIRI }
      - { github: lobehub, name: LobeHub }
  footer:
    heading: Start evaluating with Vieval
    subheading: Write your first eval, run it on a few models, and see where they differ.
    action:
      text: Get Started
      link: /en/guide/
---

<script setup lang="ts">
import Home from '../../.vitepress/theme/Home.vue'
</script>

<Home />
