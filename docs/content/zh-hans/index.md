---
title: Vieval
titleTemplate: 面向智能体的评测框架
layout: home
theme: dark
home:
  logoAlt: Vieval 图标
  eyebrow: 评测框架
  heroTitle: 可靠地评测智能体与模型
  heroDescription: Vieval 用熟悉的测试写法组织可重复执行的评测，并汇总用例结果与分数，生成报告。可以把它理解为 Vitest 式开发体验与评测运行器的结合。
  primaryAction:
    text: 快速开始
    link: /zh-hans/guide/
  secondaryAction:
    text: 查看 GitHub
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
  why:
    eyebrow: 为什么使用 Vieval？
    title: 通过反复运行评测，衡量不稳定的行为。
    body:
      - 用 TypeScript 编写评测用例，再由 Vieval 发现文件、组合矩阵变量、调度任务，并汇总断言结果、分数和指标。
      - 模型注册与模型调用彼此分离。内置聊天模型插件负责管理 OpenAI、OpenRouter 和 Ollama 等运行配置；任务代码决定是否以及何时调用模型。
    action:
      text: 阅读指南
      link: /zh-hans/guide/
  features:
    - title: 测试风格的评测文件
      details: 使用 describeTask、caseOf、casesFromInputs 和 expect，把任务、输入与断言写在同一份 TypeScript 文件中。
    - title: 从输入数组批量生成用例
      details: 先用代码加载或构造输入数组，再交给 casesFromInputs 为每个元素注册一个用例。
    - title: 分层配置矩阵
      details: 在项目、评测项和任务三个层级组合模型、场景与评分方式等变量，并对每组组合执行同一个任务。
    - title: 内置评分标准断言
      details: 当行为无法用确定性断言判断时，可以让评分标准（rubric）的评判回调返回评分理由和分数；是否调用另一个模型由评测代码决定。
    - title: 可扩展的模型注册
      details: 内置 ChatModels 插件管理聊天模型元数据；也可以编写项目插件，向配置中注册其他模型定义。
    - title: 面向开发者和工具的输出
      details: CLI 默认显示便于阅读的进度与摘要，也可输出 JSON，或将运行摘要、事件和用例记录写入报告目录。
---

<script setup lang="ts">
import Home from '../../.vitepress/theme/Home.vue'
</script>

<Home />
