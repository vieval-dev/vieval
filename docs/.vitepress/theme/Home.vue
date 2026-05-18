<script setup lang="ts">
const features = [
  {
    title: 'Test-style eval files',
    details: 'Use describeTask, caseOf, casesFromInputs, and expect to keep eval cases close to the product code they validate.',
  },
  {
    title: 'Native dataset cases',
    details: 'Feed casesFromInputs from HuggingFace datasets, S3 objects, local fixtures, or dynamically generated inputs.',
  },
  {
    title: 'Matrix, all the way down',
    details: 'Compare one implementation or many through workspace, project, eval, and task matrix parameters.',
  },
  {
    title: 'Rubric is built-in',
    details: 'When agent behavior cannot be asserted directly, ask another model or agent to score it against a rubric.',
  },
  {
    title: 'Chat models, Voice models, you name it!',
    details: 'ChatModels is just a plugin: define chat providers on day one, then extend the same plugin surface for new runtimes.',
  },
  {
    title: 'LLM & Human friendly reports',
    details: 'Built-in CLI tools help agents analyze and inspect runs, so coding agents can optimize your agent or model runs while human DX stays readable too.',
  },
]
</script>

<template>
  <div class="wrapper wrapper--ticks grid md:grid-cols-2 w-full border-nickel divide-x">
    <section class="flex flex-col p-10 justify-center items-center md:items-start">
      <div class="flex flex-col gap-5 max-w-[32rem] text-center md:text-left items-center md:items-start">
        <div class="flex items-center gap-3">
          <img src="/logo.svg" alt="Vieval icon" class="size-8">
          <span class="text-grey text-xs font-mono uppercase tracking-wide">Evaluation framework</span>
        </div>
        <h1 class="text-white text-pretty">
          Evaluate with test API you already know
        </h1>
        <p class="text-white/70 text-lg max-w-[28rem] text-pretty">
          For agents, models, prompts, 🤗 HuggingFace datasets, even for non-chat endpoints too.
        </p>
        <div class="flex flex-wrap items-center justify-center md:justify-start gap-5 mt-8">
          <a href="/en/guide/" class="button button--primary inline-block w-fit">
            <span>Get Started</span>
          </a>
          <a href="https://github.com/vieval-dev/vieval" target="_blank" rel="noopener noreferrer" class="button inline-block w-fit">
            View on GitHub
          </a>
        </div>
      </div>
    </section>

    <section class="flex flex-col min-h-[22rem] sm:min-h-[30rem]">
      <div class="hero-terminal relative h-full flex flex-col justify-center overflow-clip p-6 sm:p-10">
        <div class="terminal-window">
          <div class="terminal-title">
            <span />
            <span />
            <span />
            <strong>vieval run</strong>
          </div>
          <pre><code><span class="terminal-muted">$</span> pnpm add -D vieval
<span class="terminal-muted">$</span> pnpm vieval run

<span class="terminal-accent">RUN</span>  vieval
<span class="terminal-success">✓</span> <span class="terminal-badge">|agent-routing|</span> <span class="terminal-muted">(24 tasks)</span>
  <span class="terminal-number">4</span> files, <span class="terminal-number">6</span> entries, <span class="terminal-number">24</span> runs
  cases <span class="terminal-success">198 passed</span> <span class="terminal-muted">|</span> <span class="terminal-error">3 failed</span> <span class="terminal-muted">|</span> <span class="terminal-muted">0 timeout</span>
  <span class="terminal-muted">matrix run</span> <span class="terminal-number">4</span> <span class="terminal-muted">[model|scenario] / eval</span> <span class="terminal-number">2</span> <span class="terminal-muted">[rubric]</span>
  <span class="terminal-muted">report .vieval/reports/local/baseline/attempt-a/...</span></code></pre>
        </div>
      </div>
    </section>
  </div>

  <section class="wrapper wrapper--ticks border-t py-14 lg:py-30 px-5 sm:px-10 lg:px-20">
    <div class="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-5 lg:gap-8 text-left">
      <div class="flex flex-col gap-3 max-w-md">
        <div class="flex gap-3 items-center">
          <img src="/logo.svg" alt="Vieval icon" class="size-5">
          <span class="text-grey text-xs font-medium font-mono uppercase tracking-wide">Why Vieval</span>
        </div>
        <h3 class="text-white max-w-xl text-balance">
          Measure over probability, but with confidence this time.
        </h3>
        <a href="/en/guide/" class="button w-fit mt-8 hidden lg:block">Read the guide</a>
      </div>
      <div class="lg:max-w-lg">
        <p class="text-pretty mb-5">
          Vieval keeps evaluation cases readable while giving matrix scheduling, model execution, custom assertions, and reporting their own stable package boundaries.
        </p>
        <p class="text-pretty">
          Start with chat-model evals, then use the same workflow for agents, prompts, datasets, hosted services, and non-chat product endpoints.
        </p>
        <a href="/en/guide/" class="button w-fit mt-8 block lg:hidden">Read the guide</a>
      </div>
    </div>
  </section>

  <section class="feature-grid wrapper wrapper--ticks border-t border-b grid lg:grid-cols-2">
    <article v-for="feature in features" :key="feature.title" class="feature-card flex flex-col gap-3 min-h-[16rem] p-5 sm:p-10 justify-between">
      <div class="flex flex-col gap-3">
        <h5 class="text-white">
          {{ feature.title }}
        </h5>
        <p class="max-w-[30rem] text-pretty">
          {{ feature.details }}
        </p>
      </div>
      <div class="feature-preview" aria-hidden="true">
        <span>{{ feature.title.slice(0, 2).toUpperCase() }}</span>
      </div>
    </article>
  </section>
</template>

<style scoped>
.hero-terminal {
  background:
    radial-gradient(circle at 72% 28%, rgba(56, 189, 248, 0.28), transparent 18rem),
    linear-gradient(135deg, rgba(17, 24, 39, 0.95), rgba(3, 7, 18, 0.98));
}

.terminal-window {
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 0.5rem;
  background: rgba(3, 7, 18, 0.86);
  box-shadow: 0 2rem 4rem rgba(0, 0, 0, 0.35);
}

.terminal-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.8rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.8rem;
}

.terminal-title span {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.32);
}

.terminal-title strong {
  margin-left: auto;
  font-weight: 600;
}

pre {
  margin: 0;
  padding: 1.25rem;
  color: #bae6fd;
  font-size: 0.94rem;
  line-height: 1.8;
  white-space: pre-wrap;
}

pre code {
  padding: 0;
  border: 0;
  border-radius: 0;
  outline: 0;
  color: inherit;
  background: transparent;
  font-size: inherit;
}

.terminal-accent,
.terminal-number {
  color: #facc15;
}

.terminal-badge {
  color: #fde68a;
}

.terminal-muted {
  color: rgba(186, 230, 253, 0.52);
}

.terminal-success {
  color: #86efac;
}

.terminal-error {
  color: #fca5a5;
}

.feature-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 8rem;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0.5rem;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.08), transparent 45%),
    rgba(255, 255, 255, 0.03);
}

.feature-preview span {
  color: rgba(255, 255, 255, 0.22);
  font-size: 4rem;
  font-weight: 800;
  line-height: 1;
}

.feature-card {
  border-color: var(--color-nickel);
}

@media (min-width: 1024px) {
  .feature-card:nth-child(odd) {
    border-right-width: 1px;
  }

  .feature-card:nth-child(n + 3) {
    border-top-width: 1px;
  }
}

@media (max-width: 1023px) {
  .feature-card + .feature-card {
    border-top-width: 1px;
  }
}
</style>
