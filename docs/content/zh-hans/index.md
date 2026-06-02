---
title: Vieval
titleTemplate: 面向 Agent 的评测框架
layout: home
theme: dark
home:
  logoAlt: Vieval 图标
  eyebrow: 评测框架
  heroTitle: 使用熟悉的测试 API 做评测
  heroDescription: 面向 agents、模型、prompts、🤗 HuggingFace datasets，也适用于非聊天端点。
  primaryAction:
    text: 快速开始
    link: /zh-hans/guide/
  secondaryAction:
    text: 在 GitHub 查看
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
    eyebrow: 为什么选择 Vieval
    title: 用更可靠的方式衡量概率结果。
    body:
      - Vieval 让评测用例保持可读，同时为矩阵调度、模型执行、自定义断言和报告提供稳定的包边界。
      - 你可以从 chat-model 评测开始，再把同一套流程用于 agents、prompts、datasets、托管服务和非聊天产品端点。
    action:
      text: 阅读指南
      link: /zh-hans/guide/
  features:
    - title: 测试风格的评测文件
      details: 使用 describeTask、caseOf、casesFromInputs 和 expect，让评测用例贴近它们验证的产品代码。
    - title: 原生数据集用例
      details: casesFromInputs 可以接入 HuggingFace datasets、S3 objects、本地 fixtures 或动态生成的输入。
    - title: 从上到下的矩阵能力
      details: 通过 workspace、project、eval 和 task 的矩阵参数，对比一个或多个实现。
    - title: 内置 Rubric 评估
      details: 当 agent 行为无法直接断言时，可以请另一个模型或 agent 根据 rubric 打分。
    - title: Chat models、Voice models 等都可扩展
      details: ChatModels 只是一个插件：第一天先定义聊天提供方，之后可用同一插件接口扩展新的运行时。
    - title: 同时适合 LLM 和人类阅读的报告
      details: 内置 CLI 工具帮助 agents 分析和检查运行结果，让 coding agents 能优化 agent 或模型运行，同时保持可读的人类 DX。
---

<script setup lang="ts">
import Home from '../../.vitepress/theme/Home.vue'
</script>

<Home />
